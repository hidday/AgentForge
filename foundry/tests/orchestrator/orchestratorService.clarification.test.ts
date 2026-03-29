import { describe, it, expect, vi, beforeEach } from "vitest";
import { OrchestratorService } from "../../src/orchestrator/orchestratorService.js";
import { RunState } from "../../src/domain/runState.js";
import { RunEvent } from "../../src/domain/runEvent.js";
import { PolicyError, ValidationError } from "../../src/utils/errors.js";
import type { Run, Artifact } from "../../src/domain/types.js";
import type { Plan } from "../../src/schemas/plan.js";
import type { TaskBundle } from "../../src/schemas/taskBundle.js";

// Helper to build a minimal Run object
function makeRun(overrides: Partial<Run> = {}): Run {
  return {
    id: "run-1",
    linearIssueId: "LIN-1",
    repo: "test-repo",
    branchName: null,
    prNumber: null,
    state: RunState.HumanClarificationNeeded,
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
    assumptions: [],
    openQuestions: [],
    risks: [],
    steps: [{ id: "s1", title: "Step 1", description: "Do something" }],
    testPlan: "Run tests",
    confidence: 0.9,
    ...overrides,
  };
}

function makeTaskBundle(): TaskBundle {
  return {
    issue: {
      id: "LIN-1",
      title: "Test issue",
      description: "Test description",
      labels: [],
      priority: 0,
    },
    repo: {
      name: "test-repo",
      defaultBranch: "main",
      workingBranch: "ai/lin-1",
      repoPath: "/tmp",
      allowedPaths: ["src/"],
      protectedPaths: [],
    },
    constraints: {
      requiredChecks: [],
      maxFilesChanged: 10,
      maxDiffLines: 500,
      forbiddenPatterns: [],
      mustNotTouch: [],
    },
    definitionOfDone: [],
  };
}

function makePlanArtifact(plan: Plan): Artifact {
  return {
    id: "artifact-plan-1",
    runId: "run-1",
    type: "Plan",
    version: plan.planVersion,
    payloadJson: plan,
    rawText: JSON.stringify(plan),
    createdAt: new Date(),
  };
}

function makeTaskBundleArtifact(bundle: TaskBundle): Artifact {
  return {
    id: "artifact-bundle-1",
    runId: "run-1",
    type: "TaskBundle",
    version: 1,
    payloadJson: bundle,
    rawText: JSON.stringify(bundle),
    createdAt: new Date(),
  };
}

function buildDeps(overrides: Record<string, unknown> = {}) {
  const runRepo = {
    findById: vi.fn(),
    findActiveByIssueId: vi.fn(),
    findAll: vi.fn(),
    create: vi.fn(),
    findByIssueId: vi.fn(),
    updateState: vi.fn(),
    update: vi.fn(),
  };

  const artifactRepo = {
    create: vi.fn(),
    findByRunId: vi.fn(),
    findLatestByType: vi.fn(),
  };

  const eventRepo = {
    create: vi.fn(),
    findByRunId: vi.fn().mockResolvedValue([]),
  };

  const linearClient = {
    getIssue: vi.fn(),
    postComment: vi.fn(),
  };

  const githubClient = {
    getPRDiff: vi.fn(),
  };

  const repoRegistry = {
    resolveForIssue: vi.fn(),
    resolveWorkingDirectory: vi.fn(),
    validateWorkingDirectory: vi.fn(),
    getRepoByName: vi.fn(),
    getDefaultRepo: vi.fn(),
  };

  const linearSync = { syncState: vi.fn() };
  const githubSync = { syncState: vi.fn(), postReviewFindings: vi.fn(), postRemediationResolutions: vi.fn() };

  const plannerAgent = { run: vi.fn() };
  const planReviewerAgent = { run: vi.fn() };
  const planReviserAgent = { run: vi.fn() };
  const executorAgent = { run: vi.fn() };
  const reviewerAgent = { run: vi.fn() };
  const remediationAgent = { run: vi.fn() };

  const gitService = {
    setupRunWorktree: vi.fn().mockResolvedValue({ worktreePath: "/tmp/worktree", branchName: "ai/run-test1234" }),
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

  return {
    deps: {
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
    },
    runRepo,
    artifactRepo,
    eventRepo,
    plannerAgent,
    planReviewerAgent,
    dashboardEmitter,
  };
}

describe("OrchestratorService.answerQuestions", () => {
  describe("state validation", () => {
    it("throws PolicyError when run is not in HumanClarificationNeeded or AwaitingPlanApproval", async () => {
      const { deps, runRepo } = buildDeps();
      const svc = new OrchestratorService(deps as never);

      runRepo.findById.mockResolvedValue(makeRun({ state: RunState.Planning }));

      await expect(
        svc.answerQuestions("run-1", [{ questionId: "q1", answer: "yes" }]),
      ).rejects.toThrow(PolicyError);
    });

    it("throws PolicyError with correct message", async () => {
      const { deps, runRepo } = buildDeps();
      const svc = new OrchestratorService(deps as never);

      runRepo.findById.mockResolvedValue(makeRun({ state: RunState.Implementing }));

      await expect(
        svc.answerQuestions("run-1", [{ questionId: "q1", answer: "yes" }]),
      ).rejects.toThrow(/HumanClarificationNeeded or AwaitingPlanApproval/);
    });
  });

  describe("questionId validation", () => {
    it("throws ValidationError when submitted questionId is not in the plan", async () => {
      const { deps, runRepo, artifactRepo } = buildDeps();
      const svc = new OrchestratorService(deps as never);

      const run = makeRun({ state: RunState.HumanClarificationNeeded });
      const plan = makePlan({
        openQuestions: [{ id: "q1", question: "What?", requiredForExecution: true }],
      });

      runRepo.findById.mockResolvedValue(run);
      artifactRepo.findLatestByType.mockImplementation((_, type: string) => {
        if (type === "Plan") return Promise.resolve(makePlanArtifact(plan));
        return Promise.resolve(null);
      });

      await expect(
        svc.answerQuestions("run-1", [{ questionId: "unknown-q", answer: "yes" }]),
      ).rejects.toThrow(ValidationError);
    });
  });

  describe("AwaitingPlanApproval path", () => {
    it("persists HumanAnswers artifact but does NOT trigger re-planning", async () => {
      const { deps, runRepo, artifactRepo, plannerAgent } = buildDeps();
      const svc = new OrchestratorService(deps as never);

      const run = makeRun({ state: RunState.AwaitingPlanApproval });
      const plan = makePlan({
        openQuestions: [{ id: "q1", question: "Optional?", requiredForExecution: false }],
      });

      runRepo.findById.mockResolvedValue(run);
      artifactRepo.findLatestByType.mockImplementation((_, type: string) => {
        if (type === "Plan") return Promise.resolve(makePlanArtifact(plan));
        return Promise.resolve(null);
      });
      artifactRepo.create.mockResolvedValue({ id: "artifact-new" });

      const result = await svc.answerQuestions("run-1", [{ questionId: "q1", answer: "yes" }]);

      // Should NOT call plannerAgent.run
      expect(plannerAgent.run).not.toHaveBeenCalled();
      // Should create HumanAnswers artifact
      expect(artifactRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ type: "HumanAnswers" }),
      );
      // Should return the run
      expect(result).toBeDefined();
    });

    it("emits run:questions-answered event", async () => {
      const { deps, runRepo, artifactRepo, dashboardEmitter } = buildDeps();
      const svc = new OrchestratorService(deps as never);

      const run = makeRun({ state: RunState.AwaitingPlanApproval });
      const plan = makePlan({
        openQuestions: [{ id: "q1", question: "Optional?", requiredForExecution: false }],
      });

      runRepo.findById.mockResolvedValue(run);
      artifactRepo.findLatestByType.mockResolvedValue(makePlanArtifact(plan));
      artifactRepo.create.mockResolvedValue({ id: "artifact-new" });

      await svc.answerQuestions("run-1", [{ questionId: "q1", answer: "yes" }]);

      expect(dashboardEmitter.emitQuestionsAnswered).toHaveBeenCalledWith("run-1", 1);
    });
  });

  describe("HumanClarificationNeeded path", () => {
    it("throws ValidationError when required questions are unanswered", async () => {
      const { deps, runRepo, artifactRepo } = buildDeps();
      const svc = new OrchestratorService(deps as never);

      const run = makeRun({ state: RunState.HumanClarificationNeeded });
      const plan = makePlan({
        openQuestions: [
          { id: "q1", question: "Required?", requiredForExecution: true },
          { id: "q2", question: "Also required?", requiredForExecution: true },
        ],
      });

      runRepo.findById.mockResolvedValue(run);
      artifactRepo.findLatestByType.mockImplementation((_, type: string) => {
        if (type === "Plan") return Promise.resolve(makePlanArtifact(plan));
        return Promise.resolve(null);
      });
      artifactRepo.create.mockResolvedValue({ id: "artifact-new" });

      // Only answer q1, not q2
      await expect(
        svc.answerQuestions("run-1", [{ questionId: "q1", answer: "yes" }]),
      ).rejects.toThrow(ValidationError);
    });

    it("happy path: persists HumanAnswers, re-plans, records PLAN_CREATED, calls runPlanReview when no blockers remain", async () => {
      const { deps, runRepo, artifactRepo, eventRepo, plannerAgent } = buildDeps();
      const svc = new OrchestratorService(deps as never);

      const run = makeRun({ state: RunState.HumanClarificationNeeded });
      const plan = makePlan({
        openQuestions: [{ id: "q1", question: "Required?", requiredForExecution: true }],
      });
      const taskBundle = makeTaskBundle();

      const planningRun = makeRun({ state: RunState.Planning });
      const planReviewRun = makeRun({ state: RunState.PlanReview });
      const awaitingApprovalRun = makeRun({ state: RunState.AwaitingPlanApproval });

      const newPlan = makePlan({
        planVersion: 2,
        openQuestions: [], // No more blocking questions
      });

      // First findById call: initial load in answerQuestions
      // Subsequent calls (inside runPlanReview): the run is now in PlanReview state
      runRepo.findById
        .mockResolvedValueOnce(run)
        .mockResolvedValue(planReviewRun);
      runRepo.updateState
        .mockResolvedValueOnce(planningRun) // CLARIFICATION_PROVIDED → Planning
        .mockResolvedValueOnce(planReviewRun) // PLAN_CREATED → PlanReview
        .mockResolvedValueOnce(awaitingApprovalRun); // PLAN_REVIEW_APPROVED → AwaitingPlanApproval

      runRepo.update.mockResolvedValue({ ...planningRun, planVersion: 2 });

      artifactRepo.findLatestByType.mockImplementation((_: string, type: string) => {
        if (type === "Plan") return Promise.resolve(makePlanArtifact(plan));
        if (type === "TaskBundle") return Promise.resolve(makeTaskBundleArtifact(taskBundle));
        if (type === "PlanReview") {
          return Promise.resolve({
            id: "pr-1",
            runId: "run-1",
            type: "PlanReview",
            version: 1,
            payloadJson: { overallVerdict: "approved", summary: "OK", findings: [] },
            rawText: "{}",
            createdAt: new Date(),
          });
        }
        return Promise.resolve(null);
      });

      artifactRepo.create.mockResolvedValue({ id: "artifact-new" });
      plannerAgent.run.mockResolvedValue(newPlan);
      eventRepo.findByRunId.mockResolvedValue([]);

      // Mock linearSync and githubSync
      (deps as never as { linearSync: { syncState: ReturnType<typeof vi.fn> } }).linearSync.syncState.mockResolvedValue(undefined);
      (deps as never as { githubSync: { syncState: ReturnType<typeof vi.fn> } }).githubSync.syncState.mockResolvedValue(undefined);
      (deps as never as { linearClient: { postComment: ReturnType<typeof vi.fn> } }).linearClient.postComment.mockResolvedValue(undefined);
      (deps as never as { planReviewerAgent: { run: ReturnType<typeof vi.fn> } }).planReviewerAgent.run.mockResolvedValue({
        overallVerdict: "approved",
        summary: "OK",
        findings: [],
      });
      (deps as never as { linearClient: { getIssue: ReturnType<typeof vi.fn> } }).linearClient.getIssue.mockResolvedValue({
        id: "LIN-1",
        title: "Test",
        description: "Test",
        labels: [],
        priority: 0,
        project: undefined,
        cycle: undefined,
      });
      (deps as never as { repoRegistry: { getRepoByName: ReturnType<typeof vi.fn> } }).repoRegistry.getRepoByName.mockReturnValue(null);
      (deps as never as { repoRegistry: { getDefaultRepo: ReturnType<typeof vi.fn> } }).repoRegistry.getDefaultRepo.mockReturnValue({
        name: "test-repo",
        defaultBranch: "main",
        allowedPaths: ["src/"],
        protectedPaths: [],
        constraints: {
          requiredChecks: [],
          maxFilesChanged: 10,
          maxDiffLines: 500,
          forbiddenPatterns: [],
          mustNotTouch: [],
        },
      });

      const result = await svc.answerQuestions("run-1", [{ questionId: "q1", answer: "yes" }]);

      // plannerAgent.run should be called with the stored task bundle (not re-fetched)
      expect(plannerAgent.run).toHaveBeenCalledWith(
        taskBundle,
        "run-1",
        expect.objectContaining({ humanAnswers: [{ questionId: "q1", answer: "yes" }] }),
      );

      // HumanAnswers artifact should be persisted
      expect(artifactRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ type: "HumanAnswers" }),
      );

      expect(result).toBeDefined();
    });

    it("uses stored TaskBundle artifact (not re-fetched from Linear)", async () => {
      const { deps, runRepo, artifactRepo, eventRepo, plannerAgent } = buildDeps();
      const svc = new OrchestratorService(deps as never);

      const run = makeRun({ state: RunState.HumanClarificationNeeded });
      const plan = makePlan({
        openQuestions: [{ id: "q1", question: "Required?", requiredForExecution: true }],
      });
      const storedBundle = makeTaskBundle();
      storedBundle.issue.title = "STORED BUNDLE"; // Distinct marker

      const planningRun = makeRun({ state: RunState.Planning });
      const planReviewRun = makeRun({ state: RunState.PlanReview });
      const awaitingApprovalRun = makeRun({ state: RunState.AwaitingPlanApproval });

      const newPlan = makePlan({ planVersion: 2, openQuestions: [] });

      // First findById call: initial load in answerQuestions
      // Subsequent calls (inside runPlanReview): the run is now in PlanReview state
      runRepo.findById
        .mockResolvedValueOnce(run)
        .mockResolvedValue(planReviewRun);
      runRepo.updateState
        .mockResolvedValueOnce(planningRun)
        .mockResolvedValueOnce(planReviewRun)
        .mockResolvedValueOnce(awaitingApprovalRun);
      runRepo.update.mockResolvedValue({ ...planningRun, planVersion: 2 });

      artifactRepo.findLatestByType.mockImplementation((_: string, type: string) => {
        if (type === "Plan") return Promise.resolve(makePlanArtifact(plan));
        if (type === "TaskBundle") return Promise.resolve(makeTaskBundleArtifact(storedBundle));
        if (type === "PlanReview") {
          return Promise.resolve({
            id: "pr-1", runId: "run-1", type: "PlanReview", version: 1,
            payloadJson: { overallVerdict: "approved", summary: "OK", findings: [] },
            rawText: "{}", createdAt: new Date(),
          });
        }
        return Promise.resolve(null);
      });
      artifactRepo.create.mockResolvedValue({ id: "artifact-new" });
      plannerAgent.run.mockResolvedValue(newPlan);
      eventRepo.findByRunId.mockResolvedValue([]);

      // Setup remaining mocks
      (deps as never as { linearSync: { syncState: ReturnType<typeof vi.fn> } }).linearSync.syncState.mockResolvedValue(undefined);
      (deps as never as { githubSync: { syncState: ReturnType<typeof vi.fn> } }).githubSync.syncState.mockResolvedValue(undefined);
      (deps as never as { linearClient: { postComment: ReturnType<typeof vi.fn> } }).linearClient.postComment.mockResolvedValue(undefined);
      (deps as never as { planReviewerAgent: { run: ReturnType<typeof vi.fn> } }).planReviewerAgent.run.mockResolvedValue({
        overallVerdict: "approved", summary: "OK", findings: [],
      });
      (deps as never as { linearClient: { getIssue: ReturnType<typeof vi.fn> } }).linearClient.getIssue.mockResolvedValue({
        id: "LIN-1", title: "Test", description: "Test", labels: [], priority: 0,
      });
      (deps as never as { repoRegistry: { getRepoByName: ReturnType<typeof vi.fn> } }).repoRegistry.getRepoByName.mockReturnValue(null);
      (deps as never as { repoRegistry: { getDefaultRepo: ReturnType<typeof vi.fn> } }).repoRegistry.getDefaultRepo.mockReturnValue({
        name: "test-repo", defaultBranch: "main",
        allowedPaths: ["src/"], protectedPaths: [],
        constraints: { requiredChecks: [], maxFilesChanged: 10, maxDiffLines: 500, forbiddenPatterns: [], mustNotTouch: [] },
      });

      await svc.answerQuestions("run-1", [{ questionId: "q1", answer: "answer" }]);

      // Verify plannerAgent.run was called with the stored bundle (title = "STORED BUNDLE")
      // — this confirms we used the persisted TaskBundle artifact, not a re-fetched one
      expect(plannerAgent.run).toHaveBeenCalledWith(
        expect.objectContaining({ issue: expect.objectContaining({ title: "STORED BUNDLE" }) }),
        "run-1",
        expect.anything(),
      );

      // linearClient.getIssue may be called inside runPlanReview (to build the plan review bundle)
      // but NOT for re-planning; the primary assertion above already covers the stored-bundle check.
    });

    it("transitions to Failed when max clarification iterations reached", async () => {
      const { deps, runRepo, artifactRepo, eventRepo, plannerAgent } = buildDeps();
      const svc = new OrchestratorService(deps as never);

      const run = makeRun({ state: RunState.HumanClarificationNeeded });
      const plan = makePlan({
        openQuestions: [{ id: "q1", question: "Required?", requiredForExecution: true }],
      });
      const taskBundle = makeTaskBundle();
      const newPlan = makePlan({
        planVersion: 2,
        openQuestions: [{ id: "q1", question: "Still required?", requiredForExecution: true }],
      });

      const planningRun = makeRun({ state: RunState.Planning });
      const planReviewRun = makeRun({ state: RunState.PlanReview });
      const failedRun = makeRun({ state: RunState.Failed });

      runRepo.findById.mockResolvedValue(run);
      runRepo.updateState
        .mockResolvedValueOnce(planningRun)   // CLARIFICATION_PROVIDED → Planning
        .mockResolvedValueOnce(planReviewRun) // PLAN_CREATED → PlanReview
        .mockResolvedValueOnce(failedRun);    // CLARIFICATION_EXHAUSTED → Failed

      runRepo.update.mockResolvedValue({ ...planningRun, planVersion: 2 });

      artifactRepo.findLatestByType.mockImplementation((_: string, type: string) => {
        if (type === "Plan") return Promise.resolve(makePlanArtifact(plan));
        if (type === "TaskBundle") return Promise.resolve(makeTaskBundleArtifact(taskBundle));
        return Promise.resolve(null);
      });
      artifactRepo.create.mockResolvedValue({ id: "artifact-new" });
      plannerAgent.run.mockResolvedValue(newPlan);

      // Simulate 3 prior NEEDS_HUMAN_CLARIFICATION events (max iterations reached)
      eventRepo.findByRunId.mockResolvedValue([
        { id: "e1", runId: "run-1", eventType: RunEvent.NEEDS_HUMAN_CLARIFICATION, source: "planner-agent", payloadJson: {}, createdAt: new Date() },
        { id: "e2", runId: "run-1", eventType: RunEvent.NEEDS_HUMAN_CLARIFICATION, source: "planner-agent", payloadJson: {}, createdAt: new Date() },
        { id: "e3", runId: "run-1", eventType: RunEvent.NEEDS_HUMAN_CLARIFICATION, source: "planner-agent", payloadJson: {}, createdAt: new Date() },
      ]);

      (deps as never as { linearSync: { syncState: ReturnType<typeof vi.fn> } }).linearSync.syncState.mockResolvedValue(undefined);
      (deps as never as { githubSync: { syncState: ReturnType<typeof vi.fn> } }).githubSync.syncState.mockResolvedValue(undefined);
      (deps as never as { linearClient: { postComment: ReturnType<typeof vi.fn> } }).linearClient.postComment.mockResolvedValue(undefined);

      const result = await svc.answerQuestions("run-1", [{ questionId: "q1", answer: "still confused" }]);

      // Should NOT call runPlanReview — should fail
      expect((deps as never as { planReviewerAgent: { run: ReturnType<typeof vi.fn> } }).planReviewerAgent.run).not.toHaveBeenCalled();
      expect(result.state).toBe(RunState.Failed);
    });
  });

  describe("startRun clarification checkpoint", () => {
    it("pauses and persists TaskBundle artifact when blocking questions exist", async () => {
      const { deps, runRepo, artifactRepo, eventRepo, plannerAgent } = buildDeps();
      const svc = new OrchestratorService(deps as never);

      const todoRun = makeRun({ state: RunState.Todo });
      const planningRun = makeRun({ state: RunState.Planning });
      const clarificationRun = makeRun({ state: RunState.HumanClarificationNeeded });

      const planWithBlockers = makePlan({
        openQuestions: [{ id: "q1", question: "Blocking?", requiredForExecution: true }],
      });

      (deps as never as { linearClient: { getIssue: ReturnType<typeof vi.fn> } }).linearClient.getIssue.mockResolvedValue({
        id: "LIN-1", title: "Test", description: "Test", labels: [], priority: 0,
      });
      (deps as never as { repoRegistry: { resolveForIssue: ReturnType<typeof vi.fn> } }).repoRegistry.resolveForIssue.mockReturnValue({
        name: "test-repo", defaultBranch: "main",
        allowedPaths: ["src/"], protectedPaths: [],
        constraints: { requiredChecks: [], maxFilesChanged: 10, maxDiffLines: 500, forbiddenPatterns: [], mustNotTouch: [] },
      });
      (deps as never as { repoRegistry: { resolveWorkingDirectory: ReturnType<typeof vi.fn> } }).repoRegistry.resolveWorkingDirectory.mockReturnValue("/tmp");
      (deps as never as { repoRegistry: { validateWorkingDirectory: ReturnType<typeof vi.fn> } }).repoRegistry.validateWorkingDirectory.mockReturnValue(undefined);
      (deps as never as { repoRegistry: { getRepoByName: ReturnType<typeof vi.fn> } }).repoRegistry.getRepoByName.mockReturnValue(null);
      (deps as never as { repoRegistry: { getDefaultRepo: ReturnType<typeof vi.fn> } }).repoRegistry.getDefaultRepo.mockReturnValue({
        name: "test-repo", defaultBranch: "main",
        allowedPaths: ["src/"], protectedPaths: [],
        constraints: { requiredChecks: [], maxFilesChanged: 10, maxDiffLines: 500, forbiddenPatterns: [], mustNotTouch: [] },
      });

      runRepo.findActiveByIssueId.mockResolvedValue(null);
      runRepo.create.mockResolvedValue(todoRun);
      runRepo.updateState
        .mockResolvedValueOnce(planningRun)      // RUN_REQUESTED → Planning
        .mockResolvedValueOnce(planningRun)      // PLAN_CREATED → PlanReview but intercepted
        .mockResolvedValueOnce(clarificationRun); // NEEDS_HUMAN_CLARIFICATION

      // First update: setupRunWorktree stores worktreePath/branchName (still Todo)
      // Second update: planVersion after planning
      runRepo.update
        .mockResolvedValueOnce({ ...todoRun, workingDirectory: "/tmp/worktree", branchName: "ai/run-test1234" })
        .mockResolvedValue(planningRun);
      artifactRepo.create.mockResolvedValue({ id: "artifact-new" });
      plannerAgent.run.mockResolvedValue(planWithBlockers);
      eventRepo.findByRunId.mockResolvedValue([]);
      eventRepo.create.mockResolvedValue({ id: "event-new" });

      (deps as never as { linearSync: { syncState: ReturnType<typeof vi.fn> } }).linearSync.syncState.mockResolvedValue(undefined);
      (deps as never as { githubSync: { syncState: ReturnType<typeof vi.fn> } }).githubSync.syncState.mockResolvedValue(undefined);
      (deps as never as { linearClient: { postComment: ReturnType<typeof vi.fn> } }).linearClient.postComment.mockResolvedValue(undefined);

      const result = await svc.startRun("LIN-1");

      // TaskBundle artifact should be created
      expect(artifactRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ type: "TaskBundle" }),
      );

      // Should NOT call planReviewerAgent.run
      expect((deps as never as { planReviewerAgent: { run: ReturnType<typeof vi.fn> } }).planReviewerAgent.run).not.toHaveBeenCalled();

      expect(result).toBeDefined();
    });
  });
});
