import { describe, it, expect, vi } from "vitest";
import { PlannerAgent } from "../../src/agents/plannerAgent.js";
import type { TaskBundle } from "../../src/schemas/taskBundle.js";
import type { Plan } from "../../src/schemas/plan.js";

// This file covers gaps left by tests/agents/plannerAgent.test.ts:
// - planReviewFindings section rendering
// - previousPlanSection, including the risks/assumptions/openQuestions sub-ternaries
//   both when populated and when empty, and the requiredForExecution marker
// - priorSkillsSection, including skill.name and skill.description present/absent

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

function makePreviousPlan(overrides: Partial<Plan> = {}): Plan {
  return {
    planVersion: 1,
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

describe("PlannerAgent.run() gap coverage", () => {
  describe("planReviewFindings section", () => {
    it("renders the AI Plan Review Findings section with summary and finding lines", async () => {
      const { agent, getPrompt } = buildPlannerAgent();
      const bundle = makeTaskBundle();

      await agent.run(bundle, "run-1", {
        planReviewFindings: {
          summary: "Overall the plan is risky.",
          findings: [
            { id: "f1", severity: "high", title: "Missing rollback plan", details: "No rollback." },
            { id: "f2", severity: "low", title: "Typo in step 2", details: "Minor." },
          ],
        },
      });

      const prompt = getPrompt();
      expect(prompt).toContain("## AI Plan Review Findings (from previous plan)");
      expect(prompt).toContain("**Review Summary:** Overall the plan is risky.");
      expect(prompt).toContain("- **[high] Missing rollback plan** (f1): No rollback.");
      expect(prompt).toContain("- **[low] Typo in step 2** (f2): Minor.");
      expect(prompt).toContain("Incorporate these findings into the revised plan where appropriate.");
    });

    it("omits the planReviewSection when planReviewFindings is absent", async () => {
      const { agent, getPrompt } = buildPlannerAgent();
      const bundle = makeTaskBundle();

      await agent.run(bundle, "run-1");

      const prompt = getPrompt();
      expect(prompt).not.toContain("## AI Plan Review Findings");
    });
  });

  describe("previousPlanSection", () => {
    it("renders risks, assumptions, and open questions (incl. requiredForExecution marker) when populated", async () => {
      const { agent, getPrompt } = buildPlannerAgent();
      const bundle = makeTaskBundle();

      const previousPlan = makePreviousPlan({
        risks: ["Risk one", "Risk two"],
        assumptions: ["Assumption one"],
        openQuestions: [
          { id: "q1", question: "Blocking question?", requiredForExecution: true },
          { id: "q2", question: "Non-blocking question?", requiredForExecution: false },
        ],
      });

      await agent.run(bundle, "run-1", { previousPlan });

      const prompt = getPrompt();
      expect(prompt).toContain("## Previously Rejected Plan (v1)");
      expect(prompt).toContain("**Confidence:** 60%");
      expect(prompt).toContain("**Risks:**\n- Risk one\n- Risk two");
      expect(prompt).toContain("**Assumptions:**\n- Assumption one");
      expect(prompt).toContain("**Open Questions:**");
      expect(prompt).toContain("- [q1] Blocking question? *(blocks execution)*");
      expect(prompt).toContain("- [q2] Non-blocking question?");
      expect(prompt).not.toContain("Non-blocking question? *(blocks execution)*");
      expect(prompt).toContain(
        "Use this as the starting point for the new plan. Preserve the parts that are still valid",
      );
    });

    it("omits risks/assumptions/open-questions subsections when those arrays are empty", async () => {
      const { agent, getPrompt } = buildPlannerAgent();
      const bundle = makeTaskBundle();

      const previousPlan = makePreviousPlan({ risks: [], assumptions: [], openQuestions: [] });

      await agent.run(bundle, "run-1", { previousPlan });

      const prompt = getPrompt();
      expect(prompt).toContain("## Previously Rejected Plan (v1)");
      expect(prompt).not.toContain("**Risks:**");
      expect(prompt).not.toContain("**Assumptions:**");
      expect(prompt).not.toContain("**Open Questions:**");
    });

    it("omits the previousPlanSection entirely when previousPlan is absent", async () => {
      const { agent, getPrompt } = buildPlannerAgent();
      const bundle = makeTaskBundle();

      await agent.run(bundle, "run-1");

      const prompt = getPrompt();
      expect(prompt).not.toContain("## Previously Rejected Plan");
    });
  });

  describe("priorSkillsSection", () => {
    it("renders a skill heading with name + description when both are present", async () => {
      const { agent, getPrompt } = buildPlannerAgent();
      const bundle = makeTaskBundle();

      await agent.run(bundle, "run-1", {
        priorSkills: [
          {
            id: "skill-1",
            repoSlug: "test-repo",
            name: "auth-middleware",
            taskCategory: "auth middleware",
            description: "Use when adding JWT auth.",
            skillMarkdown: "Use RS256.",
            utilityScore: 0.5,
            lastUsedAt: new Date(),
          },
        ],
      });

      const prompt = getPrompt();
      expect(prompt).toContain("## Prior Skills from Similar Tasks");
      expect(prompt).toContain("### auth-middleware (auth middleware)");
      expect(prompt).toContain("Use when adding JWT auth.");
      expect(prompt).toContain("Use RS256.");
    });

    it("falls back to taskCategory as heading and omits intro when name/description are absent", async () => {
      const { agent, getPrompt } = buildPlannerAgent();
      const bundle = makeTaskBundle();

      await agent.run(bundle, "run-1", {
        priorSkills: [
          {
            id: "skill-2",
            repoSlug: "test-repo",
            name: null,
            taskCategory: "database migration",
            description: null,
            skillMarkdown: "Run migrations in order.",
            utilityScore: 0.5,
            lastUsedAt: new Date(),
          },
        ],
      });

      const prompt = getPrompt();
      expect(prompt).toContain("### database migration\n\nRun migrations in order.");
    });

    it("omits priorSkillsSection when priorSkills is undefined", async () => {
      const { agent, getPrompt } = buildPlannerAgent();
      const bundle = makeTaskBundle();

      await agent.run(bundle, "run-1");

      const prompt = getPrompt();
      expect(prompt).not.toContain("## Prior Skills from Similar Tasks");
    });
  });
});
