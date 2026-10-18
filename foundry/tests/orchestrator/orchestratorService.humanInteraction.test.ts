import { describe, it, expect, vi } from "vitest";
import { OrchestratorService } from "../../src/orchestrator/orchestratorService.js";
import { RunState } from "../../src/domain/runState.js";
import { RunEvent } from "../../src/domain/runEvent.js";
import type { Run } from "../../src/domain/types.js";
import type { Plan } from "../../src/schemas/plan.js";
import { PolicyError, ValidationError } from "../../src/utils/errors.js";

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
    workingDirectory: "/tmp/worktree",
    latestArtifactVersion: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makePlan(overrides: Partial<Plan> = {}): Plan {
  return {
    planVersion: 1,
    summary: "Add the thing",
    requirementsTraceability: "",
    assumptions: [],
    openQuestions: [
      { id: "q1", question: "Which env?", requiredForExecution: true },
      { id: "q2", question: "Nice to know?", requiredForExecution: false },
    ],
    risks: [],
    steps: [{ id: "s1", title: "Do it", description: "Do the thing" }],
    testPlan: "Run the tests",
    confidence: 0.9,
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
  const artifactRepo = { create: vi.fn().mockResolvedValue({ id: "artifact-new" }), findByRunId: vi.fn(), findLatestByType: vi.fn() };
  const eventRepo = { create: vi.fn().mockResolvedValue({}), findByRunId: vi.fn().mockResolvedValue([]) };
  const linearClient = {
    getIssue: vi.fn().mockResolvedValue({
      id: "LIN-1",
      title: "Add the thing",
      description: "desc",
      branchName: "ai/lin-1",
      labels: [],
      priority: 1,
      project: "proj",
    }),
    postComment: vi.fn().mockResolvedValue(undefined),
    getRelatedContext: vi.fn().mockResolvedValue({ blockers: [] }),
  };
  const githubClient = { getPRDiff: vi.fn(), getDefaultBranch: vi.fn().mockResolvedValue("main") };
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
        maxFilesChanged: 100,
        maxDiffLines: 5000,
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
    resolveMainRepoPath: vi.fn().mockReturnValue("/tmp/worktree"),
  };
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  const dashboardEmitter = {
    emitStateChanged: vi.fn(),
    emitArtifactCreated: vi.fn(),
    emitRunCreated: vi.fn(),
    emitQuestionsAnswered: vi.fn(),
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
    dashboardEmitter,
  };
}

describe("OrchestratorService.answerQuestions", () => {
  it("rejects when the run is in a state that cannot accept answers", async () => {
    const deps = buildDeps();
    deps.runRepo.findById.mockResolvedValue(makeRun({ state: RunState.Implementing }));
    const svc = new OrchestratorService(deps as never);

    await expect(svc.answerQuestions("run-1", [])).rejects.toThrow(PolicyError);
  });

  it("rejects an answer referencing an unknown questionId", async () => {
    const deps = buildDeps();
    deps.runRepo.findById.mockResolvedValue(makeRun({ state: RunState.AwaitingPlanApproval }));
    deps.artifactRepo.findLatestByType.mockImplementation((_id: string, type: string) =>
      type === "Plan" ? Promise.resolve({ payloadJson: makePlan() }) : Promise.resolve(null),
    );
    const svc = new OrchestratorService(deps as never);

    await expect(
      svc.answerQuestions("run-1", [{ questionId: "bogus", answer: "x" }]),
    ).rejects.toThrow(ValidationError);
  });

  it("throws when there is no plan artifact to validate against", async () => {
    const deps = buildDeps();
    deps.runRepo.findById.mockResolvedValue(makeRun({ state: RunState.AwaitingPlanApproval }));
    deps.artifactRepo.findLatestByType.mockResolvedValue(null);
    const svc = new OrchestratorService(deps as never);

    await expect(svc.answerQuestions("run-1", [])).rejects.toThrow(/No plan artifact found/);
  });

  it("AwaitingPlanApproval: persists the answers but does not re-plan", async () => {
    const deps = buildDeps();
    const run = makeRun({ state: RunState.AwaitingPlanApproval });
    deps.runRepo.findById.mockResolvedValue(run);
    deps.artifactRepo.findLatestByType.mockImplementation((_id: string, type: string) =>
      type === "Plan" ? Promise.resolve({ payloadJson: makePlan() }) : Promise.resolve(null),
    );
    const svc = new OrchestratorService(deps as never);

    const result = await svc.answerQuestions("run-1", [{ questionId: "q2", answer: "sure" }]);

    expect(deps.artifactRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ runId: "run-1", type: "HumanAnswers" }),
    );
    expect(deps.dashboardEmitter.emitQuestionsAnswered).toHaveBeenCalledWith("run-1", 1);
    expect(deps.plannerAgent.run).not.toHaveBeenCalled();
    expect(result.state).toBe(RunState.AwaitingPlanApproval);
  });

  it("HumanClarificationNeeded: rejects when required questions are left unanswered", async () => {
    const deps = buildDeps();
    deps.runRepo.findById.mockResolvedValue(makeRun({ state: RunState.HumanClarificationNeeded }));
    deps.artifactRepo.findLatestByType.mockImplementation((_id: string, type: string) =>
      type === "Plan" ? Promise.resolve({ payloadJson: makePlan() }) : Promise.resolve(null),
    );
    const svc = new OrchestratorService(deps as never);

    await expect(
      svc.answerQuestions("run-1", [{ questionId: "q2", answer: "sure" }]),
    ).rejects.toThrow(/Missing answers for required questions/);
  });

  it("HumanClarificationNeeded: re-plans and proceeds to plan review once blockers are resolved", async () => {
    const deps = buildDeps();
    deps.runRepo.findById.mockResolvedValue(makeRun({ state: RunState.HumanClarificationNeeded }));
    deps.artifactRepo.findLatestByType.mockImplementation((_id: string, type: string) => {
      if (type === "Plan") return Promise.resolve({ payloadJson: makePlan() });
      if (type === "TaskBundle")
        return Promise.resolve({
          payloadJson: {
            issue: { id: "LIN-1", title: "t", description: "d", labels: [], priority: 1 },
            repo: {
              name: "test-repo",
              defaultBranch: "main",
              workingBranch: "ai/run-1",
              repoPath: "/tmp/worktree",
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
    const newPlan = makePlan({ planVersion: 2, openQuestions: [] });
    deps.plannerAgent.run.mockResolvedValue(newPlan);
    deps.runRepo.update.mockResolvedValue(makeRun({ state: RunState.Planning, planVersion: 2 }));
    deps.runRepo.updateState
      .mockResolvedValueOnce(makeRun({ state: RunState.Planning }))
      .mockResolvedValueOnce(makeRun({ state: RunState.PlanReview, planVersion: 2 }));

    const svc = new OrchestratorService(deps as never);
    const runPlanReviewSpy = vi
      .spyOn(svc, "runPlanReview")
      .mockResolvedValue(makeRun({ state: RunState.AwaitingPlanApproval }));

    await svc.answerQuestions("run-1", [
      { questionId: "q1", answer: "prod" },
      { questionId: "q2", answer: "sure" },
    ]);

    expect(deps.plannerAgent.run).toHaveBeenCalledWith(
      expect.anything(),
      "run-1",
      expect.objectContaining({ planVersionOverride: 2 }),
    );
    expect(runPlanReviewSpy).toHaveBeenCalledWith("run-1");
  });

  it("HumanClarificationNeeded: fails the run once clarification iterations are exhausted", async () => {
    const deps = buildDeps();
    deps.runRepo.findById.mockResolvedValue(makeRun({ state: RunState.HumanClarificationNeeded }));
    deps.artifactRepo.findLatestByType.mockImplementation((_id: string, type: string) => {
      if (type === "Plan") return Promise.resolve({ payloadJson: makePlan() });
      if (type === "TaskBundle")
        return Promise.resolve({
          payloadJson: {
            issue: { id: "LIN-1", title: "t", description: "d", labels: [], priority: 1 },
            repo: {
              name: "test-repo",
              defaultBranch: "main",
              workingBranch: "ai/run-1",
              repoPath: "/tmp/worktree",
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
    const stillBlockedPlan = makePlan({ planVersion: 2 });
    deps.plannerAgent.run.mockResolvedValue(stillBlockedPlan);
    deps.runRepo.update.mockResolvedValue(makeRun({ state: RunState.Planning, planVersion: 2 }));
    deps.eventRepo.findByRunId.mockResolvedValue([
      { eventType: RunEvent.NEEDS_HUMAN_CLARIFICATION as string },
      { eventType: RunEvent.NEEDS_HUMAN_CLARIFICATION as string },
      { eventType: RunEvent.NEEDS_HUMAN_CLARIFICATION as string },
    ]);
    deps.runRepo.updateState
      .mockResolvedValueOnce(makeRun({ state: RunState.Planning }))
      .mockResolvedValueOnce(makeRun({ state: RunState.PlanReview }))
      .mockResolvedValueOnce(makeRun({ state: RunState.Failed }));

    const svc = new OrchestratorService(deps as never);
    const result = await svc.answerQuestions("run-1", [
      { questionId: "q1", answer: "prod" },
      { questionId: "q2", answer: "sure" },
    ]);

    expect(deps.logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ clarificationCount: 3 }),
      "Clarification exhausted — run failed",
    );
    expect(result.state).toBe(RunState.Failed);
  });

  it("HumanClarificationNeeded: loops back to clarification when still blocked but under the iteration cap", async () => {
    const deps = buildDeps();
    deps.runRepo.findById.mockResolvedValue(makeRun({ state: RunState.HumanClarificationNeeded }));
    deps.artifactRepo.findLatestByType.mockImplementation((_id: string, type: string) => {
      if (type === "Plan") return Promise.resolve({ payloadJson: makePlan() });
      if (type === "TaskBundle")
        return Promise.resolve({
          payloadJson: {
            issue: { id: "LIN-1", title: "t", description: "d", labels: [], priority: 1 },
            repo: {
              name: "test-repo",
              defaultBranch: "main",
              workingBranch: "ai/run-1",
              repoPath: "/tmp/worktree",
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
    const stillBlockedPlan = makePlan({ planVersion: 2 });
    deps.plannerAgent.run.mockResolvedValue(stillBlockedPlan);
    deps.runRepo.update.mockResolvedValue(makeRun({ state: RunState.Planning, planVersion: 2 }));
    deps.eventRepo.findByRunId.mockResolvedValue([
      { eventType: RunEvent.NEEDS_HUMAN_CLARIFICATION as string },
    ]);
    deps.runRepo.updateState
      .mockResolvedValueOnce(makeRun({ state: RunState.Planning }))
      .mockResolvedValueOnce(makeRun({ state: RunState.PlanReview }))
      .mockResolvedValueOnce(makeRun({ state: RunState.HumanClarificationNeeded }));

    const svc = new OrchestratorService(deps as never);
    const result = await svc.answerQuestions("run-1", [
      { questionId: "q1", answer: "prod" },
      { questionId: "q2", answer: "sure" },
    ]);

    expect(result.state).toBe(RunState.HumanClarificationNeeded);
  });
});

describe("OrchestratorService.runManualReReview", () => {
  it("transitions back to AwaitingPlanApproval when the reviewer approves", async () => {
    const deps = buildDeps();
    deps.runRepo.findById.mockResolvedValue(makeRun({ state: RunState.AwaitingPlanApproval }));
    deps.artifactRepo.findLatestByType.mockImplementation((_id: string, type: string) =>
      type === "Plan" ? Promise.resolve({ payloadJson: makePlan({ openQuestions: [] }) }) : Promise.resolve(null),
    );
    deps.planReviewerAgent.run.mockResolvedValue({
      reviewId: "rev-1",
      overallVerdict: "approved",
      summary: "ok",
      findings: [],
    });
    deps.runRepo.updateState
      .mockResolvedValueOnce(makeRun({ state: RunState.PlanReview }))
      .mockResolvedValueOnce(makeRun({ state: RunState.AwaitingPlanApproval }));

    const svc = new OrchestratorService(deps as never);
    const result = await svc.runManualReReview("run-1", { note: "double check" });

    expect(deps.planReviewerAgent.run).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      "run-1",
      { operatorNote: "double check" },
    );
    expect(result.state).toBe(RunState.AwaitingPlanApproval);
  });

  it("still returns to AwaitingPlanApproval (not PlanRevision) when changes are requested", async () => {
    const deps = buildDeps();
    deps.runRepo.findById.mockResolvedValue(makeRun({ state: RunState.AwaitingPlanApproval }));
    deps.artifactRepo.findLatestByType.mockImplementation((_id: string, type: string) =>
      type === "Plan" ? Promise.resolve({ payloadJson: makePlan({ openQuestions: [] }) }) : Promise.resolve(null),
    );
    deps.planReviewerAgent.run.mockResolvedValue({
      reviewId: "rev-1",
      overallVerdict: "changes_requested",
      summary: "needs work",
      findings: [],
    });
    deps.runRepo.updateState
      .mockResolvedValueOnce(makeRun({ state: RunState.PlanReview }))
      .mockResolvedValueOnce(makeRun({ state: RunState.AwaitingPlanApproval }));

    const svc = new OrchestratorService(deps as never);
    const result = await svc.runManualReReview("run-1");

    expect(result.state).toBe(RunState.AwaitingPlanApproval);
  });

  it("throws when there is no plan artifact", async () => {
    const deps = buildDeps();
    deps.runRepo.findById.mockResolvedValue(makeRun({ state: RunState.AwaitingPlanApproval }));
    deps.artifactRepo.findLatestByType.mockResolvedValue(null);
    deps.runRepo.updateState.mockResolvedValue(makeRun({ state: RunState.PlanReview }));
    const svc = new OrchestratorService(deps as never);

    await expect(svc.runManualReReview("run-1")).rejects.toThrow(/No plan artifact found/);
  });
});

describe("OrchestratorService.runManualPlanRevision", () => {
  it("approved: no revision needed, stays at AwaitingPlanApproval", async () => {
    const deps = buildDeps();
    deps.runRepo.findById.mockResolvedValue(makeRun({ state: RunState.AwaitingPlanApproval }));
    deps.artifactRepo.findLatestByType.mockImplementation((_id: string, type: string) =>
      type === "Plan" ? Promise.resolve({ payloadJson: makePlan({ openQuestions: [] }) }) : Promise.resolve(null),
    );
    deps.planReviewerAgent.run.mockResolvedValue({
      reviewId: "rev-1",
      overallVerdict: "approved",
      summary: "ok",
      findings: [],
    });
    deps.runRepo.updateState
      .mockResolvedValueOnce(makeRun({ state: RunState.PlanReview }))
      .mockResolvedValueOnce(makeRun({ state: RunState.AwaitingPlanApproval }));

    const svc = new OrchestratorService(deps as never);
    const runPlanRevisionSpy = vi.spyOn(svc, "runPlanRevision");

    const result = await svc.runManualPlanRevision("run-1");

    expect(runPlanRevisionSpy).not.toHaveBeenCalled();
    expect(result.state).toBe(RunState.AwaitingPlanApproval);
  });

  it("changes_requested: delegates to runPlanRevision with the operator note", async () => {
    const deps = buildDeps();
    deps.runRepo.findById.mockResolvedValue(makeRun({ state: RunState.AwaitingPlanApproval }));
    deps.artifactRepo.findLatestByType.mockImplementation((_id: string, type: string) =>
      type === "Plan" ? Promise.resolve({ payloadJson: makePlan({ openQuestions: [] }) }) : Promise.resolve(null),
    );
    deps.planReviewerAgent.run.mockResolvedValue({
      reviewId: "rev-1",
      overallVerdict: "changes_requested",
      summary: "needs work",
      findings: [{ id: "f1", severity: "important", type: "x", title: "t", details: "d" }],
    });
    deps.runRepo.updateState.mockResolvedValue(makeRun({ state: RunState.PlanReview }));

    const svc = new OrchestratorService(deps as never);
    const runPlanRevisionSpy = vi
      .spyOn(svc, "runPlanRevision")
      .mockResolvedValue(makeRun({ state: RunState.AwaitingPlanApproval }));

    await svc.runManualPlanRevision("run-1", { note: "tighten scope" });

    expect(runPlanRevisionSpy).toHaveBeenCalledWith("run-1", { note: "tighten scope" });
  });
});

describe("OrchestratorService.approveHumanReview", () => {
  it("runs distillation, transitions to Done, and posts the completion comment", async () => {
    const deps = buildDeps();
    const run = makeRun({ state: RunState.ReadyForHumanReview });
    deps.runRepo.findById.mockResolvedValue(run);
    deps.runRepo.updateState.mockResolvedValue(makeRun({ state: RunState.Done }));
    const distillationAgent = { run: vi.fn().mockResolvedValue(undefined) };

    const svc = new OrchestratorService({ ...deps, distillationAgent } as never);
    const result = await svc.approveHumanReview("run-1");

    expect(distillationAgent.run).toHaveBeenCalledWith("run-1", run);
    expect(deps.linearClient.postComment).toHaveBeenCalledWith(
      "LIN-1",
      expect.stringContaining("Done"),
    );
    expect(result.state).toBe(RunState.Done);
  });

  it("swallows a distillation failure and still completes the run", async () => {
    const deps = buildDeps();
    deps.runRepo.findById.mockResolvedValue(makeRun({ state: RunState.ReadyForHumanReview }));
    deps.runRepo.updateState.mockResolvedValue(makeRun({ state: RunState.Done }));
    const distillationAgent = { run: vi.fn().mockRejectedValue(new Error("distill boom")) };

    const svc = new OrchestratorService({ ...deps, distillationAgent } as never);
    const result = await svc.approveHumanReview("run-1");

    expect(deps.logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ runId: "run-1", error: "distill boom" }),
      "Distillation agent failed (best-effort, ignoring)",
    );
    expect(result.state).toBe(RunState.Done);
  });

  it("works without a distillation agent configured", async () => {
    const deps = buildDeps();
    deps.runRepo.findById.mockResolvedValue(makeRun({ state: RunState.ReadyForHumanReview }));
    deps.runRepo.updateState.mockResolvedValue(makeRun({ state: RunState.Done }));

    const svc = new OrchestratorService(deps as never);
    const result = await svc.approveHumanReview("run-1");

    expect(result.state).toBe(RunState.Done);
  });
});
