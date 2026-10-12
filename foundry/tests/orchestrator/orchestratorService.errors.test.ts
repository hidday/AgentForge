import { describe, it, expect, vi } from "vitest";
import { OrchestratorService } from "../../src/orchestrator/orchestratorService.js";
import { RunState } from "../../src/domain/runState.js";
import { RunEvent } from "../../src/domain/runEvent.js";
import type { Run, Artifact } from "../../src/domain/types.js";
import type { Plan } from "../../src/schemas/plan.js";
import type { Review } from "../../src/schemas/review.js";
import type { ExecutionReport } from "../../src/schemas/executionReport.js";
import type { Remediation } from "../../src/schemas/remediation.js";

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
    state: RunState.Todo,
    planVersion: 1,
    approvedPlanVersion: null,
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

function asArtifact(overrides: { type: string; version: number; payloadJson: unknown }): Artifact {
  return {
    id: `artifact-${overrides.type}-${overrides.version}-${Math.random()}`,
    runId: "run-1",
    type: overrides.type as Artifact["type"],
    version: overrides.version,
    payloadJson: overrides.payloadJson,
    rawText: JSON.stringify(overrides.payloadJson),
    createdAt: new Date(),
  };
}

function baseDeps() {
  const runRepo = {
    findById: vi.fn(),
    findActiveByIssueId: vi.fn(),
    findAll: vi.fn(),
    create: vi.fn(),
    findByIssueId: vi.fn(),
    updateState: vi.fn(),
    update: vi.fn(),
  };
  const artifactRepo = { create: vi.fn().mockResolvedValue({ id: "artifact-new" }), findByRunId: vi.fn(), findLatestByType: vi.fn().mockResolvedValue(null) };
  const eventRepo = { create: vi.fn().mockResolvedValue({ id: "event-new" }), findByRunId: vi.fn().mockResolvedValue([]) };
  const linearClient = {
    getIssue: vi.fn().mockResolvedValue({ id: "LIN-1", title: "Test", description: "d", branchName: "ai/run-1", labels: [], priority: 0 }),
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
      name: "test-repo", defaultBranch: "main", allowedPaths: ["src/"], protectedPaths: [],
      constraints: { requiredChecks: [], maxFilesChanged: 10, maxDiffLines: 500, forbiddenPatterns: [], mustNotTouch: [] },
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
  const dashboardEmitter = { emitStateChanged: vi.fn(), emitArtifactCreated: vi.fn(), emitRunCreated: vi.fn(), emitQuestionsAnswered: vi.fn() };

  return {
    runRepo, artifactRepo, eventRepo, linearClient, githubClient, gitService, repoRegistry,
    linearSync, githubSync, plannerAgent, planReviewerAgent, planReviserAgent, executorAgent,
    reviewerAgent, remediationAgent, logger, dashboardEmitter,
  };
}

describe("OrchestratorService.startRun -- idempotent re-entry", () => {
  it("returns the existing active run without creating a new one or touching git/linear", async () => {
    const deps = baseDeps();
    const existing = makeRun({ id: "run-existing", state: RunState.Planning });
    deps.runRepo.findActiveByIssueId.mockResolvedValue(existing);
    const svc = new OrchestratorService(deps as never);

    const result = await svc.startRun("LIN-1");

    expect(result).toBe(existing);
    expect(deps.runRepo.create).not.toHaveBeenCalled();
    expect(deps.linearClient.getIssue).not.toHaveBeenCalled();
    expect(deps.gitService.setupRunWorktree).not.toHaveBeenCalled();
  });
});

describe("missing-artifact error paths", () => {
  it("runPlanReview throws when no Plan artifact exists", async () => {
    const deps = baseDeps();
    deps.runRepo.findById.mockResolvedValue(makeRun({ state: RunState.PlanReview }));
    deps.artifactRepo.findLatestByType.mockResolvedValue(null);
    const svc = new OrchestratorService(deps as never);

    await expect(svc.runPlanReview("run-1")).rejects.toThrow(/No plan artifact found/);
  });

  it("answerQuestions throws when no Plan artifact exists", async () => {
    const deps = baseDeps();
    deps.runRepo.findById.mockResolvedValue(makeRun({ state: RunState.HumanClarificationNeeded }));
    deps.artifactRepo.findLatestByType.mockResolvedValue(null);
    const svc = new OrchestratorService(deps as never);

    await expect(svc.answerQuestions("run-1", [{ questionId: "q1", answer: "yes" }])).rejects.toThrow(
      /No plan artifact found/,
    );
  });

  it("answerQuestions throws when no TaskBundle artifact exists after clarification is provided", async () => {
    const deps = baseDeps();
    const run = makeRun({ state: RunState.HumanClarificationNeeded });
    deps.runRepo.findById.mockResolvedValue(run);
    deps.runRepo.updateState.mockResolvedValue({ ...run, state: RunState.Planning });
    const plan = makePlan({ openQuestions: [{ id: "q1", question: "Required?", requiredForExecution: true }] });
    deps.artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
      if (type === "Plan") return Promise.resolve(asArtifact({ type: "Plan", version: 1, payloadJson: plan }));
      // TaskBundle intentionally missing
      return Promise.resolve(null);
    });
    const svc = new OrchestratorService(deps as never);

    await expect(svc.answerQuestions("run-1", [{ questionId: "q1", answer: "yes" }])).rejects.toThrow(
      /No TaskBundle artifact found/,
    );
  });

  it("runManualReReview throws when no Plan artifact exists", async () => {
    const deps = baseDeps();
    const run = makeRun({ state: RunState.AwaitingPlanApproval });
    deps.runRepo.findById.mockResolvedValue(run);
    deps.runRepo.updateState.mockResolvedValue({ ...run, state: RunState.PlanReview });
    deps.artifactRepo.findLatestByType.mockResolvedValue(null);
    const svc = new OrchestratorService(deps as never);

    await expect(svc.runManualReReview("run-1")).rejects.toThrow(/No plan artifact found/);
  });

  it("runManualPlanRevision throws when no Plan artifact exists", async () => {
    const deps = baseDeps();
    const run = makeRun({ state: RunState.AwaitingPlanApproval });
    deps.runRepo.findById.mockResolvedValue(run);
    deps.runRepo.updateState.mockResolvedValue({ ...run, state: RunState.PlanReview });
    deps.artifactRepo.findLatestByType.mockResolvedValue(null);
    const svc = new OrchestratorService(deps as never);

    await expect(svc.runManualPlanRevision("run-1")).rejects.toThrow(/No plan artifact found/);
  });
});

describe("OrchestratorService.rejectPlan -- iterate-mode context propagation and blocking re-plan", () => {
  it("forwards prior humanAnswers/researchedAnswers/planReviewFindings from loadReplanContext, and pauses for clarification when the re-plan still blocks", async () => {
    const deps = baseDeps();
    const run = makeRun({ state: RunState.AwaitingPlanApproval, planVersion: 2 });
    deps.runRepo.findById.mockResolvedValue(run);
    deps.runRepo.updateState
      .mockResolvedValueOnce({ ...run, state: RunState.Planning }) // PLAN_REJECTED
      .mockResolvedValueOnce({ ...run, state: RunState.PlanReview, planVersion: 3 }) // PLAN_CREATED
      .mockResolvedValueOnce({ ...run, state: RunState.HumanClarificationNeeded, planVersion: 3 }); // NEEDS_HUMAN_CLARIFICATION
    deps.runRepo.update.mockResolvedValue({ ...run, state: RunState.Planning, planVersion: 3 });

    const previousPlan = makePlan({ planVersion: 2 });
    const priorHumanAnswers = { answers: [{ questionId: "q0", answer: "yes" }] };
    const priorResearched = {
      summary: "s",
      answers: [{ questionId: "q0", question: "Q?", answer: "A", confidence: "high" as const }],
      completedAt: "2026-01-01T00:00:00Z",
    };
    const priorPlanReview = { summary: "Needs work", findings: [{ id: "pf1", severity: "important", title: "X", details: "Y" }] };

    deps.artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
      if (type === "Plan") return Promise.resolve(asArtifact({ type: "Plan", version: 2, payloadJson: previousPlan }));
      if (type === "HumanAnswers") return Promise.resolve(asArtifact({ type: "HumanAnswers", version: 1, payloadJson: priorHumanAnswers }));
      if (type === "ResearchedAnswers") return Promise.resolve(asArtifact({ type: "ResearchedAnswers", version: 1, payloadJson: priorResearched }));
      if (type === "PlanReview") return Promise.resolve(asArtifact({ type: "PlanReview", version: 1, payloadJson: priorPlanReview }));
      return Promise.resolve(null);
    });

    const blockingPlan = makePlan({ planVersion: 3, openQuestions: [{ id: "q1", question: "Blocker?", requiredForExecution: true }] });
    deps.plannerAgent.run.mockResolvedValue(blockingPlan);

    const svc = new OrchestratorService(deps as never);
    const result = await svc.rejectPlan("run-1", "Please reconsider", "api", "iterate");

    expect(deps.plannerAgent.run).toHaveBeenCalledWith(
      expect.anything(),
      "run-1",
      expect.objectContaining({
        previousPlan,
        humanAnswers: priorHumanAnswers.answers,
        researchedAnswers: priorResearched.answers,
        planReviewFindings: { summary: priorPlanReview.summary, findings: priorPlanReview.findings },
      }),
    );

    expect(result.state).toBe(RunState.HumanClarificationNeeded);
    const eventTypes = (deps.eventRepo.create as ReturnType<typeof vi.fn>).mock.calls.map(
      (c: unknown[]) => (c[0] as { eventType: string }).eventType,
    );
    expect(eventTypes).toContain(RunEvent.NEEDS_HUMAN_CLARIFICATION);
  });

  it("fresh mode: skips loadReplanContext entirely, so no previousPlan/humanAnswers/researchedAnswers/planReviewFindings are forwarded", async () => {
    const deps = baseDeps();
    const run = makeRun({ state: RunState.AwaitingPlanApproval, planVersion: 2 });
    let currentState = run.state;
    deps.runRepo.findById.mockImplementation(() => Promise.resolve({ ...run, state: currentState }));
    deps.runRepo.updateState.mockImplementation((_id: string, newState: RunState) => {
      currentState = newState;
      return Promise.resolve({ ...run, state: newState });
    });
    deps.runRepo.update.mockImplementation((_id: string, patch: Partial<Run>) => Promise.resolve({ ...run, state: currentState, ...patch }));

    // Even though a previous Plan / HumanAnswers / ResearchedAnswers / PlanReview
    // artifact exists, "fresh" mode must not read or forward any of it.
    const previousPlan = makePlan({ planVersion: 2 });
    deps.artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
      if (type === "Plan") return Promise.resolve(asArtifact({ type: "Plan", version: 2, payloadJson: previousPlan }));
      if (type === "HumanAnswers") return Promise.resolve(asArtifact({ type: "HumanAnswers", version: 1, payloadJson: { answers: [{ questionId: "q0", answer: "yes" }] } }));
      if (type === "ResearchedAnswers")
        return Promise.resolve(
          asArtifact({ type: "ResearchedAnswers", version: 1, payloadJson: { summary: "s", answers: [{ questionId: "q0", question: "Q?", answer: "A", confidence: "high" }], completedAt: "2026-01-01T00:00:00Z" } }),
        );
      if (type === "PlanReview") return Promise.resolve(asArtifact({ type: "PlanReview", version: 1, payloadJson: { summary: "x", findings: [] } }));
      return Promise.resolve(null);
    });

    const clearPlan = makePlan({ planVersion: 3, openQuestions: [] });
    deps.plannerAgent.run.mockResolvedValue(clearPlan);
    deps.planReviewerAgent.run.mockResolvedValue({ overallVerdict: "approved", summary: "OK", findings: [] });

    const svc = new OrchestratorService(deps as never);
    await svc.rejectPlan("run-1", "Start over please", "api", "fresh");

    const plannerOptions = deps.plannerAgent.run.mock.calls[0][2] as Record<string, unknown>;
    expect(plannerOptions.previousPlan).toBeUndefined();
    expect(plannerOptions.humanAnswers).toBeUndefined();
    expect(plannerOptions.researchedAnswers).toBeUndefined();
    expect(plannerOptions.planReviewFindings).toBeUndefined();
  });
});

describe("OrchestratorService.answerQuestions -- prior researched answers are preserved across re-plan", () => {
  it("forwards a prior ResearchedAnswers artifact into the planner call alongside the new human answers", async () => {
    const deps = baseDeps();
    const run = makeRun({ state: RunState.HumanClarificationNeeded });
    let currentState = run.state;
    deps.runRepo.findById.mockImplementation(() => Promise.resolve({ ...run, state: currentState }));
    deps.runRepo.updateState.mockImplementation((_id: string, newState: RunState) => {
      currentState = newState;
      return Promise.resolve({ ...run, state: newState });
    });
    deps.runRepo.update.mockImplementation((_id: string, patch: Partial<Run>) => Promise.resolve({ ...run, state: currentState, ...patch }));

    const plan = makePlan({ openQuestions: [{ id: "q1", question: "Required?", requiredForExecution: true }] });
    const taskBundle = {
      issue: { id: "LIN-1", title: "t", description: "d", labels: [], priority: 0 },
      repo: { name: "test-repo", defaultBranch: "main", workingBranch: "ai/run-1", repoPath: "/tmp", allowedPaths: ["src/"], protectedPaths: [] },
      constraints: { requiredChecks: [], maxFilesChanged: 10, maxDiffLines: 500, forbiddenPatterns: [], mustNotTouch: [] },
      definitionOfDone: [],
    };
    const priorResearched = {
      summary: "s",
      answers: [{ questionId: "q0", question: "Prior?", answer: "Resolved earlier", confidence: "high" as const }],
      completedAt: "2026-01-01T00:00:00Z",
    };
    deps.artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
      if (type === "Plan") return Promise.resolve(asArtifact({ type: "Plan", version: 1, payloadJson: plan }));
      if (type === "TaskBundle") return Promise.resolve(asArtifact({ type: "TaskBundle", version: 1, payloadJson: taskBundle }));
      if (type === "ResearchedAnswers") return Promise.resolve(asArtifact({ type: "ResearchedAnswers", version: 1, payloadJson: priorResearched }));
      return Promise.resolve(null);
    });

    const clearedPlan = makePlan({ planVersion: 2, openQuestions: [] });
    deps.plannerAgent.run.mockResolvedValue(clearedPlan);
    deps.planReviewerAgent.run.mockResolvedValue({ overallVerdict: "approved", summary: "OK", findings: [] });

    const svc = new OrchestratorService(deps as never);
    await svc.answerQuestions("run-1", [{ questionId: "q1", answer: "yes" }]);

    expect(deps.plannerAgent.run).toHaveBeenCalledWith(
      taskBundle,
      "run-1",
      expect.objectContaining({
        humanAnswers: [{ questionId: "q1", answer: "yes" }],
        researchedAnswers: priorResearched.answers,
      }),
    );
  });
});

describe("OrchestratorService.runRemediation -- full success path", () => {
  it("completes markReady when remediation results in checks passing and an approved Review verdict", async () => {
    // NOTE: under the current implementation, runRemediation never re-triggers
    // code review, so in practice the stored Review's verdict stays
    // "changes_requested" and markReady always throws afterwards (see the
    // executionScore/remediation test suites). This test exercises the
    // success path (markReady actually completing) by having the mocked
    // RemediationAgent also persist a fresh, approved Review artifact --
    // which is how line coverage confirms the happy-path code after
    // `await this.markReady(runId)` is reachable and correct when its
    // preconditions are met.
    const deps = baseDeps();
    const run = makeRun({ state: RunState.AddressingReview, prNumber: 42 });
    let state = run.state;
    deps.runRepo.findById.mockImplementation(() => Promise.resolve({ ...run, state }));
    deps.runRepo.updateState.mockImplementation((_id: string, newState: RunState) => {
      state = newState;
      return Promise.resolve({ ...run, state: newState });
    });
    deps.runRepo.update.mockImplementation((_id: string, patch: Partial<Run>) => Promise.resolve({ ...run, state, ...patch }));

    const review: Review = {
      reviewId: "rev-001",
      summary: "Found a bug",
      findings: [{ id: "f1", severity: "important", type: "bug", file: "src/foo.ts", title: "Bug", details: "x" }],
      overallVerdict: "changes_requested",
    };
    const executionReport: ExecutionReport = {
      executionVersion: 1,
      summary: "Initial",
      filesChanged: ["src/foo.ts"],
      checks: { lint: { status: "pass", details: "ok" }, typecheck: { status: "pass", details: "ok" }, tests: { status: "fail", details: "x" } },
      notes: [],
      prDraftCreated: true,
      score: 0.5,
      scoreRationale: "x",
    };

    const artifacts: Artifact[] = [
      asArtifact({ type: "Review", version: 1, payloadJson: review }),
      asArtifact({ type: "ExecutionReport", version: 1, payloadJson: executionReport }),
    ];
    deps.artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
      const matching = artifacts.filter((a) => a.type === type);
      if (matching.length === 0) return Promise.resolve(null);
      return Promise.resolve(matching.reduce((best, cur) => (cur.version > best.version ? cur : best)));
    });
    deps.artifactRepo.create.mockImplementation((params: { type: string; version: number; payloadJson: unknown }) => {
      const a = asArtifact({ type: params.type, version: params.version, payloadJson: params.payloadJson });
      artifacts.push(a);
      return Promise.resolve(a);
    });

    deps.remediationAgent.run.mockImplementation(async (): Promise<Remediation> => {
      const newReport: ExecutionReport = {
        ...executionReport,
        executionVersion: 2,
        checks: { lint: { status: "pass", details: "ok" }, typecheck: { status: "pass", details: "ok" }, tests: { status: "pass", details: "ok" } },
        score: 0.95,
        scoreRationale: "Fixed",
      };
      await deps.artifactRepo.create({ runId: "run-1", type: "ExecutionReport", version: 2, payloadJson: newReport, rawText: "{}" });
      // Synthetic: also persist a fresh approved Review so markReady's
      // post-conditions are satisfied for this test.
      await deps.artifactRepo.create({
        runId: "run-1",
        type: "Review",
        version: 2,
        payloadJson: { ...review, overallVerdict: "approved", findings: [] },
        rawText: "{}",
      });
      return {
        reviewId: "rev-001",
        resolution: [{ findingId: "f1", status: "accepted", action: "Fixed", rationale: "x" }],
        readyForHumanReview: true,
        executionReport: newReport,
      };
    });

    const svc = new OrchestratorService(deps as never);
    const result = await svc.runRemediation("run-1");

    expect(result.state).toBe(RunState.ReadyForHumanReview);
    const finalComment = (deps.linearClient.postComment as ReturnType<typeof vi.fn>).mock.calls
      .map((c: unknown[]) => c[1] as string)
      .find((b: string) => b.includes("Ready for Human Review"));
    expect(finalComment).toBeDefined();
  });
});
