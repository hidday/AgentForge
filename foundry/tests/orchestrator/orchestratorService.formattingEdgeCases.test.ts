import { describe, it, expect, vi } from "vitest";
import { OrchestratorService } from "../../src/orchestrator/orchestratorService.js";
import { RunState } from "../../src/domain/runState.js";
import { RunEvent } from "../../src/domain/runEvent.js";
import type { Run, Artifact, RunEventRecord } from "../../src/domain/types.js";
import type { Plan } from "../../src/schemas/plan.js";
import type { ExecutionReport } from "../../src/schemas/executionReport.js";
import type { PlanReview } from "../../src/schemas/planReview.js";
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
    branchName: "ai/run-1",
    prNumber: 42,
    state: RunState.Implementing,
    planVersion: 1,
    approvedPlanVersion: 1,
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
    filesChanged: [],
    checks: {
      lint: { status: "pass", details: "ok" },
      typecheck: { status: "pass", details: "ok" },
      tests: { status: "pass", details: "ok" },
    },
    notes: [],
    prDraftCreated: true,
    score: 0.9,
    scoreRationale: "Green.",
    ...overrides,
  };
}

function asArtifact(type: string, version: number, payloadJson: unknown): Artifact {
  return {
    id: `artifact-${type}-${version}`,
    runId: "run-1",
    type: type as Artifact["type"],
    version,
    payloadJson,
    rawText: JSON.stringify(payloadJson),
    createdAt: new Date(),
  };
}

function makeEvent(overrides: Partial<RunEventRecord> & { eventType: string }): RunEventRecord {
  return { id: "event-1", runId: "run-1", source: "orchestrator", payloadJson: {}, createdAt: new Date(), ...overrides };
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

  const artifactRepo = { create: vi.fn().mockResolvedValue({ id: "artifact-new" }), findByRunId: vi.fn(), findLatestByType: vi.fn() };
  const eventRepo = { create: vi.fn().mockResolvedValue({ id: "event-new" }), findByRunId: vi.fn().mockResolvedValue([]) };
  const linearClient = {
    getIssue: vi.fn().mockResolvedValue({
      id: "LIN-1",
      title: "Test issue",
      description: "Test description",
      branchName: "ai/run-1",
      labels: [],
      priority: 0,
    }),
    postComment: vi.fn().mockResolvedValue(undefined),
    getRelatedContext: vi.fn().mockResolvedValue({ blockers: [] }),
  };
  const githubClient = { getPRDiff: vi.fn().mockResolvedValue("diff"), getDefaultBranch: vi.fn() };
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
  const githubSync = { syncState: vi.fn().mockResolvedValue(undefined), postReviewFindings: vi.fn().mockResolvedValue(new Map()), postRemediationResolutions: vi.fn() };
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
      ...overrides,
    },
    runRepo,
    artifactRepo,
    eventRepo,
    linearClient,
    executorAgent,
    planReviewerAgent,
    reviewerAgent,
    plannerAgent,
    logger,
  };
}

describe("OrchestratorService -- comment formatting edge cases", () => {
  it("formatExecutionReportComment: omits the Files section entirely when no files changed, and renders fail/skip check icons", async () => {
    const { deps, runRepo, artifactRepo, executorAgent, linearClient } = buildDeps();
    const svc = new OrchestratorService(deps as never);
    vi.spyOn(svc, "runReview").mockResolvedValue(makeRun({ state: RunState.AIReview }));

    const run = makeRun({ prNumber: null, branchName: null });
    runRepo.findById.mockResolvedValue(run);
    runRepo.update.mockResolvedValue({ ...run, prNumber: 5, executorRuntime: "claude-code" });
    runRepo.updateState.mockResolvedValue(makeRun({ state: RunState.AIReview }));
    artifactRepo.findLatestByType.mockImplementation((_: string, type: string) =>
      type === "Plan" ? Promise.resolve(asArtifact("Plan", 1, makePlan())) : Promise.resolve(null),
    );

    const report = makeExecutionReport({
      filesChanged: [],
      checks: {
        lint: { status: "pass", details: "ok" },
        typecheck: { status: "fail", details: "type error" },
        tests: { status: "skip", details: "skipped" },
      },
    });
    executorAgent.run.mockResolvedValue({ report, prNumber: 5 });

    await svc.runExecution("run-1");

    const comment = (linearClient.postComment as ReturnType<typeof vi.fn>).mock.calls.find((c: unknown[]) =>
      (c[1] as string).includes("Execution Report"),
    )![1] as string;

    expect(comment).not.toContain("Files changed");
    expect(comment).toContain(":x:");
    expect(comment).toContain(":heavy_minus_sign:");
  });

  it("formatPlanComment: renders a Risks section when the plan has risks", async () => {
    const { deps, runRepo, artifactRepo, planReviewerAgent, linearClient } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    const run = makeRun({ state: RunState.PlanReview });
    runRepo.findById.mockResolvedValue(run);
    runRepo.updateState.mockResolvedValue(makeRun({ state: RunState.AwaitingPlanApproval }));
    artifactRepo.findLatestByType.mockImplementation((_: string, type: string) =>
      type === "Plan" ? Promise.resolve(asArtifact("Plan", 1, makePlan({ risks: ["Data migration could lose rows"] }))) : Promise.resolve(null),
    );
    planReviewerAgent.run.mockResolvedValue({ reviewId: "pr-1", overallVerdict: "approved", summary: "OK", findings: [] });

    await svc.runPlanReview("run-1");

    const comment = (linearClient.postComment as ReturnType<typeof vi.fn>).mock.calls.find((c: unknown[]) =>
      (c[1] as string).includes("AI Plan"),
    )![1] as string;
    expect(comment).toContain("**Risks:**");
    expect(comment).toContain("Data migration could lose rows");
  });

  it("formatPlanReviewComment: renders the affected-step suffix only for findings that have one", async () => {
    const { deps, runRepo, artifactRepo, planReviewerAgent, linearClient } = buildDeps();
    const svc = new OrchestratorService(deps as never);
    vi.spyOn(svc, "runPlanRevision").mockResolvedValue(makeRun({ state: RunState.AwaitingPlanApproval }));

    const run = makeRun({ state: RunState.PlanReview });
    runRepo.findById.mockResolvedValue(run);
    runRepo.updateState.mockResolvedValue(makeRun({ state: RunState.PlanRevision }));
    artifactRepo.findLatestByType.mockImplementation((_: string, type: string) =>
      type === "Plan" ? Promise.resolve(asArtifact("Plan", 1, makePlan())) : Promise.resolve(null),
    );

    const planReview: PlanReview = {
      reviewId: "pr-1",
      summary: "Mixed findings",
      overallVerdict: "changes_requested",
      findings: [
        { id: "f1", severity: "important", type: "risk", affectedStepId: "s1", title: "Has a step", details: "d1" },
        { id: "f2", severity: "nit", type: "style", title: "No step", details: "d2" },
      ],
    };
    planReviewerAgent.run.mockResolvedValue(planReview);

    await svc.runPlanReview("run-1");

    const comment = (linearClient.postComment as ReturnType<typeof vi.fn>).mock.calls.find((c: unknown[]) =>
      (c[1] as string).includes("Mixed findings"),
    )![1] as string;
    expect(comment).toContain("Has a step (step s1)");
    expect(comment).toContain("No step\n");
    expect(comment).not.toContain("No step (step");
  });

  it("formatCodeReviewComment: renders the line-hint suffix only for findings that have one", async () => {
    const { deps, runRepo, artifactRepo, reviewerAgent, linearClient } = buildDeps();
    const svc = new OrchestratorService(deps as never);
    vi.spyOn(svc, "runRemediation").mockResolvedValue(makeRun({ state: RunState.AIReview }));

    const run = makeRun({ state: RunState.AIReview });
    runRepo.findById.mockResolvedValue(run);
    runRepo.update.mockResolvedValue({ ...run, reviewerRuntime: "codex" });
    runRepo.updateState.mockResolvedValue(makeRun({ state: RunState.AddressingReview }));
    artifactRepo.findLatestByType.mockImplementation((_: string, type: string) => {
      if (type === "ExecutionReport") return Promise.resolve(asArtifact("ExecutionReport", 1, makeExecutionReport()));
      if (type === "Plan") return Promise.resolve(asArtifact("Plan", 1, makePlan()));
      return Promise.resolve(null);
    });

    const review: Review = {
      reviewId: "rev-1",
      summary: "Some findings",
      overallVerdict: "changes_requested",
      findings: [
        { id: "f1", severity: "important", type: "bug", file: "src/a.ts", lineHint: 42, title: "Off by one", details: "d1" },
        { id: "f2", severity: "nit", type: "style", file: "src/b.ts", title: "No line hint", details: "d2" },
      ],
    };
    reviewerAgent.run.mockResolvedValue(review);

    await svc.runReview("run-1");

    const comment = (linearClient.postComment as ReturnType<typeof vi.fn>).mock.calls.find((c: unknown[]) =>
      (c[1] as string).includes("Some findings"),
    )![1] as string;
    expect(comment).toContain("(src/a.ts:42)");
    expect(comment).toContain("(src/b.ts)");
  });
});

describe("OrchestratorService -- remaining defensive branches", () => {
  it("requireRun throws a descriptive error when the run does not exist", async () => {
    const { deps, runRepo } = buildDeps();
    const svc = new OrchestratorService(deps as never);
    runRepo.findById.mockResolvedValue(null);

    await expect(svc.runPlanning("missing-run")).rejects.toThrow("Run not found: missing-run");
  });

  it("updateSkillMetrics: tolerates a SKILL_INJECTION payload with no skillIds field, and a successful incrementFailure still archives the skill", async () => {
    const agentSkillRepo = {
      incrementFailure: vi.fn().mockResolvedValue({ id: "skill-y", utilityScore: 0.1 }),
      archiveIfLowUtility: vi.fn().mockResolvedValue(undefined),
    };
    const { deps, runRepo, artifactRepo, eventRepo, plannerAgent } = buildDeps({
      agentSkillRepo,
    });
    const svc = new OrchestratorService(deps as never);

    const run = makeRun({ state: RunState.HumanClarificationNeeded });
    const plan = makePlan({ openQuestions: [{ id: "q1", question: "Required?", requiredForExecution: true }] });
    const taskBundle = {
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

    runRepo.findById.mockResolvedValue(run);
    runRepo.updateState
      .mockResolvedValueOnce(makeRun({ state: RunState.Planning }))
      .mockResolvedValueOnce(makeRun({ state: RunState.PlanReview }))
      .mockResolvedValueOnce(makeRun({ state: RunState.Failed }));
    runRepo.update.mockResolvedValue({ ...run, state: RunState.Planning, planVersion: 2 });

    artifactRepo.findLatestByType.mockImplementation((_: string, type: string) => {
      if (type === "Plan") return Promise.resolve(asArtifact("Plan", 1, plan));
      if (type === "TaskBundle") return Promise.resolve(asArtifact("TaskBundle", 1, taskBundle));
      return Promise.resolve(null);
    });
    plannerAgent.run.mockResolvedValue(
      makePlan({ planVersion: 2, openQuestions: [{ id: "q1", question: "Still required?", requiredForExecution: true }] }),
    );

    eventRepo.findByRunId.mockResolvedValue([
      makeEvent({ id: "e0", eventType: "SKILL_INJECTION", payloadJson: {} }), // malformed: no skillIds field
      makeEvent({ id: "e1", eventType: "SKILL_INJECTION", payloadJson: { skillIds: ["skill-y"] } }),
      makeEvent({ id: "e2", eventType: RunEvent.NEEDS_HUMAN_CLARIFICATION }),
      makeEvent({ id: "e3", eventType: RunEvent.NEEDS_HUMAN_CLARIFICATION }),
      makeEvent({ id: "e4", eventType: RunEvent.NEEDS_HUMAN_CLARIFICATION }),
    ]);

    const result = await svc.answerQuestions("run-1", [{ questionId: "q1", answer: "still unsure" }]);

    expect(result.state).toBe(RunState.Failed);
    expect(agentSkillRepo.incrementFailure).toHaveBeenCalledTimes(1);
    expect(agentSkillRepo.incrementFailure).toHaveBeenCalledWith("skill-y");
    expect(agentSkillRepo.archiveIfLowUtility).toHaveBeenCalledWith({ id: "skill-y", utilityScore: 0.1 });
  });
});
