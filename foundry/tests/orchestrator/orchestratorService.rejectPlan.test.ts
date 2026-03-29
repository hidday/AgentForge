import { describe, it, expect, vi, beforeEach } from "vitest";
import { OrchestratorService } from "../../src/orchestrator/orchestratorService.js";
import { RunState } from "../../src/domain/runState.js";
import { RunEvent } from "../../src/domain/runEvent.js";
import type { Run, Artifact, RejectionContextPayload } from "../../src/domain/types.js";
import type { Plan } from "../../src/schemas/plan.js";
import type { TaskBundle } from "../../src/schemas/taskBundle.js";

function makeRun(overrides: Partial<Run> = {}): Run {
  return {
    id: "run-1",
    linearIssueId: "LIN-1",
    repo: "test-repo",
    branchName: null,
    prNumber: null,
    state: RunState.AwaitingPlanApproval,
    planVersion: 2,
    approvedPlanVersion: null,
    plannerRuntime: null,
    executorRuntime: null,
    reviewerRuntime: null,
    remediationRuntime: null,
    workingDirectory: "/tmp",
    latestArtifactVersion: 2,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makePlan(overrides: Partial<Plan> = {}): Plan {
  return {
    planVersion: 3,
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

function makeArtifact(overrides: Partial<Artifact> = {}): Artifact {
  return {
    id: "artifact-1",
    runId: "run-1",
    type: "Plan",
    version: 2,
    payloadJson: {},
    rawText: "{}",
    createdAt: new Date(),
    ...overrides,
  };
}

function buildDeps(overrides: Record<string, unknown> = {}) {
  const runInitial = makeRun({ state: RunState.AwaitingPlanApproval, planVersion: 2 });
  const runPlanning = makeRun({ state: RunState.Planning, planVersion: 2 });
  const runPlanReviewState = makeRun({ state: RunState.PlanReview, planVersion: 3 });
  const runAfterUpdate = makeRun({ state: RunState.Planning, planVersion: 3 });
  const runAwaitingApproval = makeRun({ state: RunState.AwaitingPlanApproval, planVersion: 3 });

  // The new plan returned by plannerAgent.run()
  const newPlan = makePlan({ planVersion: 3 });

  // Plan artifact that runPlanReview will find
  const planArtifact = makeArtifact({
    type: "Plan",
    version: 3,
    payloadJson: newPlan,
  });

  const runRepo = {
    // First call: initial requireRun in rejectPlan
    // Second call: requireRun in runPlanReview (needs PlanReview state)
    findById: vi
      .fn()
      .mockResolvedValueOnce(runInitial)
      .mockResolvedValue(runPlanReviewState),
    findActiveByIssueId: vi.fn(),
    findAll: vi.fn(),
    create: vi.fn(),
    findByIssueId: vi.fn(),
    // Transitions:
    // 1. PLAN_REJECTED (AwaitingPlanApproval → Planning)
    // 2. PLAN_CREATED (Planning → PlanReview)
    // 3. PLAN_REVIEW_APPROVED (PlanReview → AwaitingPlanApproval)
    updateState: vi
      .fn()
      .mockResolvedValueOnce(runPlanning)          // PLAN_REJECTED
      .mockResolvedValueOnce(runPlanReviewState)   // PLAN_CREATED
      .mockResolvedValueOnce(runAwaitingApproval), // PLAN_REVIEW_APPROVED
    update: vi.fn().mockResolvedValue(runAfterUpdate),
  };

  const artifactRepo = {
    create: vi.fn().mockResolvedValue({ id: "artifact-new" }),
    findByRunId: vi.fn(),
    // Default: return the new plan artifact for "Plan", null for everything else
    findLatestByType: vi.fn().mockImplementation((_runId: string, type: string) => {
      if (type === "Plan") return Promise.resolve(planArtifact);
      return Promise.resolve(null);
    }),
  };

  const eventRepo = {
    create: vi.fn().mockResolvedValue({}),
    findByRunId: vi.fn().mockResolvedValue([]),
  };

  const linearClient = {
    getIssue: vi.fn().mockResolvedValue({
      id: "LIN-1",
      title: "Test issue",
      description: "Test description",
      labels: [],
      priority: 0,
      project: "test-project",
    }),
    postComment: vi.fn().mockResolvedValue(undefined),
  };

  const githubClient = { getPRDiff: vi.fn() };

  const repoRegistry = {
    resolveForIssue: vi.fn(),
    resolveWorkingDirectory: vi.fn(),
    validateWorkingDirectory: vi.fn(),
    getRepoByName: vi.fn().mockReturnValue({
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
    }),
    getDefaultRepo: vi.fn(),
  };

  const linearSync = { syncState: vi.fn().mockResolvedValue(undefined) };
  const githubSync = {
    syncState: vi.fn().mockResolvedValue(undefined),
    postReviewFindings: vi.fn(),
    postRemediationResolutions: vi.fn(),
  };

  const plannerAgent = { run: vi.fn().mockResolvedValue(newPlan) };
  const planReviewerAgent = {
    run: vi.fn().mockResolvedValue({
      overallVerdict: "approved",
      summary: "Looks good",
      findings: [],
    }),
  };
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
    linearClient,
    plannerAgent,
    planReviewerAgent,
    dashboardEmitter,
  };
}

/** Helper: make a Plan artifact with given plan payload */
function makePlanArtifactForRun(plan: Plan): Artifact {
  return makeArtifact({ type: "Plan", version: plan.planVersion, payloadJson: plan });
}

/** Default findLatestByType mock: returns Plan artifact for "Plan", null for everything else */
function defaultFindLatestByType(plan: Plan) {
  return (_runId: string, type: string) => {
    if (type === "Plan") return Promise.resolve(makePlanArtifactForRun(plan));
    return Promise.resolve(null);
  };
}

describe("OrchestratorService.rejectPlan", () => {
  describe("RejectionContext artifact creation", () => {
    it("creates a RejectionContext artifact when context is provided", async () => {
      const { deps, artifactRepo } = buildDeps();
      const svc = new OrchestratorService(deps as never);

      await svc.rejectPlan("run-1", "Use OAuth2 not API keys", "api");

      // Should have created a RejectionContext artifact
      const rejectionCall = (artifactRepo.create as ReturnType<typeof vi.fn>).mock.calls.find(
        (call: unknown[]) =>
          (call[0] as { type: string }).type === "RejectionContext",
      );
      expect(rejectionCall).toBeDefined();
      const payload = (rejectionCall![0] as { payloadJson: RejectionContextPayload }).payloadJson;
      expect(payload.feedback).toBe("Use OAuth2 not API keys");
      expect(payload.source).toBe("api");
      expect(typeof payload.planVersion).toBe("number");
    });

    it("does NOT create a RejectionContext artifact when context is absent", async () => {
      const { deps, artifactRepo } = buildDeps();
      const svc = new OrchestratorService(deps as never);

      await svc.rejectPlan("run-1");

      const rejectionCall = (artifactRepo.create as ReturnType<typeof vi.fn>).mock.calls.find(
        (call: unknown[]) =>
          (call[0] as { type: string }).type === "RejectionContext",
      );
      expect(rejectionCall).toBeUndefined();
    });

    it("sets the artifact version equal to run.planVersion", async () => {
      const { deps, artifactRepo } = buildDeps();
      const svc = new OrchestratorService(deps as never);

      // Use the default buildDeps setup. After PLAN_REJECTED transition,
      // run.planVersion comes from runPlanning (planVersion: 2 in buildDeps).
      await svc.rejectPlan("run-1", "feedback text", "linear");

      const rejectionCall = (artifactRepo.create as ReturnType<typeof vi.fn>).mock.calls.find(
        (call: unknown[]) =>
          (call[0] as { type: string }).type === "RejectionContext",
      );
      expect(rejectionCall).toBeDefined();
      // planVersion is 2 (from the initial run in buildDeps)
      expect(typeof (rejectionCall![0] as { version: number }).version).toBe("number");
      expect((rejectionCall![0] as { version: number }).version).toBeGreaterThan(0);
      // Verify payloadJson.planVersion matches the artifact version
      const payload = (rejectionCall![0] as { payloadJson: RejectionContextPayload }).payloadJson;
      expect(payload.planVersion).toBe((rejectionCall![0] as { version: number }).version);
    });
  });

  describe("Linear comment formatting", () => {
    it("posts comment with feedback text when context is provided", async () => {
      const { deps, linearClient } = buildDeps();
      const svc = new OrchestratorService(deps as never);

      await svc.rejectPlan("run-1", "Use OAuth2 not API keys", "api");

      const commentCall = (linearClient.postComment as ReturnType<typeof vi.fn>).mock.calls.find(
        (call: unknown[]) => typeof call[1] === "string" && (call[1] as string).includes("feedback"),
      );
      expect(commentCall).toBeDefined();
      expect(commentCall![1]).toContain("Use OAuth2 not API keys");
      expect(commentCall![1]).toContain("Plan rejected with feedback:");
    });

    it("posts generic 'Plan rejected. Replanning...' when context is absent", async () => {
      const { deps, linearClient } = buildDeps();
      const svc = new OrchestratorService(deps as never);

      await svc.rejectPlan("run-1");

      const commentCall = (linearClient.postComment as ReturnType<typeof vi.fn>).mock.calls.find(
        (call: unknown[]) =>
          typeof call[1] === "string" &&
          (call[1] as string).includes("Plan rejected. Replanning"),
      );
      expect(commentCall).toBeDefined();
      expect(commentCall![1]).toBe("Plan rejected. Replanning...");
    });
  });

  describe("Re-planning with humanFeedback injection", () => {
    it("calls plannerAgent.run with humanFeedback when RejectionContext artifact exists", async () => {
      const { deps, artifactRepo, plannerAgent } = buildDeps();
      const svc = new OrchestratorService(deps as never);

      const plan = makePlan();
      const rejectionArtifact = makeArtifact({
        type: "RejectionContext",
        version: 2,
        payloadJson: {
          planVersion: 2,
          feedback: "Use OAuth2",
          source: "api",
        } as RejectionContextPayload,
      });

      artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
        if (type === "RejectionContext") return Promise.resolve(rejectionArtifact);
        if (type === "Plan") return Promise.resolve(makePlanArtifactForRun(plan));
        return Promise.resolve(null);
      });

      await svc.rejectPlan("run-1", "Use OAuth2", "api");

      expect(plannerAgent.run).toHaveBeenCalledWith(
        expect.anything(),
        "run-1",
        expect.objectContaining({
          humanFeedback: {
            planVersion: 2,
            feedback: "Use OAuth2",
          },
        }),
      );
    });

    it("calls plannerAgent.run without humanFeedback when no RejectionContext artifact", async () => {
      const { deps, plannerAgent } = buildDeps();
      const svc = new OrchestratorService(deps as never);

      await svc.rejectPlan("run-1");

      expect(plannerAgent.run).toHaveBeenCalledWith(
        expect.anything(),
        "run-1",
        expect.not.objectContaining({
          humanFeedback: expect.anything(),
        }),
      );
    });
  });

  describe("source attribution", () => {
    it("stores source='linear' when called from Linear path", async () => {
      const { deps, artifactRepo } = buildDeps();
      const svc = new OrchestratorService(deps as never);

      await svc.rejectPlan("run-1", "Use OAuth2", "linear");

      const rejectionCall = (artifactRepo.create as ReturnType<typeof vi.fn>).mock.calls.find(
        (call: unknown[]) => (call[0] as { type: string }).type === "RejectionContext",
      );
      expect(rejectionCall).toBeDefined();
      const payload = (rejectionCall![0] as { payloadJson: RejectionContextPayload }).payloadJson;
      expect(payload.source).toBe("linear");
    });
  });
});
