import { describe, it, expect, vi } from "vitest";
import { OrchestratorService } from "../../src/orchestrator/orchestratorService.js";
import { RunState } from "../../src/domain/runState.js";
import { RunEvent } from "../../src/domain/runEvent.js";
import type { Run, Artifact } from "../../src/domain/types.js";
import type { Plan } from "../../src/schemas/plan.js";
import type { PlanReview } from "../../src/schemas/planReview.js";
import type { ExecutionReport } from "../../src/schemas/executionReport.js";
import type { Review } from "../../src/schemas/review.js";

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

function makeArtifact<T>(type: Artifact["type"], payload: T, overrides: Partial<Artifact> = {}): Artifact {
  return {
    id: `artifact-${type}`,
    runId: "run-1",
    type,
    version: 1,
    payloadJson: payload as unknown,
    rawText: JSON.stringify(payload),
    createdAt: new Date(),
    ...overrides,
  };
}

const defaultRepoEntry = {
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
};

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
    create: vi.fn().mockResolvedValue({}),
    findByRunId: vi.fn().mockResolvedValue([]),
  };

  const linearClient = {
    getIssue: vi.fn().mockResolvedValue({
      id: "LIN-1",
      identifier: "LIN-1",
      title: "Test issue",
      description: "Test description",
      url: "https://linear.app/x",
      branchName: "ai/lin-1",
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
    resolveForIssue: vi.fn().mockReturnValue(defaultRepoEntry),
    resolveWorkingDirectory: vi.fn().mockReturnValue("/repos/test-repo"),
    validateWorkingDirectory: vi.fn(),
    getRepoByName: vi.fn().mockReturnValue(defaultRepoEntry),
    getDefaultRepo: vi.fn().mockReturnValue(defaultRepoEntry),
  };

  const linearSync = { syncState: vi.fn().mockResolvedValue(undefined) };
  const githubSync = {
    syncState: vi.fn().mockResolvedValue(undefined),
    postReviewFindings: vi.fn().mockResolvedValue(new Map()),
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

  const agentSkillRepo = {
    findTopKByRelevance: vi.fn().mockResolvedValue([]),
    incrementSuccess: vi.fn(),
    incrementFailure: vi.fn(),
    archiveIfLowUtility: vi.fn(),
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
      agentSkillRepo,
      logger,
      dashboardEmitter,
      ...overrides,
    },
    runRepo,
    artifactRepo,
    eventRepo,
    linearClient,
    githubClient,
    repoRegistry,
    planReviewerAgent,
    reviewerAgent,
    plannerAgent,
    agentSkillRepo,
    logger,
  };
}

describe("OrchestratorService -- retrieveSkillsForPlanning (via startRun)", () => {
  it("queries agentSkillRepo with title+description and records a SKILL_INJECTION event when skills are found", async () => {
    const { deps, runRepo, plannerAgent, agentSkillRepo, eventRepo } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    const created = makeRun({
      id: "run-1",
      state: RunState.Todo,
      linearIssueTitle: "Fix the bug",
      linearIssueDescription: "It crashes on save",
    });
    runRepo.findActiveByIssueId.mockResolvedValue(null);
    runRepo.create.mockResolvedValue(created);
    runRepo.update
      .mockResolvedValueOnce(created)
      .mockResolvedValue(makeRun({ id: "run-1", state: RunState.Planning, planVersion: 2 }));
    runRepo.updateState
      .mockResolvedValueOnce(
        makeRun({
          id: "run-1",
          state: RunState.Planning,
          linearIssueTitle: "Fix the bug",
          linearIssueDescription: "It crashes on save",
        }),
      )
      .mockResolvedValueOnce(makeRun({ id: "run-1", state: RunState.PlanReview, planVersion: 2 }));

    agentSkillRepo.findTopKByRelevance.mockResolvedValue([
      { id: "skill-1", repoSlug: "test-repo", name: "n", description: "d", taskCategory: "c", skillMarkdown: "m", utilityScore: 1, lastUsedAt: new Date() },
    ]);

    const plan = makePlan({ planVersion: 2, openQuestions: [] });
    plannerAgent.run.mockResolvedValue(plan);
    vi.spyOn(svc, "runPlanReview").mockResolvedValue(makeRun({ state: RunState.PlanReview }));

    await svc.startRun("LIN-1");

    expect(agentSkillRepo.findTopKByRelevance).toHaveBeenCalledWith(
      "test-repo",
      "Fix the bug It crashes on save",
      expect.any(Number),
    );
    expect(eventRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "SKILL_INJECTION",
        payloadJson: { skillIds: ["skill-1"] },
      }),
    );
    expect(plannerAgent.run).toHaveBeenCalledWith(
      expect.anything(),
      "run-1",
      { priorSkills: [expect.objectContaining({ id: "skill-1" })] },
    );
  });

  it("does not record a SKILL_INJECTION event when no skills are found", async () => {
    const { deps, runRepo, plannerAgent, agentSkillRepo, eventRepo } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    const created = makeRun({ id: "run-1", state: RunState.Todo });
    runRepo.findActiveByIssueId.mockResolvedValue(null);
    runRepo.create.mockResolvedValue(created);
    runRepo.update
      .mockResolvedValueOnce(created)
      .mockResolvedValue(makeRun({ id: "run-1", state: RunState.Planning, planVersion: 2 }));
    runRepo.updateState
      .mockResolvedValueOnce(makeRun({ id: "run-1", state: RunState.Planning }))
      .mockResolvedValueOnce(makeRun({ id: "run-1", state: RunState.PlanReview, planVersion: 2 }));

    agentSkillRepo.findTopKByRelevance.mockResolvedValue([]);

    const plan = makePlan({ planVersion: 2, openQuestions: [] });
    plannerAgent.run.mockResolvedValue(plan);
    vi.spyOn(svc, "runPlanReview").mockResolvedValue(makeRun({ state: RunState.PlanReview }));

    await svc.startRun("LIN-1");

    const injectionCalls = (eventRepo.create as ReturnType<typeof vi.fn>).mock.calls.filter(
      (call) => (call[0] as { eventType?: string }).eventType === "SKILL_INJECTION",
    );
    expect(injectionCalls).toHaveLength(0);
  });
});

describe("OrchestratorService -- updateSkillMetrics (via terminal transitions)", () => {
  it("does nothing when agentSkillRepo has no prior SKILL_INJECTION events for the run", async () => {
    const { deps, runRepo, eventRepo, agentSkillRepo } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    runRepo.findById.mockResolvedValue(makeRun({ id: "run-1", state: RunState.ReadyForHumanReview }));
    runRepo.updateState.mockResolvedValue(makeRun({ id: "run-1", state: RunState.Done }));
    eventRepo.findByRunId.mockResolvedValue([]);

    await svc.approveHumanReview("run-1");

    expect(agentSkillRepo.incrementSuccess).not.toHaveBeenCalled();
    expect(agentSkillRepo.incrementFailure).not.toHaveBeenCalled();
  });

  it("increments failure metrics (and skips archival on error) when the run transitions to Failed", async () => {
    const { deps, runRepo, artifactRepo, eventRepo, agentSkillRepo } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    const run = makeRun({ id: "run-1", state: RunState.HumanClarificationNeeded, planVersion: 1 });
    runRepo.findById.mockResolvedValue(run);

    const plan = makePlan({
      openQuestions: [{ id: "q1", question: "Required?", requiredForExecution: true }],
    });
    artifactRepo.findLatestByType.mockImplementation((_r: string, type: string) => {
      if (type === "Plan") return Promise.resolve(makeArtifact("Plan", plan));
      if (type === "TaskBundle")
        return Promise.resolve(
          makeArtifact("TaskBundle", {
            issue: { id: "LIN-1", title: "t", description: "d", labels: [], priority: 0 },
            repo: defaultRepoEntry,
            constraints: defaultRepoEntry.constraints,
            definitionOfDone: [],
          }),
        );
      return Promise.resolve(null);
    });

    // Re-plan still has the same blocking question.
    (deps.plannerAgent as { run: ReturnType<typeof vi.fn> }).run.mockResolvedValue(plan);

    runRepo.update.mockResolvedValue(makeRun({ id: "run-1", state: RunState.Planning, planVersion: 2 }));
    runRepo.updateState
      .mockResolvedValueOnce(makeRun({ id: "run-1", state: RunState.Planning })) // CLARIFICATION_PROVIDED
      .mockResolvedValueOnce(makeRun({ id: "run-1", state: RunState.PlanReview, planVersion: 2 })) // PLAN_CREATED
      .mockResolvedValueOnce(makeRun({ id: "run-1", state: RunState.Failed, planVersion: 2 })); // CLARIFICATION_EXHAUSTED

    // Three prior NEEDS_HUMAN_CLARIFICATION events (max reached) plus a SKILL_INJECTION event.
    eventRepo.findByRunId.mockResolvedValue([
      { id: "e1", runId: "run-1", eventType: RunEvent.NEEDS_HUMAN_CLARIFICATION, source: "planner-agent", payloadJson: {}, createdAt: new Date() },
      { id: "e2", runId: "run-1", eventType: RunEvent.NEEDS_HUMAN_CLARIFICATION, source: "planner-agent", payloadJson: {}, createdAt: new Date() },
      { id: "e3", runId: "run-1", eventType: RunEvent.NEEDS_HUMAN_CLARIFICATION, source: "planner-agent", payloadJson: {}, createdAt: new Date() },
      { id: "e4", runId: "run-1", eventType: "SKILL_INJECTION", source: "orchestrator", payloadJson: { skillIds: ["skill-x"] }, createdAt: new Date() },
    ]);

    agentSkillRepo.incrementFailure.mockRejectedValue(new Error("no such skill"));

    const result = await svc.answerQuestions("run-1", [{ questionId: "q1", answer: "still unclear" }]);

    expect(result.state).toBe(RunState.Failed);
    expect(agentSkillRepo.incrementFailure).toHaveBeenCalledWith("skill-x");
    expect(agentSkillRepo.archiveIfLowUtility).not.toHaveBeenCalled();
  });

  it("increments failure metrics and archives the updated skill when incrementFailure succeeds", async () => {
    const { deps, runRepo, artifactRepo, eventRepo, agentSkillRepo } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    const run = makeRun({ id: "run-1", state: RunState.HumanClarificationNeeded, planVersion: 1 });
    runRepo.findById.mockResolvedValue(run);

    const plan = makePlan({
      openQuestions: [{ id: "q1", question: "Required?", requiredForExecution: true }],
    });
    artifactRepo.findLatestByType.mockImplementation((_r: string, type: string) => {
      if (type === "Plan") return Promise.resolve(makeArtifact("Plan", plan));
      if (type === "TaskBundle")
        return Promise.resolve(
          makeArtifact("TaskBundle", {
            issue: { id: "LIN-1", title: "t", description: "d", labels: [], priority: 0 },
            repo: defaultRepoEntry,
            constraints: defaultRepoEntry.constraints,
            definitionOfDone: [],
          }),
        );
      return Promise.resolve(null);
    });

    (deps.plannerAgent as { run: ReturnType<typeof vi.fn> }).run.mockResolvedValue(plan);

    runRepo.update.mockResolvedValue(makeRun({ id: "run-1", state: RunState.Planning, planVersion: 2 }));
    runRepo.updateState
      .mockResolvedValueOnce(makeRun({ id: "run-1", state: RunState.Planning })) // CLARIFICATION_PROVIDED
      .mockResolvedValueOnce(makeRun({ id: "run-1", state: RunState.PlanReview, planVersion: 2 })) // PLAN_CREATED
      .mockResolvedValueOnce(makeRun({ id: "run-1", state: RunState.Failed, planVersion: 2 })); // CLARIFICATION_EXHAUSTED

    eventRepo.findByRunId.mockResolvedValue([
      { id: "e1", runId: "run-1", eventType: RunEvent.NEEDS_HUMAN_CLARIFICATION, source: "planner-agent", payloadJson: {}, createdAt: new Date() },
      { id: "e2", runId: "run-1", eventType: RunEvent.NEEDS_HUMAN_CLARIFICATION, source: "planner-agent", payloadJson: {}, createdAt: new Date() },
      { id: "e3", runId: "run-1", eventType: RunEvent.NEEDS_HUMAN_CLARIFICATION, source: "planner-agent", payloadJson: {}, createdAt: new Date() },
      { id: "e4", runId: "run-1", eventType: "SKILL_INJECTION", source: "orchestrator", payloadJson: { skillIds: ["skill-x"] }, createdAt: new Date() },
    ]);

    const updatedSkill = { id: "skill-x", utilityScore: 0.1 };
    agentSkillRepo.incrementFailure.mockResolvedValue(updatedSkill);

    const result = await svc.answerQuestions("run-1", [{ questionId: "q1", answer: "still unclear" }]);

    expect(result.state).toBe(RunState.Failed);
    expect(agentSkillRepo.incrementFailure).toHaveBeenCalledWith("skill-x");
    expect(agentSkillRepo.archiveIfLowUtility).toHaveBeenCalledWith(updatedSkill);
  });
});

describe("OrchestratorService -- buildTaskBundle (via runPlanReview)", () => {
  it("uses the config defaultBranch when it matches the remote default (no warning)", async () => {
    const { deps, runRepo, artifactRepo, githubClient, planReviewerAgent, logger } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    runRepo.findById.mockResolvedValue(makeRun({ state: RunState.PlanReview }));
    artifactRepo.findLatestByType.mockImplementation((_r: string, type: string) =>
      type === "Plan" ? Promise.resolve(makeArtifact("Plan", makePlan())) : Promise.resolve(null),
    );
    githubClient.getDefaultBranch.mockResolvedValue("main");
    planReviewerAgent.run.mockResolvedValue({
      reviewId: "r1",
      summary: "ok",
      findings: [],
      overallVerdict: "approved",
    } satisfies PlanReview);
    runRepo.updateState.mockResolvedValue(makeRun({ state: RunState.AwaitingPlanApproval }));

    await svc.runPlanReview("run-1");

    const warnCall = (logger.warn as ReturnType<typeof vi.fn>).mock.calls.find(
      (call: unknown[]) =>
        typeof call[1] === "string" && (call[1] as string).includes("Config defaultBranch differs"),
    );
    expect(warnCall).toBeUndefined();
  });

  it("prefers the remote default branch and warns when it differs from config", async () => {
    const { deps, runRepo, artifactRepo, githubClient, planReviewerAgent, logger } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    runRepo.findById.mockResolvedValue(makeRun({ state: RunState.PlanReview }));
    artifactRepo.findLatestByType.mockImplementation((_r: string, type: string) =>
      type === "Plan" ? Promise.resolve(makeArtifact("Plan", makePlan())) : Promise.resolve(null),
    );
    githubClient.getDefaultBranch.mockResolvedValue("trunk");
    planReviewerAgent.run.mockResolvedValue({
      reviewId: "r1",
      summary: "ok",
      findings: [],
      overallVerdict: "approved",
    } satisfies PlanReview);
    runRepo.updateState.mockResolvedValue(makeRun({ state: RunState.AwaitingPlanApproval }));

    await svc.runPlanReview("run-1");

    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ config: "main", remote: "trunk" }),
      "Config defaultBranch differs from GitHub, using remote value",
    );
  });

  it("falls back to the registry default repo when getRepoByName returns undefined", async () => {
    const { deps, runRepo, artifactRepo, repoRegistry, planReviewerAgent } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    repoRegistry.getRepoByName.mockReturnValue(undefined);

    runRepo.findById.mockResolvedValue(makeRun({ state: RunState.PlanReview, repo: "unregistered-repo" }));
    artifactRepo.findLatestByType.mockImplementation((_r: string, type: string) =>
      type === "Plan" ? Promise.resolve(makeArtifact("Plan", makePlan())) : Promise.resolve(null),
    );
    planReviewerAgent.run.mockResolvedValue({
      reviewId: "r1",
      summary: "ok",
      findings: [],
      overallVerdict: "approved",
    } satisfies PlanReview);
    runRepo.updateState.mockResolvedValue(makeRun({ state: RunState.AwaitingPlanApproval }));

    await svc.runPlanReview("run-1");

    expect(repoRegistry.getDefaultRepo).toHaveBeenCalled();
  });
});

describe("OrchestratorService -- comment formatters (content assertions via public flows)", () => {
  it("formatPlanComment includes Open Questions and Risks sections when present", async () => {
    const { deps, runRepo, artifactRepo, planReviewerAgent, linearClient } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    runRepo.findById.mockResolvedValue(makeRun({ state: RunState.PlanReview }));
    const plan = makePlan({
      planVersion: 5,
      confidence: 0.75,
      openQuestions: [
        { id: "q1", question: "Blocking one?", requiredForExecution: true },
        { id: "q2", question: "Non-blocking one?", requiredForExecution: false },
      ],
      risks: ["Might break prod"],
    });
    artifactRepo.findLatestByType.mockImplementation((_r: string, type: string) =>
      type === "Plan" ? Promise.resolve(makeArtifact("Plan", plan)) : Promise.resolve(null),
    );
    planReviewerAgent.run.mockResolvedValue({
      reviewId: "r1",
      summary: "ok",
      findings: [],
      overallVerdict: "approved",
    } satisfies PlanReview);
    runRepo.updateState.mockResolvedValue(makeRun({ state: RunState.AwaitingPlanApproval }));

    await svc.runPlanReview("run-1");

    const comment = (linearClient.postComment as ReturnType<typeof vi.fn>).mock.calls.find(
      (call) => typeof call[1] === "string" && (call[1] as string).includes("AI Plan (v5)"),
    )?.[1] as string;

    expect(comment).toContain("Confidence: 75%");
    expect(comment).toContain("**Open Questions:**");
    expect(comment).toContain("Blocking one? *blocks execution*");
    expect(comment).toContain("Non-blocking one?");
    expect(comment).not.toContain("Non-blocking one? *blocks execution*");
    expect(comment).toContain("**Risks:**");
    expect(comment).toContain("Might break prod");
  });

  it("formatPlanComment omits Open Questions and Risks sections when absent", async () => {
    const { deps, runRepo, artifactRepo, planReviewerAgent, linearClient } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    runRepo.findById.mockResolvedValue(makeRun({ state: RunState.PlanReview }));
    const plan = makePlan({ planVersion: 1, openQuestions: [], risks: [] });
    artifactRepo.findLatestByType.mockImplementation((_r: string, type: string) =>
      type === "Plan" ? Promise.resolve(makeArtifact("Plan", plan)) : Promise.resolve(null),
    );
    planReviewerAgent.run.mockResolvedValue({
      reviewId: "r1",
      summary: "ok",
      findings: [],
      overallVerdict: "approved",
    } satisfies PlanReview);
    runRepo.updateState.mockResolvedValue(makeRun({ state: RunState.AwaitingPlanApproval }));

    await svc.runPlanReview("run-1");

    const comment = (linearClient.postComment as ReturnType<typeof vi.fn>).mock.calls.find(
      (call) => typeof call[1] === "string" && (call[1] as string).includes("AI Plan (v1)"),
    )?.[1] as string;

    expect(comment).not.toContain("**Open Questions:**");
    expect(comment).not.toContain("**Risks:**");
  });

  it("formatPlanReviewComment includes the affected step id when present and omits it otherwise", async () => {
    const { deps, runRepo, artifactRepo, planReviewerAgent, linearClient } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    runRepo.findById.mockResolvedValue(makeRun({ state: RunState.PlanReview }));
    artifactRepo.findLatestByType.mockImplementation((_r: string, type: string) =>
      type === "Plan" ? Promise.resolve(makeArtifact("Plan", makePlan())) : Promise.resolve(null),
    );
    const review: PlanReview = {
      reviewId: "r1",
      summary: "needs work",
      overallVerdict: "changes_requested",
      findings: [
        { id: "f1", severity: "blocker", type: "risk", title: "Missing step", details: "d1", affectedStepId: "s1" },
        { id: "f2", severity: "nit", type: "style", title: "Nit", details: "d2" },
      ],
    };
    planReviewerAgent.run.mockResolvedValue(review);
    runRepo.updateState.mockResolvedValue(makeRun({ state: RunState.PlanRevision }));
    vi.spyOn(svc, "runPlanRevision").mockResolvedValue(makeRun({ state: RunState.AwaitingPlanApproval }));

    await svc.runPlanReview("run-1");

    const comment = (linearClient.postComment as ReturnType<typeof vi.fn>).mock.calls.find(
      (call) => typeof call[1] === "string" && (call[1] as string).includes("AI Plan Review"),
    )?.[1] as string;

    expect(comment).toContain("(step s1)");
    expect(comment).toContain("Nit");
  });
});
