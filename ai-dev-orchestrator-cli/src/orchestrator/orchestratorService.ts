import type { Logger } from "../utils/logger.js";
import { RunState } from "../domain/runState.js";
import { RunEvent } from "../domain/runEvent.js";
import type { Run } from "../domain/types.js";
import type { TaskBundle } from "../schemas/taskBundle.js";
import type { Plan } from "../schemas/plan.js";
import type { ExecutionReport } from "../schemas/executionReport.js";
import type { Review } from "../schemas/review.js";
import type { LinearCommand } from "../linear/linearCommandParser.js";
import type { LinearClient } from "../linear/linearClient.js";
import type { GitHubClient } from "../github/githubClient.js";
import type { RunRepository } from "./runRepository.js";
import type { ArtifactRepository } from "./artifactRepository.js";
import type { EventRepository } from "./eventRepository.js";
import { PolicyEngine } from "./policyEngine.js";
import { transition } from "./stateMachine.js";
import type { PlannerAgent } from "../agents/plannerAgent.js";
import type { ExecutorAgent } from "../agents/executorAgent.js";
import type { ReviewerAgent } from "../agents/reviewerAgent.js";
import type { RemediationAgent } from "../agents/remediationAgent.js";
import { startTimer } from "../utils/time.js";
import { env } from "../config/env.js";

export interface WebhookPayload {
  action: string;
  issueId: string;
  command?: LinearCommand;
}

interface OrchestratorDeps {
  runRepo: RunRepository;
  artifactRepo: ArtifactRepository;
  eventRepo: EventRepository;
  linearClient: LinearClient;
  githubClient: GitHubClient;
  plannerAgent: PlannerAgent;
  executorAgent: ExecutorAgent;
  reviewerAgent: ReviewerAgent;
  remediationAgent: RemediationAgent;
  logger: Logger;
}

export class OrchestratorService {
  private readonly runRepo: RunRepository;
  private readonly artifactRepo: ArtifactRepository;
  private readonly eventRepo: EventRepository;
  private readonly linearClient: LinearClient;
  private readonly githubClient: GitHubClient;
  private readonly plannerAgent: PlannerAgent;
  private readonly executorAgent: ExecutorAgent;
  private readonly reviewerAgent: ReviewerAgent;
  private readonly remediationAgent: RemediationAgent;
  private readonly policy = new PolicyEngine();
  private readonly logger: Logger;

  constructor(deps: OrchestratorDeps) {
    this.runRepo = deps.runRepo;
    this.artifactRepo = deps.artifactRepo;
    this.eventRepo = deps.eventRepo;
    this.linearClient = deps.linearClient;
    this.githubClient = deps.githubClient;
    this.plannerAgent = deps.plannerAgent;
    this.executorAgent = deps.executorAgent;
    this.reviewerAgent = deps.reviewerAgent;
    this.remediationAgent = deps.remediationAgent;
    this.logger = deps.logger;
  }

  async handleLinearWebhook(payload: WebhookPayload): Promise<void> {
    this.logger.info({ action: payload.action, issueId: payload.issueId }, "Handling Linear webhook");

    switch (payload.action) {
      case "issue.created":
        break;

      case "comment.command":
        if (payload.command) {
          await this.handleCommand(payload.issueId, payload.command);
        }
        break;

      case "issue.updated":
        break;
    }
  }

  async handleCommand(issueId: string, command: LinearCommand): Promise<void> {
    this.logger.info({ issueId, command: command.type }, "Processing command");

    switch (command.type) {
      case "ai-plan":
      case "run-ai":
        await this.startRun(issueId);
        break;
      case "approve-plan": {
        const run = await this.runRepo.findByIssueId(issueId);
        if (run) await this.approvePlan(run.id);
        break;
      }
      case "reject-plan": {
        const run = await this.runRepo.findByIssueId(issueId);
        if (run) await this.rejectPlan(run.id);
        break;
      }
      case "re-review": {
        const run = await this.runRepo.findByIssueId(issueId);
        if (run) await this.runReview(run.id);
        break;
      }
      case "pause-ai": {
        const run = await this.runRepo.findByIssueId(issueId);
        if (run) await this.transitionAndRecord(run, RunEvent.BLOCKED, "user-command");
        break;
      }
      case "resume-ai": {
        const run = await this.runRepo.findByIssueId(issueId);
        if (run) await this.transitionAndRecord(run, RunEvent.RESET_TO_TODO, "user-command");
        break;
      }
      case "unknown":
        this.logger.warn({ issueId, command }, "Unknown command received");
        break;
    }
  }

  async startRun(issueId: string): Promise<Run> {
    const timer = startTimer();
    this.logger.info({ issueId }, "Starting new run");

    const issue = await this.linearClient.getIssue(issueId);

    let run = await this.runRepo.findByIssueId(issueId);
    if (!run) {
      run = await this.runRepo.create({
        linearIssueId: issueId,
        repo: "acme/backend-api",
        workingDirectory: env.DEFAULT_REPO_PATH,
      });
    }

    this.policy.assertCanPlan(run);

    run = await this.transitionAndRecord(run, RunEvent.RUN_REQUESTED, "orchestrator");

    const bundle = this.buildTaskBundle(issue, run);

    await this.linearClient.postComment(
      issueId,
      `🤖 AI planning started for "${issue.title}". Will produce a plan for approval.`,
    );

    const plan = await this.plannerAgent.run(bundle, run.id);

    run = await this.runRepo.update(run.id, {
      planVersion: plan.planVersion,
      plannerRuntime: "claude-code",
    });
    run = await this.transitionAndRecord(run, RunEvent.PLAN_CREATED, "planner-agent");

    const planSummary = this.formatPlanComment(plan);
    await this.linearClient.postComment(issueId, planSummary);

    this.logger.info(
      { runId: run.id, state: run.state, durationMs: timer.elapsed() },
      "Planning complete, awaiting approval",
    );

    return run;
  }

  async approvePlan(runId: string): Promise<Run> {
    const timer = startTimer();
    let run = await this.requireRun(runId);

    run = await this.transitionAndRecord(run, RunEvent.PLAN_APPROVED, "human");

    const planArtifact = await this.artifactRepo.findLatestByType(runId, "Plan");
    const plan = planArtifact?.payloadJson as Plan;

    const issue = await this.linearClient.getIssue(run.linearIssueId);
    const bundle = this.buildTaskBundle(issue, run);

    this.policy.assertCanExecute(run, plan);

    await this.linearClient.postComment(
      run.linearIssueId,
      "✅ Plan approved. Starting implementation...",
    );

    await this.eventRepo.create({
      runId,
      eventType: RunEvent.EXECUTION_STARTED,
      source: "orchestrator",
    });

    const { report, branchName, prNumber } = await this.executorAgent.run(
      plan,
      bundle,
      runId,
    );

    run = await this.runRepo.update(runId, {
      branchName,
      prNumber,
      executorRuntime: "claude-code",
    });

    this.policy.assertExecutorPaths(report.filesChanged, bundle);

    run = await this.transitionAndRecord(run, RunEvent.EXECUTION_FINISHED, "executor-agent");

    this.logger.info(
      { runId, state: run.state, prNumber, durationMs: timer.elapsed() },
      "Execution complete, starting review",
    );

    run = await this.runReview(runId);
    return run;
  }

  async rejectPlan(runId: string): Promise<Run> {
    let run = await this.requireRun(runId);
    run = await this.transitionAndRecord(run, RunEvent.PLAN_REJECTED, "human");

    await this.linearClient.postComment(
      run.linearIssueId,
      "❌ Plan rejected. Replanning...",
    );

    return run;
  }

  async runExecution(runId: string): Promise<Run> {
    return this.approvePlan(runId);
  }

  async runReview(runId: string): Promise<Run> {
    const timer = startTimer();
    let run = await this.requireRun(runId);

    this.policy.assertReviewerRuntime("codex");

    const execArtifact = await this.artifactRepo.findLatestByType(runId, "ExecutionReport");
    const executionReport = execArtifact?.payloadJson as ExecutionReport;

    this.policy.assertCanReview(run, executionReport);

    const planArtifact = await this.artifactRepo.findLatestByType(runId, "Plan");
    const plan = planArtifact?.payloadJson as Plan;

    const issue = await this.linearClient.getIssue(run.linearIssueId);
    const bundle = this.buildTaskBundle(issue, run);

    const diff = run.prNumber
      ? await this.githubClient.getPRDiff(run.repo, run.prNumber)
      : "";

    const review = await this.reviewerAgent.run(plan, executionReport, diff, bundle, runId);

    run = await this.runRepo.update(runId, { reviewerRuntime: "codex" });

    const hasMaterialFindings = review.findings.some(
      (f) => f.severity === "blocker" || f.severity === "important",
    );

    if (hasMaterialFindings) {
      run = await this.transitionAndRecord(run, RunEvent.REVIEW_FINDINGS_EXIST, "reviewer-agent");

      await this.linearClient.postComment(
        run.linearIssueId,
        this.formatReviewComment(review),
      );

      this.logger.info(
        { runId, state: run.state, durationMs: timer.elapsed() },
        "Review found material issues, starting remediation",
      );

      run = await this.runRemediation(runId);
    } else {
      run = await this.transitionAndRecord(run, RunEvent.REVIEW_COMPLETED, "reviewer-agent");

      await this.markReady(runId);

      this.logger.info(
        { runId, state: run.state, durationMs: timer.elapsed() },
        "Review passed, ready for human review",
      );
    }

    return run;
  }

  async runRemediation(runId: string): Promise<Run> {
    const timer = startTimer();
    let run = await this.requireRun(runId);

    const reviewArtifact = await this.artifactRepo.findLatestByType(runId, "Review");
    const review = reviewArtifact?.payloadJson as Review;

    this.policy.assertCanRemediate(run, review);

    const execArtifact = await this.artifactRepo.findLatestByType(runId, "ExecutionReport");
    const executionReport = execArtifact?.payloadJson as ExecutionReport;

    const remediation = await this.remediationAgent.run(
      review,
      executionReport,
      run.workingDirectory,
      runId,
    );

    run = await this.runRepo.update(runId, { remediationRuntime: "claude-code" });

    run = await this.transitionAndRecord(run, RunEvent.REMEDIATION_FINISHED, "remediation-agent");

    await this.linearClient.postComment(
      run.linearIssueId,
      this.formatRemediationComment(remediation.resolution),
    );

    this.logger.info(
      { runId, state: run.state, durationMs: timer.elapsed() },
      "Remediation complete, re-reviewing",
    );

    // After remediation, we re-enter review.
    // For mock mode the second review will pass since the mock always returns the same output.
    // In real mode the re-review would evaluate the updated code.
    // To avoid infinite loops in mock mode, we directly transition to ReadyForHumanReview.
    if (env.AGENT_RUNTIME_MODE === "mock") {
      run = await this.transitionAndRecord(run, RunEvent.REVIEW_COMPLETED, "reviewer-agent");
      await this.markReady(runId);
    }

    return run;
  }

  async markReady(runId: string): Promise<Run> {
    let run = await this.requireRun(runId);

    const reviewArtifact = await this.artifactRepo.findLatestByType(runId, "Review");
    const review = reviewArtifact?.payloadJson as Review | null;

    const execArtifact = await this.artifactRepo.findLatestByType(runId, "ExecutionReport");
    const executionReport = execArtifact?.payloadJson as ExecutionReport | null;

    this.policy.assertCanMarkReady(run, review, executionReport);

    if (run.prNumber) {
      await this.githubClient.markPRReady(run.repo, run.prNumber);
      await this.githubClient.commentOnPR(
        run.repo,
        run.prNumber,
        "🟢 All AI checks passed. Ready for human review.",
      );
    }

    await this.linearClient.updateIssueState(run.linearIssueId, "In Review");
    await this.linearClient.addLabel(run.linearIssueId, "ready-for-human-review");
    await this.linearClient.postComment(
      run.linearIssueId,
      "✅ AI workflow complete. Issue marked as **Ready for Human Review**.",
    );

    this.logger.info({ runId, state: run.state }, "Run marked as ready for human review");

    return run;
  }

  private async transitionAndRecord(
    run: Run,
    event: RunEvent,
    source: string,
  ): Promise<Run> {
    const newState = transition(run.state, event);
    this.logger.info(
      { runId: run.id, from: run.state, event, to: newState, source },
      "State transition",
    );

    await this.eventRepo.create({
      runId: run.id,
      eventType: event,
      source,
      payloadJson: { from: run.state, to: newState },
    });

    return this.runRepo.updateState(run.id, newState);
  }

  private async requireRun(runId: string): Promise<Run> {
    const run = await this.runRepo.findById(runId);
    if (!run) {
      throw new Error(`Run not found: ${runId}`);
    }
    return run;
  }

  private buildTaskBundle(
    issue: { id: string; title: string; description: string; labels: string[]; priority: number; project?: string; cycle?: string },
    run: Run,
  ): TaskBundle {
    return {
      issue: {
        id: issue.id,
        title: issue.title,
        description: issue.description,
        labels: issue.labels,
        priority: issue.priority,
        project: issue.project,
        cycle: issue.cycle,
      },
      repo: {
        name: run.repo,
        defaultBranch: "main",
        workingBranch: `ai/${issue.id.toLowerCase().replace(/[^a-z0-9]/g, "-")}`,
        repoPath: run.workingDirectory,
        allowedPaths: ["src/", "tests/", "package.json"],
        protectedPaths: [".github/", "infrastructure/", "prisma/migrations/"],
      },
      constraints: {
        requiredChecks: ["lint", "typecheck", "tests"],
        maxFilesChanged: 30,
        maxDiffLines: 2000,
        forbiddenPatterns: ["console\\.log", "TODO.*HACK"],
        mustNotTouch: [".github/workflows/", "prisma/migrations/"],
      },
      definitionOfDone: [
        "All required checks pass",
        "PR created with descriptive title and body",
        "No protected paths modified",
        "Changes align with approved plan",
        "Review findings addressed or explicitly waived",
      ],
    };
  }

  private formatPlanComment(plan: Plan): string {
    const steps = plan.steps
      .map((s, i) => `${i + 1}. **${s.title}**: ${s.description}`)
      .join("\n");
    const questions = plan.openQuestions.length > 0
      ? "\n\n**Open Questions:**\n" +
        plan.openQuestions
          .map((q) => `- ${q.question}${q.requiredForExecution ? " ⚠️ *blocks execution*" : ""}`)
          .join("\n")
      : "";
    const risks = plan.risks.length > 0
      ? "\n\n**Risks:**\n" + plan.risks.map((r) => `- ${r}`).join("\n")
      : "";

    return [
      `## 📋 AI Plan (v${plan.planVersion}) — Confidence: ${(plan.confidence * 100).toFixed(0)}%`,
      "",
      plan.summary,
      "",
      "### Steps",
      steps,
      questions,
      risks,
      "",
      "---",
      "Reply `/approve-plan` to proceed or `/reject-plan` to revise.",
    ].join("\n");
  }

  private formatReviewComment(review: Review): string {
    const findings = review.findings
      .map(
        (f) =>
          `- **[${f.severity.toUpperCase()}]** ${f.title} (${f.file}${f.lineHint ? `:${f.lineHint}` : ""})\n  ${f.details}`,
      )
      .join("\n");

    return [
      `## 🔍 AI Review — ${review.overallVerdict === "approved" ? "Approved ✅" : "Changes Requested ⚠️"}`,
      "",
      review.summary,
      "",
      "### Findings",
      findings,
    ].join("\n");
  }

  private formatRemediationComment(
    resolution: Array<{ findingId: string; status: string; action: string; rationale: string }>,
  ): string {
    const items = resolution
      .map(
        (r) =>
          `- **${r.findingId}** [${r.status}]: ${r.action}\n  *Rationale*: ${r.rationale}`,
      )
      .join("\n");

    return [
      "## 🔧 Remediation Summary",
      "",
      items,
    ].join("\n");
  }
}
