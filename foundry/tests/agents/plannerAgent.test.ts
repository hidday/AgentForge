import { describe, it, expect, vi } from "vitest";
import { PlannerAgent } from "../../src/agents/plannerAgent.js";
import type { TaskBundle } from "../../src/schemas/taskBundle.js";
import type { Plan } from "../../src/schemas/plan.js";
import type { SkillDocument } from "../../src/domain/types.js";

function makeSkillDocument(overrides: Partial<SkillDocument> = {}): SkillDocument {
  return {
    id: "skill-1",
    repoSlug: "test-repo",
    name: null,
    description: null,
    taskCategory: "generic-category",
    skillMarkdown: "Some markdown content",
    utilityScore: 0,
    lastUsedAt: new Date("2024-01-01"),
    ...overrides,
  };
}

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
      async (
        _runtime: unknown,
        opts: { prompt: string },
        _name: unknown,
        _schema: unknown,
      ) => {
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

  const agent = new PlannerAgent(
    agentRunner as never,
    artifactRepo as never,
    logger as never,
  );

  return { agent, agentRunner, artifactRepo, getPrompt: () => capturedPrompt };
}

describe("PlannerAgent.run()", () => {
  describe("humanFeedback injection", () => {
    it("renders '## Human Feedback on Previous Plan' section when humanFeedback is provided", async () => {
      const { agent, getPrompt } = buildPlannerAgent();
      const bundle = makeTaskBundle();

      await agent.run(bundle, "run-1", {
        humanFeedback: { planVersion: 2, feedback: "Use OAuth2 not API keys" },
      });

      const prompt = getPrompt();
      expect(prompt).toContain("## Human Feedback on Previous Plan");
      expect(prompt).toContain("**Rejected Plan Version:** V2");
      expect(prompt).toContain("Use OAuth2 not API keys");
      expect(prompt).toContain(
        "Address this feedback directly in the new plan while preserving the valid parts",
      );
    });

    it("includes the correct planVersion in the feedback section", async () => {
      const { agent, getPrompt } = buildPlannerAgent();
      const bundle = makeTaskBundle();

      await agent.run(bundle, "run-1", {
        humanFeedback: { planVersion: 5, feedback: "Refactor the authentication module" },
      });

      const prompt = getPrompt();
      expect(prompt).toContain("V5");
      expect(prompt).toContain("Refactor the authentication module");
    });

    it("does NOT include '## Human Feedback on Previous Plan' when humanFeedback is absent", async () => {
      const { agent, getPrompt } = buildPlannerAgent();
      const bundle = makeTaskBundle();

      await agent.run(bundle, "run-1");

      const prompt = getPrompt();
      expect(prompt).not.toContain("## Human Feedback on Previous Plan");
      expect(prompt).not.toContain("Rejected Plan Version");
    });

    it("does NOT include feedback section when humanFeedback is undefined in options", async () => {
      const { agent, getPrompt } = buildPlannerAgent();
      const bundle = makeTaskBundle();

      await agent.run(bundle, "run-1", { planVersionOverride: 3 });

      const prompt = getPrompt();
      expect(prompt).not.toContain("## Human Feedback on Previous Plan");
    });
  });

  describe("humanAnswers and humanFeedback coexistence", () => {
    it("renders both humanAnswersSection and humanFeedbackSection when both are provided", async () => {
      const { agent, getPrompt } = buildPlannerAgent();
      const bundle = makeTaskBundle();

      await agent.run(bundle, "run-1", {
        humanAnswers: [{ questionId: "q1", answer: "Use Postgres" }],
        humanFeedback: { planVersion: 2, feedback: "Keep it simple" },
      });

      const prompt = getPrompt();
      expect(prompt).toContain("## Human Answers to Open Questions");
      expect(prompt).toContain("## Human Feedback on Previous Plan");
      expect(prompt).toContain("Use Postgres");
      expect(prompt).toContain("Keep it simple");
    });
  });

  describe("researchedAnswers injection", () => {
    it("renders '## Researched Answers to Open Questions' section when researchedAnswers is provided", async () => {
      const { agent, getPrompt } = buildPlannerAgent();
      const bundle = makeTaskBundle();

      await agent.run(bundle, "run-1", {
        researchedAnswers: [
          {
            questionId: "q1",
            question: "Should we use Postgres?",
            answer: "Yes, existing schema uses it.",
            confidence: "high",
            sources: ["foundry/prisma/schema.prisma"],
          },
        ],
      });

      const prompt = getPrompt();
      expect(prompt).toContain("## Researched Answers to Open Questions");
      expect(prompt).toContain("[q1] (confidence: high)");
      expect(prompt).toContain("Yes, existing schema uses it.");
      expect(prompt).toContain("foundry/prisma/schema.prisma");
      expect(prompt).toContain("AI best-effort, not authoritative");
    });

    it("omits the researched answers section when no researchedAnswers are provided", async () => {
      const { agent, getPrompt } = buildPlannerAgent();
      const bundle = makeTaskBundle();

      await agent.run(bundle, "run-1");

      const prompt = getPrompt();
      expect(prompt).not.toContain("## Researched Answers to Open Questions");
      expect(prompt).not.toContain("{{researchedAnswersSection}}");
    });

    it("renders both humanAnswersSection and researchedAnswersSection when both are provided", async () => {
      const { agent, getPrompt } = buildPlannerAgent();
      const bundle = makeTaskBundle();

      await agent.run(bundle, "run-1", {
        humanAnswers: [{ questionId: "q1", answer: "Human says Postgres" }],
        researchedAnswers: [
          {
            questionId: "q2",
            question: "Optional convention?",
            answer: "Use camelCase per existing pattern.",
            confidence: "medium",
          },
        ],
      });

      const prompt = getPrompt();
      expect(prompt).toContain("## Human Answers to Open Questions");
      expect(prompt).toContain("Human says Postgres");
      expect(prompt).toContain("## Researched Answers to Open Questions");
      expect(prompt).toContain("[q2] (confidence: medium)");
    });

    it("renders confidence levels and skips sources line when sources are absent", async () => {
      const { agent, getPrompt } = buildPlannerAgent();
      const bundle = makeTaskBundle();

      await agent.run(bundle, "run-1", {
        researchedAnswers: [
          {
            questionId: "q1",
            question: "Q?",
            answer: "A without sources",
            confidence: "low",
          },
        ],
      });

      const prompt = getPrompt();
      expect(prompt).toContain("[q1] (confidence: low)");
      expect(prompt).toContain("A without sources");
      const researchedIdx = prompt.indexOf("## Researched Answers to Open Questions");
      const section = prompt.slice(researchedIdx, researchedIdx + 400);
      expect(section).not.toContain("- sources:");
    });
  });

  describe("planReviewFindings injection", () => {
    it("renders the '## AI Plan Review Findings' section with findings when provided", async () => {
      const { agent, getPrompt } = buildPlannerAgent();
      const bundle = makeTaskBundle();

      await agent.run(bundle, "run-1", {
        planReviewFindings: {
          summary: "The plan missed an edge case.",
          findings: [
            {
              id: "pf1",
              severity: "important",
              title: "Missing error handling",
              details: "No handling for malformed input.",
            },
          ],
        },
      });

      const prompt = getPrompt();
      expect(prompt).toContain("## AI Plan Review Findings (from previous plan)");
      expect(prompt).toContain("The plan missed an edge case.");
      expect(prompt).toContain("[important] Missing error handling");
      expect(prompt).toContain("(pf1): No handling for malformed input.");
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
    it("renders the previously rejected plan with steps, risks, assumptions, and open questions", async () => {
      const { agent, getPrompt } = buildPlannerAgent();
      const bundle = makeTaskBundle();
      const previousPlan: Plan = {
        planVersion: 3,
        summary: "Old approach using session cookies.",
        requirementsTraceability: "",
        assumptions: ["Users have cookies enabled"],
        openQuestions: [
          { id: "q1", question: "Should tokens expire?", requiredForExecution: true },
          { id: "q2", question: "Optional naming convention?", requiredForExecution: false },
        ],
        risks: ["Cookie approach doesn't work for mobile clients"],
        steps: [{ id: "s1", title: "Set cookie on login", description: "Issue a session cookie" }],
        testPlan: "Test login flow",
        confidence: 0.6,
      };

      await agent.run(bundle, "run-1", { previousPlan });

      const prompt = getPrompt();
      expect(prompt).toContain("## Previously Rejected Plan (v3)");
      expect(prompt).toContain("Old approach using session cookies.");
      expect(prompt).toContain("**Confidence:** 60%");
      expect(prompt).toContain("1. **Set cookie on login** (s1): Issue a session cookie");
      expect(prompt).toContain("**Risks:**");
      expect(prompt).toContain("Cookie approach doesn't work for mobile clients");
      expect(prompt).toContain("**Assumptions:**");
      expect(prompt).toContain("Users have cookies enabled");
      expect(prompt).toContain("**Open Questions:**");
      expect(prompt).toContain("Should tokens expire?");
      expect(prompt).toContain("*(blocks execution)*");
      expect(prompt).toContain("Optional naming convention?");
      expect(prompt).toContain("Test login flow");
    });

    it("omits risks/assumptions/open-questions sub-sections when the previous plan has none", async () => {
      const { agent, getPrompt } = buildPlannerAgent();
      const bundle = makeTaskBundle();
      const previousPlan: Plan = {
        planVersion: 1,
        summary: "Minimal plan.",
        requirementsTraceability: "",
        assumptions: [],
        openQuestions: [],
        risks: [],
        steps: [{ id: "s1", title: "Do it", description: "Just do it" }],
        testPlan: "Smoke test",
        confidence: 0.5,
      };

      await agent.run(bundle, "run-1", { previousPlan });

      const prompt = getPrompt();
      expect(prompt).toContain("## Previously Rejected Plan (v1)");
      expect(prompt).not.toContain("**Risks:**");
      expect(prompt).not.toContain("**Assumptions:**");
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
    it("renders prior skills with name/description headings when provided", async () => {
      const { agent, getPrompt } = buildPlannerAgent();
      const bundle = makeTaskBundle();

      await agent.run(bundle, "run-1", {
        priorSkills: [
          makeSkillDocument({
            taskCategory: "api-validation",
            name: "zod-validation-middleware",
            description: "How to add Zod validation middleware to Fastify routes.",
            skillMarkdown: "## Steps\n1. Create middleware\n2. Apply to routes",
          }),
        ],
      });

      const prompt = getPrompt();
      expect(prompt).toContain("## Prior Skills from Similar Tasks");
      expect(prompt).toContain("### zod-validation-middleware (api-validation)");
      expect(prompt).toContain("How to add Zod validation middleware to Fastify routes.");
      expect(prompt).toContain("1. Create middleware");
    });

    it("falls back to taskCategory as the heading when a skill has no name", async () => {
      const { agent, getPrompt } = buildPlannerAgent();
      const bundle = makeTaskBundle();

      await agent.run(bundle, "run-1", {
        priorSkills: [makeSkillDocument()],
      });

      const prompt = getPrompt();
      expect(prompt).toContain("### generic-category");
      expect(prompt).toContain("Some markdown content");
    });

    it("omits the prior skills section when none are provided", async () => {
      const { agent, getPrompt } = buildPlannerAgent();
      const bundle = makeTaskBundle();

      await agent.run(bundle, "run-1");

      const prompt = getPrompt();
      expect(prompt).not.toContain("## Prior Skills from Similar Tasks");
    });

    it("omits the prior skills section when an empty array is provided", async () => {
      const { agent, getPrompt } = buildPlannerAgent();
      const bundle = makeTaskBundle();

      await agent.run(bundle, "run-1", { priorSkills: [] });

      const prompt = getPrompt();
      expect(prompt).not.toContain("## Prior Skills from Similar Tasks");
    });
  });

  describe("relatedContext rendering", () => {
    it("renders the Related Linear Context section when bundle has parent and blockers", async () => {
      const { agent, getPrompt } = buildPlannerAgent();
      const bundle: TaskBundle = {
        ...makeTaskBundle(),
        relatedContext: {
          parent: {
            id: "p1",
            identifier: "PRY-100",
            title: "Umbrella feature X",
            description: "Roll-up effort tracking feature X.",
            state: "In Progress",
            labels: ["epic"],
            priority: 2,
            url: "https://linear.app/team/issue/PRY-100",
          },
          blockers: [
            {
              id: "b1",
              identifier: "PRY-101",
              title: "Migration must complete first",
              description: "Schema migration prerequisite.",
              state: "Todo",
              labels: ["infra"],
              priority: 1,
              url: "https://linear.app/team/issue/PRY-101",
            },
          ],
        },
      };

      await agent.run(bundle, "run-1");

      const prompt = getPrompt();
      expect(prompt).toContain("===== BEGIN BACKGROUND CONTEXT");
      expect(prompt).toContain("===== END BACKGROUND CONTEXT");
      expect(prompt).toContain("## Background: Related Linear Context (NOT the focus issue)");
      expect(prompt).toContain("STRICTLY ADDITIONAL BACKGROUND");
      expect(prompt).toContain("### Background: Parent Issue");
      expect(prompt).toContain("PRY-100");
      expect(prompt).toContain("Umbrella feature X");
      expect(prompt).toContain(
        "### Background: Blocker Issues (must be understood before the focus issue can ship)",
      );
      expect(prompt).toContain("#### Background: Blocker 1");
      expect(prompt).toContain("PRY-101");
      expect(prompt).toContain("Migration must complete first");
      expect(prompt).toContain("Schema migration prerequisite.");
    });

    it("omits the Related Linear Context section when bundle has no relatedContext", async () => {
      const { agent, getPrompt } = buildPlannerAgent();
      const bundle = makeTaskBundle();

      await agent.run(bundle, "run-1");

      const prompt = getPrompt();
      expect(prompt).not.toContain("BEGIN BACKGROUND CONTEXT");
      expect(prompt).not.toContain("Background: Related Linear Context");
      expect(prompt).not.toContain("{{relatedContextSection}}");
    });
  });
});
