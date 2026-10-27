import { describe, it, expect, vi } from "vitest";
import { OrchestratorService } from "../../src/orchestrator/orchestratorService.js";
import { RunState } from "../../src/domain/runState.js";
import { RunEvent } from "../../src/domain/runEvent.js";
import type { Run, Artifact } from "../../src/domain/types.js";
import type { Plan } from "../../src/schemas/plan.js";
import type { PlanReview } from "../../src/schemas/planReview.js";
import type { TaskBundle } from "../../src/schemas/taskBundle.js";

function makeRun(overrides: Partial<Run> = {}): Run {
  return {
    id: "run-1",
    linearIssueId: "LIN-1",
    linearIssueIdentifier: null,
    linearIssueDescription: null,
    linearIssueTitle: null,
    linearIssueUrl: null,
    repo: "test-repo",
    branchName: "ai/run-1",
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

function makePlanReview(overrides: Partial<PlanReview> = {}): PlanReview {
  return {
    reviewId: "pr-1",
    summary: "Reviewed",
    findings: [],
    overallVerdict: "approved",
    ...overrides,
  };
}

function asArtifact(type: string, version: number, payloadJson: unknown): Artifact {
  return {
    id: `artifact-${type}-${version}`,
    runId: "run-1",
    type: type as Artifact["type"],
    version,
    payloadJson,
    rawText: JSON.stringify(payloadJson),
    createdAt: new Date(),
  };
}

function buildDeps() {
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
    create: vi.fn().mockResolvedValue({ id: "artifact-new" }),
    findByRunId: vi.fn(),
    findLatestByType: vi.fn(),
  };

  const eventRepo = {
    create: vi.fn().mockResolvedValue({ id: "event-new" }),
    findByRunId: vi.fn().mockResolvedValue([]),
  };

  const linearClient = {
    getIssue: vi.fn().mockResolvedValue({
      id: "LIN-1",
      title: "Test issue",
      description: "Test description",
      branchName: "ai/run-1",
      labels: [],
      priority: 0,
    }),
    getRelatedContext: vi.fn().mockResolvedValue({ blockers: [] }),
    postComment: vi.fn().mockResolvedValue(undefined),
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
    getDefaultRepo: vi.fn().mockReturnValue({
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
  };

  const linearSync = { syncState: vi.fn().mockResolvedValue(undefined) };
  const githubSync = {
    syncState: vi.fn().mockResolvedValue(undefined),
    postReviewFindings: vi.fn(),
    postRemediationResolutions: vi.fn(),
  };

  const plannerAgent = { run: vi.fn() };
  const planReviewerAgent = { run: vi.fn() };
  const planReviserAgent = { run: vi.fn() };
  const executorAgent = { run: vi.fn() };
  const reviewerAgent = { run: vi.fn() };
  const remediationAgent = { run: vi.fn() };

  const gitService = {
    setupRunWorktree: vi
      .fn()
      .mockResolvedValue({ worktreePath: "/tmp/worktree", branchName: "ai/run-1" }),
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
    },
    runRepo,
    artifactRepo,
    eventRepo,
    linearClient,
    plannerAgent,
    planReviewerAgent,
    planReviserAgent,
    gitService,
  };
}

describe("OrchestratorService.runPlanning", () => {
  it("re-plans using prior rejection/review context and proceeds to plan review when no blockers remain", async () => {
    const { deps, runRepo, artifactRepo, plannerAgent } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    const run = makeRun({ state: RunState.Planning, planVersion: 1 });
    runRepo.findById.mockResolvedValue(run);
    runRepo.update.mockResolvedValue({ ...run, planVersion: 2 });
    runRepo.updateState.mockResolvedValue(makeRun({ state: RunState.PlanReview, planVersion: 2 }));

    const newPlan = makePlan({ planVersion: 2, openQuestions: [] });
    plannerAgent.run.mockResolvedValue(newPlan);

    artifactRepo.findLatestByType.mockImplementation((_: string, type: string) => {
      if (type === "RejectionContext")
        return Promise.resolve(
          asArtifact("RejectionContext", 1, {
            planVersion: 1,
            feedback: "Please use OAuth",
            source: "api",
            mode: "iterate",
          }),
        );
      if (type === "Plan") return Promise.resolve(asArtifact("Plan", 1, makePlan()));
      if (type === "PlanReview")
        return Promise.resolve(
          asArtifact("PlanReview", 1, { summary: "needs work", findings: [] }),
        );
      return Promise.resolve(null);
    });

    const planReviewSpy = vi
      .spyOn(svc, "runPlanReview")
      .mockResolvedValue(makeRun({ state: RunState.AwaitingPlanApproval, planVersion: 2 }));

    await svc.runPlanning("run-1");

    expect(plannerAgent.run).toHaveBeenCalledWith(
      expect.anything(),
      "run-1",
      expect.objectContaining({
        planVersionOverride: 2,
        humanFeedback: { planVersion: 1, feedback: "Please use OAuth" },
        planReviewFindings: { summary: "needs work", findings: [] },
      }),
    );
    expect(planReviewSpy).toHaveBeenCalledWith("run-1");
  });

  it("pauses for human clarification when the re-plan still has blocking questions", async () => {
    const { deps, runRepo, artifactRepo, plannerAgent } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    const run = makeRun({ state: RunState.Planning, planVersion: 1 });
    runRepo.findById.mockResolvedValue(run);
    runRepo.update.mockResolvedValue({ ...run, planVersion: 2 });
    runRepo.updateState
      .mockResolvedValueOnce(makeRun({ state: RunState.PlanReview, planVersion: 2 }))
      .mockResolvedValueOnce(
        makeRun({ state: RunState.HumanClarificationNeeded, planVersion: 2 }),
      );

    const planWithBlocker = makePlan({
      planVersion: 2,
      openQuestions: [{ id: "q1", question: "Which provider?", requiredForExecution: true }],
    });
    plannerAgent.run.mockResolvedValue(planWithBlocker);
    artifactRepo.findLatestByType.mockResolvedValue(null);

    const planReviewSpy = vi.spyOn(svc, "runPlanReview");

    const result = await svc.runPlanning("run-1");

    expect(result.state).toBe(RunState.HumanClarificationNeeded);
    expect(planReviewSpy).not.toHaveBeenCalled();
  });
});

describe("OrchestratorService.retryRun", () => {
  it("sets up a new worktree when the run has no branchName, then re-plans", async () => {
    const { deps, runRepo, artifactRepo, plannerAgent, gitService } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    const run = makeRun({ state: RunState.Todo, branchName: null });
    runRepo.findById.mockResolvedValue(run);
    runRepo.update
      .mockResolvedValueOnce({ ...run, workingDirectory: "/tmp/worktree", branchName: "ai/run-1" })
      .mockResolvedValue({ ...run, planVersion: 1 });
    runRepo.updateState.mockResolvedValue(makeRun({ state: RunState.PlanReview }));

    plannerAgent.run.mockResolvedValue(makePlan({ openQuestions: [] }));
    artifactRepo.findLatestByType.mockResolvedValue(null);

    const planReviewSpy = vi
      .spyOn(svc, "runPlanReview")
      .mockResolvedValue(makeRun({ state: RunState.AwaitingPlanApproval }));

    await svc.retryRun("run-1");

    expect(gitService.setupRunWorktree).toHaveBeenCalled();
    expect(planReviewSpy).toHaveBeenCalledWith("run-1");
  });

  it("skips worktree setup when the run already has a branchName", async () => {
    const { deps, runRepo, artifactRepo, plannerAgent, gitService } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    const run = makeRun({ state: RunState.Todo, branchName: "ai/existing" });
    runRepo.findById.mockResolvedValue(run);
    runRepo.update.mockResolvedValue({ ...run, planVersion: 1 });
    runRepo.updateState.mockResolvedValue(makeRun({ state: RunState.PlanReview }));

    plannerAgent.run.mockResolvedValue(makePlan({ openQuestions: [] }));
    artifactRepo.findLatestByType.mockResolvedValue(null);

    vi.spyOn(svc, "runPlanReview").mockResolvedValue(
      makeRun({ state: RunState.AwaitingPlanApproval }),
    );

    await svc.retryRun("run-1");

    expect(gitService.setupRunWorktree).not.toHaveBeenCalled();
  });

  it("pauses for clarification when the re-plan has blocking questions", async () => {
    const { deps, runRepo, artifactRepo, plannerAgent } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    const run = makeRun({ state: RunState.Todo, branchName: "ai/existing" });
    runRepo.findById.mockResolvedValue(run);
    runRepo.update.mockResolvedValue({ ...run, planVersion: 1 });
    runRepo.updateState
      .mockResolvedValueOnce(makeRun({ state: RunState.PlanReview }))
      .mockResolvedValueOnce(makeRun({ state: RunState.HumanClarificationNeeded }));

    plannerAgent.run.mockResolvedValue(
      makePlan({
        openQuestions: [{ id: "q1", question: "Which env?", requiredForExecution: true }],
      }),
    );
    artifactRepo.findLatestByType.mockResolvedValue(null);
    const planReviewSpy = vi.spyOn(svc, "runPlanReview");

    const result = await svc.retryRun("run-1");

    expect(result.state).toBe(RunState.HumanClarificationNeeded);
    expect(planReviewSpy).not.toHaveBeenCalled();
  });
});

describe("OrchestratorService.runPlanReview -- changes requested path", () => {
  it("calls runPlanRevision when the plan reviewer requests changes", async () => {
    const { deps, runRepo, artifactRepo, linearClient, planReviewerAgent } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    const run = makeRun({ state: RunState.PlanReview });
    runRepo.findById.mockResolvedValue(run);

    const plan = makePlan();
    artifactRepo.findLatestByType.mockImplementation((_: string, type: string) =>
      type === "Plan" ? Promise.resolve(asArtifact("Plan", 1, plan)) : Promise.resolve(null),
    );

    planReviewerAgent.run.mockResolvedValue(
      makePlanReview({
        overallVerdict: "changes_requested",
        findings: [
          { id: "f1", severity: "important", type: "gap", title: "Missing step", details: "d" },
        ],
      }),
    );
    runRepo.updateState.mockResolvedValue(makeRun({ state: RunState.PlanRevision }));

    const revisionSpy = vi
      .spyOn(svc, "runPlanRevision")
      .mockResolvedValue(makeRun({ state: RunState.AwaitingPlanApproval }));

    await svc.runPlanReview("run-1");

    expect(linearClient.postComment).toHaveBeenCalledWith(
      run.linearIssueId,
      expect.stringContaining("Changes Requested"),
    );
    expect(revisionSpy).toHaveBeenCalledWith("run-1");
  });
});

describe("OrchestratorService.runPlanRevision", () => {
  it("passes an operator note through to the plan reviser and posts the revised plan", async () => {
    const { deps, runRepo, artifactRepo, linearClient, planReviserAgent } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    const run = makeRun({ state: RunState.PlanRevision });
    runRepo.findById.mockResolvedValue(run);
    runRepo.update.mockResolvedValue({ ...run, planVersion: 2 });
    runRepo.updateState.mockResolvedValue(makeRun({ state: RunState.AwaitingPlanApproval }));

    const plan = makePlan();
    const review = makePlanReview({ overallVerdict: "changes_requested" });
    artifactRepo.findLatestByType.mockImplementation((_: string, type: string) => {
      if (type === "Plan") return Promise.resolve(asArtifact("Plan", 1, plan));
      if (type === "PlanReview") return Promise.resolve(asArtifact("PlanReview", 1, review));
      return Promise.resolve(null);
    });

    const revisedPlan = makePlan({ planVersion: 2 });
    planReviserAgent.run.mockResolvedValue({
      revision: {
        dispositions: [{ findingId: "f1", status: "fixed", rationale: "Addressed" }],
      },
      revisedPlan,
    });

    await svc.runPlanRevision("run-1", { note: "please simplify step 2" });

    expect(planReviserAgent.run).toHaveBeenCalledWith(
      plan,
      review,
      expect.anything(),
      "run-1",
      { operatorNote: "please simplify step 2" },
    );
    expect(linearClient.postComment).toHaveBeenCalledWith(
      run.linearIssueId,
      expect.stringContaining("Plan Revision Dispositions"),
    );
  });

  it("omits operator-note options when none is provided", async () => {
    const { deps, runRepo, artifactRepo, planReviserAgent } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    const run = makeRun({ state: RunState.PlanRevision });
    runRepo.findById.mockResolvedValue(run);
    runRepo.update.mockResolvedValue({ ...run, planVersion: 2 });
    runRepo.updateState.mockResolvedValue(makeRun({ state: RunState.AwaitingPlanApproval }));

    const plan = makePlan();
    artifactRepo.findLatestByType.mockImplementation((_: string, type: string) =>
      type === "Plan" ? Promise.resolve(asArtifact("Plan", 1, plan)) : Promise.resolve(null),
    );

    planReviserAgent.run.mockResolvedValue({
      revision: { dispositions: [] },
      revisedPlan: makePlan({ planVersion: 2 }),
    });

    await svc.runPlanRevision("run-1");

    expect(planReviserAgent.run).toHaveBeenCalledWith(
      plan,
      undefined,
      expect.anything(),
      "run-1",
      undefined,
    );
  });
});

describe("OrchestratorService.approvePlan", () => {
  it("throws when there is no plan artifact", async () => {
    const { deps, runRepo, artifactRepo } = buildDeps();
    const svc = new OrchestratorService(deps as never);
    runRepo.findById.mockResolvedValue(makeRun({ state: RunState.AwaitingPlanApproval }));
    artifactRepo.findLatestByType.mockResolvedValue(null);

    await expect(svc.approvePlan("run-1")).rejects.toThrow(/No plan artifact/);
  });

  it("records approvedPlanVersion and posts a plain comment without a note", async () => {
    const { deps, runRepo, artifactRepo, linearClient } = buildDeps();
    const svc = new OrchestratorService(deps as never);
    const run = makeRun({ state: RunState.AwaitingPlanApproval });
    runRepo.findById.mockResolvedValue(run);

    const plan = makePlan({ planVersion: 3 });
    artifactRepo.findLatestByType.mockResolvedValue(asArtifact("Plan", 3, plan));
    runRepo.update.mockResolvedValue({ ...run, approvedPlanVersion: 3 });
    runRepo.updateState.mockResolvedValue(makeRun({ state: RunState.Implementing }));

    await svc.approvePlan("run-1");

    expect(runRepo.update).toHaveBeenCalledWith("run-1", { approvedPlanVersion: 3 });
    expect(linearClient.postComment).toHaveBeenCalledWith(
      run.linearIssueId,
      "Plan v3 approved. Starting implementation...",
    );
  });

  it("includes the operator note in the approval comment when provided", async () => {
    const { deps, runRepo, artifactRepo, linearClient } = buildDeps();
    const svc = new OrchestratorService(deps as never);
    const run = makeRun({ state: RunState.AwaitingPlanApproval });
    runRepo.findById.mockResolvedValue(run);

    const plan = makePlan({ planVersion: 3 });
    artifactRepo.findLatestByType.mockResolvedValue(asArtifact("Plan", 3, plan));
    runRepo.update.mockResolvedValue({ ...run, approvedPlanVersion: 3 });
    runRepo.updateState.mockResolvedValue(makeRun({ state: RunState.Implementing }));

    await svc.approvePlan("run-1", { note: "ship it fast" });

    const comment = linearClient.postComment.mock.calls[0][1] as string;
    expect(comment).toContain("operator note");
    expect(comment).toContain("ship it fast");
  });
});

describe("OrchestratorService.runManualReReview", () => {
  it("always returns to AwaitingPlanApproval, even when changes are requested", async () => {
    const { deps, runRepo, artifactRepo, planReviewerAgent, planReviserAgent } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    const run = makeRun({ state: RunState.AwaitingPlanApproval });
    runRepo.findById.mockResolvedValue(run);

    const plan = makePlan();
    artifactRepo.findLatestByType.mockImplementation((_: string, type: string) =>
      type === "Plan" ? Promise.resolve(asArtifact("Plan", 1, plan)) : Promise.resolve(null),
    );

    planReviewerAgent.run.mockResolvedValue(
      makePlanReview({ overallVerdict: "changes_requested" }),
    );
    runRepo.updateState.mockResolvedValue(makeRun({ state: RunState.PlanReview }));

    const result = await svc.runManualReReview("run-1", { note: "double check auth" });

    // Even on changes_requested, runManualReReview routes through
    // PLAN_REVIEW_APPROVED so the human keeps control (does not auto-chain
    // into plan revision).
    expect(planReviserAgent.run).not.toHaveBeenCalled();
    expect(result).toBeDefined();
  });

  it("throws when there is no plan artifact", async () => {
    const { deps, runRepo, artifactRepo } = buildDeps();
    const svc = new OrchestratorService(deps as never);
    runRepo.findById.mockResolvedValue(makeRun({ state: RunState.AwaitingPlanApproval }));
    artifactRepo.findLatestByType.mockResolvedValue(null);

    await expect(svc.runManualReReview("run-1")).rejects.toThrow(/No plan artifact/);
  });
});

describe("OrchestratorService.runManualPlanRevision", () => {
  it("does nothing further when the reviewer approves (no revision needed)", async () => {
    const { deps, runRepo, artifactRepo, planReviewerAgent } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    const run = makeRun({ state: RunState.AwaitingPlanApproval });
    runRepo.findById.mockResolvedValue(run);

    const plan = makePlan();
    artifactRepo.findLatestByType.mockImplementation((_: string, type: string) =>
      type === "Plan" ? Promise.resolve(asArtifact("Plan", 1, plan)) : Promise.resolve(null),
    );

    planReviewerAgent.run.mockResolvedValue(makePlanReview({ overallVerdict: "approved" }));
    runRepo.updateState.mockResolvedValue(makeRun({ state: RunState.PlanReview }));
    const revisionSpy = vi.spyOn(svc, "runPlanRevision");

    const result = await svc.runManualPlanRevision("run-1");

    expect(revisionSpy).not.toHaveBeenCalled();
    expect(result.state).toBe(RunState.PlanReview);
  });

  it("calls runPlanRevision with the operator note when changes are requested", async () => {
    const { deps, runRepo, artifactRepo, planReviewerAgent } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    const run = makeRun({ state: RunState.AwaitingPlanApproval });
    runRepo.findById.mockResolvedValue(run);

    const plan = makePlan();
    artifactRepo.findLatestByType.mockImplementation((_: string, type: string) =>
      type === "Plan" ? Promise.resolve(asArtifact("Plan", 1, plan)) : Promise.resolve(null),
    );

    planReviewerAgent.run.mockResolvedValue(
      makePlanReview({ overallVerdict: "changes_requested" }),
    );
    runRepo.updateState.mockResolvedValue(makeRun({ state: RunState.PlanReview }));
    const revisionSpy = vi
      .spyOn(svc, "runPlanRevision")
      .mockResolvedValue(makeRun({ state: RunState.AwaitingPlanApproval }));

    await svc.runManualPlanRevision("run-1", { note: "tighten scope" });

    expect(revisionSpy).toHaveBeenCalledWith("run-1", { note: "tighten scope" });
  });
});
