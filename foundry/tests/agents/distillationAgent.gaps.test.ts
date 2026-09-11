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
  };
}

function makeExecutionArtifact(overrides: Record<string, unknown> = {}) {
  return {
    id: "artifact-exec",
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
      notes: [],
      prDraftCreated: true,
      score: 0.82,
      scoreRationale: "Implementation matches plan and all checks pass.",
      ...overrides,
    },
    rawText: '{"outcome":"success"}',
    createdAt: new Date(),
  };
}

function makePlanArtifact(overrides: Record<string, unknown> = {}) {
  return {
    id: "artifact-plan",
    runId: "run-1",
    type: "Plan" as const,
    version: 1,
    payloadJson: {
      planVersion: 1,
      summary: "Add JWT auth middleware to protect API routes.",
      assumptions: ["Fastify is already configured", "Zod is available"],
      openQuestions: [],
      risks: ["Token expiry edge cases"],
      steps: [{ id: "s1", title: "Add middleware", description: "Wire up JWT verification" }],
      testPlan: "Run the auth middleware test suite.",
      confidence: 0.85,
      ...overrides,
    },
    rawText: "{}",
    createdAt: new Date(),
  };
}

function makeRemediationArtifact(overrides: Record<string, unknown> = {}) {
  return {
    id: "artifact-remediation",
    runId: "run-1",
    type: "Remediation" as const,
    version: 1,
    payloadJson: {
      reviewId: "rev-1",
      resolution: [
        {
          findingId: "f1",
          status: "accepted",
          action: "Fixed the missing null check.",
          rationale: "Prevents a crash on malformed input.",
        },
      ],
      readyForHumanReview: true,
      executionReport: makeExecutionArtifact().payloadJson,
      ...overrides,
    },
    rawText: "{}",
    createdAt: new Date(),
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

function buildDeps(
  artifactsByType: Record<string, ReturnType<typeof makeExecutionArtifact> | null>,
) {
  const agentRunner = { run: vi.fn() };
  const artifactRepo = {
    findLatestByType: vi
      .fn()
      .mockImplementation((_runId: string, type: string) => Promise.resolve(artifactsByType[type] ?? null)),
    findByRunId: vi.fn(),
    create: vi.fn(),
  };
  const agentSkillRepo = {
    findActiveByRepo: vi.fn().mockResolvedValue([]),
    countActiveByRepo: vi.fn().mockResolvedValue(0),
    create: vi.fn().mockResolvedValue({ id: "new-skill-1" }),
    displaceAndCreate: vi.fn(),
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

  return { agentRunner, artifactRepo, agentSkillRepo, eventRepo, config, logger };
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

describe("DistillationAgent — summarizer coverage gaps", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("summarizes a plan artifact with many steps/assumptions/risks, feeding the 'and N more' bullet branches into the prompt", async () => {
    const manySteps = Array.from({ length: 14 }, (_, i) => ({
      id: `s${i + 1}`,
      title: `Step ${i + 1}`,
      description: i === 0 ? "" : `Do thing ${i + 1}`,
    }));
    const manyAssumptions = Array.from({ length: 10 }, (_, i) => `Assumption ${i + 1}`);
    const manyRisks = Array.from({ length: 10 }, (_, i) => `Risk ${i + 1}`);

    const deps = buildDeps({
      Plan: makePlanArtifact({ steps: manySteps, assumptions: manyAssumptions, risks: manyRisks }),
      ExecutionReport: makeExecutionArtifact(),
      Remediation: null,
    });
    deps.agentRunner.run.mockResolvedValue(
      makeDistillationOutput({ shouldPersist: false, reason: "no insight" }),
    );

    const agent = buildAgent(deps);
    await agent.run("run-1", makeRun());

    expect(deps.agentRunner.run).toHaveBeenCalledOnce();
    const promptArg = (deps.agentRunner.run.mock.calls[0][1] as { prompt: string }).prompt;
    expect(promptArg).toContain("…and 2 more steps");
    expect(promptArg).toContain("…and 2 more");
    expect(promptArg).toContain("Step 1");
  });

  it("falls back to '_none_' bullet rendering for a plan with zero steps/assumptions/risks", async () => {
    const deps = buildDeps({
      Plan: makePlanArtifact({ steps: [], assumptions: [], risks: [] }),
      ExecutionReport: makeExecutionArtifact(),
      Remediation: null,
    });
    deps.agentRunner.run.mockResolvedValue(
      makeDistillationOutput({ shouldPersist: false, reason: "no insight" }),
    );

    const agent = buildAgent(deps);
    await agent.run("run-1", makeRun());

    const promptArg = (deps.agentRunner.run.mock.calls[0][1] as { prompt: string }).prompt;
    expect(promptArg).toContain("_none_");
  });

  it("falls back to truncated JSON when the Plan artifact payload does not match PlanSchema", async () => {
    const deps = buildDeps({
      Plan: makePlanArtifact({ summary: undefined, planVersion: undefined }),
      ExecutionReport: makeExecutionArtifact(),
      Remediation: null,
    });
    deps.agentRunner.run.mockResolvedValue(
      makeDistillationOutput({ shouldPersist: false, reason: "no insight" }),
    );

    const agent = buildAgent(deps);
    await agent.run("run-1", makeRun());

    // Should not throw despite the malformed Plan payload — falls back to raw JSON truncation.
    expect(deps.agentRunner.run).toHaveBeenCalledOnce();
  });

  it("summarizes an execution report with more than 40 changed files, using the 'and N more' branch", async () => {
    const manyFiles = Array.from({ length: 45 }, (_, i) => `src/file${i}.ts`);
    const manyNotes = Array.from({ length: 20 }, (_, i) => `Note ${i + 1}`);

    const deps = buildDeps({
      Plan: null,
      ExecutionReport: makeExecutionArtifact({
        filesChanged: manyFiles,
        notes: manyNotes,
        checks: {
          lint: { status: "fail", details: "3 lint errors" },
          typecheck: { status: "pass", details: "" },
          tests: { status: "fail", details: "" },
        },
      }),
      Remediation: null,
    });
    deps.agentRunner.run.mockResolvedValue(
      makeDistillationOutput({ shouldPersist: false, reason: "no insight" }),
    );

    const agent = buildAgent(deps);
    await agent.run("run-1", makeRun());

    const promptArg = (deps.agentRunner.run.mock.calls[0][1] as { prompt: string }).prompt;
    expect(promptArg).toContain("…and 5 more");
    expect(promptArg).toContain("…and 5 more"); // files
    expect(promptArg).toContain("lint: fail — 3 lint errors");
    expect(promptArg).toContain("tests: fail");
  });

  it("falls back to '_none_' for an execution report with zero changed files", async () => {
    const deps = buildDeps({
      Plan: null,
      ExecutionReport: makeExecutionArtifact({ filesChanged: [] }),
      Remediation: null,
    });
    deps.agentRunner.run.mockResolvedValue(
      makeDistillationOutput({ shouldPersist: false, reason: "no insight" }),
    );

    const agent = buildAgent(deps);
    await agent.run("run-1", makeRun());

    const promptArg = (deps.agentRunner.run.mock.calls[0][1] as { prompt: string }).prompt;
    expect(promptArg).toContain("**Files Changed** (0):\n_none_");
  });

  it("falls back to '_none_' for a remediation artifact with zero resolutions", async () => {
    const deps = buildDeps({
      Plan: null,
      ExecutionReport: makeExecutionArtifact(),
      Remediation: makeRemediationArtifact({ resolution: [] }),
    });
    deps.agentRunner.run.mockResolvedValue(
      makeDistillationOutput({ shouldPersist: false, reason: "no insight" }),
    );

    const agent = buildAgent(deps);
    await agent.run("run-1", makeRun());

    const promptArg = (deps.agentRunner.run.mock.calls[0][1] as { prompt: string }).prompt;
    expect(promptArg).toContain("**Resolutions**:\n_none_");
  });

  it("includes the existing-skills summary section, falling back to taskCategory when a skill has no name", async () => {
    const deps = buildDeps({
      Plan: null,
      ExecutionReport: makeExecutionArtifact(),
      Remediation: null,
    });
    deps.agentSkillRepo.findActiveByRepo.mockResolvedValue([
      {
        id: "skill-1",
        taskCategory: "database migrations",
        name: null,
        skillMarkdown: "Always run alembic migrations inside a transaction on this repo.",
      },
    ]);
    deps.agentRunner.run.mockResolvedValue(
      makeDistillationOutput({ shouldPersist: false, reason: "already covered" }),
    );

    const agent = buildAgent(deps);
    await agent.run("run-1", makeRun());

    const promptArg = (deps.agentRunner.run.mock.calls[0][1] as { prompt: string }).prompt;
    expect(promptArg).toContain("- [database migrations] database migrations:");
    expect(promptArg).not.toContain("No existing skills.");
  });

  it("summarizes a remediation artifact with many resolutions and an empty-rationale item", async () => {
    const manyResolutions = Array.from({ length: 18 }, (_, i) => ({
      findingId: `f${i + 1}`,
      status: "accepted" as const,
      action: `Fix ${i + 1}`,
      rationale: i === 0 ? "" : `Because ${i + 1}`,
    }));

    const deps = buildDeps({
      Plan: null,
      ExecutionReport: makeExecutionArtifact(),
      Remediation: makeRemediationArtifact({ resolution: manyResolutions }),
    });
    deps.agentRunner.run.mockResolvedValue(
      makeDistillationOutput({ shouldPersist: false, reason: "no insight" }),
    );

    const agent = buildAgent(deps);
    await agent.run("run-1", makeRun());

    const promptArg = (deps.agentRunner.run.mock.calls[0][1] as { prompt: string }).prompt;
    expect(promptArg).toContain("## Remediation Summary");
    expect(promptArg).toContain("…and 3 more");
    expect(promptArg).toContain("Ready for human review");
  });

  it("falls back to truncated JSON when the Remediation artifact payload does not match RemediationSchema", async () => {
    const deps = buildDeps({
      Plan: null,
      ExecutionReport: makeExecutionArtifact(),
      Remediation: makeRemediationArtifact({ reviewId: undefined }),
    });
    deps.agentRunner.run.mockResolvedValue(
      makeDistillationOutput({ shouldPersist: false, reason: "no insight" }),
    );

    const agent = buildAgent(deps);
    await agent.run("run-1", makeRun());

    const promptArg = (deps.agentRunner.run.mock.calls[0][1] as { prompt: string }).prompt;
    expect(promptArg).toContain("## Remediation Summary");
    expect(deps.agentRunner.run).toHaveBeenCalledOnce();
  });

  it("emits reason=missing_required_skill_fields when shouldPersist=true but taskCategory is missing", async () => {
    const deps = buildDeps({
      Plan: null,
      ExecutionReport: makeExecutionArtifact(),
      Remediation: null,
    });
    deps.agentRunner.run.mockResolvedValue(
      makeDistillationOutput({
        shouldPersist: true,
        reason: "insight",
        skillMarkdown: "Some markdown",
        // taskCategory intentionally omitted
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
          displacedSkillId: null,
        }),
      }),
    );
  });

  it("emits reason=missing_required_skill_fields when shouldPersist=true but skillMarkdown is missing", async () => {
    const deps = buildDeps({
      Plan: null,
      ExecutionReport: makeExecutionArtifact(),
      Remediation: null,
    });
    deps.agentRunner.run.mockResolvedValue(
      makeDistillationOutput({
        shouldPersist: true,
        reason: "insight",
        taskCategory: "auth",
        // skillMarkdown intentionally omitted
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
  });

  it("falls back to a generated description when the LLM's description is whitespace-only", async () => {
    const deps = buildDeps({
      Plan: null,
      ExecutionReport: makeExecutionArtifact(),
      Remediation: null,
    });
    deps.agentRunner.run.mockResolvedValue(
      makeDistillationOutput({
        shouldPersist: true,
        reason: "insight",
        taskCategory: "auth middleware",
        skillMarkdown: "Use JWT.",
        description: "   ",
      }),
    );

    const agent = buildAgent(deps);
    await agent.run("run-1", makeRun());

    expect(deps.agentSkillRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        description: "Use when working on auth middleware in test-repo.",
      }),
    );
  });
});
