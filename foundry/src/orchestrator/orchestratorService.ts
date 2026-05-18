import type { Logger } from "../utils/logger.js";
import { RunEvent } from "../domain/runEvent.js";
import { RunState } from "../domain/runState.js";
import type { Run, HumanAnswer, RejectionContextPayload, SkillDocument } from "../domain/types.js";
import type { TaskBundle } from "../schemas/taskBundle.js";
import type { Plan } from "../schemas/plan.js";
import type { PlanReview } from "../schemas/planReview.js";
import type { ExecutionReport } from "../schemas/executionReport.js";
import type { Review } from "../schemas/review.js";
import type { ResearchedAnswer, ResearchedAnswers } from "../schemas/researchedAnswers.js";
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
import type { AnswerResearcherAgent } from "../agents/answerResearcherAgent.js";
import type { ExecutorAgent } from "../agents/executorAgent.js";
import type { ReviewerAgent } from "../agents/reviewerAgent.js";
import type { RemediationAgent } from "../agents/remediationAgent.js";
import type { DistillationAgent } from "../agents/distillationAgent.js";
import type { AgentSkillRepository } from "./agentSkillRepository.js";
import type { RepoRegistry } from "../config/repoRegistry.js";
import type { LinearSyncService } from "../sync/linearSync.js";
import type { GitHubSyncService } from "../sync/githubSync.js";
import type { RunEventEmitter } from "../api/runEventEmitter.js";
import type { GitService } from "../git/gitService.js";
import { startTimer } from "../utils/time.js";
import { AgentTimeoutError, PolicyError, ValidationError } from "../utils/errors.js";
import { env } from "../config/env.js";

const MAX_CLARIFICATION_ITERATIONS = 3;

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
  gitService: GitService;
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
  agentSkillRepo?: AgentSkillRepository;
  distillationAgent?: DistillationAgent;
  answerResearcherAgent?: AnswerResearcherAgent;
}

export class OrchestratorService {
  private readonly runRepo: RunRepository;
  private readonly artifactRepo: ArtifactRepository;
  private readonly eventRepo: EventRepository;
  private readonly linearClient: LinearClient;
  private readonly githubClient: GitHubClient;
  private readonly gitService: GitService;
  private readonly repoRegistry: RepoRegistry;
  private readonly linearSync: LinearSyncService;
  private readonly githubSync: GitHubSyncService;
  private readonly plannerAgent: PlannerAgent;
  private readonly planReviewerAgent: PlanReviewerAgent;
  private readonly planReviserAgent: PlanReviserAgent;
  private readonly executorAgent: ExecutorAgent;
  private readonly reviewerAgent: ReviewerAgent;
  private readonly remediationAgent: RemediationAgent;
  private readonly agentSkillRepo?: AgentSkillRepository;
  private readonly distillationAgent?: DistillationAgent;
  private readonly answerResearcherAgent?: AnswerResearcherAgent;
  private readonly policy = new PolicyEngine();
  private readonly logger: Logger;
  private readonly dashboardEmitter?: RunEventEmitter;

  constructor(deps: OrchestratorDeps) {
    this.runRepo = deps.runRepo;
    this.artifactRepo = deps.artifactRepo;
    this.eventRepo = deps.eventRepo;
    this.linearClient = deps.linearClient;
    this.githubClient = deps.githubClient;
    this.gitService = deps.gitService;
    this.repoRegistry = deps.repoRegistry;
    this.linearSync = deps.linearSync;
    this.githubSync = deps.githubSync;
    this.plannerAgent = deps.plannerAgent;
    this.planReviewerAgent = deps.planReviewerAgent;
    this.planReviserAgent = deps.planReviserAgent;
    this.executorAgent = deps.executorAgent;
    this.reviewerAgent = deps.reviewerAgent;
    this.remediationAgent = deps.remediationAgent;
    this.agentSkillRepo = deps.agentSkillRepo;
    this.distillationAgent = deps.distillationAgent;
    this.answerResearcherAgent = deps.answerResearcherAgent;
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

  getAgentSkillRepo(): AgentSkillRepository | undefined {
    return this.agentSkillRepo;
  }

  getLinearClient(): LinearClient {
    return this.linearClient;
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
        if (run) await this.rejectPlan(run.id, command.body, "linear");
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

    const repoEntry = this.repoRegistry.resolveForIssue(issue.project, issue.team);
    const workingDirectory = this.repoRegistry.resolveWorkingDirectory(repoEntry);
    this.repoRegistry.validateWorkingDirectory(workingDirectory);

    let run = await this.runRepo.create({
      linearIssueId: issueId,
      linearIssueIdentifier: issue.identifier,
      linearIssueDescription: issue.description,
      linearIssueTitle: issue.title,
      linearIssueUrl: issue.url,
      repo: repoEntry.name,
      workingDirectory,
    });

    const { worktreePath, branchName } = await this.gitService.setupRunWorktree(
      workingDirectory,
      run.id,
      repoEntry.defaultBranch,
      issue.branchName,
    );

    run = await this.runRepo.update(run.id, {
      workingDirectory: worktreePath,
      branchName,
    });

    this.dashboardEmitter?.emitRunCreated(run.id, issueId, run.repo);

    this.policy.assertCanPlan(run);

    run = await this.transitionAndRecord(run, RunEvent.RUN_REQUESTED, "orchestrator");

    const bundle = await this.buildTaskBundle(issue, run);

    await this.linearClient.postComment(
      issueId,
      `AI planning started for "${issue.title}". Will produce a plan, have it AI-reviewed, then present for approval.`,
    );

    const priorSkillsForStart = await this.retrieveSkillsForPlanning(run);
    let plan = await this.plannerAgent.run(bundle, run.id, { priorSkills: priorSkillsForStart });

    run = await this.runRepo.update(run.id, {
      planVersion: plan.planVersion,
      plannerRuntime: "claude-code",
    });

    // Persist the task bundle as an immutable artifact for later re-use.
    // Done up-front (regardless of blocking-question branch) so the answer
    // researcher and any later re-plan helpers can rely on it being present.
    await this.ensureTaskBundleArtifact(run.id, bundle);

    // Run the answer researcher (best-effort, at most once per run) and
    // possibly re-plan with researched answers before deciding clarification.
    ({ run, plan } = await this.maybeResearchAndReplan(run, plan, bundle));

    // Check for blocking open questions on the (possibly revised) plan
    const blockingQuestions = plan.openQuestions.filter((q) => q.requiredForExecution);
    if (blockingQuestions.length > 0) {
      run = await this.transitionAndRecord(run, RunEvent.PLAN_CREATED, "planner-agent");
      run = await this.transitionAndRecord(
        run,
        RunEvent.NEEDS_HUMAN_CLARIFICATION,
        "planner-agent",
        {
          blockingQuestions: blockingQuestions.map((q) => ({
            id: q.id,
            question: q.question,
          })),
        },
      );

      this.logger.info(
        {
          runId: run.id,
          state: run.state,
          blockingCount: blockingQuestions.length,
          durationMs: timer.elapsed(),
        },
        "Plan has blocking questions, pausing for human clarification",
      );

      return run;
    }

    run = await this.transitionAndRecord(run, RunEvent.PLAN_CREATED, "planner-agent");

    this.logger.info(
      { runId: run.id, state: run.state, durationMs: timer.elapsed() },
      "Plan created, starting AI plan review",
    );

    run = await this.runPlanReview(run.id);
    return run;
  }

  async runPlanning(runId: string): Promise<Run> {
    const timer = startTimer();
    let run = await this.requireRun(runId);

    this.logger.info({ runId, state: run.state }, "Retrying planning stage");

    const issue = await this.linearClient.getIssue(run.linearIssueId);
    const bundle = await this.buildTaskBundle(issue, run);

    await this.ensureTaskBundleArtifact(run.id, bundle);

    const rejectionArtifact = await this.artifactRepo.findLatestByType(runId, "RejectionContext");
    const rejectionContext = rejectionArtifact?.payloadJson as RejectionContextPayload | undefined;

    const previousPlanArtifact = await this.artifactRepo.findLatestByType(runId, "Plan");
    const previousPlan = previousPlanArtifact?.payloadJson as Plan | undefined;

    const humanAnswersArtifact = await this.artifactRepo.findLatestByType(runId, "HumanAnswers");
    const humanAnswersPayload = humanAnswersArtifact?.payloadJson as
      | { answers: HumanAnswer[] }
      | undefined;

    const researchedAnswersArtifact = await this.artifactRepo.findLatestByType(
      runId,
      "ResearchedAnswers",
    );
    const researchedAnswersPayload = researchedAnswersArtifact?.payloadJson as
      | ResearchedAnswers
      | undefined;

    const planReviewArtifact = await this.artifactRepo.findLatestByType(runId, "PlanReview");
    const planReview = planReviewArtifact?.payloadJson as
      | {
          summary: string;
          findings: { id: string; severity: string; title: string; details: string }[];
        }
      | undefined;

    const nextPlanVersion = run.planVersion + 1;

    let plan = await this.plannerAgent.run(bundle, run.id, {
      planVersionOverride: nextPlanVersion,
      ...(previousPlan ? { previousPlan } : {}),
      ...(rejectionContext
        ? {
            humanFeedback: {
              planVersion: rejectionContext.planVersion,
              feedback: rejectionContext.feedback,
            },
          }
        : {}),
      ...(humanAnswersPayload?.answers?.length
        ? { humanAnswers: humanAnswersPayload.answers }
        : {}),
      ...(researchedAnswersPayload?.answers?.length
        ? { researchedAnswers: researchedAnswersPayload.answers }
        : {}),
      ...(planReview
        ? { planReviewFindings: { summary: planReview.summary, findings: planReview.findings } }
        : {}),
    });

    run = await this.runRepo.update(run.id, {
      planVersion: plan.planVersion,
      plannerRuntime: "claude-code",
    });

    // Best-effort answer research (loop-guarded by artifact existence)
    ({ run, plan } = await this.maybeResearchAndReplan(run, plan, bundle));

    const blockingQuestions = plan.openQuestions.filter((q) => q.requiredForExecution);
    if (blockingQuestions.length > 0) {
      run = await this.transitionAndRecord(run, RunEvent.PLAN_CREATED, "planner-agent");
      run = await this.transitionAndRecord(
        run,
        RunEvent.NEEDS_HUMAN_CLARIFICATION,
        "planner-agent",
        {
          blockingQuestions: blockingQuestions.map((q) => ({
            id: q.id,
            question: q.question,
          })),
        },
      );

      this.logger.info(
        {
          runId: run.id,
          state: run.state,
          blockingCount: blockingQuestions.length,
          durationMs: timer.elapsed(),
        },
        "Re-plan has blocking questions, pausing for human clarification",
      );
      return run;
    }

    run = await this.transitionAndRecord(run, RunEvent.PLAN_CREATED, "planner-agent");

    this.logger.info(
      { runId: run.id, state: run.state, durationMs: timer.elapsed() },
      "Planning retry complete, starting AI plan review",
    );

    run = await this.runPlanReview(run.id);
    return run;
  }

  async retryRun(runId: string): Promise<Run> {
    const timer = startTimer();
    let run = await this.requireRun(runId);

    this.logger.info({ runId, state: run.state }, "Retrying run from Todo");

    const issue = await this.linearClient.getIssue(run.linearIssueId);

    if (!run.branchName) {
      const repoEntry =
        this.repoRegistry.getRepoByName(run.repo) ?? this.repoRegistry.getDefaultRepo();
      const mainWorkingDir = this.gitService.resolveMainRepoPath(run.workingDirectory);

      const { worktreePath, branchName } = await this.gitService.setupRunWorktree(
        mainWorkingDir,
        run.id,
        repoEntry.defaultBranch,
        issue.branchName,
      );

      run = await this.runRepo.update(run.id, {
        workingDirectory: worktreePath,
        branchName,
      });
    }

    run = await this.transitionAndRecord(run, RunEvent.RUN_REQUESTED, "orchestrator");
    const bundle = await this.buildTaskBundle(issue, run);

    const priorSkillsForRetry = await this.retrieveSkillsForPlanning(run);
    let plan = await this.plannerAgent.run(bundle, run.id, { priorSkills: priorSkillsForRetry });

    run = await this.runRepo.update(run.id, {
      planVersion: plan.planVersion,
      plannerRuntime: "claude-code",
    });

    await this.ensureTaskBundleArtifact(run.id, bundle);

    ({ run, plan } = await this.maybeResearchAndReplan(run, plan, bundle));

    const blockingQuestions = plan.openQuestions.filter((q) => q.requiredForExecution);
    if (blockingQuestions.length > 0) {
      run = await this.transitionAndRecord(run, RunEvent.PLAN_CREATED, "planner-agent");
      run = await this.transitionAndRecord(
        run,
        RunEvent.NEEDS_HUMAN_CLARIFICATION,
        "planner-agent",
        {
          blockingQuestions: blockingQuestions.map((q) => ({
            id: q.id,
            question: q.question,
          })),
        },
      );

      this.logger.info(
        {
          runId: run.id,
          state: run.state,
          blockingCount: blockingQuestions.length,
          durationMs: timer.elapsed(),
        },
        "Plan has blocking questions, pausing for human clarification",
      );
      return run;
    }

    run = await this.transitionAndRecord(run, RunEvent.PLAN_CREATED, "planner-agent");

    this.logger.info(
      { runId: run.id, state: run.state, durationMs: timer.elapsed() },
      "Run retry complete, starting AI plan review",
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
    const bundle = await this.buildTaskBundle(issue, run);

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
    const bundle = await this.buildTaskBundle(issue, run);

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

    // Idempotency / crash recovery: if the executor already produced an
    // ExecutionReport for the latest run attempt but EXECUTION_FINISHED never
    // fired (e.g. process crashed between artifact persistence and state
    // transition), don't re-run the executor. Pick up where we left off by
    // recording EXECUTION_FINISHED and proceeding to code review. Otherwise
    // we would duplicate work, push redundant commits, and risk a timeout.
    const existingReport = await this.artifactRepo.findLatestByType(runId, "ExecutionReport");
    if (existingReport && run.prNumber) {
      const events = await this.eventRepo.findByRunId(runId);
      const lastStarted = [...events]
        .reverse()
        .find((e) => e.eventType === RunEvent.EXECUTION_STARTED);
      const lastFinished = [...events]
        .reverse()
        .find((e) => e.eventType === RunEvent.EXECUTION_FINISHED);

      const reportAfterLastStart =
        !!lastStarted && existingReport.createdAt > lastStarted.createdAt;
      const noFinishAfterReport =
        !lastFinished || lastFinished.createdAt < existingReport.createdAt;

      if (reportAfterLastStart && noFinishAfterReport) {
        this.logger.warn(
          {
            runId,
            reportCreatedAt: existingReport.createdAt,
            prNumber: run.prNumber,
          },
          "Recovered stranded execution: ExecutionReport exists but EXECUTION_FINISHED was never recorded. Skipping executor and transitioning to AIReview.",
        );

        run = await this.transitionAndRecord(
          run,
          RunEvent.EXECUTION_FINISHED,
          "executor-agent",
          {
            recovered: true,
            reportCreatedAt: existingReport.createdAt.toISOString(),
          },
        );

        run = await this.runReview(runId);
        return run;
      }
    }

    if (run.branchName) {
      await this.gitService.assertBranch(run.workingDirectory, run.branchName);
      await this.gitService.commitAndPush(
        run.workingDirectory,
        run.branchName,
        `[AI] WIP: checkpoint before executor run`,
      );
    }

    const issue = await this.linearClient.getIssue(run.linearIssueId);
    const bundle = await this.buildTaskBundle(issue, run);

    await this.eventRepo.create({
      runId,
      eventType: RunEvent.EXECUTION_STARTED,
      source: "orchestrator",
    });

    let report: ExecutionReport;
    let prNumber: number;
    try {
      const result = await this.executorAgent.run(plan, bundle, runId, {
        existingBranch: run.branchName,
        existingPR: run.prNumber,
      });
      report = result.report;
      prNumber = result.prNumber;
    } catch (err) {
      if (err instanceof AgentTimeoutError) {
        this.logger.error(
          { runId, timeoutMs: err.timeoutMs, agent: err.agent, durationMs: timer.elapsed() },
          "Executor agent timed out",
        );

        await this.eventRepo.create({
          runId,
          eventType: "EXECUTION_TIMEOUT",
          source: "orchestrator",
          payloadJson: { agent: err.agent, timeoutMs: err.timeoutMs },
        });

        run = await this.transitionAndRecord(run, RunEvent.BLOCKED, "orchestrator", {
          reason: `Executor timed out after ${Math.round(err.timeoutMs / 60_000)}m. Increase EXECUTOR_TIMEOUT_MS or retry.`,
        });

        await this.linearClient.postComment(
          run.linearIssueId,
          `Executor timed out after ${Math.round(err.timeoutMs / 60_000)} minutes. The run has been paused — use the dashboard retry button or increase \`EXECUTOR_TIMEOUT_MS\` and retry.`,
        );

        return run;
      }
      throw err;
    }

    run = await this.runRepo.update(runId, {
      prNumber,
      executorRuntime: "claude-code",
    });

    this.policy.assertExecutorPaths(report.filesChanged, bundle);

    run = await this.transitionAndRecord(run, RunEvent.EXECUTION_FINISHED, "executor-agent");

    await this.linearClient.postComment(
      run.linearIssueId,
      this.formatExecutionReportComment(report),
    );

    this.logger.info(
      { runId, state: run.state, prNumber, durationMs: timer.elapsed() },
      "Execution complete, starting code review",
    );

    run = await this.runReview(runId);
    return run;
  }

  async rejectPlan(
    runId: string,
    context?: string,
    source: "api" | "linear" = "api",
    mode: "iterate" | "fresh" = "iterate",
  ): Promise<Run> {
    let run = await this.requireRun(runId);
    run = await this.transitionAndRecord(run, RunEvent.PLAN_REJECTED, "human", {
      ...(context ? { feedback: context } : {}),
      mode,
    });

    if (context && context.trim().length > 0) {
      const rejectionPayload: RejectionContextPayload = {
        planVersion: run.planVersion,
        feedback: context,
        source,
        mode,
      };
      await this.artifactRepo.create({
        runId: run.id,
        type: "RejectionContext",
        version: run.planVersion,
        payloadJson: rejectionPayload as unknown as object,
        rawText: JSON.stringify(rejectionPayload, null, 2),
      });
    }

    const comment =
      context && context.trim().length > 0
        ? `Plan rejected (${mode}) with feedback: ${context}\nReplanning...`
        : `Plan rejected (${mode}). Replanning...`;
    await this.linearClient.postComment(run.linearIssueId, comment);

    const issue = await this.linearClient.getIssue(run.linearIssueId);
    const bundle = await this.buildTaskBundle(issue, run);

    await this.ensureTaskBundleArtifact(run.id, bundle);

    const nextPlanVersion = run.planVersion + 1;

    // In "iterate" mode, load full prior context; in "fresh" mode, only pass feedback
    const iterateContext = mode === "iterate" ? await this.loadReplanContext(runId) : null;

    const rejectionArtifact = await this.artifactRepo.findLatestByType(runId, "RejectionContext");
    const rejectionContext = rejectionArtifact?.payloadJson as RejectionContextPayload | undefined;

    const priorSkillsForReject = await this.retrieveSkillsForPlanning(run);
    let newPlan = await this.plannerAgent.run(bundle, run.id, {
      priorSkills: priorSkillsForReject,
      planVersionOverride: nextPlanVersion,
      ...(iterateContext?.previousPlan ? { previousPlan: iterateContext.previousPlan } : {}),
      ...(rejectionContext
        ? {
            humanFeedback: {
              planVersion: rejectionContext.planVersion,
              feedback: rejectionContext.feedback,
            },
          }
        : {}),
      ...(iterateContext?.humanAnswers?.length
        ? { humanAnswers: iterateContext.humanAnswers }
        : {}),
      ...(iterateContext?.researchedAnswers?.length
        ? { researchedAnswers: iterateContext.researchedAnswers }
        : {}),
      ...(iterateContext?.planReviewFindings
        ? { planReviewFindings: iterateContext.planReviewFindings }
        : {}),
    });

    run = await this.runRepo.update(run.id, {
      planVersion: newPlan.planVersion,
      plannerRuntime: "claude-code",
    });

    // Best-effort answer research (loop-guarded; no-op if already ran for this run).
    ({ run, plan: newPlan } = await this.maybeResearchAndReplan(run, newPlan, bundle));

    const blockingQuestions = newPlan.openQuestions.filter((q) => q.requiredForExecution);
    if (blockingQuestions.length > 0) {
      run = await this.transitionAndRecord(run, RunEvent.PLAN_CREATED, "planner-agent");
      run = await this.transitionAndRecord(
        run,
        RunEvent.NEEDS_HUMAN_CLARIFICATION,
        "planner-agent",
        {
          blockingQuestions: blockingQuestions.map((q) => ({
            id: q.id,
            question: q.question,
          })),
        },
      );

      this.logger.info(
        { runId: run.id, state: run.state, blockingCount: blockingQuestions.length },
        "Re-plan after rejection has blocking questions, pausing for human clarification",
      );

      return run;
    }

    run = await this.transitionAndRecord(run, RunEvent.PLAN_CREATED, "planner-agent");

    this.logger.info(
      { runId: run.id, state: run.state },
      "Plan rejected and re-planned, starting AI plan review",
    );

    run = await this.runPlanReview(run.id);
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
    const bundle = await this.buildTaskBundle(issue, run);

    const diff = run.prNumber ? await this.githubClient.getPRDiff(run.repo, run.prNumber) : "";

    const review = await this.reviewerAgent.run(plan, executionReport, diff, bundle, runId);

    run = await this.runRepo.update(runId, { reviewerRuntime: "codex" });

    let commentMap: Record<string, number> = {};
    if (run.prNumber && review.findings.length > 0) {
      const map = await this.githubSync.postReviewFindings(
        run.repo,
        run.prNumber,
        review.findings,
        review.overallVerdict,
      );
      commentMap = Object.fromEntries(map);
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

      run = await this.runRemediation(runId, commentMap);
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

  async runRemediation(runId: string, commentMap: Record<string, number> = {}): Promise<Run> {
    const timer = startTimer();
    let run = await this.requireRun(runId);

    const reviewArtifact = await this.artifactRepo.findLatestByType(runId, "Review");
    const review = reviewArtifact?.payloadJson as Review;

    this.policy.assertCanRemediate(run, review);

    if (run.branchName) {
      await this.gitService.assertBranch(run.workingDirectory, run.branchName);
    }

    const execArtifact = await this.artifactRepo.findLatestByType(runId, "ExecutionReport");
    const executionReport = execArtifact?.payloadJson as ExecutionReport;

    const remediation = await this.remediationAgent.run(
      review,
      executionReport,
      run.workingDirectory,
      runId,
    );

    if (run.branchName) {
      await this.gitService.commitAndPush(
        run.workingDirectory,
        run.branchName,
        `[AI] Remediation: address review findings`,
      );
    }

    run = await this.runRepo.update(runId, { remediationRuntime: "claude-code" });
    run = await this.transitionAndRecord(run, RunEvent.REMEDIATION_FINISHED, "remediation-agent");

    // Post the new v2+ ExecutionReport first so the human reading top-to-bottom
    // sees the updated implementation state before the per-finding resolutions.
    await this.linearClient.postComment(
      run.linearIssueId,
      this.formatExecutionReportComment(remediation.executionReport),
    );

    await this.linearClient.postComment(
      run.linearIssueId,
      this.formatRemediationComment(remediation),
    );

    if (run.prNumber) {
      await this.githubSync.postExecutionReportUpdate(
        run.repo,
        run.prNumber,
        remediation.executionReport,
      );
      await this.githubSync.postRemediationResolutions(
        run.repo,
        run.prNumber,
        remediation.resolution,
        commentMap,
      );
    }

    this.logger.info(
      {
        runId,
        state: run.state,
        durationMs: timer.elapsed(),
        prevExecutionVersion: executionReport.executionVersion,
        newExecutionVersion: remediation.executionReport.executionVersion,
        prevScore: executionReport.score,
        newScore: remediation.executionReport.score,
        scoreDelta: remediation.executionReport.score - executionReport.score,
      },
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

  async answerQuestions(runId: string, answers: HumanAnswer[]): Promise<Run> {
    let run = await this.requireRun(runId);

    // Assert valid state
    if (
      run.state !== RunState.HumanClarificationNeeded &&
      run.state !== RunState.AwaitingPlanApproval
    ) {
      throw new PolicyError(
        `answerQuestions requires state HumanClarificationNeeded or AwaitingPlanApproval, got: ${run.state}`,
      );
    }

    // Validate that all submitted questionIds belong to the latest plan
    const planArtifact = await this.artifactRepo.findLatestByType(runId, "Plan");
    if (!planArtifact) {
      throw new Error(`No plan artifact found for run ${runId}`);
    }
    const plan = planArtifact.payloadJson as Plan;
    const validQuestionIds = new Set(plan.openQuestions.map((q) => q.id));
    for (const answer of answers) {
      if (!validQuestionIds.has(answer.questionId)) {
        throw new ValidationError(
          `Unrecognised questionId: "${answer.questionId}". Valid IDs: ${[...validQuestionIds].join(", ")}`,
        );
      }
    }

    // Persist the HumanAnswers artifact
    const humanAnswersPayload = {
      answers,
      submittedAt: new Date().toISOString(),
    };
    await this.artifactRepo.create({
      runId,
      type: "HumanAnswers",
      version: 1,
      payloadJson: humanAnswersPayload,
      rawText: JSON.stringify(humanAnswersPayload, null, 2),
    });

    // Emit the questions-answered event
    this.dashboardEmitter?.emitQuestionsAnswered(runId, answers.length);

    // AwaitingPlanApproval: record answers only, no re-planning
    if (run.state === RunState.AwaitingPlanApproval) {
      this.logger.info(
        { runId, answerCount: answers.length },
        "Answers recorded for AwaitingPlanApproval run (no re-planning)",
      );
      return run;
    }

    // HumanClarificationNeeded: validate required questions are answered, then re-plan
    const requiredQuestions = plan.openQuestions.filter((q) => q.requiredForExecution);
    const answeredIds = new Set(answers.map((a) => a.questionId));
    const missingRequired = requiredQuestions.filter((q) => !answeredIds.has(q.id));
    if (missingRequired.length > 0) {
      throw new ValidationError(
        `Missing answers for required questions: ${missingRequired.map((q) => q.id).join(", ")}`,
      );
    }

    // Transition to Planning via CLARIFICATION_PROVIDED
    run = await this.transitionAndRecord(run, RunEvent.CLARIFICATION_PROVIDED, "human");

    // Load the original TaskBundle artifact (do NOT re-fetch from Linear)
    const taskBundleArtifact = await this.artifactRepo.findLatestByType(runId, "TaskBundle");
    if (!taskBundleArtifact) {
      throw new Error(`No TaskBundle artifact found for run ${runId}`);
    }
    const taskBundle = taskBundleArtifact.payloadJson as TaskBundle;

    // Compute next plan version based on the current planVersion tracked on the run.
    // latestArtifactVersion is never updated after artifact writes, so it cannot be
    // relied upon here; planVersion is updated on every plan creation/revision.
    const nextPlanVersion = run.planVersion + 1;

    // Preserve any prior researched answers so the re-plan keeps that context
    // alongside the new human answers.
    const priorResearchedArtifact = await this.artifactRepo.findLatestByType(
      runId,
      "ResearchedAnswers",
    );
    const priorResearched = priorResearchedArtifact?.payloadJson as ResearchedAnswers | undefined;

    // Re-run the planner with human answers injected
    let newPlan = await this.plannerAgent.run(taskBundle, runId, {
      humanAnswers: answers,
      ...(priorResearched?.answers?.length ? { researchedAnswers: priorResearched.answers } : {}),
      planVersionOverride: nextPlanVersion,
    });

    run = await this.runRepo.update(runId, {
      planVersion: newPlan.planVersion,
    });

    // Best-effort answer research (loop-guarded; typically a no-op here because
    // a ResearchedAnswers artifact already exists from the initial planning pass).
    ({ run, plan: newPlan } = await this.maybeResearchAndReplan(run, newPlan, taskBundle));

    // Record PLAN_CREATED to satisfy the Planning → PlanReview state machine
    run = await this.transitionAndRecord(run, RunEvent.PLAN_CREATED, "planner-agent");

    // Check if new plan still has blocking questions
    const newBlockingQuestions = newPlan.openQuestions.filter((q) => q.requiredForExecution);
    if (newBlockingQuestions.length === 0) {
      // No blockers — proceed to plan review
      run = await this.runPlanReview(runId);
      return run;
    }

    // Still has blockers — check iteration count
    const events = await this.eventRepo.findByRunId(runId);
    const clarificationCount = events.filter(
      (e) => e.eventType === (RunEvent.NEEDS_HUMAN_CLARIFICATION as string),
    ).length;

    if (clarificationCount >= MAX_CLARIFICATION_ITERATIONS) {
      // Max iterations reached — fail the run
      run = await this.transitionAndRecord(run, RunEvent.CLARIFICATION_EXHAUSTED, "orchestrator", {
        reason: "Max clarification iterations reached with unresolved blocking questions",
      });
      this.logger.warn(
        { runId, clarificationCount, maxIterations: MAX_CLARIFICATION_ITERATIONS },
        "Clarification exhausted — run failed",
      );
      return run;
    }

    // Transition back to HumanClarificationNeeded with updated blocking questions
    run = await this.transitionAndRecord(run, RunEvent.NEEDS_HUMAN_CLARIFICATION, "planner-agent", {
      blockingQuestions: newBlockingQuestions.map((q) => ({
        id: q.id,
        question: q.question,
      })),
      iteration: clarificationCount + 1,
    });

    return run;
  }

  async runManualReReview(runId: string): Promise<Run> {
    const timer = startTimer();
    let run = await this.requireRun(runId);

    run = await this.transitionAndRecord(run, RunEvent.RE_REVIEW_REQUESTED, "human");

    const planArtifact = await this.artifactRepo.findLatestByType(runId, "Plan");
    if (!planArtifact) {
      throw new Error(`No plan artifact found for run ${runId}`);
    }
    const plan = planArtifact.payloadJson as Plan;

    const issue = await this.linearClient.getIssue(run.linearIssueId);
    const bundle = await this.buildTaskBundle(issue, run);

    const planReview = await this.planReviewerAgent.run(plan, bundle, runId);

    // Always return to AwaitingPlanApproval so the human retains control
    if (planReview.overallVerdict === "approved") {
      run = await this.transitionAndRecord(
        run,
        RunEvent.PLAN_REVIEW_APPROVED,
        "plan-reviewer-agent",
      );
    } else {
      // Even when changes are requested, go back to AwaitingPlanApproval
      // instead of auto-chaining into PlanRevision
      run = await this.transitionAndRecord(
        run,
        RunEvent.PLAN_REVIEW_APPROVED,
        "plan-reviewer-agent",
      );
    }

    this.logger.info(
      {
        runId,
        state: run.state,
        verdict: planReview.overallVerdict,
        findings: planReview.findings.length,
        durationMs: timer.elapsed(),
      },
      "Manual re-review complete, returning to human approval",
    );

    return run;
  }

  async runManualPlanRevision(runId: string): Promise<Run> {
    const timer = startTimer();
    let run = await this.requireRun(runId);

    run = await this.transitionAndRecord(run, RunEvent.RE_REVIEW_REQUESTED, "human");

    const planArtifact = await this.artifactRepo.findLatestByType(runId, "Plan");
    if (!planArtifact) {
      throw new Error(`No plan artifact found for run ${runId}`);
    }
    const plan = planArtifact.payloadJson as Plan;

    const issue = await this.linearClient.getIssue(run.linearIssueId);
    const bundle = await this.buildTaskBundle(issue, run);

    const planReview = await this.planReviewerAgent.run(plan, bundle, runId);

    if (planReview.overallVerdict === "approved") {
      run = await this.transitionAndRecord(
        run,
        RunEvent.PLAN_REVIEW_APPROVED,
        "plan-reviewer-agent",
      );

      this.logger.info(
        {
          runId,
          state: run.state,
          verdict: "approved",
          durationMs: timer.elapsed(),
        },
        "Manual plan revision: reviewer approved, no revision needed",
      );
    } else {
      run = await this.transitionAndRecord(
        run,
        RunEvent.PLAN_REVIEW_CHANGES_REQUESTED,
        "plan-reviewer-agent",
      );

      run = await this.runPlanRevision(runId);

      this.logger.info(
        {
          runId,
          state: run.state,
          verdict: "changes_requested",
          findings: planReview.findings.length,
          durationMs: timer.elapsed(),
        },
        "Manual plan revision complete, revised plan awaiting human approval",
      );
    }

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

    try {
      await this.distillationAgent?.run(runId, run);
    } catch (err) {
      this.logger.warn(
        { runId, error: err instanceof Error ? err.message : String(err) },
        "Distillation agent failed (best-effort, ignoring)",
      );
    }

    return run;
  }

  /**
   * Persist the run's `TaskBundle` artifact if (and only if) one doesn't
   * already exist. Used to consolidate the previously duplicated checks at
   * the planner call sites.
   */
  private async ensureTaskBundleArtifact(runId: string, bundle: TaskBundle): Promise<void> {
    const existing = await this.artifactRepo.findLatestByType(runId, "TaskBundle");
    if (existing) return;
    await this.artifactRepo.create({
      runId,
      type: "TaskBundle",
      version: 1,
      payloadJson: bundle as unknown as object,
      rawText: JSON.stringify(bundle, null, 2),
    });
  }

  /**
   * If the freshly created `plan` has any open questions AND the researcher is
   * available AND we haven't already produced a `ResearchedAnswers` artifact
   * for this run, invoke the researcher, persist its output, record a
   * `RESEARCH_COMPLETED` event, and re-run the planner with the researched
   * answers injected. Returns the (possibly revised) plan + run.
   *
   * Loop guard: the artifact-existence check means the researcher fires at
   * most ONCE per run lifecycle. Subsequent re-plans (e.g. after human
   * answers or plan rejection) will inject the existing ResearchedAnswers
   * via PlannerRunOptions but will NOT trigger another research pass.
   */
  private async maybeResearchAndReplan(
    run: Run,
    plan: Plan,
    bundle: TaskBundle,
  ): Promise<{ run: Run; plan: Plan }> {
    if (plan.openQuestions.length === 0) return { run, plan };
    if (!this.answerResearcherAgent) return { run, plan };

    const existing = await this.artifactRepo.findLatestByType(run.id, "ResearchedAnswers");
    if (existing) {
      this.logger.info(
        { runId: run.id, planVersion: plan.planVersion },
        "Answer researcher skipped (ResearchedAnswers artifact already exists for run)",
      );
      return { run, plan };
    }

    const humanAnswersArtifact = await this.artifactRepo.findLatestByType(run.id, "HumanAnswers");
    const humanAnswersPayload = humanAnswersArtifact?.payloadJson as
      | { answers: HumanAnswer[] }
      | undefined;

    this.logger.info(
      {
        runId: run.id,
        planVersion: plan.planVersion,
        openQuestionCount: plan.openQuestions.length,
      },
      "Triggering answer researcher for plan with open questions",
    );

    const researched = await this.answerResearcherAgent.run(plan, bundle, run.id, {
      ...(humanAnswersPayload?.answers?.length
        ? { humanAnswers: humanAnswersPayload.answers }
        : {}),
    });

    const resolvedCount = researched.answers.filter((a) => a.confidence !== "unresolved").length;
    const unresolvedCount = researched.answers.length - resolvedCount;

    await this.eventRepo.create({
      runId: run.id,
      eventType: "RESEARCH_COMPLETED",
      source: "answer-researcher-agent",
      payloadJson: {
        planVersion: plan.planVersion,
        answeredCount: researched.answers.length,
        resolvedCount,
        unresolvedCount,
      },
    });

    const nextPlanVersion = plan.planVersion + 1;
    const revisedPlan = await this.plannerAgent.run(bundle, run.id, {
      planVersionOverride: nextPlanVersion,
      previousPlan: plan,
      researchedAnswers: researched.answers,
      ...(humanAnswersPayload?.answers?.length
        ? { humanAnswers: humanAnswersPayload.answers }
        : {}),
    });

    const updatedRun = await this.runRepo.update(run.id, {
      planVersion: revisedPlan.planVersion,
      plannerRuntime: "claude-code",
    });

    this.logger.info(
      {
        runId: run.id,
        originalPlanVersion: plan.planVersion,
        revisedPlanVersion: revisedPlan.planVersion,
        originalOpenQuestionCount: plan.openQuestions.length,
        revisedOpenQuestionCount: revisedPlan.openQuestions.length,
        revisedBlockingCount: revisedPlan.openQuestions.filter((q) => q.requiredForExecution)
          .length,
      },
      "Re-planned after answer research",
    );

    return { run: updatedRun, plan: revisedPlan };
  }

  private async loadReplanContext(runId: string): Promise<{
    previousPlan?: Plan;
    humanAnswers?: HumanAnswer[];
    researchedAnswers?: ResearchedAnswer[];
    planReviewFindings?: {
      summary: string;
      findings: { id: string; severity: string; title: string; details: string }[];
    };
  }> {
    const planArtifact = await this.artifactRepo.findLatestByType(runId, "Plan");
    const previousPlan = planArtifact?.payloadJson as Plan | undefined;

    const humanAnswersArtifact = await this.artifactRepo.findLatestByType(runId, "HumanAnswers");
    const humanAnswersPayload = humanAnswersArtifact?.payloadJson as
      | { answers: HumanAnswer[] }
      | undefined;

    const researchedAnswersArtifact = await this.artifactRepo.findLatestByType(
      runId,
      "ResearchedAnswers",
    );
    const researchedAnswersPayload = researchedAnswersArtifact?.payloadJson as
      | ResearchedAnswers
      | undefined;

    const planReviewArtifact = await this.artifactRepo.findLatestByType(runId, "PlanReview");
    const planReview = planReviewArtifact?.payloadJson as
      | {
          summary: string;
          findings: { id: string; severity: string; title: string; details: string }[];
        }
      | undefined;

    return {
      previousPlan,
      humanAnswers: humanAnswersPayload?.answers,
      researchedAnswers: researchedAnswersPayload?.answers,
      planReviewFindings: planReview
        ? { summary: planReview.summary, findings: planReview.findings }
        : undefined,
    };
  }

  private async transitionAndRecord(
    run: Run,
    event: RunEvent,
    source: string,
    extraPayload?: Record<string, unknown>,
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
      payloadJson: { from: run.state, to: newState, ...extraPayload },
    });

    const updatedRun = await this.runRepo.updateState(run.id, newState);

    await this.linearSync.syncState(updatedRun);
    await this.githubSync.syncState(updatedRun);

    this.dashboardEmitter?.emitStateChanged(run.id, run.state, newState);

    if (newState === RunState.Done || newState === RunState.Failed) {
      await this.cleanupRunWorktree(updatedRun);
      await this.updateSkillMetrics(updatedRun.id, newState === RunState.Done);
    }

    return updatedRun;
  }

  private async cleanupRunWorktree(run: Run): Promise<void> {
    const mainRepoPath = this.gitService.resolveMainRepoPath(run.workingDirectory);
    if (mainRepoPath === run.workingDirectory) {
      return;
    }
    this.logger.info(
      { runId: run.id, worktreePath: run.workingDirectory, mainRepoPath },
      "Cleaning up run worktree",
    );
    await this.gitService.removeWorktree(mainRepoPath, run.workingDirectory);
  }

  private async requireRun(runId: string): Promise<Run> {
    const run = await this.runRepo.findById(runId);
    if (!run) throw new Error(`Run not found: ${runId}`);
    return run;
  }

  private async buildTaskBundle(
    issue: {
      id: string;
      title: string;
      description: string;
      branchName: string;
      labels: string[];
      priority: number;
      project?: string;
      cycle?: string;
    },
    run: Run,
  ): Promise<TaskBundle> {
    const repoEntry =
      this.repoRegistry.getRepoByName(run.repo) ?? this.repoRegistry.getDefaultRepo();

    let defaultBranch = repoEntry.defaultBranch;
    try {
      const remoteBranch = await this.githubClient.getDefaultBranch(repoEntry.name);
      if (remoteBranch !== defaultBranch) {
        this.logger.warn(
          { repo: repoEntry.name, config: defaultBranch, remote: remoteBranch },
          "Config defaultBranch differs from GitHub, using remote value",
        );
        defaultBranch = remoteBranch;
      }
    } catch (err) {
      this.logger.warn(
        { repo: repoEntry.name, error: err instanceof Error ? err.message : String(err) },
        "Failed to resolve default branch from GitHub, falling back to config value",
      );
    }

    let relatedContext: TaskBundle["relatedContext"];
    try {
      const fetched = await this.linearClient.getRelatedContext(issue.id);
      if (fetched.parent || fetched.blockers.length > 0) {
        relatedContext = fetched;
      }
    } catch (err) {
      this.logger.warn(
        {
          issueId: issue.id,
          error: err instanceof Error ? err.message : String(err),
        },
        "Failed to fetch related Linear context; proceeding without it",
      );
    }

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
        defaultBranch,
        workingBranch: run.branchName ?? issue.branchName,
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
      ...(relatedContext ? { relatedContext } : {}),
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

  private formatExecutionReportComment(report: ExecutionReport): string {
    const scorePct = (report.score * 100).toFixed(0);
    const checkIcon = (status: string): string =>
      status === "pass" ? ":white_check_mark:" : status === "fail" ? ":x:" : ":heavy_minus_sign:";
    const checkRows = (
      [
        ["Lint", report.checks.lint],
        ["Typecheck", report.checks.typecheck],
        ["Tests", report.checks.tests],
      ] as const
    )
      .map(([label, c]) => `- ${checkIcon(c.status)} **${label}** -- ${c.details}`)
      .join("\n");

    // Collapse the file list inside a <details> when there are many files to
    // keep the Linear comment scannable; <details> is rendered natively by
    // both Linear and GitHub.
    const FILE_COLLAPSE_THRESHOLD = 8;
    const filesSection =
      report.filesChanged.length === 0
        ? ""
        : report.filesChanged.length <= FILE_COLLAPSE_THRESHOLD
          ? [
              "",
              `### Files changed (${report.filesChanged.length})`,
              report.filesChanged.map((f) => `- \`${f}\``).join("\n"),
            ].join("\n")
          : [
              "",
              "<details>",
              `<summary><strong>Files changed (${report.filesChanged.length})</strong></summary>`,
              "",
              report.filesChanged.map((f) => `- \`${f}\``).join("\n"),
              "",
              "</details>",
            ].join("\n");

    const notesSection =
      report.notes.length === 0
        ? ""
        : ["", "### Notes", report.notes.map((n) => `- ${n}`).join("\n")].join("\n");

    return [
      `## Execution Report (v${report.executionVersion}) -- Score: ${scorePct}%`,
      "",
      `*${report.scoreRationale}*`,
      "",
      report.summary,
      "",
      "### Checks",
      checkRows,
      filesSection,
      notesSection,
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

  private formatRemediationComment(remediation: {
    resolution: { findingId: string; status: string; action: string; rationale: string }[];
    executionReport: { executionVersion: number; score: number; scoreRationale: string };
  }): string {
    const items = remediation.resolution
      .map((r) => `- **${r.findingId}** [${r.status}]: ${r.action}\n  *Rationale*: ${r.rationale}`)
      .join("\n");

    const { executionVersion, score, scoreRationale } = remediation.executionReport;
    const scorePct = (score * 100).toFixed(0);
    const scoreLine = `**Implementation score (v${executionVersion}): ${score.toFixed(2)} (${scorePct}%)** -- ${scoreRationale}`;

    return ["## Remediation Summary", "", scoreLine, "", items].join("\n");
  }

  private async retrieveSkillsForPlanning(run: Run): Promise<SkillDocument[]> {
    if (!this.agentSkillRepo) return [];
    const query =
      (run.linearIssueTitle ?? "") +
      " " +
      ((run as unknown as { linearIssueDescription?: string }).linearIssueDescription?.slice(
        0,
        200,
      ) ?? "");
    const skills = await this.agentSkillRepo.findTopKByRelevance(
      run.repo,
      query,
      env.MAX_SKILLS_INJECTED,
    );
    if (skills.length > 0) {
      await this.eventRepo.create({
        runId: run.id,
        eventType: "SKILL_INJECTION",
        source: "orchestrator",
        payloadJson: { skillIds: skills.map((s) => s.id) },
      });
    }
    return skills;
  }

  private async updateSkillMetrics(runId: string, success: boolean): Promise<void> {
    if (!this.agentSkillRepo) return;
    const events = await this.eventRepo.findByRunId(runId);
    const injectionEvents = events.filter((e) => e.eventType === "SKILL_INJECTION");
    if (injectionEvents.length === 0) return;

    // Collect all injected skill IDs across all injection events (initial plan + any replans),
    // deduplicating so a skill injected in multiple planning passes is only updated once.
    const seenIds = new Set<string>();
    for (const evt of injectionEvents) {
      const ids = (evt.payloadJson as { skillIds?: string[] }).skillIds ?? [];
      for (const id of ids) seenIds.add(id);
    }
    const skillIds = Array.from(seenIds);

    for (const id of skillIds) {
      try {
        let updatedSkill;
        if (success) {
          updatedSkill = await this.agentSkillRepo.incrementSuccess(id);
        } else {
          updatedSkill = await this.agentSkillRepo.incrementFailure(id);
        }
        await this.agentSkillRepo.archiveIfLowUtility(updatedSkill);
      } catch (err) {
        this.logger.warn(
          { runId, skillId: id, error: err instanceof Error ? err.message : String(err) },
          "Failed to update skill metric",
        );
      }
    }
  }
}
