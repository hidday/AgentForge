import { describe, it, expect, vi } from "vitest";
import { OrchestratorService } from "../../src/orchestrator/orchestratorService.js";
import { RunState } from "../../src/domain/runState.js";
import { RunEvent } from "../../src/domain/runEvent.js";
import type { Run, Artifact, RunEventRecord } from "../../src/domain/types.js";
import type { Plan } from "../../src/schemas/plan.js";
import type { ExecutionReport } from "../../src/schemas/executionReport.js";
import type { Review } from "../../src/schemas/review.js";
import type { PlanReview } from "../../src/schemas/planReview.js";

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
    state: RunState.AwaitingPlanApproval,
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

function makeExecutionReport(overrides: Partial<ExecutionReport> = {}): ExecutionReport {
  return {
    executionVersion: 1,
    summary: "Implemented.",
    filesChanged: ["src/foo.ts"],
    checks: {
      lint: { status: "pass", details: "ok" },
      typecheck: { status: "pass", details: "ok" },
      tests: { status: "pass", details: "ok" },
    },
    notes: [],
    prDraftCreated: true,
    score: 0.9,
    scoreRationale: "Solid.",
    ...overrides,
  };
}

function makeReview(overrides: Partial<Review> = {}): Review {
  return {
    reviewId: "rev-1",
    summary: "Looks good",
    findings: [],
    overallVerdict: "approved",
    ...overrides,
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
  runState: RunState;
  artifacts: Artifact[];
  runPatch: Partial<Run>;
  events: RunEventRecord[];
}

function buildDeps(store: TestStore, initialRun: Run, overrides: Record<string, unknown> = {}) {
  const runRepo = {
    findById: vi
      .fn()
      .mockImplementation(() =>
        Promise.resolve({ ...initialRun, ...store.runPatch, state: store.runState }),
      ),
    findActiveByIssueId: vi.fn(),
    findAll: vi.fn(),
    create: vi.fn(),
    findByIssueId: vi.fn(),
    updateState: vi.fn().mockImplementation((_id: string, newState: RunState) => {
      store.runState = newState;
      return Promise.resolve({ ...initialRun, ...store.runPatch, state: newState });
    }),
    update: vi.fn().mockImplementation((_id: string, patch: Partial<Run>) => {
      store.runPatch = { ...store.runPatch, ...patch };
      return Promise.resolve({ ...initialRun, ...store.runPatch, state: store.runState });
    }),
  };

  const artifactRepo = {
    create: vi.fn().mockImplementation((params: {
      runId: string;
      type: string;
      version: number;
      payloadJson: unknown;
    }) => {
      const a = asArtifact({ type: params.type, version: params.version, payloadJson: params.payloadJson });
      store.artifacts.push(a);
      return Promise.resolve(a);
    }),
    findByRunId: vi.fn().mockImplementation(() => Promise.resolve([...store.artifacts])),
    findLatestByType: vi.fn().mockImplementation((_runId: string, type: string) => {
      const matching = store.artifacts.filter((a) => a.type === type);
      if (matching.length === 0) return Promise.resolve(null);
      return Promise.resolve(matching.reduce((best, cur) => (cur.version > best.version ? cur : best)));
    }),
  };

  let eventIdCounter = 0;
  const eventRepo = {
    create: vi.fn().mockImplementation((params: { runId: string; eventType: string; source: string; payloadJson?: unknown }) => {
      const rec: RunEventRecord = {
        id: `event-${++eventIdCounter}`,
        runId: params.runId,
        eventType: params.eventType,
        source: params.source,
        payloadJson: params.payloadJson ?? {},
        createdAt: new Date(),
      };
      store.events.push(rec);
      return Promise.resolve(rec);
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
    postRemediationResolutions: vi.fn().mockResolvedValue(undefined),
    postExecutionReportUpdate: vi.fn().mockResolvedValue(undefined),
  };

  const plannerAgent = { run: vi.fn() };
  const planReviewerAgent = {
    run: vi.fn().mockResolvedValue({
      reviewId: "pr-1",
      overallVerdict: "approved",
      summary: "OK",
      findings: [],
    }),
  };
  const planReviserAgent = { run: vi.fn() };
  const executorAgent = { run: vi.fn() };
  const reviewerAgent = { run: vi.fn() };
  const remediationAgent = { run: vi.fn() };
  const answerResearcherAgent = {
    run: vi.fn().mockResolvedValue({ summary: "", answers: [], completedAt: "2026-01-01T00:00:00Z" }),
  };
  const distillationAgent = { run: vi.fn().mockResolvedValue(undefined) };

  const gitService = {
    setupRunWorktree: vi.fn().mockResolvedValue({ worktreePath: "/tmp/worktree", branchName: "ai/run-1" }),
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

  const agentSkillRepo = {
    findTopKByRelevance: vi.fn().mockResolvedValue([]),
    incrementSuccess: vi.fn(),
    incrementFailure: vi.fn(),
    archiveIfLowUtility: vi.fn().mockResolvedValue(undefined),
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
      answerResearcherAgent,
      distillationAgent,
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
    plannerAgent,
    planReviewerAgent,
    planReviserAgent,
    remediationAgent,
    reviewerAgent,
    answerResearcherAgent,
    distillationAgent,
    agentSkillRepo,
    logger,
  };
}

describe("OrchestratorService.handleCommand -- active-run dispatch branches", () => {
  it("'reject-plan' calls rejectPlan(run.id, body, 'linear') when an active run exists", async () => {
    const store: TestStore = { runState: RunState.AwaitingPlanApproval, artifacts: [], runPatch: {}, events: [] };
    const initialRun = makeRun();
    const { deps, runRepo } = buildDeps(store, initialRun);
    runRepo.findActiveByIssueId.mockResolvedValue(initialRun);

    const svc = new OrchestratorService(deps as never);
    const rejectPlanSpy = vi.spyOn(svc, "rejectPlan").mockResolvedValue(initialRun);

    await svc.handleCommand("LIN-1", { type: "reject-plan", body: "needs work" });

    expect(rejectPlanSpy).toHaveBeenCalledWith("run-1", "needs work", "linear");
  });

  it("'re-review' calls runReview(run.id) when an active run exists", async () => {
    const store: TestStore = { runState: RunState.AwaitingPlanApproval, artifacts: [], runPatch: {}, events: [] };
    const initialRun = makeRun();
    const { deps, runRepo } = buildDeps(store, initialRun);
    runRepo.findActiveByIssueId.mockResolvedValue(initialRun);

    const svc = new OrchestratorService(deps as never);
    const runReviewSpy = vi.spyOn(svc, "runReview").mockResolvedValue(initialRun);

    await svc.handleCommand("LIN-1", { type: "re-review" });

    expect(runReviewSpy).toHaveBeenCalledWith("run-1");
  });

  it("'approve-plan' calls approvePlan(run.id) then runExecution(run.id) when an active run exists", async () => {
    const store: TestStore = { runState: RunState.AwaitingPlanApproval, artifacts: [], runPatch: {}, events: [] };
    const initialRun = makeRun();
    const { deps, runRepo } = buildDeps(store, initialRun);
    runRepo.findActiveByIssueId.mockResolvedValue(initialRun);

    const svc = new OrchestratorService(deps as never);
    const approvePlanSpy = vi.spyOn(svc, "approvePlan").mockResolvedValue(initialRun);
    const runExecutionSpy = vi.spyOn(svc, "runExecution").mockResolvedValue(initialRun);

    await svc.handleCommand("LIN-1", { type: "approve-plan" });

    expect(approvePlanSpy).toHaveBeenCalledWith("run-1");
    expect(runExecutionSpy).toHaveBeenCalledWith("run-1");
  });
});

describe("OrchestratorService.runPlanReview -- missing artifact guard", () => {
  it("throws when no Plan artifact exists for the run", async () => {
    const store: TestStore = { runState: RunState.Planning, artifacts: [], runPatch: {}, events: [] };
    const initialRun = makeRun({ state: RunState.Planning });
    const { deps } = buildDeps(store, initialRun);
    const svc = new OrchestratorService(deps as never);

    await expect(svc.runPlanReview("run-1")).rejects.toThrow("No plan artifact found for run run-1");
  });
});

describe("OrchestratorService.rejectPlan -- blocking questions after re-plan", () => {
  it("pauses for human clarification instead of proceeding to plan review", async () => {
    const plan = makePlan({ planVersion: 1 });
    const store: TestStore = {
      runState: RunState.AwaitingPlanApproval,
      artifacts: [asArtifact({ type: "Plan", version: 1, payloadJson: plan })],
      runPatch: {},
      events: [],
    };
    const initialRun = makeRun({ state: RunState.AwaitingPlanApproval, planVersion: 1 });
    const { deps, plannerAgent, planReviewerAgent } = buildDeps(store, initialRun);
    plannerAgent.run.mockResolvedValue(
      makePlan({
        planVersion: 2,
        openQuestions: [{ id: "q1", question: "Still unclear?", requiredForExecution: true }],
      }),
    );

    const svc = new OrchestratorService(deps as never);
    const result = await svc.rejectPlan("run-1", "please clarify");

    expect(result.state).toBe(RunState.HumanClarificationNeeded);
    expect(planReviewerAgent.run).not.toHaveBeenCalled();
    const blockedEvent = store.events.find((e) => e.eventType === RunEvent.NEEDS_HUMAN_CLARIFICATION);
    expect(blockedEvent).toBeDefined();
    expect(
      (blockedEvent!.payloadJson as { blockingQuestions: { id: string }[] }).blockingQuestions,
    ).toEqual([{ id: "q1", question: "Still unclear?" }]);
  });
});

describe("OrchestratorService.runRemediation -- happy path all the way to Done-ready", () => {
  it("completes markReady successfully when the latest Review artifact is approved", async () => {
    const store: TestStore = {
      runState: RunState.AddressingReview,
      artifacts: [
        asArtifact({ type: "Plan", version: 1, payloadJson: makePlan() }),
        asArtifact({ type: "ExecutionReport", version: 1, payloadJson: makeExecutionReport() }),
        asArtifact({
          type: "Review",
          version: 1,
          payloadJson: makeReview({ overallVerdict: "changes_requested", findings: [
            { id: "f1", severity: "blocker", type: "bug", file: "a.ts", title: "t", details: "d" },
          ] }),
        }),
      ],
      runPatch: {},
      events: [],
    };
    const initialRun = makeRun({ state: RunState.AddressingReview, prNumber: 7, branchName: "ai/run-1" });
    const { deps, remediationAgent } = buildDeps(store, initialRun);

    remediationAgent.run.mockImplementation(async () => {
      const newReport = makeExecutionReport({ executionVersion: 2, score: 0.95 });
      store.artifacts.push(asArtifact({ type: "ExecutionReport", version: 2, payloadJson: newReport }));
      // Simulate that this run's Review is now approved (e.g. a human/automation
      // updated it out of band) so markReady can succeed at the end of remediation.
      store.artifacts.push(
        asArtifact({
          type: "Review",
          version: 2,
          payloadJson: makeReview({ overallVerdict: "approved", findings: [] }),
        }),
      );
      return {
        reviewId: "rev-1",
        resolution: [{ findingId: "f1", status: "accepted", action: "Fixed", rationale: "r" }],
        readyForHumanReview: true,
        executionReport: newReport,
      };
    });

    const svc = new OrchestratorService(deps as never);
    const result = await svc.runRemediation("run-1");

    expect(result.state).toBe(RunState.ReadyForHumanReview);
  });
});

describe("OrchestratorService.answerQuestions -- additional guard and branch coverage", () => {
  it("throws when no Plan artifact exists", async () => {
    const store: TestStore = { runState: RunState.HumanClarificationNeeded, artifacts: [], runPatch: {}, events: [] };
    const initialRun = makeRun({ state: RunState.HumanClarificationNeeded });
    const { deps } = buildDeps(store, initialRun);
    const svc = new OrchestratorService(deps as never);

    await expect(
      svc.answerQuestions("run-1", [{ questionId: "q1", answer: "yes" }]),
    ).rejects.toThrow("No plan artifact found for run run-1");
  });

  it("throws when no TaskBundle artifact exists for a HumanClarificationNeeded run", async () => {
    const plan = makePlan({
      openQuestions: [{ id: "q1", question: "Required?", requiredForExecution: true }],
    });
    const store: TestStore = {
      runState: RunState.HumanClarificationNeeded,
      artifacts: [asArtifact({ type: "Plan", version: 1, payloadJson: plan })],
      runPatch: {},
      events: [],
    };
    const initialRun = makeRun({ state: RunState.HumanClarificationNeeded });
    const { deps } = buildDeps(store, initialRun);
    const svc = new OrchestratorService(deps as never);

    await expect(
      svc.answerQuestions("run-1", [{ questionId: "q1", answer: "yes" }]),
    ).rejects.toThrow("No TaskBundle artifact found for run run-1");
  });

  it("re-plans back to HumanClarificationNeeded (not Failed) when blockers remain but max iterations not yet reached", async () => {
    const plan = makePlan({
      openQuestions: [{ id: "q1", question: "Required?", requiredForExecution: true }],
    });
    const taskBundle = {
      issue: { id: "LIN-1", title: "t", description: "d", labels: [], priority: 0 },
      repo: {
        name: "test-repo",
        defaultBranch: "main",
        workingBranch: "ai/run-1",
        repoPath: "/tmp",
        allowedPaths: [],
        protectedPaths: [],
      },
      constraints: { requiredChecks: [], maxFilesChanged: 10, maxDiffLines: 500, forbiddenPatterns: [], mustNotTouch: [] },
      definitionOfDone: [],
    };
    const store: TestStore = {
      runState: RunState.HumanClarificationNeeded,
      artifacts: [
        asArtifact({ type: "Plan", version: 1, payloadJson: plan }),
        asArtifact({ type: "TaskBundle", version: 1, payloadJson: taskBundle }),
      ],
      runPatch: {},
      events: [
        {
          id: "e0",
          runId: "run-1",
          eventType: RunEvent.NEEDS_HUMAN_CLARIFICATION,
          source: "planner-agent",
          payloadJson: {},
          createdAt: new Date(),
        },
      ],
    };
    const initialRun = makeRun({ state: RunState.HumanClarificationNeeded });
    const { deps, plannerAgent } = buildDeps(store, initialRun);
    plannerAgent.run.mockResolvedValue(
      makePlan({
        planVersion: 2,
        openQuestions: [{ id: "q1", question: "Required?", requiredForExecution: true }],
      }),
    );

    const svc = new OrchestratorService(deps as never);
    const result = await svc.answerQuestions("run-1", [{ questionId: "q1", answer: "partial" }]);

    expect(result.state).toBe(RunState.HumanClarificationNeeded);
    const events = store.events.filter((e) => e.eventType === RunEvent.NEEDS_HUMAN_CLARIFICATION);
    expect(events.length).toBe(2);
    expect((events[1].payloadJson as { iteration: number }).iteration).toBe(2);
  });

  it("injects prior researchedAnswers when computing the human-answers re-plan", async () => {
    const plan = makePlan({
      openQuestions: [{ id: "q1", question: "Required?", requiredForExecution: true }],
    });
    const taskBundle = {
      issue: { id: "LIN-1", title: "t", description: "d", labels: [], priority: 0 },
      repo: {
        name: "test-repo",
        defaultBranch: "main",
        workingBranch: "ai/run-1",
        repoPath: "/tmp",
        allowedPaths: [],
        protectedPaths: [],
      },
      constraints: { requiredChecks: [], maxFilesChanged: 10, maxDiffLines: 500, forbiddenPatterns: [], mustNotTouch: [] },
      definitionOfDone: [],
    };
    const store: TestStore = {
      runState: RunState.HumanClarificationNeeded,
      artifacts: [
        asArtifact({ type: "Plan", version: 1, payloadJson: plan }),
        asArtifact({ type: "TaskBundle", version: 1, payloadJson: taskBundle }),
        asArtifact({
          type: "ResearchedAnswers",
          version: 1,
          payloadJson: {
            summary: "s",
            answers: [{ questionId: "q2", question: "Q2", answer: "A2", confidence: "high" }],
            completedAt: "2026-01-01T00:00:00Z",
          },
        }),
      ],
      runPatch: {},
      events: [],
    };
    const initialRun = makeRun({ state: RunState.HumanClarificationNeeded });
    const { deps, plannerAgent, planReviewerAgent } = buildDeps(store, initialRun);
    plannerAgent.run.mockResolvedValue(makePlan({ planVersion: 2, openQuestions: [] }));
    planReviewerAgent.run.mockResolvedValue({
      reviewId: "pr-1",
      overallVerdict: "approved",
      summary: "OK",
      findings: [],
    });

    const svc = new OrchestratorService(deps as never);
    await svc.answerQuestions("run-1", [{ questionId: "q1", answer: "yes" }]);

    expect(plannerAgent.run).toHaveBeenCalledWith(
      taskBundle,
      "run-1",
      expect.objectContaining({
        humanAnswers: [{ questionId: "q1", answer: "yes" }],
        researchedAnswers: [{ questionId: "q2", question: "Q2", answer: "A2", confidence: "high" }],
      }),
    );
  });
});

describe("OrchestratorService.runManualPlanRevision -- no operator note", () => {
  it("calls runPlanRevision with undefined opts when changes are requested without a note", async () => {
    const plan = makePlan({ planVersion: 1 });
    const store: TestStore = {
      runState: RunState.AwaitingPlanApproval,
      artifacts: [asArtifact({ type: "Plan", version: 1, payloadJson: plan })],
      runPatch: {},
      events: [],
    };
    const initialRun = makeRun({ state: RunState.AwaitingPlanApproval });
    const { deps, planReviewerAgent } = buildDeps(store, initialRun);
    planReviewerAgent.run.mockResolvedValue({
      reviewId: "pr-1",
      overallVerdict: "changes_requested",
      summary: "One more pass",
      findings: [{ id: "f1", severity: "important", type: "gap", title: "t", details: "d" }],
    });

    const svc = new OrchestratorService(deps as never);
    const runPlanRevisionSpy = vi.spyOn(svc, "runPlanRevision").mockResolvedValue(initialRun);

    await svc.runManualPlanRevision("run-1");

    expect(runPlanRevisionSpy).toHaveBeenCalledWith("run-1", undefined);
  });
});

describe("OrchestratorService.approveHumanReview -- non-Error distillation failure", () => {
  it("stringifies a thrown non-Error value in the warn log", async () => {
    const store: TestStore = { runState: RunState.ReadyForHumanReview, artifacts: [], runPatch: {}, events: [] };
    const initialRun = makeRun({ state: RunState.ReadyForHumanReview });
    const { deps, distillationAgent, logger } = buildDeps(store, initialRun);
    distillationAgent.run.mockRejectedValue("plain string failure");

    const svc = new OrchestratorService(deps as never);
    await svc.approveHumanReview("run-1");

    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ runId: "run-1", error: "plain string failure" }),
      "Distillation agent failed (best-effort, ignoring)",
    );
  });
});

describe("OrchestratorService.buildTaskBundle -- non-Error failures", () => {
  it("stringifies a non-Error rejection from githubClient.getDefaultBranch", async () => {
    const plan = makePlan({ planVersion: 1 });
    const store: TestStore = {
      runState: RunState.AwaitingPlanApproval,
      artifacts: [asArtifact({ type: "Plan", version: 1, payloadJson: plan })],
      runPatch: {},
      events: [],
    };
    const initialRun = makeRun({ state: RunState.AwaitingPlanApproval });
    const { deps, githubClient, plannerAgent, logger } = buildDeps(store, initialRun);
    githubClient.getDefaultBranch.mockRejectedValue("network gone");
    plannerAgent.run.mockResolvedValue(makePlan({ planVersion: 2 }));

    const svc = new OrchestratorService(deps as never);
    await svc.rejectPlan("run-1");

    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ error: "network gone" }),
      "Failed to resolve default branch from GitHub, falling back to config value",
    );
  });

  it("stringifies a non-Error rejection from linearClient.getRelatedContext", async () => {
    const plan = makePlan({ planVersion: 1 });
    const store: TestStore = {
      runState: RunState.AwaitingPlanApproval,
      artifacts: [asArtifact({ type: "Plan", version: 1, payloadJson: plan })],
      runPatch: {},
      events: [],
    };
    const initialRun = makeRun({ state: RunState.AwaitingPlanApproval });
    const { deps, linearClient, plannerAgent, logger } = buildDeps(store, initialRun);
    linearClient.getRelatedContext.mockRejectedValue("linear unreachable");
    plannerAgent.run.mockResolvedValue(makePlan({ planVersion: 2 }));

    const svc = new OrchestratorService(deps as never);
    await svc.rejectPlan("run-1");

    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ error: "linear unreachable" }),
      "Failed to fetch related Linear context; proceeding without it",
    );
  });
});

describe("OrchestratorService.maybeResearchAndReplan -- prior human answers injected into the researcher call", () => {
  it("passes existing HumanAnswers to both the researcher and the post-research re-plan", async () => {
    const plan = makePlan({
      planVersion: 1,
      openQuestions: [{ id: "q1", question: "Optional?", requiredForExecution: false }],
    });
    const store: TestStore = {
      runState: RunState.AwaitingPlanApproval,
      artifacts: [
        asArtifact({ type: "Plan", version: 1, payloadJson: plan }),
        asArtifact({
          type: "HumanAnswers",
          version: 1,
          payloadJson: { answers: [{ questionId: "q1", answer: "yes please" }] },
        }),
      ],
      runPatch: {},
      events: [],
    };
    const initialRun = makeRun({ state: RunState.AwaitingPlanApproval, planVersion: 1 });
    const { deps, plannerAgent, answerResearcherAgent, planReviewerAgent } = buildDeps(store, initialRun);

    plannerAgent.run.mockResolvedValueOnce(plan).mockResolvedValueOnce(
      makePlan({ planVersion: 2, openQuestions: [] }),
    );
    answerResearcherAgent.run.mockResolvedValue({
      summary: "Resolved.",
      answers: [{ questionId: "q1", question: "Optional?", answer: "Yes", confidence: "high", sources: [] }],
      completedAt: "2026-01-01T00:00:00Z",
    });
    planReviewerAgent.run.mockResolvedValue({
      reviewId: "pr-1",
      overallVerdict: "approved",
      summary: "OK",
      findings: [],
    });

    const svc = new OrchestratorService(deps as never);
    await svc.rejectPlan("run-1");

    expect(answerResearcherAgent.run).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      "run-1",
      { humanAnswers: [{ questionId: "q1", answer: "yes please" }] },
    );
    // Second plannerAgent.run call is the post-research re-plan.
    expect(plannerAgent.run).toHaveBeenNthCalledWith(
      2,
      expect.anything(),
      "run-1",
      expect.objectContaining({ humanAnswers: [{ questionId: "q1", answer: "yes please" }] }),
    );
  });
});

describe("OrchestratorService.updateSkillMetrics -- edge cases", () => {
  it("falls back to an empty skill list ([]) when a SKILL_INJECTION event's payload has no skillIds field", async () => {
    const store: TestStore = {
      runState: RunState.ReadyForHumanReview,
      artifacts: [],
      runPatch: {},
      events: [
        {
          id: "e1",
          runId: "run-1",
          eventType: "SKILL_INJECTION",
          source: "orchestrator",
          payloadJson: {},
          createdAt: new Date(),
        },
      ],
    };
    const initialRun = makeRun({ state: RunState.ReadyForHumanReview });
    const { deps, agentSkillRepo } = buildDeps(store, initialRun);

    const svc = new OrchestratorService(deps as never);
    await svc.approveHumanReview("run-1");

    expect(agentSkillRepo.incrementSuccess).not.toHaveBeenCalled();
  });

  it("stringifies a non-Error rejection thrown while updating a skill's metrics", async () => {
    const store: TestStore = {
      runState: RunState.ReadyForHumanReview,
      artifacts: [],
      runPatch: {},
      events: [
        {
          id: "e1",
          runId: "run-1",
          eventType: "SKILL_INJECTION",
          source: "orchestrator",
          payloadJson: { skillIds: ["skill-x"] },
          createdAt: new Date(),
        },
      ],
    };
    const initialRun = makeRun({ state: RunState.ReadyForHumanReview });
    const { deps, agentSkillRepo, logger } = buildDeps(store, initialRun);
    agentSkillRepo.incrementSuccess.mockRejectedValue("string failure, not an Error object");

    const svc = new OrchestratorService(deps as never);
    await svc.approveHumanReview("run-1");

    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ skillId: "skill-x", error: "string failure, not an Error object" }),
      "Failed to update skill metric",
    );
  });
});

describe("OrchestratorService.retrieveSkillsForPlanning -- description included in the query", () => {
  it("includes a truncated linearIssueDescription in the relevance query", async () => {
    const plan = makePlan({ planVersion: 1 });
    const store: TestStore = {
      runState: RunState.AwaitingPlanApproval,
      artifacts: [asArtifact({ type: "Plan", version: 1, payloadJson: plan })],
      runPatch: {},
      events: [],
    };
    const initialRun = makeRun({
      state: RunState.AwaitingPlanApproval,
      linearIssueTitle: "Title",
      linearIssueDescription: "A very relevant description of the bug",
    });
    const { deps, plannerAgent, agentSkillRepo } = buildDeps(store, initialRun);
    plannerAgent.run.mockResolvedValue(makePlan({ planVersion: 2 }));

    const svc = new OrchestratorService(deps as never);
    await svc.rejectPlan("run-1");

    expect(agentSkillRepo.findTopKByRelevance).toHaveBeenCalledWith(
      "test-repo",
      "Title A very relevant description of the bug",
      expect.any(Number),
    );
  });
});

describe("OrchestratorService -- private comment-formatting helpers", () => {
  interface FormatPrivateAccess {
    formatPlanComment(plan: Plan, statusNote?: string): string;
    formatExecutionReportComment(report: ExecutionReport): string;
    formatPlanReviewComment(planReview: PlanReview): string;
    formatCodeReviewComment(review: Review): string;
  }

  function asFormatters(svc: OrchestratorService): FormatPrivateAccess {
    return svc as unknown as FormatPrivateAccess;
  }

  it("formatPlanComment renders a Risks section and omits the status line when no statusNote is given", async () => {
    const store: TestStore = { runState: RunState.Todo, artifacts: [], runPatch: {}, events: [] };
    const { deps } = buildDeps(store, makeRun());
    const svc = new OrchestratorService(deps as never);

    const plan = makePlan({ risks: ["Data loss if migration fails"] });
    const text = asFormatters(svc).formatPlanComment(plan);

    expect(text).toContain("**Risks:**");
    expect(text).toContain("Data loss if migration fails");
    expect(text).not.toMatch(/\*.+\*\n## AI Plan/);
  });

  it("formatExecutionReportComment collapses the file list into a <details> block above the threshold and renders a Notes section", async () => {
    const store: TestStore = { runState: RunState.Todo, artifacts: [], runPatch: {}, events: [] };
    const { deps } = buildDeps(store, makeRun());
    const svc = new OrchestratorService(deps as never);

    const report = makeExecutionReport({
      filesChanged: Array.from({ length: 9 }, (_, i) => `src/file${i}.ts`),
      notes: ["Consider adding an integration test"],
    });
    const text = asFormatters(svc).formatExecutionReportComment(report);

    expect(text).toContain("<details>");
    expect(text).toContain("<summary><strong>Files changed (9)</strong></summary>");
    expect(text).toContain("### Notes");
    expect(text).toContain("Consider adding an integration test");
  });

  it("formatPlanReviewComment includes the affected step id when present, and renders 'Changes Requested' for a non-approved verdict", async () => {
    const store: TestStore = { runState: RunState.Todo, artifacts: [], runPatch: {}, events: [] };
    const { deps } = buildDeps(store, makeRun());
    const svc = new OrchestratorService(deps as never);

    const planReview: PlanReview = {
      reviewId: "pr-1",
      summary: "s",
      overallVerdict: "changes_requested",
      findings: [
        {
          id: "f1",
          severity: "blocker",
          type: "gap",
          affectedStepId: "s2",
          title: "Missing validation",
          details: "d",
        },
      ],
    };
    const text = asFormatters(svc).formatPlanReviewComment(planReview);

    expect(text).toContain("Changes Requested");
    expect(text).toContain("(step s2)");
  });

  it("formatCodeReviewComment includes the lineHint when present", async () => {
    const store: TestStore = { runState: RunState.Todo, artifacts: [], runPatch: {}, events: [] };
    const { deps } = buildDeps(store, makeRun());
    const svc = new OrchestratorService(deps as never);

    const review: Review = {
      reviewId: "rev-1",
      summary: "s",
      overallVerdict: "changes_requested",
      findings: [
        { id: "f1", severity: "important", type: "bug", file: "src/a.ts", lineHint: 42, title: "t", details: "d" },
      ],
    };
    const text = asFormatters(svc).formatCodeReviewComment(review);

    expect(text).toContain("src/a.ts:42");
  });
});
