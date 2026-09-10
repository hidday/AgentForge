import { describe, it, expect, vi } from "vitest";
import { OrchestratorService } from "../../src/orchestrator/orchestratorService.js";
import { RunState } from "../../src/domain/runState.js";
import { RunEvent } from "../../src/domain/runEvent.js";
import type { Run, Artifact } from "../../src/domain/types.js";
import type { Plan } from "../../src/schemas/plan.js";
import type { TaskBundle } from "../../src/schemas/taskBundle.js";

// This file covers gaps left by tests/orchestrator/orchestratorService.clarification.test.ts
// (confirmed via coverage-final.json branch/statement analysis before writing these):
//  - answerQuestions throws a plain Error when no Plan artifact exists for the run
//  - answerQuestions throws a plain Error when no TaskBundle artifact exists (HumanClarificationNeeded path)
//  - the "ResearchedAnswers already exists" branch feeding into the re-plan call
//  - the "still has blockers, but under MAX_CLARIFICATION_ITERATIONS" loop-back branch
//    (as opposed to the already-covered "exhausted" branch)

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

function asArtifact(overrides: {
  type: Artifact["type"];
  version: number;
  payloadJson: unknown;
}): Artifact {
  return {
    id: `artifact-${overrides.type}-${overrides.version}`,
    runId: "run-1",
    type: overrides.type,
    version: overrides.version,
    payloadJson: overrides.payloadJson,
    rawText: JSON.stringify(overrides.payloadJson),
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
      branchName: "ai/lin-1",
      labels: [],
      priority: 0,
    }),
    postComment: vi.fn().mockResolvedValue(undefined),
  };

  const githubClient = { getPRDiff: vi.fn() };

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
  const planReviewerAgent = {
    run: vi.fn().mockResolvedValue({ overallVerdict: "approved", summary: "OK", findings: [] }),
  };
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
    plannerAgent,
    planReviewerAgent,
  };
}

describe("OrchestratorService.answerQuestions -- gaps not covered by orchestratorService.clarification.test.ts", () => {
  it("throws a plain Error when no Plan artifact exists for the run", async () => {
    const { deps, runRepo, artifactRepo } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    runRepo.findById.mockResolvedValue(makeRun({ state: RunState.HumanClarificationNeeded }));
    artifactRepo.findLatestByType.mockResolvedValue(null);

    await expect(
      svc.answerQuestions("run-1", [{ questionId: "q1", answer: "yes" }]),
    ).rejects.toThrow(/No plan artifact found for run run-1/);
  });

  it("throws a plain Error when no TaskBundle artifact exists (HumanClarificationNeeded path)", async () => {
    const { deps, runRepo, artifactRepo } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    const run = makeRun({ state: RunState.HumanClarificationNeeded });
    const plan = makePlan({
      openQuestions: [{ id: "q1", question: "Required?", requiredForExecution: true }],
    });
    runRepo.findById.mockResolvedValue(run);
    artifactRepo.findLatestByType.mockImplementation((_: string, type: string) => {
      if (type === "Plan") return Promise.resolve(asArtifact({ type: "Plan", version: 1, payloadJson: plan }));
      // TaskBundle intentionally absent
      return Promise.resolve(null);
    });

    await expect(
      svc.answerQuestions("run-1", [{ questionId: "q1", answer: "yes" }]),
    ).rejects.toThrow(/No TaskBundle artifact found for run run-1/);
  });

  it("includes prior ResearchedAnswers when re-planning, and preserves them if research is skipped (already exists)", async () => {
    const { deps, runRepo, artifactRepo, eventRepo, plannerAgent } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    const run = makeRun({ state: RunState.HumanClarificationNeeded });
    const plan = makePlan({
      openQuestions: [{ id: "q1", question: "Required?", requiredForExecution: true }],
    });
    const taskBundle = makeTaskBundle();
    const priorResearched = {
      summary: "prior research",
      answers: [
        { questionId: "q0", question: "Earlier Q?", answer: "Earlier A", confidence: "medium" },
      ],
      completedAt: "2026-01-01T00:00:00Z",
    };

    const planningRun = makeRun({ state: RunState.Planning });
    const planReviewRun = makeRun({ state: RunState.PlanReview });
    const awaitingApprovalRun = makeRun({ state: RunState.AwaitingPlanApproval });

    const newPlan = makePlan({ planVersion: 2, openQuestions: [] });

    runRepo.findById.mockResolvedValueOnce(run).mockResolvedValue(planReviewRun);
    runRepo.updateState
      .mockResolvedValueOnce(planningRun)
      .mockResolvedValueOnce(planReviewRun)
      .mockResolvedValueOnce(awaitingApprovalRun);
    runRepo.update.mockResolvedValue({ ...planningRun, planVersion: 2 });

    artifactRepo.findLatestByType.mockImplementation((_: string, type: string) => {
      if (type === "Plan") return Promise.resolve(asArtifact({ type: "Plan", version: 1, payloadJson: plan }));
      if (type === "TaskBundle") return Promise.resolve(asArtifact({ type: "TaskBundle", version: 1, payloadJson: taskBundle }));
      if (type === "ResearchedAnswers") return Promise.resolve(asArtifact({ type: "ResearchedAnswers", version: 1, payloadJson: priorResearched }));
      if (type === "PlanReview") {
        return Promise.resolve(
          asArtifact({
            type: "PlanReview",
            version: 1,
            payloadJson: { overallVerdict: "approved", summary: "OK", findings: [] },
          }),
        );
      }
      return Promise.resolve(null);
    });

    plannerAgent.run.mockResolvedValue(newPlan);
    eventRepo.findByRunId.mockResolvedValue([]);

    await svc.answerQuestions("run-1", [{ questionId: "q1", answer: "yes" }]);

    // First plannerAgent.run call (direct from answerQuestions) carries the prior
    // researched answers alongside the fresh human answers.
    expect(plannerAgent.run).toHaveBeenNthCalledWith(
      1,
      taskBundle,
      "run-1",
      expect.objectContaining({
        humanAnswers: [{ questionId: "q1", answer: "yes" }],
        researchedAnswers: priorResearched.answers,
      }),
    );

    // Because a ResearchedAnswers artifact already exists, maybeResearchAndReplan's
    // loop guard means the planner is not invoked a second time even though newPlan
    // has no open questions (nothing to research).
    expect(plannerAgent.run).toHaveBeenCalledTimes(1);
  });

  it("loops back to HumanClarificationNeeded (does not fail) when blockers remain but the iteration count is under the max", async () => {
    const { deps, runRepo, artifactRepo, eventRepo, plannerAgent, planReviewerAgent } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    const run = makeRun({ state: RunState.HumanClarificationNeeded });
    const plan = makePlan({
      openQuestions: [{ id: "q1", question: "Required?", requiredForExecution: true }],
    });
    const taskBundle = makeTaskBundle();
    const newPlan = makePlan({
      planVersion: 2,
      openQuestions: [{ id: "q1", question: "Still required?", requiredForExecution: true }],
    });

    const planningRun = makeRun({ state: RunState.Planning });
    const planReviewRun = makeRun({ state: RunState.PlanReview, planVersion: 2 });
    const clarificationRun = makeRun({ state: RunState.HumanClarificationNeeded, planVersion: 2 });

    runRepo.findById.mockResolvedValue(run);
    runRepo.updateState
      .mockResolvedValueOnce(planningRun) // CLARIFICATION_PROVIDED
      .mockResolvedValueOnce(planReviewRun) // PLAN_CREATED
      .mockResolvedValueOnce(clarificationRun); // NEEDS_HUMAN_CLARIFICATION (loop back)
    runRepo.update.mockResolvedValue({ ...planningRun, planVersion: 2 });

    artifactRepo.findLatestByType.mockImplementation((_: string, type: string) => {
      if (type === "Plan") return Promise.resolve(asArtifact({ type: "Plan", version: 1, payloadJson: plan }));
      if (type === "TaskBundle") return Promise.resolve(asArtifact({ type: "TaskBundle", version: 1, payloadJson: taskBundle }));
      return Promise.resolve(null);
    });
    plannerAgent.run.mockResolvedValue(newPlan);

    // Only ONE prior NEEDS_HUMAN_CLARIFICATION event -- well under MAX_CLARIFICATION_ITERATIONS (3).
    eventRepo.findByRunId.mockResolvedValue([
      {
        id: "e1",
        runId: "run-1",
        eventType: RunEvent.NEEDS_HUMAN_CLARIFICATION,
        source: "planner-agent",
        payloadJson: {},
        createdAt: new Date(),
      },
    ]);

    const result = await svc.answerQuestions("run-1", [{ questionId: "q1", answer: "still unsure" }]);

    // Should NOT proceed to plan review, and should NOT fail -- it loops back.
    expect(planReviewerAgent.run).not.toHaveBeenCalled();
    expect(result.state).toBe(RunState.HumanClarificationNeeded);

    // The NEEDS_HUMAN_CLARIFICATION event is recorded with the incremented iteration
    // count and the new blocking questions.
    expect(eventRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: "run-1",
        eventType: RunEvent.NEEDS_HUMAN_CLARIFICATION,
        payloadJson: expect.objectContaining({
          iteration: 2,
          blockingQuestions: [{ id: "q1", question: "Still required?" }],
        }),
      }),
    );
  });
});
