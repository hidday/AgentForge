import { describe, it, expect, vi } from "vitest";
import { OrchestratorService } from "../../src/orchestrator/orchestratorService.js";
import { RunState } from "../../src/domain/runState.js";
import { RunEvent } from "../../src/domain/runEvent.js";
import type { Run, Artifact, RunEventRecord, SkillDocument } from "../../src/domain/types.js";
import type { Plan } from "../../src/schemas/plan.js";

function makeRun(overrides: Partial<Run> = {}): Run {
  return {
    id: "run-1",
    linearIssueId: "LIN-1",
    linearIssueIdentifier: null,
    linearIssueDescription: "Some description text",
    linearIssueTitle: "Some issue title",
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
  run: Run;
  artifacts: Artifact[];
  events: RunEventRecord[];
}

function buildDeps(store: TestStore, overrides: Record<string, unknown> = {}) {
  const runRepo = {
    findById: vi.fn().mockImplementation(() => Promise.resolve({ ...store.run })),
    findActiveByIssueId: vi.fn().mockResolvedValue(null),
    findAll: vi.fn(),
    create: vi.fn().mockImplementation(() => Promise.resolve({ ...store.run })),
    findByIssueId: vi.fn(),
    updateState: vi.fn().mockImplementation((_id: string, newState: RunState) => {
      store.run = { ...store.run, state: newState };
      return Promise.resolve({ ...store.run });
    }),
    update: vi.fn().mockImplementation((_id: string, patch: Partial<Run>) => {
      store.run = { ...store.run, ...patch };
      return Promise.resolve({ ...store.run });
    }),
  };

  const artifactRepo = {
    create: vi.fn().mockImplementation((params: { runId: string; type: string; version: number; payloadJson: unknown }) => {
      const a = asArtifact({ type: params.type, version: params.version, payloadJson: params.payloadJson });
      store.artifacts.push(a);
      return Promise.resolve(a);
    }),
    findByRunId: vi.fn().mockImplementation(() => Promise.resolve([...store.artifacts])),
    findLatestByType: vi.fn().mockImplementation((_runId: string, type: string) => {
      const matching = store.artifacts.filter((a) => a.type === type);
      if (matching.length === 0) return Promise.resolve(null);
      const latest = matching.reduce((best, cur) => (cur.version > best.version ? cur : best));
      return Promise.resolve(latest);
    }),
  };

  const eventRepo = {
    create: vi.fn().mockImplementation((params: { runId: string; eventType: string; source: string; payloadJson?: unknown }) => {
      const evt: RunEventRecord = {
        id: `event-${store.events.length + 1}`,
        runId: params.runId,
        eventType: params.eventType,
        source: params.source,
        payloadJson: params.payloadJson ?? {},
        createdAt: new Date(),
      };
      store.events.push(evt);
      return Promise.resolve(evt);
    }),
    findByRunId: vi.fn().mockImplementation(() => Promise.resolve([...store.events])),
  };

  const linearClient = {
    getIssue: vi.fn().mockResolvedValue({
      id: "LIN-1",
      title: "Some issue title",
      description: "Some description text",
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
    resolveForIssue: vi.fn().mockReturnValue({
      name: "test-repo",
      defaultBranch: "main",
      allowedPaths: ["src/"],
      protectedPaths: [],
      constraints: { requiredChecks: [], maxFilesChanged: 10, maxDiffLines: 500, forbiddenPatterns: [], mustNotTouch: [] },
    }),
    resolveWorkingDirectory: vi.fn().mockReturnValue("/tmp"),
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
    postRemediationResolutions: vi.fn(),
  };

  const plannerAgent = {
    run: vi.fn().mockImplementation(async () => {
      const plan = makePlan();
      await artifactRepo.create({
        runId: store.run.id,
        type: "Plan",
        version: plan.planVersion,
        payloadJson: plan,
      });
      return plan;
    }),
  };
  const planReviewerAgent = {
    run: vi.fn().mockImplementation(async () => {
      await artifactRepo.create({
        runId: store.run.id,
        type: "PlanReview",
        version: 1,
        payloadJson: { reviewId: "prv-1", summary: "ok", findings: [], overallVerdict: "approved" },
      });
      return { reviewId: "prv-1", summary: "ok", findings: [], overallVerdict: "approved" };
    }),
  };
  const planReviserAgent = { run: vi.fn() };
  const executorAgent = { run: vi.fn() };
  const reviewerAgent = { run: vi.fn() };
  const remediationAgent = { run: vi.fn() };
  const distillationAgent = undefined;

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
    gitService,
    logger,
  };
}

describe("OrchestratorService.buildTaskBundle -- default branch resolution", () => {
  it("uses the config defaultBranch and does not warn when GitHub agrees", async () => {
    const store: TestStore = { run: makeRun(), artifacts: [], events: [] };
    const built = buildDeps(store);
    built.githubClient.getDefaultBranch.mockResolvedValue("main");
    const svc = new OrchestratorService(built.deps as never);

    await svc.startRun("LIN-1");

    const bundle = built.plannerAgent.run.mock.calls[0][0];
    expect(bundle.repo.defaultBranch).toBe("main");
    expect(built.logger.warn).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.stringContaining("Config defaultBranch differs"),
    );
  });

  it("prefers the remote defaultBranch and warns when it differs from config", async () => {
    const store: TestStore = { run: makeRun(), artifacts: [], events: [] };
    const built = buildDeps(store);
    built.githubClient.getDefaultBranch.mockResolvedValue("trunk");
    const svc = new OrchestratorService(built.deps as never);

    await svc.startRun("LIN-1");

    const bundle = built.plannerAgent.run.mock.calls[0][0];
    expect(bundle.repo.defaultBranch).toBe("trunk");
    expect(built.logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ config: "main", remote: "trunk" }),
      "Config defaultBranch differs from GitHub, using remote value",
    );
  });

  it("falls back to the config defaultBranch and warns when GitHub lookup fails", async () => {
    const store: TestStore = { run: makeRun(), artifacts: [], events: [] };
    const built = buildDeps(store);
    built.githubClient.getDefaultBranch.mockRejectedValue(new Error("network down"));
    const svc = new OrchestratorService(built.deps as never);

    await svc.startRun("LIN-1");

    const bundle = built.plannerAgent.run.mock.calls[0][0];
    expect(bundle.repo.defaultBranch).toBe("main");
    expect(built.logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ repo: "test-repo", error: "network down" }),
      "Failed to resolve default branch from GitHub, falling back to config value",
    );
  });
});

describe("OrchestratorService.retrieveSkillsForPlanning", () => {
  function makeAgentSkillRepo(skills: SkillDocument[]) {
    return {
      findTopKByRelevance: vi.fn().mockResolvedValue(skills),
    };
  }

  it("passes an empty priorSkills array to the planner when no agentSkillRepo is configured", async () => {
    const store: TestStore = { run: makeRun(), artifacts: [], events: [] };
    const built = buildDeps(store);
    const svc = new OrchestratorService(built.deps as never);

    await svc.startRun("LIN-1");

    expect(built.plannerAgent.run).toHaveBeenCalledWith(
      expect.anything(),
      "run-1",
      expect.objectContaining({ priorSkills: [] }),
    );
  });

  it("queries findTopKByRelevance and records SKILL_INJECTION when skills are found", async () => {
    const skill: SkillDocument = {
      id: "skill-1",
      repoSlug: "test-repo",
      name: "Retry pattern",
      description: "How to retry",
      taskCategory: "reliability",
      skillMarkdown: "# Retry",
      utilityScore: 0.5,
      lastUsedAt: new Date(),
    };
    const agentSkillRepo = makeAgentSkillRepo([skill]);
    const store: TestStore = { run: makeRun(), artifacts: [], events: [] };
    const built = buildDeps(store, { agentSkillRepo });
    const svc = new OrchestratorService(built.deps as never);

    await svc.startRun("LIN-1");

    expect(agentSkillRepo.findTopKByRelevance).toHaveBeenCalledWith(
      "test-repo",
      expect.stringContaining("Some issue title"),
      expect.any(Number),
    );
    const eventTypes = built.eventRepo.create.mock.calls.map((c: unknown[]) => (c[0] as { eventType: string }).eventType);
    expect(eventTypes).toContain("SKILL_INJECTION");
    const injectionEvent = built.eventRepo.create.mock.calls.find(
      (c: unknown[]) => (c[0] as { eventType: string }).eventType === "SKILL_INJECTION",
    )?.[0] as { payloadJson: { skillIds: string[] } };
    expect(injectionEvent.payloadJson.skillIds).toEqual(["skill-1"]);
    expect(built.plannerAgent.run).toHaveBeenCalledWith(
      expect.anything(),
      "run-1",
      expect.objectContaining({ priorSkills: [skill] }),
    );
  });

  it("does not record SKILL_INJECTION when no skills are found", async () => {
    const agentSkillRepo = makeAgentSkillRepo([]);
    const store: TestStore = { run: makeRun(), artifacts: [], events: [] };
    const built = buildDeps(store, { agentSkillRepo });
    const svc = new OrchestratorService(built.deps as never);

    await svc.startRun("LIN-1");

    const eventTypes = built.eventRepo.create.mock.calls.map((c: unknown[]) => (c[0] as { eventType: string }).eventType);
    expect(eventTypes).not.toContain("SKILL_INJECTION");
  });
});

describe("OrchestratorService -- transitionAndRecord terminal-state side effects", () => {
  function makeAgentSkillRepo() {
    return {
      findTopKByRelevance: vi.fn().mockResolvedValue([]),
      incrementSuccess: vi.fn().mockResolvedValue({ id: "skill-1", successCount: 1, failureCount: 0, utilityScore: 0.5 }),
      incrementFailure: vi.fn().mockResolvedValue({ id: "skill-1", successCount: 0, failureCount: 1, utilityScore: 0.1 }),
      archiveIfLowUtility: vi.fn().mockResolvedValue(undefined),
    };
  }

  it("on Done: calls removeWorktree when the working directory is a separate worktree", async () => {
    const store: TestStore = {
      run: makeRun({ state: RunState.ReadyForHumanReview, workingDirectory: "/tmp/worktree" }),
      artifacts: [],
      events: [],
    };
    const built = buildDeps(store);
    built.gitService.resolveMainRepoPath.mockReturnValue("/tmp/main-repo");
    const svc = new OrchestratorService(built.deps as never);

    await svc.approveHumanReview("run-1");

    expect(built.gitService.removeWorktree).toHaveBeenCalledWith("/tmp/main-repo", "/tmp/worktree");
  });

  it("on Done: skips removeWorktree when the working directory IS the main repo path", async () => {
    const store: TestStore = {
      run: makeRun({ state: RunState.ReadyForHumanReview, workingDirectory: "/repo" }),
      artifacts: [],
      events: [],
    };
    const built = buildDeps(store);
    built.gitService.resolveMainRepoPath.mockReturnValue("/repo");
    const svc = new OrchestratorService(built.deps as never);

    await svc.approveHumanReview("run-1");

    expect(built.gitService.removeWorktree).not.toHaveBeenCalled();
  });

  it("on Done with prior SKILL_INJECTION events: increments success and dedupes skill ids across multiple events", async () => {
    const agentSkillRepo = makeAgentSkillRepo();
    const store: TestStore = {
      run: makeRun({ state: RunState.ReadyForHumanReview }),
      artifacts: [],
      events: [
        { id: "e1", runId: "run-1", eventType: "SKILL_INJECTION", source: "orchestrator", payloadJson: { skillIds: ["skill-1", "skill-2"] }, createdAt: new Date() },
        { id: "e2", runId: "run-1", eventType: "SKILL_INJECTION", source: "orchestrator", payloadJson: { skillIds: ["skill-1"] }, createdAt: new Date() },
      ],
    };
    const built = buildDeps(store, { agentSkillRepo });
    const svc = new OrchestratorService(built.deps as never);

    await svc.approveHumanReview("run-1");

    expect(agentSkillRepo.incrementSuccess).toHaveBeenCalledTimes(2);
    expect(agentSkillRepo.incrementSuccess).toHaveBeenCalledWith("skill-1");
    expect(agentSkillRepo.incrementSuccess).toHaveBeenCalledWith("skill-2");
    expect(agentSkillRepo.incrementFailure).not.toHaveBeenCalled();
    expect(agentSkillRepo.archiveIfLowUtility).toHaveBeenCalledTimes(2);
  });

  it("does not touch agentSkillRepo when there are no SKILL_INJECTION events", async () => {
    const agentSkillRepo = makeAgentSkillRepo();
    const store: TestStore = {
      run: makeRun({ state: RunState.ReadyForHumanReview }),
      artifacts: [],
      events: [],
    };
    const built = buildDeps(store, { agentSkillRepo });
    const svc = new OrchestratorService(built.deps as never);

    await svc.approveHumanReview("run-1");

    expect(agentSkillRepo.incrementSuccess).not.toHaveBeenCalled();
    expect(agentSkillRepo.incrementFailure).not.toHaveBeenCalled();
  });

  it("logs a warning and continues (does not throw) when incrementSuccess rejects for one of several skills", async () => {
    const agentSkillRepo = makeAgentSkillRepo();
    agentSkillRepo.incrementSuccess
      .mockRejectedValueOnce(new Error("db unavailable"))
      .mockResolvedValueOnce({ id: "skill-2", successCount: 1, failureCount: 0, utilityScore: 0.5 });
    const store: TestStore = {
      run: makeRun({ state: RunState.ReadyForHumanReview }),
      artifacts: [],
      events: [
        { id: "e1", runId: "run-1", eventType: "SKILL_INJECTION", source: "orchestrator", payloadJson: { skillIds: ["skill-1", "skill-2"] }, createdAt: new Date() },
      ],
    };
    const built = buildDeps(store, { agentSkillRepo });
    const svc = new OrchestratorService(built.deps as never);

    const result = await svc.approveHumanReview("run-1");

    expect(result.state).toBe(RunState.Done);
    expect(built.logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ runId: "run-1", skillId: "skill-1", error: "db unavailable" }),
      "Failed to update skill metric",
    );
    // The second skill's increment should still have been attempted despite the first failing.
    expect(agentSkillRepo.incrementSuccess).toHaveBeenCalledWith("skill-2");
    expect(agentSkillRepo.archiveIfLowUtility).toHaveBeenCalledTimes(1);
  });
});
