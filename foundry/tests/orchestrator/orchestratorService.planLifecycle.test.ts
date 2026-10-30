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
    state: RunState.Planning,
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

function buildDeps(overrides: Record<string, unknown> = {}) {
  const runRepo = {
    findById: vi.fn(),
    findActiveByIssueId: vi.fn(),
    findAll: vi.fn(),
    create: vi.fn(),
    findByIssueId: vi.fn(),
    updateState: vi.fn().mockImplementation((_id: string, state: RunState) =>
      Promise.resolve(makeRun({ state })),
    ),
    update: vi.fn().mockImplementation((_id: string, patch: Partial<Run>) =>
      Promise.resolve(makeRun(patch)),
    ),
  };

  const artifactRepo = {
    create: vi.fn().mockResolvedValue({ id: "artifact-new" }),
    findByRunId: vi.fn().mockResolvedValue([]),
    findLatestByType: vi.fn().mockResolvedValue(null),
  };

  const eventRepo = { create: vi.fn().mockResolvedValue({}), findByRunId: vi.fn().mockResolvedValue([]) };

  const linearClient = {
    getIssue: vi.fn().mockResolvedValue(issueFixture),
    postComment: vi.fn().mockResolvedValue(undefined),
    getRelatedContext: vi.fn().mockResolvedValue({ parent: undefined, blockers: [] }),
  };

  const githubClient = {
    getPRDiff: vi.fn(),
    getDefaultBranch: vi.fn().mockResolvedValue("main"),
  };

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

  const plannerAgent = { run: vi.fn().mockResolvedValue(makePlan()) };
  const planReviewerAgent = { run: vi.fn().mockResolvedValue(makePlanReview()) };
  const planReviserAgent = {
    run: vi.fn().mockResolvedValue({
      revision: { dispositions: [] },
      revisedPlan: makePlan({ planVersion: 2 }),
    }),
  };
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
    runRepo,
    artifactRepo,
    eventRepo,
    linearClient,
    plannerAgent,
    planReviewerAgent,
    planReviserAgent,
    githubClient,
  };
}

describe("OrchestratorService.retryRun", () => {
  it("sets up a worktree when branchName is missing, then proceeds to plan review", async () => {
    const { deps, runRepo } = buildDeps();
    runRepo.findById.mockResolvedValue(makeRun({ state: RunState.Todo, branchName: null }));
    runRepo.update.mockResolvedValue(makeRun({ state: RunState.Todo, branchName: "ai/run-1" }));

    const svc = new OrchestratorService(deps as never);
    vi.spyOn(svc, "runPlanReview").mockResolvedValue(makeRun({ state: RunState.PlanReview }));

    const run = await svc.retryRun("run-1");

    expect((deps.gitService as { setupRunWorktree: ReturnType<typeof vi.fn> }).setupRunWorktree)
      .toHaveBeenCalled();
    expect(run.state).toBe(RunState.PlanReview);
  });

  it("skips worktree setup when branchName already exists", async () => {
    const { deps, runRepo } = buildDeps();
    runRepo.findById.mockResolvedValue(makeRun({ state: RunState.Todo, branchName: "existing-branch" }));
    const svc = new OrchestratorService(deps as never);
    vi.spyOn(svc, "runPlanReview").mockResolvedValue(makeRun());

    await svc.retryRun("run-1");

    expect((deps.gitService as { setupRunWorktree: ReturnType<typeof vi.fn> }).setupRunWorktree)
      .not.toHaveBeenCalled();
  });

  it("pauses for human clarification when the plan has blocking open questions", async () => {
    const { deps, runRepo, plannerAgent } = buildDeps();
    runRepo.findById.mockResolvedValue(makeRun({ state: RunState.Todo, branchName: "existing" }));
    plannerAgent.run.mockResolvedValue(
      makePlan({
        openQuestions: [{ id: "q1", question: "Which env?", requiredForExecution: true }],
      }),
    );
    const svc = new OrchestratorService(deps as never);
    const runPlanReviewSpy = vi.spyOn(svc, "runPlanReview");

    const run = await svc.retryRun("run-1");

    expect(runPlanReviewSpy).not.toHaveBeenCalled();
    expect(run).toBeDefined();
  });
});

describe("OrchestratorService.runPlanReview", () => {
  it("throws when no Plan artifact exists for the run", async () => {
    const { deps, runRepo, artifactRepo } = buildDeps();
    runRepo.findById.mockResolvedValue(makeRun());
    artifactRepo.findLatestByType.mockResolvedValue(null);
    const svc = new OrchestratorService(deps as never);

    await expect(svc.runPlanReview("run-1")).rejects.toThrow(/No plan artifact found/);
  });

  it("on approved verdict: transitions to approved and posts an approval comment", async () => {
    const { deps, runRepo, artifactRepo, planReviewerAgent, linearClient } = buildDeps();
    runRepo.findById.mockResolvedValue(makeRun({ state: RunState.PlanReview }));
    artifactRepo.findLatestByType.mockResolvedValue(makeArtifact({ type: "Plan", payloadJson: makePlan() }));
    planReviewerAgent.run.mockResolvedValue(makePlanReview({ overallVerdict: "approved" }));

    const svc = new OrchestratorService(deps as never);
    await svc.runPlanReview("run-1");

    const comment = linearClient.postComment.mock.calls.find((c: unknown[]) =>
      (c[1] as string).includes("approved"),
    );
    expect(comment).toBeDefined();
  });

  it("on changes_requested verdict: posts review feedback and delegates to runPlanRevision", async () => {
    const { deps, runRepo, artifactRepo, planReviewerAgent } = buildDeps();
    runRepo.findById.mockResolvedValue(makeRun({ state: RunState.PlanReview }));
    artifactRepo.findLatestByType.mockResolvedValue(makeArtifact({ type: "Plan", payloadJson: makePlan() }));
    planReviewerAgent.run.mockResolvedValue(
      makePlanReview({
        overallVerdict: "changes_requested",
        findings: [
          { id: "f1", severity: "important", type: "risk", title: "Missing rollback", details: "d" },
        ],
      }),
    );

    const svc = new OrchestratorService(deps as never);
    const revisionSpy = vi.spyOn(svc, "runPlanRevision").mockResolvedValue(makeRun());

    await svc.runPlanReview("run-1");

    expect(revisionSpy).toHaveBeenCalledWith("run-1");
  });
});

describe("OrchestratorService.runPlanRevision", () => {
  it("revises the plan, updates planVersion, transitions, and posts a combined comment", async () => {
    const { deps, runRepo, artifactRepo, planReviserAgent, linearClient } = buildDeps();
    runRepo.findById.mockResolvedValue(makeRun({ state: RunState.PlanRevision }));
    artifactRepo.findLatestByType.mockImplementation((_id: string, type: string) => {
      if (type === "Plan") return Promise.resolve(makeArtifact({ type: "Plan", payloadJson: makePlan() }));
      if (type === "PlanReview")
        return Promise.resolve(makeArtifact({ type: "PlanReview", payloadJson: makePlanReview() }));
      return Promise.resolve(null);
    });
    planReviserAgent.run.mockResolvedValue({
      revision: { dispositions: [{ findingId: "f1", disposition: "accepted" }] },
      revisedPlan: makePlan({ planVersion: 4 }),
    });
    runRepo.update.mockResolvedValue(makeRun({ state: RunState.PlanRevision, planVersion: 4 }));

    const svc = new OrchestratorService(deps as never);
    await svc.runPlanRevision("run-1");

    expect(runRepo.update).toHaveBeenCalledWith("run-1", { planVersion: 4 });
    expect(linearClient.postComment).toHaveBeenCalled();
  });

  it("passes an operatorNote to the reviser agent when opts.note is provided", async () => {
    const { deps, runRepo, artifactRepo, planReviserAgent } = buildDeps();
    runRepo.findById.mockResolvedValue(makeRun({ state: RunState.PlanRevision }));
    artifactRepo.findLatestByType.mockResolvedValue(makeArtifact({ type: "Plan", payloadJson: makePlan() }));

    runRepo.update.mockResolvedValue(makeRun({ state: RunState.PlanRevision }));
    const svc = new OrchestratorService(deps as never);
    await svc.runPlanRevision("run-1", { note: "please simplify" });

    expect(planReviserAgent.run).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.anything(),
      "run-1",
      { operatorNote: "please simplify" },
    );
  });

  it("passes undefined options to the reviser agent when no note is given", async () => {
    const { deps, runRepo, artifactRepo, planReviserAgent } = buildDeps();
    runRepo.findById.mockResolvedValue(makeRun({ state: RunState.PlanRevision }));
    artifactRepo.findLatestByType.mockResolvedValue(makeArtifact({ type: "Plan", payloadJson: makePlan() }));

    runRepo.update.mockResolvedValue(makeRun({ state: RunState.PlanRevision }));
    const svc = new OrchestratorService(deps as never);
    await svc.runPlanRevision("run-1");

    expect(planReviserAgent.run).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.anything(),
      "run-1",
      undefined,
    );
  });
});

describe("OrchestratorService.approvePlan", () => {
  it("throws when no Plan artifact exists", async () => {
    const { deps, runRepo, artifactRepo } = buildDeps();
    runRepo.findById.mockResolvedValue(makeRun());
    artifactRepo.findLatestByType.mockResolvedValue(null);
    const svc = new OrchestratorService(deps as never);

    await expect(svc.approvePlan("run-1")).rejects.toThrow(/No plan artifact found/);
  });

  it("sets approvedPlanVersion and posts a plain approval comment without a note", async () => {
    const { deps, runRepo, artifactRepo, linearClient } = buildDeps();
    runRepo.findById.mockResolvedValue(makeRun({ state: RunState.AwaitingPlanApproval }));
    artifactRepo.findLatestByType.mockResolvedValue(
      makeArtifact({ type: "Plan", payloadJson: makePlan({ planVersion: 3 }) }),
    );
    runRepo.update.mockResolvedValue(
      makeRun({ state: RunState.AwaitingPlanApproval, approvedPlanVersion: 3 }),
    );

    const svc = new OrchestratorService(deps as never);
    await svc.approvePlan("run-1");

    expect(runRepo.update).toHaveBeenCalledWith("run-1", { approvedPlanVersion: 3 });
    const comment = linearClient.postComment.mock.calls[0][1] as string;
    expect(comment).toContain("Plan v3 approved. Starting implementation");
    expect(comment).not.toContain("operator note");
  });

  it("includes the operator note in the approval comment when provided", async () => {
    const { deps, runRepo, artifactRepo, linearClient } = buildDeps();
    runRepo.findById.mockResolvedValue(makeRun({ state: RunState.AwaitingPlanApproval }));
    artifactRepo.findLatestByType.mockResolvedValue(
      makeArtifact({ type: "Plan", payloadJson: makePlan({ planVersion: 3 }) }),
    );
    runRepo.update.mockResolvedValue(
      makeRun({ state: RunState.AwaitingPlanApproval, approvedPlanVersion: 3 }),
    );

    const svc = new OrchestratorService(deps as never);
    await svc.approvePlan("run-1", { note: "ship it fast" });

    const comment = linearClient.postComment.mock.calls[0][1] as string;
    expect(comment).toContain("approved with operator note");
    expect(comment).toContain("ship it fast");
  });
});
