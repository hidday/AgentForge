import { describe, it, expect, vi } from "vitest";
import { OrchestratorService } from "../../src/orchestrator/orchestratorService.js";
import { RunState } from "../../src/domain/runState.js";
import type { Run, Artifact, HumanAnswer } from "../../src/domain/types.js";
import type { Plan } from "../../src/schemas/plan.js";
import type { PlanReview } from "../../src/schemas/planReview.js";
import type { ResearchedAnswers } from "../../src/schemas/researchedAnswers.js";

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
    planVersion: 3,
    summary: "Test plan",
    requirementsTraceability: "",
    assumptions: [],
    openQuestions: [{ id: "q1", question: "Which env?", requiredForExecution: true }],
    risks: [],
    steps: [{ id: "s1", title: "Step 1", description: "Do something" }],
    testPlan: "Run tests",
    confidence: 0.9,
    ...overrides,
  };
}

function makeArtifact(overrides: Partial<Artifact> = {}): Artifact {
  return {
    id: "artifact-1",
    runId: "run-1",
    type: "Plan",
    version: 2,
    payloadJson: {},
    rawText: "{}",
    createdAt: new Date(),
    ...overrides,
  };
}

function minimalDeps() {
  return {
    runRepo: {
      findById: vi.fn().mockResolvedValue(null),
      findActiveByIssueId: vi.fn(),
      findAll: vi.fn(),
      create: vi.fn(),
      findByIssueId: vi.fn(),
      updateState: vi.fn(),
      update: vi.fn(),
    },
    artifactRepo: { create: vi.fn(), findByRunId: vi.fn(), findLatestByType: vi.fn() },
    eventRepo: { create: vi.fn(), findByRunId: vi.fn().mockResolvedValue([]) },
    linearClient: { getIssue: vi.fn(), postComment: vi.fn() },
    githubClient: { getPRDiff: vi.fn() },
    gitService: { setupRunWorktree: vi.fn(), assertBranch: vi.fn(), commitAndPush: vi.fn(), removeWorktree: vi.fn(), resolveMainRepoPath: vi.fn() },
    repoRegistry: { resolveForIssue: vi.fn(), resolveWorkingDirectory: vi.fn(), validateWorkingDirectory: vi.fn(), getRepoByName: vi.fn(), getDefaultRepo: vi.fn() },
    linearSync: { syncState: vi.fn() },
    githubSync: { syncState: vi.fn(), postReviewFindings: vi.fn(), postRemediationResolutions: vi.fn() },
    plannerAgent: { run: vi.fn() },
    planReviewerAgent: { run: vi.fn() },
    planReviserAgent: { run: vi.fn() },
    executorAgent: { run: vi.fn() },
    reviewerAgent: { run: vi.fn() },
    remediationAgent: { run: vi.fn() },
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  };
}

describe("OrchestratorService.requireRun (private, via any public entrypoint)", () => {
  it("throws 'Run not found' when the run does not exist", async () => {
    const deps = minimalDeps();
    const svc = new OrchestratorService(deps as never);

    await expect(svc.approvePlan("missing-run")).rejects.toThrow("Run not found: missing-run");
  });
});

describe("OrchestratorService.rejectPlan -- iterate mode loads full prior context", () => {
  it("injects previousPlan, humanAnswers, researchedAnswers, and planReviewFindings from loadReplanContext", async () => {
    const run = makeRun();
    let currentRun: Run = { ...run };
    const previousPlan = makePlan({ planVersion: 2, openQuestions: [] });
    const newPlan = makePlan({ planVersion: 3, openQuestions: [] });
    const humanAnswers: HumanAnswer[] = [{ questionId: "q1", answer: "prod" }];
    const researchedAnswersPayload: ResearchedAnswers = {
      summary: "researched",
      answers: [{ questionId: "q1", question: "Which env?", answer: "prod", confidence: "high" }],
      completedAt: new Date().toISOString(),
    };
    const planReviewPayload = {
      summary: "Needs polish",
      findings: [{ id: "f1", severity: "nit", title: "Nit", details: "small thing" }],
    };

    const runRepo = {
      findById: vi.fn().mockImplementation(() => Promise.resolve(currentRun)),
      findActiveByIssueId: vi.fn(),
      findAll: vi.fn(),
      create: vi.fn(),
      findByIssueId: vi.fn(),
      updateState: vi.fn().mockImplementation((_id: string, state: RunState) => {
        currentRun = { ...currentRun, state };
        return Promise.resolve({ ...currentRun });
      }),
      update: vi.fn().mockImplementation((_id: string, patch: Partial<Run>) => {
        currentRun = { ...currentRun, ...patch };
        return Promise.resolve({ ...currentRun });
      }),
    };
    const artifactRepo = {
      create: vi.fn().mockResolvedValue({ id: "artifact-new" }),
      findByRunId: vi.fn(),
      findLatestByType: vi.fn().mockImplementation((_runId: string, type: string) => {
        if (type === "Plan") return Promise.resolve(makeArtifact({ type: "Plan", version: 3, payloadJson: newPlan }));
        if (type === "HumanAnswers") {
          return Promise.resolve(makeArtifact({ type: "HumanAnswers", payloadJson: { answers: humanAnswers } }));
        }
        if (type === "ResearchedAnswers") {
          return Promise.resolve(makeArtifact({ type: "ResearchedAnswers", payloadJson: researchedAnswersPayload }));
        }
        if (type === "PlanReview") {
          return Promise.resolve(makeArtifact({ type: "PlanReview", payloadJson: planReviewPayload }));
        }
        return Promise.resolve(null);
      }),
    };
    const linearClient = {
      getIssue: vi.fn().mockResolvedValue({
        id: "LIN-1",
        title: "Test issue",
        description: "Test description",
        branchName: "ai/lin-1",
        labels: [],
        priority: 0,
      }),
      postComment: vi.fn().mockResolvedValue(undefined),
    };
    const plannerAgent = { run: vi.fn().mockResolvedValue(newPlan) };
    const deps = {
      runRepo,
      artifactRepo,
      eventRepo: { create: vi.fn().mockResolvedValue({}), findByRunId: vi.fn().mockResolvedValue([]) },
      linearClient,
      githubClient: { getPRDiff: vi.fn() },
      gitService: {
        setupRunWorktree: vi.fn(),
        assertBranch: vi.fn(),
        commitAndPush: vi.fn(),
        removeWorktree: vi.fn(),
        resolveMainRepoPath: vi.fn().mockReturnValue("/tmp"),
      },
      repoRegistry: {
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
      },
      linearSync: { syncState: vi.fn().mockResolvedValue(undefined) },
      githubSync: { syncState: vi.fn().mockResolvedValue(undefined), postReviewFindings: vi.fn(), postRemediationResolutions: vi.fn() },
      plannerAgent,
      planReviewerAgent: { run: vi.fn().mockResolvedValue({ overallVerdict: "approved", summary: "ok", findings: [] } as PlanReview) },
      planReviserAgent: { run: vi.fn() },
      executorAgent: { run: vi.fn() },
      reviewerAgent: { run: vi.fn() },
      remediationAgent: { run: vi.fn() },
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    };
    const svc = new OrchestratorService(deps as never);

    await svc.rejectPlan("run-1", "please iterate", "api", "iterate");

    expect(plannerAgent.run).toHaveBeenCalledWith(
      expect.anything(),
      "run-1",
      expect.objectContaining({
        previousPlan: expect.objectContaining({ planVersion: 3 }),
        humanAnswers,
        researchedAnswers: researchedAnswersPayload.answers,
        planReviewFindings: planReviewPayload,
      }),
    );
  });
});

describe("OrchestratorService.runManualPlanRevision -- without an operator note", () => {
  it("calls runPlanRevision with undefined options when no note is provided", async () => {
    const run = makeRun({ state: RunState.AwaitingPlanApproval });
    let currentRun: Run = { ...run };
    const plan = makePlan({ openQuestions: [] });
    const runRepo = {
      findById: vi.fn().mockImplementation(() => Promise.resolve(currentRun)),
      findActiveByIssueId: vi.fn(),
      findAll: vi.fn(),
      create: vi.fn(),
      findByIssueId: vi.fn(),
      updateState: vi.fn().mockImplementation((_id: string, state: RunState) => {
        currentRun = { ...currentRun, state };
        return Promise.resolve({ ...currentRun });
      }),
      update: vi.fn().mockImplementation((_id: string, patch: Partial<Run>) => {
        currentRun = { ...currentRun, ...patch };
        return Promise.resolve({ ...currentRun });
      }),
    };
    const artifactRepo = {
      create: vi.fn(),
      findByRunId: vi.fn(),
      findLatestByType: vi.fn().mockResolvedValue(makeArtifact({ type: "Plan", payloadJson: plan })),
    };
    const deps = {
      runRepo,
      artifactRepo,
      eventRepo: { create: vi.fn().mockResolvedValue({}), findByRunId: vi.fn().mockResolvedValue([]) },
      linearClient: {
        getIssue: vi.fn().mockResolvedValue({
          id: "LIN-1",
          title: "t",
          description: "d",
          branchName: "ai/lin-1",
          labels: [],
          priority: 0,
        }),
        postComment: vi.fn().mockResolvedValue(undefined),
      },
      githubClient: { getPRDiff: vi.fn() },
      gitService: {
        setupRunWorktree: vi.fn(),
        assertBranch: vi.fn(),
        commitAndPush: vi.fn(),
        removeWorktree: vi.fn(),
        resolveMainRepoPath: vi.fn().mockReturnValue("/tmp"),
      },
      repoRegistry: {
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
      },
      linearSync: { syncState: vi.fn().mockResolvedValue(undefined) },
      githubSync: { syncState: vi.fn().mockResolvedValue(undefined) },
      plannerAgent: { run: vi.fn() },
      planReviewerAgent: {
        run: vi.fn().mockResolvedValue({
          overallVerdict: "changes_requested",
          summary: "needs work",
          findings: [{ id: "f1", severity: "important", title: "x", details: "y" }],
        } as PlanReview),
      },
      planReviserAgent: { run: vi.fn() },
      executorAgent: { run: vi.fn() },
      reviewerAgent: { run: vi.fn() },
      remediationAgent: { run: vi.fn() },
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    };
    const svc = new OrchestratorService(deps as never);
    const runPlanRevisionSpy = vi.spyOn(svc, "runPlanRevision").mockResolvedValue(makeRun());

    await svc.runManualPlanRevision("run-1");

    expect(runPlanRevisionSpy).toHaveBeenCalledWith("run-1", undefined);
  });
});
