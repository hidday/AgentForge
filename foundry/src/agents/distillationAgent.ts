import type { Logger } from "../utils/logger.js";
import type { AgentRunner } from "../runtime/agentRunner.js";
import type { ArtifactRepository } from "../orchestrator/artifactRepository.js";
import type { AgentSkillRepository } from "../orchestrator/agentSkillRepository.js";
import type { EventRepository } from "../orchestrator/eventRepository.js";
import type { Run, CompactSkillSummary } from "../domain/types.js";
import { DistillationOutputSchema } from "../schemas/cliProtocol.js";
import { AGENT_STAGES } from "../domain/types.js";
import { loadPromptTemplate, renderTemplate } from "./promptRenderer.js";
import { maxNoveltyOverlap } from "../utils/similarity.js";
import { normalizeSkillName } from "../utils/skillNaming.js";
import { env } from "../config/env.js";

const SKILL_DISTILLATION_EVENT = "SKILL_DISTILLATION";

export class DistillationAgent {
  constructor(
    private readonly agentRunner: AgentRunner,
    private readonly artifactRepo: ArtifactRepository,
    private readonly agentSkillRepo: AgentSkillRepository,
    private readonly eventRepo: EventRepository,
    private readonly config: {
      MAX_SKILLS_PER_REPO: number;
      NOVELTY_SIMILARITY_THRESHOLD: number;
    },
    private readonly logger: Logger,
  ) {}

  async run(runId: string, run: Run): Promise<void> {
    this.logger.info({ runId }, "Starting distillation agent");

    // (1) Load artifacts
    const planArtifact = await this.artifactRepo.findLatestByType(runId, "Plan");
    const executionArtifact = await this.artifactRepo.findLatestByType(runId, "ExecutionReport");
    const remediationArtifact = await this.artifactRepo.findLatestByType(runId, "Remediation");

    if (!executionArtifact) {
      this.logger.warn({ runId }, "No ExecutionReport artifact found, skipping distillation");
      await this.eventRepo.create({
        runId,
        eventType: SKILL_DISTILLATION_EVENT,
        source: "distillation-agent",
        payloadJson: {
          shouldPersist: false,
          reason: "no_execution_report",
          displacedSkillId: null,
        },
      });
      return;
    }

    // (2) Build task query string
    const taskQuery =
      (run.linearIssueTitle ?? "") +
      " " +
      ((run as unknown as { linearIssueDescription?: string }).linearIssueDescription?.slice(
        0,
        200,
      ) ?? "");

    // (3) Fetch active skill pool and build CompactSkillSummary[]
    const activeSkills = await this.agentSkillRepo.findActiveByRepo(run.repo);
    const existingSkillsSummary: CompactSkillSummary[] = activeSkills.map((skill) => ({
      id: skill.id,
      taskCategory: skill.taskCategory,
      snippet: skill.skillMarkdown.slice(0, 200),
      name: skill.name ?? undefined,
    }));

    // (4) NOVELTY PRE-CHECK (deterministic, no LLM)
    const maxOverlap = maxNoveltyOverlap(activeSkills, taskQuery);
    if (maxOverlap >= this.config.NOVELTY_SIMILARITY_THRESHOLD) {
      this.logger.info(
        { runId, maxOverlap, threshold: this.config.NOVELTY_SIMILARITY_THRESHOLD },
        "Novelty pre-check failed — skill already covered",
      );
      await this.eventRepo.create({
        runId,
        eventType: SKILL_DISTILLATION_EVENT,
        source: "distillation-agent",
        payloadJson: {
          shouldPersist: false,
          reason: `novelty_gate_failed: max_overlap=${maxOverlap.toFixed(3)}`,
          displacedSkillId: null,
        },
      });
      return;
    }

    // (5) LLM call (confidence + subjective novelty)
    const systemTemplate = loadPromptTemplate("distillation.system.md");
    const userTemplate = loadPromptTemplate("distillation.user.md");

    const planSummary = planArtifact
      ? JSON.stringify(planArtifact.payloadJson).slice(0, 1000)
      : "No plan artifact available";

    const executionOutcome = executionArtifact
      ? JSON.stringify(executionArtifact.payloadJson).slice(0, 1000)
      : "No execution report available";

    const remediationSummary = remediationArtifact
      ? `## Remediation Summary\n${JSON.stringify(remediationArtifact.payloadJson).slice(0, 500)}`
      : "";

    const existingSkillsSummaryText =
      existingSkillsSummary.length > 0
        ? existingSkillsSummary
            .map((s) => `- [${s.name ?? s.taskCategory}] ${s.taskCategory}: ${s.snippet}`)
            .join("\n")
        : "No existing skills.";

    const userPrompt = renderTemplate(userTemplate, {
      repoSlug: run.repo,
      taskCategory_hint: run.linearIssueTitle ?? "",
      planSummary,
      executionOutcome,
      existingSkillsSummary: existingSkillsSummaryText,
      remediationSummary,
    } as Record<string, unknown>);

    let decision: {
      shouldPersist: boolean;
      reason: string;
      skillMarkdown?: string;
      taskCategory?: string;
      name?: string;
      description?: string;
    };

    try {
      const output = await this.agentRunner.run(
        AGENT_STAGES.planner.runtime,
        {
          prompt: userPrompt,
          systemPrompt: systemTemplate,
          workingDirectory: run.workingDirectory,
          timeoutMs: env.AGENT_TIMEOUT_MS,
          runId,
        },
        "distillation",
        DistillationOutputSchema,
      );
      decision = output.parsed.payload;
    } catch (err) {
      this.logger.warn(
        { runId, error: err instanceof Error ? err.message : String(err) },
        "Distillation LLM call failed or parse error",
      );
      await this.eventRepo.create({
        runId,
        eventType: SKILL_DISTILLATION_EVENT,
        source: "distillation-agent",
        payloadJson: {
          shouldPersist: false,
          reason: "parse_error",
          displacedSkillId: null,
        },
      });
      return;
    }

    // (6) If LLM says don't persist
    if (!decision.shouldPersist) {
      await this.eventRepo.create({
        runId,
        eventType: SKILL_DISTILLATION_EVENT,
        source: "distillation-agent",
        payloadJson: {
          shouldPersist: false,
          reason: decision.reason,
          taskCategory: decision.taskCategory ?? null,
          displacedSkillId: null,
        },
      });
      return;
    }

    // (7) HEADROOM GATE + DISPLACEMENT (if shouldPersist=true)
    const taskCategory = decision.taskCategory?.trim();
    const skillMarkdown = decision.skillMarkdown?.trim();
    if (!taskCategory || !skillMarkdown) {
      this.logger.warn({ runId }, "Distillation missing taskCategory or skillMarkdown, skipping persist");
      await this.eventRepo.create({
        runId,
        eventType: SKILL_DISTILLATION_EVENT,
        source: "distillation-agent",
        payloadJson: {
          shouldPersist: false,
          reason: "missing_required_skill_fields",
          displacedSkillId: null,
        },
      });
      return;
    }

    const name = normalizeSkillName(decision.name, taskCategory);
    const description =
      decision.description?.trim() ||
      `Use when working on ${taskCategory} in ${run.repo}.`;

    const skillPayload = {
      name,
      description,
      taskCategory,
      skillMarkdown,
    };

    const activeCount = await this.agentSkillRepo.countActiveByRepo(run.repo);

    if (activeCount >= this.config.MAX_SKILLS_PER_REPO) {
      // Pool at capacity — displace lowest utility skill
      const { newSkill, displacedSkillId } = await this.agentSkillRepo.displaceAndCreate(
        run.repo,
        skillPayload,
      );

      this.logger.info(
        { runId, displacedSkillId, taskCategory, name },
        "Displaced skill to make room for new skill",
      );

      await this.eventRepo.create({
        runId,
        eventType: SKILL_DISTILLATION_EVENT,
        source: "distillation-agent",
        payloadJson: {
          shouldPersist: true,
          reason: decision.reason,
          taskCategory,
          name,
          description,
          skillId: newSkill.id,
          displacedSkillId,
        },
      });
    } else {
      // Headroom available — create directly
      const newSkill = await this.agentSkillRepo.create({
        repoSlug: run.repo,
        ...skillPayload,
      });

      this.logger.info({ runId, taskCategory, name }, "Created new skill from distillation");

      await this.eventRepo.create({
        runId,
        eventType: SKILL_DISTILLATION_EVENT,
        source: "distillation-agent",
        payloadJson: {
          shouldPersist: true,
          reason: decision.reason,
          taskCategory,
          name,
          description,
          skillId: newSkill.id,
          displacedSkillId: null,
        },
      });
    }
  }
}
