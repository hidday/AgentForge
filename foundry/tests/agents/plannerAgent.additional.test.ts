import { describe, it, expect, vi } from "vitest";
import { PlannerAgent } from "../../src/agents/plannerAgent.js";
import type { TaskBundle } from "../../src/schemas/taskBundle.js";
import type { Plan } from "../../src/schemas/plan.js";

function makeTaskBundle(): TaskBundle {
  return {
    issue: {
      id: "LIN-1",
      title: "Test issue",
      description: "Test description",
      labels: [],
      priority: 0,
    },
    repo: {
      name: "test-repo",
      defaultBranch: "main",
      workingBranch: "ai/lin-1",
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

function makePlanOutput(planVersion = 2) {
  return {
    raw: "raw text",
    parsed: {
      payload: {
        planVersion,
        summary: "Test plan",
        assumptions: [],
        openQuestions: [],
        risks: [],
        steps: [{ id: "s1", title: "Step 1", description: "Do something" }],
        testPlan: "Run tests",
        confidence: 0.9,
      },
    },
  };
}

function buildPlannerAgent() {
  let capturedPrompt = "";

  const agentRunner = {
    run: vi.fn().mockImplementation(async (_runtime: unknown, opts: { prompt: string }) => {
      capturedPrompt = opts.prompt;
      return makePlanOutput();
    }),
  };

  const artifactRepo = {
    create: vi.fn().mockResolvedValue({ id: "artifact-new" }),
    findByRunId: vi.fn(),
    findLatestByType: vi.fn(),
  };

  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };

  const agent = new PlannerAgent(agentRunner as never, artifactRepo as never, logger as never);

  return { agent, agentRunner, artifactRepo, getPrompt: () => capturedPrompt };
}

function makePreviousPlan(overrides: Partial<Plan> = {}): Plan {
  return {
    planVersion: 3,
    summary: "Previous plan summary",
    requirementsTraceability: "",
    assumptions: ["Assumed Postgres is available"],
    openQuestions: [
      { id: "q1", question: "Which retry strategy?", requiredForExecution: true },
    ],
    risks: ["Might break the legacy import path"],
    steps: [{ id: "s1", title: "Old step", description: "Old step description" }],
    testPlan: "Run the old integration suite",
    confidence: 0.72,
    ...overrides,
  };
}

describe("PlannerAgent.run() planReviewFindings injection", () => {
  it("renders '## AI Plan Review Findings' section when planReviewFindings is provided", async () => {
    const { agent, getPrompt } = buildPlannerAgent();

    await agent.run(makeTaskBundle(), "run-1", {
      planReviewFindings: {
        summary: "Plan mostly sound, one gap found.",
        findings: [
          {
            id: "pf1",
            severity: "important",
            title: "Missing rollback step",
            details: "No plan step covers rollback on failure.",
          },
        ],
      },
    });

    const prompt = getPrompt();
    expect(prompt).toContain("## AI Plan Review Findings (from previous plan)");
    expect(prompt).toContain("Plan mostly sound, one gap found.");
    expect(prompt).toContain("- **[important] Missing rollback step** (pf1): No plan step covers rollback on failure.");
    expect(prompt).toContain("Incorporate these findings into the revised plan");
  });

  it("omits the planReviewFindings section when not provided", async () => {
    const { agent, getPrompt } = buildPlannerAgent();

    await agent.run(makeTaskBundle(), "run-1");

    const prompt = getPrompt();
    expect(prompt).not.toContain("## AI Plan Review Findings");
    expect(prompt).not.toContain("{{planReviewSection}}");
  });
});

describe("PlannerAgent.run() previousPlan injection", () => {
  it("renders the '## Previously Rejected Plan' section with steps, risks, assumptions, and open questions", async () => {
    const { agent, getPrompt } = buildPlannerAgent();

    await agent.run(makeTaskBundle(), "run-1", {
      previousPlan: makePreviousPlan(),
    });

    const prompt = getPrompt();
    expect(prompt).toContain("## Previously Rejected Plan (v3)");
    expect(prompt).toContain("Previous plan summary");
    expect(prompt).toContain("**Confidence:** 72%");
    expect(prompt).toContain("1. **Old step** (s1): Old step description");
    expect(prompt).toContain("**Assumptions:**\n- Assumed Postgres is available");
    expect(prompt).toContain("**Risks:**\n- Might break the legacy import path");
    expect(prompt).toContain("**Open Questions:**");
    expect(prompt).toContain("[q1] Which retry strategy? *(blocks execution)*");
    expect(prompt).toContain("**Test Plan:** Run the old integration suite");
    expect(prompt).toContain("Use this as the starting point for the new plan");
  });

  it("omits risks/assumptions/open-questions sub-sections when those arrays are empty", async () => {
    const { agent, getPrompt } = buildPlannerAgent();

    await agent.run(makeTaskBundle(), "run-1", {
      previousPlan: makePreviousPlan({ assumptions: [], risks: [], openQuestions: [] }),
    });

    const prompt = getPrompt();
    expect(prompt).toContain("## Previously Rejected Plan (v3)");
    expect(prompt).not.toContain("**Assumptions:**");
    expect(prompt).not.toContain("**Risks:**");
    expect(prompt).not.toContain("**Open Questions:**");
  });

  it("omits the '*(blocks execution)*' marker for open questions that don't require execution", async () => {
    const { agent, getPrompt } = buildPlannerAgent();

    await agent.run(makeTaskBundle(), "run-1", {
      previousPlan: makePreviousPlan({
        openQuestions: [{ id: "q2", question: "Optional nice-to-have?", requiredForExecution: false }],
      }),
    });

    const prompt = getPrompt();
    expect(prompt).toContain("[q2] Optional nice-to-have?");
    expect(prompt).not.toContain("Optional nice-to-have? *(blocks execution)*");
  });

  it("omits the previousPlan section when not provided", async () => {
    const { agent, getPrompt } = buildPlannerAgent();

    await agent.run(makeTaskBundle(), "run-1");

    const prompt = getPrompt();
    expect(prompt).not.toContain("## Previously Rejected Plan");
    expect(prompt).not.toContain("{{previousPlanSection}}");
  });
});

describe("PlannerAgent.run() priorSkills injection", () => {
  it("renders '## Prior Skills from Similar Tasks' with named skills including description", async () => {
    const { agent, getPrompt } = buildPlannerAgent();

    await agent.run(makeTaskBundle(), "run-1", {
      priorSkills: [
        {
          taskCategory: "database-migrations",
          name: "safe-column-rename",
          description: "How to rename a column without downtime.",
          skillMarkdown: "1. Add new column\n2. Backfill\n3. Swap reads\n4. Drop old column",
        },
      ],
    });

    const prompt = getPrompt();
    expect(prompt).toContain("## Prior Skills from Similar Tasks");
    expect(prompt).toContain("### safe-column-rename (database-migrations)");
    expect(prompt).toContain("How to rename a column without downtime.");
    expect(prompt).toContain("1. Add new column");
  });

  it("falls back to taskCategory as the heading and omits the intro when name/description are absent", async () => {
    const { agent, getPrompt } = buildPlannerAgent();

    await agent.run(makeTaskBundle(), "run-1", {
      priorSkills: [
        {
          taskCategory: "api-versioning",
          skillMarkdown: "Bump the version prefix and dual-write.",
        },
      ],
    });

    const prompt = getPrompt();
    expect(prompt).toContain("### api-versioning\n\nBump the version prefix and dual-write.");
  });

  it("joins multiple prior skills with a blank line between them", async () => {
    const { agent, getPrompt } = buildPlannerAgent();

    await agent.run(makeTaskBundle(), "run-1", {
      priorSkills: [
        { taskCategory: "cat-a", skillMarkdown: "Skill A body" },
        { taskCategory: "cat-b", skillMarkdown: "Skill B body" },
      ],
    });

    const prompt = getPrompt();
    expect(prompt).toContain("### cat-a");
    expect(prompt).toContain("Skill A body");
    expect(prompt).toContain("### cat-b");
    expect(prompt).toContain("Skill B body");
  });

  it("omits the priorSkills section when the array is empty or absent", async () => {
    const { agent, getPrompt } = buildPlannerAgent();

    await agent.run(makeTaskBundle(), "run-1", { priorSkills: [] });

    const prompt = getPrompt();
    expect(prompt).not.toContain("## Prior Skills from Similar Tasks");

    await agent.run(makeTaskBundle(), "run-1");
    expect(getPrompt()).not.toContain("## Prior Skills from Similar Tasks");
  });
});
