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
    branchName: null,
    prNumber: null,
    state: RunState.PlanReview,
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

function makePlanReview(overrides: Partial<PlanReview> = {}): PlanReview {
  return {
    reviewId: "pr-1",
    summary: "Looks fine",
    findings: [],
    overallVerdict: "approved",
    ...overrides,
  };
}

function makeArtifact<T>(type: Artifact["type"], payload: T, overrides: Partial<Artifact> = {}): Artifact {
  return {
    id: `artifact-${type}`,
    runId: "run-1",
    type,
    version: 1,
    payloadJson: payload as unknown,
    rawText: JSON.stringify(payload),
    createdAt: new Date(),
    ...overrides,
  };
}

const defaultRepoEntry = {
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
};

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
    create: vi.fn().mockResolvedValue({}),
    findByRunId: vi.fn().mockResolvedValue([]),
  };

  const linearClient = {
    getIssue: vi.fn().mockResolvedValue({
      id: "LIN-1",
      identifier: "LIN-1",
      title: "Test issue",
      description: "Test description",
      url: "https://linear.app/x",
      branchName: "ai/lin-1",
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
    resolveForIssue: vi.fn().mockReturnValue(defaultRepoEntry),
    resolveWorkingDirectory: vi.fn().mockReturnValue("/repos/test-repo"),
    validateWorkingDirectory: vi.fn(),
    getRepoByName: vi.fn().mockReturnValue(defaultRepoEntry),
    getDefaultRepo: vi.fn().mockReturnValue(defaultRepoEntry),
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
  const distillationAgent = { run: vi.fn().mockResolvedValue(undefined) };

  const gitService = {
    setupRunWorktree: vi.fn().mockResolvedValue({ worktreePath: "/tmp/worktree", branchName: "ai/run-1" }),
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

  const agentSkillRepo = {
    findTopKByRelevance: vi.fn().mockResolvedValue([]),
    incrementSuccess: vi.fn(),
    incrementFailure: vi.fn(),
    archiveIfLowUtility: vi.fn(),
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
    planReviewerAgent,
    planReviserAgent,
    distillationAgent,
    agentSkillRepo,
    gitService,
    logger,
    dashboardEmitter,
  };
}

describe("OrchestratorService.runPlanReview", () => {
  it("throws when no plan artifact exists", async () => {
    const { deps, runRepo, artifactRepo } = buildDeps();
    const svc = new OrchestratorService(deps as never);
    runRepo.findById.mockResolvedValue(makeRun());
    artifactRepo.findLatestByType.mockResolvedValue(null);

    await expect(svc.runPlanReview("run-1")).rejects.toThrow("No plan artifact found for run run-1");
  });

  it("approved verdict: transitions to AwaitingPlanApproval and posts the approved plan comment", async () => {
    const { deps, runRepo, artifactRepo, planReviewerAgent, linearClient } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    runRepo.findById.mockResolvedValue(makeRun({ state: RunState.PlanReview }));
    const plan = makePlan();
    artifactRepo.findLatestByType.mockImplementation((_r: string, type: string) =>
      type === "Plan" ? Promise.resolve(makeArtifact("Plan", plan)) : Promise.resolve(null),
    );
    planReviewerAgent.run.mockResolvedValue(makePlanReview({ overallVerdict: "approved" }));

    const afterApproved = makeRun({ state: RunState.AwaitingPlanApproval });
    runRepo.updateState.mockResolvedValue(afterApproved);

    const runPlanRevisionSpy = vi.spyOn(svc, "runPlanRevision");

    const result = await svc.runPlanReview("run-1");

    expect(linearClient.postComment).toHaveBeenCalledWith(
      "LIN-1",
      expect.stringContaining("AI plan review: approved"),
    );
    expect(runPlanRevisionSpy).not.toHaveBeenCalled();
    expect(result).toBe(afterApproved);
  });

  it("changes_requested verdict: transitions to PlanRevision, posts findings, and triggers revision", async () => {
    const { deps, runRepo, artifactRepo, planReviewerAgent, linearClient } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    runRepo.findById.mockResolvedValue(makeRun({ state: RunState.PlanReview }));
    const plan = makePlan();
    artifactRepo.findLatestByType.mockImplementation((_r: string, type: string) =>
      type === "Plan" ? Promise.resolve(makeArtifact("Plan", plan)) : Promise.resolve(null),
    );
    const review = makePlanReview({
      overallVerdict: "changes_requested",
      findings: [{ id: "f1", severity: "blocker", type: "risk", title: "Bad", details: "very bad" }],
    });
    planReviewerAgent.run.mockResolvedValue(review);
    runRepo.updateState.mockResolvedValue(makeRun({ state: RunState.PlanRevision }));

    const revisedRun = makeRun({ state: RunState.AwaitingPlanApproval });
    const runPlanRevisionSpy = vi.spyOn(svc, "runPlanRevision").mockResolvedValue(revisedRun);

    const result = await svc.runPlanReview("run-1");

    expect(linearClient.postComment).toHaveBeenCalledWith(
      "LIN-1",
      expect.stringContaining("Changes Requested"),
    );
    expect(runPlanRevisionSpy).toHaveBeenCalledWith("run-1");
    expect(result).toBe(revisedRun);
  });
});

describe("OrchestratorService.runPlanRevision", () => {
  it("revises the plan, bumps the plan version, transitions, and posts a combined comment", async () => {
    const { deps, runRepo, artifactRepo, planReviserAgent, linearClient } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    runRepo.findById.mockResolvedValue(makeRun({ state: RunState.PlanRevision }));
    const plan = makePlan({ planVersion: 1 });
    const planReview = makePlanReview({ overallVerdict: "changes_requested" });
    artifactRepo.findLatestByType.mockImplementation((_r: string, type: string) => {
      if (type === "Plan") return Promise.resolve(makeArtifact("Plan", plan));
      if (type === "PlanReview") return Promise.resolve(makeArtifact("PlanReview", planReview));
      return Promise.resolve(null);
    });

    const revisedPlan = makePlan({ planVersion: 2 });
    planReviserAgent.run.mockResolvedValue({
      revision: { dispositions: [{ findingId: "f1", status: "fixed", rationale: "addressed" }] },
      revisedPlan,
    });

    runRepo.update.mockResolvedValue(makeRun({ state: RunState.PlanRevision, planVersion: 2 }));
    const afterRevised = makeRun({ state: RunState.AwaitingPlanApproval, planVersion: 2 });
    runRepo.updateState.mockResolvedValue(afterRevised);

    const result = await svc.runPlanRevision("run-1", { note: "please double-check" });

    expect(planReviserAgent.run).toHaveBeenCalledWith(plan, planReview, expect.anything(), "run-1", {
      operatorNote: "please double-check",
    });
    expect(runRepo.update).toHaveBeenCalledWith("run-1", { planVersion: 2 });
    expect(linearClient.postComment).toHaveBeenCalledWith(
      "LIN-1",
      expect.stringContaining("Plan Revision Dispositions"),
    );
    expect(result).toBe(afterRevised);
  });

  it("passes undefined revision options when no note is given", async () => {
    const { deps, runRepo, artifactRepo, planReviserAgent } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    runRepo.findById.mockResolvedValue(makeRun({ state: RunState.PlanRevision }));
    const plan = makePlan({ planVersion: 1 });
    const planReview = makePlanReview({ overallVerdict: "changes_requested" });
    artifactRepo.findLatestByType.mockImplementation((_r: string, type: string) => {
      if (type === "Plan") return Promise.resolve(makeArtifact("Plan", plan));
      if (type === "PlanReview") return Promise.resolve(makeArtifact("PlanReview", planReview));
      return Promise.resolve(null);
    });
    planReviserAgent.run.mockResolvedValue({
      revision: { dispositions: [] },
      revisedPlan: makePlan({ planVersion: 2 }),
    });
    runRepo.update.mockResolvedValue(makeRun({ state: RunState.PlanRevision, planVersion: 2 }));
    runRepo.updateState.mockResolvedValue(makeRun({ state: RunState.AwaitingPlanApproval, planVersion: 2 }));

    await svc.runPlanRevision("run-1");

    expect(planReviserAgent.run).toHaveBeenCalledWith(plan, planReview, expect.anything(), "run-1", undefined);
  });
});

describe("OrchestratorService.runManualReReview", () => {
  it("approved verdict: transitions back to AwaitingPlanApproval via PLAN_REVIEW_APPROVED", async () => {
    const { deps, runRepo, artifactRepo, planReviewerAgent, eventRepo } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    runRepo.findById.mockResolvedValue(makeRun({ state: RunState.AwaitingPlanApproval }));
    const plan = makePlan();
    artifactRepo.findLatestByType.mockImplementation((_r: string, type: string) =>
      type === "Plan" ? Promise.resolve(makeArtifact("Plan", plan)) : Promise.resolve(null),
    );
    planReviewerAgent.run.mockResolvedValue(makePlanReview({ overallVerdict: "approved" }));

    // Two transitions occur: RE_REVIEW_REQUESTED (AwaitingPlanApproval -> PlanReview),
    // then PLAN_REVIEW_APPROVED (PlanReview -> AwaitingPlanApproval).
    runRepo.updateState
      .mockResolvedValueOnce(makeRun({ state: RunState.PlanReview }))
      .mockResolvedValueOnce(makeRun({ state: RunState.AwaitingPlanApproval }));

    const result = await svc.runManualReReview("run-1", { note: "quick check" });

    expect(eventRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: RunEvent.RE_REVIEW_REQUESTED,
        payloadJson: expect.objectContaining({ trigger: "re-review", note: "quick check" }),
      }),
    );
    expect(planReviewerAgent.run).toHaveBeenCalledWith(plan, expect.anything(), "run-1", {
      operatorNote: "quick check",
    });
    expect(result.state).toBe(RunState.AwaitingPlanApproval);
  });

  it("changes_requested verdict: still returns to AwaitingPlanApproval (does not auto-chain into revision)", async () => {
    const { deps, runRepo, artifactRepo, planReviewerAgent, eventRepo } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    runRepo.findById.mockResolvedValue(makeRun({ state: RunState.AwaitingPlanApproval }));
    const plan = makePlan();
    artifactRepo.findLatestByType.mockImplementation((_r: string, type: string) =>
      type === "Plan" ? Promise.resolve(makeArtifact("Plan", plan)) : Promise.resolve(null),
    );
    planReviewerAgent.run.mockResolvedValue(
      makePlanReview({ overallVerdict: "changes_requested", findings: [{ id: "f1", severity: "nit", type: "x", title: "t", details: "d" }] }),
    );

    runRepo.updateState
      .mockResolvedValueOnce(makeRun({ state: RunState.PlanReview }))
      .mockResolvedValueOnce(makeRun({ state: RunState.AwaitingPlanApproval }));

    const runPlanRevisionSpy = vi.spyOn(svc, "runPlanRevision");

    const result = await svc.runManualReReview("run-1");

    expect(eventRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ payloadJson: expect.objectContaining({ trigger: "re-review" }) }),
    );
    expect(runPlanRevisionSpy).not.toHaveBeenCalled();
    expect(result.state).toBe(RunState.AwaitingPlanApproval);
  });

  it("throws when no plan artifact exists", async () => {
    const { deps, runRepo, artifactRepo } = buildDeps();
    const svc = new OrchestratorService(deps as never);
    runRepo.findById.mockResolvedValue(makeRun({ state: RunState.AwaitingPlanApproval }));
    runRepo.updateState.mockResolvedValue(makeRun({ state: RunState.PlanReview }));
    artifactRepo.findLatestByType.mockResolvedValue(null);

    await expect(svc.runManualReReview("run-1")).rejects.toThrow("No plan artifact found for run run-1");
  });
});

describe("OrchestratorService.runManualPlanRevision", () => {
  it("approved verdict: transitions to AwaitingPlanApproval without calling runPlanRevision", async () => {
    const { deps, runRepo, artifactRepo, planReviewerAgent } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    runRepo.findById.mockResolvedValue(makeRun({ state: RunState.AwaitingPlanApproval }));
    const plan = makePlan();
    artifactRepo.findLatestByType.mockImplementation((_r: string, type: string) =>
      type === "Plan" ? Promise.resolve(makeArtifact("Plan", plan)) : Promise.resolve(null),
    );
    planReviewerAgent.run.mockResolvedValue(makePlanReview({ overallVerdict: "approved" }));

    runRepo.updateState
      .mockResolvedValueOnce(makeRun({ state: RunState.PlanReview }))
      .mockResolvedValueOnce(makeRun({ state: RunState.AwaitingPlanApproval }));

    const runPlanRevisionSpy = vi.spyOn(svc, "runPlanRevision");

    const result = await svc.runManualPlanRevision("run-1");

    expect(runPlanRevisionSpy).not.toHaveBeenCalled();
    expect(result.state).toBe(RunState.AwaitingPlanApproval);
  });

  it("changes_requested verdict: transitions to PlanRevision and delegates to runPlanRevision with the note", async () => {
    const { deps, runRepo, artifactRepo, planReviewerAgent, eventRepo } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    runRepo.findById.mockResolvedValue(makeRun({ state: RunState.AwaitingPlanApproval }));
    const plan = makePlan();
    artifactRepo.findLatestByType.mockImplementation((_r: string, type: string) =>
      type === "Plan" ? Promise.resolve(makeArtifact("Plan", plan)) : Promise.resolve(null),
    );
    planReviewerAgent.run.mockResolvedValue(
      makePlanReview({ overallVerdict: "changes_requested", findings: [{ id: "f1", severity: "important", type: "x", title: "t", details: "d" }] }),
    );

    runRepo.updateState.mockResolvedValueOnce(makeRun({ state: RunState.PlanReview }));

    const revisedRun = makeRun({ state: RunState.AwaitingPlanApproval, planVersion: 2 });
    const runPlanRevisionSpy = vi.spyOn(svc, "runPlanRevision").mockResolvedValue(revisedRun);

    const result = await svc.runManualPlanRevision("run-1", { note: "fix the risky bit" });

    expect(eventRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: RunEvent.RE_REVIEW_REQUESTED,
        payloadJson: expect.objectContaining({ trigger: "revise", note: "fix the risky bit" }),
      }),
    );
    expect(runPlanRevisionSpy).toHaveBeenCalledWith("run-1", { note: "fix the risky bit" });
    expect(result).toBe(revisedRun);
  });

  it("throws when no plan artifact exists", async () => {
    const { deps, runRepo, artifactRepo } = buildDeps();
    const svc = new OrchestratorService(deps as never);
    runRepo.findById.mockResolvedValue(makeRun({ state: RunState.AwaitingPlanApproval }));
    runRepo.updateState.mockResolvedValue(makeRun({ state: RunState.PlanReview }));
    artifactRepo.findLatestByType.mockResolvedValue(null);

    await expect(svc.runManualPlanRevision("run-1")).rejects.toThrow("No plan artifact found for run run-1");
  });
});

describe("OrchestratorService.approveHumanReview", () => {
  it("runs distillation, transitions to Done, posts the completion comment, cleans up the worktree, and updates skill metrics", async () => {
    const { deps, runRepo, distillationAgent, linearClient, gitService, agentSkillRepo, eventRepo } =
      buildDeps();
    const svc = new OrchestratorService(deps as never);

    const run = makeRun({
      id: "run-1",
      state: RunState.ReadyForHumanReview,
      workingDirectory: "/repo/worktrees/run-1",
    });
    runRepo.findById.mockResolvedValue(run);

    const doneRun = makeRun({ id: "run-1", state: RunState.Done, workingDirectory: "/repo/worktrees/run-1" });
    runRepo.updateState.mockResolvedValue(doneRun);

    // Worktree cleanup path: mainRepoPath differs from run.workingDirectory.
    gitService.resolveMainRepoPath.mockReturnValue("/repo");

    // Skill metrics path: one prior SKILL_INJECTION event with two distinct skill ids.
    eventRepo.findByRunId.mockResolvedValue([
      {
        id: "e1",
        runId: "run-1",
        eventType: "SKILL_INJECTION",
        source: "orchestrator",
        payloadJson: { skillIds: ["skill-a", "skill-b"] },
        createdAt: new Date(),
      },
    ]);
    agentSkillRepo.incrementSuccess.mockResolvedValue({ id: "skill-a", utilityScore: 0.5 });
    agentSkillRepo.archiveIfLowUtility.mockResolvedValue(undefined);

    const result = await svc.approveHumanReview("run-1");

    expect(distillationAgent.run).toHaveBeenCalledWith("run-1", run);
    expect(linearClient.postComment).toHaveBeenCalledWith(
      "LIN-1",
      "Human review approved. Run is **Done**.",
    );
    expect(gitService.removeWorktree).toHaveBeenCalledWith("/repo", "/repo/worktrees/run-1");
    expect(agentSkillRepo.incrementSuccess).toHaveBeenCalledWith("skill-a");
    expect(agentSkillRepo.incrementSuccess).toHaveBeenCalledWith("skill-b");
    expect(agentSkillRepo.archiveIfLowUtility).toHaveBeenCalledTimes(2);
    expect(result).toBe(doneRun);
  });

  it("continues (logs a warning) when the distillation agent throws", async () => {
    const { deps, runRepo, distillationAgent, logger } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    const run = makeRun({ id: "run-1", state: RunState.ReadyForHumanReview });
    runRepo.findById.mockResolvedValue(run);
    distillationAgent.run.mockRejectedValue(new Error("distillation exploded"));
    runRepo.updateState.mockResolvedValue(makeRun({ id: "run-1", state: RunState.Done }));

    const result = await svc.approveHumanReview("run-1");

    const warnCall = (logger.warn as ReturnType<typeof vi.fn>).mock.calls.find(
      (call: unknown[]) =>
        typeof call[1] === "string" && (call[1] as string).includes("Distillation agent failed"),
    );
    expect(warnCall).toBeDefined();
    expect(result.state).toBe(RunState.Done);
  });

  it("skips distillation entirely when the distillationAgent dependency is undefined", async () => {
    const { deps, runRepo } = buildDeps({ distillationAgent: undefined });
    const svc = new OrchestratorService(deps as never);

    const run = makeRun({ id: "run-1", state: RunState.ReadyForHumanReview });
    runRepo.findById.mockResolvedValue(run);
    runRepo.updateState.mockResolvedValue(makeRun({ id: "run-1", state: RunState.Done }));

    const result = await svc.approveHumanReview("run-1");

    expect(result.state).toBe(RunState.Done);
  });

  it("swallows an error from a single skill metric update and continues with the rest", async () => {
    const { deps, runRepo, eventRepo, agentSkillRepo, logger } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    const run = makeRun({ id: "run-1", state: RunState.ReadyForHumanReview });
    runRepo.findById.mockResolvedValue(run);
    runRepo.updateState.mockResolvedValue(makeRun({ id: "run-1", state: RunState.Done }));

    eventRepo.findByRunId.mockResolvedValue([
      {
        id: "e1",
        runId: "run-1",
        eventType: "SKILL_INJECTION",
        source: "orchestrator",
        payloadJson: { skillIds: ["skill-a"] },
        createdAt: new Date(),
      },
    ]);
    agentSkillRepo.incrementSuccess.mockRejectedValue(new Error("db down"));

    await svc.approveHumanReview("run-1");

    const warnCall = (logger.warn as ReturnType<typeof vi.fn>).mock.calls.find(
      (call: unknown[]) =>
        typeof call[1] === "string" && (call[1] as string).includes("Failed to update skill metric"),
    );
    expect(warnCall).toBeDefined();
    expect(agentSkillRepo.archiveIfLowUtility).not.toHaveBeenCalled();
  });
});
