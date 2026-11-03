import { describe, it, expect, vi } from "vitest";
import { OrchestratorService } from "../../src/orchestrator/orchestratorService.js";
import { RunState } from "../../src/domain/runState.js";
import { RunEvent } from "../../src/domain/runEvent.js";
import type { Run, RunEventRecord, SkillDocument } from "../../src/domain/types.js";
import type { ExecutionReport } from "../../src/schemas/executionReport.js";

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
    state: RunState.Implementing,
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

function makeExecutionReport(overrides: Partial<ExecutionReport> = {}): ExecutionReport {
  return {
    executionVersion: 1,
    summary: "Implemented the feature.",
    filesChanged: ["src/foo.ts"],
    checks: {
      lint: { status: "pass", details: "ok" },
      typecheck: { status: "pass", details: "ok" },
      tests: { status: "pass", details: "ok" },
    },
    notes: [],
    prDraftCreated: true,
    score: 0.9,
    scoreRationale: "Clean implementation.",
    ...overrides,
  };
}

function makeSkill(overrides: Partial<SkillDocument> = {}): SkillDocument {
  return {
    id: "skill-1",
    repoSlug: "test-repo",
    name: "Auth helper",
    description: "How to wire auth",
    taskCategory: "auth",
    skillMarkdown: "# do the thing",
    utilityScore: 0.5,
    lastUsedAt: new Date(),
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
    getIssue: vi.fn(),
    getRelatedContext: vi.fn(),
    postComment: vi.fn().mockResolvedValue(undefined),
  };

  const githubClient = { getPRDiff: vi.fn(), getDefaultBranch: vi.fn() };

  const repoRegistry = {
    resolveForIssue: vi.fn(),
    resolveWorkingDirectory: vi.fn(),
    validateWorkingDirectory: vi.fn(),
    getRepoByName: vi.fn(),
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
    gitService,
    logger,
  };
}

// Access to private methods for focused, direct unit coverage. These helpers
// are pure given their collaborator mocks, so calling them directly (rather
// than only indirectly through a public call site) lets us assert their
// branches precisely without re-building an entire run lifecycle.
type PrivateAccess = {
  cleanupRunWorktree(run: Run): Promise<void>;
  requireRun(runId: string): Promise<Run>;
  retrieveSkillsForPlanning(run: Run): Promise<SkillDocument[]>;
  updateSkillMetrics(runId: string, success: boolean): Promise<void>;
  formatExecutionReportComment(report: ExecutionReport): string;
  maybeResearchAndReplan(
    run: Run,
    plan: unknown,
    bundle: unknown,
  ): Promise<{ run: Run; plan: unknown }>;
  loadReplanContext(runId: string): Promise<{
    previousPlan?: unknown;
    humanAnswers?: unknown;
    researchedAnswers?: unknown;
    planReviewFindings?: unknown;
  }>;
  formatPlanComment(plan: unknown, statusNote?: string): string;
  formatPlanReviewComment(planReview: unknown): string;
  formatCodeReviewComment(review: unknown): string;
  buildTaskBundle(issue: unknown, run: Run): Promise<unknown>;
};

function asPrivate(svc: OrchestratorService): PrivateAccess {
  return svc as unknown as PrivateAccess;
}

describe("OrchestratorService.requireRun (direct)", () => {
  it("throws 'Run not found' when runRepo.findById returns null", async () => {
    const { deps, runRepo } = buildDeps();
    const svc = new OrchestratorService(deps as never);
    runRepo.findById.mockResolvedValue(null);

    await expect(asPrivate(svc).requireRun("ghost-run")).rejects.toThrow("Run not found: ghost-run");
  });

  it("returns the run when found", async () => {
    const { deps, runRepo } = buildDeps();
    const svc = new OrchestratorService(deps as never);
    const run = makeRun();
    runRepo.findById.mockResolvedValue(run);

    await expect(asPrivate(svc).requireRun("run-1")).resolves.toBe(run);
  });
});

describe("OrchestratorService.cleanupRunWorktree (direct)", () => {
  it("does nothing when the run's workingDirectory IS the main repo path", async () => {
    const { deps, gitService } = buildDeps();
    const svc = new OrchestratorService(deps as never);
    gitService.resolveMainRepoPath.mockReturnValue("/tmp/worktree");

    await asPrivate(svc).cleanupRunWorktree(makeRun({ workingDirectory: "/tmp/worktree" }));

    expect(gitService.removeWorktree).not.toHaveBeenCalled();
  });

  it("removes the worktree and logs when workingDirectory differs from the main repo path", async () => {
    const { deps, gitService, logger } = buildDeps();
    const svc = new OrchestratorService(deps as never);
    gitService.resolveMainRepoPath.mockReturnValue("/repos/test-repo");

    await asPrivate(svc).cleanupRunWorktree(makeRun({ workingDirectory: "/repos/test-repo/.worktrees/run-1" }));

    expect(gitService.removeWorktree).toHaveBeenCalledWith(
      "/repos/test-repo",
      "/repos/test-repo/.worktrees/run-1",
    );
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ worktreePath: "/repos/test-repo/.worktrees/run-1" }),
      "Cleaning up run worktree",
    );
  });

  it("is actually invoked by transitionAndRecord when a run reaches Failed", async () => {
    const { deps, runRepo, gitService } = buildDeps();
    const svc = new OrchestratorService(deps as never);
    gitService.resolveMainRepoPath.mockReturnValue("/repos/test-repo");
    const failingRun = makeRun({
      state: RunState.HumanClarificationNeeded,
      workingDirectory: "/repos/test-repo/.worktrees/run-1",
    });
    runRepo.updateState.mockResolvedValue({ ...failingRun, state: RunState.Failed });

    await (
      svc as unknown as {
        transitionAndRecord(run: Run, event: RunEvent, source: string): Promise<Run>;
      }
    ).transitionAndRecord(failingRun, RunEvent.CLARIFICATION_EXHAUSTED, "orchestrator");

    expect(gitService.removeWorktree).toHaveBeenCalledWith(
      "/repos/test-repo",
      "/repos/test-repo/.worktrees/run-1",
    );
  });
});

describe("OrchestratorService.retrieveSkillsForPlanning (direct)", () => {
  it("returns [] immediately when no agentSkillRepo is configured", async () => {
    const { deps } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    const result = await asPrivate(svc).retrieveSkillsForPlanning(makeRun());
    expect(result).toEqual([]);
  });

  it("queries by repo + issue title/description, returns skills, and records a SKILL_INJECTION event when skills are found", async () => {
    const agentSkillRepo = { findTopKByRelevance: vi.fn() };
    const { deps, eventRepo } = buildDeps({ agentSkillRepo });
    const svc = new OrchestratorService(deps as never);

    const skills = [makeSkill({ id: "skill-1" }), makeSkill({ id: "skill-2" })];
    agentSkillRepo.findTopKByRelevance.mockResolvedValue(skills);

    const run = makeRun({ linearIssueTitle: "Fix auth bug", linearIssueDescription: "Users can't log in" });
    const result = await asPrivate(svc).retrieveSkillsForPlanning(run);

    expect(agentSkillRepo.findTopKByRelevance).toHaveBeenCalledWith(
      "test-repo",
      expect.stringContaining("Fix auth bug"),
      expect.any(Number),
    );
    expect(result).toBe(skills);
    expect(eventRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "SKILL_INJECTION",
        payloadJson: { skillIds: ["skill-1", "skill-2"] },
      }),
    );
  });

  it("does NOT record a SKILL_INJECTION event when no skills are found", async () => {
    const agentSkillRepo = { findTopKByRelevance: vi.fn().mockResolvedValue([]) };
    const { deps, eventRepo } = buildDeps({ agentSkillRepo });
    const svc = new OrchestratorService(deps as never);

    const result = await asPrivate(svc).retrieveSkillsForPlanning(makeRun());

    expect(result).toEqual([]);
    expect(eventRepo.create).not.toHaveBeenCalled();
  });
});

describe("OrchestratorService.updateSkillMetrics (direct)", () => {
  it("is a no-op when no agentSkillRepo is configured", async () => {
    const { deps, eventRepo } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    await asPrivate(svc).updateSkillMetrics("run-1", true);

    expect(eventRepo.findByRunId).not.toHaveBeenCalled();
  });

  it("is a no-op when there are no SKILL_INJECTION events", async () => {
    const agentSkillRepo = {
      incrementSuccess: vi.fn(),
      incrementFailure: vi.fn(),
      archiveIfLowUtility: vi.fn(),
    };
    const { deps, eventRepo } = buildDeps({ agentSkillRepo });
    const svc = new OrchestratorService(deps as never);
    eventRepo.findByRunId.mockResolvedValue([]);

    await asPrivate(svc).updateSkillMetrics("run-1", true);

    expect(agentSkillRepo.incrementSuccess).not.toHaveBeenCalled();
  });

  it("on success: increments success and archives for each deduplicated injected skill id", async () => {
    const agentSkillRepo = {
      incrementSuccess: vi.fn().mockImplementation((id: string) => Promise.resolve({ id, utilityScore: 0.6 })),
      incrementFailure: vi.fn(),
      archiveIfLowUtility: vi.fn().mockResolvedValue(undefined),
    };
    const { deps, eventRepo } = buildDeps({ agentSkillRepo });
    const svc = new OrchestratorService(deps as never);

    const injectionEvents: RunEventRecord[] = [
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
        payloadJson: { skillIds: ["skill-2"] }, // duplicate -- should be deduped
        createdAt: new Date(),
      },
    ];
    eventRepo.findByRunId.mockResolvedValue(injectionEvents);

    await asPrivate(svc).updateSkillMetrics("run-1", true);

    expect(agentSkillRepo.incrementSuccess).toHaveBeenCalledTimes(2);
    expect(agentSkillRepo.incrementSuccess).toHaveBeenCalledWith("skill-1");
    expect(agentSkillRepo.incrementSuccess).toHaveBeenCalledWith("skill-2");
    expect(agentSkillRepo.incrementFailure).not.toHaveBeenCalled();
    expect(agentSkillRepo.archiveIfLowUtility).toHaveBeenCalledTimes(2);
  });

  it("on failure: increments failure for each injected skill id", async () => {
    const agentSkillRepo = {
      incrementSuccess: vi.fn(),
      incrementFailure: vi.fn().mockResolvedValue({ id: "skill-1", utilityScore: 0.1 }),
      archiveIfLowUtility: vi.fn().mockResolvedValue(undefined),
    };
    const { deps, eventRepo } = buildDeps({ agentSkillRepo });
    const svc = new OrchestratorService(deps as never);

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

    await asPrivate(svc).updateSkillMetrics("run-1", false);

    expect(agentSkillRepo.incrementFailure).toHaveBeenCalledWith("skill-1");
    expect(agentSkillRepo.incrementSuccess).not.toHaveBeenCalled();
  });

  it("swallows a per-skill error and logs a warning, continuing to the next skill id", async () => {
    const agentSkillRepo = {
      incrementSuccess: vi.fn().mockRejectedValue(new Error("db exploded")),
      incrementFailure: vi.fn(),
      archiveIfLowUtility: vi.fn(),
    };
    const { deps, eventRepo, logger } = buildDeps({ agentSkillRepo });
    const svc = new OrchestratorService(deps as never);

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

    await asPrivate(svc).updateSkillMetrics("run-1", true);

    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ runId: "run-1", skillId: "skill-1", error: "db exploded" }),
      "Failed to update skill metric",
    );
  });

  it("stringifies a non-Error throw value in the warning log", async () => {
    const agentSkillRepo = {
      incrementSuccess: vi.fn().mockRejectedValue("just a string failure"),
      incrementFailure: vi.fn(),
      archiveIfLowUtility: vi.fn(),
    };
    const { deps, eventRepo, logger } = buildDeps({ agentSkillRepo });
    const svc = new OrchestratorService(deps as never);

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

    await asPrivate(svc).updateSkillMetrics("run-1", true);

    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ error: "just a string failure" }),
      "Failed to update skill metric",
    );
  });

  it("falls back to an empty skillIds array when an injection event's payload omits it", async () => {
    const agentSkillRepo = {
      incrementSuccess: vi.fn(),
      incrementFailure: vi.fn(),
      archiveIfLowUtility: vi.fn(),
    };
    const { deps, eventRepo } = buildDeps({ agentSkillRepo });
    const svc = new OrchestratorService(deps as never);

    eventRepo.findByRunId.mockResolvedValue([
      {
        id: "e1",
        runId: "run-1",
        eventType: "SKILL_INJECTION",
        source: "orchestrator",
        payloadJson: {}, // no skillIds field at all
        createdAt: new Date(),
      },
    ]);

    await asPrivate(svc).updateSkillMetrics("run-1", true);

    expect(agentSkillRepo.incrementSuccess).not.toHaveBeenCalled();
  });
});

describe("OrchestratorService.formatPlanComment (direct)", () => {
  it("omits the status line entirely when no statusNote is given", () => {
    const { deps } = buildDeps();
    const svc = new OrchestratorService(deps as never);
    const plan = {
      planVersion: 1,
      summary: "Summary text",
      requirementsTraceability: "",
      assumptions: [],
      openQuestions: [],
      risks: [],
      steps: [{ id: "s1", title: "Step", description: "Desc" }],
      testPlan: "run tests",
      confidence: 0.5,
    };

    const comment = asPrivate(svc).formatPlanComment(plan);

    expect(comment).not.toContain("*undefined*");
    expect(comment).toContain("Summary text");
  });
});

describe("OrchestratorService.formatPlanReviewComment (direct)", () => {
  it("includes the affected step id when a finding has one, and renders the approved verdict label", () => {
    const { deps } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    const comment = asPrivate(svc).formatPlanReviewComment({
      reviewId: "rev-1",
      overallVerdict: "approved",
      summary: "All good",
      findings: [
        { id: "f1", severity: "nit", type: "style", title: "Nit", details: "d", affectedStepId: "s1" },
      ],
    });

    expect(comment).toContain("AI Plan Review -- Approved");
    expect(comment).toContain("(step s1)");
  });
});

describe("OrchestratorService.formatCodeReviewComment (direct)", () => {
  it("includes the line hint when a finding has one, and renders the approved verdict label", () => {
    const { deps } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    const comment = asPrivate(svc).formatCodeReviewComment({
      reviewId: "rev-1",
      overallVerdict: "approved",
      summary: "All good",
      findings: [
        { id: "f1", severity: "nit", type: "style", file: "src/a.ts", lineHint: 42, title: "Nit", details: "d" },
      ],
    });

    expect(comment).toContain("AI Code Review -- Approved");
    expect(comment).toContain("src/a.ts:42");
  });
});

describe("OrchestratorService.buildTaskBundle (direct) -- non-Error rejections", () => {
  it("stringifies a non-Error rejection from githubClient.getDefaultBranch", async () => {
    const githubClient = { getPRDiff: vi.fn(), getDefaultBranch: vi.fn().mockRejectedValue("network down") };
    const linearClient = { getIssue: vi.fn(), getRelatedContext: vi.fn().mockRejectedValue("linear down"), postComment: vi.fn() };
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
    const { deps, logger } = buildDeps({ githubClient, linearClient, repoRegistry });
    const svc = new OrchestratorService(deps as never);

    const run = makeRun();
    const issue = {
      id: "LIN-1",
      title: "T",
      description: "D",
      branchName: "ai/lin-1",
      labels: [],
      priority: 0,
    };

    await asPrivate(svc).buildTaskBundle(issue, run);

    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ error: "network down" }),
      "Failed to resolve default branch from GitHub, falling back to config value",
    );
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ error: "linear down" }),
      "Failed to fetch related Linear context; proceeding without it",
    );
  });
});

describe("OrchestratorService.maybeResearchAndReplan (direct)", () => {
  it("injects prior HumanAnswers into both the researcher call and the re-plan call when a HumanAnswers artifact exists", async () => {
    const answerResearcherAgent = { run: vi.fn() };
    const { deps, artifactRepo, eventRepo, runRepo, logger } = buildDeps({ answerResearcherAgent });
    const svc = new OrchestratorService(deps as never);

    const run = makeRun({ id: "run-9", planVersion: 1 });
    const plan = {
      planVersion: 1,
      summary: "s",
      requirementsTraceability: "",
      assumptions: [],
      openQuestions: [{ id: "q1", question: "Optional?", requiredForExecution: false }],
      risks: [],
      steps: [{ id: "s1", title: "t", description: "d" }],
      testPlan: "run tests",
      confidence: 0.8,
    };

    artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
      if (type === "ResearchedAnswers") return Promise.resolve(null);
      if (type === "HumanAnswers") {
        return Promise.resolve({
          id: "ha-1",
          runId: "run-9",
          type: "HumanAnswers",
          version: 1,
          payloadJson: { answers: [{ questionId: "q1", answer: "sure, do it" }] },
          rawText: "{}",
          createdAt: new Date(),
        });
      }
      return Promise.resolve(null);
    });

    answerResearcherAgent.run.mockResolvedValue({
      summary: "researched",
      answers: [{ questionId: "q1", question: "Optional?", answer: "Yes", confidence: "high", sources: [] }],
      completedAt: "2026-01-01T00:00:00Z",
    });

    const revisedPlan = { ...plan, planVersion: 2, openQuestions: [] };
    (deps as never as { plannerAgent: { run: ReturnType<typeof vi.fn> } }).plannerAgent.run.mockResolvedValue(revisedPlan);
    runRepo.update.mockResolvedValue({ ...run, planVersion: 2 });

    const bundle = { issue: { id: "LIN-1" } };
    const result = await asPrivate(svc).maybeResearchAndReplan(run, plan as never, bundle as never);

    expect(answerResearcherAgent.run).toHaveBeenCalledWith(plan, bundle, "run-9", {
      humanAnswers: [{ questionId: "q1", answer: "sure, do it" }],
    });
    expect((deps as never as { plannerAgent: { run: ReturnType<typeof vi.fn> } }).plannerAgent.run).toHaveBeenCalledWith(
      bundle,
      "run-9",
      expect.objectContaining({
        humanAnswers: [{ questionId: "q1", answer: "sure, do it" }],
        researchedAnswers: expect.arrayContaining([expect.objectContaining({ questionId: "q1" })]),
      }),
    );
    expect(eventRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: "RESEARCH_COMPLETED" }),
    );
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ runId: "run-9" }),
      "Re-planned after answer research",
    );
    expect((result.plan as { openQuestions: unknown[] }).openQuestions).toEqual([]);
  });
});

describe("OrchestratorService.formatExecutionReportComment (direct, via public call sites' private helper)", () => {
  it("collapses the files-changed list into a <details> block above the threshold", () => {
    const { deps } = buildDeps();
    const svc = new OrchestratorService(deps as never);
    const report = makeExecutionReport({
      filesChanged: Array.from({ length: 9 }, (_, i) => `src/file${i}.ts`),
      notes: ["Note one"],
    });

    const comment = asPrivate(svc).formatExecutionReportComment(report);

    expect(comment).toContain("<details>");
    expect(comment).toContain("Files changed (9)");
    expect(comment).toContain("### Notes");
    expect(comment).toContain("Note one");
  });

  it("lists files inline (no <details>) at or below the threshold, and omits the Notes section when empty", () => {
    const { deps } = buildDeps();
    const svc = new OrchestratorService(deps as never);
    const report = makeExecutionReport({ filesChanged: ["src/a.ts", "src/b.ts"], notes: [] });

    const comment = asPrivate(svc).formatExecutionReportComment(report);

    expect(comment).not.toContain("<details>");
    expect(comment).toContain("### Files changed (2)");
    expect(comment).not.toContain("### Notes");
  });

  it("omits the Files changed section entirely when no files changed", () => {
    const { deps } = buildDeps();
    const svc = new OrchestratorService(deps as never);
    const report = makeExecutionReport({ filesChanged: [] });

    const comment = asPrivate(svc).formatExecutionReportComment(report);

    expect(comment).not.toContain("Files changed");
  });

  it("renders a fail/skip check icon distinctly from pass", () => {
    const { deps } = buildDeps();
    const svc = new OrchestratorService(deps as never);
    const report = makeExecutionReport({
      checks: {
        lint: { status: "fail", details: "2 errors" },
        typecheck: { status: "skip", details: "n/a" },
        tests: { status: "pass", details: "ok" },
      },
    });

    const comment = asPrivate(svc).formatExecutionReportComment(report);

    expect(comment).toContain(":x: **Lint** -- 2 errors");
    expect(comment).toContain(":heavy_minus_sign: **Typecheck** -- n/a");
    expect(comment).toContain(":white_check_mark: **Tests** -- ok");
  });
});
