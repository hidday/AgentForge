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
    planVersion: 1,
    summary: "Previous plan summary",
    requirementsTraceability: "",
    assumptions: ["Assumption A"],
    openQuestions: [
      { id: "q1", question: "Blocking question?", requiredForExecution: true },
      { id: "q2", question: "Non-blocking question?", requiredForExecution: false },
    ],
    risks: ["Risk A"],
    steps: [{ id: "s1", title: "Old step", description: "Old description" }],
    testPlan: "Old test plan",
    confidence: 0.6,
    ...overrides,
  };
}

describe("PlannerAgent.run() plan review findings section", () => {
  it("renders the AI Plan Review Findings section when planReviewFindings is provided", async () => {
    const { agent, getPrompt } = buildPlannerAgent();
    const bundle = makeTaskBundle();

    await agent.run(bundle, "run-1", {
      planReviewFindings: {
        summary: "A couple of issues found.",
        findings: [
          { id: "pf1", severity: "important", title: "Missing error handling", details: "Add it." },
          { id: "pf2", severity: "suggestion", title: "Consider OpenAPI docs", details: "Nice to have." },
        ],
      },
    });

    const prompt = getPrompt();
    expect(prompt).toContain("## AI Plan Review Findings (from previous plan)");
    expect(prompt).toContain("**Review Summary:** A couple of issues found.");
    expect(prompt).toContain("- **[important] Missing error handling** (pf1): Add it.");
    expect(prompt).toContain("- **[suggestion] Consider OpenAPI docs** (pf2): Nice to have.");
    expect(prompt).toContain("Incorporate these findings into the revised plan where appropriate.");
  });

  it("omits the AI Plan Review Findings section when planReviewFindings is absent", async () => {
    const { agent, getPrompt } = buildPlannerAgent();

    await agent.run(makeTaskBundle(), "run-1");

    const prompt = getPrompt();
    expect(prompt).not.toContain("## AI Plan Review Findings");
  });
});

describe("PlannerAgent.run() previous plan section", () => {
  it("renders the full previous plan section with risks, assumptions, and open questions", async () => {
    const { agent, getPrompt } = buildPlannerAgent();

    await agent.run(makeTaskBundle(), "run-1", { previousPlan: makePreviousPlan() });

    const prompt = getPrompt();
    expect(prompt).toContain("## Previously Rejected Plan (v1)");
    expect(prompt).toContain("**Summary:** Previous plan summary");
    expect(prompt).toContain("**Confidence:** 60%");
    expect(prompt).toContain("1. **Old step** (s1): Old description");
    expect(prompt).toContain("**Assumptions:**\n- Assumption A");
    expect(prompt).toContain("**Risks:**\n- Risk A");
    expect(prompt).toContain("**Open Questions:**");
    expect(prompt).toContain("[q1] Blocking question? *(blocks execution)*");
    expect(prompt).toContain("[q2] Non-blocking question?");
    expect(prompt).not.toContain("[q2] Non-blocking question? *(blocks execution)*");
    expect(prompt).toContain("**Test Plan:** Old test plan");
    expect(prompt).toContain("Use this as the starting point for the new plan.");
  });

  it("omits assumptions/risks/open-questions blocks when the previous plan has none of them", async () => {
    const { agent, getPrompt } = buildPlannerAgent();

    await agent.run(makeTaskBundle(), "run-1", {
      previousPlan: makePreviousPlan({ assumptions: [], risks: [], openQuestions: [] }),
    });

    const prompt = getPrompt();
    expect(prompt).toContain("## Previously Rejected Plan (v1)");
    expect(prompt).not.toContain("**Assumptions:**");
    expect(prompt).not.toContain("**Risks:**");
    expect(prompt).not.toContain("**Open Questions:**");
  });

  it("omits the previous plan section entirely when previousPlan is absent", async () => {
    const { agent, getPrompt } = buildPlannerAgent();

    await agent.run(makeTaskBundle(), "run-1");

    const prompt = getPrompt();
    expect(prompt).not.toContain("Previously Rejected Plan");
  });
});

describe("PlannerAgent.run() prior skills section", () => {
  it("renders prior skills with name/taskCategory heading and description when provided", async () => {
    const { agent, getPrompt } = buildPlannerAgent();

    await agent.run(makeTaskBundle(), "run-1", {
      priorSkills: [
        {
          id: "skill-1",
          repoSlug: "test-repo",
          name: "auth-middleware",
          description: "Use when adding auth middleware.",
          taskCategory: "auth middleware",
          skillMarkdown: "Use JWT with RS256.",
          utilityScore: 0.8,
          lastUsedAt: new Date(),
        },
      ],
    });

    const prompt = getPrompt();
    expect(prompt).toContain("## Prior Skills from Similar Tasks");
    expect(prompt).toContain("### auth-middleware (auth middleware)");
    expect(prompt).toContain("Use when adding auth middleware.");
    expect(prompt).toContain("Use JWT with RS256.");
  });

  it("falls back to taskCategory as the heading and omits the intro when name/description are absent", async () => {
    const { agent, getPrompt } = buildPlannerAgent();

    await agent.run(makeTaskBundle(), "run-1", {
      priorSkills: [
        {
          id: "skill-2",
          repoSlug: "test-repo",
          name: null,
          description: null,
          taskCategory: "database migration",
          skillMarkdown: "Run migrations in a transaction.",
          utilityScore: 0.5,
          lastUsedAt: new Date(),
        },
      ],
    });

    const prompt = getPrompt();
    expect(prompt).toContain("### database migration\n\nRun migrations in a transaction.");
  });

  it("joins multiple prior skills with a blank line between blocks", async () => {
    const { agent, getPrompt } = buildPlannerAgent();

    await agent.run(makeTaskBundle(), "run-1", {
      priorSkills: [
        {
          id: "skill-1",
          repoSlug: "test-repo",
          name: "skill-one",
          description: null,
          taskCategory: "cat-one",
          skillMarkdown: "md-one",
          utilityScore: 0.5,
          lastUsedAt: new Date(),
        },
        {
          id: "skill-2",
          repoSlug: "test-repo",
          name: "skill-two",
          description: null,
          taskCategory: "cat-two",
          skillMarkdown: "md-two",
          utilityScore: 0.5,
          lastUsedAt: new Date(),
        },
      ],
    });

    const prompt = getPrompt();
    expect(prompt).toContain("### skill-one (cat-one)\n\nmd-one\n\n### skill-two (cat-two)\n\nmd-two");
  });
});
