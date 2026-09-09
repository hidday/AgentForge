import { describe, it, expect, vi } from "vitest";
import { OrchestratorService } from "../../src/orchestrator/orchestratorService.js";
import { RunState } from "../../src/domain/runState.js";
import { RunEvent } from "../../src/domain/runEvent.js";
import type { Run, Artifact, RunEventRecord, SkillDocument } from "../../src/domain/types.js";
import type { Plan } from "../../src/schemas/plan.js";
import type { ExecutionReport } from "../../src/schemas/executionReport.js";
import type { Review } from "../../src/schemas/review.js";

function makeRun(overrides: Partial<Run> = {}): Run {
  return {
    id: "run-1",
    linearIssueId: "LIN-1",
    linearIssueIdentifier: null,
    linearIssueDescription: null,
    linearIssueTitle: "Fix the widget",
    linearIssueUrl: null,
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
    workingDirectory: "/tmp/worktree",
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

function makeExecutionReport(overrides: Partial<ExecutionReport> = {}): ExecutionReport {
  return {
    executionVersion: 1,
    summary: "Implementation done.",
    filesChanged: ["src/foo.ts"],
    checks: {
      lint: { status: "pass", details: "ok" },
      typecheck: { status: "pass", details: "ok" },
      tests: { status: "pass", details: "ok" },
    },
    notes: [],
    prDraftCreated: true,
    score: 0.9,
    scoreRationale: "All green.",
    ...overrides,
  };
}

function makeReview(overrides: Partial<Review> = {}): Review {
  return {
    reviewId: "rev-1",
    summary: "Found issues",
    findings: [],
    overallVerdict: "approved",
    ...overrides,
  };
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

function makeEvent(overrides: Partial<RunEventRecord> = {}): RunEventRecord {
  return {
    id: "event-1",
    runId: "run-1",
    eventType: "SKILL_INJECTION",
    source: "orchestrator",
    payloadJson: {},
    createdAt: new Date(),
    ...overrides,
  };
}

function makeSkillDoc(overrides: Partial<SkillDocument> = {}): SkillDocument {
  return {
    id: "skill-1",
    repoSlug: "test-repo",
    name: "Skill",
    description: "desc",
    taskCategory: "backend",
    skillMarkdown: "# skill",
    utilityScore: 0.5,
    lastUsedAt: new Date(),
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
      title: "Test",
      description: "Test",
      branchName: "ai/lin-1",
      labels: [],
      priority: 0,
    }),
    postComment: vi.fn().mockResolvedValue(undefined),
    getRelatedContext: vi.fn().mockResolvedValue({ blockers: [] }),
  };

  const githubClient = {
    getPRDiff: vi.fn().mockResolvedValue("diff"),
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
    postReviewFindings: vi.fn().mockResolvedValue(new Map()),
    postRemediationResolutions: vi.fn().mockResolvedValue(undefined),
    postExecutionReportUpdate: vi.fn().mockResolvedValue(undefined),
  };

  const plannerAgent = { run: vi.fn() };
  const planReviewerAgent = { run: vi.fn() };
  const planReviserAgent = { run: vi.fn() };
  const executorAgent = { run: vi.fn() };
  const reviewerAgent = { run: vi.fn() };
  const remediationAgent = { run: vi.fn() };
  const distillationAgent = { run: vi.fn().mockResolvedValue(undefined) };

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
      distillationAgent,
      logger,
      dashboardEmitter,
      ...overrides,
    },
    runRepo,
    artifactRepo,
    eventRepo,
    linearClient,
    githubClient,
    gitService,
    logger,
    dashboardEmitter,
    distillationAgent,
    plannerAgent,
    planReviewerAgent,
    reviewerAgent,
    executorAgent,
  };
}

describe("OrchestratorService.approveHumanReview", () => {
  it("runs distillation, transitions to Done, and posts the completion comment", async () => {
    const { deps, runRepo, linearClient, distillationAgent } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    const run = makeRun({ state: RunState.ReadyForHumanReview });
    runRepo.findById.mockResolvedValue(run);
    runRepo.updateState.mockResolvedValue(makeRun({ state: RunState.Done }));

    const result = await svc.approveHumanReview("run-1");

    expect(distillationAgent.run).toHaveBeenCalledWith("run-1", run);
    expect(linearClient.postComment).toHaveBeenCalledWith(run.linearIssueId, expect.stringContaining("Done"));
    expect(result.state).toBe(RunState.Done);
  });

  it("continues (best-effort) and logs a warning when distillation throws", async () => {
    const { deps, runRepo, logger, distillationAgent } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    distillationAgent.run.mockRejectedValue(new Error("distill failed"));
    const run = makeRun({ state: RunState.ReadyForHumanReview });
    runRepo.findById.mockResolvedValue(run);
    runRepo.updateState.mockResolvedValue(makeRun({ state: RunState.Done }));

    const result = await svc.approveHumanReview("run-1");

    expect(result.state).toBe(RunState.Done);
    const warnCall = logger.warn.mock.calls.find(
      (c: unknown[]) => typeof c[1] === "string" && (c[1] as string).includes("Distillation agent failed"),
    );
    expect(warnCall?.[0]).toMatchObject({ runId: "run-1", error: "distill failed" });
  });

  it("works fine when no distillationAgent dependency is configured", async () => {
    const { deps, runRepo } = buildDeps({ distillationAgent: undefined });
    const svc = new OrchestratorService(deps as never);

    const run = makeRun({ state: RunState.ReadyForHumanReview });
    runRepo.findById.mockResolvedValue(run);
    runRepo.updateState.mockResolvedValue(makeRun({ state: RunState.Done }));

    const result = await svc.approveHumanReview("run-1");

    expect(result.state).toBe(RunState.Done);
  });
});

describe("OrchestratorService private helpers exercised through public methods", () => {
  describe("requireRun", () => {
    it("throws a descriptive error when the run does not exist", async () => {
      const { deps, runRepo } = buildDeps();
      const svc = new OrchestratorService(deps as never);
      runRepo.findById.mockResolvedValue(null);

      await expect(svc.markReady("missing-run")).rejects.toThrow("Run not found: missing-run");
    });
  });

  describe("cleanupRunWorktree via transitionAndRecord", () => {
    it("removes the worktree when the run's workingDirectory differs from the main repo path", async () => {
      const { deps, runRepo, gitService } = buildDeps();
      const svc = new OrchestratorService(deps as never);

      const run = makeRun({ state: RunState.ReadyForHumanReview, workingDirectory: "/tmp/worktree" });
      runRepo.findById.mockResolvedValue(run);
      runRepo.updateState.mockResolvedValue(makeRun({ state: RunState.Done, workingDirectory: "/tmp/worktree" }));
      gitService.resolveMainRepoPath.mockReturnValue("/tmp/main-repo");

      await svc.approveHumanReview("run-1");

      expect(gitService.removeWorktree).toHaveBeenCalledWith("/tmp/main-repo", "/tmp/worktree");
    });

    it("does not remove the worktree when the workingDirectory already IS the main repo path", async () => {
      const { deps, runRepo, gitService } = buildDeps();
      const svc = new OrchestratorService(deps as never);

      const run = makeRun({ state: RunState.ReadyForHumanReview, workingDirectory: "/repo/main" });
      runRepo.findById.mockResolvedValue(run);
      runRepo.updateState.mockResolvedValue(makeRun({ state: RunState.Done, workingDirectory: "/repo/main" }));
      gitService.resolveMainRepoPath.mockReturnValue("/repo/main");

      await svc.approveHumanReview("run-1");

      expect(gitService.removeWorktree).not.toHaveBeenCalled();
    });

    it("does not clean up the worktree for a non-terminal transition", async () => {
      const { deps, runRepo, gitService, artifactRepo } = buildDeps();
      const svc = new OrchestratorService(deps as never);

      const run = makeRun({ state: RunState.AwaitingPlanApproval });
      runRepo.findById.mockResolvedValue(run);
      artifactRepo.findLatestByType.mockResolvedValue(makeArtifact({ type: "Plan", payloadJson: makePlan() }));
      runRepo.update.mockResolvedValue(
        makeRun({ state: RunState.AwaitingPlanApproval, approvedPlanVersion: 1 }),
      );
      runRepo.updateState.mockResolvedValue(makeRun({ state: RunState.Implementing }));

      await svc.approvePlan("run-1");

      expect(gitService.removeWorktree).not.toHaveBeenCalled();
    });
  });

  describe("retrieveSkillsForPlanning / updateSkillMetrics via startRun", () => {
    function setupHappyStartRun(deps: ReturnType<typeof buildDeps>["deps"], run: Run) {
      (deps.runRepo.findActiveByIssueId as ReturnType<typeof vi.fn>).mockResolvedValue(null);
      (deps.repoRegistry.resolveForIssue as ReturnType<typeof vi.fn>).mockReturnValue({
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
      (deps.repoRegistry.resolveWorkingDirectory as ReturnType<typeof vi.fn>).mockReturnValue("/tmp");
      (deps.repoRegistry.validateWorkingDirectory as ReturnType<typeof vi.fn>).mockReturnValue(undefined);
      (deps.runRepo.create as ReturnType<typeof vi.fn>).mockResolvedValue(run);
      (deps.gitService.setupRunWorktree as ReturnType<typeof vi.fn>).mockResolvedValue({
        worktreePath: "/tmp/worktree",
        branchName: "ai/run-1",
      });
    }

    it("skips skill retrieval and injection entirely when agentSkillRepo is not configured", async () => {
      const { deps, runRepo, artifactRepo, plannerAgent, eventRepo } = buildDeps();
      const svc = new OrchestratorService(deps as never);

      const todoRun = makeRun({ state: RunState.Todo });
      setupHappyStartRun(deps, todoRun);
      runRepo.update
        .mockResolvedValueOnce(todoRun) // worktree path/branch update (still Todo)
        .mockResolvedValueOnce({ ...todoRun, state: RunState.Planning }); // planVersion update
      runRepo.updateState
        .mockResolvedValueOnce(makeRun({ state: RunState.Planning }))
        .mockResolvedValueOnce(makeRun({ state: RunState.PlanReview }));
      plannerAgent.run.mockResolvedValue(makePlan({ openQuestions: [] }));
      artifactRepo.findLatestByType.mockResolvedValue(null);
      vi.spyOn(svc, "runPlanReview").mockResolvedValue(makeRun({ state: RunState.PlanReview }));

      await svc.startRun("LIN-1");

      expect(plannerAgent.run).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        expect.objectContaining({ priorSkills: [] }),
      );
      const skillInjectionEvent = eventRepo.create.mock.calls.find(
        (c: unknown[]) => (c[0] as { eventType: string }).eventType === "SKILL_INJECTION",
      );
      expect(skillInjectionEvent).toBeUndefined();
    });

    it("injects retrieved skills and records a SKILL_INJECTION event when agentSkillRepo returns matches", async () => {
      const agentSkillRepo = {
        findTopKByRelevance: vi.fn().mockResolvedValue([makeSkillDoc()]),
        incrementSuccess: vi.fn(),
        incrementFailure: vi.fn(),
        archiveIfLowUtility: vi.fn(),
      };
      const { deps, runRepo, artifactRepo, plannerAgent, eventRepo } = buildDeps({ agentSkillRepo });
      const svc = new OrchestratorService(deps as never);

      const todoRun = makeRun({ state: RunState.Todo, linearIssueTitle: "Fix the widget" });
      setupHappyStartRun(deps, todoRun);
      runRepo.update
        .mockResolvedValueOnce(todoRun)
        .mockResolvedValueOnce({ ...todoRun, state: RunState.Planning });
      runRepo.updateState
        .mockResolvedValueOnce(makeRun({ state: RunState.Planning }))
        .mockResolvedValueOnce(makeRun({ state: RunState.PlanReview }));
      plannerAgent.run.mockResolvedValue(makePlan({ openQuestions: [] }));
      artifactRepo.findLatestByType.mockResolvedValue(null);
      vi.spyOn(svc, "runPlanReview").mockResolvedValue(makeRun({ state: RunState.PlanReview }));

      await svc.startRun("LIN-1");

      expect(agentSkillRepo.findTopKByRelevance).toHaveBeenCalledWith(
        "test-repo",
        expect.stringContaining("Fix the widget"),
        expect.any(Number),
      );
      const skillInjectionEvent = eventRepo.create.mock.calls.find(
        (c: unknown[]) => (c[0] as { eventType: string }).eventType === "SKILL_INJECTION",
      );
      expect(skillInjectionEvent?.[0]).toMatchObject({
        payloadJson: { skillIds: ["skill-1"] },
      });
    });

    it("increments success metrics and archives low-utility skills on a Done transition", async () => {
      const agentSkillRepo = {
        findTopKByRelevance: vi.fn(),
        incrementSuccess: vi.fn().mockResolvedValue(makeSkillDoc({ utilityScore: 0.05 }) as never),
        incrementFailure: vi.fn(),
        archiveIfLowUtility: vi.fn().mockResolvedValue(undefined),
      };
      const { deps, runRepo, eventRepo } = buildDeps({ agentSkillRepo });
      const svc = new OrchestratorService(deps as never);

      const run = makeRun({ state: RunState.ReadyForHumanReview });
      runRepo.findById.mockResolvedValue(run);
      runRepo.updateState.mockResolvedValue(makeRun({ state: RunState.Done }));
      eventRepo.findByRunId.mockResolvedValue([
        makeEvent({ eventType: "SKILL_INJECTION", payloadJson: { skillIds: ["skill-1", "skill-2"] } }),
      ]);

      await svc.approveHumanReview("run-1");

      expect(agentSkillRepo.incrementSuccess).toHaveBeenCalledWith("skill-1");
      expect(agentSkillRepo.incrementSuccess).toHaveBeenCalledWith("skill-2");
      expect(agentSkillRepo.archiveIfLowUtility).toHaveBeenCalledTimes(2);
    });

    it("increments failure metrics when a run transitions to Failed (clarification exhausted)", async () => {
      const agentSkillRepo = {
        findTopKByRelevance: vi.fn(),
        incrementSuccess: vi.fn(),
        incrementFailure: vi.fn().mockResolvedValue(makeSkillDoc() as never),
        archiveIfLowUtility: vi.fn().mockResolvedValue(undefined),
      };
      const { deps, runRepo, artifactRepo, plannerAgent } = buildDeps({ agentSkillRepo });
      const svc = new OrchestratorService(deps as never);

      const run = makeRun({ state: RunState.HumanClarificationNeeded, planVersion: 1 });
      const planningRun = makeRun({ state: RunState.Planning });
      const planReviewRun = makeRun({ state: RunState.PlanReview });
      const failedRun = makeRun({ state: RunState.Failed });

      runRepo.findById.mockResolvedValue(run);
      runRepo.updateState
        .mockResolvedValueOnce(planningRun) // CLARIFICATION_PROVIDED -> Planning
        .mockResolvedValueOnce(planReviewRun) // PLAN_CREATED -> PlanReview
        .mockResolvedValueOnce(failedRun); // CLARIFICATION_EXHAUSTED -> Failed
      runRepo.update.mockResolvedValue({ ...planningRun, planVersion: 2 });

      const stillBlockedPlan = makePlan({
        planVersion: 2,
        openQuestions: [{ id: "q1", question: "Still unclear?", requiredForExecution: true }],
      });
      artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
        if (type === "Plan")
          return Promise.resolve(
            makeArtifact({
              type: "Plan",
              payloadJson: makePlan({
                planVersion: 1,
                openQuestions: [{ id: "q1", question: "Unclear?", requiredForExecution: true }],
              }),
            }),
          );
        if (type === "TaskBundle")
          return Promise.resolve(
            makeArtifact({
              type: "TaskBundle",
              payloadJson: {
                issue: { id: "LIN-1", title: "T", description: "d", labels: [], priority: 0 },
                repo: {
                  name: "test-repo",
                  defaultBranch: "main",
                  workingBranch: "ai/run-1",
                  repoPath: "/tmp",
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
            }),
          );
        return Promise.resolve(null);
      });
      plannerAgent.run.mockResolvedValue(stillBlockedPlan);

      // Three prior NEEDS_HUMAN_CLARIFICATION events (max reached) plus a prior
      // SKILL_INJECTION event that updateSkillMetrics must pick up once Failed.
      (deps.eventRepo.findByRunId as ReturnType<typeof vi.fn>).mockResolvedValue([
        makeEvent({ eventType: RunEvent.NEEDS_HUMAN_CLARIFICATION }),
        makeEvent({ eventType: RunEvent.NEEDS_HUMAN_CLARIFICATION }),
        makeEvent({ eventType: RunEvent.NEEDS_HUMAN_CLARIFICATION }),
        makeEvent({ eventType: "SKILL_INJECTION", payloadJson: { skillIds: ["skill-1"] } }),
      ]);

      const result = await svc.answerQuestions("run-1", [{ questionId: "q1", answer: "still confused" }]);

      expect(result.state).toBe(RunState.Failed);
      expect(agentSkillRepo.incrementFailure).toHaveBeenCalledWith("skill-1");
      expect(agentSkillRepo.archiveIfLowUtility).toHaveBeenCalledTimes(1);
    });

    it("swallows and logs errors from an individual skill metric update without aborting the loop", async () => {
      const agentSkillRepo = {
        findTopKByRelevance: vi.fn(),
        incrementSuccess: vi.fn().mockRejectedValue(new Error("db down")),
        incrementFailure: vi.fn(),
        archiveIfLowUtility: vi.fn(),
      };
      const { deps, runRepo, logger } = buildDeps({ agentSkillRepo });
      const svc = new OrchestratorService(deps as never);

      const run = makeRun({ state: RunState.ReadyForHumanReview });
      runRepo.findById.mockResolvedValue(run);
      runRepo.updateState.mockResolvedValue(makeRun({ state: RunState.Done }));
      (deps.eventRepo.findByRunId as ReturnType<typeof vi.fn>).mockResolvedValue([
        makeEvent({ eventType: "SKILL_INJECTION", payloadJson: { skillIds: ["skill-1"] } }),
      ]);

      await svc.approveHumanReview("run-1");

      expect(agentSkillRepo.archiveIfLowUtility).not.toHaveBeenCalled();
      const warnCall = logger.warn.mock.calls.find(
        (c: unknown[]) => typeof c[1] === "string" && (c[1] as string).includes("Failed to update skill metric"),
      );
      expect(warnCall?.[0]).toMatchObject({ runId: "run-1", skillId: "skill-1", error: "db down" });
    });

    it("does nothing when there are no SKILL_INJECTION events to update", async () => {
      const agentSkillRepo = {
        findTopKByRelevance: vi.fn(),
        incrementSuccess: vi.fn(),
        incrementFailure: vi.fn(),
        archiveIfLowUtility: vi.fn(),
      };
      const { deps, runRepo } = buildDeps({ agentSkillRepo });
      const svc = new OrchestratorService(deps as never);

      const run = makeRun({ state: RunState.ReadyForHumanReview });
      runRepo.findById.mockResolvedValue(run);
      runRepo.updateState.mockResolvedValue(makeRun({ state: RunState.Done }));

      await svc.approveHumanReview("run-1");

      expect(agentSkillRepo.incrementSuccess).not.toHaveBeenCalled();
    });
  });

  describe("buildTaskBundle via runPlanReview", () => {
    it("uses the remote default branch and warns when it differs from config", async () => {
      const { deps, artifactRepo, githubClient, planReviewerAgent, logger, plannerAgent } = buildDeps();
      void plannerAgent;
      const svc = new OrchestratorService(deps as never);

      const run = makeRun({ state: RunState.PlanReview });
      (deps.runRepo.findById as ReturnType<typeof vi.fn>).mockResolvedValue(run);
      artifactRepo.findLatestByType.mockResolvedValue(makeArtifact({ type: "Plan", payloadJson: makePlan() }));
      githubClient.getDefaultBranch.mockResolvedValue("develop");
      (deps.runRepo.updateState as ReturnType<typeof vi.fn>).mockResolvedValue(
        makeRun({ state: RunState.AwaitingPlanApproval }),
      );
      planReviewerAgent.run.mockResolvedValue(makeReview({ overallVerdict: "approved" }) as never);

      await svc.runPlanReview("run-1");

      expect(planReviewerAgent.run).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ repo: expect.objectContaining({ defaultBranch: "develop" }) }),
        "run-1",
      );
      const warnCall = logger.warn.mock.calls.find(
        (c: unknown[]) =>
          typeof c[1] === "string" && (c[1] as string).includes("Config defaultBranch differs"),
      );
      expect(warnCall).toBeDefined();
    });

    it("falls back to the config default branch and warns when GitHub lookup throws", async () => {
      const { deps, artifactRepo, githubClient, planReviewerAgent, logger } = buildDeps();
      const svc = new OrchestratorService(deps as never);

      const run = makeRun({ state: RunState.PlanReview });
      (deps.runRepo.findById as ReturnType<typeof vi.fn>).mockResolvedValue(run);
      artifactRepo.findLatestByType.mockResolvedValue(makeArtifact({ type: "Plan", payloadJson: makePlan() }));
      githubClient.getDefaultBranch.mockRejectedValue(new Error("network error"));
      (deps.runRepo.updateState as ReturnType<typeof vi.fn>).mockResolvedValue(
        makeRun({ state: RunState.AwaitingPlanApproval }),
      );
      planReviewerAgent.run.mockResolvedValue(makeReview({ overallVerdict: "approved" }) as never);

      await svc.runPlanReview("run-1");

      expect(planReviewerAgent.run).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ repo: expect.objectContaining({ defaultBranch: "main" }) }),
        "run-1",
      );
      const warnCall = logger.warn.mock.calls.find(
        (c: unknown[]) =>
          typeof c[1] === "string" && (c[1] as string).includes("Failed to resolve default branch"),
      );
      expect(warnCall).toBeDefined();
    });
  });

  describe("comment formatting branches", () => {
    it("collapses the file list into a <details> block when more than 8 files changed, and includes notes", async () => {
      const { deps, runRepo, artifactRepo, executorAgent, linearClient } = buildDeps();
      const svc = new OrchestratorService(deps as never);

      const run = makeRun({ state: RunState.Implementing, prNumber: null, branchName: null });
      runRepo.findById.mockResolvedValue(run);
      artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
        if (type === "Plan") return Promise.resolve(makeArtifact({ type: "Plan", payloadJson: makePlan() }));
        return Promise.resolve(null);
      });
      const manyFiles = Array.from({ length: 9 }, (_, i) => `src/file${i}.ts`);
      runRepo.update.mockResolvedValue(makeRun({ state: RunState.Implementing, prNumber: 7 }));
      runRepo.updateState.mockResolvedValue(makeRun({ state: RunState.AIReview, prNumber: 7 }));
      executorAgent.run.mockResolvedValue({
        report: makeExecutionReport({ filesChanged: manyFiles, notes: ["Watch out for X"] }),
        prNumber: 7,
      });
      vi.spyOn(svc, "runReview").mockResolvedValue(makeRun());

      await svc.runExecution("run-1");

      const commentCall = linearClient.postComment.mock.calls.find(
        (c: unknown[]) => typeof c[1] === "string" && (c[1] as string).includes("Execution Report"),
      );
      expect(commentCall?.[1]).toContain("<details>");
      expect(commentCall?.[1]).toContain("Files changed (9)");
      expect(commentCall?.[1]).toContain("### Notes");
      expect(commentCall?.[1]).toContain("Watch out for X");
    });

    it("lists files inline (no <details>) and omits the Notes section when there are none", async () => {
      const { deps, runRepo, artifactRepo, executorAgent, linearClient } = buildDeps();
      const svc = new OrchestratorService(deps as never);

      const run = makeRun({ state: RunState.Implementing, prNumber: null, branchName: null });
      runRepo.findById.mockResolvedValue(run);
      artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
        if (type === "Plan") return Promise.resolve(makeArtifact({ type: "Plan", payloadJson: makePlan() }));
        return Promise.resolve(null);
      });
      runRepo.update.mockResolvedValue(makeRun({ state: RunState.Implementing, prNumber: 7 }));
      runRepo.updateState.mockResolvedValue(makeRun({ state: RunState.AIReview, prNumber: 7 }));
      executorAgent.run.mockResolvedValue({
        report: makeExecutionReport({ filesChanged: ["src/a.ts"], notes: [] }),
        prNumber: 7,
      });
      vi.spyOn(svc, "runReview").mockResolvedValue(makeRun());

      await svc.runExecution("run-1");

      const commentCall = linearClient.postComment.mock.calls.find(
        (c: unknown[]) => typeof c[1] === "string" && (c[1] as string).includes("Execution Report"),
      );
      expect(commentCall?.[1]).not.toContain("<details>");
      expect(commentCall?.[1]).not.toContain("### Notes");
    });

    it("includes open questions and risks in the plan comment when the plan review approves", async () => {
      const { deps, artifactRepo, linearClient, planReviewerAgent } = buildDeps();
      const svc = new OrchestratorService(deps as never);

      const run = makeRun({ state: RunState.PlanReview });
      (deps.runRepo.findById as ReturnType<typeof vi.fn>).mockResolvedValue(run);
      artifactRepo.findLatestByType.mockResolvedValue(
        makeArtifact({
          type: "Plan",
          payloadJson: makePlan({
            openQuestions: [{ id: "q1", question: "Which auth?", requiredForExecution: true }],
            risks: ["Migration could fail"],
          }),
        }),
      );
      (deps.runRepo.updateState as ReturnType<typeof vi.fn>).mockResolvedValue(
        makeRun({ state: RunState.AwaitingPlanApproval }),
      );
      (planReviewerAgent.run as ReturnType<typeof vi.fn>).mockResolvedValue(
        makeReview({ overallVerdict: "approved" }) as never,
      );

      await svc.runPlanReview("run-1");

      const commentCall = linearClient.postComment.mock.calls.find(
        (c: unknown[]) => typeof c[1] === "string" && (c[1] as string).includes("AI Plan (v"),
      );
      expect(commentCall?.[1]).toContain("Open Questions");
      expect(commentCall?.[1]).toContain("Which auth?");
      expect(commentCall?.[1]).toContain("*blocks execution*");
      expect(commentCall?.[1]).toContain("Risks");
      expect(commentCall?.[1]).toContain("Migration could fail");
    });

    it("includes a line hint in code review findings when present", async () => {
      const { deps, runRepo, artifactRepo, reviewerAgent, linearClient } = buildDeps();
      const svc = new OrchestratorService(deps as never);

      const run = makeRun({ state: RunState.AIReview, prNumber: 10 });
      runRepo.findById.mockResolvedValue(run);
      artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
        if (type === "ExecutionReport")
          return Promise.resolve(makeArtifact({ type: "ExecutionReport", payloadJson: makeExecutionReport() }));
        if (type === "Plan") return Promise.resolve(makeArtifact({ type: "Plan", payloadJson: makePlan() }));
        return Promise.resolve(null);
      });
      runRepo.update.mockResolvedValue(run);
      runRepo.updateState.mockResolvedValue(makeRun({ state: RunState.AddressingReview }));
      reviewerAgent.run.mockResolvedValue(
        makeReview({
          overallVerdict: "changes_requested",
          findings: [
            {
              id: "f1",
              severity: "important",
              type: "bug",
              file: "src/a.ts",
              lineHint: 42,
              title: "Off by one",
              details: "Loop bound is wrong",
            },
          ],
        }),
      );
      vi.spyOn(svc, "runRemediation").mockResolvedValue(makeRun());

      await svc.runReview("run-1");

      const commentCall = linearClient.postComment.mock.calls.find(
        (c: unknown[]) => typeof c[1] === "string" && (c[1] as string).includes("AI Code Review"),
      );
      expect(commentCall?.[1]).toContain("src/a.ts:42");
    });
  });
});
