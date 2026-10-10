import { describe, it, expect, vi } from "vitest";
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

function makePlanArtifactPayload() {
  const longSummary = "S".repeat(650);
  const longTestPlan = "T".repeat(450);
  const assumptions = Array.from({ length: 10 }, (_, i) => `Assumption number ${i} `.repeat(15));
  const risks = Array.from({ length: 10 }, (_, i) => `Risk number ${i} `.repeat(15));
  const steps = Array.from({ length: 14 }, (_, i) => ({
    id: `s${i}`,
    title: `Step ${i}`,
    description: `Description for step ${i}`,
  }));
  return {
    planVersion: 1,
    summary: longSummary,
    requirementsTraceability: "",
    assumptions,
    openQuestions: [],
    risks,
    steps,
    testPlan: longTestPlan,
    confidence: 0.77,
  };
}

function makeExecutionArtifactPayload() {
  const longSummary = "E".repeat(650);
  const longRationale = "R".repeat(450);
  const notes = Array.from({ length: 20 }, (_, i) => `Note number ${i} `.repeat(20));
  const filesChanged = Array.from({ length: 45 }, (_, i) => `src/file${i}.ts`);
  return {
    executionVersion: 1,
    summary: longSummary,
    filesChanged,
    checks: {
      lint: { status: "pass", details: "ok" },
      typecheck: { status: "fail", details: "Type error in src/file0.ts" },
      tests: { status: "pass", details: "ok" },
    },
    notes,
    prDraftCreated: true,
    score: 0.6,
    scoreRationale: longRationale,
  };
}

function makeRemediationArtifactPayload() {
  const resolution = Array.from({ length: 18 }, (_, i) => ({
    findingId: `f${i}`,
    status: i % 2 === 0 ? "accepted" : "rejected",
    action: `Action taken for finding ${i}`,
    rationale: i === 0 ? "" : `Rationale for finding ${i}`,
  }));
  return {
    reviewId: "rev-1",
    resolution,
    readyForHumanReview: true,
    executionReport: {
      executionVersion: 2,
      summary: "Post-remediation summary",
      filesChanged: ["src/file0.ts"],
      checks: {
        lint: { status: "pass", details: "ok" },
        typecheck: { status: "pass", details: "ok" },
        tests: { status: "pass", details: "ok" },
      },
      notes: [],
      prDraftCreated: true,
      score: 0.9,
      scoreRationale: "Fixed everything.",
    },
  };
}

function buildDeps(options: {
  planPayload?: unknown;
  remediationPayload?: unknown;
  activeSkills?: unknown[];
  decision?: Record<string, unknown>;
  threshold?: number;
} = {}) {
  const agentRunner = {
    run: vi.fn().mockResolvedValue({
      raw: "raw output",
      parsed: {
        stage: "distillation" as const,
        payload: options.decision ?? { shouldPersist: false, reason: "no insight" },
      },
    }),
  };

  const artifactRepo = { findLatestByType: vi.fn(), findByRunId: vi.fn(), create: vi.fn() };
  const agentSkillRepo = {
    findActiveByRepo: vi.fn().mockResolvedValue(options.activeSkills ?? []),
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
    NOVELTY_SIMILARITY_THRESHOLD: options.threshold ?? 0.5,
  };
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };

  const executionArtifact = {
    id: "artifact-exec",
    runId: "run-1",
    type: "ExecutionReport" as const,
    version: 1,
    payloadJson: makeExecutionArtifactPayload(),
    rawText: "{}",
    createdAt: new Date(),
  };

  const planArtifact = options.planPayload
    ? {
        id: "artifact-plan",
        runId: "run-1",
        type: "Plan" as const,
        version: 1,
        payloadJson: options.planPayload,
        rawText: "{}",
        createdAt: new Date(),
      }
    : null;

  const remediationArtifact = options.remediationPayload
    ? {
        id: "artifact-remediation",
        runId: "run-1",
        type: "Remediation" as const,
        version: 1,
        payloadJson: options.remediationPayload,
        rawText: "{}",
        createdAt: new Date(),
      }
    : null;

  artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
    if (type === "ExecutionReport") return Promise.resolve(executionArtifact);
    if (type === "Plan") return Promise.resolve(planArtifact);
    if (type === "Remediation") return Promise.resolve(remediationArtifact);
    return Promise.resolve(null);
  });

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

function getCapturedUserPrompt(deps: ReturnType<typeof buildDeps>): string {
  const call = deps.agentRunner.run.mock.calls[0] as [unknown, { prompt: string }, unknown, unknown];
  return call[1].prompt;
}

describe("DistillationAgent summarization helpers (field-aware summaries)", () => {
  it("renders a rich plan summary (truncated fields, steps overflow, assumptions/risks overflow)", async () => {
    const deps = buildDeps({ planPayload: makePlanArtifactPayload() });
    const agent = buildAgent(deps);

    await agent.run("run-1", makeRun());

    const prompt = getCapturedUserPrompt(deps);
    expect(prompt).toContain("**Confidence**: 0.77");
    expect(prompt).toContain("…and 2 more steps");
    expect(prompt).toContain("…and 2 more");
    expect(prompt).toContain("…");
  });

  it("renders a rich execution summary (failing check, files/notes overflow, truncated text)", async () => {
    const deps = buildDeps({});
    const agent = buildAgent(deps);

    await agent.run("run-1", makeRun());

    const prompt = getCapturedUserPrompt(deps);
    expect(prompt).toContain("typecheck: fail — Type error in src/file0.ts");
    expect(prompt).toContain("…and 5 more");
    expect(prompt).toContain("Files Changed** (45)");
  });

  it("renders a rich remediation summary (resolutions overflow, missing rationale on one item)", async () => {
    const deps = buildDeps({ remediationPayload: makeRemediationArtifactPayload() });
    const agent = buildAgent(deps);

    await agent.run("run-1", makeRun());

    const prompt = getCapturedUserPrompt(deps);
    expect(prompt).toContain("## Remediation Summary");
    expect(prompt).toContain("**Ready for human review**: true");
    expect(prompt).toContain("[accepted] f0: Action taken for finding 0");
    // f0 has an empty rationale, so no "*why*:" line should follow its action on the same bullet
    expect(prompt).not.toContain("f0: Action taken for finding 0\n  *why*:");
    expect(prompt).toContain("*why*: Rationale for finding 1");
    expect(prompt).toContain("…and 3 more");
  });

  it("falls back to truncated JSON for a plan artifact that fails PlanSchema validation", async () => {
    const deps = buildDeps({ planPayload: { not: "a valid plan" } });
    const agent = buildAgent(deps);

    await agent.run("run-1", makeRun());

    const prompt = getCapturedUserPrompt(deps);
    expect(prompt).toContain(JSON.stringify({ not: "a valid plan" }));
  });

  it("falls back to truncated JSON for a remediation artifact that fails RemediationSchema validation", async () => {
    const deps = buildDeps({ remediationPayload: { not: "valid" } });
    const agent = buildAgent(deps);

    await agent.run("run-1", makeRun());

    const prompt = getCapturedUserPrompt(deps);
    expect(prompt).toContain("## Remediation Summary");
    expect(prompt).toContain(JSON.stringify({ not: "valid" }));
  });

  it("renders the existing-skills summary line, falling back to taskCategory when a skill has no name", async () => {
    const deps = buildDeps({
      activeSkills: [
        makeSkill({
          id: "s1",
          name: null,
          taskCategory: "totally unrelated css styling topic",
          skillMarkdown: "Flexbox centering trick for CSS layouts.",
        }),
        makeSkill({
          id: "s2",
          name: "named-skill",
          taskCategory: "another unrelated topic",
          skillMarkdown: "Some other unrelated skill content.",
        }),
      ],
    });
    const agent = buildAgent(deps);

    await agent.run("run-1", makeRun());

    // Both skills are far enough from the task query that the novelty gate does not trip.
    expect(deps.agentRunner.run).toHaveBeenCalledTimes(1);
    const prompt = getCapturedUserPrompt(deps);
    expect(prompt).toContain(
      "- [totally unrelated css styling topic] totally unrelated css styling topic:",
    );
    expect(prompt).toContain("- [named-skill] another unrelated topic:");
  });
});

describe("DistillationAgent summarization helpers (empty-collection branches)", () => {
  it("renders '_none_' for a plan with an empty steps array", async () => {
    const deps = buildDeps({ planPayload: { ...makePlanArtifactPayload(), steps: [] } });
    const agent = buildAgent(deps);

    await agent.run("run-1", makeRun());

    const prompt = getCapturedUserPrompt(deps);
    expect(prompt).toContain("**Steps**:\n_none_");
  });

  it("renders '_none_' for an execution report with an empty filesChanged array", async () => {
    const deps = buildDeps({});
    deps.artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
      if (type === "ExecutionReport") {
        return Promise.resolve({
          id: "artifact-exec",
          runId: "run-1",
          type: "ExecutionReport" as const,
          version: 1,
          payloadJson: { ...makeExecutionArtifactPayload(), filesChanged: [] },
          rawText: "{}",
          createdAt: new Date(),
        });
      }
      return Promise.resolve(null);
    });
    const agent = buildAgent(deps);

    await agent.run("run-1", makeRun());

    const prompt = getCapturedUserPrompt(deps);
    expect(prompt).toContain("Files Changed** (0):\n_none_");
  });

  it("renders '_none_' for a remediation with an empty resolution array", async () => {
    const deps = buildDeps({
      remediationPayload: { ...makeRemediationArtifactPayload(), resolution: [] },
    });
    const agent = buildAgent(deps);

    await agent.run("run-1", makeRun());

    const prompt = getCapturedUserPrompt(deps);
    expect(prompt).toContain("**Resolutions**:\n_none_");
  });
});

describe("DistillationAgent taskQuery construction from linearIssueDescription", () => {
  it("folds linearIssueDescription into the novelty-check query, tripping the gate when it matches an existing skill", async () => {
    const description = "add jwt auth middleware for the api endpoints immediately";
    const deps = buildDeps({
      threshold: 0.5,
      activeSkills: [
        makeSkill({
          taskCategory: "auth middleware",
          skillMarkdown: description,
        }),
      ],
    });
    // An unrelated title ensures any overlap must come from the description field.
    const run = makeRun({ linearIssueTitle: "zzz", linearIssueDescription: description });

    const agent = buildAgent(deps);
    await agent.run("run-1", run);

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
});

describe("DistillationAgent missing required skill fields after shouldPersist=true", () => {
  it("skips persistence when taskCategory is missing from the decision", async () => {
    const deps = buildDeps({
      decision: { shouldPersist: true, reason: "insight", skillMarkdown: "Some markdown" },
    });
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

  it("skips persistence when skillMarkdown is missing from the decision", async () => {
    const deps = buildDeps({
      decision: { shouldPersist: true, reason: "insight", taskCategory: "some category" },
    });
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

  it("skips persistence when taskCategory is whitespace-only", async () => {
    const deps = buildDeps({
      decision: {
        shouldPersist: true,
        reason: "insight",
        taskCategory: "   ",
        skillMarkdown: "Some markdown",
      },
    });
    const agent = buildAgent(deps);

    await agent.run("run-1", makeRun());

    expect(deps.agentSkillRepo.create).not.toHaveBeenCalled();
    expect(deps.eventRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        payloadJson: expect.objectContaining({
          reason: "missing_required_skill_fields",
        }),
      }),
    );
  });
});

describe("DistillationAgent description fallback", () => {
  it("falls back to a generated description when the decision's description is undefined", async () => {
    const deps = buildDeps({
      decision: {
        shouldPersist: true,
        reason: "insight",
        taskCategory: "database optimization",
        skillMarkdown: "Always cache DB connections.",
      },
    });
    const agent = buildAgent(deps);

    await agent.run("run-1", makeRun({ repo: "acme/widgets" }));

    expect(deps.agentSkillRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        description: "Use when working on database optimization in acme/widgets.",
      }),
    );
  });

  it("falls back to a generated description when the decision's description is whitespace-only", async () => {
    const deps = buildDeps({
      decision: {
        shouldPersist: true,
        reason: "insight",
        taskCategory: "database optimization",
        skillMarkdown: "Always cache DB connections.",
        description: "   ",
      },
    });
    const agent = buildAgent(deps);

    await agent.run("run-1", makeRun({ repo: "acme/widgets" }));

    expect(deps.agentSkillRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        description: "Use when working on database optimization in acme/widgets.",
      }),
    );
  });

  it("uses the decision's own description when it is a non-empty, non-whitespace string", async () => {
    const deps = buildDeps({
      decision: {
        shouldPersist: true,
        reason: "insight",
        taskCategory: "database optimization",
        skillMarkdown: "Always cache DB connections.",
        description: "Custom description from the model.",
      },
    });
    const agent = buildAgent(deps);

    await agent.run("run-1", makeRun());

    expect(deps.agentSkillRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        description: "Custom description from the model.",
      }),
    );
  });
});
