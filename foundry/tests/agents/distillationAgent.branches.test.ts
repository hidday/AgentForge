import { describe, it, expect, vi, beforeEach } from "vitest";
import { DistillationAgent } from "../../src/agents/distillationAgent.js";
import type { Run } from "../../src/domain/types.js";
import { RunState } from "../../src/domain/runState.js";

function makeRun(overrides: Partial<Run> = {}): Run {
  return {
    id: "run-1",
    linearIssueId: "LIN-1",
    linearIssueTitle: "Add auth middleware",
    linearIssueUrl: null,
    repo: "test-repo",
    branchName: null,
    prNumber: null,
    state: RunState.Done,
    planVersion: 1,
    approvedPlanVersion: 1,
    plannerRuntime: null,
    executorRuntime: null,
    reviewerRuntime: null,
    remediationRuntime: null,
    workingDirectory: "/tmp",
    latestArtifactVersion: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as Run;
}

function makeSkill(overrides: Record<string, unknown> = {}) {
  return {
    id: "skill-1",
    repoSlug: "test-repo",
    name: "auth-middleware",
    description: "Use when adding or changing auth middleware.",
    taskCategory: "auth middleware",
    skillMarkdown: "Use JWT tokens for auth.",
    successCount: 0,
    failureCount: 0,
    utilityScore: 0.5,
    lastUsedAt: new Date(),
    createdAt: new Date(),
    archivedAt: null,
    ...overrides,
  };
}

function makeDistillationOutput(decision: {
  shouldPersist: boolean;
  reason: string;
  skillMarkdown?: string;
  taskCategory?: string;
  name?: string;
  description?: string;
}) {
  return {
    raw: "raw output",
    parsed: {
      stage: "distillation" as const,
      payload: decision,
    },
  };
}

function buildDeps(overrides: Record<string, unknown> = {}) {
  const agentRunner = { run: vi.fn() };
  const artifactRepo = { findLatestByType: vi.fn(), findByRunId: vi.fn(), create: vi.fn() };
  const agentSkillRepo = {
    findActiveByRepo: vi.fn().mockResolvedValue([]),
    countActiveByRepo: vi.fn().mockResolvedValue(0),
    create: vi.fn().mockResolvedValue(makeSkill({ id: "new-skill-1" })),
    displaceAndCreate: vi.fn().mockResolvedValue({
      newSkill: makeSkill({ id: "new-skill-1" }),
      displacedSkillId: "displaced-skill-1",
    }),
    findById: vi.fn(),
    findLowestUtilityActive: vi.fn(),
    archiveById: vi.fn(),
    findTopKByRelevance: vi.fn().mockResolvedValue([]),
    incrementSuccess: vi.fn(),
    incrementFailure: vi.fn(),
    archiveIfLowUtility: vi.fn(),
  };
  const eventRepo = { create: vi.fn().mockResolvedValue({}), findByRunId: vi.fn() };
  const config = {
    MAX_SKILLS_PER_REPO: 5,
    NOVELTY_SIMILARITY_THRESHOLD: 0.5,
  };
  const logger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };

  const planArtifact = {
    id: "plan-artifact-1",
    runId: "run-1",
    type: "Plan" as const,
    version: 1,
    payloadJson: {
      planVersion: 1,
      summary: "Add JWT-based auth middleware.",
      requirementsTraceability: "",
      assumptions: ["Users already have accounts"],
      openQuestions: [],
      risks: ["Token expiry edge cases"],
      steps: [
        { id: "s1", title: "Add middleware", description: "Verify JWT on each request" },
      ],
      testPlan: "Add unit tests for middleware",
      confidence: 0.8,
    },
    rawText: "{}",
    createdAt: new Date(),
  };

  const executionArtifact = {
    id: "artifact-1",
    runId: "run-1",
    type: "ExecutionReport" as const,
    version: 1,
    payloadJson: {
      executionVersion: 1,
      summary: "Implemented JWT auth middleware.",
      filesChanged: ["src/middleware/auth.ts"],
      checks: {
        lint: { status: "pass", details: "ok" },
        typecheck: { status: "pass", details: "ok" },
        tests: { status: "pass", details: "ok" },
      },
      notes: ["Watch out for clock skew in token expiry checks"],
      prDraftCreated: true,
      score: 0.82,
      scoreRationale: "Implementation matches plan and all checks pass.",
    },
    rawText: '{"outcome":"success"}',
    createdAt: new Date(),
  };

  const remediationArtifact = {
    id: "remediation-artifact-1",
    runId: "run-1",
    type: "Remediation" as const,
    version: 1,
    payloadJson: {
      reviewId: "rev-1",
      resolution: [
        {
          findingId: "f1",
          status: "accepted",
          action: "Added null guard",
          rationale: "Real bug",
        },
      ],
      readyForHumanReview: true,
      executionReport: executionArtifact.payloadJson,
    },
    rawText: "{}",
    createdAt: new Date(),
  };

  artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
    if (type === "ExecutionReport") return Promise.resolve(executionArtifact);
    if (type === "Plan") return Promise.resolve(planArtifact);
    if (type === "Remediation") return Promise.resolve(remediationArtifact);
    return Promise.resolve(null);
  });

  return {
    agentRunner,
    artifactRepo,
    agentSkillRepo,
    eventRepo,
    config,
    logger,
    planArtifact,
    executionArtifact,
    remediationArtifact,
    ...overrides,
  };
}

function buildAgent(deps: ReturnType<typeof buildDeps>): DistillationAgent {
  return new DistillationAgent(
    deps.agentRunner as never,
    deps.artifactRepo as never,
    deps.agentSkillRepo as never,
    deps.eventRepo as never,
    deps.config,
    deps.logger as never,
  );
}

describe("DistillationAgent branch coverage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("field-aware summarizes a well-formed Plan/ExecutionReport/Remediation into the user prompt", async () => {
    const deps = buildDeps();
    deps.agentSkillRepo.findActiveByRepo.mockResolvedValue([]);
    deps.agentRunner.run.mockImplementation(async (_runtime: unknown, opts: { prompt: string }) => {
      // Capture the rendered prompt so we can assert on the field-aware summaries.
      (deps as unknown as { capturedPrompt: string }).capturedPrompt = opts.prompt;
      return makeDistillationOutput({ shouldPersist: false, reason: "trivial" });
    });

    const agent = buildAgent(deps);
    await agent.run("run-1", makeRun());

    const prompt = (deps as unknown as { capturedPrompt: string }).capturedPrompt;
    // summarizePlan fields
    expect(prompt).toContain("Add JWT-based auth middleware.");
    expect(prompt).toContain("Users already have accounts");
    expect(prompt).toContain("Token expiry edge cases");
    expect(prompt).toContain("Add middleware");
    expect(prompt).toContain("Add unit tests for middleware");
    // summarizeExecution fields
    expect(prompt).toContain("Implemented JWT auth middleware.");
    expect(prompt).toContain("src/middleware/auth.ts");
    expect(prompt).toContain("Watch out for clock skew");
    // summarizeRemediation fields
    expect(prompt).toContain("Remediation Summary");
    expect(prompt).toContain("Added null guard");
  });

  it("falls back to truncated JSON when the Plan artifact payload doesn't match PlanSchema", async () => {
    const deps = buildDeps();
    deps.artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
      if (type === "ExecutionReport")
        return Promise.resolve({
          id: "e1",
          runId: "run-1",
          type: "ExecutionReport",
          version: 1,
          payloadJson: {
            executionVersion: 1,
            summary: "Did the thing.",
            filesChanged: [],
            checks: {
              lint: { status: "pass", details: "" },
              typecheck: { status: "pass", details: "" },
              tests: { status: "pass", details: "" },
            },
            notes: [],
            prDraftCreated: false,
            score: 0.5,
            scoreRationale: "Fine.",
          },
          rawText: "{}",
          createdAt: new Date(),
        });
      if (type === "Plan")
        return Promise.resolve({
          id: "p1",
          runId: "run-1",
          type: "Plan",
          version: 1,
          payloadJson: { notAValidPlanShape: true },
          rawText: "{}",
          createdAt: new Date(),
        });
      return Promise.resolve(null);
    });
    deps.agentRunner.run.mockImplementation(async (_runtime: unknown, opts: { prompt: string }) => {
      (deps as unknown as { capturedPrompt: string }).capturedPrompt = opts.prompt;
      return makeDistillationOutput({ shouldPersist: false, reason: "trivial" });
    });

    const agent = buildAgent(deps);
    await agent.run("run-1", makeRun());

    const prompt = (deps as unknown as { capturedPrompt: string }).capturedPrompt;
    expect(prompt).toContain("notAValidPlanShape");
  });

  it("falls back to truncated JSON when the ExecutionReport artifact payload doesn't match its schema", async () => {
    const deps = buildDeps();
    deps.artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
      if (type === "ExecutionReport")
        return Promise.resolve({
          id: "e1",
          runId: "run-1",
          type: "ExecutionReport",
          version: 1,
          payloadJson: { thisIsNotAReport: 42 },
          rawText: "{}",
          createdAt: new Date(),
        });
      return Promise.resolve(null);
    });
    deps.agentRunner.run.mockImplementation(async (_runtime: unknown, opts: { prompt: string }) => {
      (deps as unknown as { capturedPrompt: string }).capturedPrompt = opts.prompt;
      return makeDistillationOutput({ shouldPersist: false, reason: "trivial" });
    });

    const agent = buildAgent(deps);
    await agent.run("run-1", makeRun());

    const prompt = (deps as unknown as { capturedPrompt: string }).capturedPrompt;
    expect(prompt).toContain("thisIsNotAReport");
  });

  it("falls back to a truncated JSON Remediation Summary when the Remediation artifact payload doesn't match its schema", async () => {
    const deps = buildDeps();
    deps.artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
      if (type === "ExecutionReport") return Promise.resolve(deps.executionArtifact);
      if (type === "Remediation")
        return Promise.resolve({
          id: "r1",
          runId: "run-1",
          type: "Remediation",
          version: 1,
          payloadJson: { garbage: true },
          rawText: "{}",
          createdAt: new Date(),
        });
      return Promise.resolve(null);
    });
    deps.agentRunner.run.mockImplementation(async (_runtime: unknown, opts: { prompt: string }) => {
      (deps as unknown as { capturedPrompt: string }).capturedPrompt = opts.prompt;
      return makeDistillationOutput({ shouldPersist: false, reason: "trivial" });
    });

    const agent = buildAgent(deps);
    await agent.run("run-1", makeRun());

    const prompt = (deps as unknown as { capturedPrompt: string }).capturedPrompt;
    expect(prompt).toContain("Remediation Summary");
    expect(prompt).toContain("garbage");
  });

  it("renders 'No plan artifact available' and empty remediation text when Plan/Remediation artifacts are absent", async () => {
    const deps = buildDeps();
    deps.artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
      if (type === "ExecutionReport") return Promise.resolve(deps.executionArtifact);
      return Promise.resolve(null);
    });
    deps.agentRunner.run.mockImplementation(async (_runtime: unknown, opts: { prompt: string }) => {
      (deps as unknown as { capturedPrompt: string }).capturedPrompt = opts.prompt;
      return makeDistillationOutput({ shouldPersist: false, reason: "trivial" });
    });

    const agent = buildAgent(deps);
    await agent.run("run-1", makeRun());

    const prompt = (deps as unknown as { capturedPrompt: string }).capturedPrompt;
    expect(prompt).toContain("No plan artifact available");
  });

  it("renders the existing skills summary text when active skills are present", async () => {
    const deps = buildDeps();
    deps.agentSkillRepo.findActiveByRepo.mockResolvedValue([
      makeSkill({
        name: null,
        taskCategory: "database migration",
        skillMarkdown: "Run migrations in order.",
      }),
    ]);
    deps.agentRunner.run.mockImplementation(async (_runtime: unknown, opts: { prompt: string }) => {
      (deps as unknown as { capturedPrompt: string }).capturedPrompt = opts.prompt;
      return makeDistillationOutput({ shouldPersist: false, reason: "trivial" });
    });

    const agent = buildAgent(deps);
    await agent.run("run-1", makeRun());

    const prompt = (deps as unknown as { capturedPrompt: string }).capturedPrompt;
    expect(prompt).toContain("database migration");
    expect(prompt).toContain("Run migrations in order.");
  });

  it("falls back to slugified taskCategory when the LLM omits a name, and to a default description when it omits one", async () => {
    const deps = buildDeps();
    deps.agentSkillRepo.findActiveByRepo.mockResolvedValue([]);
    deps.agentSkillRepo.countActiveByRepo.mockResolvedValue(0);
    deps.agentRunner.run.mockResolvedValue(
      makeDistillationOutput({
        shouldPersist: true,
        reason: "non-trivial insight",
        taskCategory: "Rate Limiting Strategy",
        skillMarkdown: "Use a token bucket.",
        // name and description intentionally omitted
      }),
    );

    const agent = buildAgent(deps);
    await agent.run("run-1", makeRun());

    expect(deps.agentSkillRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        repoSlug: "test-repo",
        name: "rate-limiting-strategy",
        description: "Use when working on Rate Limiting Strategy in test-repo.",
        taskCategory: "Rate Limiting Strategy",
        skillMarkdown: "Use a token bucket.",
      }),
    );
  });

  it("falls back to the default description when the LLM provides a whitespace-only description", async () => {
    const deps = buildDeps();
    deps.agentSkillRepo.findActiveByRepo.mockResolvedValue([]);
    deps.agentSkillRepo.countActiveByRepo.mockResolvedValue(0);
    deps.agentRunner.run.mockResolvedValue(
      makeDistillationOutput({
        shouldPersist: true,
        reason: "non-trivial insight",
        taskCategory: "caching",
        skillMarkdown: "Cache aggressively.",
        description: "   ",
      }),
    );

    const agent = buildAgent(deps);
    await agent.run("run-1", makeRun());

    expect(deps.agentSkillRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        description: "Use when working on caching in test-repo.",
      }),
    );
  });

  it("skips persistence when shouldPersist=true but taskCategory is blank/whitespace-only", async () => {
    const deps = buildDeps();
    deps.agentSkillRepo.findActiveByRepo.mockResolvedValue([]);
    deps.agentRunner.run.mockResolvedValue(
      makeDistillationOutput({
        shouldPersist: true,
        reason: "insight",
        taskCategory: "   ",
        skillMarkdown: "Some markdown.",
      }),
    );

    const agent = buildAgent(deps);
    await agent.run("run-1", makeRun());

    expect(deps.agentSkillRepo.create).not.toHaveBeenCalled();
    expect(deps.agentSkillRepo.displaceAndCreate).not.toHaveBeenCalled();
    expect(deps.eventRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        payloadJson: expect.objectContaining({
          shouldPersist: false,
          reason: "missing_required_skill_fields",
        }),
      }),
    );
  });

  it("renders '_none_' fallbacks for empty plan steps/risks/assumptions, and truncates >12 steps", async () => {
    const deps = buildDeps();
    const manySteps = Array.from({ length: 14 }, (_, i) => ({
      id: `s${i}`,
      title: `Step ${i}`,
      description: i === 0 ? "" : "Do something",
    }));
    deps.artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
      if (type === "ExecutionReport") return Promise.resolve(deps.executionArtifact);
      if (type === "Plan")
        return Promise.resolve({
          ...deps.planArtifact,
          payloadJson: {
            ...deps.planArtifact.payloadJson,
            assumptions: [],
            risks: [],
            steps: manySteps,
          },
        });
      return Promise.resolve(null);
    });
    deps.agentRunner.run.mockImplementation(async (_runtime: unknown, opts: { prompt: string }) => {
      (deps as unknown as { capturedPrompt: string }).capturedPrompt = opts.prompt;
      return makeDistillationOutput({ shouldPersist: false, reason: "trivial" });
    });

    const agent = buildAgent(deps);
    await agent.run("run-1", makeRun());

    const prompt = (deps as unknown as { capturedPrompt: string }).capturedPrompt;
    expect(prompt).toContain("**Assumptions**:\n_none_");
    expect(prompt).toContain("**Risks**:\n_none_");
    expect(prompt).toContain("…and 2 more steps");
  });

  it("truncates a bullet list (assumptions) that exceeds its display cap, and truncates an overlong summary", async () => {
    const deps = buildDeps();
    const manyAssumptions = Array.from({ length: 10 }, (_, i) => `Assumption number ${i}`);
    const longSummary = "S".repeat(650);
    deps.artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
      if (type === "ExecutionReport") return Promise.resolve(deps.executionArtifact);
      if (type === "Plan")
        return Promise.resolve({
          ...deps.planArtifact,
          payloadJson: {
            ...deps.planArtifact.payloadJson,
            summary: longSummary,
            assumptions: manyAssumptions,
          },
        });
      return Promise.resolve(null);
    });
    deps.agentRunner.run.mockImplementation(async (_runtime: unknown, opts: { prompt: string }) => {
      (deps as unknown as { capturedPrompt: string }).capturedPrompt = opts.prompt;
      return makeDistillationOutput({ shouldPersist: false, reason: "trivial" });
    });

    const agent = buildAgent(deps);
    await agent.run("run-1", makeRun());

    const prompt = (deps as unknown as { capturedPrompt: string }).capturedPrompt;
    // bulletList caps assumptions display at 8 and appends an overflow line.
    expect(prompt).toContain("- …and 2 more");
    // truncate() cuts the 650-char summary down to 600 chars plus an ellipsis.
    expect(prompt).toContain(`${"S".repeat(600)}…`);
    expect(prompt).not.toContain("S".repeat(601));
  });

  it("renders '_none_' for an empty plan.steps list", async () => {
    const deps = buildDeps();
    deps.artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
      if (type === "ExecutionReport") return Promise.resolve(deps.executionArtifact);
      if (type === "Plan")
        return Promise.resolve({
          ...deps.planArtifact,
          payloadJson: { ...deps.planArtifact.payloadJson, steps: [] },
        });
      return Promise.resolve(null);
    });
    deps.agentRunner.run.mockImplementation(async (_runtime: unknown, opts: { prompt: string }) => {
      (deps as unknown as { capturedPrompt: string }).capturedPrompt = opts.prompt;
      return makeDistillationOutput({ shouldPersist: false, reason: "trivial" });
    });

    const agent = buildAgent(deps);
    await agent.run("run-1", makeRun());

    const prompt = (deps as unknown as { capturedPrompt: string }).capturedPrompt;
    expect(prompt).toContain("**Steps**:\n_none_");
  });

  it("renders '_none_' for an empty filesChanged list and truncates >40 files", async () => {
    const deps = buildDeps();
    const manyFiles = Array.from({ length: 42 }, (_, i) => `src/file${i}.ts`);
    deps.artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
      if (type === "ExecutionReport")
        return Promise.resolve({
          ...deps.executionArtifact,
          payloadJson: { ...deps.executionArtifact.payloadJson, filesChanged: manyFiles },
        });
      return Promise.resolve(null);
    });
    deps.agentRunner.run.mockImplementation(async (_runtime: unknown, opts: { prompt: string }) => {
      (deps as unknown as { capturedPrompt: string }).capturedPrompt = opts.prompt;
      return makeDistillationOutput({ shouldPersist: false, reason: "trivial" });
    });

    const agent = buildAgent(deps);
    await agent.run("run-1", makeRun());

    const prompt = (deps as unknown as { capturedPrompt: string }).capturedPrompt;
    expect(prompt).toContain("…and 2 more");
  });

  it("renders '_none_' for an empty filesChanged list", async () => {
    const deps = buildDeps();
    deps.artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
      if (type === "ExecutionReport")
        return Promise.resolve({
          ...deps.executionArtifact,
          payloadJson: { ...deps.executionArtifact.payloadJson, filesChanged: [] },
        });
      return Promise.resolve(null);
    });
    deps.agentRunner.run.mockImplementation(async (_runtime: unknown, opts: { prompt: string }) => {
      (deps as unknown as { capturedPrompt: string }).capturedPrompt = opts.prompt;
      return makeDistillationOutput({ shouldPersist: false, reason: "trivial" });
    });

    const agent = buildAgent(deps);
    await agent.run("run-1", makeRun());

    const prompt = (deps as unknown as { capturedPrompt: string }).capturedPrompt;
    expect(prompt).toContain("**Files Changed** (0):\n_none_");
  });

  it("includes check details only for a failing check that has details, omitting them for an empty-details failure", async () => {
    const deps = buildDeps();
    deps.artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
      if (type === "ExecutionReport")
        return Promise.resolve({
          ...deps.executionArtifact,
          payloadJson: {
            ...deps.executionArtifact.payloadJson,
            checks: {
              lint: { status: "fail", details: "2 lint errors" },
              typecheck: { status: "fail", details: "" },
              tests: { status: "pass", details: "ok" },
            },
          },
        });
      return Promise.resolve(null);
    });
    deps.agentRunner.run.mockImplementation(async (_runtime: unknown, opts: { prompt: string }) => {
      (deps as unknown as { capturedPrompt: string }).capturedPrompt = opts.prompt;
      return makeDistillationOutput({ shouldPersist: false, reason: "trivial" });
    });

    const agent = buildAgent(deps);
    await agent.run("run-1", makeRun());

    const prompt = (deps as unknown as { capturedPrompt: string }).capturedPrompt;
    expect(prompt).toContain("- lint: fail — 2 lint errors");
    expect(prompt).toContain("- typecheck: fail\n");
    expect(prompt).not.toContain("- typecheck: fail — ");
  });

  it("renders '_none_' for empty remediation resolutions, and truncates >15 resolutions", async () => {
    const deps = buildDeps();
    const manyResolutions = Array.from({ length: 17 }, (_, i) => ({
      findingId: `f${i}`,
      status: "accepted" as const,
      action: "Fixed it",
      rationale: i === 0 ? "" : "Real bug",
    }));
    deps.artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
      if (type === "ExecutionReport") return Promise.resolve(deps.executionArtifact);
      if (type === "Remediation")
        return Promise.resolve({
          ...deps.remediationArtifact,
          payloadJson: { ...deps.remediationArtifact.payloadJson, resolution: manyResolutions },
        });
      return Promise.resolve(null);
    });
    deps.agentRunner.run.mockImplementation(async (_runtime: unknown, opts: { prompt: string }) => {
      (deps as unknown as { capturedPrompt: string }).capturedPrompt = opts.prompt;
      return makeDistillationOutput({ shouldPersist: false, reason: "trivial" });
    });

    const agent = buildAgent(deps);
    await agent.run("run-1", makeRun());

    const prompt = (deps as unknown as { capturedPrompt: string }).capturedPrompt;
    expect(prompt).toContain("…and 2 more");
    // First item has an empty rationale, so its "*why*" line should be omitted.
    expect(prompt).toContain("- [accepted] f0: Fixed it\n");
  });

  it("renders '_none_' for an empty remediation resolutions list", async () => {
    const deps = buildDeps();
    deps.artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
      if (type === "ExecutionReport") return Promise.resolve(deps.executionArtifact);
      if (type === "Remediation")
        return Promise.resolve({
          ...deps.remediationArtifact,
          payloadJson: { ...deps.remediationArtifact.payloadJson, resolution: [] },
        });
      return Promise.resolve(null);
    });
    deps.agentRunner.run.mockImplementation(async (_runtime: unknown, opts: { prompt: string }) => {
      (deps as unknown as { capturedPrompt: string }).capturedPrompt = opts.prompt;
      return makeDistillationOutput({ shouldPersist: false, reason: "trivial" });
    });

    const agent = buildAgent(deps);
    await agent.run("run-1", makeRun());

    const prompt = (deps as unknown as { capturedPrompt: string }).capturedPrompt;
    expect(prompt).toContain("**Resolutions**:\n_none_");
  });

  it("falls back to an empty taskCategory hint in the prompt when linearIssueTitle is null", async () => {
    const deps = buildDeps();
    deps.agentRunner.run.mockImplementation(async (_runtime: unknown, opts: { prompt: string }) => {
      (deps as unknown as { capturedPrompt: string }).capturedPrompt = opts.prompt;
      return makeDistillationOutput({ shouldPersist: false, reason: "trivial" });
    });

    const agent = buildAgent(deps);
    await agent.run("run-1", makeRun({ linearIssueTitle: null }));

    const prompt = (deps as unknown as { capturedPrompt: string }).capturedPrompt;
    expect(prompt).toContain("**Task Category Hint**: \n");
  });

  it("includes the (truncated) linearIssueDescription in the novelty-check task query even when linearIssueTitle is null", async () => {
    const deps = buildDeps();
    // A skill whose content overlaps heavily with the *description* only —
    // if the description weren't folded into the novelty-check task query,
    // this near-empty-title run would not trip the novelty gate.
    deps.agentSkillRepo.findActiveByRepo.mockResolvedValue([
      {
        id: "skill-1",
        repoSlug: "test-repo",
        name: null,
        description: null,
        taskCategory: "token rotation strategy details",
        skillMarkdown: "token rotation strategy details for refresh tokens",
        successCount: 0,
        failureCount: 0,
        utilityScore: 0.5,
        lastUsedAt: new Date(),
        createdAt: new Date(),
        archivedAt: null,
      },
    ]);

    const agent = buildAgent(deps);
    await agent.run(
      "run-1",
      makeRun({
        linearIssueTitle: null,
        linearIssueDescription: "token rotation strategy details for refresh tokens",
      } as never),
    );

    // The LLM is never invoked because the (deterministic) novelty gate fired first.
    expect(deps.agentRunner.run).not.toHaveBeenCalled();
    expect(deps.eventRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        payloadJson: expect.objectContaining({
          shouldPersist: false,
          reason: expect.stringContaining("novelty_gate_failed"),
        }),
      }),
    );
  });

  it("logs String(err) when the agent runner rejects with a non-Error value", async () => {
    const deps = buildDeps();
    deps.agentSkillRepo.findActiveByRepo.mockResolvedValue([]);
    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    deps.agentRunner.run.mockRejectedValue("a plain string rejection");

    const agent = buildAgent(deps);
    await agent.run("run-1", makeRun());

    expect(deps.logger.warn).toHaveBeenCalledWith(
      { runId: "run-1", error: "a plain string rejection" },
      "Distillation LLM call failed or parse error",
    );
  });

  it("skips persistence when shouldPersist=true but skillMarkdown is blank/whitespace-only", async () => {
    const deps = buildDeps();
    deps.agentSkillRepo.findActiveByRepo.mockResolvedValue([]);
    deps.agentRunner.run.mockResolvedValue(
      makeDistillationOutput({
        shouldPersist: true,
        reason: "insight",
        taskCategory: "caching",
        skillMarkdown: "   ",
      }),
    );

    const agent = buildAgent(deps);
    await agent.run("run-1", makeRun());

    expect(deps.agentSkillRepo.create).not.toHaveBeenCalled();
    expect(deps.eventRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        payloadJson: expect.objectContaining({
          shouldPersist: false,
          reason: "missing_required_skill_fields",
        }),
      }),
    );
    expect(deps.logger.warn).toHaveBeenCalledWith(
      { runId: "run-1" },
      "Distillation missing taskCategory or skillMarkdown, skipping persist",
    );
  });
});
