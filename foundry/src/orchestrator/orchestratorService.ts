import type { Logger } from "../utils/logger.js";
import { RunEvent } from "../domain/runEvent.js";
import type { Run } from "../domain/types.js";
import type { TaskBundle } from "../schemas/taskBundle.js";
import type { Plan } from "../schemas/plan.js";
import type { PlanReview } from "../schemas/planReview.js";
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
import type { PlanReviewerAgent } from "../agents/planReviewerAgent.js";
import type { PlanReviserAgent } from "../agents/planReviserAgent.js";
import type { ExecutorAgent } from "../agents/executorAgent.js";
import type { ReviewerAgent } from "../agents/reviewerAgent.js";
import type { RemediationAgent } from "../agents/remediationAgent.js";
import type { RepoRegistry } from "../config/repoRegistry.js";
import type { LinearSyncService } from "../sync/linearSync.js";
import type { GitHubSyncService } from "../sync/githubSync.js";
import type { RunEventEmitter } from "../api/runEventEmitter.js";
import { startTimer } from "../utils/time.js";

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
  repoRegistry: RepoRegistry;
  linearSync: LinearSyncService;
  githubSync: GitHubSyncService;
  plannerAgent: PlannerAgent;
  planReviewerAgent: PlanReviewerAgent;
  planReviserAgent: PlanReviserAgent;
  executorAgent: ExecutorAgent;
  reviewerAgent: ReviewerAgent;
  remediationAgent: RemediationAgent;
  logger: Logger;
  dashboardEmitter?: RunEventEmitter;
}

export class OrchestratorService {
  private readonly runRepo: RunRepository;
  private readonly artifactRepo: ArtifactRepository;
  private readonly eventRepo: EventRepository;
  private readonly linearClient: LinearClient;
  private readonly githubClient: GitHubClient;
  private readonly repoRegistry: RepoRegistry;
  private readonly linearSync: LinearSyncService;
  private readonly githubSync: GitHubSyncService;
  private readonly plannerAgent: PlannerAgent;
  private readonly planReviewerAgent: PlanReviewerAgent;
  private readonly planReviserAgent: PlanReviserAgent;
  private readonly executorAgent: ExecutorAgent;
  private readonly reviewerAgent: ReviewerAgent;
  private readonly remediationAgent: RemediationAgent;
  private readonly policy = new PolicyEngine();
  private readonly logger: Logger;
  private readonly dashboardEmitter?: RunEventEmitter;

  constructor(deps: OrchestratorDeps) {
    this.runRepo = deps.runRepo;
    this.artifactRepo = deps.artifactRepo;
    this.eventRepo = deps.eventRepo;
    this.linearClient = deps.linearClient;
    this.githubClient = deps.githubClient;
    this.repoRegistry = deps.repoRegistry;
    this.linearSync = deps.linearSync;
    this.githubSync = deps.githubSync;
    this.plannerAgent = deps.plannerAgent;
    this.planReviewerAgent = deps.planReviewerAgent;
    this.planReviserAgent = deps.planReviserAgent;
    this.executorAgent = deps.executorAgent;
    this.reviewerAgent = deps.reviewerAgent;
    this.remediationAgent = deps.remediationAgent;
    this.logger = deps.logger;
    this.dashboardEmitter = deps.dashboardEmitter;
  }

  getRunRepo(): RunRepository {
    return this.runRepo;
  }

  getArtifactRepo(): ArtifactRepository {
    return this.artifactRepo;
  }

  getEventRepo(): EventRepository {
    return this.eventRepo;
  }

  async handleLinearWebhook(payload: WebhookPayload): Promise<void> {
    this.logger.info(
      { action: payload.action, issueId: payload.issueId },
      "Handling Linear webhook",
    );

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
        const run = await this.runRepo.findActiveByIssueId(issueId);
        if (run) {
          await this.approvePlan(run.id);
          await this.runExecution(run.id);
        }
        break;
      }
      case "reject-plan": {
        const run = await this.runRepo.findActiveByIssueId(issueId);
        if (run) await this.rejectPlan(run.id);
        break;
      }
      case "re-review": {
        const run = await this.runRepo.findActiveByIssueId(issueId);
        if (run) await this.runReview(run.id);
        break;
      }
      case "pause-ai": {
        const run = await this.runRepo.findActiveByIssueId(issueId);
        if (run) await this.transitionAndRecord(run, RunEvent.BLOCKED, "user-command");
        break;
      }
      case "resume-ai": {
        const run = await this.runRepo.findActiveByIssueId(issueId);
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

    const activeRun = await this.runRepo.findActiveByIssueId(issueId);
    if (activeRun) {
      this.logger.info(
        { issueId, existingRunId: activeRun.id, state: activeRun.state },
        "Active run already exists for this issue, returning existing run",
      );
      return activeRun;
    }

    const issue = await this.linearClient.getIssue(issueId);

    const repoEntry = this.repoRegistry.resolveForIssue(issue.project);
    const workingDirectory = this.repoRegistry.resolveWorkingDirectory(repoEntry);

    let run = await this.runRepo.create({
      linearIssueId: issueId,
      repo: repoEntry.name,
      workingDirectory,
    });

    this.dashboardEmitter?.emitRunCreated(run.id, issueId, run.repo);

    this.policy.assertCanPlan(run);

    run = await this.transitionAndRecord(run, RunEvent.RUN_REQUESTED, "orchestrator");

    const bundle = this.buildTaskBundle(issue, run);

    await this.linearClient.postComment(
      issueId,
      `AI planning started for "${issue.title}". Will produce a plan, have it AI-reviewed, then present for approval.`,
    );

    const plan = await this.plannerAgent.run(bundle, run.id);

    run = await this.runRepo.update(run.id, {
      planVersion: plan.planVersion,
      plannerRuntime: "claude-code",
    });
    run = await this.transitionAndRecord(run, RunEvent.PLAN_CREATED, "planner-agent");

    this.logger.info(
      { runId: run.id, state: run.state, durationMs: timer.elapsed() },
      "Plan created, starting AI plan review",
    );

    run = await this.runPlanReview(run.id);
    return run;
  }

  async runPlanReview(runId: string): Promise<Run> {
    const timer = startTimer();
    let run = await this.requireRun(runId);

    const planArtifact = await this.artifactRepo.findLatestByType(runId, "Plan");
    if (!planArtifact) {
      throw new Error(`No plan artifact found for run ${runId}`);
    }
    const plan = planArtifact.payloadJson as Plan;

    const issue = await this.linearClient.getIssue(run.linearIssueId);
    const bundle = this.buildTaskBundle(issue, run);

    const planReview = await this.planReviewerAgent.run(plan, bundle, runId);

    if (planReview.overallVerdict === "approved") {
      run = await this.transitionAndRecord(
        run,
        RunEvent.PLAN_REVIEW_APPROVED,
        "plan-reviewer-agent",
      );

      const planSummary = this.formatPlanComment(plan, "AI plan review: approved");
      await this.linearClient.postComment(run.linearIssueId, planSummary);

      this.logger.info(
        { runId, state: run.state, verdict: "approved", durationMs: timer.elapsed() },
        "Plan review approved, awaiting human approval",
      );
    } else {
      run = await this.transitionAndRecord(
        run,
        RunEvent.PLAN_REVIEW_CHANGES_REQUESTED,
        "plan-reviewer-agent",
      );

      await this.linearClient.postComment(
        run.linearIssueId,
        this.formatPlanReviewComment(planReview),
      );

      this.logger.info(
        {
          runId,
          state: run.state,
          verdict: "changes_requested",
          findings: planReview.findings.length,
          durationMs: timer.elapsed(),
        },
        "Plan review requested changes, starting plan revision",
      );

      run = await this.runPlanRevision(runId);
    }

    return run;
  }

  async runPlanRevision(runId: string): Promise<Run> {
    const timer = startTimer();
    let run = await this.requireRun(runId);

    const planArtifact = await this.artifactRepo.findLatestByType(runId, "Plan");
    const plan = planArtifact?.payloadJson as Plan;

    const planReviewArtifact = await this.artifactRepo.findLatestByType(runId, "PlanReview");
    const planReview = planReviewArtifact?.payloadJson as PlanReview;

    const issue = await this.linearClient.getIssue(run.linearIssueId);
    const bundle = this.buildTaskBundle(issue, run);

    const { revision, revisedPlan } = await this.planReviserAgent.run(
      plan,
      planReview,
      bundle,
      runId,
    );

    run = await this.runRepo.update(runId, {
      planVersion: revisedPlan.planVersion,
    });

    run = await this.transitionAndRecord(run, RunEvent.PLAN_REVISED, "plan-reviser-agent");

    const planSummary = this.formatPlanComment(revisedPlan, "Revised after AI review");
    const dispositionSummary = this.formatPlanRevisionComment(revision.dispositions);
    await this.linearClient.postComment(
      run.linearIssueId,
      planSummary + "\n\n" + dispositionSummary,
    );

    this.logger.info(
      {
        runId,
        state: run.state,
        revisedVersion: revisedPlan.planVersion,
        durationMs: timer.elapsed(),
      },
      "Plan revised, awaiting human approval",
    );

    return run;
  }

  async approvePlan(runId: string): Promise<Run> {
    await this.requireRun(runId);

    const planArtifact = await this.artifactRepo.findLatestByType(runId, "Plan");
    if (!planArtifact) {
      throw new Error(`No plan artifact found for run ${runId}`);
    }
    const plan = planArtifact.payloadJson as Plan;

    const runWithApproval = await this.runRepo.update(runId, {
      approvedPlanVersion: plan.planVersion,
    });

    const updatedRun = await this.transitionAndRecord(
      runWithApproval,
      RunEvent.PLAN_APPROVED,
      "human",
    );

    await this.linearClient.postComment(
      updatedRun.linearIssueId,
      `Plan v${plan.planVersion} approved. Starting implementation...`,
    );

    this.logger.info(
      { runId, approvedPlanVersion: plan.planVersion, state: updatedRun.state },
      "Plan approved",
    );

    return updatedRun;
  }

  async runExecution(runId: string): Promise<Run> {
    const timer = startTimer();
    let run = await this.requireRun(runId);

    const planArtifact = await this.artifactRepo.findLatestByType(runId, "Plan");
    const plan = planArtifact?.payloadJson as Plan;

    this.policy.assertCanExecute(run, plan);

    const issue = await this.linearClient.getIssue(run.linearIssueId);
    const bundle = this.buildTaskBundle(issue, run);

    await this.eventRepo.create({
      runId,
      eventType: RunEvent.EXECUTION_STARTED,
      source: "orchestrator",
    });

    const { report, branchName, prNumber } = await this.executorAgent.run(plan, bundle, runId, {
      existingBranch: run.branchName,
      existingPR: run.prNumber,
    });

    run = await this.runRepo.update(runId, {
      branchName,
      prNumber,
      executorRuntime: "claude-code",
    });

    this.policy.assertExecutorPaths(report.filesChanged, bundle);

    run = await this.transitionAndRecord(run, RunEvent.EXECUTION_FINISHED, "executor-agent");

    this.logger.info(
      { runId, state: run.state, prNumber, durationMs: timer.elapsed() },
      "Execution complete, starting code review",
    );

    run = await this.runReview(runId);
    return run;
  }

  async rejectPlan(runId: string): Promise<Run> {
    let run = await this.requireRun(runId);
    run = await this.transitionAndRecord(run, RunEvent.PLAN_REJECTED, "human");

    await this.linearClient.postComment(run.linearIssueId, "Plan rejected. Replanning...");

    return run;
  }

  async runReview(runId: string): Promise<Run> {
    const timer = startTimer();
    let run = await this.requireRun(runId);

    const execArtifact = await this.artifactRepo.findLatestByType(runId, "ExecutionReport");
    const executionReport = execArtifact?.payloadJson as ExecutionReport;

    this.policy.assertCanReview(run, executionReport);

    const planArtifact = await this.artifactRepo.findLatestByType(runId, "Plan");
    const plan = planArtifact?.payloadJson as Plan;

    const issue = await this.linearClient.getIssue(run.linearIssueId);
    const bundle = this.buildTaskBundle(issue, run);

    const diff = run.prNumber ? await this.githubClient.getPRDiff(run.repo, run.prNumber) : "";

    const review = await this.reviewerAgent.run(plan, executionReport, diff, bundle, runId);

    run = await this.runRepo.update(runId, { reviewerRuntime: "codex" });

    if (run.prNumber && review.findings.length > 0) {
      await this.githubSync.postReviewFindings(
        run.repo,
        run.prNumber,
        review.findings,
        review.overallVerdict,
      );
    }

    if (review.overallVerdict === "changes_requested") {
      run = await this.transitionAndRecord(
        run,
        RunEvent.REVIEW_CHANGES_REQUESTED,
        "reviewer-agent",
      );

      await this.linearClient.postComment(run.linearIssueId, this.formatCodeReviewComment(review));

      this.logger.info(
        { runId, state: run.state, verdict: review.overallVerdict, durationMs: timer.elapsed() },
        "Code review requested changes, starting remediation",
      );

      run = await this.runRemediation(runId);
    } else {
      run = await this.transitionAndRecord(run, RunEvent.REVIEW_APPROVED, "reviewer-agent");

      this.logger.info(
        { runId, state: run.state, verdict: review.overallVerdict, durationMs: timer.elapsed() },
        "Code review approved, marking ready for human review",
      );

      await this.markReady(runId);
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
      "Remediation complete, marking ready for human review",
    );

    run = await this.transitionAndRecord(run, RunEvent.REVIEW_APPROVED, "remediation-agent");
    await this.markReady(runId);
    return run;
  }

  async markReady(runId: string): Promise<Run> {
    const run = await this.requireRun(runId);

    const reviewArtifact = await this.artifactRepo.findLatestByType(runId, "Review");
    const review = reviewArtifact?.payloadJson as Review | null;

    const execArtifact = await this.artifactRepo.findLatestByType(runId, "ExecutionReport");
    const executionReport = execArtifact?.payloadJson as ExecutionReport | null;

    this.policy.assertCanMarkReady(run, review, executionReport);

    // Label sync and GitHub PR-ready are handled by the sync services
    // via transitionAndRecord(). Post the final comment only.
    await this.linearClient.postComment(
      run.linearIssueId,
      "AI workflow complete. Issue marked as **Ready for Human Review**.",
    );

    this.logger.info({ runId, state: run.state }, "Run marked as ready for human review");
    return run;
  }

  async approveHumanReview(runId: string): Promise<Run> {
    let run = await this.requireRun(runId);
    run = await this.transitionAndRecord(run, RunEvent.HUMAN_APPROVED, "human");

    await this.linearClient.postComment(
      run.linearIssueId,
      "Human review approved. Run is **Done**.",
    );

    this.logger.info({ runId, state: run.state }, "Human review approved, run complete");
    return run;
  }

  private async transitionAndRecord(run: Run, event: RunEvent, source: string): Promise<Run> {
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

    const updatedRun = await this.runRepo.updateState(run.id, newState);

    await this.linearSync.syncState(updatedRun);
    await this.githubSync.syncState(updatedRun);

    this.dashboardEmitter?.emitStateChanged(run.id, run.state, newState);

    return updatedRun;
  }

  private async requireRun(runId: string): Promise<Run> {
    const run = await this.runRepo.findById(runId);
    if (!run) throw new Error(`Run not found: ${runId}`);
    return run;
  }

  private buildTaskBundle(
    issue: {
      id: string;
      title: string;
      description: string;
      labels: string[];
      priority: number;
      project?: string;
      cycle?: string;
    },
    run: Run,
  ): TaskBundle {
    const repoEntry =
      this.repoRegistry.getRepoByName(run.repo) ?? this.repoRegistry.getDefaultRepo();

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
        name: repoEntry.name,
        defaultBranch: repoEntry.defaultBranch,
        workingBranch: `ai/${issue.id.toLowerCase().replace(/[^a-z0-9]/g, "-")}`,
        repoPath: run.workingDirectory,
        allowedPaths: repoEntry.allowedPaths,
        protectedPaths: repoEntry.protectedPaths,
      },
      constraints: repoEntry.constraints,
      definitionOfDone: [
        "All required checks pass",
        "PR created with descriptive title and body",
        "No protected paths modified",
        "Changes align with approved plan",
        "Review findings addressed or explicitly waived",
      ],
    };
  }

  private formatPlanComment(plan: Plan, statusNote?: string): string {
    const steps = plan.steps.map((s, i) => `${i + 1}. **${s.title}**: ${s.description}`).join("\n");
    const questions =
      plan.openQuestions.length > 0
        ? "\n\n**Open Questions:**\n" +
          plan.openQuestions
            .map((q) => `- ${q.question}${q.requiredForExecution ? " *blocks execution*" : ""}`)
            .join("\n")
        : "";
    const risks =
      plan.risks.length > 0 ? "\n\n**Risks:**\n" + plan.risks.map((r) => `- ${r}`).join("\n") : "";
    const status = statusNote ? `\n\n*${statusNote}*\n` : "";

    return [
      `## AI Plan (v${plan.planVersion}) -- Confidence: ${(plan.confidence * 100).toFixed(0)}%`,
      status,
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

  private formatPlanReviewComment(planReview: PlanReview): string {
    const findings = planReview.findings
      .map(
        (f) =>
          `- **[${f.severity.toUpperCase()}]** ${f.title}${f.affectedStepId ? ` (step ${f.affectedStepId})` : ""}\n  ${f.details}`,
      )
      .join("\n");

    return [
      `## AI Plan Review -- ${planReview.overallVerdict === "approved" ? "Approved" : "Changes Requested"}`,
      "",
      planReview.summary,
      "",
      "### Findings",
      findings,
    ].join("\n");
  }

  private formatPlanRevisionComment(
    dispositions: { findingId: string; status: string; rationale: string }[],
  ): string {
    const items = dispositions
      .map((d) => `- **${d.findingId}** [${d.status}]: ${d.rationale}`)
      .join("\n");

    return [
      "### Plan Revision Dispositions",
      "",
      "The lead planner reviewed each finding and decided:",
      "",
      items,
    ].join("\n");
  }

  private formatCodeReviewComment(review: Review): string {
    const findings = review.findings
      .map(
        (f) =>
          `- **[${f.severity.toUpperCase()}]** ${f.title} (${f.file}${f.lineHint ? `:${f.lineHint}` : ""})\n  ${f.details}`,
      )
      .join("\n");

    return [
      `## AI Code Review -- ${review.overallVerdict === "approved" ? "Approved" : "Changes Requested"}`,
      "",
      review.summary,
      "",
      "### Findings",
      findings,
    ].join("\n");
  }

  private formatRemediationComment(
    resolution: { findingId: string; status: string; action: string; rationale: string }[],
  ): string {
    const items = resolution
      .map((r) => `- **${r.findingId}** [${r.status}]: ${r.action}\n  *Rationale*: ${r.rationale}`)
      .join("\n");

    return ["## Remediation Summary", "", items].join("\n");
  }
}
