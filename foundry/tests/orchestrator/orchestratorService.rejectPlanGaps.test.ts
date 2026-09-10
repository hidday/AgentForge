import { describe, it, expect, vi } from "vitest";
import { OrchestratorService } from "../../src/orchestrator/orchestratorService.js";
import { RunState } from "../../src/domain/runState.js";
import { RunEvent } from "../../src/domain/runEvent.js";
import type { Run, Artifact, RejectionContextPayload, HumanAnswer } from "../../src/domain/types.js";
import type { Plan } from "../../src/schemas/plan.js";
import type { TaskBundle } from "../../src/schemas/taskBundle.js";
import type { ResearchedAnswers } from "../../src/schemas/researchedAnswers.js";

// This file covers gaps left by tests/orchestrator/orchestratorService.rejectPlan.test.ts
// (confirmed via coverage-final.json branch/statement analysis before writing these):
//  - "fresh" rejection mode (loadReplanContext is skipped entirely)
//  - the "iterate" mode branch with a FULL prior context (previousPlan, HumanAnswers,
//    ResearchedAnswers, PlanReview findings all present) -- exercises loadReplanContext's
//    optional-chaining branches and the corresponding spreads in rejectPlan's re-plan call
//  - the "iterate" mode branch with NO prior Plan artifact (previousPlan stays undefined)
//  - the post-rejection re-plan producing blocking questions again (pauses for
//    clarification instead of proceeding to plan review)
//  - maybeResearchAndReplan's "HumanAnswers artifact already exists" branch, reached via
//    rejectPlan's own re-plan cycle

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
    state: RunState.AwaitingPlanApproval,
    planVersion: 2,
    approvedPlanVersion: null,
    plannerRuntime: null,
    executorRuntime: null,
    reviewerRuntime: null,
    remediationRuntime: null,
    workingDirectory: "/tmp",
    latestArtifactVersion: 2,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makePlan(overrides: Partial<Plan> = {}): Plan {
  return {
    planVersion: 2,
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
      title: "Test issue",
      description: "Test description",
      branchName: "hidday/lin-1-test-issue",
      labels: [],
      priority: 0,
      project: "test-project",
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
    run: vi.fn().mockResolvedValue({ overallVerdict: "approved", summary: "Looks good", findings: [] }),
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
    linearClient,
    plannerAgent,
    planReviewerAgent,
    answerResearcherAgent,
  };
}

describe("OrchestratorService.rejectPlan -- gaps not covered by orchestratorService.rejectPlan.test.ts", () => {
  describe("fresh mode", () => {
    it("skips loadReplanContext entirely: no previousPlan/humanAnswers/researchedAnswers/planReviewFindings are injected, and the comment says '(fresh)'", async () => {
      const { deps, runRepo, artifactRepo, linearClient, plannerAgent } = buildDeps();
      const svc = new OrchestratorService(deps as never);

      const initialRun = makeRun({ state: RunState.AwaitingPlanApproval, planVersion: 2 });
      const planningRun = makeRun({ state: RunState.Planning, planVersion: 2 });
      const planReviewRun = makeRun({ state: RunState.PlanReview, planVersion: 3 });
      const awaitingApprovalRun = makeRun({ state: RunState.AwaitingPlanApproval, planVersion: 3 });

      runRepo.findById.mockResolvedValueOnce(initialRun).mockResolvedValue(planReviewRun);
      runRepo.updateState
        .mockResolvedValueOnce(planningRun)
        .mockResolvedValueOnce(planReviewRun)
        .mockResolvedValueOnce(awaitingApprovalRun);
      runRepo.update.mockResolvedValue({ ...planningRun, planVersion: 3 });

      // Even though a Plan / HumanAnswers / ResearchedAnswers / PlanReview artifact
      // exists, "fresh" mode must NOT read them via loadReplanContext.
      const newPlan = makePlan({ planVersion: 3, openQuestions: [] });
      artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
        if (type === "Plan") {
          return Promise.resolve(asArtifact({ type: "Plan", version: 3, payloadJson: newPlan }));
        }
        if (type === "HumanAnswers") {
          return Promise.resolve(
            asArtifact({
              type: "HumanAnswers",
              version: 1,
              payloadJson: { answers: [{ questionId: "q1", answer: "yes" }] },
            }),
          );
        }
        return Promise.resolve(null);
      });

      plannerAgent.run.mockResolvedValue(newPlan);

      await svc.rejectPlan("run-1", undefined, "api", "fresh");

      // No previousPlan/humanFeedback/humanAnswers/researchedAnswers/planReviewFindings
      // should be passed on the initial re-plan call in fresh mode.
      expect(plannerAgent.run).toHaveBeenCalledWith(
        expect.anything(),
        "run-1",
        expect.not.objectContaining({
          previousPlan: expect.anything(),
          humanAnswers: expect.anything(),
          researchedAnswers: expect.anything(),
          planReviewFindings: expect.anything(),
        }),
      );

      const comment = (linearClient.postComment as ReturnType<typeof vi.fn>).mock.calls.find(
        (c: unknown[]) => typeof c[1] === "string" && (c[1] as string).includes("Plan rejected"),
      );
      expect(comment![1]).toBe("Plan rejected (fresh). Replanning...");
    });
  });

  describe("iterate mode with full prior context", () => {
    it("injects previousPlan, humanAnswers, researchedAnswers and planReviewFindings from loadReplanContext into the re-plan call", async () => {
      const { deps, runRepo, artifactRepo, plannerAgent } = buildDeps();
      const svc = new OrchestratorService(deps as never);

      const initialRun = makeRun({ state: RunState.AwaitingPlanApproval, planVersion: 2 });
      const planningRun = makeRun({ state: RunState.Planning, planVersion: 2 });
      const planReviewRun = makeRun({ state: RunState.PlanReview, planVersion: 3 });
      const awaitingApprovalRun = makeRun({ state: RunState.AwaitingPlanApproval, planVersion: 3 });

      runRepo.findById.mockResolvedValueOnce(initialRun).mockResolvedValue(planReviewRun);
      runRepo.updateState
        .mockResolvedValueOnce(planningRun)
        .mockResolvedValueOnce(planReviewRun)
        .mockResolvedValueOnce(awaitingApprovalRun);
      runRepo.update.mockResolvedValue({ ...planningRun, planVersion: 3 });

      const priorPlan = makePlan({ planVersion: 2 });
      const newPlan = makePlan({ planVersion: 3, openQuestions: [] });
      const humanAnswers: HumanAnswer[] = [{ questionId: "q1", answer: "Use OAuth2" }];
      const researchedAnswers: ResearchedAnswers = {
        summary: "researched",
        answers: [
          { questionId: "q2", question: "Which region?", answer: "us-east-1", confidence: "high" },
        ],
        completedAt: "2026-01-01T00:00:00Z",
      };
      const planReviewFindings = {
        summary: "Some concerns",
        findings: [
          { id: "f1", severity: "important", title: "Concern", details: "details here" },
        ],
      };

      artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
        if (type === "Plan") return Promise.resolve(asArtifact({ type: "Plan", version: 2, payloadJson: priorPlan }));
        if (type === "HumanAnswers") {
          return Promise.resolve(
            asArtifact({ type: "HumanAnswers", version: 1, payloadJson: { answers: humanAnswers } }),
          );
        }
        if (type === "ResearchedAnswers") {
          return Promise.resolve(
            asArtifact({ type: "ResearchedAnswers", version: 1, payloadJson: researchedAnswers }),
          );
        }
        if (type === "PlanReview") {
          return Promise.resolve(
            asArtifact({ type: "PlanReview", version: 1, payloadJson: planReviewFindings }),
          );
        }
        return Promise.resolve(null);
      });

      plannerAgent.run.mockResolvedValue(newPlan);

      await svc.rejectPlan("run-1", "please reconsider", "api", "iterate");

      expect(plannerAgent.run).toHaveBeenCalledWith(
        expect.anything(),
        "run-1",
        expect.objectContaining({
          previousPlan: priorPlan,
          humanAnswers,
          researchedAnswers: researchedAnswers.answers,
          planReviewFindings,
        }),
      );
    });
  });

  describe("iterate mode with no prior Plan artifact", () => {
    it("does NOT include previousPlan on the re-plan call when no Plan artifact exists", async () => {
      const { deps, runRepo, artifactRepo, plannerAgent } = buildDeps();
      const svc = new OrchestratorService(deps as never);

      const initialRun = makeRun({ state: RunState.AwaitingPlanApproval, planVersion: 2 });
      const planningRun = makeRun({ state: RunState.Planning, planVersion: 2 });
      const planReviewRun = makeRun({ state: RunState.PlanReview, planVersion: 3 });
      const awaitingApprovalRun = makeRun({ state: RunState.AwaitingPlanApproval, planVersion: 3 });

      runRepo.findById.mockResolvedValueOnce(initialRun).mockResolvedValue(planReviewRun);
      runRepo.updateState
        .mockResolvedValueOnce(planningRun)
        .mockResolvedValueOnce(planReviewRun)
        .mockResolvedValueOnce(awaitingApprovalRun);
      runRepo.update.mockResolvedValue({ ...planningRun, planVersion: 3 });

      const newPlan = makePlan({ planVersion: 3, openQuestions: [] });
      // No Plan artifact exists yet when loadReplanContext makes its first "Plan"
      // lookup (the very first rejection cycle). Once the planner produces the new
      // plan, runPlanReview's later lookup needs to find IT as the latest artifact.
      let planLookups = 0;
      artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
        if (type === "Plan") {
          planLookups += 1;
          if (planLookups === 1) return Promise.resolve(null);
          return Promise.resolve(asArtifact({ type: "Plan", version: 3, payloadJson: newPlan }));
        }
        return Promise.resolve(null);
      });
      plannerAgent.run.mockResolvedValue(newPlan);

      await svc.rejectPlan("run-1", undefined, "api", "iterate");

      expect(plannerAgent.run).toHaveBeenCalledWith(
        expect.anything(),
        "run-1",
        expect.not.objectContaining({ previousPlan: expect.anything() }),
      );
    });
  });

  describe("blocking questions after rejection re-plan", () => {
    it("pauses for human clarification instead of proceeding to plan review", async () => {
      // No answerResearcherAgent here: this test isolates the "still blocking after
      // re-plan" branch from maybeResearchAndReplan's own behaviour (covered separately
      // below), so the researcher must be a no-op via the missing-dependency guard.
      const { deps, runRepo, artifactRepo, plannerAgent, planReviewerAgent } = buildDeps({
        answerResearcherAgent: undefined,
      });
      const svc = new OrchestratorService(deps as never);

      const initialRun = makeRun({ state: RunState.AwaitingPlanApproval, planVersion: 2 });
      const planningRun = makeRun({ state: RunState.Planning, planVersion: 2 });
      const clarificationRun = makeRun({
        state: RunState.HumanClarificationNeeded,
        planVersion: 3,
      });

      runRepo.findById.mockResolvedValue(initialRun);
      runRepo.updateState
        .mockResolvedValueOnce(planningRun) // PLAN_REJECTED
        .mockResolvedValueOnce(planningRun) // PLAN_CREATED
        .mockResolvedValueOnce(clarificationRun); // NEEDS_HUMAN_CLARIFICATION
      runRepo.update.mockResolvedValue({ ...planningRun, planVersion: 3 });

      artifactRepo.findLatestByType.mockResolvedValue(null);

      const newPlanWithBlocker = makePlan({
        planVersion: 3,
        openQuestions: [{ id: "q1", question: "Which auth provider?", requiredForExecution: true }],
      });
      plannerAgent.run.mockResolvedValue(newPlanWithBlocker);

      const result = await svc.rejectPlan("run-1", "needs more detail");

      expect(result.state).toBe(RunState.HumanClarificationNeeded);
      // Should not have proceeded to plan review.
      expect(planReviewerAgent.run).not.toHaveBeenCalled();
    });
  });

  describe("maybeResearchAndReplan reached via rejectPlan", () => {
    it("includes prior HumanAnswers when researching and re-planning after rejection", async () => {
      const { deps, runRepo, artifactRepo, plannerAgent, answerResearcherAgent } = buildDeps();
      const svc = new OrchestratorService(deps as never);

      const initialRun = makeRun({ state: RunState.AwaitingPlanApproval, planVersion: 2 });
      const planningRun = makeRun({ state: RunState.Planning, planVersion: 2 });
      const planningRunV2 = makeRun({ state: RunState.Planning, planVersion: 3 });
      const planReviewRun = makeRun({ state: RunState.PlanReview, planVersion: 4 });
      const awaitingApprovalRun = makeRun({ state: RunState.AwaitingPlanApproval, planVersion: 4 });

      runRepo.findById.mockResolvedValueOnce(initialRun).mockResolvedValue(planReviewRun);
      runRepo.updateState
        .mockResolvedValueOnce(planningRun) // PLAN_REJECTED
        .mockResolvedValueOnce(planReviewRun) // PLAN_CREATED
        .mockResolvedValueOnce(awaitingApprovalRun); // PLAN_REVIEW_APPROVED
      runRepo.update
        .mockResolvedValueOnce({ ...planningRun, planVersion: 3 })
        .mockResolvedValueOnce({ ...planningRunV2, planVersion: 4 });

      const humanAnswers: HumanAnswer[] = [{ questionId: "q1", answer: "Use OAuth2" }];
      const planWithNonBlockingQuestion = makePlan({
        planVersion: 3,
        openQuestions: [{ id: "q2", question: "Optional detail?", requiredForExecution: false }],
      });
      const revisedPlanCleared = makePlan({ planVersion: 4, openQuestions: [] });

      artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
        if (type === "HumanAnswers") {
          return Promise.resolve(
            asArtifact({ type: "HumanAnswers", version: 1, payloadJson: { answers: humanAnswers } }),
          );
        }
        if (type === "ResearchedAnswers") return Promise.resolve(null);
        if (type === "Plan") {
          return Promise.resolve(
            asArtifact({ type: "Plan", version: 4, payloadJson: revisedPlanCleared }),
          );
        }
        return Promise.resolve(null);
      });

      plannerAgent.run
        .mockResolvedValueOnce(planWithNonBlockingQuestion)
        .mockResolvedValueOnce(revisedPlanCleared);

      answerResearcherAgent.run.mockResolvedValue({
        summary: "Resolved",
        answers: [
          { questionId: "q2", question: "Optional detail?", answer: "Yes", confidence: "high", sources: [] },
        ],
        completedAt: "2026-01-01T00:00:00Z",
      });

      await svc.rejectPlan("run-1", undefined, "api", "fresh");

      expect(answerResearcherAgent.run).toHaveBeenCalledWith(
        planWithNonBlockingQuestion,
        expect.anything(),
        "run-1",
        expect.objectContaining({ humanAnswers }),
      );
      // The follow-up planner call (inside maybeResearchAndReplan) also carries humanAnswers.
      expect(plannerAgent.run).toHaveBeenNthCalledWith(
        2,
        expect.anything(),
        "run-1",
        expect.objectContaining({ humanAnswers, researchedAnswers: expect.any(Array) }),
      );
    });
  });
});
