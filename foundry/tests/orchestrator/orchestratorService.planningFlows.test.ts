import { describe, it, expect, vi } from "vitest";
import { OrchestratorService } from "../../src/orchestrator/orchestratorService.js";
import { RunState } from "../../src/domain/runState.js";
import { RunEvent } from "../../src/domain/runEvent.js";
import type { Run, Artifact } from "../../src/domain/types.js";
import type { Plan } from "../../src/schemas/plan.js";
import type { PlanReview } from "../../src/schemas/planReview.js";

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
    state: RunState.Planning,
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

function makeArtifact(type: string, version: number, payloadJson: unknown): Artifact {
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
    create: vi.fn().mockResolvedValue({ id: "artifact-new" }),
    findByRunId: vi.fn(),
    findLatestByType: vi.fn().mockResolvedValue(null),
  };

  const eventRepo = {
    create: vi.fn().mockResolvedValue({ id: "event-new" }),
    findByRunId: vi.fn().mockResolvedValue([]),
  };

  const linearClient = {
    getIssue: vi.fn().mockResolvedValue({
      id: "LIN-1",
      title: "Test",
      description: "Test",
      branchName: "ai/run-1",
      labels: [],
      priority: 0,
    }),
    postComment: vi.fn().mockResolvedValue(undefined),
    getRelatedContext: vi.fn().mockResolvedValue({ blockers: [] }),
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
    postExecutionReportUpdate: vi.fn(),
  };

  const plannerAgent = { run: vi.fn() };
  const planReviewerAgent = { run: vi.fn() };
  const planReviserAgent = { run: vi.fn() };
  const executorAgent = { run: vi.fn() };
  const reviewerAgent = { run: vi.fn() };
  const remediationAgent = { run: vi.fn() };

  const gitService = {
    setupRunWorktree: vi.fn(),
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
    planReviserAgent,
  };
}

describe("OrchestratorService.runPlanning", () => {
  it("merges previousPlan, humanFeedback, humanAnswers, researchedAnswers and planReviewFindings into the planner call", async () => {
    const { deps, runRepo, artifactRepo, plannerAgent, planReviewerAgent } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    const run = makeRun({ state: RunState.Planning, planVersion: 2 });
    const previousPlan = makePlan({ planVersion: 2 });
    const rejectionPayload = { planVersion: 2, feedback: "Use OAuth2", source: "api", mode: "iterate" };
    const humanAnswersPayload = { answers: [{ questionId: "q1", answer: "Yes" }] };
    const researchedAnswersPayload = {
      summary: "s",
      answers: [{ questionId: "q1", question: "?", answer: "Resolved", confidence: "high", sources: [] }],
      completedAt: "2026-01-01T00:00:00Z",
    };
    const planReviewPayload = { summary: "needs fix", findings: [{ id: "f1", severity: "important", title: "t", details: "d" }] };

    const newPlan = makePlan({ planVersion: 3, openQuestions: [] });
    const planReviewRun = makeRun({ state: RunState.PlanReview, planVersion: 3 });
    const awaitingApprovalRun = makeRun({ state: RunState.AwaitingPlanApproval, planVersion: 3 });

    runRepo.findById.mockResolvedValueOnce(run).mockResolvedValue(planReviewRun);
    runRepo.updateState
      .mockResolvedValueOnce(planReviewRun) // PLAN_CREATED -> PlanReview
      .mockResolvedValueOnce(awaitingApprovalRun); // PLAN_REVIEW_APPROVED
    runRepo.update.mockResolvedValue({ ...run, planVersion: 3 });

    artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
      if (type === "RejectionContext") return Promise.resolve(makeArtifact("RejectionContext", 2, rejectionPayload));
      if (type === "Plan") return Promise.resolve(makeArtifact("Plan", 3, newPlan));
      if (type === "HumanAnswers") return Promise.resolve(makeArtifact("HumanAnswers", 1, humanAnswersPayload));
      if (type === "ResearchedAnswers") return Promise.resolve(makeArtifact("ResearchedAnswers", 1, researchedAnswersPayload));
      if (type === "PlanReview") return Promise.resolve(makeArtifact("PlanReview", 1, planReviewPayload));
      return Promise.resolve(null);
    });

    plannerAgent.run.mockResolvedValue(newPlan);
    planReviewerAgent.run.mockResolvedValue({ overallVerdict: "approved", summary: "ok", findings: [] });

    await svc.runPlanning("run-1");

    expect(plannerAgent.run).toHaveBeenCalledWith(
      expect.anything(),
      "run-1",
      expect.objectContaining({
        planVersionOverride: 3,
        humanFeedback: { planVersion: 2, feedback: "Use OAuth2" },
        humanAnswers: humanAnswersPayload.answers,
        researchedAnswers: researchedAnswersPayload.answers,
        planReviewFindings: { summary: "needs fix", findings: planReviewPayload.findings },
      }),
    );
    // previousPlan is passed too (checked separately -- it's the Plan artifact read at call time)
    expect(plannerAgent.run.mock.calls[0][2]).toMatchObject({ previousPlan: expect.objectContaining({ planVersion: 3 }) });
  });

  it("omits optional planner options entirely when no prior artifacts exist", async () => {
    const { deps, runRepo, artifactRepo, plannerAgent, planReviewerAgent } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    const run = makeRun({ state: RunState.Planning, planVersion: 1 });
    const newPlan = makePlan({ planVersion: 2, openQuestions: [] });
    const planReviewRun = makeRun({ state: RunState.PlanReview, planVersion: 2 });
    const awaitingApprovalRun = makeRun({ state: RunState.AwaitingPlanApproval, planVersion: 2 });

    runRepo.findById.mockResolvedValueOnce(run).mockResolvedValue(planReviewRun);
    runRepo.updateState
      .mockResolvedValueOnce(planReviewRun)
      .mockResolvedValueOnce(awaitingApprovalRun);
    runRepo.update.mockResolvedValue({ ...run, planVersion: 2 });

    // No prior Plan artifact exists at the start of runPlanning (hence no
    // previousPlan); once the planner produces a new plan, runPlanReview
    // reads it back via the same findLatestByType("Plan") call.
    artifactRepo.findLatestByType.mockImplementationOnce(() => Promise.resolve(null)); // RejectionContext
    artifactRepo.findLatestByType.mockImplementationOnce(() => Promise.resolve(null)); // Plan (previousPlan lookup)
    artifactRepo.findLatestByType.mockImplementationOnce(() => Promise.resolve(null)); // HumanAnswers
    artifactRepo.findLatestByType.mockImplementationOnce(() => Promise.resolve(null)); // ResearchedAnswers
    artifactRepo.findLatestByType.mockImplementationOnce(() => Promise.resolve(null)); // PlanReview
    artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
      if (type === "Plan") return Promise.resolve(makeArtifact("Plan", 2, newPlan));
      return Promise.resolve(null);
    });
    plannerAgent.run.mockResolvedValue(newPlan);
    planReviewerAgent.run.mockResolvedValue({ overallVerdict: "approved", summary: "ok", findings: [] });

    await svc.runPlanning("run-1");

    const opts = plannerAgent.run.mock.calls[0][2] as Record<string, unknown>;
    expect(opts).not.toHaveProperty("previousPlan");
    expect(opts).not.toHaveProperty("humanFeedback");
    expect(opts).not.toHaveProperty("humanAnswers");
    expect(opts).not.toHaveProperty("researchedAnswers");
    expect(opts).not.toHaveProperty("planReviewFindings");
    expect(opts.planVersionOverride).toBe(2);
  });

  it("pauses for human clarification instead of running plan review when blocking questions remain", async () => {
    const { deps, runRepo, artifactRepo, plannerAgent, planReviewerAgent } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    const run = makeRun({ state: RunState.Planning, planVersion: 1 });
    const planWithBlocker = makePlan({
      planVersion: 2,
      openQuestions: [{ id: "q1", question: "Critical?", requiredForExecution: true }],
    });
    const clarificationRun = makeRun({ state: RunState.HumanClarificationNeeded, planVersion: 2 });

    runRepo.findById.mockResolvedValue(run);
    runRepo.updateState
      .mockResolvedValueOnce(makeRun({ state: RunState.PlanReview, planVersion: 2 })) // PLAN_CREATED
      .mockResolvedValueOnce(clarificationRun); // NEEDS_HUMAN_CLARIFICATION
    runRepo.update.mockResolvedValue({ ...run, planVersion: 2 });

    artifactRepo.findLatestByType.mockResolvedValue(null);
    plannerAgent.run.mockResolvedValue(planWithBlocker);

    const result = await svc.runPlanning("run-1");

    expect(planReviewerAgent.run).not.toHaveBeenCalled();
    expect(result.state).toBe(RunState.HumanClarificationNeeded);
  });
});

describe("OrchestratorService.runPlanReview", () => {
  it("throws when no Plan artifact exists for the run", async () => {
    const { deps, runRepo, artifactRepo } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    runRepo.findById.mockResolvedValue(makeRun({ state: RunState.PlanReview }));
    artifactRepo.findLatestByType.mockResolvedValue(null);

    await expect(svc.runPlanReview("run-1")).rejects.toThrow(/No plan artifact found/);
  });

  it("approved verdict: transitions to AwaitingPlanApproval and posts the approved plan comment", async () => {
    const { deps, runRepo, artifactRepo, linearClient, planReviewerAgent } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    const run = makeRun({ state: RunState.PlanReview });
    const plan = makePlan();
    const awaitingApprovalRun = makeRun({ state: RunState.AwaitingPlanApproval });

    runRepo.findById.mockResolvedValue(run);
    runRepo.updateState.mockResolvedValue(awaitingApprovalRun);
    artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
      if (type === "Plan") return Promise.resolve(makeArtifact("Plan", 1, plan));
      return Promise.resolve(null);
    });
    planReviewerAgent.run.mockResolvedValue({ overallVerdict: "approved", summary: "Great", findings: [] });

    const result = await svc.runPlanReview("run-1");

    expect(result.state).toBe(RunState.AwaitingPlanApproval);
    const call = runRepo.updateState.mock.calls[0];
    expect(call[1]).toBe(RunState.AwaitingPlanApproval);
    expect(linearClient.postComment).toHaveBeenCalledWith(
      run.linearIssueId,
      expect.stringContaining("AI plan review: approved"),
    );
  });

  it("changes_requested verdict: transitions to PlanRevision, posts findings, then runs plan revision", async () => {
    const { deps, runRepo, artifactRepo, linearClient, planReviewerAgent, planReviserAgent } =
      buildDeps();
    const svc = new OrchestratorService(deps as never);

    const run = makeRun({ state: RunState.PlanReview, planVersion: 1 });
    const plan = makePlan({ planVersion: 1 });
    const planReview: PlanReview = {
      overallVerdict: "changes_requested",
      summary: "Needs work",
      findings: [
        { id: "f1", severity: "important", title: "Issue", details: "Fix this", affectedStepId: "s1" },
      ],
    };
    const revisedPlan = makePlan({ planVersion: 2 });
    const planRevisionRun = makeRun({ state: RunState.PlanRevision, planVersion: 1 });
    const awaitingApprovalRun = makeRun({ state: RunState.AwaitingPlanApproval, planVersion: 2 });

    runRepo.findById.mockResolvedValue(run);
    runRepo.updateState
      .mockResolvedValueOnce(planRevisionRun) // PLAN_REVIEW_CHANGES_REQUESTED
      .mockResolvedValueOnce(awaitingApprovalRun); // PLAN_REVISED
    runRepo.update.mockResolvedValue({ ...planRevisionRun, planVersion: 2 });

    artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
      if (type === "Plan") return Promise.resolve(makeArtifact("Plan", 1, plan));
      if (type === "PlanReview") return Promise.resolve(makeArtifact("PlanReview", 1, planReview));
      return Promise.resolve(null);
    });
    planReviewerAgent.run.mockResolvedValue(planReview);
    planReviserAgent.run.mockResolvedValue({
      revision: { dispositions: [{ findingId: "f1", status: "accepted", rationale: "Fixed" }] },
      revisedPlan,
    });

    const result = await svc.runPlanReview("run-1");

    expect(linearClient.postComment).toHaveBeenCalledWith(
      run.linearIssueId,
      expect.stringContaining("Changes Requested"),
    );
    expect(planReviserAgent.run).toHaveBeenCalledWith(plan, planReview, expect.anything(), "run-1", undefined);
    expect(result.state).toBe(RunState.AwaitingPlanApproval);
  });
});

describe("OrchestratorService.runPlanRevision", () => {
  it("passes operatorNote through to the plan reviser agent when opts.note is provided", async () => {
    const { deps, runRepo, artifactRepo, linearClient, planReviserAgent } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    const run = makeRun({ state: RunState.PlanRevision, planVersion: 1 });
    const plan = makePlan({ planVersion: 1 });
    const planReview: PlanReview = { overallVerdict: "changes_requested", summary: "s", findings: [] };
    const revisedPlan = makePlan({ planVersion: 2 });
    const awaitingApprovalRun = makeRun({ state: RunState.AwaitingPlanApproval, planVersion: 2 });

    runRepo.findById.mockResolvedValue(run);
    runRepo.update.mockResolvedValue({ ...run, planVersion: 2 });
    runRepo.updateState.mockResolvedValue(awaitingApprovalRun);

    artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
      if (type === "Plan") return Promise.resolve(makeArtifact("Plan", 1, plan));
      if (type === "PlanReview") return Promise.resolve(makeArtifact("PlanReview", 1, planReview));
      return Promise.resolve(null);
    });
    planReviserAgent.run.mockResolvedValue({
      revision: { dispositions: [{ findingId: "f1", status: "rejected", rationale: "Not valid" }] },
      revisedPlan,
    });

    await svc.runPlanRevision("run-1", { note: "Operator says keep it simple" });

    expect(planReviserAgent.run).toHaveBeenCalledWith(plan, planReview, expect.anything(), "run-1", {
      operatorNote: "Operator says keep it simple",
    });
    expect(runRepo.update).toHaveBeenCalledWith("run-1", { planVersion: 2 });

    const comment = linearClient.postComment.mock.calls[0][1] as string;
    expect(comment).toContain("Plan Revision Dispositions");
    expect(comment).toContain("Not valid");
  });

  it("passes undefined options when no note is provided", async () => {
    const { deps, runRepo, artifactRepo, planReviserAgent } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    const run = makeRun({ state: RunState.PlanRevision, planVersion: 1 });
    const plan = makePlan({ planVersion: 1 });
    const planReview: PlanReview = { overallVerdict: "changes_requested", summary: "s", findings: [] };
    const revisedPlan = makePlan({ planVersion: 2 });

    runRepo.findById.mockResolvedValue(run);
    runRepo.update.mockResolvedValue({ ...run, planVersion: 2 });
    runRepo.updateState.mockResolvedValue(makeRun({ state: RunState.AwaitingPlanApproval, planVersion: 2 }));

    artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
      if (type === "Plan") return Promise.resolve(makeArtifact("Plan", 1, plan));
      if (type === "PlanReview") return Promise.resolve(makeArtifact("PlanReview", 1, planReview));
      return Promise.resolve(null);
    });
    planReviserAgent.run.mockResolvedValue({
      revision: { dispositions: [] },
      revisedPlan,
    });

    await svc.runPlanRevision("run-1");

    expect(planReviserAgent.run).toHaveBeenCalledWith(plan, planReview, expect.anything(), "run-1", undefined);
  });
});
