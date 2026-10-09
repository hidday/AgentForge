import { describe, it, expect, vi } from "vitest";
import { PlannerAgent } from "../../src/agents/plannerAgent.js";
import type { TaskBundle } from "../../src/schemas/taskBundle.js";
import type { Plan } from "../../src/schemas/plan.js";
import type { SkillDocument } from "../../src/domain/types.js";

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
    run: vi.fn().mockImplementation(
      async (_runtime: unknown, opts: { prompt: string }, _name: unknown, _schema: unknown) => {
        capturedPrompt = opts.prompt;
        return makePlanOutput();
      },
    ),
  };

  const artifactRepo = {
    create: vi.fn().mockResolvedValue({ id: "artifact-new" }),
    findByRunId: vi.fn(),
    findLatestByType: vi.fn(),
  };

  const logger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };

  const agent = new PlannerAgent(agentRunner as never, artifactRepo as never, logger as never);

  return { agent, agentRunner, artifactRepo, getPrompt: () => capturedPrompt };
}

function makeFullPreviousPlan(): Plan {
  return {
    planVersion: 3,
    summary: "Previous rejected plan summary",
    assumptions: ["Assumption one"],
    openQuestions: [{ id: "q1", question: "Which DB?", requiredForExecution: true }],
    risks: ["Risk one"],
    steps: [
      { id: "s1", title: "Step 1", description: "Do first thing" },
      { id: "s2", title: "Step 2", description: "Do second thing" },
    ],
    testPlan: "Run the test suite",
    confidence: 0.42,
  };
}

function makeEmptyPreviousPlan(): Plan {
  return {
    planVersion: 1,
    summary: "Minimal previous plan",
    assumptions: [],
    openQuestions: [],
    risks: [],
    steps: [],
    testPlan: "n/a",
    confidence: 0.1,
  };
}

describe("PlannerAgent.run() previousPlanSection", () => {
  it("renders the previous plan with steps, risks, assumptions, and open questions", async () => {
    const { agent, getPrompt } = buildPlannerAgent();
    const bundle = makeTaskBundle();

    await agent.run(bundle, "run-1", { previousPlan: makeFullPreviousPlan() });

    const prompt = getPrompt();
    expect(prompt).toContain("## Previously Rejected Plan (v3)");
    expect(prompt).toContain("Previous rejected plan summary");
    expect(prompt).toContain("**Confidence:** 42%");
    expect(prompt).toContain("1. **Step 1** (s1): Do first thing");
    expect(prompt).toContain("2. **Step 2** (s2): Do second thing");
    expect(prompt).toContain("**Risks:**");
    expect(prompt).toContain("- Risk one");
    expect(prompt).toContain("**Assumptions:**");
    expect(prompt).toContain("- Assumption one");
    expect(prompt).toContain("**Open Questions:**");
    expect(prompt).toContain("[q1] Which DB? *(blocks execution)*");
    expect(prompt).toContain("**Test Plan:** Run the test suite");
    expect(prompt).toContain("Use this as the starting point for the new plan");
  });

  it("omits risks/assumptions/open-questions sub-sections when those arrays are empty", async () => {
    const { agent, getPrompt } = buildPlannerAgent();
    const bundle = makeTaskBundle();

    await agent.run(bundle, "run-1", { previousPlan: makeEmptyPreviousPlan() });

    const prompt = getPrompt();
    expect(prompt).toContain("## Previously Rejected Plan (v1)");
    expect(prompt).not.toContain("**Risks:**");
    expect(prompt).not.toContain("**Assumptions:**");
    expect(prompt).not.toContain("**Open Questions:**");
  });

  it("renders an open question without the blocks-execution marker when not required for execution", async () => {
    const { agent, getPrompt } = buildPlannerAgent();
    const bundle = makeTaskBundle();
    const previousPlan: Plan = {
      ...makeEmptyPreviousPlan(),
      openQuestions: [{ id: "q1", question: "Optional question?", requiredForExecution: false }],
    };

    await agent.run(bundle, "run-1", { previousPlan });

    const prompt = getPrompt();
    expect(prompt).toContain("[q1] Optional question?");
    expect(prompt).not.toContain("*(blocks execution)*");
  });

  it("omits the previousPlanSection entirely when no previousPlan option is given", async () => {
    const { agent, getPrompt } = buildPlannerAgent();
    const bundle = makeTaskBundle();

    await agent.run(bundle, "run-1");

    const prompt = getPrompt();
    expect(prompt).not.toContain("Previously Rejected Plan");
    expect(prompt).not.toContain("{{previousPlanSection}}");
  });
});

describe("PlannerAgent.run() planReviewSection", () => {
  it("renders the AI plan review findings summary and finding lines", async () => {
    const { agent, getPrompt } = buildPlannerAgent();
    const bundle = makeTaskBundle();

    await agent.run(bundle, "run-1", {
      planReviewFindings: {
        summary: "Plan had a gap around rollback",
        findings: [
          {
            id: "pr1",
            severity: "important",
            title: "No rollback step",
            details: "Migration has no rollback path",
          },
        ],
      },
    });

    const prompt = getPrompt();
    expect(prompt).toContain("## AI Plan Review Findings (from previous plan)");
    expect(prompt).toContain("**Review Summary:** Plan had a gap around rollback");
    expect(prompt).toContain("- **[important] No rollback step** (pr1): Migration has no rollback path");
    expect(prompt).toContain("Incorporate these findings into the revised plan where appropriate.");
  });

  it("renders multiple finding lines joined by newlines", async () => {
    const { agent, getPrompt } = buildPlannerAgent();
    const bundle = makeTaskBundle();

    await agent.run(bundle, "run-1", {
      planReviewFindings: {
        summary: "Two findings",
        findings: [
          { id: "pr1", severity: "blocker", title: "First", details: "D1" },
          { id: "pr2", severity: "nit", title: "Second", details: "D2" },
        ],
      },
    });

    const prompt = getPrompt();
    expect(prompt).toContain("- **[blocker] First** (pr1): D1");
    expect(prompt).toContain("- **[nit] Second** (pr2): D2");
  });

  it("omits the planReviewSection entirely when planReviewFindings is not provided", async () => {
    const { agent, getPrompt } = buildPlannerAgent();
    const bundle = makeTaskBundle();

    await agent.run(bundle, "run-1");

    const prompt = getPrompt();
    expect(prompt).not.toContain("## AI Plan Review Findings");
    expect(prompt).not.toContain("{{planReviewSection}}");
  });
});

describe("PlannerAgent.run() priorSkillsSection", () => {
  function makeSkill(overrides: Partial<SkillDocument> = {}): SkillDocument {
    return {
      id: "skill-1",
      repoSlug: "org/repo",
      name: "deploy-safely",
      description: "How to deploy without downtime",
      taskCategory: "deployment",
      skillMarkdown: "## Deploy safely\n\nAlways run migrations first.",
      utilityScore: 0.9,
      lastUsedAt: new Date("2024-01-01"),
      ...overrides,
    };
  }

  it("renders a heading with name and taskCategory, plus the description and markdown body", async () => {
    const { agent, getPrompt } = buildPlannerAgent();
    const bundle = makeTaskBundle();

    await agent.run(bundle, "run-1", { priorSkills: [makeSkill()] });

    const prompt = getPrompt();
    expect(prompt).toContain("## Prior Skills from Similar Tasks");
    expect(prompt).toContain("### deploy-safely (deployment)");
    expect(prompt).toContain("How to deploy without downtime");
    expect(prompt).toContain("Always run migrations first.");
  });

  it("falls back to taskCategory alone as the heading when name is null", async () => {
    const { agent, getPrompt } = buildPlannerAgent();
    const bundle = makeTaskBundle();

    await agent.run(bundle, "run-1", {
      priorSkills: [makeSkill({ name: null, description: null })],
    });

    const prompt = getPrompt();
    expect(prompt).toContain("### deployment");
    expect(prompt).not.toContain("### deployment (deployment)");
    expect(prompt).not.toContain("### null");
  });

  it("joins multiple skill blocks with a blank line between them", async () => {
    const { agent, getPrompt } = buildPlannerAgent();
    const bundle = makeTaskBundle();

    await agent.run(bundle, "run-1", {
      priorSkills: [
        makeSkill({ name: "skill-a", taskCategory: "cat-a" }),
        makeSkill({ name: "skill-b", taskCategory: "cat-b", description: null }),
      ],
    });

    const prompt = getPrompt();
    expect(prompt).toContain("### skill-a (cat-a)");
    expect(prompt).toContain("### skill-b (cat-b)");
  });

  it("omits the priorSkillsSection when priorSkills is undefined or empty", async () => {
    const { agent, getPrompt } = buildPlannerAgent();
    const bundle = makeTaskBundle();

    await agent.run(bundle, "run-1", { priorSkills: [] });

    const prompt = getPrompt();
    expect(prompt).not.toContain("## Prior Skills from Similar Tasks");
  });
});
