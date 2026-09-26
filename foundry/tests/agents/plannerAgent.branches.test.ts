import { describe, it, expect, vi } from "vitest";
import { PlannerAgent } from "../../src/agents/plannerAgent.js";
import type { TaskBundle } from "../../src/schemas/taskBundle.js";

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

describe("PlannerAgent.run() planReviewFindings injection", () => {
  it("renders the AI Plan Review Findings section when planReviewFindings is provided", async () => {
    const { agent, getPrompt } = buildPlannerAgent();
    const bundle = makeTaskBundle();

    await agent.run(bundle, "run-1", {
      planReviewFindings: {
        summary: "Two issues found in the previous plan.",
        findings: [
          {
            id: "f1",
            severity: "important",
            title: "Missing rollback plan",
            details: "No mention of how to roll back the migration.",
          },
          {
            id: "f2",
            severity: "nit",
            title: "Vague step description",
            details: "Step 2 doesn't say which file to edit.",
          },
        ],
      },
    });

    const prompt = getPrompt();
    expect(prompt).toContain("## AI Plan Review Findings (from previous plan)");
    expect(prompt).toContain("Two issues found in the previous plan.");
    expect(prompt).toContain("- **[important] Missing rollback plan** (f1): No mention of how to roll back the migration.");
    expect(prompt).toContain("- **[nit] Vague step description** (f2): Step 2 doesn't say which file to edit.");
    expect(prompt).toContain("Incorporate these findings into the revised plan where appropriate.");
  });

  it("omits the AI Plan Review Findings section when planReviewFindings is absent", async () => {
    const { agent, getPrompt } = buildPlannerAgent();

    await agent.run(makeTaskBundle(), "run-1");

    const prompt = getPrompt();
    expect(prompt).not.toContain("## AI Plan Review Findings");
    expect(prompt).not.toContain("{{planReviewSection}}");
  });
});

describe("PlannerAgent.run() previousPlan injection", () => {
  it("renders the Previously Rejected Plan section with steps, risks, assumptions, and open questions", async () => {
    const { agent, getPrompt } = buildPlannerAgent();

    await agent.run(makeTaskBundle(), "run-1", {
      previousPlan: {
        planVersion: 3,
        summary: "Old plan summary",
        requirementsTraceability: "",
        assumptions: ["Assumption one"],
        openQuestions: [
          { id: "q1", question: "Should we cache?", requiredForExecution: true },
          { id: "q2", question: "Optional detail?", requiredForExecution: false },
        ],
        risks: ["Risk one"],
        steps: [{ id: "s1", title: "Old step", description: "Old description" }],
        testPlan: "Old test plan",
        confidence: 0.75,
      },
    });

    const prompt = getPrompt();
    expect(prompt).toContain("## Previously Rejected Plan (v3)");
    expect(prompt).toContain("**Summary:** Old plan summary");
    expect(prompt).toContain("**Confidence:** 75%");
    expect(prompt).toContain("1. **Old step** (s1): Old description");
    expect(prompt).toContain("**Risks:**\n- Risk one");
    expect(prompt).toContain("**Assumptions:**\n- Assumption one");
    expect(prompt).toContain("[q1] Should we cache? *(blocks execution)*");
    expect(prompt).toContain("[q2] Optional detail?");
    expect(prompt).not.toContain("q2] Optional detail? *(blocks execution)*");
    expect(prompt).toContain("**Open Questions:**");
    expect(prompt).toContain("**Test Plan:** Old test plan");
    expect(prompt).toContain("Use this as the starting point for the new plan.");
  });

  it("omits risks/assumptions/openQuestions sub-sections when the previous plan has none", async () => {
    const { agent, getPrompt } = buildPlannerAgent();

    await agent.run(makeTaskBundle(), "run-1", {
      previousPlan: {
        planVersion: 1,
        summary: "Minimal plan",
        requirementsTraceability: "",
        assumptions: [],
        openQuestions: [],
        risks: [],
        steps: [{ id: "s1", title: "Only step", description: "Do it" }],
        testPlan: "Test it",
        confidence: 0.5,
      },
    });

    const prompt = getPrompt();
    expect(prompt).toContain("## Previously Rejected Plan (v1)");
    expect(prompt).not.toContain("**Risks:**");
    expect(prompt).not.toContain("**Assumptions:**");
    expect(prompt).not.toContain("**Open Questions:**");
  });

  it("omits the Previously Rejected Plan section when previousPlan is absent", async () => {
    const { agent, getPrompt } = buildPlannerAgent();

    await agent.run(makeTaskBundle(), "run-1");

    const prompt = getPrompt();
    expect(prompt).not.toContain("Previously Rejected Plan");
    expect(prompt).not.toContain("{{previousPlanSection}}");
  });
});

describe("PlannerAgent.run() priorSkills injection", () => {
  it("renders each prior skill with its heading, description, and markdown body", async () => {
    const { agent, getPrompt } = buildPlannerAgent();

    await agent.run(makeTaskBundle(), "run-1", {
      priorSkills: [
        {
          id: "skill-1",
          repoSlug: "test-repo",
          name: "jwt-auth",
          description: "Use when adding JWT auth.",
          taskCategory: "auth",
          skillMarkdown: "Always use RS256.",
          utilityScore: 0.5,
          lastUsedAt: new Date(),
        },
        {
          id: "skill-2",
          repoSlug: "test-repo",
          name: null,
          description: null,
          taskCategory: "db migrations",
          skillMarkdown: "Run migrations before deploy.",
          utilityScore: 0.3,
          lastUsedAt: new Date(),
        },
      ],
    });

    const prompt = getPrompt();
    expect(prompt).toContain("## Prior Skills from Similar Tasks");
    expect(prompt).toContain("### jwt-auth (auth)");
    expect(prompt).toContain("Use when adding JWT auth.");
    expect(prompt).toContain("Always use RS256.");
    // Skill without a name falls back to taskCategory as the heading, and
    // without a description the intro line is omitted entirely.
    expect(prompt).toContain("### db migrations\n\nRun migrations before deploy.");
  });

  it("omits the Prior Skills section when priorSkills is empty or absent", async () => {
    const { agent, getPrompt } = buildPlannerAgent();

    await agent.run(makeTaskBundle(), "run-1", { priorSkills: [] });

    const prompt = getPrompt();
    expect(prompt).not.toContain("## Prior Skills from Similar Tasks");
  });
});
