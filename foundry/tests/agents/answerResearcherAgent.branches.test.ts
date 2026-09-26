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

function buildAgent() {
  let capturedUserPrompt = "";

  const agentRunner = {
    run: vi.fn().mockImplementation(async (_runtime: unknown, opts: { prompt: string }) => {
      capturedUserPrompt = opts.prompt;
      return {
        raw: "raw",
        parsed: {
          payload: {
            summary: "done",
            answers: [],
            completedAt: "2026-05-17T12:00:00Z",
          },
        },
      };
    }),
  };

  const artifactRepo = { create: vi.fn().mockResolvedValue({ id: "artifact-new" }) };
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };

  const agent = new AnswerResearcherAgent(agentRunner as never, artifactRepo as never, logger as never);

  return { agent, getUserPrompt: () => capturedUserPrompt };
}

describe("AnswerResearcherAgent.run() open questions section", () => {
  it("omits the '## Open Questions to Research' heading entirely when there are no open questions", async () => {
    const { agent, getUserPrompt } = buildAgent();
    const plan: Plan = {
      planVersion: 1,
      summary: "Test plan",
      requirementsTraceability: "",
      assumptions: [],
      openQuestions: [],
      risks: [],
      steps: [{ id: "s1", title: "Step 1", description: "Do something" }],
      testPlan: "Run tests",
      confidence: 0.9,
    };

    await agent.run(plan, makeTaskBundle(), "run-1");

    const prompt = getUserPrompt();
    expect(prompt).not.toContain("## Open Questions to Research");
  });
});

describe("AnswerResearcherAgent.run() open question requiredForExecution rendering", () => {
  it("omits the *(blocks execution)* suffix for an open question that isn't required for execution", async () => {
    const { agent, getUserPrompt } = buildAgent();
    const plan: Plan = {
      planVersion: 1,
      summary: "Test plan",
      requirementsTraceability: "",
      assumptions: [],
      openQuestions: [{ id: "q1", question: "Optional naming?", requiredForExecution: false }],
      risks: [],
      steps: [{ id: "s1", title: "Step 1", description: "Do something" }],
      testPlan: "Run tests",
      confidence: 0.9,
    };

    await agent.run(plan, makeTaskBundle(), "run-1");

    const prompt = getUserPrompt();
    expect(prompt).toContain("**[q1]** Optional naming?");
    expect(prompt).not.toContain("*(blocks execution)*");
  });
});
