import { describe, it, expect, vi } from "vitest";
import { AnswerResearcherAgent } from "../../src/agents/answerResearcherAgent.js";
import type { TaskBundle } from "../../src/schemas/taskBundle.js";
import type { Plan } from "../../src/schemas/plan.js";

// Covers the renderOpenQuestionsSection early-return branch (plan.openQuestions
// is empty) not exercised by answerResearcherAgent.test.ts, which always
// provides a non-empty openQuestions array.

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

function makePlan(overrides: Partial<Plan> = {}): Plan {
  return {
    planVersion: 1,
    summary: "Test plan",
    requirementsTraceability: "Traceability",
    assumptions: [],
    openQuestions: [],
    risks: [],
    steps: [{ id: "s1", title: "Step 1", description: "Do something" }],
    testPlan: "Run tests",
    confidence: 0.85,
    ...overrides,
  };
}

function buildAgent() {
  let capturedUserPrompt = "";

  const agentRunner = {
    run: vi.fn().mockImplementation(
      async (_runtime: unknown, opts: { prompt: string; systemPrompt: string }) => {
        capturedUserPrompt = opts.prompt;
        return {
          raw: "raw researcher transcript",
          parsed: {
            payload: {
              summary: "Nothing to research.",
              answers: [],
              completedAt: "2026-05-17T12:00:00Z",
            },
          },
        };
      },
    ),
  };

  const artifactRepo = { create: vi.fn().mockResolvedValue({ id: "artifact-new" }) };
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };

  const agent = new AnswerResearcherAgent(agentRunner as never, artifactRepo as never, logger as never);

  return { agent, getUserPrompt: () => capturedUserPrompt };
}

describe("AnswerResearcherAgent.run() — empty openQuestions", () => {
  it("omits the Open Questions to Research section entirely when plan.openQuestions is empty", async () => {
    const { agent, getUserPrompt } = buildAgent();

    const result = await agent.run(makePlan({ openQuestions: [] }), makeTaskBundle(), "run-1");

    const prompt = getUserPrompt();
    expect(prompt).not.toContain("## Open Questions to Research");
    expect(result.answers).toEqual([]);
  });
});
