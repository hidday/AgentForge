import { describe, it, expect, vi } from "vitest";
import { PlannerAgent } from "../../src/agents/plannerAgent.js";
import type { TaskBundle } from "../../src/schemas/taskBundle.js";
import type { Plan } from "../../src/schemas/plan.js";

// Covers the PlannerAgent.run() branches that the primary plannerAgent.test.ts
// (human feedback / researched answers / related context) does not exercise:
// planReviewFindings, previousPlan (with risks/assumptions/openQuestions), and priorSkills.

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
      async (_runtime: unknown, opts: { prompt: string }) => {
        capturedPrompt = opts.prompt;
        return makePlanOutput();
      },
    ),
  };

  const artifactRepo = {
    create: vi.fn().mockResolvedValue({ id: "artifact-new" }),
  };

  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };

  const agent = new PlannerAgent(agentRunner as never, artifactRepo as never, logger as never);

  return { agent, getPrompt: () => capturedPrompt };
}

describe("PlannerAgent.run() additional branches", () => {
  describe("planReviewFindings injection", () => {
    it("renders the AI Plan Review Findings section when planReviewFindings is provided", async () => {
      const { agent, getPrompt } = buildPlannerAgent();

      await agent.run(makeTaskBundle(), "run-1", {
        planReviewFindings: {
          summary: "Found one blocker.",
          findings: [
            { id: "f1", severity: "blocker", title: "Missing validation", details: "Needs a null check" },
          ],
        },
      });

      const prompt = getPrompt();
      expect(prompt).toContain("## AI Plan Review Findings (from previous plan)");
      expect(prompt).toContain("Found one blocker.");
      expect(prompt).toContain("[blocker] Missing validation");
      expect(prompt).toContain("Needs a null check");
      expect(prompt).toContain("Incorporate these findings into the revised plan where appropriate.");
    });

    it("omits the AI Plan Review Findings section when not provided", async () => {
      const { agent, getPrompt } = buildPlannerAgent();

      await agent.run(makeTaskBundle(), "run-1");

      const prompt = getPrompt();
      expect(prompt).not.toContain("## AI Plan Review Findings");
    });
  });

  describe("previousPlan injection", () => {
    const previousPlan: Plan = {
      planVersion: 4,
      summary: "Old plan summary",
      requirementsTraceability: "",
      assumptions: ["Assumption one"],
      openQuestions: [
        { id: "q1", question: "Blocking question?", requiredForExecution: true },
        { id: "q2", question: "Non-blocking question?", requiredForExecution: false },
      ],
      risks: ["Risk one"],
      steps: [{ id: "s1", title: "Old step", description: "Old description" }],
      testPlan: "Old test plan",
      confidence: 0.75,
    };

    it("renders the Previously Rejected Plan section with steps, risks, assumptions, and open questions", async () => {
      const { agent, getPrompt } = buildPlannerAgent();

      await agent.run(makeTaskBundle(), "run-1", { previousPlan });

      const prompt = getPrompt();
      expect(prompt).toContain("## Previously Rejected Plan (v4)");
      expect(prompt).toContain("Old plan summary");
      expect(prompt).toContain("**Confidence:** 75%");
      expect(prompt).toContain("Old step");
      expect(prompt).toContain("Old description");
      expect(prompt).toContain("**Risks:**");
      expect(prompt).toContain("Risk one");
      expect(prompt).toContain("**Assumptions:**");
      expect(prompt).toContain("Assumption one");
      expect(prompt).toContain("**Open Questions:**");
      expect(prompt).toContain("[q1] Blocking question?");
      expect(prompt).toContain("*(blocks execution)*");
      expect(prompt).toContain("[q2] Non-blocking question?");
      expect(prompt).toContain("Old test plan");
      expect(prompt).toContain(
        "Use this as the starting point for the new plan. Preserve the parts that are still valid",
      );
    });

    it("omits risks/assumptions/open questions subsections when the previous plan has none of them", async () => {
      const { agent, getPrompt } = buildPlannerAgent();
      const minimalPreviousPlan: Plan = {
        ...previousPlan,
        assumptions: [],
        risks: [],
        openQuestions: [],
      };

      await agent.run(makeTaskBundle(), "run-1", { previousPlan: minimalPreviousPlan });

      const prompt = getPrompt();
      expect(prompt).toContain("## Previously Rejected Plan (v4)");
      expect(prompt).not.toContain("**Risks:**");
      expect(prompt).not.toContain("**Assumptions:**");
      expect(prompt).not.toContain("**Open Questions:**");
    });

    it("omits the Previously Rejected Plan section when previousPlan is not provided", async () => {
      const { agent, getPrompt } = buildPlannerAgent();

      await agent.run(makeTaskBundle(), "run-1");

      const prompt = getPrompt();
      expect(prompt).not.toContain("Previously Rejected Plan");
    });
  });

  describe("priorSkills injection", () => {
    it("renders named skills with their task category, description, and markdown", async () => {
      const { agent, getPrompt } = buildPlannerAgent();

      await agent.run(makeTaskBundle(), "run-1", {
        priorSkills: [
          {
            id: "skill-1",
            repoSlug: "test-repo",
            name: "dev-env-pause-resume",
            description: "How to pause and resume dev envs.",
            taskCategory: "devops",
            skillMarkdown: "# Pause/Resume\n\nSteps to follow.",
            utilityScore: 0.9,
            lastUsedAt: new Date("2024-01-01"),
          },
        ],
      });

      const prompt = getPrompt();
      expect(prompt).toContain("## Prior Skills from Similar Tasks");
      expect(prompt).toContain("### dev-env-pause-resume (devops)");
      expect(prompt).toContain("How to pause and resume dev envs.");
      expect(prompt).toContain("# Pause/Resume");
      expect(prompt).toContain("Steps to follow.");
    });

    it("falls back to the task category heading when a skill has no name or description", async () => {
      const { agent, getPrompt } = buildPlannerAgent();

      await agent.run(makeTaskBundle(), "run-1", {
        priorSkills: [
          {
            id: "skill-2",
            repoSlug: "test-repo",
            name: null,
            description: null,
            taskCategory: "testing",
            skillMarkdown: "# Testing skill",
            utilityScore: 0.5,
            lastUsedAt: new Date("2024-01-01"),
          },
        ],
      });

      const prompt = getPrompt();
      expect(prompt).toContain("### testing");
      expect(prompt).not.toContain("### testing (testing)");
      expect(prompt).toContain("# Testing skill");
    });

    it("omits the Prior Skills section when priorSkills is empty or absent", async () => {
      const { agent, getPrompt } = buildPlannerAgent();

      await agent.run(makeTaskBundle(), "run-1", { priorSkills: [] });

      const prompt = getPrompt();
      expect(prompt).not.toContain("## Prior Skills from Similar Tasks");
    });
  });
});
