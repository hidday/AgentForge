import { describe, it, expect, vi } from "vitest";
import { OrchestratorService } from "../../src/orchestrator/orchestratorService.js";
import { RunState } from "../../src/domain/runState.js";
import { RunEvent } from "../../src/domain/runEvent.js";
import { StateTransitionError } from "../../src/utils/errors.js";
import type { Run, Artifact, RejectionContextPayload } from "../../src/domain/types.js";
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

function makeArtifact(overrides: Partial<Artifact> = {}): Artifact {
  return {
    id: "artifact-1",
    runId: "run-1",
    type: "Plan",
    version: 1,
    payloadJson: {},
    rawText: "{}",
    createdAt: new Date(),
    ...overrides,
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
      identifier: "ENG-1",
      title: "Test issue",
      description: "Test description",
      url: "https://linear.app/ENG-1",
      branchName: "ai/run-1",
      labels: [],
      priority: 0,
      project: "test-project",
    }),
    postComment: vi.fn().mockResolvedValue(undefined),
    getRelatedContext: vi.fn(),
  };

  const githubClient = { getPRDiff: vi.fn(), getDefaultBranch: vi.fn() };

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

  const plannerAgent = { run: vi.fn().mockResolvedValue(makePlan()) };
  const planReviewerAgent = { run: vi.fn().mockResolvedValue(makePlanReview()) };
  const planReviserAgent = {
    run: vi.fn().mockResolvedValue({
      revision: {
        dispositions: [
          { findingId: "f1", status: "accepted", rationale: "Fixed" },
        ],
      },
      revisedPlan: makePlan({ planVersion: 2 }),
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
    planReviserAgent,
  };
}

describe("OrchestratorService.runPlanning", () => {
  it("threads previousPlan, humanFeedback, humanAnswers, researchedAnswers, and planReviewFindings into the planner call, using planVersion+1", async () => {
    const { deps, runRepo, artifactRepo, plannerAgent } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    const run = makeRun({ id: "run-1", state: RunState.Planning, planVersion: 3 });
    runRepo.findById.mockResolvedValue(run);
    runRepo.update.mockResolvedValue({ ...run, planVersion: 4, plannerRuntime: "claude-code" });
    runRepo.updateState.mockResolvedValue(makeRun({ id: "run-1", state: RunState.PlanReview, planVersion: 4 }));

    const previousPlan = makePlan({ planVersion: 3 });
    const rejectionPayload: RejectionContextPayload = {
      planVersion: 3,
      feedback: "Use OAuth2",
      source: "api",
      mode: "iterate",
    };
    const humanAnswersPayload = { answers: [{ questionId: "q1", answer: "yes" }] };
    const researchedAnswersPayload = {
      summary: "s",
      answers: [{ questionId: "q1", question: "Q?", answer: "A", confidence: "high" as const }],
      completedAt: "2026-01-01T00:00:00Z",
    };
    const planReviewPayload = { summary: "review summary", findings: [] };

    artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
      switch (type) {
        case "RejectionContext":
          return Promise.resolve(makeArtifact({ type: "RejectionContext", version: 3, payloadJson: rejectionPayload }));
        case "Plan":
          return Promise.resolve(makeArtifact({ type: "Plan", version: 3, payloadJson: previousPlan }));
        case "HumanAnswers":
          return Promise.resolve(makeArtifact({ type: "HumanAnswers", version: 1, payloadJson: humanAnswersPayload }));
        case "ResearchedAnswers":
          return Promise.resolve(
            makeArtifact({ type: "ResearchedAnswers", version: 1, payloadJson: researchedAnswersPayload }),
          );
        case "PlanReview":
          return Promise.resolve(makeArtifact({ type: "PlanReview", version: 1, payloadJson: planReviewPayload }));
        default:
          return Promise.resolve(null);
      }
    });

    plannerAgent.run.mockResolvedValue(makePlan({ planVersion: 4 }));

    // Isolate runPlanning's own logic from runPlanReview's.
    vi.spyOn(svc, "runPlanReview").mockResolvedValue(makeRun({ id: "run-1", state: RunState.AwaitingPlanApproval }));

    await svc.runPlanning("run-1");

    expect(plannerAgent.run).toHaveBeenCalledWith(
      expect.anything(),
      "run-1",
      expect.objectContaining({
        planVersionOverride: 4,
        previousPlan,
        humanFeedback: { planVersion: 3, feedback: "Use OAuth2" },
        humanAnswers: [{ questionId: "q1", answer: "yes" }],
        researchedAnswers: researchedAnswersPayload.answers,
        planReviewFindings: { summary: "review summary", findings: [] },
      }),
    );
  });

  it("pauses for human clarification when the re-plan still has blocking open questions, without calling runPlanReview", async () => {
    const { deps, runRepo, artifactRepo, plannerAgent, eventRepo } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    const run = makeRun({ id: "run-1", state: RunState.Planning, planVersion: 1 });
    runRepo.findById.mockResolvedValue(run);
    runRepo.update.mockResolvedValue({ ...run, planVersion: 2 });
    runRepo.updateState
      .mockResolvedValueOnce(makeRun({ id: "run-1", state: RunState.PlanReview, planVersion: 2 }))
      .mockResolvedValueOnce(
        makeRun({ id: "run-1", state: RunState.HumanClarificationNeeded, planVersion: 2 }),
      );

    artifactRepo.findLatestByType.mockResolvedValue(null);

    plannerAgent.run.mockResolvedValue(
      makePlan({
        planVersion: 2,
        openQuestions: [{ id: "q1", question: "Which auth flow?", requiredForExecution: true }],
      }),
    );

    const reviewSpy = vi.spyOn(svc, "runPlanReview");

    const result = await svc.runPlanning("run-1");

    expect(reviewSpy).not.toHaveBeenCalled();
    expect(result.state).toBe(RunState.HumanClarificationNeeded);
    const eventTypes = eventRepo.create.mock.calls.map(
      (c: unknown[]) => (c[0] as { eventType: string }).eventType,
    );
    expect(eventTypes).toContain(RunEvent.NEEDS_HUMAN_CLARIFICATION);
  });

  it("delegates to runPlanReview when there are no blocking questions", async () => {
    const { deps, runRepo, artifactRepo, plannerAgent } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    const run = makeRun({ id: "run-1", state: RunState.Planning, planVersion: 1 });
    runRepo.findById.mockResolvedValue(run);
    runRepo.update.mockResolvedValue({ ...run, planVersion: 2 });
    runRepo.updateState.mockResolvedValue(makeRun({ id: "run-1", state: RunState.PlanReview, planVersion: 2 }));
    artifactRepo.findLatestByType.mockResolvedValue(null);
    plannerAgent.run.mockResolvedValue(makePlan({ planVersion: 2, openQuestions: [] }));

    const finalRun = makeRun({ id: "run-1", state: RunState.AwaitingPlanApproval, planVersion: 2 });
    const reviewSpy = vi.spyOn(svc, "runPlanReview").mockResolvedValue(finalRun);

    const result = await svc.runPlanning("run-1");

    expect(reviewSpy).toHaveBeenCalledWith("run-1");
    expect(result).toBe(finalRun);
  });
});

describe("OrchestratorService.buildTaskBundle (exercised via runPlanReview)", () => {
  it("falls back to String(err) when githubClient.getDefaultBranch or linearClient.getRelatedContext reject with a non-Error value", async () => {
    const { deps, runRepo, artifactRepo, planReviewerAgent } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    const run = makeRun({ id: "run-1", state: RunState.PlanReview, planVersion: 1 });
    runRepo.findById.mockResolvedValue(run);
    const plan = makePlan({ planVersion: 1 });
    artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) =>
      type === "Plan" ? Promise.resolve(makeArtifact({ type: "Plan", version: 1, payloadJson: plan })) : Promise.resolve(null),
    );
    planReviewerAgent.run.mockResolvedValue(makePlanReview({ overallVerdict: "approved" }));
    runRepo.updateState.mockResolvedValue(makeRun({ id: "run-1", state: RunState.AwaitingPlanApproval }));

    const logger = (deps as unknown as { logger: { warn: ReturnType<typeof vi.fn> } }).logger;
    const githubClient = (deps as unknown as { githubClient: { getDefaultBranch: ReturnType<typeof vi.fn> } })
      .githubClient;
    const linearClient = (deps as unknown as { linearClient: { getRelatedContext: ReturnType<typeof vi.fn> } })
      .linearClient;
    githubClient.getDefaultBranch.mockRejectedValue("rate limited");
    linearClient.getRelatedContext.mockRejectedValue("linear unavailable");

    await svc.runPlanReview("run-1");

    const branchWarn = logger.warn.mock.calls.find(
      (c: unknown[]) => typeof c[1] === "string" && c[1].includes("Failed to resolve default branch"),
    );
    expect(branchWarn).toBeDefined();
    expect((branchWarn![0] as { error: string }).error).toBe("rate limited");

    const relatedWarn = logger.warn.mock.calls.find(
      (c: unknown[]) => typeof c[1] === "string" && c[1].includes("Failed to fetch related Linear context"),
    );
    expect(relatedWarn).toBeDefined();
    expect((relatedWarn![0] as { error: string }).error).toBe("linear unavailable");
  });
});

describe("OrchestratorService.runPlanReview", () => {
  it("throws when no Plan artifact exists for the run", async () => {
    const { deps, runRepo, artifactRepo } = buildDeps();
    const svc = new OrchestratorService(deps as never);
    runRepo.findById.mockResolvedValue(makeRun({ state: RunState.PlanReview }));
    artifactRepo.findLatestByType.mockResolvedValue(null);

    await expect(svc.runPlanReview("run-1")).rejects.toThrow("No plan artifact found for run run-1");
  });

  it("approved verdict: transitions to PLAN_REVIEW_APPROVED and posts an 'approved' comment", async () => {
    const { deps, runRepo, artifactRepo, linearClient, planReviewerAgent, eventRepo } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    const run = makeRun({ id: "run-1", state: RunState.PlanReview, planVersion: 1 });
    runRepo.findById.mockResolvedValue(run);
    const plan = makePlan({ planVersion: 1, risks: ["Third-party API may rate-limit us"] });
    artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) =>
      type === "Plan" ? Promise.resolve(makeArtifact({ type: "Plan", version: 1, payloadJson: plan })) : Promise.resolve(null),
    );
    planReviewerAgent.run.mockResolvedValue(makePlanReview({ overallVerdict: "approved" }));
    runRepo.updateState.mockResolvedValue(makeRun({ id: "run-1", state: RunState.AwaitingPlanApproval }));

    const result = await svc.runPlanReview("run-1");

    const eventTypes = eventRepo.create.mock.calls.map(
      (c: unknown[]) => (c[0] as { eventType: string }).eventType,
    );
    expect(eventTypes).toContain(RunEvent.PLAN_REVIEW_APPROVED);
    expect(result.state).toBe(RunState.AwaitingPlanApproval);

    const comment = linearClient.postComment.mock.calls.find((c: unknown[]) =>
      String(c[1]).includes("AI plan review: approved"),
    );
    expect(comment).toBeDefined();
    expect(String(comment![1])).toContain("**Risks:**");
    expect(String(comment![1])).toContain("Third-party API may rate-limit us");
  });

  it("changes_requested verdict: transitions to PLAN_REVIEW_CHANGES_REQUESTED then delegates to runPlanRevision", async () => {
    const { deps, runRepo, artifactRepo, planReviewerAgent, eventRepo, linearClient } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    const run = makeRun({ id: "run-1", state: RunState.PlanReview, planVersion: 1 });
    runRepo.findById.mockResolvedValue(run);
    const plan = makePlan({ planVersion: 1 });
    artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) =>
      type === "Plan" ? Promise.resolve(makeArtifact({ type: "Plan", version: 1, payloadJson: plan })) : Promise.resolve(null),
    );
    planReviewerAgent.run.mockResolvedValue(
      makePlanReview({
        overallVerdict: "changes_requested",
        findings: [
          {
            id: "f1",
            severity: "important",
            type: "risk",
            title: "Missing tests",
            details: "Add tests",
            affectedStepId: "s1",
          },
          {
            id: "f2",
            severity: "nit",
            type: "style",
            title: "Naming nit",
            details: "Rename for clarity",
          },
        ],
      }),
    );
    runRepo.updateState.mockResolvedValue(makeRun({ id: "run-1", state: RunState.PlanRevision }));

    const revisedRun = makeRun({ id: "run-1", state: RunState.AwaitingPlanApproval, planVersion: 2 });
    const revisionSpy = vi.spyOn(svc, "runPlanRevision").mockResolvedValue(revisedRun);

    const result = await svc.runPlanReview("run-1");

    const eventTypes = eventRepo.create.mock.calls.map(
      (c: unknown[]) => (c[0] as { eventType: string }).eventType,
    );
    expect(eventTypes).toContain(RunEvent.PLAN_REVIEW_CHANGES_REQUESTED);
    expect(revisionSpy).toHaveBeenCalledWith("run-1");
    expect(result).toBe(revisedRun);

    const comment = linearClient.postComment.mock.calls.find((c: unknown[]) =>
      String(c[1]).includes("Changes Requested"),
    );
    expect(comment).toBeDefined();
    expect(String(comment![1])).toContain("(step s1)");
    // Finding without an affectedStepId omits the "(step ...)" suffix entirely.
    expect(String(comment![1])).toContain("Naming nit");
    expect(String(comment![1])).not.toContain("Naming nit (step");
  });
});

describe("OrchestratorService.runPlanRevision", () => {
  it("threads opts.note into the planReviser as an operatorNote and updates planVersion", async () => {
    const { deps, runRepo, artifactRepo, planReviserAgent, linearClient } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    const run = makeRun({ id: "run-1", state: RunState.PlanRevision, planVersion: 1 });
    runRepo.findById.mockResolvedValue(run);
    const plan = makePlan({ planVersion: 1 });
    const planReview = makePlanReview({ overallVerdict: "changes_requested" });
    artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
      if (type === "Plan") return Promise.resolve(makeArtifact({ type: "Plan", version: 1, payloadJson: plan }));
      if (type === "PlanReview")
        return Promise.resolve(makeArtifact({ type: "PlanReview", version: 1, payloadJson: planReview }));
      return Promise.resolve(null);
    });

    const revisedPlan = makePlan({ planVersion: 2 });
    planReviserAgent.run.mockResolvedValue({
      revision: { dispositions: [{ findingId: "f1", status: "accepted", rationale: "Fixed" }] },
      revisedPlan,
    });
    runRepo.update.mockResolvedValue({ ...run, planVersion: 2 });
    runRepo.updateState.mockResolvedValue(makeRun({ id: "run-1", state: RunState.AwaitingPlanApproval, planVersion: 2 }));

    const result = await svc.runPlanRevision("run-1", { note: "Please prioritize security" });

    expect(planReviserAgent.run).toHaveBeenCalledWith(
      plan,
      planReview,
      expect.anything(),
      "run-1",
      { operatorNote: "Please prioritize security" },
    );
    expect(runRepo.update).toHaveBeenCalledWith("run-1", { planVersion: 2 });
    expect(result.state).toBe(RunState.AwaitingPlanApproval);

    const comment = linearClient.postComment.mock.calls[0];
    expect(String(comment[1])).toContain("Plan Revision Dispositions");
  });

  it("passes undefined options to the planReviser when no note is provided", async () => {
    const { deps, runRepo, artifactRepo, planReviserAgent } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    const run = makeRun({ id: "run-1", state: RunState.PlanRevision, planVersion: 1 });
    runRepo.findById.mockResolvedValue(run);
    artifactRepo.findLatestByType.mockResolvedValue(null);
    runRepo.update.mockResolvedValue({ ...run, planVersion: 2 });
    runRepo.updateState.mockResolvedValue(makeRun({ id: "run-1", state: RunState.AwaitingPlanApproval }));

    await svc.runPlanRevision("run-1");

    expect(planReviserAgent.run).toHaveBeenCalledWith(
      undefined,
      undefined,
      expect.anything(),
      "run-1",
      undefined,
    );
  });
});

describe("OrchestratorService.approvePlan", () => {
  it("throws when no Plan artifact exists", async () => {
    const { deps, runRepo, artifactRepo } = buildDeps();
    const svc = new OrchestratorService(deps as never);
    runRepo.findById.mockResolvedValue(makeRun({ state: RunState.AwaitingPlanApproval }));
    artifactRepo.findLatestByType.mockResolvedValue(null);

    await expect(svc.approvePlan("run-1")).rejects.toThrow("No plan artifact found for run run-1");
  });

  it("happy path without a note: records approvedPlanVersion, transitions to Implementing, posts a plain approval comment", async () => {
    const { deps, runRepo, artifactRepo, linearClient, eventRepo } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    const run = makeRun({ id: "run-1", state: RunState.AwaitingPlanApproval, planVersion: 2 });
    runRepo.findById.mockResolvedValue(run);
    const plan = makePlan({ planVersion: 2 });
    artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) =>
      type === "Plan" ? Promise.resolve(makeArtifact({ type: "Plan", version: 2, payloadJson: plan })) : Promise.resolve(null),
    );
    const runWithApproval = { ...run, approvedPlanVersion: 2 };
    runRepo.update.mockResolvedValue(runWithApproval);
    const implementingRun = makeRun({ id: "run-1", state: RunState.Implementing, approvedPlanVersion: 2 });
    runRepo.updateState.mockResolvedValue(implementingRun);

    const result = await svc.approvePlan("run-1");

    expect(runRepo.update).toHaveBeenCalledWith("run-1", { approvedPlanVersion: 2 });
    const eventCall = eventRepo.create.mock.calls.find(
      (c: unknown[]) => (c[0] as { eventType: string }).eventType === RunEvent.PLAN_APPROVED,
    );
    expect(eventCall).toBeDefined();
    expect((eventCall![0] as { payloadJson: Record<string, unknown> }).payloadJson).not.toHaveProperty("note");
    expect(result.state).toBe(RunState.Implementing);

    const comment = linearClient.postComment.mock.calls[0][1] as string;
    expect(comment).toBe("Plan v2 approved. Starting implementation...");
  });

  it("happy path with a note: includes the note in the payload and the posted comment", async () => {
    const { deps, runRepo, artifactRepo, linearClient, eventRepo } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    const run = makeRun({ id: "run-1", state: RunState.AwaitingPlanApproval, planVersion: 1 });
    runRepo.findById.mockResolvedValue(run);
    const plan = makePlan({ planVersion: 1 });
    artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) =>
      type === "Plan" ? Promise.resolve(makeArtifact({ type: "Plan", version: 1, payloadJson: plan })) : Promise.resolve(null),
    );
    runRepo.update.mockResolvedValue({ ...run, approvedPlanVersion: 1 });
    runRepo.updateState.mockResolvedValue(makeRun({ id: "run-1", state: RunState.Implementing }));

    await svc.approvePlan("run-1", { note: "Skip the migration step" });

    const eventCall = eventRepo.create.mock.calls.find(
      (c: unknown[]) => (c[0] as { eventType: string }).eventType === RunEvent.PLAN_APPROVED,
    );
    expect((eventCall![0] as { payloadJson: Record<string, unknown> }).payloadJson).toMatchObject({
      note: "Skip the migration step",
    });

    const comment = linearClient.postComment.mock.calls[0][1] as string;
    expect(comment).toContain("approved with operator note");
    expect(comment).toContain("Skip the migration step");
  });

  it("throws StateTransitionError when approving from an invalid prior state", async () => {
    const { deps, runRepo, artifactRepo } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    const run = makeRun({ id: "run-1", state: RunState.Planning, planVersion: 1 });
    runRepo.findById.mockResolvedValue(run);
    const plan = makePlan({ planVersion: 1 });
    artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) =>
      type === "Plan" ? Promise.resolve(makeArtifact({ type: "Plan", version: 1, payloadJson: plan })) : Promise.resolve(null),
    );
    runRepo.update.mockResolvedValue({ ...run, approvedPlanVersion: 1 });

    await expect(svc.approvePlan("run-1")).rejects.toThrow(StateTransitionError);
    expect(runRepo.updateState).not.toHaveBeenCalled();
  });
});
