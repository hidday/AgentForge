import { describe, it, expect, vi } from "vitest";
import { OrchestratorService } from "../../src/orchestrator/orchestratorService.js";
import { RunState } from "../../src/domain/runState.js";
import { RunEvent } from "../../src/domain/runEvent.js";
import type { Run, Artifact } from "../../src/domain/types.js";
import type { Plan } from "../../src/schemas/plan.js";
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
    workingDirectory: "/tmp/worktree",
    latestArtifactVersion: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makePlan(): Plan {
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

function buildDeps(run: Run) {
  let state = run.state;
  const runRepo = {
    findById: vi.fn().mockImplementation(() => Promise.resolve({ ...run, state })),
    findActiveByIssueId: vi.fn(),
    findAll: vi.fn(),
    create: vi.fn(),
    findByIssueId: vi.fn(),
    updateState: vi.fn().mockImplementation((_id: string, newState: RunState) => {
      state = newState;
      return Promise.resolve({ ...run, state: newState });
    }),
    update: vi.fn().mockImplementation((_id: string, patch: Partial<Run>) => Promise.resolve({ ...run, state, ...patch })),
  };

  const plan = makePlan();
  const planArtifact = asArtifact({ type: "Plan", version: plan.planVersion, payloadJson: plan });

  const artifactRepo = {
    create: vi.fn().mockResolvedValue({ id: "artifact-new" }),
    findByRunId: vi.fn(),
    findLatestByType: vi.fn().mockImplementation((_runId: string, type: string) => (type === "Plan" ? Promise.resolve(planArtifact) : Promise.resolve(null))),
  };

  const eventRepo = { create: vi.fn().mockResolvedValue({ id: "event-new" }), findByRunId: vi.fn().mockResolvedValue([]) };
  const linearClient = {
    getIssue: vi.fn().mockResolvedValue({ id: "LIN-1", title: "Test issue", description: "d", branchName: "ai/run-1", labels: [], priority: 0 }),
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
  const githubSync = { syncState: vi.fn().mockResolvedValue(undefined), postReviewFindings: vi.fn(), postRemediationResolutions: vi.fn() };
  const plannerAgent = { run: vi.fn() };
  const planReviewerAgent = { run: vi.fn() };
  const planReviserAgent = {
    run: vi.fn().mockResolvedValue({
      revision: { dispositions: [{ findingId: "pf1", status: "accepted", rationale: "Good catch" }] },
      revisedPlan: makePlan(),
    }),
  };
  const executorAgent = { run: vi.fn() };
  const reviewerAgent = { run: vi.fn() };
  const remediationAgent = { run: vi.fn() };
  const gitService = {
    setupRunWorktree: vi.fn(),
    assertBranch: vi.fn().mockResolvedValue(undefined),
    commitAndPush: vi.fn().mockResolvedValue(undefined),
    removeWorktree: vi.fn().mockResolvedValue(undefined),
    resolveMainRepoPath: vi.fn().mockReturnValue(run.workingDirectory),
  };
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  const dashboardEmitter = { emitStateChanged: vi.fn(), emitArtifactCreated: vi.fn(), emitRunCreated: vi.fn(), emitQuestionsAnswered: vi.fn() };

  return {
    deps: {
      runRepo, artifactRepo, eventRepo, linearClient, githubClient, gitService, repoRegistry,
      linearSync, githubSync, plannerAgent, planReviewerAgent, planReviserAgent, executorAgent,
      reviewerAgent, remediationAgent, logger, dashboardEmitter,
    },
    runRepo,
    artifactRepo,
    eventRepo,
    linearClient,
    planReviewerAgent,
    planReviserAgent,
    logger,
  };
}

describe("OrchestratorService.runManualReReview", () => {
  it("approved verdict: records RE_REVIEW_REQUESTED then PLAN_REVIEW_APPROVED, returns to AwaitingPlanApproval", async () => {
    const run = makeRun({ state: RunState.AwaitingPlanApproval });
    const { deps, planReviewerAgent, eventRepo } = buildDeps(run);
    planReviewerAgent.run.mockResolvedValue({ overallVerdict: "approved", summary: "Great", findings: [] });
    const svc = new OrchestratorService(deps as never);

    const result = await svc.runManualReReview("run-1");

    const eventTypes = eventRepo.create.mock.calls.map((c: unknown[]) => (c[0] as { eventType: string }).eventType);
    expect(eventTypes).toEqual([RunEvent.RE_REVIEW_REQUESTED, RunEvent.PLAN_REVIEW_APPROVED]);
    expect(result.state).toBe(RunState.AwaitingPlanApproval);
  });

  it("changes_requested verdict: still returns to AwaitingPlanApproval (does not auto-chain into plan revision)", async () => {
    const run = makeRun({ state: RunState.AwaitingPlanApproval });
    const { deps, planReviewerAgent, planReviserAgent, eventRepo } = buildDeps(run);
    planReviewerAgent.run.mockResolvedValue({
      overallVerdict: "changes_requested",
      summary: "Needs work",
      findings: [{ id: "pf1", severity: "important", title: "X", details: "Y" }],
    });
    const svc = new OrchestratorService(deps as never);

    const result = await svc.runManualReReview("run-1");

    // Per current implementation, even "changes_requested" transitions via
    // PLAN_REVIEW_APPROVED (both branches record the same event) rather than
    // PLAN_REVIEW_CHANGES_REQUESTED -- the human stays in control instead of
    // auto-chaining into plan revision.
    const eventTypes = eventRepo.create.mock.calls.map((c: unknown[]) => (c[0] as { eventType: string }).eventType);
    expect(eventTypes).toEqual([RunEvent.RE_REVIEW_REQUESTED, RunEvent.PLAN_REVIEW_APPROVED]);
    expect(planReviserAgent.run).not.toHaveBeenCalled();
    expect(result.state).toBe(RunState.AwaitingPlanApproval);
  });

  it("forwards an operator note to the plan reviewer agent and into the recorded event payload", async () => {
    const run = makeRun({ state: RunState.AwaitingPlanApproval });
    const { deps, planReviewerAgent, eventRepo } = buildDeps(run);
    planReviewerAgent.run.mockResolvedValue({ overallVerdict: "approved", summary: "OK", findings: [] });
    const svc = new OrchestratorService(deps as never);

    await svc.runManualReReview("run-1", { note: "Double-check auth flow" });

    expect(planReviewerAgent.run).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      "run-1",
      { operatorNote: "Double-check auth flow" },
    );
    const firstEventPayload = (eventRepo.create.mock.calls[0][0] as { payloadJson: Record<string, unknown> }).payloadJson;
    expect(firstEventPayload).toMatchObject({ trigger: "re-review", note: "Double-check auth flow" });
  });
});

describe("OrchestratorService.runManualPlanRevision", () => {
  it("approved verdict: transitions to PLAN_REVIEW_APPROVED without invoking the plan reviser", async () => {
    const run = makeRun({ state: RunState.AwaitingPlanApproval });
    const { deps, planReviewerAgent, planReviserAgent, eventRepo } = buildDeps(run);
    planReviewerAgent.run.mockResolvedValue({ overallVerdict: "approved", summary: "OK", findings: [] });
    const svc = new OrchestratorService(deps as never);

    const result = await svc.runManualPlanRevision("run-1");

    expect(planReviserAgent.run).not.toHaveBeenCalled();
    const eventTypes = eventRepo.create.mock.calls.map((c: unknown[]) => (c[0] as { eventType: string }).eventType);
    expect(eventTypes).toEqual([RunEvent.RE_REVIEW_REQUESTED, RunEvent.PLAN_REVIEW_APPROVED]);
    expect(result.state).toBe(RunState.AwaitingPlanApproval);
  });

  it("changes_requested verdict: chains into runPlanRevision, forwarding the operator note", async () => {
    const run = makeRun({ state: RunState.AwaitingPlanApproval });
    const { deps, planReviewerAgent, planReviserAgent, linearClient } = buildDeps(run);
    planReviewerAgent.run.mockResolvedValue({
      overallVerdict: "changes_requested",
      summary: "Needs work",
      findings: [{ id: "pf1", severity: "important", title: "X", details: "Y" }],
    });
    const svc = new OrchestratorService(deps as never);

    const result = await svc.runManualPlanRevision("run-1", { note: "Simplify step 2" });

    expect(planReviserAgent.run).toHaveBeenCalledWith(
      expect.anything(),
      undefined,
      expect.anything(),
      "run-1",
      { operatorNote: "Simplify step 2" },
    );
    const revisionComment = linearClient.postComment.mock.calls
      .map((c: unknown[]) => c[1] as string)
      .find((b: string) => b.includes("Plan Revision Dispositions"));
    expect(revisionComment).toBeDefined();
    expect(revisionComment).toContain("pf1");
    expect(result.state).toBe(RunState.AwaitingPlanApproval);
  });
});

describe("OrchestratorService.approveHumanReview", () => {
  function buildApproveHumanReviewDeps(run: Run, distillationAgent?: { run: ReturnType<typeof vi.fn> }) {
    const base = buildDeps(run);
    return {
      ...base,
      deps: { ...base.deps, distillationAgent },
    };
  }

  it("runs the distillation agent, then transitions to Done and posts the completion comment", async () => {
    const run = makeRun({ state: RunState.ReadyForHumanReview });
    const distillationAgent = { run: vi.fn().mockResolvedValue(undefined) };
    const { deps, linearClient } = buildApproveHumanReviewDeps(run, distillationAgent);
    const svc = new OrchestratorService(deps as never);

    const result = await svc.approveHumanReview("run-1");

    expect(distillationAgent.run).toHaveBeenCalledWith("run-1", expect.objectContaining({ id: "run-1" }));
    expect(linearClient.postComment).toHaveBeenCalledWith("LIN-1", "Human review approved. Run is **Done**.");
    expect(result.state).toBe(RunState.Done);
  });

  it("swallows a distillation agent failure (best-effort) and still completes the run", async () => {
    const run = makeRun({ state: RunState.ReadyForHumanReview });
    const distillationAgent = { run: vi.fn().mockRejectedValue(new Error("distillation boom")) };
    const { deps, logger } = buildApproveHumanReviewDeps(run, distillationAgent);
    const svc = new OrchestratorService(deps as never);

    const result = await svc.approveHumanReview("run-1");

    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ runId: "run-1", error: "distillation boom" }),
      expect.stringContaining("Distillation agent failed"),
    );
    expect(result.state).toBe(RunState.Done);
  });

  it("completes the run normally when no distillation agent is configured", async () => {
    const run = makeRun({ state: RunState.ReadyForHumanReview });
    const { deps } = buildApproveHumanReviewDeps(run, undefined);
    const svc = new OrchestratorService(deps as never);

    const result = await svc.approveHumanReview("run-1");

    expect(result.state).toBe(RunState.Done);
  });
});
