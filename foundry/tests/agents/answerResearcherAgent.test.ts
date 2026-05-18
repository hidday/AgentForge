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
    requirementsTraceability: "Traceability",
    assumptions: [],
    openQuestions: [
      { id: "q1", question: "Should we use Postgres?", requiredForExecution: true },
      { id: "q2", question: "Optional naming convention?", requiredForExecution: false },
    ],
    risks: [],
    steps: [{ id: "s1", title: "Step 1", description: "Do something" }],
    testPlan: "Run tests",
    confidence: 0.85,
  };
}

function makeResearcherOutput() {
  return {
    raw: "raw researcher transcript",
    parsed: {
      payload: {
        summary: "Resolved both questions using existing conventions.",
        answers: [
          {
            questionId: "q1",
            question: "Should we use Postgres?",
            answer: "Yes, Postgres — the codebase already uses Prisma+Postgres.",
            confidence: "high" as const,
            sources: ["foundry/prisma/schema.prisma"],
          },
          {
            questionId: "q2",
            question: "Optional naming convention?",
            answer: "Use camelCase for fields; matches existing schema conventions.",
            confidence: "medium" as const,
            sources: ["src/domain/types.ts"],
          },
        ],
        completedAt: "2026-05-17T12:00:00Z",
      },
    },
  };
}

function buildAgent(outputOverride?: ReturnType<typeof makeResearcherOutput>) {
  let capturedSystemPrompt = "";
  let capturedUserPrompt = "";

  const agentRunner = {
    run: vi.fn().mockImplementation(
      async (
        _runtime: unknown,
        opts: { prompt: string; systemPrompt: string },
        _name: unknown,
        _schema: unknown,
      ) => {
        capturedUserPrompt = opts.prompt;
        capturedSystemPrompt = opts.systemPrompt;
        return outputOverride ?? makeResearcherOutput();
      },
    ),
  };

  const artifactRepo = {
    create: vi.fn().mockResolvedValue({ id: "artifact-new" }),
  };

  const logger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };

  const agent = new AnswerResearcherAgent(
    agentRunner as never,
    artifactRepo as never,
    logger as never,
  );

  return {
    agent,
    agentRunner,
    artifactRepo,
    getSystemPrompt: () => capturedSystemPrompt,
    getUserPrompt: () => capturedUserPrompt,
  };
}

describe("AnswerResearcherAgent.run()", () => {
  it("persists ResearcherTranscript and ResearchedAnswers artifacts", async () => {
    const { agent, artifactRepo } = buildAgent();

    await agent.run(makePlan(), makeTaskBundle(), "run-1");

    expect(artifactRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: "run-1",
        type: "ResearcherTranscript",
        rawText: "raw researcher transcript",
      }),
    );
    expect(artifactRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: "run-1",
        type: "ResearchedAnswers",
        version: 1,
        payloadJson: expect.objectContaining({
          summary: expect.any(String),
          answers: expect.arrayContaining([
            expect.objectContaining({ questionId: "q1", confidence: "high" }),
            expect.objectContaining({ questionId: "q2", confidence: "medium" }),
          ]),
        }),
      }),
    );
  });

  it("versions the ResearchedAnswers artifact with the source plan's planVersion", async () => {
    const { agent, artifactRepo } = buildAgent();

    const plan = makePlan();
    plan.planVersion = 3;
    await agent.run(plan, makeTaskBundle(), "run-1");

    const calls = artifactRepo.create.mock.calls.map((c: unknown[]) => c[0]);
    const researchedArtifact = calls.find(
      (a: unknown) => (a as { type?: string }).type === "ResearchedAnswers",
    ) as { version: number };
    expect(researchedArtifact.version).toBe(3);
  });

  it("renders the open questions verbatim with their question IDs into the user prompt", async () => {
    const { agent, getUserPrompt } = buildAgent();

    await agent.run(makePlan(), makeTaskBundle(), "run-1");

    const prompt = getUserPrompt();
    expect(prompt).toContain("## Open Questions to Research");
    expect(prompt).toContain("[q1]");
    expect(prompt).toContain("Should we use Postgres?");
    expect(prompt).toContain("[q2]");
    expect(prompt).toContain("Optional naming convention?");
    expect(prompt).toContain("*(blocks execution)*");
  });

  it("renders the Prior Human Answers section when humanAnswers are provided", async () => {
    const { agent, getUserPrompt } = buildAgent();

    await agent.run(makePlan(), makeTaskBundle(), "run-1", {
      humanAnswers: [{ questionId: "qA", answer: "Use Stripe" }],
    });

    const prompt = getUserPrompt();
    expect(prompt).toContain("## Prior Human Answers");
    expect(prompt).toContain("[qA]");
    expect(prompt).toContain("Use Stripe");
  });

  it("omits the Prior Human Answers section when no humanAnswers are provided", async () => {
    const { agent, getUserPrompt } = buildAgent();

    await agent.run(makePlan(), makeTaskBundle(), "run-1");

    const prompt = getUserPrompt();
    expect(prompt).not.toContain("## Prior Human Answers");
  });

  it("renders the task bundle (issue title/description, repo info) into the user prompt", async () => {
    const { agent, getUserPrompt } = buildAgent();

    await agent.run(makePlan(), makeTaskBundle(), "run-1");

    const prompt = getUserPrompt();
    expect(prompt).toContain("LIN-1");
    expect(prompt).toContain("Test issue");
    expect(prompt).toContain("test-repo");
  });

  it("renders the Related Linear Context fence when the bundle includes related context", async () => {
    const { agent, getUserPrompt } = buildAgent();
    const bundle: TaskBundle = {
      ...makeTaskBundle(),
      relatedContext: {
        blockers: [
          {
            id: "b1",
            identifier: "PRY-101",
            title: "Migration prereq",
            description: "Schema migration prerequisite.",
            state: "Todo",
            labels: [],
            priority: 1,
          },
        ],
      },
    };

    await agent.run(makePlan(), bundle, "run-1");

    const prompt = getUserPrompt();
    expect(prompt).toContain("===== BEGIN BACKGROUND CONTEXT");
    expect(prompt).toContain("PRY-101");
  });

  it("returns the researched answers payload from the agent runner", async () => {
    const { agent } = buildAgent();

    const result = await agent.run(makePlan(), makeTaskBundle(), "run-1");

    expect(result.answers).toHaveLength(2);
    expect(result.answers[0]).toMatchObject({ questionId: "q1", confidence: "high" });
    expect(result.summary).toContain("Resolved");
  });

  it("handles an unresolved-confidence answer without throwing", async () => {
    const unresolvedOutput = makeResearcherOutput();
    unresolvedOutput.parsed.payload.answers[0].confidence = "unresolved";
    unresolvedOutput.parsed.payload.answers[0].answer =
      "Could not determine — recommend human review.";
    const { agent } = buildAgent(unresolvedOutput);

    const result = await agent.run(makePlan(), makeTaskBundle(), "run-1");

    expect(result.answers[0].confidence).toBe("unresolved");
  });
});
