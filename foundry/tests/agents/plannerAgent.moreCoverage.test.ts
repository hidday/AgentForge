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

function makeFullPreviousPlan(overrides: Partial<Plan> = {}): Plan {
  return {
    planVersion: 1,
    summary: "Original summary",
    confidence: 0.75,
    steps: [
      { id: "s1", title: "First step", description: "First description" },
      { id: "s2", title: "Second step", description: "Second description" },
    ],
    assumptions: ["Assumes staging env exists"],
    risks: ["Might break downstream consumers"],
    openQuestions: [
      { id: "q1", question: "Which DB?", requiredForExecution: true },
      { id: "q2", question: "Which cache?", requiredForExecution: false },
    ],
    testPlan: "Run the full regression suite",
    ...overrides,
  } as Plan;
}

describe("PlannerAgent.run() - additional branch coverage", () => {
  describe("planReviewFindings injection", () => {
    it("renders the AI Plan Review Findings section with findings formatted", async () => {
      const { agent, getPrompt } = buildPlannerAgent();
      const bundle = makeTaskBundle();

      await agent.run(bundle, "run-1", {
        planReviewFindings: {
          summary: "Mostly solid, one gap",
          findings: [
            {
              id: "f1",
              severity: "high",
              title: "Missing rollback plan",
              details: "No rollback steps were defined.",
            },
          ],
        },
      });

      const prompt = getPrompt();
      expect(prompt).toContain("## AI Plan Review Findings (from previous plan)");
      expect(prompt).toContain("**Review Summary:** Mostly solid, one gap");
      expect(prompt).toContain("- **[high] Missing rollback plan** (f1): No rollback steps were defined.");
      expect(prompt).toContain("Incorporate these findings into the revised plan where appropriate.");
    });

    it("omits the plan review findings section when not provided", async () => {
      const { agent, getPrompt } = buildPlannerAgent();
      const bundle = makeTaskBundle();

      await agent.run(bundle, "run-1");

      const prompt = getPrompt();
      expect(prompt).not.toContain("## AI Plan Review Findings");
    });
  });

  describe("previousPlan injection", () => {
    it("renders the full previous plan section including assumptions, risks, and open questions", async () => {
      const { agent, getPrompt } = buildPlannerAgent();
      const bundle = makeTaskBundle();
      const previousPlan = makeFullPreviousPlan();

      await agent.run(bundle, "run-1", { previousPlan });

      const prompt = getPrompt();
      expect(prompt).toContain("## Previously Rejected Plan (v1)");
      expect(prompt).toContain("**Summary:** Original summary");
      expect(prompt).toContain("**Confidence:** 75%");
      expect(prompt).toContain("1. **First step** (s1): First description");
      expect(prompt).toContain("2. **Second step** (s2): Second description");
      expect(prompt).toContain("**Assumptions:**\n- Assumes staging env exists");
      expect(prompt).toContain("**Risks:**\n- Might break downstream consumers");
      expect(prompt).toContain("**Open Questions:**");
      expect(prompt).toContain("- [q1] Which DB? *(blocks execution)*");
      expect(prompt).toContain("- [q2] Which cache?");
      expect(prompt).not.toContain("Which cache? *(blocks execution)*");
      expect(prompt).toContain("**Test Plan:** Run the full regression suite");
      expect(prompt).toContain("Use this as the starting point for the new plan.");
    });

    it("omits assumptions, risks, and open questions blocks when those arrays are empty", async () => {
      const { agent, getPrompt } = buildPlannerAgent();
      const bundle = makeTaskBundle();
      const previousPlan = makeFullPreviousPlan({ assumptions: [], risks: [], openQuestions: [] });

      await agent.run(bundle, "run-1", { previousPlan });

      const prompt = getPrompt();
      expect(prompt).toContain("## Previously Rejected Plan (v1)");
      expect(prompt).not.toContain("**Assumptions:**");
      expect(prompt).not.toContain("**Risks:**");
      expect(prompt).not.toContain("**Open Questions:**");
    });

    it("omits the previous plan section entirely when not provided", async () => {
      const { agent, getPrompt } = buildPlannerAgent();
      const bundle = makeTaskBundle();

      await agent.run(bundle, "run-1");

      const prompt = getPrompt();
      expect(prompt).not.toContain("## Previously Rejected Plan");
    });
  });

  describe("priorSkills injection", () => {
    it("renders prior skill blocks with name, taskCategory, and description when all present", async () => {
      const { agent, getPrompt } = buildPlannerAgent();
      const bundle = makeTaskBundle();

      await agent.run(bundle, "run-1", {
        priorSkills: [
          {
            name: "OAuth Setup",
            taskCategory: "auth",
            description: "How to wire up OAuth2 in this repo.",
            skillMarkdown: "Step 1: install the package.",
          } as never,
        ],
      });

      const prompt = getPrompt();
      expect(prompt).toContain("## Prior Skills from Similar Tasks");
      expect(prompt).toContain("### OAuth Setup (auth)");
      expect(prompt).toContain("How to wire up OAuth2 in this repo.");
      expect(prompt).toContain("Step 1: install the package.");
    });

    it("falls back to taskCategory as heading and omits intro when name/description are absent", async () => {
      const { agent, getPrompt } = buildPlannerAgent();
      const bundle = makeTaskBundle();

      await agent.run(bundle, "run-1", {
        priorSkills: [
          {
            taskCategory: "refactor",
            skillMarkdown: "Just the markdown body.",
          } as never,
        ],
      });

      const prompt = getPrompt();
      expect(prompt).toContain("### refactor\n\nJust the markdown body.");
    });

    it("joins multiple prior skills with a blank line between blocks", async () => {
      const { agent, getPrompt } = buildPlannerAgent();
      const bundle = makeTaskBundle();

      await agent.run(bundle, "run-1", {
        priorSkills: [
          { taskCategory: "auth", skillMarkdown: "First skill body." } as never,
          { taskCategory: "infra", skillMarkdown: "Second skill body." } as never,
        ],
      });

      const prompt = getPrompt();
      expect(prompt).toContain("### auth\n\nFirst skill body.\n\n### infra\n\nSecond skill body.");
    });

    it("omits the prior skills section when priorSkills is undefined or empty", async () => {
      const { agent, getPrompt } = buildPlannerAgent();
      const bundle = makeTaskBundle();

      await agent.run(bundle, "run-1", { priorSkills: [] });

      const prompt = getPrompt();
      expect(prompt).not.toContain("## Prior Skills from Similar Tasks");
    });
  });

  describe("combined optional sections", () => {
    it("renders previousPlan, planReviewFindings, and priorSkills together without clobbering each other", async () => {
      const { agent, getPrompt } = buildPlannerAgent();
      const bundle = makeTaskBundle();

      await agent.run(bundle, "run-1", {
        previousPlan: makeFullPreviousPlan(),
        planReviewFindings: {
          summary: "Needs more tests",
          findings: [
            { id: "f1", severity: "medium", title: "Thin test plan", details: "Add edge cases." },
          ],
        },
        priorSkills: [{ taskCategory: "testing", skillMarkdown: "Write boundary tests." } as never],
      });

      const prompt = getPrompt();
      expect(prompt).toContain("## Previously Rejected Plan (v1)");
      expect(prompt).toContain("## AI Plan Review Findings (from previous plan)");
      expect(prompt).toContain("## Prior Skills from Similar Tasks");
    });
  });
});
