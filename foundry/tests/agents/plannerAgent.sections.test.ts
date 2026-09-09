import { describe, it, expect, vi } from "vitest";
import { PlannerAgent } from "../../src/agents/plannerAgent.js";
import type { TaskBundle } from "../../src/schemas/taskBundle.js";
import type { Plan } from "../../src/schemas/plan.js";

function makeTaskBundle(): TaskBundle {
  return {
    issue: { id: "LIN-1", title: "Test issue", description: "Test description", labels: [], priority: 0 },
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

  return { agent, getPrompt: () => capturedPrompt };
}

function makePreviousPlan(overrides: Partial<Plan> = {}): Plan {
  return {
    planVersion: 3,
    summary: "Previous plan summary",
    requirementsTraceability: "",
    assumptions: [],
    openQuestions: [],
    risks: [],
    steps: [{ id: "s1", title: "Old step", description: "Old description" }],
    testPlan: "Old test plan",
    confidence: 0.6,
    ...overrides,
  };
}

describe("PlannerAgent.run() - planReviewFindings section", () => {
  it("renders the AI Plan Review Findings section with each finding line", async () => {
    const { agent, getPrompt } = buildPlannerAgent();

    await agent.run(makeTaskBundle(), "run-1", {
      planReviewFindings: {
        summary: "Missing error handling.",
        findings: [
          { id: "pf1", severity: "important", title: "No JSON error handler", details: "Detail text" },
        ],
      },
    });

    const prompt = getPrompt();
    expect(prompt).toContain("## AI Plan Review Findings (from previous plan)");
    expect(prompt).toContain("Missing error handling.");
    expect(prompt).toContain("[important] No JSON error handler** (pf1): Detail text");
  });

  it("omits the plan review findings section when not provided", async () => {
    const { agent, getPrompt } = buildPlannerAgent();
    await agent.run(makeTaskBundle(), "run-1");
    expect(getPrompt()).not.toContain("AI Plan Review Findings");
  });
});

describe("PlannerAgent.run() - previousPlanSection", () => {
  it("renders the full previous plan section including risks, assumptions, and open questions", async () => {
    const { agent, getPrompt } = buildPlannerAgent();

    await agent.run(makeTaskBundle(), "run-1", {
      previousPlan: makePreviousPlan({
        risks: ["Risk one"],
        assumptions: ["Assumption one"],
        openQuestions: [{ id: "q1", question: "Blocking question?", requiredForExecution: true }],
      }),
    });

    const prompt = getPrompt();
    expect(prompt).toContain("## Previously Rejected Plan (v3)");
    expect(prompt).toContain("Previous plan summary");
    expect(prompt).toContain("**Confidence:** 60%");
    expect(prompt).toContain("1. **Old step** (s1): Old description");
    expect(prompt).toContain("**Risks:**\n- Risk one");
    expect(prompt).toContain("**Assumptions:**\n- Assumption one");
    expect(prompt).toContain("**Open Questions:**\n- [q1] Blocking question? *(blocks execution)*");
    expect(prompt).toContain("**Test Plan:** Old test plan");
  });

  it("omits risks/assumptions/questions sub-sections when each is empty", async () => {
    const { agent, getPrompt } = buildPlannerAgent();

    await agent.run(makeTaskBundle(), "run-1", {
      previousPlan: makePreviousPlan({ risks: [], assumptions: [], openQuestions: [] }),
    });

    const prompt = getPrompt();
    expect(prompt).toContain("## Previously Rejected Plan (v3)");
    expect(prompt).not.toContain("**Risks:**");
    expect(prompt).not.toContain("**Assumptions:**");
    expect(prompt).not.toContain("**Open Questions:**");
  });

  it("renders an open question without the blocks-execution suffix when not required", async () => {
    const { agent, getPrompt } = buildPlannerAgent();

    await agent.run(makeTaskBundle(), "run-1", {
      previousPlan: makePreviousPlan({
        openQuestions: [{ id: "q1", question: "Optional question?", requiredForExecution: false }],
      }),
    });

    const prompt = getPrompt();
    expect(prompt).toContain("- [q1] Optional question?");
    expect(prompt).not.toContain("Optional question? *(blocks execution)*");
  });

  it("omits the previous plan section when not provided", async () => {
    const { agent, getPrompt } = buildPlannerAgent();
    await agent.run(makeTaskBundle(), "run-1");
    expect(getPrompt()).not.toContain("Previously Rejected Plan");
  });
});

describe("PlannerAgent.run() - priorSkillsSection", () => {
  it("renders each skill with its name and description when present", async () => {
    const { agent, getPrompt } = buildPlannerAgent();

    await agent.run(makeTaskBundle(), "run-1", {
      priorSkills: [
        {
          id: "skill-1",
          repoSlug: "acme/backend",
          name: "Zod validation pattern",
          description: "How to add Zod validation middleware.",
          taskCategory: "validation",
          skillMarkdown: "## Steps\n1. Do X",
          utilityScore: 0.8,
          lastUsedAt: new Date(),
        },
      ],
    });

    const prompt = getPrompt();
    expect(prompt).toContain("## Prior Skills from Similar Tasks");
    expect(prompt).toContain("### Zod validation pattern (validation)");
    expect(prompt).toContain("How to add Zod validation middleware.");
    expect(prompt).toContain("## Steps\n1. Do X");
  });

  it("falls back to taskCategory as the heading and omits the intro when name/description are absent", async () => {
    const { agent, getPrompt } = buildPlannerAgent();

    await agent.run(makeTaskBundle(), "run-1", {
      priorSkills: [
        {
          id: "skill-2",
          repoSlug: "acme/backend",
          name: null,
          description: null,
          taskCategory: "refactor",
          skillMarkdown: "## Steps\n1. Do Y",
          utilityScore: 0.5,
          lastUsedAt: new Date(),
        },
      ],
    });

    const prompt = getPrompt();
    expect(prompt).toContain("### refactor\n\n## Steps\n1. Do Y");
  });

  it("joins multiple skills with a blank line between them", async () => {
    const { agent, getPrompt } = buildPlannerAgent();

    await agent.run(makeTaskBundle(), "run-1", {
      priorSkills: [
        {
          id: "skill-1",
          repoSlug: "acme/backend",
          name: "Skill A",
          description: null,
          taskCategory: "cat-a",
          skillMarkdown: "Body A",
          utilityScore: 0.5,
          lastUsedAt: new Date(),
        },
        {
          id: "skill-2",
          repoSlug: "acme/backend",
          name: "Skill B",
          description: null,
          taskCategory: "cat-b",
          skillMarkdown: "Body B",
          utilityScore: 0.5,
          lastUsedAt: new Date(),
        },
      ],
    });

    const prompt = getPrompt();
    expect(prompt).toContain("### Skill A (cat-a)\n\nBody A\n\n### Skill B (cat-b)\n\nBody B");
  });

  it("omits the prior skills section when the list is empty or absent", async () => {
    const { agent, getPrompt } = buildPlannerAgent();
    await agent.run(makeTaskBundle(), "run-1", { priorSkills: [] });
    expect(getPrompt()).not.toContain("Prior Skills from Similar Tasks");
  });
});
