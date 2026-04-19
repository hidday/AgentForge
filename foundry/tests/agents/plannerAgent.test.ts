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
