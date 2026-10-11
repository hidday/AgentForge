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

function makePreviousPlan(overrides: Partial<Plan> = {}): Plan {
  return {
    planVersion: 1,
    summary: "Previous summary",
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

describe("PlannerAgent.run() additional branches", () => {
  describe("planReviewFindings injection", () => {
    it("renders the AI Plan Review Findings section when planReviewFindings is provided", async () => {
      const { agent, getPrompt } = buildPlannerAgent();

      await agent.run(makeTaskBundle(), "run-1", {
        planReviewFindings: {
          summary: "Mostly solid but missing error handling.",
          findings: [
            {
              id: "f1",
              severity: "important",
              title: "No error handling",
              details: "Step 2 does not handle network failures.",
            },
          ],
        },
      });

      const prompt = getPrompt();
      expect(prompt).toContain("## AI Plan Review Findings (from previous plan)");
      expect(prompt).toContain("Mostly solid but missing error handling.");
      expect(prompt).toContain("- **[important] No error handling** (f1): Step 2 does not handle network failures.");
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

  describe("previousPlanSection injection", () => {
    it("renders the previous plan section with risks, assumptions, and open questions", async () => {
      const { agent, getPrompt } = buildPlannerAgent();
      const previousPlan = makePreviousPlan({
        risks: ["Data loss during migration"],
        assumptions: ["Postgres is already provisioned"],
        openQuestions: [
          { id: "q1", question: "Which auth provider?", requiredForExecution: true },
        ],
      });

      await agent.run(makeTaskBundle(), "run-1", { previousPlan });

      const prompt = getPrompt();
      expect(prompt).toContain("## Previously Rejected Plan (v1)");
      expect(prompt).toContain("**Summary:** Previous summary");
      expect(prompt).toContain("**Confidence:** 60%");
      expect(prompt).toContain("1. **Old step** (s1): Old description");
      expect(prompt).toContain("**Risks:**\n- Data loss during migration");
      expect(prompt).toContain("**Assumptions:**\n- Postgres is already provisioned");
      expect(prompt).toContain(
        "**Open Questions:**\n- [q1] Which auth provider? *(blocks execution)*",
      );
      expect(prompt).toContain("**Test Plan:** Old test plan");
      expect(prompt).toContain("Use this as the starting point for the new plan.");
    });

    it("renders the previous plan section without risks/assumptions/open-questions blocks when they are empty", async () => {
      const { agent, getPrompt } = buildPlannerAgent();
      const previousPlan = makePreviousPlan();

      await agent.run(makeTaskBundle(), "run-1", { previousPlan });

      const prompt = getPrompt();
      expect(prompt).toContain("## Previously Rejected Plan (v1)");
      expect(prompt).not.toContain("**Risks:**");
      expect(prompt).not.toContain("**Assumptions:**");
      expect(prompt).not.toContain("**Open Questions:**");
    });

    it("renders an open question without the blocks-execution marker when not required", async () => {
      const { agent, getPrompt } = buildPlannerAgent();
      const previousPlan = makePreviousPlan({
        openQuestions: [
          { id: "q2", question: "Optional nice-to-have?", requiredForExecution: false },
        ],
      });

      await agent.run(makeTaskBundle(), "run-1", { previousPlan });

      const prompt = getPrompt();
      expect(prompt).toContain("- [q2] Optional nice-to-have?");
      expect(prompt).not.toContain("Optional nice-to-have? *(blocks execution)*");
    });

    it("omits the previousPlanSection entirely when previousPlan is absent", async () => {
      const { agent, getPrompt } = buildPlannerAgent();

      await agent.run(makeTaskBundle(), "run-1");

      const prompt = getPrompt();
      expect(prompt).not.toContain("## Previously Rejected Plan");
      expect(prompt).not.toContain("{{previousPlanSection}}");
    });
  });

  describe("priorSkillsSection injection", () => {
    function makeSkill(overrides: Partial<SkillDocument> = {}): SkillDocument {
      return {
        id: "skill-1",
        repoSlug: "org/repo",
        name: "OAuth Integration",
        description: "How to wire up OAuth2 in this repo.",
        taskCategory: "auth",
        skillMarkdown: "## Steps\n1. Register client\n2. Exchange token",
        utilityScore: 0.9,
        lastUsedAt: new Date("2026-01-01"),
        ...overrides,
      };
    }

    it("renders a skill heading using name + taskCategory and includes the description", async () => {
      const { agent, getPrompt } = buildPlannerAgent();

      await agent.run(makeTaskBundle(), "run-1", {
        priorSkills: [makeSkill()],
      });

      const prompt = getPrompt();
      expect(prompt).toContain("## Prior Skills from Similar Tasks");
      expect(prompt).toContain("### OAuth Integration (auth)");
      expect(prompt).toContain("How to wire up OAuth2 in this repo.");
      expect(prompt).toContain("## Steps\n1. Register client\n2. Exchange token");
    });

    it("falls back to taskCategory alone as the heading when name is null", async () => {
      const { agent, getPrompt } = buildPlannerAgent();

      await agent.run(makeTaskBundle(), "run-1", {
        priorSkills: [makeSkill({ name: null, taskCategory: "deployment" })],
      });

      const prompt = getPrompt();
      expect(prompt).toContain("### deployment\n");
    });

    it("omits the intro line when description is null", async () => {
      const { agent, getPrompt } = buildPlannerAgent();

      await agent.run(makeTaskBundle(), "run-1", {
        priorSkills: [makeSkill({ description: null, skillMarkdown: "## Only markdown" })],
      });

      const prompt = getPrompt();
      const headingIdx = prompt.indexOf("### OAuth Integration (auth)");
      const nextChunk = prompt.slice(headingIdx, headingIdx + 100);
      expect(nextChunk).toContain("### OAuth Integration (auth)\n\n## Only markdown");
    });

    it("joins multiple skills with a blank line separator", async () => {
      const { agent, getPrompt } = buildPlannerAgent();

      await agent.run(makeTaskBundle(), "run-1", {
        priorSkills: [
          makeSkill({ id: "s1", name: "Skill One", taskCategory: "cat1" }),
          makeSkill({ id: "s2", name: "Skill Two", taskCategory: "cat2" }),
        ],
      });

      const prompt = getPrompt();
      expect(prompt).toContain("### Skill One (cat1)");
      expect(prompt).toContain("### Skill Two (cat2)");
    });

    it("omits the priorSkillsSection when priorSkills is absent or empty", async () => {
      const { agent, getPrompt } = buildPlannerAgent();

      await agent.run(makeTaskBundle(), "run-1", { priorSkills: [] });

      const prompt = getPrompt();
      expect(prompt).not.toContain("## Prior Skills from Similar Tasks");
      expect(prompt).not.toContain("{{priorSkillsSection}}");
    });
  });
});
