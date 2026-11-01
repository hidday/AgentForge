import { describe, it, expect, vi } from "vitest";
import { OrchestratorService } from "../../src/orchestrator/orchestratorService.js";
import { RunState } from "../../src/domain/runState.js";
import type { Run } from "../../src/domain/types.js";

function makeRun(overrides: Partial<Run> = {}): Run {
  return {
    id: "run-1",
    linearIssueId: "LIN-1",
    linearIssueIdentifier: "ENG-1",
    linearIssueDescription: "desc",
    linearIssueTitle: "Add auth middleware",
    linearIssueUrl: "https://linear.app/x",
    repo: "test-repo",
    branchName: "ai/run-1",
    prNumber: 42,
    state: RunState.ReadyForHumanReview,
    planVersion: 1,
    approvedPlanVersion: 1,
    plannerRuntime: null,
    executorRuntime: null,
    reviewerRuntime: null,
    remediationRuntime: null,
    workingDirectory: "/work",
    latestArtifactVersion: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
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
  const gitService = {
    setupRunWorktree: vi.fn(),
    assertBranch: vi.fn().mockResolvedValue(undefined),
    commitAndPush: vi.fn().mockResolvedValue(undefined),
    removeWorktree: vi.fn().mockResolvedValue(undefined),
    resolveMainRepoPath: vi.fn().mockReturnValue("/work"),
  };
  const repoRegistry = {
    resolveForIssue: vi.fn(),
    resolveWorkingDirectory: vi.fn(),
    validateWorkingDirectory: vi.fn(),
    getRepoByName: vi.fn(),
    getDefaultRepo: vi.fn(),
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
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  const agentSkillRepo = {
    findActiveByRepo: vi.fn().mockResolvedValue([]),
    countActiveByRepo: vi.fn().mockResolvedValue(0),
    create: vi.fn(),
    displaceAndCreate: vi.fn(),
    findById: vi.fn(),
    findLowestUtilityActive: vi.fn(),
    archiveById: vi.fn(),
    findTopKByRelevance: vi.fn().mockResolvedValue([]),
    incrementSuccess: vi.fn(),
    incrementFailure: vi.fn(),
    archiveIfLowUtility: vi.fn().mockResolvedValue(undefined),
  };

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
    agentSkillRepo,
  };
}

describe("OrchestratorService.retrieveSkillsForPlanning (private, exercised via startRun)", () => {
  it("returns [] and skips SKILL_INJECTION event when agentSkillRepo finds no relevant skills", async () => {
    const deps = buildDeps();
    deps.runRepo.findActiveByIssueId.mockResolvedValue(null);
    deps.repoRegistry.resolveForIssue.mockReturnValue({
      name: "test-repo",
      directory: "/repos/test-repo",
      defaultBranch: "main",
      allowedPaths: [],
      protectedPaths: [],
      constraints: { requiredChecks: [], maxFilesChanged: 10, maxDiffLines: 500, forbiddenPatterns: [], mustNotTouch: [] },
    });
    deps.repoRegistry.resolveWorkingDirectory.mockReturnValue("/work");
    deps.gitService.setupRunWorktree.mockResolvedValue({ worktreePath: "/work/wt", branchName: "ai/run-1" });
    deps.linearClient.getIssue.mockResolvedValue({
      id: "LIN-1",
      identifier: "ENG-1",
      title: "Add auth middleware",
      description: "desc",
      branchName: "ai/x",
      state: "Todo",
      labels: [],
      priority: 0,
    });
    const createdRun = makeRun({ state: RunState.Todo });
    deps.runRepo.create.mockResolvedValue(createdRun);
    deps.runRepo.update
      .mockResolvedValueOnce(makeRun({ state: RunState.Todo, workingDirectory: "/work/wt", branchName: "ai/run-1" }))
      .mockResolvedValueOnce(makeRun({ state: RunState.Planning }));
    deps.runRepo.updateState
      .mockResolvedValueOnce(makeRun({ state: RunState.Planning }))
      .mockResolvedValueOnce(makeRun({ state: RunState.PlanReview }));
    deps.agentSkillRepo.findTopKByRelevance.mockResolvedValue([]);
    deps.plannerAgent.run.mockResolvedValue({
      planVersion: 1,
      summary: "s",
      requirementsTraceability: "",
      assumptions: [],
      openQuestions: [],
      risks: [],
      steps: [],
      testPlan: "t",
      confidence: 0.9,
    });

    const svc = new OrchestratorService(deps as never);
    vi.spyOn(
      svc as unknown as { buildTaskBundle: (...a: unknown[]) => Promise<unknown> },
      "buildTaskBundle",
    ).mockResolvedValue({
      issue: { id: "LIN-1", title: "t", description: "d", labels: [], priority: 0 },
      repo: {
        name: "test-repo",
        defaultBranch: "main",
        workingBranch: "ai/run-1",
        repoPath: "/work",
        allowedPaths: [],
        protectedPaths: [],
      },
      constraints: { requiredChecks: [], maxFilesChanged: 10, maxDiffLines: 500, forbiddenPatterns: [], mustNotTouch: [] },
      definitionOfDone: [],
    });
    vi.spyOn(
      svc as unknown as { maybeResearchAndReplan: (...a: unknown[]) => Promise<unknown> },
      "maybeResearchAndReplan",
    ).mockImplementation(async (r: unknown, p: unknown) => ({ run: r, plan: p }));
    vi.spyOn(svc, "runPlanReview").mockResolvedValue(makeRun({ state: RunState.AwaitingPlanApproval }));

    await svc.startRun("LIN-1");

    expect(deps.agentSkillRepo.findTopKByRelevance).toHaveBeenCalledWith(
      "test-repo",
      expect.stringContaining("Add auth middleware"),
      expect.any(Number),
    );
    expect(deps.eventRepo.create).not.toHaveBeenCalledWith(
      expect.objectContaining({ eventType: "SKILL_INJECTION" }),
    );
  });

  it("records a SKILL_INJECTION event with the matched skill IDs when relevant skills are found", async () => {
    const deps = buildDeps();
    deps.runRepo.findActiveByIssueId.mockResolvedValue(null);
    deps.repoRegistry.resolveForIssue.mockReturnValue({
      name: "test-repo",
      directory: "/repos/test-repo",
      defaultBranch: "main",
      allowedPaths: [],
      protectedPaths: [],
      constraints: { requiredChecks: [], maxFilesChanged: 10, maxDiffLines: 500, forbiddenPatterns: [], mustNotTouch: [] },
    });
    deps.repoRegistry.resolveWorkingDirectory.mockReturnValue("/work");
    deps.gitService.setupRunWorktree.mockResolvedValue({ worktreePath: "/work/wt", branchName: "ai/run-1" });
    deps.linearClient.getIssue.mockResolvedValue({
      id: "LIN-1",
      identifier: "ENG-1",
      title: "Add auth middleware",
      description: "desc",
      branchName: "ai/x",
      state: "Todo",
      labels: [],
      priority: 0,
    });
    const createdRun = makeRun({ state: RunState.Todo });
    deps.runRepo.create.mockResolvedValue(createdRun);
    deps.runRepo.update
      .mockResolvedValueOnce(makeRun({ state: RunState.Todo, workingDirectory: "/work/wt", branchName: "ai/run-1" }))
      .mockResolvedValueOnce(makeRun({ state: RunState.Planning }));
    deps.runRepo.updateState
      .mockResolvedValueOnce(makeRun({ state: RunState.Planning }))
      .mockResolvedValueOnce(makeRun({ state: RunState.PlanReview }));
    deps.agentSkillRepo.findTopKByRelevance.mockResolvedValue([
      { id: "skill-1", taskCategory: "auth", snippet: "x" },
    ]);
    deps.plannerAgent.run.mockResolvedValue({
      planVersion: 1,
      summary: "s",
      requirementsTraceability: "",
      assumptions: [],
      openQuestions: [],
      risks: [],
      steps: [],
      testPlan: "t",
      confidence: 0.9,
    });

    const svc = new OrchestratorService(deps as never);
    vi.spyOn(
      svc as unknown as { buildTaskBundle: (...a: unknown[]) => Promise<unknown> },
      "buildTaskBundle",
    ).mockResolvedValue({
      issue: { id: "LIN-1", title: "t", description: "d", labels: [], priority: 0 },
      repo: {
        name: "test-repo",
        defaultBranch: "main",
        workingBranch: "ai/run-1",
        repoPath: "/work",
        allowedPaths: [],
        protectedPaths: [],
      },
      constraints: { requiredChecks: [], maxFilesChanged: 10, maxDiffLines: 500, forbiddenPatterns: [], mustNotTouch: [] },
      definitionOfDone: [],
    });
    vi.spyOn(
      svc as unknown as { maybeResearchAndReplan: (...a: unknown[]) => Promise<unknown> },
      "maybeResearchAndReplan",
    ).mockImplementation(async (r: unknown, p: unknown) => ({ run: r, plan: p }));
    vi.spyOn(svc, "runPlanReview").mockResolvedValue(makeRun({ state: RunState.AwaitingPlanApproval }));

    await svc.startRun("LIN-1");

    expect(deps.eventRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "SKILL_INJECTION",
        payloadJson: { skillIds: ["skill-1"] },
      }),
    );
  });
});

describe("OrchestratorService.updateSkillMetrics (private, exercised via approveHumanReview -> Done transition)", () => {
  it("does nothing when there are no SKILL_INJECTION events for the run", async () => {
    const deps = buildDeps();
    deps.runRepo.findById.mockResolvedValue(makeRun());
    deps.runRepo.updateState.mockResolvedValue(makeRun({ state: RunState.Done }));
    deps.eventRepo.findByRunId.mockResolvedValue([]);

    const svc = new OrchestratorService(deps as never);
    await svc.approveHumanReview("run-1");

    expect(deps.agentSkillRepo.incrementSuccess).not.toHaveBeenCalled();
  });

  it("increments success and archives-if-low-utility for every distinct skill ID across injection events", async () => {
    const deps = buildDeps();
    deps.runRepo.findById.mockResolvedValue(makeRun());
    deps.runRepo.updateState.mockResolvedValue(makeRun({ state: RunState.Done }));
    deps.eventRepo.findByRunId.mockResolvedValue([
      { id: "e1", runId: "run-1", eventType: "SKILL_INJECTION", source: "orchestrator", payloadJson: { skillIds: ["s1", "s2"] }, createdAt: new Date() },
      { id: "e2", runId: "run-1", eventType: "SKILL_INJECTION", source: "orchestrator", payloadJson: { skillIds: ["s2"] }, createdAt: new Date() },
    ]);
    deps.agentSkillRepo.incrementSuccess.mockResolvedValue({ id: "updated" });

    const svc = new OrchestratorService(deps as never);
    await svc.approveHumanReview("run-1");

    expect(deps.agentSkillRepo.incrementSuccess).toHaveBeenCalledTimes(2);
    expect(deps.agentSkillRepo.incrementSuccess).toHaveBeenCalledWith("s1");
    expect(deps.agentSkillRepo.incrementSuccess).toHaveBeenCalledWith("s2");
    expect(deps.agentSkillRepo.archiveIfLowUtility).toHaveBeenCalledTimes(2);
    expect(deps.agentSkillRepo.incrementFailure).not.toHaveBeenCalled();
  });

  it("logs a warning and continues with the remaining skill IDs when one metric update throws", async () => {
    const deps = buildDeps();
    deps.runRepo.findById.mockResolvedValue(makeRun());
    deps.runRepo.updateState.mockResolvedValue(makeRun({ state: RunState.Done }));
    deps.eventRepo.findByRunId.mockResolvedValue([
      { id: "e1", runId: "run-1", eventType: "SKILL_INJECTION", source: "orchestrator", payloadJson: { skillIds: ["bad", "good"] }, createdAt: new Date() },
    ]);
    deps.agentSkillRepo.incrementSuccess.mockImplementation((id: string) =>
      id === "bad" ? Promise.reject(new Error("db error")) : Promise.resolve({ id: "updated" }),
    );

    const svc = new OrchestratorService(deps as never);
    await svc.approveHumanReview("run-1");

    expect(deps.logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ runId: "run-1", skillId: "bad", error: "db error" }),
      "Failed to update skill metric",
    );
    expect(deps.agentSkillRepo.incrementSuccess).toHaveBeenCalledWith("good");
    expect(deps.agentSkillRepo.archiveIfLowUtility).toHaveBeenCalledTimes(1);
  });

  it("calls incrementFailure (not incrementSuccess) when a run fails via CLARIFICATION_EXHAUSTED", async () => {
    const deps = buildDeps();
    const run = makeRun({
      id: "run-1",
      state: RunState.HumanClarificationNeeded,
      planVersion: 1,
    });
    deps.runRepo.findById.mockResolvedValue(run);

    const blockingQuestion = { id: "q1", question: "Which DB?", requiredForExecution: true };
    const plan = {
      planVersion: 1,
      summary: "s",
      requirementsTraceability: "",
      assumptions: [],
      openQuestions: [blockingQuestion],
      risks: [],
      steps: [],
      testPlan: "t",
      confidence: 0.9,
    };
    deps.artifactRepo.findLatestByType.mockImplementation((_id: string, type: string) => {
      if (type === "Plan") return Promise.resolve({ payloadJson: plan });
      if (type === "TaskBundle")
        return Promise.resolve({
          payloadJson: {
            issue: { id: "LIN-1", title: "t", description: "d", labels: [], priority: 0 },
            repo: {
              name: "test-repo",
              defaultBranch: "main",
              workingBranch: "ai/run-1",
              repoPath: "/work",
              allowedPaths: [],
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
          },
        });
      return Promise.resolve(null);
    });

    // Still blocking after re-planning with the human's answer.
    deps.plannerAgent.run.mockResolvedValue({ ...plan, openQuestions: [blockingQuestion] });
    deps.runRepo.update.mockResolvedValue(makeRun({ state: RunState.Planning, planVersion: 1 }));

    deps.runRepo.updateState
      .mockResolvedValueOnce(makeRun({ state: RunState.Planning })) // CLARIFICATION_PROVIDED
      .mockResolvedValueOnce(makeRun({ state: RunState.PlanReview })) // PLAN_CREATED
      .mockResolvedValueOnce(makeRun({ state: RunState.Failed })); // CLARIFICATION_EXHAUSTED

    // 3 prior NEEDS_HUMAN_CLARIFICATION events == MAX_CLARIFICATION_ITERATIONS, so this
    // round exhausts clarification. Also carries the SKILL_INJECTION event to update.
    deps.eventRepo.findByRunId.mockResolvedValue([
      { id: "e1", runId: "run-1", eventType: "SKILL_INJECTION", source: "orchestrator", payloadJson: { skillIds: ["s1"] }, createdAt: new Date() },
      { id: "e2", runId: "run-1", eventType: "NEEDS_HUMAN_CLARIFICATION", source: "planner-agent", payloadJson: {}, createdAt: new Date() },
      { id: "e3", runId: "run-1", eventType: "NEEDS_HUMAN_CLARIFICATION", source: "planner-agent", payloadJson: {}, createdAt: new Date() },
      { id: "e4", runId: "run-1", eventType: "NEEDS_HUMAN_CLARIFICATION", source: "planner-agent", payloadJson: {}, createdAt: new Date() },
    ]);
    deps.agentSkillRepo.incrementFailure.mockResolvedValue({ id: "updated" });

    const svc = new OrchestratorService(deps as never);
    vi.spyOn(
      svc as unknown as { maybeResearchAndReplan: (...a: unknown[]) => Promise<unknown> },
      "maybeResearchAndReplan",
    ).mockImplementation(async (r: unknown, p: unknown) => ({ run: r, plan: p }));

    const result = await svc.answerQuestions("run-1", [{ questionId: "q1", answer: "Postgres" }]);

    expect(result.state).toBe(RunState.Failed);
    expect(deps.agentSkillRepo.incrementFailure).toHaveBeenCalledWith("s1");
    expect(deps.agentSkillRepo.incrementSuccess).not.toHaveBeenCalled();
  });
});
