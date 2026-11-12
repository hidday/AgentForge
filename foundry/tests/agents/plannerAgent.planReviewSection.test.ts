import { describe, it, expect, vi } from "vitest";
import { PlannerAgent } from "../../src/agents/plannerAgent.js";
import type { TaskBundle } from "../../src/schemas/taskBundle.js";

/**
 * Covers the planReviewSection template-variable builder in PlannerAgent.run()
 * (lines 82-94), which was never exercised by plannerAgent.test.ts or
 * plannerAgent.edgecases.test.ts — neither supplies `planReviewFindings`.
 */

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

describe("PlannerAgent.run() — planReviewSection injection", () => {
  it("renders the '## AI Plan Review Findings' heading, the review summary, and each finding line when planReviewFindings is provided", async () => {
    const { agent, getPrompt } = buildPlannerAgent();
    const bundle = makeTaskBundle();

    await agent.run(bundle, "run-1", {
      planReviewFindings: {
        summary: "The plan lacks error handling for malformed JSON bodies.",
        findings: [
          {
            id: "pf1",
            severity: "important",
            title: "No error handling for malformed JSON bodies",
            details: "Fastify body parsing fails before the handler runs.",
          },
          {
            id: "pf2",
            severity: "suggestion",
            title: "Consider adding OpenAPI schema generation",
            details: "Low effort, high value documentation improvement.",
          },
        ],
      },
    });

    const prompt = getPrompt();
    expect(prompt).toContain("## AI Plan Review Findings (from previous plan)");
    expect(prompt).toContain(
      "**Review Summary:** The plan lacks error handling for malformed JSON bodies.",
    );
    expect(prompt).toContain(
      "- **[important] No error handling for malformed JSON bodies** (pf1): Fastify body parsing fails before the handler runs.",
    );
    expect(prompt).toContain(
      "- **[suggestion] Consider adding OpenAPI schema generation** (pf2): Low effort, high value documentation improvement.",
    );
    expect(prompt).toContain("Incorporate these findings into the revised plan where appropriate.");
  });

  it("renders the heading and summary even when findings is an empty array (no finding bullet lines)", async () => {
    const { agent, getPrompt } = buildPlannerAgent();
    const bundle = makeTaskBundle();

    await agent.run(bundle, "run-1", {
      planReviewFindings: {
        summary: "No issues found in the previous plan review.",
        findings: [],
      },
    });

    const prompt = getPrompt();
    expect(prompt).toContain("## AI Plan Review Findings (from previous plan)");
    expect(prompt).toContain("**Review Summary:** No issues found in the previous plan review.");
    expect(prompt).not.toContain("- **[");
  });

  it("does NOT include the '## AI Plan Review Findings' section when planReviewFindings is absent", async () => {
    const { agent, getPrompt } = buildPlannerAgent();
    const bundle = makeTaskBundle();

    await agent.run(bundle, "run-1");

    const prompt = getPrompt();
    expect(prompt).not.toContain("## AI Plan Review Findings");
    expect(prompt).not.toContain("Review Summary");
  });
});
