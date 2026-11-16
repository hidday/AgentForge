import { describe, it, expect, vi } from "vitest";
import { PlanReviserAgent } from "../../src/agents/planReviserAgent.js";
import type { TaskBundle } from "../../src/schemas/taskBundle.js";
import type { Plan } from "../../src/schemas/plan.js";
import type { PlanReview } from "../../src/schemas/planReview.js";

// This file covers the one remaining gap in tests/agents/planReviserAgent.test.ts:
// the operatorNote branch (the rendered "## Operator Note" section and the
// hasOperatorNote log flag).

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

function makePlanReview(): PlanReview {
  return {
    reviewId: "plan-rev-001",
    summary: "Looks fine",
    findings: [],
    overallVerdict: "approved",
  };
}

function buildPlanReviserAgent() {
  let capturedPrompt = "";

  const agentRunner = {
    run: vi.fn().mockImplementation(async (_runtime: unknown, opts: { prompt: string }) => {
      capturedPrompt = opts.prompt;
      return {
        raw: "raw text",
        parsed: {
          payload: {
            revision: {
              originalPlanVersion: 1,
              revisedPlanVersion: 2,
              reviewId: "plan-rev-001",
              dispositions: [
                { findingId: "f1", status: "accepted" },
                { findingId: "f2", status: "dismissed" },
                { findingId: "f3", status: "partially_incorporated" },
              ],
            },
            revisedPlan: {
              ...makePlan(),
              planVersion: 2,
            },
          },
        },
      };
    }),
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

  const agent = new PlanReviserAgent(agentRunner as never, artifactRepo as never, logger as never);

  return { agent, logger, getPrompt: () => capturedPrompt };
}

describe("PlanReviserAgent.run() gap coverage", () => {
  it("renders the Operator Note section, logs hasOperatorNote=true, and tallies disposition counts", async () => {
    const { agent, logger, getPrompt } = buildPlanReviserAgent();
    const bundle = makeTaskBundle();

    const result = await agent.run(makePlan(), makePlanReview(), bundle, "run-1", {
      operatorNote: "Please keep backward compatibility.",
    });

    const prompt = getPrompt();
    expect(prompt).toContain("## Operator Note");
    expect(prompt).toContain(
      "Apply it alongside the existing reviewer findings: do not drop the findings in favor of the note",
    );
    expect(prompt).toContain("Please keep backward compatibility.");

    const startLog = logger.info.mock.calls.find(
      (c: unknown[]) => c[1] === "Starting plan reviser agent (Claude CLI, boss mode)",
    );
    expect((startLog?.[0] as Record<string, unknown>).hasOperatorNote).toBe(true);

    const completionLog = logger.info.mock.calls.find(
      (c: unknown[]) => c[1] === "Plan revision completed",
    );
    const payload = completionLog?.[0] as Record<string, unknown>;
    expect(payload.accepted).toBe(1);
    expect(payload.dismissed).toBe(1);
    expect(payload.partial).toBe(1);
    expect(result.revision.dispositions).toHaveLength(3);
  });

  it("omits the Operator Note section and logs hasOperatorNote=false when no options are given", async () => {
    const { agent, logger, getPrompt } = buildPlanReviserAgent();
    const bundle = makeTaskBundle();

    await agent.run(makePlan(), makePlanReview(), bundle, "run-1");

    const prompt = getPrompt();
    expect(prompt).not.toContain("## Operator Note");

    const startLog = logger.info.mock.calls.find(
      (c: unknown[]) => c[1] === "Starting plan reviser agent (Claude CLI, boss mode)",
    );
    expect((startLog?.[0] as Record<string, unknown>).hasOperatorNote).toBe(false);
  });
});
