import { describe, it, expect, vi } from "vitest";
import { PlannerAgent } from "../../src/agents/plannerAgent.js";
import type { TaskBundle } from "../../src/schemas/taskBundle.js";
import type { Plan } from "../../src/schemas/plan.js";
import type { SkillDocument } from "../../src/domain/types.js";

// Companion to plannerAgent.test.ts: previous-plan, prior-skills and
// plan-review prompt sections, plus planVersionOverride and artifact writes.

function makeTaskBundle(): TaskBundle {
  return {
    issue: { id: "LIN-1", title: "Test issue", description: "Desc", labels: [], priority: 0 },
    repo: {
      name: "test-repo",
      defaultBranch: "main",
      workingBranch: "ai/lin-1",
      repoPath: "/tmp/planner-repo",
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

const parsedPlan = {
  planVersion: 3,
  summary: "New plan",
  assumptions: [],
  openQuestions: [],
  risks: [],
  steps: [
    { id: "s1", title: "One", description: "d1" },
    { id: "s2", title: "Two", description: "d2" },
  ],
  testPlan: "vitest",
  confidence: 0.75,
};

function build() {
  const agentRunner = {
    run: vi.fn().mockResolvedValue({ raw: "RAW OUTPUT", parsed: { payload: { ...parsedPlan } } }),
  };
  const artifactRepo = { create: vi.fn().mockResolvedValue({ id: "a" }) };
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  const agent = new PlannerAgent(agentRunner as never, artifactRepo as never, logger as never);
  const prompt = () => (agentRunner.run.mock.calls[0][1] as { prompt: string }).prompt;
  return { agent, agentRunner, artifactRepo, logger, prompt };
}

function makePlan(overrides: Partial<Plan> = {}): Plan {
  return {
    planVersion: 2,
    summary: "Old summary",
    assumptions: [],
    openQuestions: [],
    risks: [],
    steps: [{ id: "s1", title: "Old step", description: "old desc" }],
    testPlan: "old tests",
    confidence: 0.456,
    ...overrides,
  } as Plan;
}

function skill(overrides: Partial<SkillDocument> = {}): SkillDocument {
  return {
    id: "sk1",
    repoSlug: "org/repo",
    name: null,
    description: null,
    taskCategory: "api-endpoint",
    skillMarkdown: "Do X then Y.",
    utilityScore: 1,
    lastUsedAt: new Date("2024-01-01"),
    ...overrides,
  };
}

describe("PlannerAgent previousPlan section", () => {
  it("renders the full previous plan including assumptions, risks and blocking questions", async () => {
    const { agent, prompt } = build();

    await agent.run(makeTaskBundle(), "run-1", {
      previousPlan: makePlan({
        assumptions: ["Postgres is available"],
        risks: ["Migration may lock table"],
        openQuestions: [
          { id: "q1", question: "Which region?", requiredForExecution: true },
          { id: "q2", question: "Nice to have?", requiredForExecution: false },
        ],
        steps: [
          { id: "s1", title: "First", description: "a" },
          { id: "s2", title: "Second", description: "b" },
        ],
      }),
    });

    const p = prompt();
    expect(p).toContain(
      "## Previously Rejected Plan (v2)\n**Summary:** Old summary\n**Confidence:** 46%\n\n" +
        "**Steps:**\n1. **First** (s1): a\n2. **Second** (s2): b" +
        "\n**Assumptions:**\n- Postgres is available" +
        "\n**Risks:**\n- Migration may lock table" +
        "\n**Open Questions:**\n- [q1] Which region? *(blocks execution)*\n- [q2] Nice to have?" +
        "\n\n**Test Plan:** old tests",
    );
    expect(p).toContain("Use this as the starting point for the new plan.");
  });

  it("omits empty assumptions, risks and questions sub-sections", async () => {
    const { agent, prompt } = build();

    await agent.run(makeTaskBundle(), "run-1", { previousPlan: makePlan() });

    const p = prompt();
    expect(p).toContain("**Steps:**\n1. **Old step** (s1): old desc\n\n**Test Plan:** old tests");
    expect(p).not.toContain("**Assumptions:**");
    expect(p).not.toContain("**Risks:**");
    expect(p).not.toContain("**Open Questions:**");
  });

  it("does not render the section when no previous plan is supplied", async () => {
    const { agent, prompt } = build();
    await agent.run(makeTaskBundle(), "run-1", {});
    expect(prompt()).not.toContain("## Previously Rejected Plan");
  });
});

describe("PlannerAgent priorSkills section", () => {
  it("renders named skills with category and description, and unnamed ones by category only", async () => {
    const { agent, prompt } = build();

    await agent.run(makeTaskBundle(), "run-1", {
      priorSkills: [
        skill({ name: "Add REST route", description: "How we add routes." }),
        skill({ id: "sk2", taskCategory: "migration", skillMarkdown: "Use prisma migrate." }),
      ],
    });

    expect(prompt()).toContain(
      "## Prior Skills from Similar Tasks\n\n" +
        "### Add REST route (api-endpoint)\n\nHow we add routes.\n\nDo X then Y.\n\n" +
        "### migration\n\nUse prisma migrate.",
    );
  });

  it("omits the section for an empty skills list", async () => {
    const { agent, prompt } = build();
    await agent.run(makeTaskBundle(), "run-1", { priorSkills: [] });
    expect(prompt()).not.toContain("## Prior Skills from Similar Tasks");
  });
});

describe("PlannerAgent planReviewFindings section", () => {
  it("renders the review summary and each finding", async () => {
    const { agent, prompt } = build();

    await agent.run(makeTaskBundle(), "run-1", {
      planReviewFindings: {
        summary: "Needs work",
        findings: [
          { id: "F1", severity: "high", title: "No rollback", details: "Add one" },
          { id: "F2", severity: "low", title: "Naming", details: "Rename" },
        ],
      },
    });

    expect(prompt()).toContain(
      "## AI Plan Review Findings (from previous plan)\n**Review Summary:** Needs work\n\n" +
        "- **[high] No rollback** (F1): Add one\n- **[low] Naming** (F2): Rename\n\n" +
        "Incorporate these findings into the revised plan where appropriate.",
    );
  });
});

describe("PlannerAgent artifacts and version override", () => {
  it("passes runtime options to the runner and persists transcript + plan with the parsed version", async () => {
    const { agent, agentRunner, artifactRepo, logger } = build();

    const plan = await agent.run(makeTaskBundle(), "run-7");

    expect(plan.planVersion).toBe(3);
    const [, opts, stage] = agentRunner.run.mock.calls[0];
    expect(stage).toBe("planner");
    expect(opts).toMatchObject({ workingDirectory: "/tmp/planner-repo", runId: "run-7" });
    expect(typeof opts.systemPrompt).toBe("string");

    expect(artifactRepo.create).toHaveBeenNthCalledWith(1, {
      runId: "run-7",
      type: "PlannerTranscript",
      version: 1,
      payloadJson: {},
      rawText: "RAW OUTPUT",
    });
    expect(artifactRepo.create).toHaveBeenNthCalledWith(2, {
      runId: "run-7",
      type: "Plan",
      version: 3,
      payloadJson: parsedPlan,
      rawText: JSON.stringify(parsedPlan, null, 2),
    });
    expect(logger.info).toHaveBeenLastCalledWith(
      { runId: "run-7", planVersion: 3, confidence: 0.75, steps: 2 },
      "Plan created",
    );
  });

  it("applies planVersionOverride to both the returned plan and the stored artifact", async () => {
    const { agent, artifactRepo } = build();

    const plan = await agent.run(makeTaskBundle(), "run-7", { planVersionOverride: 9 });

    expect(plan.planVersion).toBe(9);
    expect(plan.summary).toBe("New plan");
    const stored = artifactRepo.create.mock.calls[1][0];
    expect(stored.version).toBe(9);
    expect(stored.payloadJson.planVersion).toBe(9);
  });

  it("honours an override of 0 (not treated as absent)", async () => {
    const { agent } = build();
    const plan = await agent.run(makeTaskBundle(), "run-7", { planVersionOverride: 0 });
    expect(plan.planVersion).toBe(0);
  });

  it("propagates runner failures without writing artifacts", async () => {
    const { agent, agentRunner, artifactRepo } = build();
    agentRunner.run.mockRejectedValue(new Error("planner timed out"));

    await expect(agent.run(makeTaskBundle(), "run-7")).rejects.toThrow("planner timed out");
    expect(artifactRepo.create).not.toHaveBeenCalled();
  });
});
