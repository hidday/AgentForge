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

  describe("planReviewFindings injection", () => {
    it("renders '## AI Plan Review Findings' section with summary and findings when provided", async () => {
      const { agent, getPrompt } = buildPlannerAgent();
      const bundle = makeTaskBundle();

      await agent.run(bundle, "run-1", {
        planReviewFindings: {
          summary: "Missing error handling for malformed input.",
          findings: [
            {
              id: "pf1",
              severity: "important",
              title: "No error handling",
              details: "Add a step for malformed JSON.",
            },
            {
              id: "pf2",
              severity: "suggestion",
              title: "Consider OpenAPI docs",
              details: "Nice to have.",
            },
          ],
        },
      });

      const prompt = getPrompt();
      expect(prompt).toContain("## AI Plan Review Findings (from previous plan)");
      expect(prompt).toContain("Missing error handling for malformed input.");
      expect(prompt).toContain("- **[important] No error handling** (pf1): Add a step for malformed JSON.");
      expect(prompt).toContain("- **[suggestion] Consider OpenAPI docs** (pf2): Nice to have.");
      expect(prompt).toContain("Incorporate these findings into the revised plan where appropriate.");
    });

    it("omits the AI Plan Review Findings section when planReviewFindings is absent", async () => {
      const { agent, getPrompt } = buildPlannerAgent();
      const bundle = makeTaskBundle();

      await agent.run(bundle, "run-1");

      const prompt = getPrompt();
      expect(prompt).not.toContain("## AI Plan Review Findings");
    });
  });

  describe("previousPlan injection", () => {
    it("renders the previous plan with steps, risks, assumptions, and required/optional open questions", async () => {
      const { agent, getPrompt } = buildPlannerAgent();
      const bundle = makeTaskBundle();

      const previousPlan: Plan = {
        planVersion: 3,
        summary: "Old plan summary",
        requirementsTraceability: "",
        assumptions: ["Assumption A"],
        openQuestions: [
          { id: "q1", question: "Blocking question?", requiredForExecution: true },
          { id: "q2", question: "Optional question?", requiredForExecution: false },
        ],
        risks: ["Risk A"],
        steps: [
          { id: "s1", title: "Step One", description: "Do the first thing" },
          { id: "s2", title: "Step Two", description: "Do the second thing" },
        ],
        testPlan: "Run the old test plan",
        confidence: 0.75,
      };

      await agent.run(bundle, "run-1", { previousPlan });

      const prompt = getPrompt();
      expect(prompt).toContain("## Previously Rejected Plan (v3)");
      expect(prompt).toContain("**Summary:** Old plan summary");
      expect(prompt).toContain("**Confidence:** 75%");
      expect(prompt).toContain("1. **Step One** (s1): Do the first thing");
      expect(prompt).toContain("2. **Step Two** (s2): Do the second thing");
      expect(prompt).toContain("**Risks:**\n- Risk A");
      expect(prompt).toContain("**Assumptions:**\n- Assumption A");
      expect(prompt).toContain("**Open Questions:**");
      expect(prompt).toContain("[q1] Blocking question? *(blocks execution)*");
      expect(prompt).toContain("[q2] Optional question?");
      expect(prompt).not.toContain("[q2] Optional question? *(blocks execution)*");
      expect(prompt).toContain("**Test Plan:** Run the old test plan");
      expect(prompt).toContain("Use this as the starting point for the new plan.");
    });

    it("omits risks/assumptions/open-questions sub-sections when the previous plan has none", async () => {
      const { agent, getPrompt } = buildPlannerAgent();
      const bundle = makeTaskBundle();

      const previousPlan: Plan = {
        planVersion: 1,
        summary: "Minimal old plan",
        requirementsTraceability: "",
        assumptions: [],
        openQuestions: [],
        risks: [],
        steps: [{ id: "s1", title: "Only step", description: "Do it" }],
        testPlan: "Run tests",
        confidence: 0.5,
      };

      await agent.run(bundle, "run-1", { previousPlan });

      const prompt = getPrompt();
      expect(prompt).toContain("## Previously Rejected Plan (v1)");
      expect(prompt).not.toContain("**Risks:**");
      expect(prompt).not.toContain("**Assumptions:**");
      expect(prompt).not.toContain("**Open Questions:**");
    });

    it("omits the Previously Rejected Plan section when previousPlan is absent", async () => {
      const { agent, getPrompt } = buildPlannerAgent();
      const bundle = makeTaskBundle();

      await agent.run(bundle, "run-1");

      const prompt = getPrompt();
      expect(prompt).not.toContain("Previously Rejected Plan");
    });
  });

  describe("priorSkills injection", () => {
    it("renders skill headings with name+taskCategory and a description when both are present", async () => {
      const { agent, getPrompt } = buildPlannerAgent();
      const bundle = makeTaskBundle();

      await agent.run(bundle, "run-1", {
        priorSkills: [
          {
            id: "skill-1",
            repoSlug: "acme/backend",
            name: "zod-validation-middleware",
            description: "How to wire up Zod validation middleware.",
            taskCategory: "validation",
            skillMarkdown: "## Steps\n1. Do X\n2. Do Y",
            utilityScore: 0.9,
            lastUsedAt: new Date("2024-01-01"),
          },
        ],
      });

      const prompt = getPrompt();
      expect(prompt).toContain("## Prior Skills from Similar Tasks");
      expect(prompt).toContain("### zod-validation-middleware (validation)");
      expect(prompt).toContain("How to wire up Zod validation middleware.");
      expect(prompt).toContain("## Steps\n1. Do X\n2. Do Y");
    });

    it("falls back to taskCategory as the heading and omits the intro when name/description are absent", async () => {
      const { agent, getPrompt } = buildPlannerAgent();
      const bundle = makeTaskBundle();

      await agent.run(bundle, "run-1", {
        priorSkills: [
          {
            id: "skill-2",
            repoSlug: "acme/backend",
            name: null,
            description: null,
            taskCategory: "auth",
            skillMarkdown: "## Steps\n1. Configure auth",
            utilityScore: 0.5,
            lastUsedAt: new Date("2024-01-01"),
          },
        ],
      });

      const prompt = getPrompt();
      expect(prompt).toContain("## Prior Skills from Similar Tasks");
      expect(prompt).toContain("### auth\n\n## Steps\n1. Configure auth");
    });

    it("joins multiple prior skills with a blank line between them", async () => {
      const { agent, getPrompt } = buildPlannerAgent();
      const bundle = makeTaskBundle();

      await agent.run(bundle, "run-1", {
        priorSkills: [
          {
            id: "skill-1",
            repoSlug: "acme/backend",
            name: "skill-one",
            description: null,
            taskCategory: "cat-one",
            skillMarkdown: "Body one",
            utilityScore: 0.9,
            lastUsedAt: new Date("2024-01-01"),
          },
          {
            id: "skill-2",
            repoSlug: "acme/backend",
            name: "skill-two",
            description: null,
            taskCategory: "cat-two",
            skillMarkdown: "Body two",
            utilityScore: 0.8,
            lastUsedAt: new Date("2024-01-01"),
          },
        ],
      });

      const prompt = getPrompt();
      expect(prompt).toContain("### skill-one (cat-one)\n\nBody one\n\n### skill-two (cat-two)\n\nBody two");
    });

    it("omits the Prior Skills section when priorSkills is absent or empty", async () => {
      const { agent, getPrompt } = buildPlannerAgent();
      const bundle = makeTaskBundle();

      await agent.run(bundle, "run-1", { priorSkills: [] });

      const prompt = getPrompt();
      expect(prompt).not.toContain("## Prior Skills from Similar Tasks");
    });
  });
});
