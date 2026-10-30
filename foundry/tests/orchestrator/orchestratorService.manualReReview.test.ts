import { describe, it, expect, vi } from "vitest";
import { OrchestratorService } from "../../src/orchestrator/orchestratorService.js";
import { RunState } from "../../src/domain/runState.js";
import type { Run, Artifact } from "../../src/domain/types.js";
import type { Plan } from "../../src/schemas/plan.js";
import type { PlanReview } from "../../src/schemas/planReview.js";

function makeRun(overrides: Partial<Run> = {}): Run {
  return {
    id: "run-1",
    linearIssueId: "LIN-1",
    linearIssueIdentifier: "ENG-1",
    linearIssueDescription: "desc",
    linearIssueTitle: "Title",
    linearIssueUrl: null,
    repo: "test-repo",
    branchName: "ai/run-1",
    prNumber: null,
    state: RunState.AwaitingPlanApproval,
    planVersion: 1,
    approvedPlanVersion: null,
    plannerRuntime: null,
    executorRuntime: null,
    reviewerRuntime: null,
    remediationRuntime: null,
    workingDirectory: "/tmp/work",
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

function makePlanReview(overrides: Partial<PlanReview> = {}): PlanReview {
  return {
    overallVerdict: "approved",
    summary: "Looks good",
    findings: [],
    ...overrides,
  } as PlanReview;
}

function makeArtifact(overrides: Partial<Artifact> = {}): Artifact {
  return {
    id: "artifact-1",
    runId: "run-1",
    type: "Plan",
    version: 1,
    payloadJson: {},
    rawText: "{}",
    createdAt: new Date(),
    ...overrides,
  };
}

const issueFixture = {
  id: "LIN-1",
  identifier: "ENG-1",
  title: "Test issue",
  description: "desc",
  branchName: "ai/run-1",
  labels: [] as string[],
  priority: 0,
  url: null,
};

function buildDeps(overrides: Record<string, unknown> = {}, initialRun: Run = makeRun()) {
  let current: Run = initialRun;

  const runRepo = {
    findById: vi.fn().mockImplementation(() => Promise.resolve(current)),
    findActiveByIssueId: vi.fn(),
    findAll: vi.fn(),
    create: vi.fn(),
    findByIssueId: vi.fn(),
    updateState: vi.fn().mockImplementation((_id: string, state: RunState) => {
      current = { ...current, state };
      return Promise.resolve(current);
    }),
    update: vi.fn().mockImplementation((_id: string, patch: Partial<Run>) => {
      current = { ...current, ...patch };
      return Promise.resolve(current);
    }),
  };

  const artifactRepo = {
    create: vi.fn().mockResolvedValue({ id: "artifact-new" }),
    findByRunId: vi.fn().mockResolvedValue([]),
    findLatestByType: vi
      .fn()
      .mockResolvedValue(makeArtifact({ type: "Plan", payloadJson: makePlan() })),
  };

  const eventRepo = { create: vi.fn().mockResolvedValue({}), findByRunId: vi.fn().mockResolvedValue([]) };

  const linearClient = {
    getIssue: vi.fn().mockResolvedValue(issueFixture),
    postComment: vi.fn().mockResolvedValue(undefined),
    getRelatedContext: vi.fn().mockResolvedValue({ parent: undefined, blockers: [] }),
  };

  const githubClient = { getPRDiff: vi.fn(), getDefaultBranch: vi.fn().mockResolvedValue("main") };

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

  const plannerAgent = { run: vi.fn() };
  const planReviewerAgent = { run: vi.fn().mockResolvedValue(makePlanReview()) };
  const planReviserAgent = { run: vi.fn() };
  const executorAgent = { run: vi.fn() };
  const reviewerAgent = { run: vi.fn() };
  const remediationAgent = { run: vi.fn() };

  const gitService = {
    setupRunWorktree: vi.fn(),
    assertBranch: vi.fn(),
    commitAndPush: vi.fn(),
    removeWorktree: vi.fn(),
    resolveMainRepoPath: vi.fn(),
  };

  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
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
    artifactRepo,
    eventRepo,
    planReviewerAgent,
  };
}

describe("OrchestratorService.runManualReReview", () => {
  it("throws when no Plan artifact exists", async () => {
    const { deps, artifactRepo } = buildDeps();
    artifactRepo.findLatestByType.mockResolvedValue(null);
    const svc = new OrchestratorService(deps as never);
    await expect(svc.runManualReReview("run-1")).rejects.toThrow(/No plan artifact found/);
  });

  it("records a trigger-only event payload when no note is given, and returns to AwaitingPlanApproval on approved verdict", async () => {
    const { deps, eventRepo, planReviewerAgent } = buildDeps();
    planReviewerAgent.run.mockResolvedValue(makePlanReview({ overallVerdict: "approved" }));
    const svc = new OrchestratorService(deps as never);

    const run = await svc.runManualReReview("run-1");

    expect(run.state).toBe(RunState.AwaitingPlanApproval);
    const reReviewEvent = eventRepo.create.mock.calls.find(
      (c: unknown[]) => (c[0] as { eventType: string }).eventType === "RE_REVIEW_REQUESTED",
    );
    expect((reReviewEvent![0] as { payloadJson: Record<string, unknown> }).payloadJson).toMatchObject({
      trigger: "re-review",
    });
    expect((reReviewEvent![0] as { payloadJson: Record<string, unknown> }).payloadJson.note).toBeUndefined();
  });

  it("includes the note in the event payload and passes operatorNote to the reviewer agent", async () => {
    const { deps, eventRepo, planReviewerAgent } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    await svc.runManualReReview("run-1", { note: "double check the auth flow" });

    const reReviewEvent = eventRepo.create.mock.calls.find(
      (c: unknown[]) => (c[0] as { eventType: string }).eventType === "RE_REVIEW_REQUESTED",
    );
    expect((reReviewEvent![0] as { payloadJson: Record<string, unknown> }).payloadJson).toMatchObject({
      trigger: "re-review",
      note: "double check the auth flow",
    });
    expect(planReviewerAgent.run).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      "run-1",
      { operatorNote: "double check the auth flow" },
    );
  });

  it("also returns to AwaitingPlanApproval when the verdict is changes_requested (human stays in control)", async () => {
    const { deps, planReviewerAgent } = buildDeps();
    planReviewerAgent.run.mockResolvedValue(
      makePlanReview({
        overallVerdict: "changes_requested",
        findings: [{ id: "f1", severity: "nit", type: "style", title: "t", details: "d" }],
      }),
    );
    const svc = new OrchestratorService(deps as never);

    const run = await svc.runManualReReview("run-1");

    expect(run.state).toBe(RunState.AwaitingPlanApproval);
  });
});

describe("OrchestratorService.runManualPlanRevision", () => {
  it("throws when no Plan artifact exists", async () => {
    const { deps, artifactRepo } = buildDeps();
    artifactRepo.findLatestByType.mockResolvedValue(null);
    const svc = new OrchestratorService(deps as never);
    await expect(svc.runManualPlanRevision("run-1")).rejects.toThrow(/No plan artifact found/);
  });

  it("on approved verdict: stays at AwaitingPlanApproval without revising", async () => {
    const { deps, planReviewerAgent } = buildDeps();
    planReviewerAgent.run.mockResolvedValue(makePlanReview({ overallVerdict: "approved" }));
    const svc = new OrchestratorService(deps as never);
    const revisionSpy = vi.spyOn(svc, "runPlanRevision");

    const run = await svc.runManualPlanRevision("run-1");

    expect(revisionSpy).not.toHaveBeenCalled();
    expect(run.state).toBe(RunState.AwaitingPlanApproval);
  });

  it("on changes_requested verdict: delegates to runPlanRevision with the note", async () => {
    const { deps, planReviewerAgent } = buildDeps();
    planReviewerAgent.run.mockResolvedValue(
      makePlanReview({
        overallVerdict: "changes_requested",
        findings: [{ id: "f1", severity: "important", type: "risk", title: "t", details: "d" }],
      }),
    );
    const svc = new OrchestratorService(deps as never);
    const revisionSpy = vi.spyOn(svc, "runPlanRevision").mockResolvedValue(makeRun());

    await svc.runManualPlanRevision("run-1", { note: "simplify step 2" });

    expect(revisionSpy).toHaveBeenCalledWith("run-1", { note: "simplify step 2" });
  });

  it("on changes_requested verdict with no note: delegates to runPlanRevision with undefined opts", async () => {
    const { deps, planReviewerAgent } = buildDeps();
    planReviewerAgent.run.mockResolvedValue(
      makePlanReview({
        overallVerdict: "changes_requested",
        findings: [{ id: "f1", severity: "important", type: "risk", title: "t", details: "d" }],
      }),
    );
    const svc = new OrchestratorService(deps as never);
    const revisionSpy = vi.spyOn(svc, "runPlanRevision").mockResolvedValue(makeRun());

    await svc.runManualPlanRevision("run-1");

    expect(revisionSpy).toHaveBeenCalledWith("run-1", undefined);
  });
});
