import { describe, it, expect, vi } from "vitest";
import { OrchestratorService } from "../../src/orchestrator/orchestratorService.js";
import { RunState } from "../../src/domain/runState.js";
import type { Run } from "../../src/domain/types.js";
import type { Plan } from "../../src/schemas/plan.js";
import type { TaskBundle } from "../../src/schemas/taskBundle.js";

function makeRun(overrides: Partial<Run> = {}): Run {
  return {
    id: "run-1",
    linearIssueId: "LIN-1",
    linearIssueIdentifier: "ENG-1",
    linearIssueDescription: "desc",
    linearIssueTitle: "title",
    linearIssueUrl: "https://linear.app/x",
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
    workingDirectory: "/work",
    latestArtifactVersion: 0,
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

function makeBundle(): TaskBundle {
  return {
    issue: { id: "LIN-1", title: "title", description: "desc", labels: [], priority: 0 },
    repo: {
      name: "test-repo",
      defaultBranch: "main",
      workingBranch: "ai/run-1",
      repoPath: "/work",
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
    findLatestByType: vi.fn().mockResolvedValue(null),
  };
  const eventRepo = { create: vi.fn().mockResolvedValue({}), findByRunId: vi.fn().mockResolvedValue([]) };
  const linearClient = {
    getIssue: vi.fn(),
    postComment: vi.fn().mockResolvedValue(undefined),
    getRelatedContext: vi.fn().mockResolvedValue({ blockers: [] }),
  };
  const githubClient = { getPRDiff: vi.fn() };
  const repoEntry = {
    name: "test-repo",
    directory: "/repos/test-repo",
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
  };
  const repoRegistry = {
    resolveForIssue: vi.fn().mockReturnValue(repoEntry),
    resolveWorkingDirectory: vi.fn().mockReturnValue("/work"),
    validateWorkingDirectory: vi.fn(),
    getRepoByName: vi.fn().mockReturnValue(repoEntry),
    getDefaultRepo: vi.fn().mockReturnValue(repoEntry),
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
    setupRunWorktree: vi.fn().mockResolvedValue({ worktreePath: "/work/wt", branchName: "ai/run-1" }),
    assertBranch: vi.fn().mockResolvedValue(undefined),
    commitAndPush: vi.fn().mockResolvedValue(undefined),
    removeWorktree: vi.fn().mockResolvedValue(undefined),
    resolveMainRepoPath: vi.fn().mockReturnValue("/work"),
  };
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };

  return {
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
  };
}

describe("OrchestratorService.startRun", () => {
  it("returns the existing active run without creating anything when one is already active for the issue", async () => {
    const deps = buildDeps();
    const existingRun = makeRun({ id: "existing-run", state: RunState.Implementing });
    deps.runRepo.findActiveByIssueId.mockResolvedValue(existingRun);

    const svc = new OrchestratorService(deps as never);
    const result = await svc.startRun("LIN-1");

    expect(result).toBe(existingRun);
    expect(deps.runRepo.create).not.toHaveBeenCalled();
    expect(deps.linearClient.getIssue).not.toHaveBeenCalled();
  });

  it("creates a run, transitions Todo->Planning->PlanReview, and hands off to runPlanReview when there are no blocking questions", async () => {
    const deps = buildDeps();
    deps.runRepo.findActiveByIssueId.mockResolvedValue(null);
    deps.linearClient.getIssue.mockResolvedValue({
      id: "LIN-1",
      identifier: "ENG-1",
      title: "title",
      description: "desc",
      branchName: "ai/x",
      state: "Todo",
      labels: [],
      priority: 0,
      url: "https://linear.app/x",
      project: "proj",
    });

    const createdRun = makeRun({ id: "run-1", state: RunState.Todo });
    deps.runRepo.create.mockResolvedValue(createdRun);
    const plan = makePlan({ openQuestions: [] });
    deps.runRepo.update
      .mockResolvedValueOnce(
        makeRun({ id: "run-1", state: RunState.Todo, workingDirectory: "/work/wt", branchName: "ai/run-1" }),
      )
      .mockResolvedValueOnce(
        makeRun({ id: "run-1", state: RunState.Planning, planVersion: plan.planVersion }),
      );
    deps.runRepo.updateState
      .mockResolvedValueOnce(makeRun({ id: "run-1", state: RunState.Planning }))
      .mockResolvedValueOnce(makeRun({ id: "run-1", state: RunState.PlanReview }));

    deps.plannerAgent.run.mockResolvedValue(plan);

    const svc = new OrchestratorService(deps as never);
    vi.spyOn(svc as unknown as { buildTaskBundle: (...a: unknown[]) => Promise<TaskBundle> }, "buildTaskBundle").mockResolvedValue(
      makeBundle(),
    );
    vi.spyOn(
      svc as unknown as { retrieveSkillsForPlanning: (...a: unknown[]) => Promise<unknown[]> },
      "retrieveSkillsForPlanning",
    ).mockResolvedValue([]);
    vi.spyOn(
      svc as unknown as { maybeResearchAndReplan: (...a: unknown[]) => Promise<unknown> },
      "maybeResearchAndReplan",
    ).mockImplementation(async (run: unknown, p: unknown) => ({ run, plan: p }));
    const finalRun = makeRun({ id: "run-1", state: RunState.AwaitingPlanApproval });
    const runPlanReviewSpy = vi.spyOn(svc, "runPlanReview").mockResolvedValue(finalRun);

    const result = await svc.startRun("LIN-1");

    expect(deps.runRepo.create).toHaveBeenCalledTimes(1);
    expect(deps.linearClient.postComment).toHaveBeenCalledWith(
      "LIN-1",
      expect.stringContaining("AI planning started"),
    );
    expect(runPlanReviewSpy).toHaveBeenCalledWith("run-1");
    expect(result).toBe(finalRun);
  });

  it("pauses for human clarification and never calls runPlanReview when the plan has blocking open questions", async () => {
    const deps = buildDeps();
    deps.runRepo.findActiveByIssueId.mockResolvedValue(null);
    deps.linearClient.getIssue.mockResolvedValue({
      id: "LIN-1",
      identifier: "ENG-1",
      title: "title",
      description: "desc",
      branchName: "ai/x",
      state: "Todo",
      labels: [],
      priority: 0,
    });

    const createdRun = makeRun({ id: "run-1", state: RunState.Todo });
    deps.runRepo.create.mockResolvedValue(createdRun);
    deps.runRepo.update
      .mockResolvedValueOnce(createdRun)
      .mockResolvedValueOnce(makeRun({ id: "run-1", state: RunState.Planning }));
    deps.runRepo.updateState
      .mockResolvedValueOnce(makeRun({ id: "run-1", state: RunState.Planning }))
      .mockResolvedValueOnce(makeRun({ id: "run-1", state: RunState.PlanReview }))
      .mockResolvedValueOnce(makeRun({ id: "run-1", state: RunState.HumanClarificationNeeded }));

    const plan = makePlan({
      openQuestions: [{ id: "q1", question: "Which DB?", requiredForExecution: true }],
    });
    deps.plannerAgent.run.mockResolvedValue(plan);

    const svc = new OrchestratorService(deps as never);
    vi.spyOn(svc as unknown as { buildTaskBundle: (...a: unknown[]) => Promise<TaskBundle> }, "buildTaskBundle").mockResolvedValue(
      makeBundle(),
    );
    vi.spyOn(
      svc as unknown as { retrieveSkillsForPlanning: (...a: unknown[]) => Promise<unknown[]> },
      "retrieveSkillsForPlanning",
    ).mockResolvedValue([]);
    vi.spyOn(
      svc as unknown as { maybeResearchAndReplan: (...a: unknown[]) => Promise<unknown> },
      "maybeResearchAndReplan",
    ).mockImplementation(async (run: unknown, p: unknown) => ({ run, plan: p }));
    const runPlanReviewSpy = vi.spyOn(svc, "runPlanReview");

    await svc.startRun("LIN-1");

    expect(runPlanReviewSpy).not.toHaveBeenCalled();
  });
});

describe("OrchestratorService.retryRun", () => {
  it("throws when the run does not exist", async () => {
    const deps = buildDeps();
    deps.runRepo.findById.mockResolvedValue(null);
    const svc = new OrchestratorService(deps as never);

    await expect(svc.retryRun("missing-run")).rejects.toThrow("Run not found: missing-run");
  });

  it("skips worktree setup when the run already has a branchName, then reaches runPlanReview", async () => {
    const deps = buildDeps();
    const run = makeRun({ id: "run-1", state: RunState.Todo, branchName: "ai/existing" });
    deps.runRepo.findById.mockResolvedValue(run);
    deps.linearClient.getIssue.mockResolvedValue({
      id: "LIN-1",
      title: "title",
      description: "desc",
      branchName: "ai/existing",
      state: "Todo",
      labels: [],
      priority: 0,
    });
    deps.runRepo.updateState
      .mockResolvedValueOnce(makeRun({ id: "run-1", state: RunState.Planning }))
      .mockResolvedValueOnce(makeRun({ id: "run-1", state: RunState.PlanReview }));
    deps.plannerAgent.run.mockResolvedValue(makePlan({ openQuestions: [] }));

    const svc = new OrchestratorService(deps as never);
    vi.spyOn(svc as unknown as { buildTaskBundle: (...a: unknown[]) => Promise<TaskBundle> }, "buildTaskBundle").mockResolvedValue(
      makeBundle(),
    );
    vi.spyOn(
      svc as unknown as { retrieveSkillsForPlanning: (...a: unknown[]) => Promise<unknown[]> },
      "retrieveSkillsForPlanning",
    ).mockResolvedValue([]);
    vi.spyOn(
      svc as unknown as { maybeResearchAndReplan: (...a: unknown[]) => Promise<unknown> },
      "maybeResearchAndReplan",
    ).mockImplementation(async (r: unknown, p: unknown) => ({ run: r, plan: p }));
    const runPlanReviewSpy = vi
      .spyOn(svc, "runPlanReview")
      .mockResolvedValue(makeRun({ state: RunState.AwaitingPlanApproval }));

    await svc.retryRun("run-1");

    expect(deps.gitService.setupRunWorktree).not.toHaveBeenCalled();
    expect(runPlanReviewSpy).toHaveBeenCalledWith("run-1");
  });

  it("sets up a new worktree when the run has no branchName yet", async () => {
    const deps = buildDeps();
    const run = makeRun({ id: "run-1", state: RunState.Todo, branchName: null });
    deps.runRepo.findById.mockResolvedValue(run);
    deps.linearClient.getIssue.mockResolvedValue({
      id: "LIN-1",
      title: "title",
      description: "desc",
      branchName: "ai/new",
      state: "Todo",
      labels: [],
      priority: 0,
    });
    deps.runRepo.update.mockResolvedValue(
      makeRun({ id: "run-1", state: RunState.Todo, workingDirectory: "/work/wt", branchName: "ai/new" }),
    );
    deps.runRepo.updateState
      .mockResolvedValueOnce(makeRun({ id: "run-1", state: RunState.Planning }))
      .mockResolvedValueOnce(makeRun({ id: "run-1", state: RunState.PlanReview }));
    deps.plannerAgent.run.mockResolvedValue(makePlan({ openQuestions: [] }));

    const svc = new OrchestratorService(deps as never);
    vi.spyOn(svc as unknown as { buildTaskBundle: (...a: unknown[]) => Promise<TaskBundle> }, "buildTaskBundle").mockResolvedValue(
      makeBundle(),
    );
    vi.spyOn(
      svc as unknown as { retrieveSkillsForPlanning: (...a: unknown[]) => Promise<unknown[]> },
      "retrieveSkillsForPlanning",
    ).mockResolvedValue([]);
    vi.spyOn(
      svc as unknown as { maybeResearchAndReplan: (...a: unknown[]) => Promise<unknown> },
      "maybeResearchAndReplan",
    ).mockImplementation(async (r: unknown, p: unknown) => ({ run: r, plan: p }));
    vi.spyOn(svc, "runPlanReview").mockResolvedValue(makeRun({ state: RunState.AwaitingPlanApproval }));

    await svc.retryRun("run-1");

    expect(deps.gitService.setupRunWorktree).toHaveBeenCalledWith(
      "/work",
      "run-1",
      "main",
      "ai/new",
    );
    expect(deps.runRepo.update).toHaveBeenCalledWith("run-1", {
      workingDirectory: "/work/wt",
      branchName: "ai/run-1",
    });
  });
});

describe("OrchestratorService.runPlanning", () => {
  it("throws when the run does not exist", async () => {
    const deps = buildDeps();
    deps.runRepo.findById.mockResolvedValue(null);
    const svc = new OrchestratorService(deps as never);

    await expect(svc.runPlanning("missing-run")).rejects.toThrow("Run not found: missing-run");
  });

  it("forwards rejectionContext, previousPlan, humanAnswers, researchedAnswers, and planReviewFindings to the planner when all are present", async () => {
    const deps = buildDeps();
    const run = makeRun({ id: "run-1", state: RunState.Planning, planVersion: 2 });
    deps.runRepo.findById.mockResolvedValue(run);
    deps.linearClient.getIssue.mockResolvedValue({
      id: "LIN-1",
      title: "title",
      description: "desc",
      branchName: "ai/x",
      state: "Planning",
      labels: [],
      priority: 0,
    });

    const previousPlan = makePlan({ planVersion: 2 });
    deps.artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
      if (type === "RejectionContext")
        return Promise.resolve({ payloadJson: { planVersion: 2, feedback: "Simplify it" } });
      if (type === "Plan") return Promise.resolve({ payloadJson: previousPlan });
      if (type === "HumanAnswers")
        return Promise.resolve({ payloadJson: { answers: [{ questionId: "q1", answer: "Postgres" }] } });
      if (type === "ResearchedAnswers")
        return Promise.resolve({
          payloadJson: {
            answers: [{ questionId: "q2", question: "Q", answer: "A", confidence: "high" }],
          },
        });
      if (type === "PlanReview")
        return Promise.resolve({
          payloadJson: { summary: "Needs work", findings: [{ id: "f1", severity: "blocker", title: "t", details: "d" }] },
        });
      return Promise.resolve(null);
    });

    deps.runRepo.updateState
      .mockResolvedValueOnce(makeRun({ id: "run-1", state: RunState.PlanReview }));
    deps.plannerAgent.run.mockResolvedValue(makePlan({ planVersion: 3, openQuestions: [] }));

    const svc = new OrchestratorService(deps as never);
    vi.spyOn(svc as unknown as { buildTaskBundle: (...a: unknown[]) => Promise<TaskBundle> }, "buildTaskBundle").mockResolvedValue(
      makeBundle(),
    );
    vi.spyOn(
      svc as unknown as { maybeResearchAndReplan: (...a: unknown[]) => Promise<unknown> },
      "maybeResearchAndReplan",
    ).mockImplementation(async (r: unknown, p: unknown) => ({ run: r, plan: p }));
    const runPlanReviewSpy = vi
      .spyOn(svc, "runPlanReview")
      .mockResolvedValue(makeRun({ state: RunState.AwaitingPlanApproval }));

    await svc.runPlanning("run-1");

    const plannerCall = deps.plannerAgent.run.mock.calls[0];
    const options = plannerCall[2] as {
      planVersionOverride: number;
      previousPlan?: Plan;
      humanFeedback?: { planVersion: number; feedback: string };
      humanAnswers?: unknown[];
      researchedAnswers?: unknown[];
      planReviewFindings?: { summary: string; findings: unknown[] };
    };

    expect(options.planVersionOverride).toBe(3);
    expect(options.previousPlan).toEqual(previousPlan);
    expect(options.humanFeedback).toEqual({ planVersion: 2, feedback: "Simplify it" });
    expect(options.humanAnswers).toEqual([{ questionId: "q1", answer: "Postgres" }]);
    expect(options.researchedAnswers).toHaveLength(1);
    expect(options.planReviewFindings?.summary).toBe("Needs work");
    expect(runPlanReviewSpy).toHaveBeenCalledWith("run-1");
  });

  it("omits optional planner options entirely when no prior artifacts exist", async () => {
    const deps = buildDeps();
    const run = makeRun({ id: "run-1", state: RunState.Planning, planVersion: 1 });
    deps.runRepo.findById.mockResolvedValue(run);
    deps.linearClient.getIssue.mockResolvedValue({
      id: "LIN-1",
      title: "title",
      description: "desc",
      branchName: "ai/x",
      state: "Planning",
      labels: [],
      priority: 0,
    });
    deps.artifactRepo.findLatestByType.mockResolvedValue(null);
    deps.runRepo.updateState.mockResolvedValueOnce(makeRun({ id: "run-1", state: RunState.PlanReview }));
    deps.plannerAgent.run.mockResolvedValue(makePlan({ planVersion: 2, openQuestions: [] }));

    const svc = new OrchestratorService(deps as never);
    vi.spyOn(svc as unknown as { buildTaskBundle: (...a: unknown[]) => Promise<TaskBundle> }, "buildTaskBundle").mockResolvedValue(
      makeBundle(),
    );
    vi.spyOn(
      svc as unknown as { maybeResearchAndReplan: (...a: unknown[]) => Promise<unknown> },
      "maybeResearchAndReplan",
    ).mockImplementation(async (r: unknown, p: unknown) => ({ run: r, plan: p }));
    vi.spyOn(svc, "runPlanReview").mockResolvedValue(makeRun({ state: RunState.AwaitingPlanApproval }));

    await svc.runPlanning("run-1");

    const plannerCall = deps.plannerAgent.run.mock.calls[0];
    const options = plannerCall[2] as Record<string, unknown>;
    expect(options.previousPlan).toBeUndefined();
    expect(options.humanFeedback).toBeUndefined();
    expect(options.humanAnswers).toBeUndefined();
    expect(options.researchedAnswers).toBeUndefined();
    expect(options.planReviewFindings).toBeUndefined();
  });

  it("pauses for human clarification when the re-plan has blocking open questions", async () => {
    const deps = buildDeps();
    const run = makeRun({ id: "run-1", state: RunState.Planning, planVersion: 1 });
    deps.runRepo.findById.mockResolvedValue(run);
    deps.linearClient.getIssue.mockResolvedValue({
      id: "LIN-1",
      title: "title",
      description: "desc",
      branchName: "ai/x",
      state: "Planning",
      labels: [],
      priority: 0,
    });
    deps.artifactRepo.findLatestByType.mockResolvedValue(null);
    deps.runRepo.updateState
      .mockResolvedValueOnce(makeRun({ id: "run-1", state: RunState.PlanReview }))
      .mockResolvedValueOnce(makeRun({ id: "run-1", state: RunState.HumanClarificationNeeded }));
    deps.plannerAgent.run.mockResolvedValue(
      makePlan({
        planVersion: 2,
        openQuestions: [{ id: "q1", question: "Which provider?", requiredForExecution: true }],
      }),
    );

    const svc = new OrchestratorService(deps as never);
    vi.spyOn(svc as unknown as { buildTaskBundle: (...a: unknown[]) => Promise<TaskBundle> }, "buildTaskBundle").mockResolvedValue(
      makeBundle(),
    );
    vi.spyOn(
      svc as unknown as { maybeResearchAndReplan: (...a: unknown[]) => Promise<unknown> },
      "maybeResearchAndReplan",
    ).mockImplementation(async (r: unknown, p: unknown) => ({ run: r, plan: p }));
    const runPlanReviewSpy = vi.spyOn(svc, "runPlanReview");

    const result = await svc.runPlanning("run-1");

    expect(runPlanReviewSpy).not.toHaveBeenCalled();
    expect(result.state).toBe(RunState.HumanClarificationNeeded);
  });
});
