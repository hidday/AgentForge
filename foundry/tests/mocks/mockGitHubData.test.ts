import { describe, it, expect, vi } from "vitest";
import { MOCK_DIFF, MOCK_REPO_CONFIG } from "../../src/mocks/mockGitHubData.js";
import { ReviewerAgent } from "../../src/agents/reviewerAgent.js";
import type { TaskBundle } from "../../src/schemas/taskBundle.js";
import type { Plan } from "../../src/schemas/plan.js";
import type { ExecutionReport } from "../../src/schemas/executionReport.js";

// mockGitHubData.ts (MOCK_DIFF, MOCK_REPO_CONFIG) was never imported by any
// test. It is a realistic unified-diff + repo-config fixture meant to stand
// in for a real GitHub PR diff, so we exercise it the way the orchestrator
// actually uses a PR diff: as the `diff` input to ReviewerAgent.run(), with
// MOCK_REPO_CONFIG driving the taskBundle's repo section.

describe("mockGitHubData fixtures", () => {
  it("MOCK_REPO_CONFIG has the shape of a real repo config entry", () => {
    expect(MOCK_REPO_CONFIG.name).toBe("acme/backend-api");
    expect(MOCK_REPO_CONFIG.defaultBranch).toBe("main");
    expect(MOCK_REPO_CONFIG.allowedPaths).toContain("src/");
    expect(MOCK_REPO_CONFIG.protectedPaths).toContain("infrastructure/");
  });

  it("MOCK_DIFF is a realistic unified diff touching exactly two files", () => {
    const fileHeaders = MOCK_DIFF.match(/^diff --git /gm) ?? [];
    expect(fileHeaders).toHaveLength(2);
    expect(MOCK_DIFF).toContain("src/middleware/validation.ts");
    expect(MOCK_DIFF).toContain("src/routes/users.ts");
    expect(MOCK_DIFF).toContain("validateBody");
  });

  it("feeds MOCK_DIFF and MOCK_REPO_CONFIG into ReviewerAgent.run() as a real PR diff + repo context", async () => {
    let capturedUserPrompt = "";
    const agentRunner = {
      run: vi.fn().mockImplementation(
        async (_runtime: unknown, opts: { prompt: string; systemPrompt: string }) => {
          capturedUserPrompt = opts.prompt;
          return {
            raw: "raw reviewer transcript",
            parsed: {
              payload: {
                reviewId: "rev-1",
                summary: "Validation middleware looks solid.",
                findings: [],
                overallVerdict: "approved" as const,
              },
            },
          };
        },
      ),
    };
    const artifactRepo = { create: vi.fn().mockResolvedValue({ id: "artifact-new" }) };
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };

    const agent = new ReviewerAgent(agentRunner as never, artifactRepo as never, logger as never);

    const taskBundle: TaskBundle = {
      issue: {
        id: "LIN-1",
        title: "Add request validation middleware",
        description: "Validate request bodies with zod.",
        labels: [],
        priority: 0,
      },
      repo: {
        name: MOCK_REPO_CONFIG.name,
        defaultBranch: MOCK_REPO_CONFIG.defaultBranch,
        workingBranch: "ai/lin-1",
        repoPath: MOCK_REPO_CONFIG.repoPath,
        allowedPaths: MOCK_REPO_CONFIG.allowedPaths,
        protectedPaths: MOCK_REPO_CONFIG.protectedPaths,
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

    const plan: Plan = {
      planVersion: 1,
      summary: "Add zod-based validation middleware",
      requirementsTraceability: "",
      assumptions: [],
      openQuestions: [],
      risks: [],
      steps: [{ id: "s1", title: "Add middleware", description: "validateBody/validateQuery" }],
      testPlan: "Run unit tests",
      confidence: 0.9,
    };

    const executionReport: ExecutionReport = {
      executionVersion: 1,
      summary: "Implemented validation middleware",
      filesChanged: ["src/middleware/validation.ts", "src/routes/users.ts"],
      checks: {
        lint: { status: "pass", details: "ok" },
        typecheck: { status: "pass", details: "ok" },
        tests: { status: "pass", details: "ok" },
      },
      notes: [],
      prDraftCreated: true,
      score: 0.9,
      scoreRationale: "Clean implementation",
    };

    const review = await agent.run(plan, executionReport, MOCK_DIFF, taskBundle, "run-1");

    expect(review.overallVerdict).toBe("approved");
    // The diff fixture should have been rendered verbatim into the reviewer's
    // user prompt (the PR Diff section), and the repo config fixture should
    // have driven the taskBundle passed through to the agent runner.
    expect(capturedUserPrompt).toContain("validateBody");
    expect(capturedUserPrompt).toContain("### PR Diff");
    const [, opts] = agentRunner.run.mock.calls[0] as [unknown, { workingDirectory: string }];
    expect(opts.workingDirectory).toBe(MOCK_REPO_CONFIG.repoPath);
  });
});
