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

  describe("planReviewSection rendering", () => {
    it("renders '## AI Plan Review Findings' with the summary and each finding when planReviewFindings is provided", async () => {
      const { agent, getPrompt } = buildPlannerAgent();
      const bundle = makeTaskBundle();

      await agent.run(bundle, "run-1", {
        planReviewFindings: {
          summary: "Plan is missing a rollback strategy.",
          findings: [
            {
              id: "f1",
              severity: "blocker",
              title: "No rollback plan",
              details: "Add a rollback step for the migration",
            },
          ],
        },
      });

      const prompt = getPrompt();
      expect(prompt).toContain("## AI Plan Review Findings (from previous plan)");
      expect(prompt).toContain("**Review Summary:** Plan is missing a rollback strategy.");
      expect(prompt).toContain("- **[blocker] No rollback plan** (f1): Add a rollback step for the migration");
      expect(prompt).toContain("Incorporate these findings into the revised plan where appropriate.");
    });

    it("does NOT render the plan review findings section when planReviewFindings is absent", async () => {
      const { agent, getPrompt } = buildPlannerAgent();
      const bundle = makeTaskBundle();

      await agent.run(bundle, "run-1");

      const prompt = getPrompt();
      expect(prompt).not.toContain("## AI Plan Review Findings");
      expect(prompt).not.toContain("{{planReviewSection}}");
    });
  });

  describe("previousPlanSection rendering", () => {
    function makePreviousPlan(overrides: Partial<Plan> = {}): Plan {
      return {
        planVersion: 3,
        summary: "Rejected approach summary",
        requirementsTraceability: "",
        assumptions: ["Assumes staging DB mirrors prod"],
        openQuestions: [
          { id: "q1", question: "Is retry idempotent?", requiredForExecution: true },
          { id: "q2", question: "Naming convention?", requiredForExecution: false },
        ],
        risks: ["Could break existing webhook consumers"],
        steps: [
          { id: "s1", title: "Add migration", description: "Add the new column" },
          { id: "s2", title: "Backfill data", description: "Backfill in batches" },
        ],
        testPlan: "Run integration suite",
        confidence: 0.72,
        ...overrides,
      };
    }

    it("renders the previously rejected plan with steps, risks, assumptions, and open questions", async () => {
      const { agent, getPrompt } = buildPlannerAgent();
      const bundle = makeTaskBundle();
      const previousPlan = makePreviousPlan();

      await agent.run(bundle, "run-1", { previousPlan });

      const prompt = getPrompt();
      expect(prompt).toContain("## Previously Rejected Plan (v3)");
      expect(prompt).toContain("**Summary:** Rejected approach summary");
      expect(prompt).toContain("**Confidence:** 72%");
      expect(prompt).toContain("1. **Add migration** (s1): Add the new column");
      expect(prompt).toContain("2. **Backfill data** (s2): Backfill in batches");
      expect(prompt).toContain("**Risks:**\n- Could break existing webhook consumers");
      expect(prompt).toContain("**Assumptions:**\n- Assumes staging DB mirrors prod");
      expect(prompt).toContain("**Open Questions:**");
      expect(prompt).toContain("[q1] Is retry idempotent? *(blocks execution)*");
      expect(prompt).toContain("[q2] Naming convention?");
      expect(prompt).toContain("**Test Plan:** Run integration suite");
      expect(prompt).toContain("Use this as the starting point for the new plan");
    });

    it("omits the Risks, Assumptions, and Open Questions sub-sections when the previous plan has none", async () => {
      const { agent, getPrompt } = buildPlannerAgent();
      const bundle = makeTaskBundle();
      const previousPlan = makePreviousPlan({
        risks: [],
        assumptions: [],
        openQuestions: [],
      });

      await agent.run(bundle, "run-1", { previousPlan });

      const prompt = getPrompt();
      expect(prompt).toContain("## Previously Rejected Plan (v3)");
      expect(prompt).not.toContain("**Risks:**");
      expect(prompt).not.toContain("**Assumptions:**");
      expect(prompt).not.toContain("**Open Questions:**");
    });

    it("does not render the previously-rejected-plan section when previousPlan is absent", async () => {
      const { agent, getPrompt } = buildPlannerAgent();
      const bundle = makeTaskBundle();

      await agent.run(bundle, "run-1");

      const prompt = getPrompt();
      expect(prompt).not.toContain("Previously Rejected Plan");
      expect(prompt).not.toContain("{{previousPlanSection}}");
    });
  });

  describe("priorSkillsSection rendering", () => {
    function makeSkill(overrides: Partial<SkillDocument> = {}): SkillDocument {
      return {
        id: "skill-1",
        repoSlug: "org/repo",
        name: "OAuth2 Setup",
        description: "How to wire up OAuth2 in this repo.",
        taskCategory: "auth",
        skillMarkdown: "1. Install passport\n2. Configure strategy",
        utilityScore: 0.9,
        lastUsedAt: new Date("2026-01-01T00:00:00Z"),
        ...overrides,
      };
    }

    it("renders each prior skill with its name, category, description, and markdown body", async () => {
      const { agent, getPrompt } = buildPlannerAgent();
      const bundle = makeTaskBundle();

      await agent.run(bundle, "run-1", { priorSkills: [makeSkill()] });

      const prompt = getPrompt();
      expect(prompt).toContain("## Prior Skills from Similar Tasks");
      expect(prompt).toContain("### OAuth2 Setup (auth)");
      expect(prompt).toContain("How to wire up OAuth2 in this repo.");
      expect(prompt).toContain("1. Install passport\n2. Configure strategy");
    });

    it("falls back to the task category as the heading and omits the intro when name/description are null", async () => {
      const { agent, getPrompt } = buildPlannerAgent();
      const bundle = makeTaskBundle();
      const skill = makeSkill({ name: null, description: null, taskCategory: "billing" });

      await agent.run(bundle, "run-1", { priorSkills: [skill] });

      const prompt = getPrompt();
      expect(prompt).toContain("### billing");
      expect(prompt).not.toContain("### null");
      // No description line means the markdown body follows the heading directly.
      const headingIdx = prompt.indexOf("### billing");
      const afterHeading = prompt.slice(headingIdx, headingIdx + 80);
      expect(afterHeading).toContain("1. Install passport");
    });

    it("joins multiple prior skills with a blank line between them", async () => {
      const { agent, getPrompt } = buildPlannerAgent();
      const bundle = makeTaskBundle();

      await agent.run(bundle, "run-1", {
        priorSkills: [
          makeSkill({ id: "skill-1", name: "Skill One", taskCategory: "auth" }),
          makeSkill({ id: "skill-2", name: "Skill Two", taskCategory: "billing" }),
        ],
      });

      const prompt = getPrompt();
      expect(prompt).toContain("### Skill One (auth)");
      expect(prompt).toContain("### Skill Two (billing)");
    });

    it("does not render the prior-skills section when priorSkills is empty or absent", async () => {
      const { agent, getPrompt } = buildPlannerAgent();
      const bundle = makeTaskBundle();

      await agent.run(bundle, "run-1", { priorSkills: [] });

      const prompt = getPrompt();
      expect(prompt).not.toContain("## Prior Skills from Similar Tasks");
      expect(prompt).not.toContain("{{priorSkillsSection}}");
    });
  });
});
