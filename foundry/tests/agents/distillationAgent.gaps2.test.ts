import { describe, it, expect, vi, beforeEach } from "vitest";
import { DistillationAgent } from "../../src/agents/distillationAgent.js";
import type { Run } from "../../src/domain/types.js";
import { RunState } from "../../src/domain/runState.js";

// Covers the field-aware summarizer helpers (summarizePlan, bulletList, and
// the empty/overflow edges of summarizeExecution and summarizeRemediation)
// that are NOT exercised by distillationAgent.test.ts, distillationAgent
// .edgeCases.test.ts, or distillationAgent.gaps.test.ts:
//   - summarizePlan() is only invoked when a Plan artifact exists; every
//     other test leaves it null, so summarizePlan (and the bulletList calls
//     it makes for assumptions/risks) and the ">12 steps" overflow line were
//     never exercised at all.
//   - bulletList()'s "items present" branch (as opposed to the "_none_"
//     early return) is only reached with a non-empty array -- every other
//     test's `notes` array is empty.
//   - summarizeExecution()'s "_none_" branch for an empty filesChanged array.
//   - summarizeRemediation()'s "_none_" branch for an empty resolution array.

function makeRun(overrides: Partial<Run> = {}): Run {
  return {
    id: "run-1",
    linearIssueId: "LIN-1",
    linearIssueTitle: "Add auth middleware",
    linearIssueUrl: null,
    repo: "test-repo",
    branchName: null,
    prNumber: null,
    state: RunState.Done,
    planVersion: 1,
    approvedPlanVersion: 1,
    plannerRuntime: null,
    executorRuntime: null,
    reviewerRuntime: null,
    remediationRuntime: null,
    workingDirectory: "/tmp",
    latestArtifactVersion: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makeDistillationOutput(decision: { shouldPersist: boolean; reason: string }) {
  return {
    raw: "raw output",
    parsed: { stage: "distillation" as const, payload: decision },
  };
}

function buildDeps() {
  const agentRunner = { run: vi.fn() };
  const artifactRepo = { findLatestByType: vi.fn(), findByRunId: vi.fn(), create: vi.fn() };
  const agentSkillRepo = {
    findActiveByRepo: vi.fn().mockResolvedValue([]),
    countActiveByRepo: vi.fn().mockResolvedValue(0),
    create: vi.fn(),
    displaceAndCreate: vi.fn(),
    findById: vi.fn(),
    findLowestUtilityActive: vi.fn(),
    archiveById: vi.fn(),
    findTopKByRelevance: vi.fn().mockResolvedValue([]),
    incrementSuccess: vi.fn(),
    incrementFailure: vi.fn(),
    archiveIfLowUtility: vi.fn(),
  };
  const eventRepo = { create: vi.fn().mockResolvedValue({}), findByRunId: vi.fn() };
  const config = { MAX_SKILLS_PER_REPO: 5, NOVELTY_SIMILARITY_THRESHOLD: 0.5 };
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };

  return { agentRunner, artifactRepo, agentSkillRepo, eventRepo, config, logger };
}

function buildAgent(deps: ReturnType<typeof buildDeps>): DistillationAgent {
  return new DistillationAgent(
    deps.agentRunner as never,
    deps.artifactRepo as never,
    deps.agentSkillRepo as never,
    deps.eventRepo as never,
    deps.config,
    deps.logger as never,
  );
}

describe("DistillationAgent — summarizer overflow and empty-array edges", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders summarizePlan (with bulletList overflow/empty edges) and the overflow/empty edges of the execution and remediation summaries", async () => {
    const deps = buildDeps();

    const planPayload = {
      planVersion: 1,
      summary: "Add JWT auth middleware across all protected routes.",
      assumptions: Array.from({ length: 10 }, (_, i) => `Assumption number ${i}`),
      openQuestions: [],
      risks: [],
      steps: Array.from({ length: 14 }, (_, i) => ({
        id: `s${i}`,
        title: `Step ${i}`,
        description: `Do thing ${i}`,
      })),
      testPlan: "Run the full auth test suite.",
      confidence: 0.77,
    };

    const executionPayload = {
      executionVersion: 1,
      summary: "Implemented JWT auth middleware.",
      filesChanged: [],
      checks: {
        lint: { status: "pass", details: "ok" },
        typecheck: { status: "pass", details: "ok" },
        tests: { status: "pass", details: "ok" },
      },
      notes: Array.from({ length: 17 }, (_, i) => `Discovered gotcha number ${i}`),
      prDraftCreated: true,
      score: 0.82,
      scoreRationale: "Implementation matches plan and all checks pass.",
    };

    const remediationPayload = {
      reviewId: "rev-1",
      resolution: [],
      readyForHumanReview: false,
      executionReport: executionPayload,
    };

    deps.artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
      if (type === "Plan") {
        return Promise.resolve({
          id: "artifact-plan",
          runId: "run-1",
          type: "Plan" as const,
          version: 1,
          payloadJson: planPayload,
          rawText: "{}",
          createdAt: new Date(),
        });
      }
      if (type === "ExecutionReport") {
        return Promise.resolve({
          id: "artifact-exec",
          runId: "run-1",
          type: "ExecutionReport" as const,
          version: 1,
          payloadJson: executionPayload,
          rawText: "{}",
          createdAt: new Date(),
        });
      }
      if (type === "Remediation") {
        return Promise.resolve({
          id: "artifact-remediation",
          runId: "run-1",
          type: "Remediation" as const,
          version: 1,
          payloadJson: remediationPayload,
          rawText: "{}",
          createdAt: new Date(),
        });
      }
      return Promise.resolve(null);
    });

    let capturedPrompt = "";
    deps.agentRunner.run.mockImplementation(async (_runtime: unknown, opts: { prompt: string }) => {
      capturedPrompt = opts.prompt;
      return makeDistillationOutput({ shouldPersist: false, reason: "nothing new here" });
    });

    const agent = buildAgent(deps);
    await agent.run("run-1", makeRun());

    // summarizePlan() — steps overflow (14 steps, cap 12 -> "...and 2 more steps")
    expect(capturedPrompt).toContain("**Summary**: Add JWT auth middleware across all protected routes.");
    expect(capturedPrompt).toContain("**Confidence**: 0.77");
    expect(capturedPrompt).toContain("…and 2 more steps");
    // bulletList() overflow branch (10 assumptions, cap 8 -> "...and 2 more")
    expect(capturedPrompt).toContain("Assumption number 0");
    expect(capturedPrompt).toContain("**Assumptions**:");
    // bulletList() empty-array branch (risks: [])
    expect(capturedPrompt).toContain("**Risks**:\n_none_");

    // summarizeExecution() — empty filesChanged -> "_none_"
    expect(capturedPrompt).toContain("**Files Changed** (0):\n_none_");
    // bulletList() overflow branch via notes (17 notes, cap 15 -> "...and 2 more")
    expect(capturedPrompt).toContain("Discovered gotcha number 0");

    // summarizeRemediation() — empty resolution -> "_none_"
    expect(capturedPrompt).toContain("## Remediation Summary");
    expect(capturedPrompt).toContain("**Resolutions**:\n_none_");

    // Count every "...and 2 more" occurrence: steps, assumptions, and notes
    // each overflow by exactly 2, so there should be at least 3 such lines.
    const overflowCount = (capturedPrompt.match(/…and 2 more/g) ?? []).length;
    expect(overflowCount).toBeGreaterThanOrEqual(3);
  });
});
