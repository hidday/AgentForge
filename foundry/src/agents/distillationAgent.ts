import type { Logger } from "../utils/logger.js";
import type { AgentRunner } from "../runtime/agentRunner.js";
import type { ArtifactRepository } from "../orchestrator/artifactRepository.js";
import type { AgentSkillRepository } from "../orchestrator/agentSkillRepository.js";
import type { EventRepository } from "../orchestrator/eventRepository.js";
import type { Run, CompactSkillSummary } from "../domain/types.js";
import { DistillationOutputSchema } from "../schemas/cliProtocol.js";
import { PlanSchema } from "../schemas/plan.js";
import { ExecutionReportSchema } from "../schemas/executionReport.js";
import { RemediationSchema } from "../schemas/remediation.js";
import { AGENT_STAGES } from "../domain/types.js";
import { loadPromptTemplate, renderTemplate } from "./promptRenderer.js";
import { maxNoveltyOverlap } from "../utils/similarity.js";
import { normalizeSkillName } from "../utils/skillNaming.js";
import { env } from "../config/env.js";

const SKILL_DISTILLATION_EVENT = "SKILL_DISTILLATION";

function truncate(text: string, max: number): string {
  const trimmed = text.trim();
  return trimmed.length <= max ? trimmed : `${trimmed.slice(0, max).trimEnd()}…`;
}

function bulletList(items: string[], cap: number, itemMax: number): string {
  const cleaned = items.map((i) => i.trim()).filter(Boolean);
  if (cleaned.length === 0) return "_none_";
  const shown = cleaned.slice(0, cap).map((i) => `- ${truncate(i, itemMax)}`);
  if (cleaned.length > cap) shown.push(`- …and ${cleaned.length - cap} more`);
  return shown.join("\n");
}

/**
 * Field-aware plan summary. Surfaces the signals that matter for generalization
 * (summary, assumptions, risks, the areas touched by steps, test plan) instead of
 * a blindly truncated JSON blob. Falls back to truncated JSON if the payload does
 * not match the expected schema.
 */
function summarizePlan(payload: unknown): string {
  const parsed = PlanSchema.safeParse(payload);
  if (!parsed.success) return truncate(JSON.stringify(payload), 1500);
  const plan = parsed.data;
  const steps =
    plan.steps.length > 0
      ? plan.steps
          .slice(0, 12)
          .map(
            (s, i) =>
              `${i + 1}. ${truncate(s.title, 120)}${s.description ? ` — ${truncate(s.description, 200)}` : ""}`,
          )
          .join("\n") +
        (plan.steps.length > 12 ? `\n…and ${plan.steps.length - 12} more steps` : "")
      : "_none_";
  return [
    `**Summary**: ${truncate(plan.summary, 600)}`,
    `**Confidence**: ${plan.confidence.toFixed(2)}`,
    `**Assumptions**:\n${bulletList(plan.assumptions, 8, 200)}`,
    `**Risks**:\n${bulletList(plan.risks, 8, 200)}`,
    `**Steps**:\n${steps}`,
    `**Test Plan**: ${truncate(plan.testPlan, 400)}`,
  ].join("\n\n");
}

/**
 * Field-aware execution summary. `notes` (discovered gotchas) and `filesChanged`
 * (which subsystem was touched) are the richest generalization signals, so they
 * get generous caps. Failing checks include their details; passing ones stay terse.
 */
function summarizeExecution(payload: unknown): string {
  const parsed = ExecutionReportSchema.safeParse(payload);
  if (!parsed.success) return truncate(JSON.stringify(payload), 1500);
  const report = parsed.data;
  const checkLine = (name: string, c: { status: string; details: string }) =>
    `- ${name}: ${c.status}${c.status !== "pass" && c.details ? ` — ${truncate(c.details, 200)}` : ""}`;
  const files =
    report.filesChanged.length > 0
      ? report.filesChanged
          .slice(0, 40)
          .map((f) => `- ${f}`)
          .join("\n") +
        (report.filesChanged.length > 40 ? `\n- …and ${report.filesChanged.length - 40} more` : "")
      : "_none_";
  return [
    `**Summary**: ${truncate(report.summary, 600)}`,
    `**Score**: ${report.score.toFixed(2)} — ${truncate(report.scoreRationale, 400)}`,
    `**Files Changed** (${report.filesChanged.length}):\n${files}`,
    `**Checks**:\n${[
      checkLine("lint", report.checks.lint),
      checkLine("typecheck", report.checks.typecheck),
      checkLine("tests", report.checks.tests),
    ].join("\n")}`,
    `**Notes**:\n${bulletList(report.notes, 15, 240)}`,
  ].join("\n\n");
}

/**
 * Field-aware remediation summary. Resolution items (what a reviewer flagged, what
 * was changed, and why) are a prime source of repo-specific footguns, so each item
 * keeps its action + rationale.
 */
function summarizeRemediation(payload: unknown): string {
  const parsed = RemediationSchema.safeParse(payload);
  if (!parsed.success) return `## Remediation Summary\n${truncate(JSON.stringify(payload), 1000)}`;
  const rem = parsed.data;
  const resolutions =
    rem.resolution.length > 0
      ? rem.resolution
          .slice(0, 15)
          .map(
            (r) =>
              `- [${r.status}] ${r.findingId}: ${truncate(r.action, 200)}${r.rationale ? `\n  *why*: ${truncate(r.rationale, 200)}` : ""}`,
          )
          .join("\n") +
        (rem.resolution.length > 15 ? `\n- …and ${rem.resolution.length - 15} more` : "")
      : "_none_";
  const er = rem.executionReport;
  return [
    "## Remediation Summary",
    `**Ready for human review**: ${rem.readyForHumanReview}`,
    `**Final score**: ${er.score.toFixed(2)} — ${truncate(er.scoreRationale, 300)}`,
    `**Resolutions**:\n${resolutions}`,
  ].join("\n\n");
}

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
      ? summarizePlan(planArtifact.payloadJson)
      : "No plan artifact available";

    const executionOutcome = executionArtifact
      ? summarizeExecution(executionArtifact.payloadJson)
      : "No execution report available";

    const remediationSummary = remediationArtifact
      ? summarizeRemediation(remediationArtifact.payloadJson)
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
      this.logger.warn(
        { runId },
        "Distillation missing taskCategory or skillMarkdown, skipping persist",
      );
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
    const trimmedDescription = decision.description?.trim();
    const description = trimmedDescription?.length
      ? trimmedDescription
      : `Use when working on ${taskCategory} in ${run.repo}.`;

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
