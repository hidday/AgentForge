import { describe, it, expect, vi } from "vitest";
import { PlanReviewerAgent } from "../../src/agents/planReviewerAgent.js";
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
    openQuestions: [],
    risks: [],
    steps: [{ id: "s1", title: "Step 1", description: "Do something" }],
    testPlan: "Run tests",
    confidence: 0.9,
  };
}

function buildPlanReviewerAgent() {
  let capturedPrompt = "";

  const agentRunner = {
    run: vi.fn().mockImplementation(
      async (
        _runtime: unknown,
        opts: { prompt: string },
      ) => {
        capturedPrompt = opts.prompt;
        return {
          raw: "raw text",
          parsed: {
            payload: {
              reviewId: "plan-rev-001",
              summary: "Looks ok",
              findings: [],
              overallVerdict: "approved" as const,
            },
          },
        };
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

  const agent = new PlanReviewerAgent(
    agentRunner as never,
    artifactRepo as never,
    logger as never,
  );

  return { agent, getPrompt: () => capturedPrompt };
}

describe("PlanReviewerAgent.run() relatedContext rendering", () => {
  it("renders the Related Linear Context section when bundle has relatedContext", async () => {
    const { agent, getPrompt } = buildPlanReviewerAgent();
    const bundle: TaskBundle = {
      ...makeTaskBundle(),
      relatedContext: {
        parent: {
          id: "p1",
          identifier: "PRY-100",
          title: "Umbrella feature X",
          description: "Roll-up effort.",
          state: "In Progress",
          labels: ["epic"],
          priority: 2,
        },
        blockers: [
          {
            id: "b1",
            identifier: "PRY-101",
            title: "Migration prerequisite",
            description: "Must complete migration first.",
            state: "Todo",
            labels: ["infra"],
            priority: 1,
          },
        ],
      },
    };

    await agent.run(makePlan(), bundle, "run-1");

    const prompt = getPrompt();
    expect(prompt).toContain("===== BEGIN BACKGROUND CONTEXT");
    expect(prompt).toContain("===== END BACKGROUND CONTEXT");
    expect(prompt).toContain("## Background: Related Linear Context (NOT the focus issue)");
    expect(prompt).toContain("STRICTLY ADDITIONAL BACKGROUND");
    expect(prompt).toContain("### Background: Parent Issue");
    expect(prompt).toContain("PRY-100");
    expect(prompt).toContain(
      "### Background: Blocker Issues (must be understood before the focus issue can ship)",
    );
    expect(prompt).toContain("#### Background: Blocker 1");
    expect(prompt).toContain("PRY-101");
  });

  it("omits the Related Linear Context section when bundle has no relatedContext", async () => {
    const { agent, getPrompt } = buildPlanReviewerAgent();
    const bundle = makeTaskBundle();

    await agent.run(makePlan(), bundle, "run-1");

    const prompt = getPrompt();
    expect(prompt).not.toContain("BEGIN BACKGROUND CONTEXT");
    expect(prompt).not.toContain("Background: Related Linear Context");
    expect(prompt).not.toContain("{{relatedContextSection}}");
  });
});
