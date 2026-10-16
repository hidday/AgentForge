import { describe, it, expect, vi } from "vitest";
import { OrchestratorService } from "../../src/orchestrator/orchestratorService.js";
import { RunState } from "../../src/domain/runState.js";
import { RunEvent } from "../../src/domain/runEvent.js";
import type { Run, Artifact } from "../../src/domain/types.js";
import type { Plan } from "../../src/schemas/plan.js";

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

function makeArtifact(type: string, version: number, payloadJson: unknown): Artifact {
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
      branchName: "ai/run-1",
      labels: [],
      priority: 0,
    }),
    postComment: vi.fn().mockResolvedValue(undefined),
    getRelatedContext: vi.fn().mockResolvedValue({ blockers: [] }),
  };

  const githubClient = {
    getPRDiff: vi.fn(),
    getDefaultBranch: vi.fn().mockResolvedValue("main"),
  };

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
    linearClient,
    planReviewerAgent,
    planReviserAgent,
    gitService,
  };
}

describe("OrchestratorService.runManualReReview", () => {
  it("records a RE_REVIEW_REQUESTED event with trigger+note, then returns to AwaitingPlanApproval on approved verdict", async () => {
    const { deps, runRepo, artifactRepo, eventRepo, planReviewerAgent } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    const run = makeRun({ state: RunState.AwaitingPlanApproval });
    const plan = makePlan();

    runRepo.findById.mockResolvedValue(run);
    runRepo.updateState
      .mockResolvedValueOnce(makeRun({ state: RunState.PlanReview })) // RE_REVIEW_REQUESTED
      .mockResolvedValueOnce(makeRun({ state: RunState.AwaitingPlanApproval })); // PLAN_REVIEW_APPROVED
    artifactRepo.findLatestByType.mockImplementation((_: string, type: string) =>
      type === "Plan" ? Promise.resolve(makeArtifact("Plan", 1, plan)) : Promise.resolve(null),
    );
    planReviewerAgent.run.mockResolvedValue({ overallVerdict: "approved", summary: "ok", findings: [] });

    const result = await svc.runManualReReview("run-1", { note: "please double-check" });

    const reReviewEvent = eventRepo.create.mock.calls.find(
      (c: unknown[]) => (c[0] as { eventType: string }).eventType === RunEvent.RE_REVIEW_REQUESTED,
    )?.[0] as { payloadJson: { trigger: string; note: string } };
    expect(reReviewEvent.payloadJson).toEqual({
      from: RunState.AwaitingPlanApproval,
      to: RunState.PlanReview,
      trigger: "re-review",
      note: "please double-check",
    });
    expect(planReviewerAgent.run).toHaveBeenCalledWith(plan, expect.anything(), "run-1", {
      operatorNote: "please double-check",
    });
    expect(result.state).toBe(RunState.AwaitingPlanApproval);
  });

  it("still returns to AwaitingPlanApproval (never auto-chains into revision) even when the reviewer requests changes", async () => {
    const { deps, runRepo, artifactRepo, planReviewerAgent, eventRepo } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    const run = makeRun({ state: RunState.AwaitingPlanApproval });
    const plan = makePlan();

    runRepo.findById.mockResolvedValue(run);
    runRepo.updateState
      .mockResolvedValueOnce(makeRun({ state: RunState.PlanReview }))
      .mockResolvedValueOnce(makeRun({ state: RunState.AwaitingPlanApproval }));
    artifactRepo.findLatestByType.mockImplementation((_: string, type: string) =>
      type === "Plan" ? Promise.resolve(makeArtifact("Plan", 1, plan)) : Promise.resolve(null),
    );
    planReviewerAgent.run.mockResolvedValue({
      overallVerdict: "changes_requested",
      summary: "needs work",
      findings: [{ id: "f1", severity: "important", title: "t", details: "d" }],
    });

    const result = await svc.runManualReReview("run-1");

    expect(result.state).toBe(RunState.AwaitingPlanApproval);
    // Both the approved and changes_requested branches record the SAME event
    // (PLAN_REVIEW_APPROVED) -- a deliberate quirk documented in the source.
    const eventTypes = eventRepo.create.mock.calls.map((c: unknown[]) => (c[0] as { eventType: string }).eventType);
    expect(eventTypes).toContain(RunEvent.PLAN_REVIEW_APPROVED);
    expect(eventTypes).not.toContain(RunEvent.PLAN_REVIEW_CHANGES_REQUESTED);
  });

  it("records RE_REVIEW_REQUESTED without a note when opts is omitted", async () => {
    const { deps, runRepo, artifactRepo, eventRepo, planReviewerAgent } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    const run = makeRun({ state: RunState.AwaitingPlanApproval });
    const plan = makePlan();

    runRepo.findById.mockResolvedValue(run);
    runRepo.updateState
      .mockResolvedValueOnce(makeRun({ state: RunState.PlanReview }))
      .mockResolvedValueOnce(makeRun({ state: RunState.AwaitingPlanApproval }));
    artifactRepo.findLatestByType.mockImplementation((_: string, type: string) =>
      type === "Plan" ? Promise.resolve(makeArtifact("Plan", 1, plan)) : Promise.resolve(null),
    );
    planReviewerAgent.run.mockResolvedValue({ overallVerdict: "approved", summary: "ok", findings: [] });

    await svc.runManualReReview("run-1");

    const reReviewEvent = eventRepo.create.mock.calls.find(
      (c: unknown[]) => (c[0] as { eventType: string }).eventType === RunEvent.RE_REVIEW_REQUESTED,
    )?.[0] as { payloadJson: Record<string, unknown> };
    expect(reReviewEvent.payloadJson).not.toHaveProperty("note");
    expect(planReviewerAgent.run).toHaveBeenCalledWith(plan, expect.anything(), "run-1", undefined);
  });
});

describe("OrchestratorService.runManualPlanRevision", () => {
  it("transitions straight to AwaitingPlanApproval without revising when the reviewer approves", async () => {
    const { deps, runRepo, artifactRepo, planReviewerAgent, planReviserAgent } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    const run = makeRun({ state: RunState.AwaitingPlanApproval });
    const plan = makePlan();

    runRepo.findById.mockResolvedValue(run);
    runRepo.updateState
      .mockResolvedValueOnce(makeRun({ state: RunState.PlanReview }))
      .mockResolvedValueOnce(makeRun({ state: RunState.AwaitingPlanApproval }));
    artifactRepo.findLatestByType.mockImplementation((_: string, type: string) =>
      type === "Plan" ? Promise.resolve(makeArtifact("Plan", 1, plan)) : Promise.resolve(null),
    );
    planReviewerAgent.run.mockResolvedValue({ overallVerdict: "approved", summary: "ok", findings: [] });

    const result = await svc.runManualPlanRevision("run-1");

    expect(planReviserAgent.run).not.toHaveBeenCalled();
    expect(result.state).toBe(RunState.AwaitingPlanApproval);
  });

  it("delegates to runPlanRevision with the operator note when the reviewer requests changes", async () => {
    const { deps, runRepo, artifactRepo, planReviewerAgent, planReviserAgent, linearClient } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    const run = makeRun({ state: RunState.AwaitingPlanApproval, planVersion: 1 });
    const plan = makePlan();
    const planReview = { overallVerdict: "changes_requested" as const, summary: "needs work", findings: [] };
    const revisedPlan = { ...plan, planVersion: 2 };

    runRepo.findById
      .mockResolvedValueOnce(run)
      .mockResolvedValue(makeRun({ state: RunState.PlanRevision, planVersion: 1 }));
    runRepo.updateState
      .mockResolvedValueOnce(makeRun({ state: RunState.PlanReview })) // RE_REVIEW_REQUESTED
      .mockResolvedValueOnce(makeRun({ state: RunState.PlanRevision })) // PLAN_REVIEW_CHANGES_REQUESTED
      .mockResolvedValueOnce(makeRun({ state: RunState.AwaitingPlanApproval, planVersion: 2 })); // PLAN_REVISED
    runRepo.update.mockResolvedValue(makeRun({ state: RunState.PlanRevision, planVersion: 2 }));
    artifactRepo.findLatestByType.mockImplementation((_: string, type: string) => {
      if (type === "Plan") return Promise.resolve(makeArtifact("Plan", 1, plan));
      if (type === "PlanReview") return Promise.resolve(makeArtifact("PlanReview", 1, planReview));
      return Promise.resolve(null);
    });
    planReviewerAgent.run.mockResolvedValue(planReview);
    planReviserAgent.run.mockResolvedValue({
      revision: { dispositions: [{ findingId: "f1", status: "accepted", rationale: "ok" }] },
      revisedPlan,
    });

    const result = await svc.runManualPlanRevision("run-1", { note: "simplify step 1" });

    expect(planReviserAgent.run).toHaveBeenCalledWith(plan, planReview, expect.anything(), "run-1", {
      operatorNote: "simplify step 1",
    });
    expect(result.state).toBe(RunState.AwaitingPlanApproval);
    expect(linearClient.postComment).toHaveBeenCalledWith(
      run.linearIssueId,
      expect.stringContaining("Plan Revision Dispositions"),
    );
  });
});

describe("OrchestratorService.approveHumanReview", () => {
  it("runs the distillation agent before transitioning to Done, and cleans up the worktree", async () => {
    const distillationAgent = { run: vi.fn().mockResolvedValue(undefined) };
    const { deps, runRepo, linearClient, gitService } = buildDeps({ distillationAgent });
    const svc = new OrchestratorService(deps as never);

    const run = makeRun({ state: RunState.ReadyForHumanReview, workingDirectory: "/tmp/worktree" });
    runRepo.findById.mockResolvedValue(run);
    runRepo.updateState.mockResolvedValue(makeRun({ state: RunState.Done }));
    gitService.resolveMainRepoPath.mockReturnValue("/tmp/main-repo"); // differs -> real worktree

    const result = await svc.approveHumanReview("run-1");

    expect(distillationAgent.run).toHaveBeenCalledWith("run-1", run);
    expect(distillationAgent.run.mock.invocationCallOrder[0]).toBeLessThan(
      (runRepo.updateState as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0],
    );
    expect(linearClient.postComment).toHaveBeenCalledWith(run.linearIssueId, expect.stringContaining("Done"));
    expect(gitService.removeWorktree).toHaveBeenCalledWith("/tmp/main-repo", "/tmp/worktree");
    expect(result.state).toBe(RunState.Done);
  });

  it("does not clean up the worktree when the run's workingDirectory IS the main repo path", async () => {
    const { deps, runRepo, gitService } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    const run = makeRun({ state: RunState.ReadyForHumanReview, workingDirectory: "/repo/main" });
    runRepo.findById.mockResolvedValue(run);
    runRepo.updateState.mockResolvedValue(makeRun({ state: RunState.Done, workingDirectory: "/repo/main" }));
    gitService.resolveMainRepoPath.mockReturnValue("/repo/main"); // same -> no worktree to clean

    await svc.approveHumanReview("run-1");

    expect(gitService.removeWorktree).not.toHaveBeenCalled();
  });

  it("swallows a distillation agent failure (logs a warning) and still completes the run", async () => {
    const distillationAgent = { run: vi.fn().mockRejectedValue(new Error("distillation boom")) };
    const { deps, runRepo, linearClient } = buildDeps({ distillationAgent });
    const svc = new OrchestratorService(deps as never);

    const run = makeRun({ state: RunState.ReadyForHumanReview });
    runRepo.findById.mockResolvedValue(run);
    runRepo.updateState.mockResolvedValue(makeRun({ state: RunState.Done }));

    const result = await svc.approveHumanReview("run-1");

    expect(deps.logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ runId: "run-1", error: "distillation boom" }),
      "Distillation agent failed (best-effort, ignoring)",
    );
    expect(linearClient.postComment).toHaveBeenCalled();
    expect(result.state).toBe(RunState.Done);
  });

  it("skips distillation entirely when no distillationAgent dependency is configured", async () => {
    const { deps, runRepo } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    const run = makeRun({ state: RunState.ReadyForHumanReview });
    runRepo.findById.mockResolvedValue(run);
    runRepo.updateState.mockResolvedValue(makeRun({ state: RunState.Done }));

    const result = await svc.approveHumanReview("run-1");

    expect(result.state).toBe(RunState.Done);
    expect(deps.logger.warn).not.toHaveBeenCalledWith(
      expect.anything(),
      "Distillation agent failed (best-effort, ignoring)",
    );
  });

  it("updates skill success metrics for all skills injected across the run's planning passes", async () => {
    const agentSkillRepo = {
      incrementSuccess: vi.fn().mockResolvedValue({
        id: "skill-1",
        successCount: 1,
        failureCount: 0,
        utilityScore: 0.5,
      }),
      archiveIfLowUtility: vi.fn().mockResolvedValue(undefined),
    };
    const { deps, runRepo, eventRepo } = buildDeps({ agentSkillRepo });
    const svc = new OrchestratorService(deps as never);

    const run = makeRun({ state: RunState.ReadyForHumanReview });
    runRepo.findById.mockResolvedValue(run);
    runRepo.updateState.mockResolvedValue(makeRun({ state: RunState.Done }));
    eventRepo.findByRunId.mockResolvedValue([
      {
        id: "e1",
        runId: "run-1",
        eventType: "SKILL_INJECTION",
        source: "orchestrator",
        payloadJson: { skillIds: ["skill-1", "skill-2"] },
        createdAt: new Date(),
      },
      {
        id: "e2",
        runId: "run-1",
        eventType: "SKILL_INJECTION",
        source: "orchestrator",
        payloadJson: { skillIds: ["skill-2"] }, // duplicate across passes -- deduped
        createdAt: new Date(),
      },
    ]);

    await svc.approveHumanReview("run-1");

    expect(agentSkillRepo.incrementSuccess).toHaveBeenCalledTimes(2);
    expect(agentSkillRepo.incrementSuccess).toHaveBeenCalledWith("skill-1");
    expect(agentSkillRepo.incrementSuccess).toHaveBeenCalledWith("skill-2");
    expect(agentSkillRepo.archiveIfLowUtility).toHaveBeenCalledTimes(2);
  });
});
