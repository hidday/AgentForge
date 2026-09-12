import { describe, it, expect, vi } from "vitest";
import { AnswerResearcherAgent } from "../../src/agents/answerResearcherAgent.js";
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

function makePlan(): Plan {
  return {
    planVersion: 1,
    summary: "Test plan",
    requirementsTraceability: "",
    assumptions: [],
    openQuestions: [{ id: "q1", question: "Q?", requiredForExecution: false }],
    risks: [],
    steps: [{ id: "s1", title: "Step 1", description: "Do something" }],
    testPlan: "Run tests",
    confidence: 0.85,
  };
}

function buildAgent() {
  let capturedPrompt = "";

  const agentRunner = {
    run: vi.fn().mockImplementation(async (_runtime: unknown, opts: { prompt: string }) => {
      capturedPrompt = opts.prompt;
      return {
        raw: "raw transcript",
        parsed: {
          payload: {
            summary: "Resolved.",
            answers: [
              {
                questionId: "q1",
                question: "Q?",
                answer: "A.",
                confidence: "high" as const,
              },
            ],
            completedAt: "2026-05-17T12:00:00Z",
          },
        },
      };
    }),
  };

  const artifactRepo = { create: vi.fn().mockResolvedValue({ id: "artifact-new" }) };
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };

  const agent = new AnswerResearcherAgent(
    agentRunner as never,
    artifactRepo as never,
    logger as never,
  );
  return { agent, getPrompt: () => capturedPrompt };
}

describe("AnswerResearcherAgent.run() humanAnswers empty-array branch", () => {
  it("omits the Prior Human Answers section when humanAnswers is an empty array (not just undefined)", async () => {
    const { agent, getPrompt } = buildAgent();

    await agent.run(makePlan(), makeTaskBundle(), "run-1", { humanAnswers: [] });

    const prompt = getPrompt();
    expect(prompt).not.toContain("## Prior Human Answers");
    expect(prompt).not.toContain("{{humanAnswersSection}}");
  });
});
