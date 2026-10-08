import { describe, it, expect, vi } from "vitest";
import { DistillationAgent } from "../../src/agents/distillationAgent.js";
import type { Run } from "../../src/domain/types.js";
import { RunState } from "../../src/domain/runState.js";

// Companion to distillationAgent.test.ts: covers how plan / execution /
// remediation artifacts and the existing skill pool are summarised into the
// LLM prompt, the missing-fields gate, and the description fallback.

function makeRun(overrides: Partial<Run> = {}): Run {
  return {
    id: "run-1",
    linearIssueId: "LIN-1",
    linearIssueTitle: "Add auth middleware",
    linearIssueUrl: null,
    repo: "org/repo",
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

function execPayload(overrides: Record<string, unknown> = {}) {
  return {
    executionVersion: 1,
    summary: "Implemented middleware.",
    filesChanged: ["src/a.ts"],
    checks: {
      lint: { status: "pass", details: "lint ok" },
      typecheck: { status: "fail", details: "TS2345 in a.ts" },
      tests: { status: "skip", details: "" },
    },
    notes: ["  Gotcha one  ", "", "Gotcha two"],
    prDraftCreated: true,
    score: 0.8,
    scoreRationale: "good",
    ...overrides,
  };
}

function setup(
  artifacts: Record<string, unknown>,
  decision?: Record<string, unknown>,
  noveltyThreshold = 0.99,
) {
  const agentRunner = {
    run: vi.fn().mockResolvedValue({
      raw: "",
      parsed: { stage: "distillation", payload: decision ?? { shouldPersist: false, reason: "meh" } },
    }),
  };
  const artifactRepo = {
    findLatestByType: vi.fn(async (_r: string, type: string) =>
      artifacts[type] !== undefined ? { version: 1, payloadJson: artifacts[type] } : null,
    ),
  };
  const agentSkillRepo = {
    findActiveByRepo: vi.fn().mockResolvedValue([]),
    countActiveByRepo: vi.fn().mockResolvedValue(0),
    create: vi.fn().mockResolvedValue({ id: "new-skill" }),
    displaceAndCreate: vi.fn(),
  };
  const eventRepo = { create: vi.fn().mockResolvedValue({}) };
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  const agent = new DistillationAgent(
    agentRunner as never,
    artifactRepo as never,
    agentSkillRepo as never,
    eventRepo as never,
    { MAX_SKILLS_PER_REPO: 5, NOVELTY_SIMILARITY_THRESHOLD: noveltyThreshold },
    logger as never,
  );
  const prompt = () => (agentRunner.run.mock.calls[0][1] as { prompt: string }).prompt;
  return { agent, agentRunner, agentSkillRepo, eventRepo, logger, prompt };
}

describe("DistillationAgent prompt summaries", () => {
  it("summarises a schema-valid plan field by field", async () => {
    const { agent, prompt } = setup({
      ExecutionReport: execPayload(),
      Plan: {
        planVersion: 1,
        summary: "Plan summary",
        assumptions: ["A1", "  "],
        openQuestions: [],
        risks: [],
        steps: [
          { id: "s1", title: "Step one", description: "desc one" },
          { id: "s2", title: "Step two", description: "" },
        ],
        testPlan: "Run vitest",
        confidence: 0.9,
      },
    });

    await agent.run("run-1", makeRun());

    expect(prompt()).toContain(
      "**Summary**: Plan summary\n\n**Confidence**: 0.90\n\n**Assumptions**:\n- A1\n\n" +
        "**Risks**:\n_none_\n\n**Steps**:\n1. Step one — desc one\n2. Step two\n\n" +
        "**Test Plan**: Run vitest",
    );
  });

  it("caps plan steps at 12 and long bullet lists at 8 with overflow markers", async () => {
    const steps = Array.from({ length: 14 }, (_, i) => ({
      id: `s${i}`,
      title: `T${i}`,
      description: "",
    }));
    const risks = Array.from({ length: 10 }, (_, i) => `R${i}`);
    const { agent, prompt } = setup({
      ExecutionReport: execPayload(),
      Plan: {
        planVersion: 1,
        summary: "s",
        assumptions: [],
        openQuestions: [],
        risks,
        steps,
        testPlan: "t",
        confidence: 0.5,
      },
    });

    await agent.run("run-1", makeRun());

    const p = prompt();
    expect(p).toContain("12. T11\n…and 2 more steps");
    expect(p).not.toContain("13. T12");
    expect(p).toContain("- R7\n- …and 2 more");
    expect(p).not.toContain("- R8");
  });

  it("renders _none_ for a plan with no steps", async () => {
    const { agent, prompt } = setup({
      ExecutionReport: execPayload(),
      Plan: {
        planVersion: 1,
        summary: "s",
        assumptions: [],
        openQuestions: [],
        risks: [],
        steps: [],
        testPlan: "t",
        confidence: 0.5,
      },
    });

    await agent.run("run-1", makeRun());

    expect(prompt()).toContain("**Steps**:\n_none_");
  });

  it("falls back to truncated JSON for a plan that fails schema validation", async () => {
    const { agent, prompt } = setup({
      ExecutionReport: execPayload(),
      Plan: { bogus: "x".repeat(2000) },
    });

    await agent.run("run-1", makeRun());

    const p = prompt();
    expect(p).toContain('{"bogus":"xxxx');
    // 1500 chars + ellipsis
    expect(p).toContain(`${'{"bogus":"'}${"x".repeat(1500 - 10)}…`);
  });

  it("says no plan is available when there is no Plan artifact", async () => {
    const { agent, prompt } = setup({ ExecutionReport: execPayload() });
    await agent.run("run-1", makeRun());
    expect(prompt()).toContain("No plan artifact available");
  });

  it("summarises execution checks, files and notes (details only for non-passing checks)", async () => {
    const { agent, prompt } = setup({ ExecutionReport: execPayload() });

    await agent.run("run-1", makeRun());

    expect(prompt()).toContain(
      "**Summary**: Implemented middleware.\n\n**Score**: 0.80 — good\n\n" +
        "**Files Changed** (1):\n- src/a.ts\n\n" +
        "**Checks**:\n- lint: pass\n- typecheck: fail — TS2345 in a.ts\n- tests: skip\n\n" +
        "**Notes**:\n- Gotcha one\n- Gotcha two",
    );
  });

  it("caps files changed at 40 and shows _none_ for no files / no notes", async () => {
    const many = Array.from({ length: 42 }, (_, i) => `f${i}.ts`);
    const first = setup({ ExecutionReport: execPayload({ filesChanged: many }) });
    await first.agent.run("run-1", makeRun());
    expect(first.prompt()).toContain("**Files Changed** (42):");
    expect(first.prompt()).toContain("- f39.ts\n- …and 2 more");
    expect(first.prompt()).not.toContain("- f40.ts");

    const second = setup({ ExecutionReport: execPayload({ filesChanged: [], notes: [] }) });
    await second.agent.run("run-1", makeRun());
    expect(second.prompt()).toContain("**Files Changed** (0):\n_none_");
    expect(second.prompt()).toContain("**Notes**:\n_none_");
  });

  it("falls back to truncated JSON for an invalid execution report", async () => {
    const { agent, prompt } = setup({ ExecutionReport: { weird: true } });
    await agent.run("run-1", makeRun());
    expect(prompt()).toContain('## Execution Outcome\n\n{"weird":true}');
  });

  it("summarises a valid remediation with resolutions and rationales", async () => {
    const { agent, prompt } = setup({
      ExecutionReport: execPayload(),
      Remediation: {
        reviewId: "rev-1",
        resolution: [
          { findingId: "F1", status: "accepted", action: "Added test", rationale: "coverage" },
          { findingId: "F2", status: "rejected", action: "Kept as is", rationale: "" },
        ],
        readyForHumanReview: true,
        executionReport: execPayload({ score: 0.95, scoreRationale: "great" }),
      },
    });

    await agent.run("run-1", makeRun());

    expect(prompt()).toContain(
      "## Remediation Summary\n\n**Ready for human review**: true\n\n" +
        "**Final score**: 0.95 — great\n\n" +
        "**Resolutions**:\n- [accepted] F1: Added test\n  *why*: coverage\n- [rejected] F2: Kept as is",
    );
  });

  it("caps remediation resolutions at 15 and shows _none_ when empty", async () => {
    const resolution = Array.from({ length: 17 }, (_, i) => ({
      findingId: `F${i}`,
      status: "accepted",
      action: "a",
      rationale: "",
    }));
    const big = setup({
      ExecutionReport: execPayload(),
      Remediation: {
        reviewId: "r",
        resolution,
        readyForHumanReview: false,
        executionReport: execPayload(),
      },
    });
    await big.agent.run("run-1", makeRun());
    expect(big.prompt()).toContain("- [accepted] F14: a\n- …and 2 more");
    expect(big.prompt()).not.toContain("F15:");

    const empty = setup({
      ExecutionReport: execPayload(),
      Remediation: {
        reviewId: "r",
        resolution: [],
        readyForHumanReview: false,
        executionReport: execPayload(),
      },
    });
    await empty.agent.run("run-1", makeRun());
    expect(empty.prompt()).toContain("**Resolutions**:\n_none_");
  });

  it("falls back to truncated JSON for an invalid remediation payload", async () => {
    const { agent, prompt } = setup({ ExecutionReport: execPayload(), Remediation: { nope: 1 } });
    await agent.run("run-1", makeRun());
    expect(prompt()).toContain('## Remediation Summary\n{"nope":1}');
  });

  it("lists existing skills by name, falling back to category when unnamed", async () => {
    const { agent, agentSkillRepo, prompt } = setup({ ExecutionReport: execPayload() });
    agentSkillRepo.findActiveByRepo.mockResolvedValue([
      { id: "k1", name: "db-migrations", taskCategory: "database", skillMarkdown: "Use prisma." },
      { id: "k2", name: null, taskCategory: "ci", skillMarkdown: "Cache pnpm store." },
    ]);

    await agent.run("run-1", makeRun());

    expect(prompt()).toContain(
      "- [db-migrations] database: Use prisma.\n- [ci] ci: Cache pnpm store.",
    );
    expect(prompt()).not.toContain("No existing skills.");
  });

  it("uses an empty task hint when the run has no Linear title", async () => {
    const { agent, prompt } = setup({ ExecutionReport: execPayload() });
    await agent.run("run-1", makeRun({ linearIssueTitle: null }));
    expect(prompt()).toContain("- **Task Category Hint**: \n");
  });
});

describe("DistillationAgent novelty query", () => {
  const skill = {
    id: "k1",
    name: null,
    taskCategory: "configure redis cache eviction",
    skillMarkdown: "zz",
  };

  it("includes the Linear description in the novelty query (gate fires on a description match)", async () => {
    const { agent, agentRunner, agentSkillRepo, eventRepo } = setup(
      { ExecutionReport: execPayload() },
      undefined,
      0.9,
    );
    agentSkillRepo.findActiveByRepo.mockResolvedValue([skill]);

    await agent.run(
      "run-1",
      makeRun({
        linearIssueTitle: null,
        linearIssueDescription: "configure redis cache eviction",
      } as Partial<Run>),
    );

    expect(agentRunner.run).not.toHaveBeenCalled();
    expect(eventRepo.create.mock.calls[0][0].payloadJson.reason).toMatch(
      /^novelty_gate_failed: max_overlap=0\.9\d\d$/,
    );
  });

  it("only considers the first 200 chars of the description", async () => {
    const { agent, agentRunner, agentSkillRepo } = setup(
      { ExecutionReport: execPayload() },
      undefined,
      0.9,
    );
    agentSkillRepo.findActiveByRepo.mockResolvedValue([skill]);

    await agent.run(
      "run-1",
      makeRun({
        linearIssueTitle: null,
        linearIssueDescription: `${"q".repeat(200)}configure redis cache eviction`,
      } as Partial<Run>),
    );

    // The matching text is past the 200-char cut, so the gate does not fire.
    expect(agentRunner.run).toHaveBeenCalledTimes(1);
  });
});

describe("DistillationAgent persistence gates", () => {
  it.each([
    ["missing taskCategory", { skillMarkdown: "body" }],
    ["whitespace taskCategory", { taskCategory: "   ", skillMarkdown: "body" }],
    ["missing skillMarkdown", { taskCategory: "auth" }],
    ["whitespace skillMarkdown", { taskCategory: "auth", skillMarkdown: "  \n " }],
  ])("skips persisting when shouldPersist=true but %s", async (_label, fields) => {
    const { agent, agentSkillRepo, eventRepo, logger } = setup(
      { ExecutionReport: execPayload() },
      { shouldPersist: true, reason: "useful", ...fields },
    );

    await agent.run("run-1", makeRun());

    expect(logger.warn).toHaveBeenCalledWith(
      { runId: "run-1" },
      "Distillation missing taskCategory or skillMarkdown, skipping persist",
    );
    expect(eventRepo.create).toHaveBeenCalledWith({
      runId: "run-1",
      eventType: "SKILL_DISTILLATION",
      source: "distillation-agent",
      payloadJson: {
        shouldPersist: false,
        reason: "missing_required_skill_fields",
        displacedSkillId: null,
      },
    });
    expect(agentSkillRepo.countActiveByRepo).not.toHaveBeenCalled();
    expect(agentSkillRepo.create).not.toHaveBeenCalled();
  });

  it.each([
    ["absent", undefined],
    ["whitespace-only", "   "],
  ])("falls back to a generated description when the LLM description is %s", async (_l, desc) => {
    const { agent, agentSkillRepo, eventRepo } = setup(
      { ExecutionReport: execPayload() },
      {
        shouldPersist: true,
        reason: "useful",
        taskCategory: "  auth  ",
        skillMarkdown: "  Always validate JWT.  ",
        description: desc,
      },
    );

    await agent.run("run-1", makeRun());

    expect(agentSkillRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        repoSlug: "org/repo",
        taskCategory: "auth",
        skillMarkdown: "Always validate JWT.",
        description: "Use when working on auth in org/repo.",
      }),
    );
    expect(eventRepo.create.mock.calls[0][0].payloadJson).toMatchObject({
      shouldPersist: true,
      skillId: "new-skill",
      description: "Use when working on auth in org/repo.",
    });
  });

  it("logs a stringified non-Error LLM failure and records parse_error", async () => {
    const { agent, agentRunner, eventRepo, logger } = setup({ ExecutionReport: execPayload() });
    agentRunner.run.mockRejectedValue("bad json");

    await agent.run("run-1", makeRun());

    expect(logger.warn).toHaveBeenCalledWith(
      { runId: "run-1", error: "bad json" },
      "Distillation LLM call failed or parse error",
    );
    expect(eventRepo.create.mock.calls[0][0].payloadJson.reason).toBe("parse_error");
  });

  it("records a null taskCategory when the LLM declines without one", async () => {
    const { agent, eventRepo } = setup(
      { ExecutionReport: execPayload() },
      { shouldPersist: false, reason: "too specific" },
    );

    await agent.run("run-1", makeRun());

    expect(eventRepo.create.mock.calls[0][0].payloadJson).toEqual({
      shouldPersist: false,
      reason: "too specific",
      taskCategory: null,
      displacedSkillId: null,
    });
  });
});
