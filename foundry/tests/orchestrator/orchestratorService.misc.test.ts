import { describe, it, expect, vi, beforeEach } from "vitest";
import { OrchestratorService } from "../../src/orchestrator/orchestratorService.js";
import { RunState } from "../../src/domain/runState.js";
import { RunEvent } from "../../src/domain/runEvent.js";
import type { Run, Artifact, RunEventRecord } from "../../src/domain/types.js";
import type { Plan } from "../../src/schemas/plan.js";
import type { ExecutionReport } from "../../src/schemas/executionReport.js";
import type { Review } from "../../src/schemas/review.js";

/**
 * Miscellaneous remaining orchestratorService coverage not exercised by the
 * other dedicated test files: trivial getters, buildTaskBundle's
 * default-branch-mismatch warning, formatExecutionReportComment's file-list
 * collapse/notes branches, retrieveSkillsForPlanning / updateSkillMetrics
 * (agent-skill repo integration), runManualPlanRevision's missing-plan
 * throw, runRemediation's successful markReady path, and
 * maybeResearchAndReplan's humanAnswers-injection branches.
 */

function makeRun(overrides: Partial<Run> = {}): Run {
  return {
    id: "run-1",
    linearIssueId: "LIN-1",
    linearIssueIdentifier: null,
    linearIssueDescription: "Some description",
    linearIssueTitle: "Some title",
    linearIssueUrl: null,
    repo: "test-repo",
    branchName: null,
    prNumber: null,
    state: RunState.Todo,
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

function makeExecutionReport(overrides: Partial<ExecutionReport> = {}): ExecutionReport {
  return {
    executionVersion: 1,
    summary: "Implemented the feature",
    filesChanged: ["src/a.ts"],
    checks: {
      lint: { status: "pass", details: "clean" },
      typecheck: { status: "pass", details: "clean" },
      tests: { status: "pass", details: "all green" },
    },
    notes: [],
    prDraftCreated: true,
    score: 0.85,
    scoreRationale: "solid",
    ...overrides,
  };
}

function makeReview(overrides: Partial<Review> = {}): Review {
  return {
    reviewId: "rev-1",
    summary: "fine",
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

function makeEvent(overrides: Partial<RunEventRecord> = {}): RunEventRecord {
  return {
    id: "evt-1",
    runId: "run-1",
    eventType: "SKILL_INJECTION",
    source: "orchestrator",
    payloadJson: { skillIds: ["skill-1", "skill-2"] },
    createdAt: new Date(),
    ...overrides,
  };
}

function baseDeps(overrides: Record<string, unknown> = {}) {
  const runRepo = {
    findById: vi.fn(),
    findActiveByIssueId: vi.fn(),
    findAll: vi.fn(),
    create: vi.fn(),
    findByIssueId: vi.fn(),
    update: vi.fn(),
    updateState: vi.fn(),
  };
  const artifactRepo = { create: vi.fn().mockResolvedValue({}), findByRunId: vi.fn(), findLatestByType: vi.fn() };
  const eventRepo = { create: vi.fn().mockResolvedValue({}), findByRunId: vi.fn().mockResolvedValue([]) };
  const linearClient = {
    getIssue: vi.fn().mockResolvedValue({
      id: "LIN-1",
      title: "Test issue",
      description: "Test description",
      branchName: "ai/lin-1",
      labels: [],
      priority: 0,
      project: "test-project",
    }),
    getRelatedContext: vi.fn().mockResolvedValue({ blockers: [] }),
    postComment: vi.fn().mockResolvedValue(undefined),
  };
  const githubClient = { getPRDiff: vi.fn(), getDefaultBranch: vi.fn().mockResolvedValue("main") };
  const repoRegistry = {
    resolveForIssue: vi.fn().mockReturnValue({
      name: "test-repo",
      defaultBranch: "main",
      allowedPaths: ["src/"],
      protectedPaths: [],
      constraints: { requiredChecks: [], maxFilesChanged: 10, maxDiffLines: 500, forbiddenPatterns: [], mustNotTouch: [] },
    }),
    resolveWorkingDirectory: vi.fn().mockReturnValue("/tmp/repo"),
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
  const githubSync = {
    syncState: vi.fn().mockResolvedValue(undefined),
    postReviewFindings: vi.fn(),
    postExecutionReportUpdate: vi.fn().mockResolvedValue(undefined),
    postRemediationResolutions: vi.fn().mockResolvedValue(undefined),
  };
  const plannerAgent = { run: vi.fn() };
  const planReviewerAgent = {
    run: vi.fn().mockResolvedValue({ reviewId: "pr-1", overallVerdict: "approved", summary: "ok", findings: [] }),
  };
  const planReviserAgent = { run: vi.fn() };
  const executorAgent = { run: vi.fn() };
  const reviewerAgent = { run: vi.fn() };
  const remediationAgent = { run: vi.fn() };
  const gitService = {
    setupRunWorktree: vi.fn().mockResolvedValue({ worktreePath: "/tmp/worktree", branchName: "ai/run-1" }),
    assertBranch: vi.fn().mockResolvedValue(undefined),
    commitAndPush: vi.fn().mockResolvedValue(undefined),
    removeWorktree: vi.fn().mockResolvedValue(undefined),
    resolveMainRepoPath: vi.fn().mockReturnValue("/tmp"),
  };
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };

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
      ...overrides,
    },
    runRepo,
    artifactRepo,
    eventRepo,
    linearClient,
    githubClient,
    plannerAgent,
    planReviewerAgent,
    executorAgent,
    reviewerAgent,
    remediationAgent,
    gitService,
    logger,
  };
}

describe("OrchestratorService trivial getters", () => {
  it("exposes the underlying repositories and linear client it was constructed with", () => {
    const { deps, runRepo, artifactRepo, eventRepo } = baseDeps();
    const agentSkillRepo = { findTopKByRelevance: vi.fn() };
    const svc = new OrchestratorService({ ...deps, agentSkillRepo } as never);

    expect(svc.getRunRepo()).toBe(runRepo);
    expect(svc.getArtifactRepo()).toBe(artifactRepo);
    expect(svc.getEventRepo()).toBe(eventRepo);
    expect(svc.getAgentSkillRepo()).toBe(agentSkillRepo);
    expect(svc.getLinearClient()).toBe(deps.linearClient);
  });

  it("returns undefined for getAgentSkillRepo when none was configured", () => {
    const { deps } = baseDeps();
    const svc = new OrchestratorService(deps as never);
    expect(svc.getAgentSkillRepo()).toBeUndefined();
  });
});

describe("OrchestratorService.runManualPlanRevision (extra)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("throws when no plan artifact exists for the run", async () => {
    const { deps, runRepo, artifactRepo } = baseDeps();
    runRepo.findById.mockResolvedValue(makeRun({ state: RunState.AwaitingPlanApproval }));
    runRepo.updateState.mockResolvedValue(makeRun({ state: RunState.PlanReview }));
    artifactRepo.findLatestByType.mockResolvedValue(null);

    const svc = new OrchestratorService(deps as never);
    await expect(svc.runManualPlanRevision("run-1")).rejects.toThrow(
      "No plan artifact found for run run-1",
    );
  });
});

describe("OrchestratorService buildTaskBundle (default branch mismatch)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("uses GitHub's remote default branch and logs a warning when it differs from the configured value", async () => {
    const { deps, runRepo, githubClient, plannerAgent, logger } = baseDeps();
    githubClient.getDefaultBranch.mockResolvedValue("develop"); // differs from config's "main"
    runRepo.findActiveByIssueId.mockResolvedValue(null);
    runRepo.create.mockResolvedValue(makeRun({ state: RunState.Todo }));
    runRepo.update
      .mockResolvedValueOnce(makeRun({ state: RunState.Todo, branchName: "ai/run-1", workingDirectory: "/tmp/worktree" }))
      .mockResolvedValueOnce(makeRun({ state: RunState.Planning, branchName: "ai/run-1" }));
    runRepo.updateState
      .mockResolvedValueOnce(makeRun({ state: RunState.Planning, branchName: "ai/run-1" })) // RUN_REQUESTED
      .mockResolvedValueOnce(makeRun({ state: RunState.PlanReview })) // PLAN_CREATED
      .mockResolvedValueOnce(makeRun({ state: RunState.HumanClarificationNeeded })); // NEEDS_HUMAN_CLARIFICATION
    plannerAgent.run.mockResolvedValue(
      makePlan({ openQuestions: [{ id: "q1", question: "x?", requiredForExecution: true }] }),
    );

    const svc = new OrchestratorService(deps as never);
    await svc.startRun("LIN-1");

    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ repo: "test-repo", config: "main", remote: "develop" }),
      "Config defaultBranch differs from GitHub, using remote value",
    );
    expect(plannerAgent.run).toHaveBeenCalledWith(
      expect.objectContaining({ repo: expect.objectContaining({ defaultBranch: "develop" }) }),
      "run-1",
      expect.anything(),
    );
  });
});

describe("OrchestratorService formatExecutionReportComment (via runExecution)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("collapses the file list into <details> when more than 8 files changed, and renders a notes section", async () => {
    const { deps, runRepo, artifactRepo, executorAgent, reviewerAgent, linearClient } = baseDeps();
    const run = makeRun({ state: RunState.Implementing, branchName: null, approvedPlanVersion: 1 });
    runRepo.findById
      .mockResolvedValueOnce(run)
      .mockResolvedValue(makeRun({ state: RunState.AIReview, prNumber: 7 }));
    let execReportCalls = 0;
    artifactRepo.findLatestByType.mockImplementation((_id: string, type: string) => {
      if (type === "Plan") return Promise.resolve(makeArtifact({ payloadJson: makePlan() }));
      if (type === "ExecutionReport") {
        execReportCalls += 1;
        return Promise.resolve(
          execReportCalls === 1
            ? null
            : makeArtifact({ type: "ExecutionReport", payloadJson: makeExecutionReport() }),
        );
      }
      if (type === "Review") return Promise.resolve(makeArtifact({ type: "Review", payloadJson: makeReview() }));
      return Promise.resolve(null);
    });
    const manyFiles = Array.from({ length: 9 }, (_, i) => `src/file${i}.ts`);
    executorAgent.run.mockResolvedValue({
      report: makeExecutionReport({ filesChanged: manyFiles, notes: ["Had to refactor the helper"] }),
      prNumber: 7,
    });
    reviewerAgent.run.mockResolvedValue(makeReview());
    runRepo.update
      .mockResolvedValueOnce(makeRun({ state: RunState.Implementing, prNumber: 7 }))
      .mockResolvedValueOnce(makeRun({ state: RunState.AIReview, prNumber: 7 }));
    runRepo.updateState
      .mockResolvedValueOnce(makeRun({ state: RunState.AIReview, prNumber: 7 }))
      .mockResolvedValueOnce(makeRun({ state: RunState.ReadyForHumanReview, prNumber: 7 }));

    const svc = new OrchestratorService(deps as never);
    await svc.runExecution("run-1");

    const reportComment = (linearClient.postComment as ReturnType<typeof vi.fn>).mock.calls.find(
      (c: unknown[]) => typeof c[1] === "string" && (c[1] as string).includes("Execution Report"),
    );
    expect(reportComment).toBeDefined();
    const body = reportComment![1] as string;
    expect(body).toContain("<details>");
    expect(body).toContain("Files changed (9)");
    expect(body).toContain("### Notes");
    expect(body).toContain("Had to refactor the helper");
  });

  it("omits the files-changed section entirely when no files changed", async () => {
    const { deps, runRepo, artifactRepo, executorAgent, reviewerAgent, linearClient } = baseDeps();
    const run = makeRun({ state: RunState.Implementing, branchName: null, approvedPlanVersion: 1 });
    runRepo.findById
      .mockResolvedValueOnce(run)
      .mockResolvedValue(makeRun({ state: RunState.AIReview, prNumber: 3 }));
    let execReportCalls = 0;
    artifactRepo.findLatestByType.mockImplementation((_id: string, type: string) => {
      if (type === "Plan") return Promise.resolve(makeArtifact({ payloadJson: makePlan() }));
      if (type === "ExecutionReport") {
        execReportCalls += 1;
        return Promise.resolve(
          execReportCalls === 1
            ? null
            : makeArtifact({ type: "ExecutionReport", payloadJson: makeExecutionReport() }),
        );
      }
      if (type === "Review") return Promise.resolve(makeArtifact({ type: "Review", payloadJson: makeReview() }));
      return Promise.resolve(null);
    });
    executorAgent.run.mockResolvedValue({
      report: makeExecutionReport({ filesChanged: [], notes: [] }),
      prNumber: 3,
    });
    reviewerAgent.run.mockResolvedValue(makeReview());
    runRepo.update
      .mockResolvedValueOnce(makeRun({ state: RunState.Implementing, prNumber: 3 }))
      .mockResolvedValueOnce(makeRun({ state: RunState.AIReview, prNumber: 3 }));
    runRepo.updateState
      .mockResolvedValueOnce(makeRun({ state: RunState.AIReview, prNumber: 3 }))
      .mockResolvedValueOnce(makeRun({ state: RunState.ReadyForHumanReview, prNumber: 3 }));

    const svc = new OrchestratorService(deps as never);
    await svc.runExecution("run-1");

    const reportComment = (linearClient.postComment as ReturnType<typeof vi.fn>).mock.calls.find(
      (c: unknown[]) => typeof c[1] === "string" && (c[1] as string).includes("Execution Report"),
    );
    expect(reportComment).toBeDefined();
    const body = reportComment![1] as string;
    expect(body).not.toContain("Files changed");
    expect(body).not.toContain("### Notes");
  });
});

describe("OrchestratorService.retrieveSkillsForPlanning / updateSkillMetrics (agent skill repo)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("records a SKILL_INJECTION event when the agent skill repo returns relevant skills during startRun", async () => {
    const { deps, runRepo, artifactRepo, eventRepo, plannerAgent } = baseDeps();
    const agentSkillRepo = {
      findTopKByRelevance: vi.fn().mockResolvedValue([
        { id: "skill-1", repoSlug: "test-repo", name: "s1", description: null, taskCategory: "x", skillMarkdown: "md", utilityScore: 1, lastUsedAt: new Date() },
      ]),
    };
    runRepo.findActiveByIssueId.mockResolvedValue(null);
    runRepo.create.mockResolvedValue(makeRun({ state: RunState.Todo }));
    runRepo.update
      .mockResolvedValueOnce(makeRun({ state: RunState.Todo, branchName: "ai/run-1" }))
      .mockResolvedValueOnce(makeRun({ state: RunState.Planning, branchName: "ai/run-1" }));
    runRepo.updateState
      .mockResolvedValueOnce(makeRun({ state: RunState.Planning, branchName: "ai/run-1" }))
      .mockResolvedValueOnce(makeRun({ state: RunState.PlanReview }))
      .mockResolvedValueOnce(makeRun({ state: RunState.HumanClarificationNeeded }));
    artifactRepo.findLatestByType.mockResolvedValue(null);
    plannerAgent.run.mockResolvedValue(
      makePlan({ openQuestions: [{ id: "q1", question: "x?", requiredForExecution: true }] }),
    );

    const svc = new OrchestratorService({ ...deps, agentSkillRepo } as never);
    await svc.startRun("LIN-1");

    expect(plannerAgent.run).toHaveBeenCalledWith(
      expect.anything(),
      "run-1",
      expect.objectContaining({ priorSkills: expect.arrayContaining([expect.objectContaining({ id: "skill-1" })]) }),
    );
    const injectionCall = eventRepo.create.mock.calls.find(
      (c: unknown[]) => (c[0] as { eventType: string }).eventType === "SKILL_INJECTION",
    );
    expect(injectionCall).toBeDefined();
    expect((injectionCall![0] as { payloadJson: { skillIds: string[] } }).payloadJson.skillIds).toEqual([
      "skill-1",
    ]);
  });

  it("increments success and archives-if-low-utility for every injected skill when the run reaches Done", async () => {
    const { deps, runRepo, eventRepo } = baseDeps();
    const updatedSkill = { id: "skill-1" };
    const agentSkillRepo = {
      findTopKByRelevance: vi.fn(),
      incrementSuccess: vi.fn().mockResolvedValue(updatedSkill),
      incrementFailure: vi.fn(),
      archiveIfLowUtility: vi.fn().mockResolvedValue(undefined),
    };
    runRepo.findById.mockResolvedValue(makeRun({ state: RunState.ReadyForHumanReview }));
    runRepo.updateState.mockResolvedValue(makeRun({ state: RunState.Done }));
    eventRepo.findByRunId.mockResolvedValue([
      makeEvent({ payloadJson: { skillIds: ["skill-1", "skill-2"] } }),
    ]);

    const svc = new OrchestratorService({ ...deps, agentSkillRepo } as never);
    await svc.approveHumanReview("run-1");

    expect(agentSkillRepo.incrementSuccess).toHaveBeenCalledWith("skill-1");
    expect(agentSkillRepo.incrementSuccess).toHaveBeenCalledWith("skill-2");
    expect(agentSkillRepo.incrementFailure).not.toHaveBeenCalled();
    expect(agentSkillRepo.archiveIfLowUtility).toHaveBeenCalledWith(updatedSkill);
  });

  it("increments failure for every injected skill when the run reaches Failed, deduplicating ids across multiple injection events", async () => {
    const { deps, runRepo, artifactRepo, eventRepo, plannerAgent } = baseDeps();
    const updatedSkill = { id: "skill-1" };
    const agentSkillRepo = {
      findTopKByRelevance: vi.fn(),
      incrementSuccess: vi.fn(),
      incrementFailure: vi.fn().mockResolvedValue(updatedSkill),
      archiveIfLowUtility: vi.fn().mockResolvedValue(undefined),
    };
    const run = makeRun({ state: RunState.HumanClarificationNeeded });
    runRepo.findById.mockResolvedValue(run);
    artifactRepo.findLatestByType.mockImplementation((_id: string, type: string) => {
      if (type === "Plan")
        return Promise.resolve(
          makeArtifact({
            payloadJson: makePlan({ openQuestions: [{ id: "q1", question: "x?", requiredForExecution: true }] }),
          }),
        );
      if (type === "TaskBundle")
        return Promise.resolve(
          makeArtifact({
            type: "TaskBundle",
            payloadJson: {
              issue: { id: "LIN-1", title: "t", description: "d", labels: [], priority: 0 },
              repo: {
                name: "test-repo",
                defaultBranch: "main",
                workingBranch: "ai/lin-1",
                repoPath: "/tmp",
                allowedPaths: [],
                protectedPaths: [],
              },
              constraints: { requiredChecks: [], maxFilesChanged: 10, maxDiffLines: 500, forbiddenPatterns: [], mustNotTouch: [] },
              definitionOfDone: [],
            },
          }),
        );
      return Promise.resolve(null);
    });
    // Re-plan still has the same blocking question -- keeps us in the loop-back
    // path rather than proceeding to plan review.
    plannerAgent.run.mockResolvedValue(
      makePlan({
        planVersion: 2,
        openQuestions: [{ id: "q1", question: "x?", requiredForExecution: true }],
      }),
    );
    runRepo.update.mockResolvedValue(makeRun({ state: RunState.Planning, planVersion: 2 }));
    // Two injection events referencing an overlapping skill id -- must be deduplicated.
    eventRepo.findByRunId.mockResolvedValue([
      makeEvent({ id: "e1", payloadJson: { skillIds: ["skill-1"] } }),
      makeEvent({ id: "e2", payloadJson: { skillIds: ["skill-1"] } }),
      makeEvent({ id: "e3", eventType: RunEvent.NEEDS_HUMAN_CLARIFICATION, payloadJson: {} }),
      makeEvent({ id: "e4", eventType: RunEvent.NEEDS_HUMAN_CLARIFICATION, payloadJson: {} }),
      makeEvent({ id: "e5", eventType: RunEvent.NEEDS_HUMAN_CLARIFICATION, payloadJson: {} }),
    ]);
    runRepo.updateState
      .mockResolvedValueOnce(makeRun({ state: RunState.Planning })) // CLARIFICATION_PROVIDED
      .mockResolvedValueOnce(makeRun({ state: RunState.PlanReview, planVersion: 2 })) // PLAN_CREATED
      .mockResolvedValueOnce(makeRun({ state: RunState.Failed })); // CLARIFICATION_EXHAUSTED

    const svc = new OrchestratorService({ ...deps, agentSkillRepo } as never);
    const result = await svc.answerQuestions("run-1", [{ questionId: "q1", answer: "an answer" }]);

    expect(result.state).toBe(RunState.Failed);
    expect(agentSkillRepo.incrementFailure).toHaveBeenCalledTimes(1);
    expect(agentSkillRepo.incrementFailure).toHaveBeenCalledWith("skill-1");
    expect(agentSkillRepo.incrementSuccess).not.toHaveBeenCalled();
  });

  it("logs a warning and continues when updating a skill's metric throws", async () => {
    const { deps, runRepo, eventRepo, logger } = baseDeps();
    const agentSkillRepo = {
      findTopKByRelevance: vi.fn(),
      incrementSuccess: vi.fn().mockRejectedValue(new Error("db down")),
      incrementFailure: vi.fn(),
      archiveIfLowUtility: vi.fn(),
    };
    runRepo.findById.mockResolvedValue(makeRun({ state: RunState.ReadyForHumanReview }));
    runRepo.updateState.mockResolvedValue(makeRun({ state: RunState.Done }));
    eventRepo.findByRunId.mockResolvedValue([makeEvent({ payloadJson: { skillIds: ["skill-1"] } })]);

    const svc = new OrchestratorService({ ...deps, agentSkillRepo } as never);
    await svc.approveHumanReview("run-1");

    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ runId: "run-1", skillId: "skill-1", error: "db down" }),
      "Failed to update skill metric",
    );
    expect(agentSkillRepo.archiveIfLowUtility).not.toHaveBeenCalled();
  });

  it("does nothing when no SKILL_INJECTION event was recorded for the run", async () => {
    const { deps, runRepo, eventRepo } = baseDeps();
    const agentSkillRepo = {
      findTopKByRelevance: vi.fn(),
      incrementSuccess: vi.fn(),
      incrementFailure: vi.fn(),
      archiveIfLowUtility: vi.fn(),
    };
    runRepo.findById.mockResolvedValue(makeRun({ state: RunState.ReadyForHumanReview }));
    runRepo.updateState.mockResolvedValue(makeRun({ state: RunState.Done }));
    eventRepo.findByRunId.mockResolvedValue([]);

    const svc = new OrchestratorService({ ...deps, agentSkillRepo } as never);
    await svc.approveHumanReview("run-1");

    expect(agentSkillRepo.incrementSuccess).not.toHaveBeenCalled();
    expect(agentSkillRepo.incrementFailure).not.toHaveBeenCalled();
  });
});

describe("OrchestratorService.maybeResearchAndReplan (humanAnswers injection)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("injects existing humanAnswers into both the researcher call and the re-plan call", async () => {
    const { deps, runRepo, artifactRepo, eventRepo, plannerAgent, planReviewerAgent } = baseDeps();
    const answerResearcherAgent = {
      run: vi.fn().mockResolvedValue({
        summary: "researched",
        answers: [
          { questionId: "q1", question: "Which DB?", answer: "Postgres", confidence: "high" },
        ],
        completedAt: new Date().toISOString(),
      }),
    };

    runRepo.findActiveByIssueId.mockResolvedValue(null);
    runRepo.create.mockResolvedValue(makeRun({ state: RunState.Todo }));
    runRepo.findById.mockResolvedValue(makeRun({ state: RunState.PlanReview, planVersion: 2 })); // runPlanReview's requireRun
    runRepo.update
      .mockResolvedValueOnce(makeRun({ state: RunState.Todo, branchName: "ai/run-1" })) // worktree update
      .mockResolvedValueOnce(makeRun({ state: RunState.Planning, branchName: "ai/run-1", planVersion: 1 })) // post initial plan
      .mockResolvedValueOnce(makeRun({ state: RunState.Planning, branchName: "ai/run-1", planVersion: 2 })); // post research re-plan
    runRepo.updateState
      .mockResolvedValueOnce(makeRun({ state: RunState.Planning, branchName: "ai/run-1" })) // RUN_REQUESTED
      .mockResolvedValueOnce(makeRun({ state: RunState.PlanReview, planVersion: 2 })) // PLAN_CREATED
      .mockResolvedValueOnce(makeRun({ state: RunState.AwaitingPlanApproval, planVersion: 2 })); // PLAN_REVIEW_APPROVED

    artifactRepo.findLatestByType.mockImplementation((_id: string, type: string) => {
      if (type === "HumanAnswers")
        return Promise.resolve(
          makeArtifact({
            type: "HumanAnswers",
            payloadJson: { answers: [{ questionId: "q1", answer: "Postgres" }] },
          }),
        );
      if (type === "ResearchedAnswers") return Promise.resolve(null); // not yet run -- loop guard open
      if (type === "Plan")
        return Promise.resolve(makeArtifact({ payloadJson: makePlan({ planVersion: 2 }) }));
      return Promise.resolve(null);
    });

    // Initial plan has a non-blocking open question, which triggers the researcher.
    const initialPlan = makePlan({
      openQuestions: [{ id: "q1", question: "Which DB?", requiredForExecution: false }],
    });
    const revisedPlan = makePlan({ planVersion: 2, openQuestions: [] });
    plannerAgent.run.mockResolvedValueOnce(initialPlan).mockResolvedValueOnce(revisedPlan);

    const svc = new OrchestratorService({ ...deps, answerResearcherAgent } as never);
    const result = await svc.startRun("LIN-1");

    expect(answerResearcherAgent.run).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      "run-1",
      { humanAnswers: [{ questionId: "q1", answer: "Postgres" }] },
    );
    expect(plannerAgent.run).toHaveBeenNthCalledWith(
      2,
      expect.anything(),
      "run-1",
      expect.objectContaining({
        humanAnswers: [{ questionId: "q1", answer: "Postgres" }],
      }),
    );
    const researchEvent = eventRepo.create.mock.calls.find(
      (c: unknown[]) => (c[0] as { eventType: string }).eventType === "RESEARCH_COMPLETED",
    );
    expect(researchEvent).toBeDefined();
    expect(planReviewerAgent.run).toHaveBeenCalled();
    expect(result.state).toBe(RunState.AwaitingPlanApproval);
  });
});

describe("OrchestratorService.runRemediation (successful markReady)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns the run produced by a successful markReady call once remediation completes", async () => {
    const { deps, runRepo, artifactRepo, remediationAgent, linearClient } = baseDeps();
    const run = makeRun({
      state: RunState.AddressingReview,
      branchName: null,
      prNumber: 7,
      linearIssueId: "LIN-1",
    });
    runRepo.findById.mockResolvedValue(run);

    const review = makeReview({
      overallVerdict: "changes_requested",
      findings: [
        { id: "f1", severity: "blocker", type: "bug", file: "a.ts", title: "x", details: "y" },
      ],
    });
    artifactRepo.findLatestByType.mockImplementation((_id: string, type: string) => {
      if (type === "Review") return Promise.resolve(makeArtifact({ type: "Review", payloadJson: review }));
      if (type === "ExecutionReport")
        return Promise.resolve(
          makeArtifact({ type: "ExecutionReport", payloadJson: makeExecutionReport({ score: 0.5 }) }),
        );
      return Promise.resolve(null);
    });

    const newExecutionReport = makeExecutionReport({ executionVersion: 2, score: 0.95 });
    remediationAgent.run.mockResolvedValue({
      reviewId: "rev-1",
      resolution: [{ findingId: "f1", status: "accepted", action: "fixed", rationale: "good" }],
      readyForHumanReview: true,
      executionReport: newExecutionReport,
    });

    runRepo.update.mockResolvedValue(makeRun({ state: RunState.AddressingReview, prNumber: 7 }));
    const afterRemediationFinished = makeRun({ state: RunState.AIReview, prNumber: 7 });
    const afterReviewApproved = makeRun({ state: RunState.ReadyForHumanReview, prNumber: 7 });
    runRepo.updateState
      .mockResolvedValueOnce(afterRemediationFinished) // REMEDIATION_FINISHED
      .mockResolvedValueOnce(afterReviewApproved); // REVIEW_APPROVED

    // After the REVIEW_APPROVED transition, markReady re-reads the latest Review
    // and ExecutionReport. Simulate that remediation produced an approved review
    // this time (not realistic for this exact code path, but exercises markReady's
    // success branch and runRemediation's own trailing `return run;`).
    let reviewLookups = 0;
    artifactRepo.findLatestByType.mockImplementation((_id: string, type: string) => {
      if (type === "Review") {
        reviewLookups += 1;
        return Promise.resolve(
          makeArtifact({
            type: "Review",
            payloadJson: reviewLookups === 1 ? review : makeReview({ overallVerdict: "approved" }),
          }),
        );
      }
      if (type === "ExecutionReport")
        return Promise.resolve(makeArtifact({ type: "ExecutionReport", payloadJson: newExecutionReport }));
      return Promise.resolve(null);
    });

    const svc = new OrchestratorService(deps as never);
    const result = await svc.runRemediation("run-1");

    expect(result).toEqual(afterReviewApproved);
    expect(linearClient.postComment).toHaveBeenCalledWith(
      "LIN-1",
      "AI workflow complete. Issue marked as **Ready for Human Review**.",
    );
  });
});
