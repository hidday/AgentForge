import { describe, it, expect, vi } from "vitest";
import { OrchestratorService } from "../../src/orchestrator/orchestratorService.js";
import { RunState } from "../../src/domain/runState.js";
import { RunEvent } from "../../src/domain/runEvent.js";
import type { Run, Artifact, RunEventRecord, RejectionContextPayload } from "../../src/domain/types.js";
import type { Plan } from "../../src/schemas/plan.js";
import type { PlanReview } from "../../src/schemas/planReview.js";
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
    state: RunState.Planning,
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

function asArtifact(overrides: { type: string; version: number; payloadJson: unknown }): Artifact {
  return {
    id: `artifact-${overrides.type}-${overrides.version}`,
    runId: "run-1",
    type: overrides.type as Artifact["type"],
    version: overrides.version,
    payloadJson: overrides.payloadJson,
    rawText: JSON.stringify(overrides.payloadJson),
    createdAt: new Date(),
  };
}

interface TestStore {
  run: Run;
  artifacts: Artifact[];
  events: RunEventRecord[];
}

function buildDeps(store: TestStore) {
  const runRepo = {
    findById: vi.fn().mockImplementation(() => Promise.resolve({ ...store.run })),
    findActiveByIssueId: vi.fn(),
    findAll: vi.fn(),
    create: vi.fn(),
    findByIssueId: vi.fn(),
    updateState: vi.fn().mockImplementation((_id: string, newState: RunState) => {
      store.run = { ...store.run, state: newState };
      return Promise.resolve({ ...store.run });
    }),
    update: vi.fn().mockImplementation((_id: string, patch: Partial<Run>) => {
      store.run = { ...store.run, ...patch };
      return Promise.resolve({ ...store.run });
    }),
  };

  const artifactRepo = {
    create: vi.fn().mockImplementation((params: { runId: string; type: string; version: number; payloadJson: unknown }) => {
      const a = asArtifact({ type: params.type, version: params.version, payloadJson: params.payloadJson });
      store.artifacts.push(a);
      return Promise.resolve(a);
    }),
    findByRunId: vi.fn().mockImplementation(() => Promise.resolve([...store.artifacts])),
    findLatestByType: vi.fn().mockImplementation((_runId: string, type: string) => {
      const matching = store.artifacts.filter((a) => a.type === type);
      if (matching.length === 0) return Promise.resolve(null);
      const latest = matching.reduce((best, cur) => (cur.version > best.version ? cur : best));
      return Promise.resolve(latest);
    }),
  };

  const eventRepo = {
    create: vi.fn().mockImplementation((params: { runId: string; eventType: string; source: string; payloadJson?: unknown }) => {
      const evt: RunEventRecord = {
        id: `event-${store.events.length + 1}`,
        runId: params.runId,
        eventType: params.eventType,
        source: params.source,
        payloadJson: params.payloadJson ?? {},
        createdAt: new Date(),
      };
      store.events.push(evt);
      return Promise.resolve(evt);
    }),
    findByRunId: vi.fn().mockImplementation(() => Promise.resolve([...store.events])),
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
      constraints: { requiredChecks: [], maxFilesChanged: 10, maxDiffLines: 500, forbiddenPatterns: [], mustNotTouch: [] },
    }),
    getDefaultRepo: vi.fn(),
  };

  const linearSync = { syncState: vi.fn().mockResolvedValue(undefined) };
  const githubSync = { syncState: vi.fn().mockResolvedValue(undefined), postReviewFindings: vi.fn(), postRemediationResolutions: vi.fn() };

  let nextPlan: Plan = makePlan({ planVersion: 2 });
  const plannerAgent = {
    run: vi.fn().mockImplementation(async () => {
      await artifactRepo.create({
        runId: store.run.id,
        type: "Plan",
        version: nextPlan.planVersion,
        payloadJson: nextPlan,
      });
      return nextPlan;
    }),
    setNextPlan: (plan: Plan) => {
      nextPlan = plan;
    },
  };

  const planReviewerAgent = {
    run: vi.fn().mockImplementation(async () => {
      const review: PlanReview = { reviewId: "prv-1", summary: "ok", findings: [], overallVerdict: "approved" };
      await artifactRepo.create({ runId: store.run.id, type: "PlanReview", version: 1, payloadJson: review });
      return review;
    }),
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
      logger,
      dashboardEmitter,
    },
    runRepo,
    artifactRepo,
    eventRepo,
    plannerAgent,
    planReviewerAgent,
  };
}

describe("OrchestratorService.runPlanning", () => {
  it("calls plannerAgent with only planVersionOverride when no optional prior-context artifacts exist", async () => {
    const store: TestStore = { run: makeRun({ planVersion: 1 }), artifacts: [], events: [] };
    const built = buildDeps(store);
    const svc = new OrchestratorService(built.deps as never);

    await svc.runPlanning("run-1");

    expect(built.plannerAgent.run).toHaveBeenCalledWith(
      expect.anything(),
      "run-1",
      { planVersionOverride: 2 },
    );
  });

  it("injects previousPlan, humanFeedback, humanAnswers, researchedAnswers, and planReviewFindings when all prior artifacts exist", async () => {
    const rejection: RejectionContextPayload = {
      planVersion: 1,
      feedback: "Use library Y instead",
      source: "linear",
      mode: "iterate",
    };
    const store: TestStore = {
      run: makeRun({ planVersion: 1 }),
      artifacts: [
        asArtifact({ type: "RejectionContext", version: 1, payloadJson: rejection }),
        asArtifact({ type: "Plan", version: 1, payloadJson: makePlan({ planVersion: 1 }) }),
        asArtifact({
          type: "HumanAnswers",
          version: 1,
          payloadJson: { answers: [{ questionId: "q1", answer: "yes" }] },
        }),
        asArtifact({
          type: "ResearchedAnswers",
          version: 1,
          payloadJson: {
            summary: "researched",
            answers: [{ questionId: "q2", question: "Q2?", answer: "A2", confidence: "high" }],
            completedAt: new Date().toISOString(),
          },
        }),
        asArtifact({
          type: "PlanReview",
          version: 1,
          payloadJson: {
            reviewId: "prv-0",
            summary: "prior review summary",
            findings: [{ id: "pf1", severity: "important", type: "gap", title: "Gap", details: "explain" }],
            overallVerdict: "changes_requested",
          },
        }),
      ],
      events: [],
    };
    const built = buildDeps(store);
    const svc = new OrchestratorService(built.deps as never);

    await svc.runPlanning("run-1");

    expect(built.plannerAgent.run).toHaveBeenCalledWith(
      expect.anything(),
      "run-1",
      expect.objectContaining({
        planVersionOverride: 2,
        previousPlan: expect.objectContaining({ planVersion: 1 }),
        humanFeedback: { planVersion: 1, feedback: "Use library Y instead" },
        humanAnswers: [{ questionId: "q1", answer: "yes" }],
        researchedAnswers: [expect.objectContaining({ questionId: "q2" })],
        planReviewFindings: {
          summary: "prior review summary",
          findings: [expect.objectContaining({ id: "pf1" })],
        },
      }),
    );
  });

  it("pauses for clarification and does not run plan review when the re-plan has blocking open questions", async () => {
    const store: TestStore = { run: makeRun({ planVersion: 1 }), artifacts: [], events: [] };
    const built = buildDeps(store);
    built.plannerAgent.setNextPlan(
      makePlan({
        planVersion: 2,
        openQuestions: [{ id: "q1", question: "Blocking?", requiredForExecution: true }],
      }),
    );
    const svc = new OrchestratorService(built.deps as never);

    const result = await svc.runPlanning("run-1");

    expect(result.state).toBe(RunState.HumanClarificationNeeded);
    expect(built.planReviewerAgent.run).not.toHaveBeenCalled();
  });

  it("proceeds to plan review when the re-plan has no blocking questions", async () => {
    const store: TestStore = { run: makeRun({ planVersion: 1 }), artifacts: [], events: [] };
    const built = buildDeps(store);
    const svc = new OrchestratorService(built.deps as never);

    const result = await svc.runPlanning("run-1");

    expect(built.planReviewerAgent.run).toHaveBeenCalledTimes(1);
    expect(result.state).toBe(RunState.AwaitingPlanApproval);
    const eventTypes = built.eventRepo.create.mock.calls.map((c: unknown[]) => (c[0] as { eventType: string }).eventType);
    expect(eventTypes).toContain(RunEvent.PLAN_CREATED);
    expect(eventTypes).toContain(RunEvent.PLAN_REVIEW_APPROVED);
  });

  it("persists the TaskBundle artifact only once (idempotent across calls)", async () => {
    const store: TestStore = { run: makeRun({ planVersion: 1 }), artifacts: [], events: [] };
    const built = buildDeps(store);
    const svc = new OrchestratorService(built.deps as never);

    await svc.runPlanning("run-1");

    const taskBundleArtifacts = store.artifacts.filter((a) => a.type === "TaskBundle");
    expect(taskBundleArtifacts).toHaveLength(1);
  });
});
