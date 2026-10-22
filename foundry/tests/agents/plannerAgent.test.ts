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
    it("renders '## AI Plan Review Findings' with summary and findings when provided", async () => {
      const { agent, getPrompt } = buildPlannerAgent();
      const bundle = makeTaskBundle();

      await agent.run(bundle, "run-1", {
        planReviewFindings: {
          summary: "Plan is mostly sound but missing rollback steps.",
          findings: [
            { id: "f1", severity: "blocker", title: "No rollback plan", details: "Add one" },
          ],
        },
      });

      const prompt = getPrompt();
      expect(prompt).toContain("## AI Plan Review Findings (from previous plan)");
      expect(prompt).toContain("Plan is mostly sound but missing rollback steps.");
      expect(prompt).toContain("**[blocker] No rollback plan** (f1): Add one");
      expect(prompt).toContain("Incorporate these findings into the revised plan");
    });

    it("omits the plan review findings section when absent", async () => {
      const { agent, getPrompt } = buildPlannerAgent();
      await agent.run(makeTaskBundle(), "run-1");

      const prompt = getPrompt();
      expect(prompt).not.toContain("## AI Plan Review Findings");
      expect(prompt).not.toContain("{{planReviewSection}}");
    });
  });

  describe("previousPlan injection", () => {
    it("renders the previous plan with risks, assumptions, and open questions", async () => {
      const { agent, getPrompt } = buildPlannerAgent();

      await agent.run(makeTaskBundle(), "run-1", {
        previousPlan: {
          planVersion: 3,
          summary: "Old summary",
          requirementsTraceability: "",
          assumptions: ["Users are already authenticated"],
          openQuestions: [
            { id: "q1", question: "Which provider?", requiredForExecution: true },
          ],
          risks: ["Rate limiting may be hit"],
          steps: [{ id: "s1", title: "Step one", description: "Do the thing" }],
          testPlan: "Run the suite",
          confidence: 0.75,
        },
      });

      const prompt = getPrompt();
      expect(prompt).toContain("## Previously Rejected Plan (v3)");
      expect(prompt).toContain("**Confidence:** 75%");
      expect(prompt).toContain("1. **Step one** (s1): Do the thing");
      expect(prompt).toContain("**Risks:**\n- Rate limiting may be hit");
      expect(prompt).toContain("**Assumptions:**\n- Users are already authenticated");
      expect(prompt).toContain("- [q1] Which provider? *(blocks execution)*");
      expect(prompt).toContain("**Test Plan:** Run the suite");
      expect(prompt).toContain("Use this as the starting point for the new plan");
    });

    it("omits risks, assumptions, and open-questions sub-sections when all are empty", async () => {
      const { agent, getPrompt } = buildPlannerAgent();

      await agent.run(makeTaskBundle(), "run-1", {
        previousPlan: {
          planVersion: 1,
          summary: "Minimal plan",
          requirementsTraceability: "",
          assumptions: [],
          openQuestions: [],
          risks: [],
          steps: [{ id: "s1", title: "Step one", description: "Do the thing" }],
          testPlan: "Run the suite",
          confidence: 1,
        },
      });

      const prompt = getPrompt();
      expect(prompt).toContain("## Previously Rejected Plan (v1)");
      expect(prompt).not.toContain("**Risks:**");
      expect(prompt).not.toContain("**Assumptions:**");
      expect(prompt).not.toContain("**Open Questions:**");
    });

    it("omits the (blocks execution) marker for questions that don't require it", async () => {
      const { agent, getPrompt } = buildPlannerAgent();

      await agent.run(makeTaskBundle(), "run-1", {
        previousPlan: {
          planVersion: 1,
          summary: "Plan",
          requirementsTraceability: "",
          assumptions: [],
          openQuestions: [{ id: "q1", question: "Optional nuance?", requiredForExecution: false }],
          risks: [],
          steps: [{ id: "s1", title: "Step one", description: "Do the thing" }],
          testPlan: "Run the suite",
          confidence: 0.5,
        },
      });

      const prompt = getPrompt();
      expect(prompt).toContain("- [q1] Optional nuance?");
      expect(prompt).not.toContain("Optional nuance? *(blocks execution)*");
    });

    it("omits the previous-plan section entirely when absent", async () => {
      const { agent, getPrompt } = buildPlannerAgent();
      await agent.run(makeTaskBundle(), "run-1");

      const prompt = getPrompt();
      expect(prompt).not.toContain("Previously Rejected Plan");
      expect(prompt).not.toContain("{{previousPlanSection}}");
    });
  });

  describe("priorSkills injection", () => {
    it("renders a named skill with its description and markdown body", async () => {
      const { agent, getPrompt } = buildPlannerAgent();

      await agent.run(makeTaskBundle(), "run-1", {
        priorSkills: [
          {
            id: "skill-1",
            repoSlug: "acme/backend",
            name: "OAuth setup",
            description: "How we wire up OAuth in this repo.",
            taskCategory: "auth",
            skillMarkdown: "1. Install the package\n2. Configure the client",
            utilityScore: 5,
            lastUsedAt: "2024-01-01T00:00:00Z",
          },
        ],
      });

      const prompt = getPrompt();
      expect(prompt).toContain("## Prior Skills from Similar Tasks");
      expect(prompt).toContain("### OAuth setup (auth)");
      expect(prompt).toContain("How we wire up OAuth in this repo.");
      expect(prompt).toContain("1. Install the package");
    });

    it("falls back to the task category heading when the skill has no name, and omits the intro when no description", async () => {
      const { agent, getPrompt } = buildPlannerAgent();

      await agent.run(makeTaskBundle(), "run-1", {
        priorSkills: [
          {
            id: "skill-2",
            repoSlug: "acme/backend",
            name: null,
            description: null,
            taskCategory: "db-migration",
            skillMarkdown: "Use the migration CLI.",
            utilityScore: 2,
            lastUsedAt: "2024-01-01T00:00:00Z",
          },
        ],
      });

      const prompt = getPrompt();
      expect(prompt).toContain("### db-migration\n");
      expect(prompt).toContain("Use the migration CLI.");
    });

    it("omits the prior-skills section when the list is empty or absent", async () => {
      const { agent, getPrompt } = buildPlannerAgent();
      await agent.run(makeTaskBundle(), "run-1", { priorSkills: [] });

      const prompt = getPrompt();
      expect(prompt).not.toContain("## Prior Skills from Similar Tasks");
      expect(prompt).not.toContain("{{priorSkillsSection}}");
    });
  });

  describe("planVersionOverride", () => {
    it("overrides the model-returned planVersion on both the returned plan and the persisted artifact version", async () => {
      const { agent, artifactRepo } = buildPlannerAgent();

      const plan = await agent.run(makeTaskBundle(), "run-1", { planVersionOverride: 9 });

      expect(plan.planVersion).toBe(9);
      const calls = artifactRepo.create.mock.calls.map((c: unknown[]) => c[0]);
      const planArtifact = calls.find(
        (a: unknown) => (a as { type?: string }).type === "Plan",
      ) as { version: number; payloadJson: { planVersion: number } };
      expect(planArtifact.version).toBe(9);
      expect(planArtifact.payloadJson.planVersion).toBe(9);
    });

    it("keeps the model-returned planVersion when no override is given", async () => {
      const { agent } = buildPlannerAgent();

      const plan = await agent.run(makeTaskBundle(), "run-1");

      expect(plan.planVersion).toBe(2);
    });
  });

  describe("transcript persistence and completion logging", () => {
    it("persists a PlannerTranscript artifact with the raw model output", async () => {
      const { agent, artifactRepo } = buildPlannerAgent();

      await agent.run(makeTaskBundle(), "run-1");

      const calls = artifactRepo.create.mock.calls.map((c: unknown[]) => c[0]);
      const transcript = calls.find(
        (a: unknown) => (a as { type?: string }).type === "PlannerTranscript",
      ) as { version: number; rawText: string };
      expect(transcript).toBeDefined();
      expect(transcript.version).toBe(1);
      expect(transcript.rawText).toBe("raw text");
    });

    it("logs the resulting plan version, confidence, and step count", async () => {
      const { agent, agentRunner, artifactRepo, logger } = buildPlannerAgentWithLogger();
      void agentRunner;
      void artifactRepo;

      await agent.run(makeTaskBundle(), "run-1");

      const completionLog = logger.info.mock.calls.find((c: unknown[]) => c[1] === "Plan created");
      expect(completionLog).toBeDefined();
      const payload = completionLog?.[0] as Record<string, unknown> | undefined;
      expect(payload?.planVersion).toBe(2);
      expect(payload?.confidence).toBe(0.9);
      expect(payload?.steps).toBe(1);
    });
  });
});

function buildPlannerAgentWithLogger() {
  const agentRunner = {
    run: vi.fn().mockResolvedValue({
      raw: "raw text",
      parsed: {
        payload: {
          planVersion: 2,
          summary: "Test plan",
          assumptions: [],
          openQuestions: [],
          risks: [],
          steps: [{ id: "s1", title: "Step 1", description: "Do something" }],
          testPlan: "Run tests",
          confidence: 0.9,
        },
      },
    }),
  };
  const artifactRepo = {
    create: vi.fn().mockResolvedValue({ id: "artifact-new" }),
    findByRunId: vi.fn(),
    findLatestByType: vi.fn(),
  };
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  const agent = new PlannerAgent(agentRunner as never, artifactRepo as never, logger as never);
  return { agent, agentRunner, artifactRepo, logger };
}
