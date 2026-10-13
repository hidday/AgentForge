import { describe, it, expect, vi } from "vitest";
import { OrchestratorService } from "../../src/orchestrator/orchestratorService.js";
import { RunState } from "../../src/domain/runState.js";
import { RunEvent } from "../../src/domain/runEvent.js";
import { PolicyViolationError, AgentTimeoutError } from "../../src/utils/errors.js";
import type { Run, Artifact, RunEventRecord } from "../../src/domain/types.js";
import type { Plan } from "../../src/schemas/plan.js";
import type { TaskBundle } from "../../src/schemas/taskBundle.js";
import type { ExecutionReport } from "../../src/schemas/executionReport.js";
import type { Review } from "../../src/schemas/review.js";

// ---------------------------------------------------------------------------
// This file fills coverage gaps left by the other orchestratorService.*.test.ts
// files: the Linear webhook/command dispatch surface, runPlanning, retryRun,
// runPlanRevision, approvePlan, runExecution's idempotency/timeout/policy
// branches, rejectPlan's "fresh" mode and buildTaskBundle's default-branch
// drift, runReview, runRemediation's full success path through markReady,
// the manual re-review/revision entry points, approveHumanReview (including
// the distillation best-effort try/catch), and the worktree-cleanup /
// skill-metrics bookkeeping that only runs on a Done/Failed transition.
// ---------------------------------------------------------------------------

function makeRun(overrides: Partial<Run> = {}): Run {
  return {
    id: "run-1",
    linearIssueId: "LIN-1",
    linearIssueIdentifier: null,
    linearIssueDescription: null,
    linearIssueTitle: null,
    linearIssueUrl: null,
    repo: "test-repo",
    branchName: null,
    prNumber: null,
    state: RunState.Todo,
    planVersion: 1,
    approvedPlanVersion: null,
    plannerRuntime: null,
    executorRuntime: null,
    reviewerRuntime: null,
    remediationRuntime: null,
    workingDirectory: "/tmp",
    latestArtifactVersion: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makePlan(overrides: Partial<Plan> = {}): Plan {
  return {
    planVersion: 1,
    summary: "Test plan",
    requirementsTraceability: "",
    assumptions: [],
    openQuestions: [],
    risks: [],
    steps: [{ id: "s1", title: "Step 1", description: "Do something" }],
    testPlan: "Run tests",
    confidence: 0.9,
    ...overrides,
  };
}

function makeExecutionReport(overrides: Partial<ExecutionReport> = {}): ExecutionReport {
  return {
    executionVersion: 1,
    summary: "Implementation summary",
    filesChanged: ["src/foo.ts"],
    checks: {
      lint: { status: "pass", details: "ok" },
      typecheck: { status: "pass", details: "ok" },
      tests: { status: "pass", details: "ok" },
    },
    notes: [],
    prDraftCreated: true,
    score: 0.9,
    scoreRationale: "Looks good",
    ...overrides,
  };
}

function makeArtifact(type: string, version: number, payloadJson: unknown): Artifact {
  return {
    id: `artifact-${type}-${version}-${Math.random().toString(36).slice(2, 8)}`,
    runId: "run-1",
    type: type as Artifact["type"],
    version,
    payloadJson,
    rawText: JSON.stringify(payloadJson),
    createdAt: new Date(),
  };
}

function defaultRepoEntry() {
  return {
    name: "test-repo",
    defaultBranch: "main",
    allowedPaths: ["src/"],
    protectedPaths: [] as string[],
    constraints: {
      requiredChecks: [],
      maxFilesChanged: 10,
      maxDiffLines: 500,
      forbiddenPatterns: [],
      mustNotTouch: [],
    },
  };
}

interface Store {
  run: Run;
  artifacts: Artifact[];
  events: RunEventRecord[];
}

/**
 * Store-backed fake DI, matching the TestStore pattern used in
 * orchestratorService.executionScore.test.ts: runRepo/artifactRepo/eventRepo
 * mutate a shared in-memory store so multi-step orchestrator flows (which
 * re-read state/artifacts/events across several internal calls) behave
 * consistently without having to hand-sequence mockResolvedValueOnce calls.
 */
function buildDeps(initialRun: Run, overrides: Record<string, unknown> = {}) {
  const store: Store = { run: { ...initialRun }, artifacts: [], events: [] };

  const runRepo = {
    findById: vi.fn().mockImplementation(() => Promise.resolve({ ...store.run })),
    findActiveByIssueId: vi.fn().mockResolvedValue(null),
    findAll: vi.fn(),
    create: vi.fn().mockImplementation(() => Promise.resolve({ ...store.run })),
    findByIssueId: vi.fn(),
    updateState: vi.fn().mockImplementation((_id: string, newState: RunState) => {
      store.run = { ...store.run, state: newState };
      return Promise.resolve({ ...store.run });
    }),
    update: vi.fn().mockImplementation((_id: string, fields: Partial<Run>) => {
      store.run = { ...store.run, ...fields };
      return Promise.resolve({ ...store.run });
    }),
  };

  const artifactRepo = {
    create: vi.fn().mockImplementation((params: { type: string; version: number; payloadJson: unknown }) => {
      const a = makeArtifact(params.type, params.version, params.payloadJson);
      store.artifacts.push(a);
      return Promise.resolve(a);
    }),
    findByRunId: vi.fn().mockImplementation(() => Promise.resolve([...store.artifacts])),
    findLatestByType: vi.fn().mockImplementation((_runId: string, type: string) => {
      const matches = store.artifacts.filter((a) => a.type === type);
      if (matches.length === 0) return Promise.resolve(null);
      return Promise.resolve(matches.reduce((best, cur) => (cur.version > best.version ? cur : best)));
    }),
  };

  const eventRepo = {
    create: vi.fn().mockImplementation((params: { runId: string; eventType: string; source: string; payloadJson?: unknown }) => {
      const e: RunEventRecord = {
        id: `event-${store.events.length + 1}`,
        runId: params.runId,
        eventType: params.eventType,
        source: params.source,
        payloadJson: params.payloadJson ?? {},
        createdAt: new Date(),
      };
      store.events.push(e);
      return Promise.resolve(e);
    }),
    findByRunId: vi.fn().mockImplementation(() => Promise.resolve([...store.events])),
  };

  const linearClient = {
    getIssue: vi.fn().mockResolvedValue({
      id: "LIN-1",
      title: "Test issue",
      description: "Test description",
      branchName: "ai/lin-1",
      labels: [],
      priority: 0,
    }),
    getRelatedContext: vi.fn().mockResolvedValue({ blockers: [] }),
    postComment: vi.fn().mockResolvedValue(undefined),
  };

  const githubClient = {
    getPRDiff: vi.fn().mockResolvedValue("diff content"),
    getDefaultBranch: vi.fn().mockResolvedValue("main"),
  };

  const repoRegistry = {
    resolveForIssue: vi.fn().mockReturnValue(defaultRepoEntry()),
    resolveWorkingDirectory: vi.fn().mockReturnValue("/tmp"),
    validateWorkingDirectory: vi.fn(),
    getRepoByName: vi.fn().mockReturnValue(defaultRepoEntry()),
    getDefaultRepo: vi.fn().mockReturnValue(defaultRepoEntry()),
  };

  const linearSync = { syncState: vi.fn().mockResolvedValue(undefined) };
  const githubSync = {
    syncState: vi.fn().mockResolvedValue(undefined),
    postReviewFindings: vi.fn().mockResolvedValue(new Map()),
    postRemediationResolutions: vi.fn().mockResolvedValue(undefined),
    postExecutionReportUpdate: vi.fn().mockResolvedValue(undefined),
  };

  const plannerAgent = { run: vi.fn() };
  const planReviewerAgent = { run: vi.fn() };
  const planReviserAgent = { run: vi.fn() };
  const executorAgent = { run: vi.fn() };
  const reviewerAgent = { run: vi.fn() };
  const remediationAgent = { run: vi.fn() };

  const gitService = {
    setupRunWorktree: vi.fn().mockResolvedValue({ worktreePath: "/tmp/worktree", branchName: "ai/run-1" }),
    assertBranch: vi.fn().mockResolvedValue(undefined),
    commitAndPush: vi.fn().mockResolvedValue(undefined),
    removeWorktree: vi.fn().mockResolvedValue(undefined),
    resolveMainRepoPath: vi.fn().mockReturnValue("/tmp"),
  };

  const logger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };

  const dashboardEmitter = {
    emitStateChanged: vi.fn(),
    emitArtifactCreated: vi.fn(),
    emitRunCreated: vi.fn(),
    emitQuestionsAnswered: vi.fn(),
  };

  const deps: Record<string, unknown> = {
    runRepo,
    artifactRepo,
    eventRepo,
    linearClient,
    githubClient,
    gitService,
    repoRegistry,
    linearSync,
    githubSync,
    plannerAgent,
    planReviewerAgent,
    planReviserAgent,
    executorAgent,
    reviewerAgent,
    remediationAgent,
    logger,
    dashboardEmitter,
    ...overrides,
  };

  return {
    deps,
    store,
    runRepo,
    artifactRepo,
    eventRepo,
    linearClient,
    githubClient,
    gitService,
    repoRegistry,
    linearSync,
    githubSync,
    plannerAgent,
    planReviewerAgent,
    planReviserAgent,
    executorAgent,
    reviewerAgent,
    remediationAgent,
    logger,
    dashboardEmitter,
  };
}

describe("OrchestratorService -- additional coverage", () => {
  describe("getters", () => {
    it("exposes the injected collaborators", () => {
      const agentSkillRepo = { findTopKByRelevance: vi.fn() };
      const { deps, runRepo, artifactRepo, eventRepo, linearClient } = buildDeps(makeRun(), {
        agentSkillRepo,
      });
      const svc = new OrchestratorService(deps as never);

      expect(svc.getRunRepo()).toBe(runRepo);
      expect(svc.getArtifactRepo()).toBe(artifactRepo);
      expect(svc.getEventRepo()).toBe(eventRepo);
      expect(svc.getLinearClient()).toBe(linearClient);
      expect(svc.getAgentSkillRepo()).toBe(agentSkillRepo);
    });

    it("returns undefined for agentSkillRepo when none was provided", () => {
      const { deps } = buildDeps(makeRun());
      const svc = new OrchestratorService(deps as never);
      expect(svc.getAgentSkillRepo()).toBeUndefined();
    });
  });

  describe("handleLinearWebhook", () => {
    it("delegates to handleCommand for comment.command when a command is present", async () => {
      const { deps } = buildDeps(makeRun());
      const svc = new OrchestratorService(deps as never);
      const handleCommandSpy = vi.spyOn(svc, "handleCommand").mockResolvedValue(undefined);

      await svc.handleLinearWebhook({
        action: "comment.command",
        issueId: "LIN-1",
        command: { type: "unknown", raw: "/foo" },
      });

      expect(handleCommandSpy).toHaveBeenCalledWith("LIN-1", { type: "unknown", raw: "/foo" });
    });

    it("does not call handleCommand for comment.command without a command", async () => {
      const { deps } = buildDeps(makeRun());
      const svc = new OrchestratorService(deps as never);
      const handleCommandSpy = vi.spyOn(svc, "handleCommand").mockResolvedValue(undefined);

      await svc.handleLinearWebhook({ action: "comment.command", issueId: "LIN-1" });

      expect(handleCommandSpy).not.toHaveBeenCalled();
    });

    it("is a no-op for issue.created and issue.updated", async () => {
      const { deps } = buildDeps(makeRun());
      const svc = new OrchestratorService(deps as never);

      await expect(
        svc.handleLinearWebhook({ action: "issue.created", issueId: "LIN-1" }),
      ).resolves.toBeUndefined();
      await expect(
        svc.handleLinearWebhook({ action: "issue.updated", issueId: "LIN-1" }),
      ).resolves.toBeUndefined();
    });
  });

  describe("handleCommand", () => {
    it("starts a run for both ai-plan and run-ai commands", async () => {
      const { deps } = buildDeps(makeRun());
      const svc = new OrchestratorService(deps as never);
      const startRunSpy = vi.spyOn(svc, "startRun").mockResolvedValue(makeRun());

      await svc.handleCommand("LIN-1", { type: "ai-plan" });
      await svc.handleCommand("LIN-1", { type: "run-ai" });

      expect(startRunSpy).toHaveBeenCalledTimes(2);
      expect(startRunSpy).toHaveBeenCalledWith("LIN-1");
    });

    it("approves the plan and starts execution when an active run exists for approve-plan", async () => {
      const run = makeRun({ id: "run-approve" });
      const { deps, runRepo } = buildDeps(run);
      runRepo.findActiveByIssueId.mockResolvedValue(run);
      const svc = new OrchestratorService(deps as never);
      const approveSpy = vi.spyOn(svc, "approvePlan").mockResolvedValue(run);
      const execSpy = vi.spyOn(svc, "runExecution").mockResolvedValue(run);

      await svc.handleCommand("LIN-1", { type: "approve-plan" });

      expect(approveSpy).toHaveBeenCalledWith(run.id);
      expect(execSpy).toHaveBeenCalledWith(run.id);
    });

    it("does nothing for approve-plan when there is no active run", async () => {
      const { deps, runRepo } = buildDeps(makeRun());
      runRepo.findActiveByIssueId.mockResolvedValue(null);
      const svc = new OrchestratorService(deps as never);
      const approveSpy = vi.spyOn(svc, "approvePlan").mockResolvedValue(makeRun());

      await svc.handleCommand("LIN-1", { type: "approve-plan" });

      expect(approveSpy).not.toHaveBeenCalled();
    });

    it("rejects the plan with the command body when an active run exists", async () => {
      const run = makeRun({ id: "run-reject" });
      const { deps, runRepo } = buildDeps(run);
      runRepo.findActiveByIssueId.mockResolvedValue(run);
      const svc = new OrchestratorService(deps as never);
      const rejectSpy = vi.spyOn(svc, "rejectPlan").mockResolvedValue(run);

      await svc.handleCommand("LIN-1", { type: "reject-plan", body: "needs more detail" });

      expect(rejectSpy).toHaveBeenCalledWith(run.id, "needs more detail", "linear");
    });

    it("does nothing for reject-plan when there is no active run", async () => {
      const { deps, runRepo } = buildDeps(makeRun());
      runRepo.findActiveByIssueId.mockResolvedValue(null);
      const svc = new OrchestratorService(deps as never);
      const rejectSpy = vi.spyOn(svc, "rejectPlan").mockResolvedValue(makeRun());

      await svc.handleCommand("LIN-1", { type: "reject-plan" });

      expect(rejectSpy).not.toHaveBeenCalled();
    });

    it("re-runs review when an active run exists for re-review", async () => {
      const run = makeRun({ id: "run-rereview" });
      const { deps, runRepo } = buildDeps(run);
      runRepo.findActiveByIssueId.mockResolvedValue(run);
      const svc = new OrchestratorService(deps as never);
      const reviewSpy = vi.spyOn(svc, "runReview").mockResolvedValue(run);

      await svc.handleCommand("LIN-1", { type: "re-review" });

      expect(reviewSpy).toHaveBeenCalledWith(run.id);
    });

    it("does nothing for re-review when there is no active run", async () => {
      const { deps, runRepo } = buildDeps(makeRun());
      runRepo.findActiveByIssueId.mockResolvedValue(null);
      const svc = new OrchestratorService(deps as never);
      const reviewSpy = vi.spyOn(svc, "runReview").mockResolvedValue(makeRun());

      await svc.handleCommand("LIN-1", { type: "re-review" });

      expect(reviewSpy).not.toHaveBeenCalled();
    });

    it("transitions an active run to AIBlocked for pause-ai", async () => {
      const run = makeRun({ id: "run-pause", state: RunState.Implementing });
      const { deps, runRepo } = buildDeps(run);
      runRepo.findActiveByIssueId.mockResolvedValue(run);
      const svc = new OrchestratorService(deps as never);

      await svc.handleCommand("LIN-1", { type: "pause-ai" });

      expect(runRepo.updateState).toHaveBeenCalledWith(run.id, RunState.AIBlocked);
    });

    it("does nothing for pause-ai when there is no active run", async () => {
      const { deps, runRepo } = buildDeps(makeRun());
      runRepo.findActiveByIssueId.mockResolvedValue(null);
      const svc = new OrchestratorService(deps as never);

      await svc.handleCommand("LIN-1", { type: "pause-ai" });

      expect(runRepo.updateState).not.toHaveBeenCalled();
    });

    it("resets an active run to Todo for resume-ai", async () => {
      const run = makeRun({ id: "run-resume", state: RunState.AIBlocked });
      const { deps, runRepo } = buildDeps(run);
      runRepo.findActiveByIssueId.mockResolvedValue(run);
      const svc = new OrchestratorService(deps as never);

      await svc.handleCommand("LIN-1", { type: "resume-ai" });

      expect(runRepo.updateState).toHaveBeenCalledWith(run.id, RunState.Todo);
    });

    it("does nothing for resume-ai when there is no active run", async () => {
      const { deps, runRepo } = buildDeps(makeRun());
      runRepo.findActiveByIssueId.mockResolvedValue(null);
      const svc = new OrchestratorService(deps as never);

      await svc.handleCommand("LIN-1", { type: "resume-ai" });

      expect(runRepo.updateState).not.toHaveBeenCalled();
    });

    it("logs a warning and performs no action for an unknown command", async () => {
      const { deps, runRepo, logger } = buildDeps(makeRun());
      const svc = new OrchestratorService(deps as never);

      await svc.handleCommand("LIN-1", { type: "unknown", raw: "/bogus" });

      expect(runRepo.updateState).not.toHaveBeenCalled();
      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ issueId: "LIN-1" }),
        "Unknown command received",
      );
    });
  });

  describe("startRun", () => {
    it("returns the existing active run without creating a new one", async () => {
      const existing = makeRun({ id: "run-existing", state: RunState.Planning });
      const { deps, runRepo, linearClient } = buildDeps(existing);
      runRepo.findActiveByIssueId.mockResolvedValue(existing);
      const svc = new OrchestratorService(deps as never);

      const result = await svc.startRun("LIN-1");

      expect(result).toEqual(existing);
      expect(runRepo.create).not.toHaveBeenCalled();
      expect(linearClient.getIssue).not.toHaveBeenCalled();
    });
  });

  describe("requireRun guard", () => {
    it("throws a descriptive error when the run does not exist", async () => {
      const { deps, runRepo } = buildDeps(makeRun());
      runRepo.findById.mockResolvedValue(null);
      const svc = new OrchestratorService(deps as never);

      await expect(svc.runPlanning("missing-run")).rejects.toThrow("Run not found: missing-run");
    });
  });

  describe("runPlanning", () => {
    it("injects prior plan/feedback/answers/review context into the planner and proceeds to AwaitingPlanApproval", async () => {
      const run = makeRun({ id: "run-1", state: RunState.Planning, planVersion: 1 });
      const { deps, store, plannerAgent, planReviewerAgent, linearClient } = buildDeps(run);

      store.artifacts.push(
        makeArtifact("RejectionContext", 1, {
          planVersion: 1,
          feedback: "fix the auth flow",
          source: "api",
          mode: "iterate",
        }),
      );
      store.artifacts.push(makeArtifact("Plan", 1, makePlan({ planVersion: 1 })));
      store.artifacts.push(
        makeArtifact("HumanAnswers", 1, { answers: [{ questionId: "q1", answer: "yes" }] }),
      );
      store.artifacts.push(
        makeArtifact("ResearchedAnswers", 1, {
          summary: "researched",
          answers: [
            {
              questionId: "q2",
              question: "Which DB?",
              answer: "Postgres",
              confidence: "high",
            },
          ],
          completedAt: "2026-01-01T00:00:00Z",
        }),
      );
      store.artifacts.push(
        makeArtifact("PlanReview", 1, {
          reviewId: "pr-1",
          summary: "prior review summary",
          findings: [
            { id: "f1", severity: "important", type: "x", title: "t", details: "d" },
          ],
          overallVerdict: "changes_requested",
        }),
      );

      plannerAgent.run.mockImplementation(async () => {
        const plan = makePlan({ planVersion: 2, openQuestions: [] });
        store.artifacts.push(makeArtifact("Plan", 2, plan));
        return plan;
      });
      planReviewerAgent.run.mockResolvedValue({
        reviewId: "pr-2",
        summary: "looks good",
        findings: [],
        overallVerdict: "approved",
      });

      const svc = new OrchestratorService(deps as never);
      const result = await svc.runPlanning(run.id);

      expect(plannerAgent.run).toHaveBeenCalledWith(
        expect.anything(),
        run.id,
        expect.objectContaining({
          planVersionOverride: 2,
          previousPlan: expect.objectContaining({ planVersion: 1 }),
          humanFeedback: { planVersion: 1, feedback: "fix the auth flow" },
          humanAnswers: [{ questionId: "q1", answer: "yes" }],
          researchedAnswers: expect.arrayContaining([
            expect.objectContaining({ questionId: "q2" }),
          ]),
          planReviewFindings: expect.objectContaining({ summary: "prior review summary" }),
        }),
      );
      expect(result.state).toBe(RunState.AwaitingPlanApproval);
      const taskBundleCreate = (
        deps.artifactRepo as { create: ReturnType<typeof vi.fn> }
      ).create.mock.calls.find((c: unknown[]) => (c[0] as { type: string }).type === "TaskBundle");
      expect(taskBundleCreate).toBeDefined();
      expect(linearClient.postComment).toHaveBeenCalled();
    });

    it("pauses for human clarification when the re-plan still has blocking questions", async () => {
      const run = makeRun({ id: "run-1", state: RunState.Planning, planVersion: 1 });
      const { deps, store, plannerAgent, planReviewerAgent } = buildDeps(run);

      plannerAgent.run.mockImplementation(async () => {
        const plan = makePlan({
          planVersion: 2,
          openQuestions: [{ id: "q1", question: "Which provider?", requiredForExecution: true }],
        });
        store.artifacts.push(makeArtifact("Plan", 2, plan));
        return plan;
      });

      const svc = new OrchestratorService(deps as never);
      const result = await svc.runPlanning(run.id);

      expect(result.state).toBe(RunState.HumanClarificationNeeded);
      expect(planReviewerAgent.run).not.toHaveBeenCalled();
    });
  });

  describe("retryRun", () => {
    it("skips worktree setup when the run already has a branchName, and proceeds to AwaitingPlanApproval", async () => {
      const run = makeRun({
        id: "run-1",
        state: RunState.Todo,
        branchName: "ai/run-1-existing",
        planVersion: 1,
      });
      const { deps, store, plannerAgent, planReviewerAgent, gitService } = buildDeps(run);

      plannerAgent.run.mockImplementation(async () => {
        const plan = makePlan({ planVersion: 1, openQuestions: [] });
        store.artifacts.push(makeArtifact("Plan", 1, plan));
        return plan;
      });
      planReviewerAgent.run.mockResolvedValue({
        reviewId: "pr-1",
        summary: "ok",
        findings: [],
        overallVerdict: "approved",
      });

      const svc = new OrchestratorService(deps as never);
      const result = await svc.retryRun(run.id);

      expect(gitService.setupRunWorktree).not.toHaveBeenCalled();
      expect(result.state).toBe(RunState.AwaitingPlanApproval);
    });

    it("sets up a new worktree when branchName is missing, falling back to the registry default repo", async () => {
      const run = makeRun({ id: "run-1", state: RunState.Todo, branchName: null, planVersion: 1 });
      const { deps, store, plannerAgent, repoRegistry, gitService } = buildDeps(run);
      repoRegistry.getRepoByName.mockReturnValue(undefined);

      plannerAgent.run.mockImplementation(async () => {
        const plan = makePlan({
          planVersion: 1,
          openQuestions: [{ id: "q1", question: "Blocking?", requiredForExecution: true }],
        });
        store.artifacts.push(makeArtifact("Plan", 1, plan));
        return plan;
      });

      const svc = new OrchestratorService(deps as never);
      const result = await svc.retryRun(run.id);

      expect(gitService.setupRunWorktree).toHaveBeenCalledWith(
        "/tmp",
        run.id,
        "main",
        "ai/lin-1",
      );
      expect(repoRegistry.getDefaultRepo).toHaveBeenCalled();
      expect(result.state).toBe(RunState.HumanClarificationNeeded);
    });
  });

  describe("runPlanReview", () => {
    it("throws when no Plan artifact exists for the run", async () => {
      const run = makeRun({ id: "run-1", state: RunState.PlanReview });
      const { deps } = buildDeps(run);
      const svc = new OrchestratorService(deps as never);

      await expect(svc.runPlanReview(run.id)).rejects.toThrow(
        `No plan artifact found for run ${run.id}`,
      );
    });
  });

  describe("runPlanRevision", () => {
    it("revises the plan with an operator note, transitions to AwaitingPlanApproval, and posts a combined comment", async () => {
      const run = makeRun({ id: "run-1", state: RunState.PlanRevision, planVersion: 2 });
      const { deps, planReviserAgent, linearClient } = buildDeps(run);

      const plan = makePlan({
        planVersion: 2,
        risks: ["Unclear ownership"],
        openQuestions: [{ id: "q1", question: "Optional?", requiredForExecution: false }],
      });
      const review: Review = {
        reviewId: "pr-1",
        summary: "needs fixes",
        findings: [{ id: "f1", severity: "important", type: "bug", file: "x.ts", title: "t", details: "d" }],
        overallVerdict: "changes_requested",
      };
      const deps2 = deps as { artifactRepo: { create: ReturnType<typeof vi.fn> } };
      await deps2.artifactRepo.create({ runId: run.id, type: "Plan", version: 2, payloadJson: plan, rawText: "{}" });
      await deps2.artifactRepo.create({ runId: run.id, type: "PlanReview", version: 1, payloadJson: review, rawText: "{}" });

      const revisedPlan = makePlan({
        planVersion: 3,
        risks: [],
        // requiredForExecution: true here exercises the "*blocks execution*"
        // comment-formatting branch; runPlanRevision itself does not re-check
        // blocking questions (that only happens after a planner run, not a
        // revision), so this is a safe, representative fixture.
        openQuestions: [{ id: "q2", question: "Still unclear?", requiredForExecution: true }],
      });
      planReviserAgent.run.mockResolvedValue({
        revision: { dispositions: [{ findingId: "f1", status: "addressed", rationale: "fixed it" }] },
        revisedPlan,
      });

      const svc = new OrchestratorService(deps as never);
      const result = await svc.runPlanRevision(run.id, { note: "please prioritize perf" });

      expect(planReviserAgent.run).toHaveBeenCalledWith(
        expect.objectContaining({ planVersion: 2 }),
        expect.objectContaining({ overallVerdict: "changes_requested" }),
        expect.anything(),
        run.id,
        { operatorNote: "please prioritize perf" },
      );
      expect(result.state).toBe(RunState.AwaitingPlanApproval);
      expect(result.planVersion).toBe(3);
      const comment = (linearClient.postComment.mock.calls as unknown[][]).find(
        (c) => typeof c[1] === "string" && (c[1] as string).includes("Plan Revision Dispositions"),
      );
      expect(comment).toBeDefined();
      expect(comment![1]).toContain("fixed it");
    });
  });

  describe("approvePlan", () => {
    it("throws when no Plan artifact exists", async () => {
      const run = makeRun({ id: "run-1", state: RunState.AwaitingPlanApproval });
      const { deps } = buildDeps(run);
      const svc = new OrchestratorService(deps as never);

      await expect(svc.approvePlan(run.id)).rejects.toThrow(
        `No plan artifact found for run ${run.id}`,
      );
    });

    it("approves without a note: sets approvedPlanVersion, transitions to Implementing, posts a generic comment", async () => {
      const run = makeRun({ id: "run-1", state: RunState.AwaitingPlanApproval, planVersion: 2 });
      const { deps, store, linearClient } = buildDeps(run);
      store.artifacts.push(makeArtifact("Plan", 2, makePlan({ planVersion: 2 })));

      const svc = new OrchestratorService(deps as never);
      const result = await svc.approvePlan(run.id);

      expect(result.state).toBe(RunState.Implementing);
      expect(result.approvedPlanVersion).toBe(2);
      expect(linearClient.postComment).toHaveBeenCalledWith(
        run.linearIssueId,
        "Plan v2 approved. Starting implementation...",
      );
    });

    it("approves with an operator note: includes it in the comment and the PLAN_APPROVED event payload", async () => {
      const run = makeRun({ id: "run-1", state: RunState.AwaitingPlanApproval, planVersion: 1 });
      const { deps, store, linearClient, eventRepo } = buildDeps(run);
      store.artifacts.push(makeArtifact("Plan", 1, makePlan({ planVersion: 1 })));

      const svc = new OrchestratorService(deps as never);
      await svc.approvePlan(run.id, { note: "skip the retry logic" });

      expect(linearClient.postComment).toHaveBeenCalledWith(
        run.linearIssueId,
        expect.stringContaining("skip the retry logic"),
      );
      const approvedEvent = (eventRepo.create.mock.calls as unknown[][]).find(
        (c) => (c[0] as { eventType: string }).eventType === RunEvent.PLAN_APPROVED,
      );
      expect((approvedEvent?.[0] as { payloadJson: Record<string, unknown> }).payloadJson).toMatchObject({
        note: "skip the retry logic",
      });
    });
  });

  describe("runExecution", () => {
    it("recovers a stranded execution: skips the executor and proceeds straight to review", async () => {
      const run = makeRun({
        id: "run-1",
        state: RunState.Implementing,
        planVersion: 1,
        approvedPlanVersion: 1,
        prNumber: 7,
        branchName: "ai/run-1",
      });
      const { deps, store, executorAgent, eventRepo } = buildDeps(run);
      store.artifacts.push(makeArtifact("Plan", 1, makePlan({ planVersion: 1 })));

      const reportCreatedAt = new Date("2026-01-01T00:05:00Z");
      const report = makeArtifact("ExecutionReport", 1, makeExecutionReport());
      report.createdAt = reportCreatedAt;
      store.artifacts.push(report);
      store.events.push({
        id: "evt-started",
        runId: run.id,
        eventType: RunEvent.EXECUTION_STARTED,
        source: "orchestrator",
        payloadJson: {},
        createdAt: new Date(reportCreatedAt.getTime() - 60_000),
      });

      const svc = new OrchestratorService(deps as never);
      const runReviewSpy = vi
        .spyOn(svc, "runReview")
        .mockImplementation(async () => ({ ...store.run, state: RunState.ReadyForHumanReview }));

      const result = await svc.runExecution(run.id);

      expect(executorAgent.run).not.toHaveBeenCalled();
      expect(runReviewSpy).toHaveBeenCalledWith(run.id);
      const finishedEvent = (eventRepo.create.mock.calls as unknown[][]).find(
        (c) => (c[0] as { eventType: string }).eventType === RunEvent.EXECUTION_FINISHED,
      );
      expect((finishedEvent?.[0] as { payloadJson: Record<string, unknown> }).payloadJson).toMatchObject({
        recovered: true,
      });
      expect(result.state).toBe(RunState.ReadyForHumanReview);
    });

    it("transitions to AIBlocked and posts a comment when the executor agent times out", async () => {
      const run = makeRun({
        id: "run-1",
        state: RunState.Implementing,
        planVersion: 1,
        approvedPlanVersion: 1,
        branchName: null,
        prNumber: null,
      });
      const { deps, store, executorAgent, linearClient, eventRepo } = buildDeps(run);
      store.artifacts.push(makeArtifact("Plan", 1, makePlan({ planVersion: 1 })));
      executorAgent.run.mockRejectedValue(new AgentTimeoutError("executor", 1_800_000));

      const svc = new OrchestratorService(deps as never);
      const runReviewSpy = vi.spyOn(svc, "runReview");

      const result = await svc.runExecution(run.id);

      expect(result.state).toBe(RunState.AIBlocked);
      expect(runReviewSpy).not.toHaveBeenCalled();
      expect(linearClient.postComment).toHaveBeenCalledWith(
        run.linearIssueId,
        expect.stringContaining("Executor timed out after 30 minutes"),
      );
      const timeoutEvent = (eventRepo.create.mock.calls as unknown[][]).find(
        (c) => (c[0] as { eventType: string }).eventType === "EXECUTION_TIMEOUT",
      );
      expect((timeoutEvent?.[0] as { payloadJson: Record<string, unknown> }).payloadJson).toMatchObject({
        agent: "executor",
        timeoutMs: 1_800_000,
      });
    });

    it("rethrows non-timeout errors raised by the executor agent", async () => {
      const run = makeRun({
        id: "run-1",
        state: RunState.Implementing,
        planVersion: 1,
        approvedPlanVersion: 1,
        branchName: null,
        prNumber: null,
      });
      const { deps, store, executorAgent } = buildDeps(run);
      store.artifacts.push(makeArtifact("Plan", 1, makePlan({ planVersion: 1 })));
      executorAgent.run.mockRejectedValue(new Error("boom"));

      const svc = new OrchestratorService(deps as never);
      await expect(svc.runExecution(run.id)).rejects.toThrow("boom");
    });

    it("throws a PolicyViolationError when the executor touches a protected path", async () => {
      const run = makeRun({
        id: "run-1",
        state: RunState.Implementing,
        planVersion: 1,
        approvedPlanVersion: 1,
        branchName: null,
        prNumber: null,
      });
      const { deps, store, executorAgent, repoRegistry } = buildDeps(run);
      store.artifacts.push(makeArtifact("Plan", 1, makePlan({ planVersion: 1 })));
      repoRegistry.getRepoByName.mockReturnValue({
        name: "test-repo",
        defaultBranch: "main",
        allowedPaths: ["src/"],
        protectedPaths: ["secrets/"],
        constraints: {
          requiredChecks: [],
          maxFilesChanged: 10,
          maxDiffLines: 500,
          forbiddenPatterns: [],
          mustNotTouch: [],
        },
      });
      executorAgent.run.mockResolvedValue({
        report: makeExecutionReport({ filesChanged: ["secrets/key.txt"] }),
        prNumber: 55,
      });

      const svc = new OrchestratorService(deps as never);
      await expect(svc.runExecution(run.id)).rejects.toThrow(PolicyViolationError);
    });

    it("happy path: commits a checkpoint, posts a collapsed report with notes, and proceeds to review", async () => {
      const run = makeRun({
        id: "run-1",
        state: RunState.Implementing,
        planVersion: 1,
        approvedPlanVersion: 1,
        branchName: "ai/run-1",
        prNumber: null,
      });
      const { deps, store, executorAgent, gitService, linearClient } = buildDeps(run);
      store.artifacts.push(makeArtifact("Plan", 1, makePlan({ planVersion: 1 })));

      const manyFiles = Array.from({ length: 9 }, (_, i) => `src/file${i}.ts`);
      executorAgent.run.mockResolvedValue({
        report: makeExecutionReport({
          filesChanged: manyFiles,
          notes: ["Had to refactor the config loader"],
          score: 0.95,
          // A failing check exercises the ":x:" icon branch of the comment
          // formatter; runExecution itself does not gate on check status, so
          // this does not change the control flow under test.
          checks: {
            lint: { status: "pass", details: "ok" },
            typecheck: { status: "fail", details: "one type error" },
            tests: { status: "pass", details: "ok" },
          },
        }),
        prNumber: 101,
      });

      const svc = new OrchestratorService(deps as never);
      const runReviewSpy = vi
        .spyOn(svc, "runReview")
        .mockImplementation(async () => ({ ...store.run, state: RunState.AIReview }));

      const result = await svc.runExecution(run.id);

      expect(gitService.assertBranch).toHaveBeenCalledWith(run.workingDirectory, "ai/run-1");
      expect(gitService.commitAndPush).toHaveBeenCalledWith(
        run.workingDirectory,
        "ai/run-1",
        expect.stringContaining("checkpoint"),
      );
      expect(result.prNumber).toBe(101);
      const reportComment = (linearClient.postComment.mock.calls as unknown[][]).find(
        (c) => typeof c[1] === "string" && (c[1] as string).includes("Execution Report"),
      );
      expect(reportComment![1]).toContain("<details>");
      expect(reportComment![1]).toContain("Had to refactor the config loader");
      expect(runReviewSpy).toHaveBeenCalledWith(run.id);
    });
  });

  describe("rejectPlan -- fresh mode, blocking re-plans, and buildTaskBundle branch drift", () => {
    it("fresh mode omits prior plan/answers/review context but keeps the rejection feedback", async () => {
      const run = makeRun({ id: "run-1", state: RunState.AwaitingPlanApproval, planVersion: 3 });
      const { deps, store, plannerAgent, linearClient } = buildDeps(run);
      store.artifacts.push(makeArtifact("Plan", 3, makePlan({ planVersion: 3 })));

      plannerAgent.run.mockImplementation(async () => {
        const plan = makePlan({ planVersion: 4, openQuestions: [] });
        store.artifacts.push(makeArtifact("Plan", 4, plan));
        return plan;
      });

      const svc = new OrchestratorService(deps as never);
      const runPlanReviewSpy = vi
        .spyOn(svc, "runPlanReview")
        .mockImplementation(async () => ({ ...store.run, state: RunState.PlanReview }));

      await svc.rejectPlan(run.id, "start over with a simpler design", "api", "fresh");

      const plannerCall = plannerAgent.run.mock.calls[0];
      const opts = plannerCall[2] as Record<string, unknown>;
      expect(opts).not.toHaveProperty("previousPlan");
      expect(opts).not.toHaveProperty("humanAnswers");
      expect(opts).not.toHaveProperty("researchedAnswers");
      expect(opts).not.toHaveProperty("planReviewFindings");
      expect(opts.humanFeedback).toMatchObject({
        planVersion: 3,
        feedback: "start over with a simpler design",
      });
      expect(linearClient.postComment).toHaveBeenCalledWith(
        run.linearIssueId,
        expect.stringContaining("Plan rejected (fresh) with feedback:"),
      );
      expect(runPlanReviewSpy).toHaveBeenCalledWith(run.id);
    });

    it("pauses for human clarification when the re-plan after rejection still has blocking questions", async () => {
      const run = makeRun({ id: "run-1", state: RunState.AwaitingPlanApproval, planVersion: 1 });
      const agentSkillRepo = { findTopKByRelevance: vi.fn().mockResolvedValue([]) };
      const { deps, store, plannerAgent } = buildDeps(run, { agentSkillRepo });
      store.artifacts.push(makeArtifact("Plan", 1, makePlan({ planVersion: 1 })));

      plannerAgent.run.mockImplementation(async () => {
        const plan = makePlan({
          planVersion: 2,
          openQuestions: [{ id: "q1", question: "Which DB?", requiredForExecution: true }],
        });
        store.artifacts.push(makeArtifact("Plan", 2, plan));
        return plan;
      });

      const svc = new OrchestratorService(deps as never);
      const runPlanReviewSpy = vi.spyOn(svc, "runPlanReview");

      const result = await svc.rejectPlan(run.id);

      expect(result.state).toBe(RunState.HumanClarificationNeeded);
      expect(runPlanReviewSpy).not.toHaveBeenCalled();
      expect(agentSkillRepo.findTopKByRelevance).toHaveBeenCalled();
      expect(store.events.filter((e) => e.eventType === "SKILL_INJECTION")).toHaveLength(0);
    });

    it("uses the remote default branch when it differs from config, and injects relevant prior skills", async () => {
      const run = makeRun({
        id: "run-1",
        state: RunState.AwaitingPlanApproval,
        planVersion: 1,
        // A non-null description exercises the truthy branch of the optional
        // chaining used to build the skill-relevance query string.
        linearIssueDescription: "Needs OAuth2 support end to end",
      });
      const agentSkillRepo = {
        findTopKByRelevance: vi.fn().mockResolvedValue([
          {
            id: "skill-1",
            repoSlug: "test-repo",
            name: "n",
            description: "d",
            taskCategory: "cat",
            skillMarkdown: "md",
            utilityScore: 0.5,
            lastUsedAt: new Date(),
          },
        ]),
      };
      const { deps, store, plannerAgent, githubClient, logger } = buildDeps(run, { agentSkillRepo });
      store.artifacts.push(makeArtifact("Plan", 1, makePlan({ planVersion: 1 })));
      githubClient.getDefaultBranch.mockResolvedValue("trunk");

      plannerAgent.run.mockImplementation(async () => {
        const plan = makePlan({ planVersion: 2, openQuestions: [] });
        store.artifacts.push(makeArtifact("Plan", 2, plan));
        return plan;
      });

      const svc = new OrchestratorService(deps as never);
      vi.spyOn(svc, "runPlanReview").mockImplementation(async () => ({ ...store.run, state: RunState.PlanReview }));

      await svc.rejectPlan(run.id, "feedback");

      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ repo: "test-repo", config: "main", remote: "trunk" }),
        "Config defaultBranch differs from GitHub, using remote value",
      );
      const plannerCall = plannerAgent.run.mock.calls[0];
      const bundle = plannerCall[0] as TaskBundle;
      expect(bundle.repo.defaultBranch).toBe("trunk");

      const injectionEvent = store.events.find((e) => e.eventType === "SKILL_INJECTION");
      expect(injectionEvent).toBeDefined();
      expect((injectionEvent!.payloadJson as { skillIds: string[] }).skillIds).toEqual(["skill-1"]);
    });
  });

  describe("runReview", () => {
    it("throws when the run is not in AIReview state", async () => {
      const run = makeRun({ id: "run-1", state: RunState.Implementing, prNumber: 5 });
      const { deps } = buildDeps(run);
      const svc = new OrchestratorService(deps as never);

      await expect(svc.runReview(run.id)).rejects.toThrow(PolicyViolationError);
    });

    it("approved verdict fetches the PR diff and proceeds to markReady", async () => {
      const run = makeRun({ id: "run-1", state: RunState.AIReview, prNumber: 42 });
      const { deps, store, githubClient, reviewerAgent } = buildDeps(run);
      store.artifacts.push(makeArtifact("ExecutionReport", 1, makeExecutionReport()));
      store.artifacts.push(makeArtifact("Plan", 1, makePlan({ planVersion: 1 })));
      reviewerAgent.run.mockResolvedValue({
        reviewId: "r1",
        summary: "Good",
        findings: [],
        overallVerdict: "approved",
      });

      const svc = new OrchestratorService(deps as never);
      const markReadySpy = vi
        .spyOn(svc, "markReady")
        .mockImplementation(async () => ({ ...store.run, state: RunState.ReadyForHumanReview }));

      const result = await svc.runReview(run.id);

      expect(githubClient.getPRDiff).toHaveBeenCalledWith(run.repo, 42);
      expect(markReadySpy).toHaveBeenCalledWith(run.id);
      expect(result.state).toBe(RunState.ReadyForHumanReview);
      expect(store.run.reviewerRuntime).toBe("codex");
    });

    it("changes_requested verdict with findings posts GitHub review findings and triggers remediation", async () => {
      const run = makeRun({ id: "run-1", state: RunState.AIReview, prNumber: 42 });
      const { deps, store, githubSync, reviewerAgent } = buildDeps(run);
      store.artifacts.push(makeArtifact("ExecutionReport", 1, makeExecutionReport()));
      store.artifacts.push(makeArtifact("Plan", 1, makePlan({ planVersion: 1 })));
      const finding = {
        id: "f1",
        severity: "important",
        type: "bug",
        file: "src/x.ts",
        lineHint: 42,
        title: "Bug",
        details: "details",
      };
      reviewerAgent.run.mockResolvedValue({
        reviewId: "r1",
        summary: "Found issues",
        findings: [finding],
        overallVerdict: "changes_requested",
      });
      githubSync.postReviewFindings.mockResolvedValue(new Map([["f1", 999]]));

      const svc = new OrchestratorService(deps as never);
      const remediationSpy = vi
        .spyOn(svc, "runRemediation")
        .mockImplementation(async () => ({ ...store.run, state: RunState.AddressingReview }));

      const result = await svc.runReview(run.id);

      expect(githubSync.postReviewFindings).toHaveBeenCalledWith(
        run.repo,
        42,
        [finding],
        "changes_requested",
      );
      expect(remediationSpy).toHaveBeenCalledWith(run.id, { f1: 999 });
      expect(result.state).toBe(RunState.AddressingReview);
    });

    it("changes_requested verdict with no findings skips posting GitHub review findings", async () => {
      const run = makeRun({ id: "run-1", state: RunState.AIReview, prNumber: 42 });
      const { deps, store, githubSync, reviewerAgent } = buildDeps(run);
      store.artifacts.push(makeArtifact("ExecutionReport", 1, makeExecutionReport()));
      store.artifacts.push(makeArtifact("Plan", 1, makePlan({ planVersion: 1 })));
      reviewerAgent.run.mockResolvedValue({
        reviewId: "r1",
        summary: "Needs work but nothing itemized",
        findings: [],
        overallVerdict: "changes_requested",
      });

      const svc = new OrchestratorService(deps as never);
      vi.spyOn(svc, "runRemediation").mockImplementation(async () => ({ ...store.run, state: RunState.AddressingReview }));

      await svc.runReview(run.id);

      expect(githubSync.postReviewFindings).not.toHaveBeenCalled();
    });
  });

  describe("runRemediation", () => {
    it("throws when the run is not in AddressingReview state", async () => {
      const run = makeRun({ id: "run-1", state: RunState.AIReview });
      const { deps } = buildDeps(run);
      const svc = new OrchestratorService(deps as never);

      await expect(svc.runRemediation(run.id)).rejects.toThrow(PolicyViolationError);
    });

    it("full success path: commits fixes, syncs Linear/GitHub, and completes markReady", async () => {
      const run = makeRun({
        id: "run-1",
        state: RunState.AddressingReview,
        branchName: "ai/run-1",
        prNumber: 77,
        workingDirectory: "/tmp/worktree",
      });
      const { deps, gitService, githubSync, linearClient, remediationAgent } = buildDeps(run);

      const changesRequestedReview: Review = {
        reviewId: "r1",
        summary: "bug",
        findings: [{ id: "f1", severity: "important", type: "bug", file: "x.ts", title: "Bug", details: "d" }],
        overallVerdict: "changes_requested",
      };
      const approvedReview: Review = {
        reviewId: "r1",
        summary: "fixed",
        findings: [],
        overallVerdict: "approved",
      };
      const v1Report = makeExecutionReport({ executionVersion: 1, score: 0.5 });
      let reviewCalls = 0;
      const customArtifactRepo = {
        create: vi.fn().mockResolvedValue({ id: "artifact-new" }),
        findByRunId: vi.fn().mockResolvedValue([]),
        findLatestByType: vi.fn().mockImplementation((_runId: string, type: string) => {
          if (type === "Review") {
            reviewCalls += 1;
            return Promise.resolve(
              makeArtifact("Review", 1, reviewCalls === 1 ? changesRequestedReview : approvedReview),
            );
          }
          if (type === "ExecutionReport") {
            return Promise.resolve(makeArtifact("ExecutionReport", 1, v1Report));
          }
          return Promise.resolve(null);
        }),
      };
      (deps as Record<string, unknown>).artifactRepo = customArtifactRepo;

      const v2Report = makeExecutionReport({
        executionVersion: 2,
        score: 0.95,
        checks: {
          lint: { status: "pass", details: "ok" },
          typecheck: { status: "pass", details: "ok" },
          tests: { status: "pass", details: "ok" },
        },
      });
      remediationAgent.run.mockResolvedValue({
        reviewId: "r1",
        resolution: [{ findingId: "f1", status: "accepted", action: "Fixed it", rationale: "real bug" }],
        readyForHumanReview: true,
        executionReport: v2Report,
      });

      const svc = new OrchestratorService(deps as never);
      const result = await svc.runRemediation(run.id, { f1: 55 });

      expect(gitService.assertBranch).toHaveBeenCalledWith("/tmp/worktree", "ai/run-1");
      expect(gitService.commitAndPush).toHaveBeenCalledWith(
        "/tmp/worktree",
        "ai/run-1",
        expect.stringContaining("Remediation"),
      );
      expect(githubSync.postExecutionReportUpdate).toHaveBeenCalledWith(run.repo, 77, v2Report);
      expect(githubSync.postRemediationResolutions).toHaveBeenCalledWith(
        run.repo,
        77,
        expect.any(Array),
        { f1: 55 },
      );
      expect(result.state).toBe(RunState.ReadyForHumanReview);
      expect(linearClient.postComment).toHaveBeenCalledWith(
        run.linearIssueId,
        "AI workflow complete. Issue marked as **Ready for Human Review**.",
      );
    });

    it("skips git/GitHub sync calls without a branch or PR, and markReady then fails for lack of a PR", async () => {
      const run = makeRun({
        id: "run-1",
        state: RunState.AddressingReview,
        branchName: null,
        prNumber: null,
      });
      const { deps, store, gitService, githubSync, remediationAgent } = buildDeps(run);
      const review: Review = {
        reviewId: "r1",
        summary: "bug",
        findings: [{ id: "f1", severity: "important", type: "bug", file: "x.ts", title: "Bug", details: "d" }],
        overallVerdict: "changes_requested",
      };
      store.artifacts.push(makeArtifact("Review", 1, review));
      store.artifacts.push(makeArtifact("ExecutionReport", 1, makeExecutionReport({ executionVersion: 1 })));

      const v2Report = makeExecutionReport({
        executionVersion: 2,
        checks: {
          lint: { status: "pass", details: "ok" },
          typecheck: { status: "pass", details: "ok" },
          tests: { status: "pass", details: "ok" },
        },
      });
      remediationAgent.run.mockResolvedValue({
        reviewId: "r1",
        resolution: [{ findingId: "f1", status: "accepted", action: "fix", rationale: "r" }],
        readyForHumanReview: true,
        executionReport: v2Report,
      });

      const svc = new OrchestratorService(deps as never);
      let caught: unknown;
      try {
        await svc.runRemediation(run.id);
      } catch (err) {
        caught = err;
      }

      expect(caught).toBeInstanceOf(PolicyViolationError);
      expect((caught as PolicyViolationError).rule).toBe("ready_requires_pr");
      expect(gitService.assertBranch).not.toHaveBeenCalled();
      expect(gitService.commitAndPush).not.toHaveBeenCalled();
      expect(githubSync.postExecutionReportUpdate).not.toHaveBeenCalled();
      expect(githubSync.postRemediationResolutions).not.toHaveBeenCalled();
    });
  });

  describe("runManualReReview", () => {
    it("approved verdict: records RE_REVIEW_REQUESTED then PLAN_REVIEW_APPROVED, returning to AwaitingPlanApproval", async () => {
      const run = makeRun({ id: "run-1", state: RunState.AwaitingPlanApproval, planVersion: 1 });
      const { deps, store, planReviewerAgent } = buildDeps(run);
      store.artifacts.push(makeArtifact("Plan", 1, makePlan({ planVersion: 1 })));
      planReviewerAgent.run.mockResolvedValue({
        reviewId: "r1",
        summary: "Great plan",
        findings: [],
        overallVerdict: "approved",
      });

      const svc = new OrchestratorService(deps as never);
      const result = await svc.runManualReReview(run.id, { note: "double-check auth" });

      expect(planReviewerAgent.run).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        run.id,
        { operatorNote: "double-check auth" },
      );
      expect(result.state).toBe(RunState.AwaitingPlanApproval);
      const eventTypes = store.events.map((e) => e.eventType);
      expect(eventTypes).toEqual(
        expect.arrayContaining([RunEvent.RE_REVIEW_REQUESTED, RunEvent.PLAN_REVIEW_APPROVED]),
      );
    });

    it("changes_requested verdict still returns to AwaitingPlanApproval (human retains control)", async () => {
      const run = makeRun({ id: "run-1", state: RunState.AwaitingPlanApproval, planVersion: 1 });
      const { deps, store, planReviewerAgent } = buildDeps(run);
      store.artifacts.push(makeArtifact("Plan", 1, makePlan({ planVersion: 1 })));
      planReviewerAgent.run.mockResolvedValue({
        reviewId: "r1",
        summary: "Needs work",
        findings: [{ id: "f1", severity: "important", type: "x", title: "t", details: "d" }],
        overallVerdict: "changes_requested",
      });

      const svc = new OrchestratorService(deps as never);
      const result = await svc.runManualReReview(run.id);

      expect(result.state).toBe(RunState.AwaitingPlanApproval);
    });
  });

  describe("runManualPlanRevision", () => {
    it("approved verdict: no revision needed, returns to AwaitingPlanApproval", async () => {
      const run = makeRun({ id: "run-1", state: RunState.AwaitingPlanApproval, planVersion: 1 });
      const { deps, store, planReviewerAgent, planReviserAgent } = buildDeps(run);
      store.artifacts.push(makeArtifact("Plan", 1, makePlan({ planVersion: 1 })));
      planReviewerAgent.run.mockResolvedValue({
        reviewId: "r1",
        summary: "Great plan",
        findings: [],
        overallVerdict: "approved",
      });

      const svc = new OrchestratorService(deps as never);
      const result = await svc.runManualPlanRevision(run.id);

      expect(result.state).toBe(RunState.AwaitingPlanApproval);
      expect(planReviserAgent.run).not.toHaveBeenCalled();
    });

    it("changes_requested verdict: delegates to runPlanRevision with the operator note", async () => {
      const run = makeRun({ id: "run-1", state: RunState.AwaitingPlanApproval, planVersion: 1 });
      const { deps, store, planReviewerAgent } = buildDeps(run);
      store.artifacts.push(makeArtifact("Plan", 1, makePlan({ planVersion: 1 })));
      planReviewerAgent.run.mockResolvedValue({
        reviewId: "r1",
        summary: "Needs work",
        findings: [{ id: "f1", severity: "important", type: "x", title: "t", details: "d" }],
        overallVerdict: "changes_requested",
      });

      const svc = new OrchestratorService(deps as never);
      const runPlanRevisionSpy = vi
        .spyOn(svc, "runPlanRevision")
        .mockImplementation(async () => ({ ...store.run, state: RunState.AwaitingPlanApproval }));

      const result = await svc.runManualPlanRevision(run.id, { note: "tighten scope" });

      expect(runPlanRevisionSpy).toHaveBeenCalledWith(run.id, { note: "tighten scope" });
      expect(result.state).toBe(RunState.AwaitingPlanApproval);
    });
  });

  describe("approveHumanReview", () => {
    it("transitions to Done and posts a completion comment when there is no distillation agent", async () => {
      const run = makeRun({ id: "run-1", state: RunState.ReadyForHumanReview, workingDirectory: "/tmp" });
      const { deps, linearClient, gitService } = buildDeps(run);
      const svc = new OrchestratorService(deps as never);

      const result = await svc.approveHumanReview(run.id);

      expect(result.state).toBe(RunState.Done);
      expect(linearClient.postComment).toHaveBeenCalledWith(
        run.linearIssueId,
        "Human review approved. Run is **Done**.",
      );
      // mainRepoPath (default "/tmp") equals run.workingDirectory, so cleanup is a no-op.
      expect(gitService.removeWorktree).not.toHaveBeenCalled();
    });

    it("continues to Done when the distillation agent throws (best-effort, logged)", async () => {
      const run = makeRun({ id: "run-1", state: RunState.ReadyForHumanReview });
      const distillationAgent = { run: vi.fn().mockRejectedValue(new Error("distillation blew up")) };
      const { deps, logger } = buildDeps(run, { distillationAgent });
      const svc = new OrchestratorService(deps as never);

      const result = await svc.approveHumanReview(run.id);

      expect(result.state).toBe(RunState.Done);
      expect(distillationAgent.run).toHaveBeenCalledWith(run.id, expect.objectContaining({ id: run.id }));
      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ runId: run.id, error: "distillation blew up" }),
        "Distillation agent failed (best-effort, ignoring)",
      );
    });

    it("cleans up the worktree and updates skill metrics (with de-duplication and per-skill error handling) on Done", async () => {
      const run = makeRun({
        id: "run-1",
        state: RunState.ReadyForHumanReview,
        workingDirectory: "/tmp/worktree",
      });
      const distillationAgent = { run: vi.fn().mockResolvedValue(undefined) };
      const agentSkillRepo = {
        incrementSuccess: vi
          .fn()
          .mockResolvedValueOnce({ id: "skill-ok", successCount: 1, failureCount: 0, utilityScore: 0.5 })
          .mockRejectedValueOnce(new Error("db unavailable")),
        incrementFailure: vi.fn(),
        archiveIfLowUtility: vi.fn().mockResolvedValue(undefined),
      };
      const { deps, store, gitService, logger } = buildDeps(run, { distillationAgent, agentSkillRepo });
      // Two SKILL_INJECTION events (e.g. initial plan + a re-plan), sharing one
      // skill id, to exercise de-duplication across events and the per-skill
      // try/catch when an update fails partway through.
      store.events.push(
        {
          id: "e1",
          runId: run.id,
          eventType: "SKILL_INJECTION",
          source: "orchestrator",
          payloadJson: { skillIds: ["skill-ok", "skill-bad"] },
          createdAt: new Date(),
        },
        {
          id: "e2",
          runId: run.id,
          eventType: "SKILL_INJECTION",
          source: "orchestrator",
          payloadJson: { skillIds: ["skill-ok"] },
          createdAt: new Date(),
        },
      );

      const svc = new OrchestratorService(deps as never);
      const result = await svc.approveHumanReview(run.id);

      expect(result.state).toBe(RunState.Done);
      expect(gitService.removeWorktree).toHaveBeenCalledWith("/tmp", "/tmp/worktree");
      expect(agentSkillRepo.incrementSuccess).toHaveBeenCalledTimes(2);
      expect(agentSkillRepo.archiveIfLowUtility).toHaveBeenCalledTimes(1);
      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ runId: run.id, skillId: "skill-bad", error: "db unavailable" }),
        "Failed to update skill metric",
      );
    });
  });
});
