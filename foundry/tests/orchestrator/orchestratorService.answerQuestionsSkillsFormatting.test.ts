import { describe, it, expect, vi } from "vitest";
import { OrchestratorService } from "../../src/orchestrator/orchestratorService.js";
import { RunState } from "../../src/domain/runState.js";
import { RunEvent } from "../../src/domain/runEvent.js";
import type { Run, Artifact, RunEventRecord } from "../../src/domain/types.js";
import type { Plan } from "../../src/schemas/plan.js";
import type { TaskBundle } from "../../src/schemas/taskBundle.js";
import type { ExecutionReport } from "../../src/schemas/executionReport.js";

function makeRun(overrides: Partial<Run> = {}): Run {
  return {
    id: "run-1",
    linearIssueId: "LIN-1",
    linearIssueIdentifier: null,
    linearIssueDescription: null,
    linearIssueTitle: "Fix the thing",
    linearIssueUrl: null,
    repo: "test-repo",
    branchName: "ai/run-1",
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

function makeTaskBundle(): TaskBundle {
  return {
    issue: { id: "LIN-1", title: "Test issue", description: "Test description", labels: [], priority: 0 },
    repo: {
      name: "test-repo",
      defaultBranch: "main",
      workingBranch: "ai/lin-1",
      repoPath: "/tmp",
      allowedPaths: ["src/"],
      protectedPaths: [],
    },
    constraints: { requiredChecks: [], maxFilesChanged: 10, maxDiffLines: 500, forbiddenPatterns: [], mustNotTouch: [] },
    definitionOfDone: [],
  };
}

function makeExecutionReport(overrides: Partial<ExecutionReport> = {}): ExecutionReport {
  return {
    executionVersion: 1,
    summary: "Implemented.",
    filesChanged: ["src/a.ts"],
    checks: {
      lint: { status: "pass", details: "ok" },
      typecheck: { status: "pass", details: "ok" },
      tests: { status: "pass", details: "ok" },
    },
    notes: [],
    prDraftCreated: true,
    score: 0.9,
    scoreRationale: "Green.",
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

function makeEvent(overrides: Partial<RunEventRecord> & { eventType: string }): RunEventRecord {
  return {
    id: "event-1",
    runId: "run-1",
    source: "orchestrator",
    payloadJson: {},
    createdAt: new Date(),
    ...overrides,
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

  const artifactRepo = { create: vi.fn().mockResolvedValue({ id: "artifact-new" }), findByRunId: vi.fn(), findLatestByType: vi.fn() };
  const eventRepo = { create: vi.fn().mockResolvedValue({ id: "event-new" }), findByRunId: vi.fn().mockResolvedValue([]) };
  const linearClient = {
    getIssue: vi.fn().mockResolvedValue({
      id: "LIN-1",
      title: "Test issue",
      description: "Test description",
      branchName: "ai/run-1",
      labels: [],
      priority: 0,
    }),
    postComment: vi.fn().mockResolvedValue(undefined),
    getRelatedContext: vi.fn().mockResolvedValue({ blockers: [] }),
  };
  const githubClient = { getPRDiff: vi.fn(), getDefaultBranch: vi.fn() };
  const repoRegistry = {
    resolveForIssue: vi.fn(),
    resolveWorkingDirectory: vi.fn(),
    validateWorkingDirectory: vi.fn(),
    getRepoByName: vi.fn().mockReturnValue({
      name: "test-repo",
      defaultBranch: "main",
      allowedPaths: ["src/"],
      protectedPaths: [],
      constraints: { requiredChecks: [], maxFilesChanged: 10, maxDiffLines: 500, forbiddenPatterns: [], mustNotTouch: [] },
    }),
    getDefaultRepo: vi.fn(),
  };
  const linearSync = { syncState: vi.fn().mockResolvedValue(undefined) };
  const githubSync = { syncState: vi.fn().mockResolvedValue(undefined), postReviewFindings: vi.fn(), postRemediationResolutions: vi.fn() };
  const plannerAgent = { run: vi.fn() };
  const planReviewerAgent = {
    run: vi.fn().mockResolvedValue({ reviewId: "pr-1", overallVerdict: "approved", summary: "OK", findings: [] }),
  };
  const planReviserAgent = { run: vi.fn() };
  const answerResearcherAgent = { run: vi.fn() };
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
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  const dashboardEmitter = {
    emitStateChanged: vi.fn(),
    emitArtifactCreated: vi.fn(),
    emitRunCreated: vi.fn(),
    emitQuestionsAnswered: vi.fn(),
  };
  const distillationAgent = { run: vi.fn().mockResolvedValue(undefined) };

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
      answerResearcherAgent,
      executorAgent,
      reviewerAgent,
      remediationAgent,
      logger,
      dashboardEmitter,
      distillationAgent,
      ...overrides,
    },
    runRepo,
    artifactRepo,
    eventRepo,
    linearClient,
    plannerAgent,
    answerResearcherAgent,
    executorAgent,
    gitService,
    logger,
    distillationAgent,
  };
}

describe("OrchestratorService.answerQuestions -- additional error and loop branches", () => {
  it("throws when no Plan artifact exists for the run", async () => {
    const { deps, runRepo, artifactRepo } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    runRepo.findById.mockResolvedValue(makeRun({ state: RunState.HumanClarificationNeeded }));
    artifactRepo.findLatestByType.mockResolvedValue(null);

    await expect(svc.answerQuestions("run-1", [{ questionId: "q1", answer: "yes" }])).rejects.toThrow(
      /No plan artifact found/,
    );
  });

  it("throws when no TaskBundle artifact exists after clarification is provided", async () => {
    const { deps, runRepo, artifactRepo } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    const run = makeRun({ state: RunState.HumanClarificationNeeded });
    const plan = makePlan({ openQuestions: [{ id: "q1", question: "Required?", requiredForExecution: true }] });

    runRepo.findById.mockResolvedValue(run);
    runRepo.updateState.mockResolvedValue(makeRun({ state: RunState.Planning }));
    artifactRepo.findLatestByType.mockImplementation((_: string, type: string) => {
      if (type === "Plan") return Promise.resolve(asArtifact("Plan", 1, plan));
      if (type === "TaskBundle") return Promise.resolve(null);
      return Promise.resolve(null);
    });

    await expect(svc.answerQuestions("run-1", [{ questionId: "q1", answer: "yes" }])).rejects.toThrow(
      /No TaskBundle artifact found/,
    );
  });

  it("loops back to HumanClarificationNeeded (incrementing the iteration) when blockers remain and the max has not been reached", async () => {
    const { deps, runRepo, artifactRepo, eventRepo, plannerAgent } = buildDeps({ answerResearcherAgent: undefined });
    const svc = new OrchestratorService(deps as never);

    const run = makeRun({ state: RunState.HumanClarificationNeeded });
    const plan = makePlan({ openQuestions: [{ id: "q1", question: "Required?", requiredForExecution: true }] });
    const taskBundle = makeTaskBundle();

    runRepo.findById.mockResolvedValue(run);
    runRepo.updateState
      .mockResolvedValueOnce(makeRun({ state: RunState.Planning })) // CLARIFICATION_PROVIDED
      .mockResolvedValueOnce(makeRun({ state: RunState.PlanReview })) // PLAN_CREATED
      .mockResolvedValueOnce(makeRun({ state: RunState.HumanClarificationNeeded })); // NEEDS_HUMAN_CLARIFICATION (loop)
    runRepo.update.mockResolvedValue({ ...run, state: RunState.Planning, planVersion: 2 });

    artifactRepo.findLatestByType.mockImplementation((_: string, type: string) => {
      if (type === "Plan") return Promise.resolve(asArtifact("Plan", 1, plan));
      if (type === "TaskBundle") return Promise.resolve(asArtifact("TaskBundle", 1, taskBundle));
      return Promise.resolve(null);
    });
    plannerAgent.run.mockResolvedValue(
      makePlan({ planVersion: 2, openQuestions: [{ id: "q1", question: "Still required?", requiredForExecution: true }] }),
    );

    // One prior NEEDS_HUMAN_CLARIFICATION event (below MAX_CLARIFICATION_ITERATIONS = 3)
    eventRepo.findByRunId.mockResolvedValue([
      makeEvent({ id: "e1", eventType: RunEvent.NEEDS_HUMAN_CLARIFICATION }),
    ]);

    const result = await svc.answerQuestions("run-1", [{ questionId: "q1", answer: "still unsure" }]);

    expect(result.state).toBe(RunState.HumanClarificationNeeded);
    const loopEvent = eventRepo.create.mock.calls.find(
      (c: unknown[], idx: number) =>
        (c[0] as { eventType: string }).eventType === RunEvent.NEEDS_HUMAN_CLARIFICATION &&
        idx === eventRepo.create.mock.calls.length - 1,
    );
    expect(loopEvent).toBeDefined();
    expect((loopEvent![0] as { payloadJson: { iteration: number } }).payloadJson.iteration).toBe(2);
  });

  it("triggers the answer researcher mid-clarification when the re-plan still has a non-blocking open question and prior HumanAnswers exist", async () => {
    const { deps, runRepo, artifactRepo, plannerAgent, answerResearcherAgent } = buildDeps();
    const svc = new OrchestratorService(deps as never);
    const runPlanReviewSpy = vi.spyOn(svc, "runPlanReview").mockResolvedValue(makeRun({ state: RunState.AwaitingPlanApproval }));

    const run = makeRun({ state: RunState.HumanClarificationNeeded });
    const plan = makePlan({
      openQuestions: [
        { id: "q1", question: "Required?", requiredForExecution: true },
        { id: "q2", question: "Optional?", requiredForExecution: false },
      ],
    });
    const taskBundle = makeTaskBundle();

    runRepo.findById.mockResolvedValue(run);
    runRepo.updateState.mockResolvedValue(makeRun({ state: RunState.Planning }));
    runRepo.update.mockResolvedValue({ ...run, state: RunState.Planning, planVersion: 2 });

    const planAfterClarification = makePlan({
      planVersion: 2,
      openQuestions: [{ id: "q2", question: "Optional?", requiredForExecution: false }],
    });
    const planAfterResearch = makePlan({ planVersion: 3, openQuestions: [] });

    artifactRepo.findLatestByType.mockImplementation((_: string, type: string) => {
      if (type === "Plan") return Promise.resolve(asArtifact("Plan", 1, plan));
      if (type === "TaskBundle") return Promise.resolve(asArtifact("TaskBundle", 1, taskBundle));
      if (type === "ResearchedAnswers") return Promise.resolve(null);
      if (type === "HumanAnswers")
        return Promise.resolve(asArtifact("HumanAnswers", 1, { answers: [{ questionId: "q1", answer: "yes" }] }));
      return Promise.resolve(null);
    });

    plannerAgent.run
      .mockResolvedValueOnce(planAfterClarification) // re-plan from human answers
      .mockResolvedValueOnce(planAfterResearch); // re-plan after research
    answerResearcherAgent.run.mockResolvedValue({
      summary: "Resolved the optional question.",
      answers: [{ questionId: "q2", question: "Optional?", answer: "Sure", confidence: "high", sources: [] }],
      completedAt: "2026-01-01T00:00:00Z",
    });

    const result = await svc.answerQuestions("run-1", [{ questionId: "q1", answer: "yes" }]);

    expect(answerResearcherAgent.run).toHaveBeenCalledWith(
      planAfterClarification,
      taskBundle,
      "run-1",
      expect.objectContaining({ humanAnswers: [{ questionId: "q1", answer: "yes" }] }),
    );
    expect(plannerAgent.run).toHaveBeenCalledTimes(2);
    expect(plannerAgent.run.mock.calls[1][2]).toMatchObject({
      researchedAnswers: [{ questionId: "q2", question: "Optional?", answer: "Sure", confidence: "high", sources: [] }],
      humanAnswers: [{ questionId: "q1", answer: "yes" }],
    });
    expect(runPlanReviewSpy).toHaveBeenCalledWith("run-1");
    expect(result).toBeDefined();
  });
});

describe("OrchestratorService -- skill retrieval, metrics, and worktree cleanup on terminal transitions", () => {
  it("retrieveSkillsForPlanning records a SKILL_INJECTION event when relevant skills are found during startRun", async () => {
    const agentSkillRepo = {
      findTopKByRelevance: vi.fn().mockResolvedValue([
        { id: "skill-1", repoSlug: "test-repo", name: "n", description: "d", taskCategory: "c", skillMarkdown: "m", utilityScore: 0.5, lastUsedAt: new Date() },
      ]),
    };
    const { deps, runRepo, artifactRepo, eventRepo, plannerAgent } = buildDeps({ agentSkillRepo });
    const svc = new OrchestratorService(deps as never);
    vi.spyOn(svc, "runPlanReview").mockResolvedValue(makeRun({ state: RunState.AwaitingPlanApproval }));

    const todoRun = makeRun({ state: RunState.Todo });
    (deps.repoRegistry.resolveForIssue as ReturnType<typeof vi.fn>).mockReturnValue({
      name: "test-repo",
      defaultBranch: "main",
      allowedPaths: ["src/"],
      protectedPaths: [],
      constraints: { requiredChecks: [], maxFilesChanged: 10, maxDiffLines: 500, forbiddenPatterns: [], mustNotTouch: [] },
    });
    (deps.repoRegistry.resolveWorkingDirectory as ReturnType<typeof vi.fn>).mockReturnValue("/tmp");
    runRepo.findActiveByIssueId.mockResolvedValue(null);
    runRepo.create.mockResolvedValue(todoRun);
    runRepo.update.mockResolvedValueOnce({ ...todoRun, workingDirectory: "/tmp/worktree", branchName: "ai/run-x" }).mockResolvedValue(
      makeRun({ state: RunState.Planning }),
    );
    runRepo.updateState
      .mockResolvedValueOnce(makeRun({ state: RunState.Planning }))
      .mockResolvedValueOnce(makeRun({ state: RunState.PlanReview }));

    artifactRepo.findLatestByType.mockResolvedValue(null);
    plannerAgent.run.mockResolvedValue(makePlan({ openQuestions: [] }));
    (deps.gitService.setupRunWorktree as ReturnType<typeof vi.fn>).mockResolvedValue({
      worktreePath: "/tmp/worktree",
      branchName: "ai/run-x",
    });

    await svc.startRun("LIN-1");

    expect(agentSkillRepo.findTopKByRelevance).toHaveBeenCalledWith("test-repo", expect.stringContaining("Fix the thing"), expect.any(Number));
    const injectionCall = eventRepo.create.mock.calls.find(
      (c: unknown[]) => (c[0] as { eventType: string }).eventType === "SKILL_INJECTION",
    );
    expect(injectionCall).toBeDefined();
    expect((injectionCall![0] as { payloadJson: { skillIds: string[] } }).payloadJson.skillIds).toEqual(["skill-1"]);
  });

  it("does not record a SKILL_INJECTION event when no relevant skills are found", async () => {
    const agentSkillRepo = { findTopKByRelevance: vi.fn().mockResolvedValue([]) };
    const { deps, runRepo, artifactRepo, eventRepo, plannerAgent } = buildDeps({ agentSkillRepo });
    const svc = new OrchestratorService(deps as never);
    vi.spyOn(svc, "runPlanReview").mockResolvedValue(makeRun({ state: RunState.AwaitingPlanApproval }));

    const todoRun = makeRun({ state: RunState.Todo, branchName: "ai/existing" });
    runRepo.findById.mockResolvedValue(todoRun);
    runRepo.updateState
      .mockResolvedValueOnce(makeRun({ state: RunState.Planning }))
      .mockResolvedValueOnce(makeRun({ state: RunState.PlanReview }));
    runRepo.update.mockResolvedValue(makeRun({ state: RunState.Planning }));

    artifactRepo.findLatestByType.mockResolvedValue(null);
    plannerAgent.run.mockResolvedValue(makePlan({ openQuestions: [] }));

    await svc.retryRun("run-1");

    const injectionCall = eventRepo.create.mock.calls.find(
      (c: unknown[]) => (c[0] as { eventType: string }).eventType === "SKILL_INJECTION",
    );
    expect(injectionCall).toBeUndefined();
  });

  it("updateSkillMetrics increments success and archives low-utility skills when a run completes (Done)", async () => {
    const agentSkillRepo = {
      incrementSuccess: vi.fn().mockResolvedValue({ id: "skill-1", utilityScore: 0.9 }),
      archiveIfLowUtility: vi.fn().mockResolvedValue(undefined),
    };
    const { deps, runRepo, eventRepo, gitService, logger } = buildDeps({ agentSkillRepo });
    const svc = new OrchestratorService(deps as never);

    const run = makeRun({ state: RunState.ReadyForHumanReview, workingDirectory: "/tmp/worktree-run-1" });
    runRepo.findById.mockResolvedValue(run);
    runRepo.updateState.mockResolvedValue({ ...run, state: RunState.Done });
    eventRepo.findByRunId.mockResolvedValue([
      makeEvent({ id: "e1", eventType: "SKILL_INJECTION", payloadJson: { skillIds: ["skill-1"] } }),
      makeEvent({ id: "e2", eventType: "SKILL_INJECTION", payloadJson: { skillIds: ["skill-1"] } }), // duplicate, should be deduped
    ]);
    // Simulate a real worktree that differs from the main repo path, so
    // cleanupRunWorktree's removal branch runs too.
    (gitService.resolveMainRepoPath as ReturnType<typeof vi.fn>).mockReturnValue("/main/repo");

    await svc.approveHumanReview("run-1");

    expect(agentSkillRepo.incrementSuccess).toHaveBeenCalledTimes(1);
    expect(agentSkillRepo.incrementSuccess).toHaveBeenCalledWith("skill-1");
    expect(agentSkillRepo.archiveIfLowUtility).toHaveBeenCalledWith({ id: "skill-1", utilityScore: 0.9 });
    expect(gitService.removeWorktree).toHaveBeenCalledWith("/main/repo", "/tmp/worktree-run-1");
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ runId: "run-1", worktreePath: "/tmp/worktree-run-1", mainRepoPath: "/main/repo" }),
      "Cleaning up run worktree",
    );
  });

  it("updateSkillMetrics logs a warning and continues when incrementFailure rejects for a skill", async () => {
    const agentSkillRepo = {
      incrementFailure: vi.fn().mockRejectedValue(new Error("db unavailable")),
      archiveIfLowUtility: vi.fn(),
    };
    const { deps, runRepo, artifactRepo, eventRepo, plannerAgent, logger } = buildDeps({
      agentSkillRepo,
      answerResearcherAgent: undefined,
    });
    const svc = new OrchestratorService(deps as never);

    const run = makeRun({ state: RunState.HumanClarificationNeeded });
    const plan = makePlan({ openQuestions: [{ id: "q1", question: "Required?", requiredForExecution: true }] });
    const taskBundle = makeTaskBundle();

    runRepo.findById.mockResolvedValue(run);
    runRepo.updateState
      .mockResolvedValueOnce(makeRun({ state: RunState.Planning }))
      .mockResolvedValueOnce(makeRun({ state: RunState.PlanReview }))
      .mockResolvedValueOnce(makeRun({ state: RunState.Failed }));
    runRepo.update.mockResolvedValue({ ...run, state: RunState.Planning, planVersion: 2 });

    artifactRepo.findLatestByType.mockImplementation((_: string, type: string) => {
      if (type === "Plan") return Promise.resolve(asArtifact("Plan", 1, plan));
      if (type === "TaskBundle") return Promise.resolve(asArtifact("TaskBundle", 1, taskBundle));
      return Promise.resolve(null);
    });
    plannerAgent.run.mockResolvedValue(
      makePlan({ planVersion: 2, openQuestions: [{ id: "q1", question: "Still required?", requiredForExecution: true }] }),
    );

    // 3 prior clarification events (reaches MAX) plus a SKILL_INJECTION event
    eventRepo.findByRunId.mockResolvedValue([
      makeEvent({ id: "e1", eventType: RunEvent.NEEDS_HUMAN_CLARIFICATION }),
      makeEvent({ id: "e2", eventType: RunEvent.NEEDS_HUMAN_CLARIFICATION }),
      makeEvent({ id: "e3", eventType: RunEvent.NEEDS_HUMAN_CLARIFICATION }),
      makeEvent({ id: "e4", eventType: "SKILL_INJECTION", payloadJson: { skillIds: ["skill-x"] } }),
    ]);

    const result = await svc.answerQuestions("run-1", [{ questionId: "q1", answer: "still unsure" }]);

    expect(result.state).toBe(RunState.Failed);
    expect(agentSkillRepo.incrementFailure).toHaveBeenCalledWith("skill-x");
    expect(agentSkillRepo.archiveIfLowUtility).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ runId: "run-1", skillId: "skill-x", error: "db unavailable" }),
      "Failed to update skill metric",
    );
  });
});

describe("OrchestratorService -- Execution Report comment formatting edge cases", () => {
  it("collapses the file list into a <details> block and includes a Notes section when there are more than 8 changed files", async () => {
    const { deps, runRepo, artifactRepo, executorAgent, linearClient } = buildDeps();
    const svc = new OrchestratorService(deps as never);
    vi.spyOn(svc, "runReview").mockResolvedValue(makeRun({ state: RunState.AIReview }));

    const run = makeRun({ state: RunState.Implementing, approvedPlanVersion: 1, prNumber: null, branchName: null });
    runRepo.findById.mockResolvedValue(run);
    runRepo.update.mockResolvedValue({ ...run, prNumber: 10, executorRuntime: "claude-code" });
    runRepo.updateState.mockResolvedValue(makeRun({ state: RunState.AIReview }));

    artifactRepo.findLatestByType.mockImplementation((_: string, type: string) => {
      if (type === "Plan") return Promise.resolve(asArtifact("Plan", 1, makePlan()));
      return Promise.resolve(null);
    });

    const manyFiles = Array.from({ length: 9 }, (_, i) => `src/file${i}.ts`);
    const report = makeExecutionReport({ filesChanged: manyFiles, notes: ["Had to refactor the helper too."] });
    executorAgent.run.mockResolvedValue({ report, prNumber: 10 });

    await svc.runExecution("run-1");

    const comment = (linearClient.postComment as ReturnType<typeof vi.fn>).mock.calls.find((c: unknown[]) =>
      (c[1] as string).includes("Execution Report"),
    )![1] as string;

    expect(comment).toContain("<details>");
    expect(comment).toContain(`Files changed (${manyFiles.length})`);
    expect(comment).toContain("### Notes");
    expect(comment).toContain("Had to refactor the helper too.");
  });
});
