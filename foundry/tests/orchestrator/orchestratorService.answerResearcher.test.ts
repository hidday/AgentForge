import { describe, it, expect, vi } from "vitest";
import { OrchestratorService } from "../../src/orchestrator/orchestratorService.js";
import { RunState } from "../../src/domain/runState.js";
import type { Run, Artifact } from "../../src/domain/types.js";
import type { Plan } from "../../src/schemas/plan.js";
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

function makePlanArtifact(plan: Plan): Artifact {
  return {
    id: "artifact-plan-1",
    runId: "run-1",
    type: "Plan",
    version: plan.planVersion,
    payloadJson: plan,
    rawText: JSON.stringify(plan),
    createdAt: new Date(),
  };
}

function makeTaskBundleArtifact(bundle: TaskBundle): Artifact {
  return {
    id: "artifact-bundle-1",
    runId: "run-1",
    type: "TaskBundle",
    version: 1,
    payloadJson: bundle,
    rawText: JSON.stringify(bundle),
    createdAt: new Date(),
  };
}

function makeResearchedAnswersArtifact(): Artifact {
  return {
    id: "artifact-researched-1",
    runId: "run-1",
    type: "ResearchedAnswers",
    version: 1,
    payloadJson: {
      summary: "prior research",
      answers: [
        {
          questionId: "q1",
          question: "Q?",
          answer: "Prior researched answer",
          confidence: "medium",
        },
      ],
      completedAt: "2026-05-17T12:00:00Z",
    },
    rawText: "{}",
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
    findLatestByType: vi.fn(),
  };

  const eventRepo = {
    create: vi.fn().mockResolvedValue({ id: "event-new" }),
    findByRunId: vi.fn().mockResolvedValue([]),
  };

  const linearClient = {
    getIssue: vi.fn(),
    postComment: vi.fn().mockResolvedValue(undefined),
  };

  const githubClient = {
    getPRDiff: vi.fn(),
  };

  const repoRegistry = {
    resolveForIssue: vi.fn(),
    resolveWorkingDirectory: vi.fn(),
    validateWorkingDirectory: vi.fn(),
    getRepoByName: vi.fn().mockReturnValue(null),
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
  const answerResearcherAgent = { run: vi.fn() };
  const executorAgent = { run: vi.fn() };
  const reviewerAgent = { run: vi.fn() };
  const remediationAgent = { run: vi.fn() };

  const gitService = {
    setupRunWorktree: vi.fn().mockResolvedValue({
      worktreePath: "/tmp/worktree",
      branchName: "ai/run-test1234",
    }),
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
      answerResearcherAgent,
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
    plannerAgent,
    planReviewerAgent,
    answerResearcherAgent,
    dashboardEmitter,
  };
}

function setupStartRunHappyPath(
  deps: ReturnType<typeof buildDeps>["deps"],
  todoRun: Run,
) {
  (deps.linearClient.getIssue as ReturnType<typeof vi.fn>).mockResolvedValue({
    id: "LIN-1",
    title: "Test",
    description: "Test",
    branchName: "hidday/lin-1-test",
    labels: [],
    priority: 0,
  });
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
  (deps.repoRegistry.resolveWorkingDirectory as ReturnType<typeof vi.fn>).mockReturnValue(
    "/tmp",
  );
  (deps.repoRegistry.validateWorkingDirectory as ReturnType<typeof vi.fn>).mockReturnValue(
    undefined,
  );
  (deps.runRepo.findActiveByIssueId as ReturnType<typeof vi.fn>).mockResolvedValue(null);
  (deps.runRepo.create as ReturnType<typeof vi.fn>).mockResolvedValue(todoRun);
}

describe("OrchestratorService -- answer researcher integration", () => {
  describe("non-blocking open questions path", () => {
    it("runs researcher, re-plans, persists RESEARCH_COMPLETED event, proceeds to PlanReview", async () => {
      const { deps, runRepo, artifactRepo, eventRepo, plannerAgent, answerResearcherAgent, planReviewerAgent } =
        buildDeps();
      const svc = new OrchestratorService(deps as never);

      const todoRun = makeRun({ state: RunState.Todo });
      const planningRun = makeRun({ state: RunState.Planning, planVersion: 1 });
      const planningRunV2 = makeRun({ state: RunState.Planning, planVersion: 2 });
      const planReviewRun = makeRun({ state: RunState.PlanReview, planVersion: 2 });
      const awaitingApprovalRun = makeRun({
        state: RunState.AwaitingPlanApproval,
        planVersion: 2,
      });

      const initialPlanWithQuestions = makePlan({
        planVersion: 1,
        openQuestions: [
          { id: "q1", question: "Optional thing?", requiredForExecution: false },
        ],
      });
      const revisedPlanCleared = makePlan({ planVersion: 2, openQuestions: [] });

      setupStartRunHappyPath(deps, todoRun);

      // findById is invoked inside runPlanReview() via requireRun().
      runRepo.findById.mockResolvedValue(planReviewRun);

      runRepo.updateState
        .mockResolvedValueOnce(planningRun)
        .mockResolvedValueOnce(planReviewRun)
        .mockResolvedValueOnce(awaitingApprovalRun);

      runRepo.update
        .mockResolvedValueOnce({
          ...todoRun,
          workingDirectory: "/tmp/worktree",
          branchName: "ai/run-test1234",
        })
        .mockResolvedValueOnce(planningRun)
        .mockResolvedValueOnce(planningRunV2);

      // ResearchedAnswers does not exist on first lookup; TaskBundle / Plan returned as needed.
      artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
        if (type === "ResearchedAnswers") return Promise.resolve(null);
        if (type === "Plan") return Promise.resolve(makePlanArtifact(revisedPlanCleared));
        if (type === "TaskBundle") return Promise.resolve(makeTaskBundleArtifact(makeTaskBundle()));
        if (type === "HumanAnswers") return Promise.resolve(null);
        return Promise.resolve(null);
      });

      // Planner: first returns initial (with question), second returns revised (cleared).
      plannerAgent.run
        .mockResolvedValueOnce(initialPlanWithQuestions)
        .mockResolvedValueOnce(revisedPlanCleared);

      answerResearcherAgent.run.mockResolvedValue({
        summary: "Resolved 1 question.",
        answers: [
          {
            questionId: "q1",
            question: "Optional thing?",
            answer: "Yes do it.",
            confidence: "high",
            sources: [],
          },
        ],
        completedAt: "2026-05-17T12:00:00Z",
      });

      planReviewerAgent.run.mockResolvedValue({
        overallVerdict: "approved",
        summary: "OK",
        findings: [],
      });

      const result = await svc.startRun("LIN-1");

      // Researcher should have been called exactly once
      expect(answerResearcherAgent.run).toHaveBeenCalledTimes(1);
      // Planner should have been called twice (initial + post-research re-plan)
      expect(plannerAgent.run).toHaveBeenCalledTimes(2);
      // The re-plan call must have received the researchedAnswers
      expect(plannerAgent.run.mock.calls[1][2]).toMatchObject({
        researchedAnswers: expect.arrayContaining([
          expect.objectContaining({ questionId: "q1", confidence: "high" }),
        ]),
        planVersionOverride: 2,
      });

      // RESEARCH_COMPLETED event recorded
      const eventTypes = eventRepo.create.mock.calls.map(
        (c: unknown[]) => (c[0] as { eventType: string }).eventType,
      );
      expect(eventTypes).toContain("RESEARCH_COMPLETED");

      // ResearchedAnswers artifact NOT persisted by orchestrator (the agent stub doesn't
      // call artifactRepo); but the orchestrator must still update planVersion to 2.
      expect(runRepo.update).toHaveBeenCalledWith(
        "run-1",
        expect.objectContaining({ planVersion: 2 }),
      );

      // Should have proceeded to plan review (plan-reviewer was called)
      expect(planReviewerAgent.run).toHaveBeenCalledTimes(1);

      expect(result).toBeDefined();
    });
  });

  describe("blocking questions remain after research", () => {
    it("transitions to HumanClarificationNeeded when revised plan still has blockers", async () => {
      const { deps, runRepo, artifactRepo, eventRepo, plannerAgent, answerResearcherAgent, planReviewerAgent } =
        buildDeps();
      const svc = new OrchestratorService(deps as never);

      const todoRun = makeRun({ state: RunState.Todo });
      const planningRun = makeRun({ state: RunState.Planning, planVersion: 1 });
      const planningRunV2 = makeRun({ state: RunState.Planning, planVersion: 2 });
      const planReviewRun = makeRun({ state: RunState.PlanReview, planVersion: 2 });
      const clarificationRun = makeRun({
        state: RunState.HumanClarificationNeeded,
        planVersion: 2,
      });

      const planWithBlocker = makePlan({
        planVersion: 1,
        openQuestions: [{ id: "q1", question: "Critical?", requiredForExecution: true }],
      });
      const revisedPlanStillBlocking = makePlan({
        planVersion: 2,
        openQuestions: [{ id: "q1", question: "Critical?", requiredForExecution: true }],
      });

      setupStartRunHappyPath(deps, todoRun);

      runRepo.updateState
        .mockResolvedValueOnce(planningRun)
        .mockResolvedValueOnce(planReviewRun)
        .mockResolvedValueOnce(clarificationRun);

      runRepo.update
        .mockResolvedValueOnce({
          ...todoRun,
          workingDirectory: "/tmp/worktree",
          branchName: "ai/run-test1234",
        })
        .mockResolvedValueOnce(planningRun)
        .mockResolvedValueOnce(planningRunV2);

      artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
        if (type === "ResearchedAnswers") return Promise.resolve(null);
        if (type === "Plan")
          return Promise.resolve(makePlanArtifact(revisedPlanStillBlocking));
        if (type === "TaskBundle") return Promise.resolve(makeTaskBundleArtifact(makeTaskBundle()));
        if (type === "HumanAnswers") return Promise.resolve(null);
        return Promise.resolve(null);
      });

      plannerAgent.run
        .mockResolvedValueOnce(planWithBlocker)
        .mockResolvedValueOnce(revisedPlanStillBlocking);

      answerResearcherAgent.run.mockResolvedValue({
        summary: "Could not resolve blocker.",
        answers: [
          {
            questionId: "q1",
            question: "Critical?",
            answer: "Genuinely unclear, needs human input.",
            confidence: "unresolved",
            sources: [],
          },
        ],
        completedAt: "2026-05-17T12:00:00Z",
      });

      const result = await svc.startRun("LIN-1");

      // Researcher ran, but plan review did NOT (we pause for humans)
      expect(answerResearcherAgent.run).toHaveBeenCalledTimes(1);
      expect(planReviewerAgent.run).not.toHaveBeenCalled();

      // Final state: HumanClarificationNeeded
      expect(result.state).toBe(RunState.HumanClarificationNeeded);

      // RESEARCH_COMPLETED event still recorded, even when blockers remain
      const eventTypes = eventRepo.create.mock.calls.map(
        (c: unknown[]) => (c[0] as { eventType: string }).eventType,
      );
      expect(eventTypes).toContain("RESEARCH_COMPLETED");
    });
  });

  describe("loop guard", () => {
    it("does NOT re-run researcher when a ResearchedAnswers artifact already exists", async () => {
      const { deps, runRepo, artifactRepo, plannerAgent, answerResearcherAgent } = buildDeps();
      const svc = new OrchestratorService(deps as never);

      const todoRun = makeRun({ state: RunState.Todo });
      const planningRun = makeRun({ state: RunState.Planning, planVersion: 1 });
      const clarificationRun = makeRun({
        state: RunState.HumanClarificationNeeded,
        planVersion: 1,
      });

      const planWithBlocker = makePlan({
        planVersion: 1,
        openQuestions: [{ id: "q1", question: "Blocker?", requiredForExecution: true }],
      });

      setupStartRunHappyPath(deps, todoRun);

      runRepo.updateState
        .mockResolvedValueOnce(planningRun)
        .mockResolvedValueOnce(makeRun({ state: RunState.PlanReview, planVersion: 1 }))
        .mockResolvedValueOnce(clarificationRun);

      runRepo.update
        .mockResolvedValueOnce({
          ...todoRun,
          workingDirectory: "/tmp/worktree",
          branchName: "ai/run-test1234",
        })
        .mockResolvedValueOnce(planningRun);

      // Researcher artifact ALREADY exists (e.g. from prior planning pass)
      artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
        if (type === "ResearchedAnswers") return Promise.resolve(makeResearchedAnswersArtifact());
        if (type === "Plan") return Promise.resolve(makePlanArtifact(planWithBlocker));
        if (type === "TaskBundle") return Promise.resolve(makeTaskBundleArtifact(makeTaskBundle()));
        return Promise.resolve(null);
      });

      plannerAgent.run.mockResolvedValueOnce(planWithBlocker);

      const result = await svc.startRun("LIN-1");

      // Loop guard MUST prevent the researcher from running again.
      expect(answerResearcherAgent.run).not.toHaveBeenCalled();
      // Planner is called once (initial); not a second time because the loop-guarded
      // helper returns the plan as-is.
      expect(plannerAgent.run).toHaveBeenCalledTimes(1);
      // And the run is still routed to clarification (blocker remains).
      expect(result.state).toBe(RunState.HumanClarificationNeeded);
    });

    it("does NOT run researcher when answerResearcherAgent dep is undefined", async () => {
      const { deps, runRepo, artifactRepo, plannerAgent } = buildDeps({
        answerResearcherAgent: undefined,
      });
      const svc = new OrchestratorService(deps as never);

      const todoRun = makeRun({ state: RunState.Todo });
      const planningRun = makeRun({ state: RunState.Planning, planVersion: 1 });
      const planReviewRun = makeRun({ state: RunState.PlanReview, planVersion: 1 });

      const planWithQuestions = makePlan({
        planVersion: 1,
        openQuestions: [
          { id: "q1", question: "Optional?", requiredForExecution: false },
        ],
      });

      setupStartRunHappyPath(deps, todoRun);

      // findById is invoked inside runPlanReview() via requireRun().
      runRepo.findById.mockResolvedValue(planReviewRun);

      runRepo.updateState
        .mockResolvedValueOnce(planningRun)
        .mockResolvedValueOnce(planReviewRun)
        .mockResolvedValueOnce(makeRun({ state: RunState.AwaitingPlanApproval, planVersion: 1 }));

      runRepo.update
        .mockResolvedValueOnce({
          ...todoRun,
          workingDirectory: "/tmp/worktree",
          branchName: "ai/run-test1234",
        })
        .mockResolvedValueOnce(planningRun);

      artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
        if (type === "Plan") return Promise.resolve(makePlanArtifact(planWithQuestions));
        if (type === "TaskBundle") return Promise.resolve(makeTaskBundleArtifact(makeTaskBundle()));
        return Promise.resolve(null);
      });

      plannerAgent.run.mockResolvedValueOnce(planWithQuestions);

      (deps as never as {
        planReviewerAgent: { run: ReturnType<typeof vi.fn> };
      }).planReviewerAgent.run.mockResolvedValue({
        overallVerdict: "approved",
        summary: "OK",
        findings: [],
      });

      const result = await svc.startRun("LIN-1");

      // Without the researcher dep, planner is only called once (no re-plan).
      expect(plannerAgent.run).toHaveBeenCalledTimes(1);
      expect(result).toBeDefined();
    });
  });
});
