import { describe, it, expect, vi } from "vitest";
import { OrchestratorService } from "../../src/orchestrator/orchestratorService.js";
import { RunState } from "../../src/domain/runState.js";
import { RunEvent } from "../../src/domain/runEvent.js";
import type { Run } from "../../src/domain/types.js";
import type { Plan } from "../../src/schemas/plan.js";
import type { ExecutionReport } from "../../src/schemas/executionReport.js";

function makeRun(overrides: Partial<Run> = {}): Run {
  return {
    id: "run-1",
    linearIssueId: "LIN-1",
    linearIssueIdentifier: null,
    linearIssueDescription: "Full description text here",
    linearIssueTitle: "Add the thing",
    linearIssueUrl: null,
    repo: "test-repo",
    branchName: "ai/run-1",
    prNumber: 7,
    state: RunState.AwaitingPlanApproval,
    planVersion: 2,
    approvedPlanVersion: null,
    plannerRuntime: null,
    executorRuntime: null,
    reviewerRuntime: null,
    remediationRuntime: null,
    workingDirectory: "/tmp/worktree",
    latestArtifactVersion: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makePlan(overrides: Partial<Plan> = {}): Plan {
  return {
    planVersion: 2,
    summary: "Add the thing",
    requirementsTraceability: "",
    assumptions: [],
    openQuestions: [],
    risks: [],
    steps: [{ id: "s1", title: "Do it", description: "Do the thing" }],
    testPlan: "Run the tests",
    confidence: 0.9,
    ...overrides,
  };
}

function makeExecutionReport(overrides: Partial<ExecutionReport> = {}): ExecutionReport {
  return {
    executionVersion: 1,
    summary: "Implemented the thing",
    filesChanged: ["src/thing.ts"],
    checks: {
      lint: { status: "pass", details: "" },
      typecheck: { status: "pass", details: "" },
      tests: { status: "pass", details: "" },
    },
    notes: [],
    prDraftCreated: true,
    score: 0.8,
    scoreRationale: "Looks solid",
    ...overrides,
  };
}

function buildDeps() {
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
  const eventRepo = { create: vi.fn().mockResolvedValue({}), findByRunId: vi.fn().mockResolvedValue([]) };
  const linearClient = {
    getIssue: vi.fn().mockResolvedValue({
      id: "LIN-1",
      title: "Add the thing",
      description: "desc",
      branchName: "ai/lin-1",
      labels: [],
      priority: 1,
      project: "proj",
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
      constraints: {
        requiredChecks: [],
        maxFilesChanged: 100,
        maxDiffLines: 5000,
        forbiddenPatterns: [],
        mustNotTouch: [],
      },
    }),
    getDefaultRepo: vi.fn(),
  };
  const linearSync = { syncState: vi.fn().mockResolvedValue(undefined) };
  const githubSync = {
    syncState: vi.fn().mockResolvedValue(undefined),
    postReviewFindings: vi.fn().mockResolvedValue(new Map()),
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
  const dashboardEmitter = {
    emitStateChanged: vi.fn(),
    emitArtifactCreated: vi.fn(),
    emitRunCreated: vi.fn(),
    emitQuestionsAnswered: vi.fn(),
  };

  return {
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
  };
}

describe("OrchestratorService.rejectPlan (additional branches)", () => {
  it("forwards humanAnswers, researchedAnswers, and planReviewFindings from loadReplanContext in iterate mode", async () => {
    const deps = buildDeps();
    deps.runRepo.findById.mockResolvedValue(makeRun({ state: RunState.AwaitingPlanApproval }));
    deps.runRepo.updateState.mockResolvedValue(makeRun({ state: RunState.Planning }));
    deps.artifactRepo.findLatestByType.mockImplementation((_id: string, type: string) => {
      if (type === "Plan") return Promise.resolve({ payloadJson: makePlan() });
      if (type === "HumanAnswers")
        return Promise.resolve({ payloadJson: { answers: [{ questionId: "q1", answer: "prod" }] } });
      if (type === "ResearchedAnswers")
        return Promise.resolve({
          payloadJson: {
            summary: "s",
            completedAt: "2026-01-01T00:00:00Z",
            answers: [{ questionId: "q1", question: "Which env?", answer: "prod", confidence: "high" }],
          },
        });
      if (type === "PlanReview")
        return Promise.resolve({
          payloadJson: { summary: "review summary", findings: [{ id: "f1", severity: "nit", title: "t", details: "d" }] },
        });
      return Promise.resolve(null);
    });
    deps.plannerAgent.run.mockResolvedValue(makePlan({ planVersion: 3 }));
    deps.runRepo.update.mockResolvedValue(makeRun({ state: RunState.Planning, planVersion: 3 }));

    const svc = new OrchestratorService(deps as never);
    vi.spyOn(svc, "runPlanReview").mockResolvedValue(makeRun({ state: RunState.PlanReview }));

    await svc.rejectPlan("run-1", "needs rework", "api", "iterate");

    const call = deps.plannerAgent.run.mock.calls[0][2];
    expect(call.humanAnswers).toEqual([{ questionId: "q1", answer: "prod" }]);
    expect(call.researchedAnswers).toHaveLength(1);
    expect(call.planReviewFindings.summary).toBe("review summary");
  });

  it("pauses for human clarification when the re-plan after rejection still has blockers", async () => {
    const deps = buildDeps();
    deps.runRepo.findById.mockResolvedValue(makeRun({ state: RunState.AwaitingPlanApproval }));
    deps.runRepo.updateState
      .mockResolvedValueOnce(makeRun({ state: RunState.Planning }))
      .mockResolvedValueOnce(makeRun({ state: RunState.PlanReview }))
      .mockResolvedValueOnce(makeRun({ state: RunState.HumanClarificationNeeded }));
    deps.artifactRepo.findLatestByType.mockResolvedValue(null);
    const blockedPlan = makePlan({
      planVersion: 3,
      openQuestions: [{ id: "q1", question: "Which env?", requiredForExecution: true }],
    });
    deps.plannerAgent.run.mockResolvedValue(blockedPlan);
    deps.runRepo.update.mockResolvedValue(makeRun({ state: RunState.Planning, planVersion: 3 }));

    const svc = new OrchestratorService(deps as never);
    const result = await svc.rejectPlan("run-1", "needs rework");

    expect(result.state).toBe(RunState.HumanClarificationNeeded);
  });
});

describe("OrchestratorService.answerQuestions (missing TaskBundle)", () => {
  it("throws when no TaskBundle artifact exists for the run", async () => {
    const deps = buildDeps();
    deps.runRepo.findById.mockResolvedValue(makeRun({ state: RunState.HumanClarificationNeeded }));
    deps.runRepo.updateState.mockResolvedValue(makeRun({ state: RunState.Planning }));
    deps.artifactRepo.findLatestByType.mockImplementation((_id: string, type: string) => {
      if (type === "Plan")
        return Promise.resolve({
          payloadJson: makePlan({
            openQuestions: [{ id: "q1", question: "Which env?", requiredForExecution: true }],
          }),
        });
      return Promise.resolve(null);
    });

    const svc = new OrchestratorService(deps as never);
    await expect(
      svc.answerQuestions("run-1", [{ questionId: "q1", answer: "prod" }]),
    ).rejects.toThrow(/No TaskBundle artifact found/);
  });
});

describe("OrchestratorService.runManualPlanRevision (missing plan)", () => {
  it("throws when no plan artifact exists for the run", async () => {
    const deps = buildDeps();
    deps.runRepo.findById.mockResolvedValue(makeRun({ state: RunState.AwaitingPlanApproval }));
    deps.runRepo.updateState.mockResolvedValue(makeRun({ state: RunState.PlanReview }));
    deps.artifactRepo.findLatestByType.mockResolvedValue(null);

    const svc = new OrchestratorService(deps as never);
    await expect(svc.runManualPlanRevision("run-1")).rejects.toThrow(/No plan artifact found/);
  });
});

describe("OrchestratorService skill retrieval and metrics (via public methods)", () => {
  it("retrieveSkillsForPlanning returns [] and skips skill-injection event when no agentSkillRepo is configured", async () => {
    const deps = buildDeps();
    deps.runRepo.findById.mockResolvedValue(makeRun({ state: RunState.AwaitingPlanApproval }));
    deps.runRepo.updateState.mockResolvedValue(makeRun({ state: RunState.Planning }));
    deps.artifactRepo.findLatestByType.mockResolvedValue(null);
    deps.plannerAgent.run.mockResolvedValue(makePlan());
    deps.runRepo.update.mockResolvedValue(makeRun({ state: RunState.Planning, planVersion: 2 }));

    const svc = new OrchestratorService(deps as never);
    vi.spyOn(svc, "runPlanReview").mockResolvedValue(makeRun({ state: RunState.PlanReview }));

    await svc.rejectPlan("run-1");

    expect(deps.plannerAgent.run.mock.calls[0][2].priorSkills).toEqual([]);
    expect(deps.eventRepo.create).not.toHaveBeenCalledWith(
      expect.objectContaining({ eventType: "SKILL_INJECTION" }),
    );
  });

  it("retrieveSkillsForPlanning fetches relevant skills and records a SKILL_INJECTION event when skills are found", async () => {
    const deps = buildDeps();
    deps.runRepo.findById.mockResolvedValue(makeRun({ state: RunState.AwaitingPlanApproval }));
    deps.runRepo.updateState.mockResolvedValue(makeRun({ state: RunState.Planning }));
    deps.artifactRepo.findLatestByType.mockResolvedValue(null);
    deps.plannerAgent.run.mockResolvedValue(makePlan());
    deps.runRepo.update.mockResolvedValue(makeRun({ state: RunState.Planning, planVersion: 2 }));
    const skill = {
      id: "skill-1",
      repoSlug: "test-repo",
      name: "Pattern X",
      description: "desc",
      taskCategory: "api",
      skillMarkdown: "# Pattern X",
      utilityScore: 0.8,
      lastUsedAt: new Date(),
    };
    const agentSkillRepo = { findTopKByRelevance: vi.fn().mockResolvedValue([skill]) };

    const svc = new OrchestratorService({ ...deps, agentSkillRepo } as never);
    vi.spyOn(svc, "runPlanReview").mockResolvedValue(makeRun({ state: RunState.PlanReview }));

    await svc.rejectPlan("run-1");

    expect(agentSkillRepo.findTopKByRelevance).toHaveBeenCalledWith(
      "test-repo",
      expect.stringContaining("Add the thing"),
      expect.any(Number),
    );
    expect(deps.eventRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: "SKILL_INJECTION", payloadJson: { skillIds: ["skill-1"] } }),
    );
    expect(deps.plannerAgent.run.mock.calls[0][2].priorSkills).toEqual([skill]);
  });

  it("updateSkillMetrics increments success and archives low-utility skills when the run completes successfully", async () => {
    const deps = buildDeps();
    deps.runRepo.findById.mockResolvedValue(makeRun({ state: RunState.ReadyForHumanReview }));
    deps.runRepo.updateState.mockResolvedValue(makeRun({ state: RunState.Done }));
    deps.eventRepo.findByRunId.mockResolvedValue([
      { eventType: "SKILL_INJECTION", payloadJson: { skillIds: ["skill-1", "skill-2"] } },
      { eventType: "SKILL_INJECTION", payloadJson: { skillIds: ["skill-1"] } },
    ]);
    const updatedSkill = { id: "skill-1" };
    const agentSkillRepo = {
      findTopKByRelevance: vi.fn(),
      incrementSuccess: vi.fn().mockResolvedValue(updatedSkill),
      incrementFailure: vi.fn(),
      archiveIfLowUtility: vi.fn().mockResolvedValue(undefined),
    };

    const svc = new OrchestratorService({ ...deps, agentSkillRepo } as never);
    await svc.approveHumanReview("run-1");

    expect(agentSkillRepo.incrementSuccess).toHaveBeenCalledWith("skill-1");
    expect(agentSkillRepo.incrementSuccess).toHaveBeenCalledWith("skill-2");
    expect(agentSkillRepo.incrementSuccess).toHaveBeenCalledTimes(2);
    expect(agentSkillRepo.archiveIfLowUtility).toHaveBeenCalledWith(updatedSkill);
  });

  it("updateSkillMetrics increments failure when the run fails, and swallows a per-skill update error", async () => {
    const deps = buildDeps();
    deps.runRepo.findById.mockResolvedValue(
      makeRun({ state: RunState.HumanClarificationNeeded, planVersion: 2 }),
    );
    // HumanClarificationNeeded -(CLARIFICATION_PROVIDED)-> Planning
    //   -(PLAN_CREATED)-> PlanReview -(CLARIFICATION_EXHAUSTED)-> Failed
    deps.runRepo.updateState
      .mockResolvedValueOnce(makeRun({ state: RunState.Planning }))
      .mockResolvedValueOnce(makeRun({ state: RunState.PlanReview }))
      .mockResolvedValueOnce(makeRun({ state: RunState.Failed }));
    deps.eventRepo.findByRunId.mockResolvedValue([
      { eventType: "SKILL_INJECTION", payloadJson: { skillIds: ["skill-1"] } },
      { eventType: RunEvent.NEEDS_HUMAN_CLARIFICATION as string },
      { eventType: RunEvent.NEEDS_HUMAN_CLARIFICATION as string },
      { eventType: RunEvent.NEEDS_HUMAN_CLARIFICATION as string },
    ]);
    const agentSkillRepo = {
      findTopKByRelevance: vi.fn(),
      incrementSuccess: vi.fn(),
      incrementFailure: vi.fn().mockRejectedValue(new Error("db down")),
      archiveIfLowUtility: vi.fn(),
    };
    const taskBundlePayload = {
      issue: { id: "LIN-1", title: "t", description: "d", labels: [], priority: 1 },
      repo: {
        name: "test-repo",
        defaultBranch: "main",
        workingBranch: "ai/run-1",
        repoPath: "/tmp/worktree",
        allowedPaths: [],
        protectedPaths: [],
      },
      constraints: {
        requiredChecks: [],
        maxFilesChanged: 10,
        maxDiffLines: 500,
        forbiddenPatterns: [],
        mustNotTouch: [],
      },
      definitionOfDone: [],
    };
    deps.artifactRepo.findLatestByType.mockImplementation((_id: string, type: string) => {
      // The stored Plan has no *required* open questions, so answering with
      // an empty list passes validation; the planner's re-plan (below) still
      // has a blocking question, driving the run to CLARIFICATION_EXHAUSTED.
      if (type === "Plan") return Promise.resolve({ payloadJson: makePlan({ openQuestions: [] }) });
      if (type === "TaskBundle") return Promise.resolve({ payloadJson: taskBundlePayload });
      return Promise.resolve(null);
    });
    deps.plannerAgent.run.mockResolvedValue(
      makePlan({
        planVersion: 3,
        openQuestions: [{ id: "q1", question: "Which env?", requiredForExecution: true }],
      }),
    );
    deps.runRepo.update.mockResolvedValue(makeRun({ state: RunState.Planning, planVersion: 3 }));

    const svc = new OrchestratorService({ ...deps, agentSkillRepo } as never);
    const result = await svc.answerQuestions("run-1", []);

    expect(result.state).toBe(RunState.Failed);
    expect(agentSkillRepo.incrementFailure).toHaveBeenCalledWith("skill-1");
    expect(agentSkillRepo.archiveIfLowUtility).not.toHaveBeenCalled();
    expect(deps.logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ runId: "run-1", skillId: "skill-1", error: "db down" }),
      "Failed to update skill metric",
    );
  });

  it("updateSkillMetrics is a no-op when there are no SKILL_INJECTION events", async () => {
    const deps = buildDeps();
    deps.runRepo.findById.mockResolvedValue(makeRun({ state: RunState.ReadyForHumanReview }));
    deps.runRepo.updateState.mockResolvedValue(makeRun({ state: RunState.Done }));
    deps.eventRepo.findByRunId.mockResolvedValue([]);
    const agentSkillRepo = {
      findTopKByRelevance: vi.fn(),
      incrementSuccess: vi.fn(),
      incrementFailure: vi.fn(),
      archiveIfLowUtility: vi.fn(),
    };

    const svc = new OrchestratorService({ ...deps, agentSkillRepo } as never);
    await svc.approveHumanReview("run-1");

    expect(agentSkillRepo.incrementSuccess).not.toHaveBeenCalled();
  });
});

describe("OrchestratorService.cleanupRunWorktree (via transitionAndRecord Done branch)", () => {
  it("removes the worktree when the run's working directory differs from the main repo path", async () => {
    const deps = buildDeps();
    deps.runRepo.findById.mockResolvedValue(
      makeRun({ state: RunState.ReadyForHumanReview, workingDirectory: "/tmp/worktree-run-1" }),
    );
    deps.runRepo.updateState.mockResolvedValue(
      makeRun({ state: RunState.Done, workingDirectory: "/tmp/worktree-run-1" }),
    );
    deps.gitService.resolveMainRepoPath.mockReturnValue("/tmp/main-repo");

    const svc = new OrchestratorService(deps as never);
    await svc.approveHumanReview("run-1");

    expect(deps.gitService.removeWorktree).toHaveBeenCalledWith(
      "/tmp/main-repo",
      "/tmp/worktree-run-1",
    );
  });

  it("does not attempt removal when the working directory already is the main repo path", async () => {
    const deps = buildDeps();
    deps.runRepo.findById.mockResolvedValue(
      makeRun({ state: RunState.ReadyForHumanReview, workingDirectory: "/tmp/main-repo" }),
    );
    deps.runRepo.updateState.mockResolvedValue(
      makeRun({ state: RunState.Done, workingDirectory: "/tmp/main-repo" }),
    );
    deps.gitService.resolveMainRepoPath.mockReturnValue("/tmp/main-repo");

    const svc = new OrchestratorService(deps as never);
    await svc.approveHumanReview("run-1");

    expect(deps.gitService.removeWorktree).not.toHaveBeenCalled();
  });
});

describe("OrchestratorService.buildTaskBundle (via runExecution/formatExecutionReportComment)", () => {
  it("warns and uses the remote default branch when it differs from the configured value", async () => {
    const deps = buildDeps();
    deps.runRepo.findById.mockResolvedValue(makeRun({ state: RunState.Implementing, approvedPlanVersion: 2 }));
    deps.artifactRepo.findLatestByType.mockImplementation((_id: string, type: string) =>
      type === "Plan" ? Promise.resolve({ payloadJson: makePlan() }) : Promise.resolve(null),
    );
    deps.githubClient.getDefaultBranch.mockResolvedValue("trunk");
    deps.executorAgent.run.mockResolvedValue({ report: makeExecutionReport(), prNumber: 7 });
    deps.runRepo.update.mockResolvedValue(makeRun({ state: RunState.Implementing, prNumber: 7 }));
    deps.runRepo.updateState.mockResolvedValue(makeRun({ state: RunState.AIReview }));

    const svc = new OrchestratorService(deps as never);
    vi.spyOn(svc, "runReview").mockResolvedValue(makeRun({ state: RunState.AIReview }));

    await svc.runExecution("run-1");

    expect(deps.logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ repo: "test-repo", config: "main", remote: "trunk" }),
      "Config defaultBranch differs from GitHub, using remote value",
    );
  });

  it("falls back to the configured default branch when GitHub lookup fails", async () => {
    const deps = buildDeps();
    deps.runRepo.findById.mockResolvedValue(makeRun({ state: RunState.Implementing, approvedPlanVersion: 2 }));
    deps.artifactRepo.findLatestByType.mockImplementation((_id: string, type: string) =>
      type === "Plan" ? Promise.resolve({ payloadJson: makePlan() }) : Promise.resolve(null),
    );
    deps.githubClient.getDefaultBranch.mockRejectedValue(new Error("github down"));
    deps.executorAgent.run.mockResolvedValue({ report: makeExecutionReport(), prNumber: 7 });
    deps.runRepo.update.mockResolvedValue(makeRun({ state: RunState.Implementing, prNumber: 7 }));
    deps.runRepo.updateState.mockResolvedValue(makeRun({ state: RunState.AIReview }));

    const svc = new OrchestratorService(deps as never);
    vi.spyOn(svc, "runReview").mockResolvedValue(makeRun({ state: RunState.AIReview }));

    await svc.runExecution("run-1");

    expect(deps.logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ repo: "test-repo", error: "github down" }),
      "Failed to resolve default branch from GitHub, falling back to config value",
    );
  });
});

describe("OrchestratorService.formatExecutionReportComment (via runExecution, file/notes branches)", () => {
  it("collapses the file list into a <details> block when there are more than 8 files, and includes notes", async () => {
    const deps = buildDeps();
    deps.runRepo.findById.mockResolvedValue(makeRun({ state: RunState.Implementing, approvedPlanVersion: 2 }));
    deps.artifactRepo.findLatestByType.mockImplementation((_id: string, type: string) =>
      type === "Plan" ? Promise.resolve({ payloadJson: makePlan() }) : Promise.resolve(null),
    );
    const manyFiles = Array.from({ length: 9 }, (_, i) => `src/file${i}.ts`);
    deps.executorAgent.run.mockResolvedValue({
      report: makeExecutionReport({ filesChanged: manyFiles, notes: ["Watch out for X"] }),
      prNumber: 7,
    });
    deps.runRepo.update.mockResolvedValue(makeRun({ state: RunState.Implementing, prNumber: 7 }));
    deps.runRepo.updateState.mockResolvedValue(makeRun({ state: RunState.AIReview }));

    const svc = new OrchestratorService(deps as never);
    vi.spyOn(svc, "runReview").mockResolvedValue(makeRun({ state: RunState.AIReview }));

    await svc.runExecution("run-1");

    const comment = deps.linearClient.postComment.mock.calls.find(
      (c: unknown[]) => typeof c[1] === "string" && (c[1] as string).includes("Execution Report"),
    )?.[1] as string;
    expect(comment).toContain("<details>");
    expect(comment).toContain("Files changed (9)");
    expect(comment).toContain("### Notes");
    expect(comment).toContain("Watch out for X");
  });

  it("omits the files and notes sections when there are none", async () => {
    const deps = buildDeps();
    deps.runRepo.findById.mockResolvedValue(makeRun({ state: RunState.Implementing, approvedPlanVersion: 2 }));
    deps.artifactRepo.findLatestByType.mockImplementation((_id: string, type: string) =>
      type === "Plan" ? Promise.resolve({ payloadJson: makePlan() }) : Promise.resolve(null),
    );
    deps.executorAgent.run.mockResolvedValue({
      report: makeExecutionReport({ filesChanged: [], notes: [] }),
      prNumber: 7,
    });
    deps.runRepo.update.mockResolvedValue(makeRun({ state: RunState.Implementing, prNumber: 7 }));
    deps.runRepo.updateState.mockResolvedValue(makeRun({ state: RunState.AIReview }));

    const svc = new OrchestratorService(deps as never);
    vi.spyOn(svc, "runReview").mockResolvedValue(makeRun({ state: RunState.AIReview }));

    await svc.runExecution("run-1");

    const comment = deps.linearClient.postComment.mock.calls.find(
      (c: unknown[]) => typeof c[1] === "string" && (c[1] as string).includes("Execution Report"),
    )?.[1] as string;
    expect(comment).not.toContain("Files changed");
    expect(comment).not.toContain("### Notes");
  });
});
