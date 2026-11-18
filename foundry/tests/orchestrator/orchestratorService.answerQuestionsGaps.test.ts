import { describe, it, expect, vi } from "vitest";
import { OrchestratorService } from "../../src/orchestrator/orchestratorService.js";
import { RunState } from "../../src/domain/runState.js";
import { RunEvent } from "../../src/domain/runEvent.js";
import type { Run, Artifact, RunEventRecord } from "../../src/domain/types.js";
import type { Plan } from "../../src/schemas/plan.js";
import type { TaskBundle } from "../../src/schemas/taskBundle.js";

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
    state: RunState.HumanClarificationNeeded,
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

function makeTaskBundle(): TaskBundle {
  return {
    issue: { id: "LIN-1", title: "Test issue", description: "d", labels: [], priority: 0 },
    repo: {
      name: "test-repo",
      defaultBranch: "main",
      workingBranch: "ai/run-1",
      repoPath: "/tmp",
      allowedPaths: ["src/"],
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
}

function asArtifact(o: { type: string; version: number; payloadJson: unknown }): Artifact {
  return {
    id: `artifact-${o.type}-${o.version}-${Math.random().toString(36).slice(2, 7)}`,
    runId: "run-1",
    type: o.type as Artifact["type"],
    version: o.version,
    payloadJson: o.payloadJson,
    rawText: JSON.stringify(o.payloadJson),
    createdAt: new Date(),
  };
}

interface Store {
  run: Run;
  artifacts: Artifact[];
  events: RunEventRecord[];
}

function buildDeps(store: Store, overrides: Record<string, unknown> = {}) {
  const runRepo = {
    findById: vi.fn().mockImplementation(() => Promise.resolve({ ...store.run })),
    findActiveByIssueId: vi.fn(),
    findAll: vi.fn(),
    create: vi.fn(),
    findByIssueId: vi.fn(),
    updateState: vi.fn().mockImplementation((_id: string, newState: RunState) => {
      store.run = { ...store.run, state: newState };
      return Promise.resolve({ ...store.run });
    }),
    update: vi.fn().mockImplementation((_id: string, data: Partial<Run>) => {
      store.run = { ...store.run, ...data };
      return Promise.resolve({ ...store.run });
    }),
  };

  const artifactRepo = {
    create: vi.fn().mockImplementation((params: { type: string; version: number; payloadJson: unknown }) => {
      const a = asArtifact(params);
      store.artifacts.push(a);
      return Promise.resolve(a);
    }),
    findByRunId: vi.fn().mockImplementation(() => Promise.resolve([...store.artifacts])),
    findLatestByType: vi.fn().mockImplementation((_runId: string, type: string) => {
      const matching = store.artifacts.filter((a) => a.type === type);
      if (matching.length === 0) return Promise.resolve(null);
      return Promise.resolve(matching.reduce((best, cur) => (cur.version > best.version ? cur : best)));
    }),
  };

  const eventRepo = {
    create: vi.fn().mockImplementation((params: { runId: string; eventType: string; source: string; payloadJson?: unknown }) => {
      const e: RunEventRecord = {
        id: `evt-${store.events.length + 1}`,
        runId: params.runId,
        eventType: params.eventType,
        source: params.source,
        payloadJson: params.payloadJson ?? {},
        createdAt: new Date(),
      };
      store.events.push(e);
      return Promise.resolve(e);
    }),
    findByRunId: vi.fn().mockImplementation(() => Promise.resolve([...store.events])),
  };

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
    plannerAgent,
    planReviewerAgent,
    logger,
  };
}

describe("OrchestratorService.answerQuestions -- remaining gaps", () => {
  it("throws a plain Error when no Plan artifact exists for the run", async () => {
    const store: Store = { run: makeRun(), artifacts: [], events: [] };
    const { deps } = buildDeps(store);
    const svc = new OrchestratorService(deps as never);

    await expect(
      svc.answerQuestions("run-1", [{ questionId: "q1", answer: "yes" }]),
    ).rejects.toThrow(/No plan artifact found for run run-1/);
  });

  it("throws a plain Error when no TaskBundle artifact exists (HumanClarificationNeeded path)", async () => {
    const plan = makePlan({
      openQuestions: [{ id: "q1", question: "Required?", requiredForExecution: true }],
    });
    const store: Store = {
      run: makeRun(),
      artifacts: [asArtifact({ type: "Plan", version: 1, payloadJson: plan })],
      events: [],
    };
    const { deps } = buildDeps(store);
    const svc = new OrchestratorService(deps as never);

    await expect(
      svc.answerQuestions("run-1", [{ questionId: "q1", answer: "yes" }]),
    ).rejects.toThrow(/No TaskBundle artifact found for run run-1/);
  });

  it("transitions back to HumanClarificationNeeded (not Failed) when blockers remain but max iterations has not been reached", async () => {
    const plan = makePlan({
      openQuestions: [{ id: "q1", question: "Required?", requiredForExecution: true }],
    });
    const taskBundle = makeTaskBundle();
    const store: Store = {
      run: makeRun(),
      artifacts: [
        asArtifact({ type: "Plan", version: 1, payloadJson: plan }),
        asArtifact({ type: "TaskBundle", version: 1, payloadJson: taskBundle }),
      ],
      // One prior NEEDS_HUMAN_CLARIFICATION event -- below MAX_CLARIFICATION_ITERATIONS (3).
      events: [
        {
          id: "e1",
          runId: "run-1",
          eventType: RunEvent.NEEDS_HUMAN_CLARIFICATION,
          source: "planner-agent",
          payloadJson: {},
          createdAt: new Date(),
        },
      ],
    };
    const { deps, plannerAgent, planReviewerAgent, eventRepo } = buildDeps(store);
    const stillBlockedPlan = makePlan({
      planVersion: 2,
      openQuestions: [{ id: "q2", question: "Still unclear?", requiredForExecution: true }],
    });
    plannerAgent.run.mockResolvedValue(stillBlockedPlan);
    const svc = new OrchestratorService(deps as never);

    const result = await svc.answerQuestions("run-1", [{ questionId: "q1", answer: "an answer" }]);

    expect(planReviewerAgent.run).not.toHaveBeenCalled();
    const eventTypes = eventRepo.create.mock.calls.map((c) => (c[0] as { eventType: string }).eventType);
    expect(eventTypes).toEqual(
      expect.arrayContaining([
        RunEvent.CLARIFICATION_PROVIDED,
        RunEvent.PLAN_CREATED,
        RunEvent.NEEDS_HUMAN_CLARIFICATION,
      ]),
    );
    expect(result.state).toBe(RunState.HumanClarificationNeeded);
    const secondClarificationEvent = eventRepo.create.mock.calls.find(
      (c) =>
        (c[0] as { eventType: string }).eventType === RunEvent.NEEDS_HUMAN_CLARIFICATION,
    );
    expect(
      (secondClarificationEvent![0] as { payloadJson: { iteration: number } }).payloadJson.iteration,
    ).toBe(2);
  });

  it("preserves prior ResearchedAnswers context when re-running the planner with human answers", async () => {
    const plan = makePlan({
      openQuestions: [{ id: "q1", question: "Required?", requiredForExecution: true }],
    });
    const taskBundle = makeTaskBundle();
    const researched = {
      summary: "Researched",
      completedAt: new Date().toISOString(),
      answers: [{ questionId: "q9", question: "q9?", answer: "a9", confidence: "high" as const }],
    };
    const store: Store = {
      run: makeRun(),
      artifacts: [
        asArtifact({ type: "Plan", version: 1, payloadJson: plan }),
        asArtifact({ type: "TaskBundle", version: 1, payloadJson: taskBundle }),
        asArtifact({ type: "ResearchedAnswers", version: 1, payloadJson: researched }),
      ],
      events: [],
    };
    const { deps, plannerAgent, planReviewerAgent } = buildDeps(store);
    plannerAgent.run.mockResolvedValue(makePlan({ planVersion: 2, openQuestions: [] }));
    planReviewerAgent.run.mockResolvedValue({
      reviewId: "pr-1",
      summary: "ok",
      findings: [],
      overallVerdict: "approved",
    });
    const svc = new OrchestratorService(deps as never);

    await svc.answerQuestions("run-1", [{ questionId: "q1", answer: "yes" }]);

    expect(plannerAgent.run).toHaveBeenCalledWith(
      taskBundle,
      "run-1",
      expect.objectContaining({ researchedAnswers: researched.answers }),
    );
  });

  it("updates skill metrics as failures (and does not throw on a non-Error rejection) when clarification is exhausted into Failed", async () => {
    const plan = makePlan({
      openQuestions: [{ id: "q1", question: "Required?", requiredForExecution: true }],
    });
    const taskBundle = makeTaskBundle();
    const store: Store = {
      run: makeRun(),
      artifacts: [
        asArtifact({ type: "Plan", version: 1, payloadJson: plan }),
        asArtifact({ type: "TaskBundle", version: 1, payloadJson: taskBundle }),
      ],
      events: [
        {
          id: "e0",
          runId: "run-1",
          eventType: "SKILL_INJECTION",
          source: "orchestrator",
          payloadJson: { skillIds: ["skill-a"] },
          createdAt: new Date(),
        },
        ...Array.from({ length: 3 }, (_, i) => ({
          id: `e${i + 1}`,
          runId: "run-1",
          eventType: RunEvent.NEEDS_HUMAN_CLARIFICATION,
          source: "planner-agent",
          payloadJson: {},
          createdAt: new Date(),
        })),
      ],
    };
    const agentSkillRepo = {
      findTopKByRelevance: vi.fn(),
      incrementSuccess: vi.fn(),
      incrementFailure: vi.fn().mockRejectedValue("db unavailable"),
      archiveIfLowUtility: vi.fn(),
    };
    const { deps, plannerAgent, logger } = buildDeps(store, { agentSkillRepo });
    const stillBlockedPlan = makePlan({
      planVersion: 2,
      openQuestions: [{ id: "q2", question: "Still unclear?", requiredForExecution: true }],
    });
    plannerAgent.run.mockResolvedValue(stillBlockedPlan);
    const svc = new OrchestratorService(deps as never);

    const result = await svc.answerQuestions("run-1", [{ questionId: "q1", answer: "an answer" }]);

    expect(result.state).toBe(RunState.Failed);
    expect(agentSkillRepo.incrementFailure).toHaveBeenCalledWith("skill-a");
    expect(agentSkillRepo.incrementSuccess).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ runId: "run-1", skillId: "skill-a", error: "db unavailable" }),
      "Failed to update skill metric",
    );
  });

  it("completes the failure-path skill metric update normally (incrementFailure resolving, then archiveIfLowUtility) when clarification is exhausted", async () => {
    const plan = makePlan({
      openQuestions: [{ id: "q1", question: "Required?", requiredForExecution: true }],
    });
    const taskBundle = makeTaskBundle();
    const store: Store = {
      run: makeRun(),
      artifacts: [
        asArtifact({ type: "Plan", version: 1, payloadJson: plan }),
        asArtifact({ type: "TaskBundle", version: 1, payloadJson: taskBundle }),
      ],
      events: [
        {
          id: "e0",
          runId: "run-1",
          eventType: "SKILL_INJECTION",
          source: "orchestrator",
          payloadJson: { skillIds: ["skill-a"] },
          createdAt: new Date(),
        },
        ...Array.from({ length: 3 }, (_, i) => ({
          id: `e${i + 1}`,
          runId: "run-1",
          eventType: RunEvent.NEEDS_HUMAN_CLARIFICATION,
          source: "planner-agent",
          payloadJson: {},
          createdAt: new Date(),
        })),
      ],
    };
    const updatedSkill = {
      id: "skill-a",
      repoSlug: "test-repo",
      name: "n",
      description: "d",
      taskCategory: "cat",
      skillMarkdown: "md",
      successCount: 0,
      failureCount: 1,
      utilityScore: 0.1,
      lastUsedAt: new Date(),
    };
    const agentSkillRepo = {
      findTopKByRelevance: vi.fn(),
      incrementSuccess: vi.fn(),
      incrementFailure: vi.fn().mockResolvedValue(updatedSkill),
      archiveIfLowUtility: vi.fn().mockResolvedValue(undefined),
    };
    const { deps, plannerAgent } = buildDeps(store, { agentSkillRepo });
    const stillBlockedPlan = makePlan({
      planVersion: 2,
      openQuestions: [{ id: "q2", question: "Still unclear?", requiredForExecution: true }],
    });
    plannerAgent.run.mockResolvedValue(stillBlockedPlan);
    const svc = new OrchestratorService(deps as never);

    const result = await svc.answerQuestions("run-1", [{ questionId: "q1", answer: "an answer" }]);

    expect(result.state).toBe(RunState.Failed);
    expect(agentSkillRepo.incrementFailure).toHaveBeenCalledWith("skill-a");
    expect(agentSkillRepo.archiveIfLowUtility).toHaveBeenCalledWith(updatedSkill);
  });
});
