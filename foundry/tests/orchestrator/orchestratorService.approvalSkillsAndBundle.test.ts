import { describe, it, expect, vi } from "vitest";
import { OrchestratorService } from "../../src/orchestrator/orchestratorService.js";
import { RunState } from "../../src/domain/runState.js";
import type { Run } from "../../src/domain/types.js";

function makeRun(overrides: Partial<Run> = {}): Run {
  return {
    id: "run-1",
    linearIssueId: "LIN-1",
    linearIssueIdentifier: "ENG-1",
    linearIssueDescription: "A description of the issue that is reasonably long",
    linearIssueTitle: "Fix the thing",
    linearIssueUrl: null,
    repo: "test-repo",
    branchName: "ai/run-1",
    prNumber: 42,
    state: RunState.ReadyForHumanReview,
    planVersion: 1,
    approvedPlanVersion: 1,
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
      title: "Fix the thing",
      description: "A description of the issue that is reasonably long",
      branchName: "ai/run-1",
      labels: [],
      priority: 0,
    }),
    postComment: vi.fn().mockResolvedValue(undefined),
  };

  const githubClient = { getPRDiff: vi.fn() };

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
    githubClient,
    gitService,
    plannerAgent,
    logger,
  };
}

describe("OrchestratorService.approveHumanReview", () => {
  it("runs distillation, transitions to Done, posts the completion comment, and cleans up the worktree", async () => {
    const distillationAgent = { run: vi.fn().mockResolvedValue(undefined) };
    const { deps, runRepo, linearClient } = buildDeps({ distillationAgent });
    const svc = new OrchestratorService(deps as never);

    const readyRun = makeRun({ state: RunState.ReadyForHumanReview });
    const doneRun = makeRun({ state: RunState.Done });

    runRepo.findById.mockResolvedValue(readyRun);
    runRepo.updateState.mockResolvedValue(doneRun);

    const result = await svc.approveHumanReview("run-1");

    expect(distillationAgent.run).toHaveBeenCalledWith("run-1", readyRun);
    expect(linearClient.postComment).toHaveBeenCalledWith("LIN-1", "Human review approved. Run is **Done**.");
    expect(result.state).toBe(RunState.Done);
    // Done state triggers worktree cleanup.
    expect((deps.gitService as { removeWorktree: ReturnType<typeof vi.fn> }).removeWorktree).toHaveBeenCalled();
  });

  it("swallows distillation agent errors (best-effort) and still completes the run", async () => {
    const distillationAgent = { run: vi.fn().mockRejectedValue(new Error("distillation blew up")) };
    const { deps, runRepo, linearClient, logger } = buildDeps({ distillationAgent });
    const svc = new OrchestratorService(deps as never);

    runRepo.findById.mockResolvedValue(makeRun({ state: RunState.ReadyForHumanReview }));
    runRepo.updateState.mockResolvedValue(makeRun({ state: RunState.Done }));

    const result = await svc.approveHumanReview("run-1");

    expect(result.state).toBe(RunState.Done);
    expect(linearClient.postComment).toHaveBeenCalled();
    const warnCall = (logger.warn as ReturnType<typeof vi.fn>).mock.calls.find(
      (c: unknown[]) => typeof c[1] === "string" && (c[1] as string).includes("Distillation agent failed"),
    );
    expect(warnCall).toBeDefined();
    expect((warnCall![0] as { error: string }).error).toBe("distillation blew up");
  });

  it("completes the run normally when no distillation agent is configured", async () => {
    const { deps, runRepo, linearClient } = buildDeps(); // no distillationAgent key at all
    const svc = new OrchestratorService(deps as never);

    runRepo.findById.mockResolvedValue(makeRun({ state: RunState.ReadyForHumanReview }));
    runRepo.updateState.mockResolvedValue(makeRun({ state: RunState.Done }));

    const result = await svc.approveHumanReview("run-1");

    expect(result.state).toBe(RunState.Done);
    expect(linearClient.postComment).toHaveBeenCalled();
  });
});

describe("OrchestratorService skill injection and metrics (via startRun / transitionAndRecord)", () => {
  it("injects top-ranked skills into the planner and records a SKILL_INJECTION event when skills are found", async () => {
    const agentSkillRepo = {
      findTopKByRelevance: vi.fn().mockResolvedValue([
        {
          id: "skill-1",
          repoSlug: "test-repo",
          name: "Deploy pattern",
          description: "How we deploy",
          taskCategory: "deploy",
          skillMarkdown: "# Deploy\n...",
          utilityScore: 0.8,
          lastUsedAt: new Date(),
        },
      ]),
      incrementSuccess: vi.fn(),
      incrementFailure: vi.fn(),
      archiveIfLowUtility: vi.fn(),
    };
    const { deps, runRepo, artifactRepo, eventRepo, plannerAgent } = buildDeps({ agentSkillRepo });
    const svc = new OrchestratorService(deps as never);

    const todoRun = makeRun({ id: "run-1", state: RunState.Todo, branchName: null, prNumber: null });
    runRepo.findActiveByIssueId.mockResolvedValue(null);
    runRepo.create.mockResolvedValue(todoRun);
    (deps.repoRegistry as { resolveForIssue: ReturnType<typeof vi.fn> }).resolveForIssue.mockReturnValue({
      name: "test-repo",
      defaultBranch: "main",
      allowedPaths: ["src/"],
      protectedPaths: [],
      constraints: { requiredChecks: [], maxFilesChanged: 10, maxDiffLines: 500, forbiddenPatterns: [], mustNotTouch: [] },
    });
    (deps.repoRegistry as { resolveWorkingDirectory: ReturnType<typeof vi.fn> }).resolveWorkingDirectory.mockReturnValue(
      "/tmp/repo",
    );
    (deps.gitService as { setupRunWorktree: ReturnType<typeof vi.fn> }).setupRunWorktree.mockResolvedValue({
      worktreePath: "/tmp/worktree",
      branchName: "ai/run-1",
    });
    runRepo.update
      .mockResolvedValueOnce({ ...todoRun, workingDirectory: "/tmp/worktree", branchName: "ai/run-1" })
      .mockResolvedValue({ ...todoRun, state: RunState.Planning, workingDirectory: "/tmp/worktree", branchName: "ai/run-1" });
    runRepo.updateState
      .mockResolvedValueOnce(makeRun({ state: RunState.Planning })) // RUN_REQUESTED
      .mockResolvedValueOnce(makeRun({ state: RunState.PlanReview })) // PLAN_CREATED
      .mockResolvedValueOnce(makeRun({ state: RunState.HumanClarificationNeeded })); // NEEDS_HUMAN_CLARIFICATION

    const blockedPlan = {
      planVersion: 1,
      summary: "s",
      assumptions: [],
      openQuestions: [{ id: "q1", question: "Blocking?", requiredForExecution: true }],
      risks: [],
      steps: [],
      testPlan: "t",
      confidence: 0.5,
    };
    plannerAgent.run.mockResolvedValue(blockedPlan);
    artifactRepo.findLatestByType.mockResolvedValue(null);

    await svc.startRun("LIN-1");

    expect(agentSkillRepo.findTopKByRelevance).toHaveBeenCalledWith(
      "test-repo",
      expect.stringContaining("Fix the thing"),
      expect.any(Number),
    );
    expect(plannerAgent.run).toHaveBeenCalledWith(
      expect.anything(),
      "run-1",
      expect.objectContaining({ priorSkills: expect.arrayContaining([expect.objectContaining({ id: "skill-1" })]) }),
    );
    const eventTypes = eventRepo.create.mock.calls.map((c: unknown[]) => (c[0] as { eventType: string }).eventType);
    expect(eventTypes).toContain("SKILL_INJECTION");
  });

  it("does not record a SKILL_INJECTION event when no skills match", async () => {
    const agentSkillRepo = {
      findTopKByRelevance: vi.fn().mockResolvedValue([]),
      incrementSuccess: vi.fn(),
      incrementFailure: vi.fn(),
      archiveIfLowUtility: vi.fn(),
    };
    const { deps, runRepo, artifactRepo, eventRepo, plannerAgent } = buildDeps({ agentSkillRepo });
    const svc = new OrchestratorService(deps as never);

    const todoRun = makeRun({ id: "run-1", state: RunState.Todo, branchName: null, prNumber: null });
    runRepo.findActiveByIssueId.mockResolvedValue(null);
    runRepo.create.mockResolvedValue(todoRun);
    (deps.repoRegistry as { resolveForIssue: ReturnType<typeof vi.fn> }).resolveForIssue.mockReturnValue({
      name: "test-repo",
      defaultBranch: "main",
      allowedPaths: ["src/"],
      protectedPaths: [],
      constraints: { requiredChecks: [], maxFilesChanged: 10, maxDiffLines: 500, forbiddenPatterns: [], mustNotTouch: [] },
    });
    (deps.repoRegistry as { resolveWorkingDirectory: ReturnType<typeof vi.fn> }).resolveWorkingDirectory.mockReturnValue(
      "/tmp/repo",
    );
    (deps.gitService as { setupRunWorktree: ReturnType<typeof vi.fn> }).setupRunWorktree.mockResolvedValue({
      worktreePath: "/tmp/worktree",
      branchName: "ai/run-1",
    });
    runRepo.update
      .mockResolvedValueOnce({ ...todoRun, workingDirectory: "/tmp/worktree", branchName: "ai/run-1" })
      .mockResolvedValue({ ...todoRun, state: RunState.Planning, workingDirectory: "/tmp/worktree", branchName: "ai/run-1" });
    runRepo.updateState
      .mockResolvedValueOnce(makeRun({ state: RunState.Planning })) // RUN_REQUESTED
      .mockResolvedValueOnce(makeRun({ state: RunState.PlanReview })) // PLAN_CREATED
      .mockResolvedValueOnce(makeRun({ state: RunState.HumanClarificationNeeded })); // NEEDS_HUMAN_CLARIFICATION

    const blockedPlan = {
      planVersion: 1,
      summary: "s",
      assumptions: [],
      openQuestions: [{ id: "q1", question: "Blocking?", requiredForExecution: true }],
      risks: [],
      steps: [],
      testPlan: "t",
      confidence: 0.5,
    };
    plannerAgent.run.mockResolvedValue(blockedPlan);
    artifactRepo.findLatestByType.mockResolvedValue(null);

    await svc.startRun("LIN-1");

    const eventTypes = eventRepo.create.mock.calls.map((c: unknown[]) => (c[0] as { eventType: string }).eventType);
    expect(eventTypes).not.toContain("SKILL_INJECTION");
  });

  it("updates skill metrics (increments success, archives if low utility) when the run finishes Done", async () => {
    const skillRecord = { id: "skill-1", successCount: 4, failureCount: 1, utilityScore: 0.1 };
    const agentSkillRepo = {
      findTopKByRelevance: vi.fn().mockResolvedValue([]),
      incrementSuccess: vi.fn().mockResolvedValue(skillRecord),
      incrementFailure: vi.fn().mockResolvedValue(skillRecord),
      archiveIfLowUtility: vi.fn().mockResolvedValue(undefined),
    };
    const { deps, runRepo, eventRepo } = buildDeps({ agentSkillRepo });
    const svc = new OrchestratorService(deps as never);

    runRepo.findById.mockResolvedValue(makeRun({ state: RunState.ReadyForHumanReview }));
    runRepo.updateState.mockResolvedValue(makeRun({ state: RunState.Done }));
    eventRepo.findByRunId.mockResolvedValue([
      {
        id: "e1",
        runId: "run-1",
        eventType: "SKILL_INJECTION",
        source: "orchestrator",
        payloadJson: { skillIds: ["skill-1"] },
        createdAt: new Date(),
      },
    ]);

    await svc.approveHumanReview("run-1");

    expect(agentSkillRepo.incrementSuccess).toHaveBeenCalledWith("skill-1");
    expect(agentSkillRepo.incrementFailure).not.toHaveBeenCalled();
    expect(agentSkillRepo.archiveIfLowUtility).toHaveBeenCalledWith(skillRecord);
  });

  it("increments failure metrics and swallows per-skill errors when the run finishes Failed", async () => {
    const agentSkillRepo = {
      findTopKByRelevance: vi.fn().mockResolvedValue([]),
      incrementSuccess: vi.fn(),
      incrementFailure: vi.fn().mockRejectedValue(new Error("db down")),
      archiveIfLowUtility: vi.fn(),
    };
    const { deps, runRepo, eventRepo, logger } = buildDeps({ agentSkillRepo });
    const svc = new OrchestratorService(deps as never);

    // Drive a transition into Failed directly via handleCommand's resume path is awkward;
    // instead exercise transitionAndRecord through answerQuestions' clarification-exhausted path.
    const run = makeRun({ state: RunState.HumanClarificationNeeded, planVersion: 1 });
    runRepo.findById.mockResolvedValue(run);
    runRepo.updateState
      .mockResolvedValueOnce(makeRun({ state: RunState.Planning }))
      .mockResolvedValueOnce(makeRun({ state: RunState.PlanReview }))
      .mockResolvedValueOnce(makeRun({ state: RunState.Failed }));
    runRepo.update.mockResolvedValue({ ...run, state: RunState.Planning, planVersion: 2 });

    const { artifactRepo, plannerAgent } = { artifactRepo: deps.artifactRepo as never, plannerAgent: deps.plannerAgent as { run: ReturnType<typeof vi.fn> } };
    (artifactRepo as { findLatestByType: ReturnType<typeof vi.fn> }).findLatestByType.mockImplementation(
      (_: string, type: string) => {
        if (type === "Plan")
          return Promise.resolve({
            id: "a1",
            runId: "run-1",
            type: "Plan",
            version: 1,
            payloadJson: {
              planVersion: 1,
              summary: "s",
              assumptions: [],
              openQuestions: [{ id: "q1", question: "Q", requiredForExecution: true }],
              risks: [],
              steps: [],
              testPlan: "t",
              confidence: 0.5,
            },
            rawText: "{}",
            createdAt: new Date(),
          });
        if (type === "TaskBundle")
          return Promise.resolve({
            id: "a2",
            runId: "run-1",
            type: "TaskBundle",
            version: 1,
            payloadJson: {
              issue: { id: "LIN-1", title: "t", description: "d", labels: [], priority: 0 },
              repo: { name: "test-repo", defaultBranch: "main", workingBranch: "ai/run-1", repoPath: "/tmp", allowedPaths: [], protectedPaths: [] },
              constraints: { requiredChecks: [], maxFilesChanged: 10, maxDiffLines: 500, forbiddenPatterns: [], mustNotTouch: [] },
              definitionOfDone: [],
            },
            rawText: "{}",
            createdAt: new Date(),
          });
        return Promise.resolve(null);
      },
    );
    plannerAgent.run.mockResolvedValue({
      planVersion: 2,
      summary: "s",
      assumptions: [],
      openQuestions: [{ id: "q1", question: "Still blocking", requiredForExecution: true }],
      risks: [],
      steps: [],
      testPlan: "t",
      confidence: 0.5,
    });
    eventRepo.findByRunId.mockResolvedValue([
      { id: "e1", runId: "run-1", eventType: "NEEDS_HUMAN_CLARIFICATION", source: "x", payloadJson: {}, createdAt: new Date() },
      { id: "e2", runId: "run-1", eventType: "NEEDS_HUMAN_CLARIFICATION", source: "x", payloadJson: {}, createdAt: new Date() },
      { id: "e3", runId: "run-1", eventType: "NEEDS_HUMAN_CLARIFICATION", source: "x", payloadJson: {}, createdAt: new Date() },
      { id: "e4", runId: "run-1", eventType: "SKILL_INJECTION", source: "orchestrator", payloadJson: { skillIds: ["skill-1"] }, createdAt: new Date() },
    ]);

    const result = await svc.answerQuestions("run-1", [{ questionId: "q1", answer: "still unsure" }]);

    expect(result.state).toBe(RunState.Failed);
    expect(agentSkillRepo.incrementFailure).toHaveBeenCalledWith("skill-1");
    const warnCall = (logger.warn as ReturnType<typeof vi.fn>).mock.calls.find(
      (c: unknown[]) => typeof c[1] === "string" && (c[1] as string).includes("Failed to update skill metric"),
    );
    expect(warnCall).toBeDefined();
  });
});

describe("OrchestratorService.buildTaskBundle default branch resolution (via runPlanReview)", () => {
  it("uses the remote default branch and logs a warning when it differs from config", async () => {
    const { deps, runRepo, artifactRepo, githubClient, logger, plannerAgent } = buildDeps();
    const svc = new OrchestratorService(deps as never);
    void plannerAgent;

    githubClient.getPRDiff.mockResolvedValue("");
    (githubClient as { getDefaultBranch: ReturnType<typeof vi.fn> }).getDefaultBranch = vi
      .fn()
      .mockResolvedValue("trunk");

    const plan = {
      planVersion: 1,
      summary: "s",
      assumptions: [],
      openQuestions: [],
      risks: [],
      steps: [],
      testPlan: "t",
      confidence: 0.9,
    };
    runRepo.findById.mockResolvedValue(makeRun({ state: RunState.PlanReview }));
    runRepo.updateState.mockResolvedValue(makeRun({ state: RunState.AwaitingPlanApproval }));
    artifactRepo.findLatestByType.mockImplementation((_: string, type: string) => {
      if (type === "Plan") return Promise.resolve({ id: "a", runId: "run-1", type: "Plan", version: 1, payloadJson: plan, rawText: "{}", createdAt: new Date() });
      return Promise.resolve(null);
    });
    (deps.planReviewerAgent as { run: ReturnType<typeof vi.fn> }).run.mockResolvedValue({
      overallVerdict: "approved",
      summary: "ok",
      findings: [],
    });

    await svc.runPlanReview("run-1");

    const warnCall = (logger.warn as ReturnType<typeof vi.fn>).mock.calls.find(
      (c: unknown[]) =>
        typeof c[1] === "string" && (c[1] as string).includes("Config defaultBranch differs from GitHub"),
    );
    expect(warnCall).toBeDefined();
    expect((warnCall![0] as { config: string; remote: string }).remote).toBe("trunk");
  });

  it("uses the config default branch without warning when it matches the remote", async () => {
    const { deps, runRepo, artifactRepo, githubClient, logger } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    (githubClient as { getDefaultBranch: ReturnType<typeof vi.fn> }).getDefaultBranch = vi
      .fn()
      .mockResolvedValue("main");

    const plan = {
      planVersion: 1,
      summary: "s",
      assumptions: [],
      openQuestions: [],
      risks: [],
      steps: [],
      testPlan: "t",
      confidence: 0.9,
    };
    runRepo.findById.mockResolvedValue(makeRun({ state: RunState.PlanReview }));
    runRepo.updateState.mockResolvedValue(makeRun({ state: RunState.AwaitingPlanApproval }));
    artifactRepo.findLatestByType.mockImplementation((_: string, type: string) => {
      if (type === "Plan") return Promise.resolve({ id: "a", runId: "run-1", type: "Plan", version: 1, payloadJson: plan, rawText: "{}", createdAt: new Date() });
      return Promise.resolve(null);
    });
    (deps.planReviewerAgent as { run: ReturnType<typeof vi.fn> }).run.mockResolvedValue({
      overallVerdict: "approved",
      summary: "ok",
      findings: [],
    });

    await svc.runPlanReview("run-1");

    const warnCall = (logger.warn as ReturnType<typeof vi.fn>).mock.calls.find(
      (c: unknown[]) =>
        typeof c[1] === "string" && (c[1] as string).includes("Config defaultBranch differs from GitHub"),
    );
    expect(warnCall).toBeUndefined();
  });
});
