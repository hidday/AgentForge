import { describe, it, expect, vi, beforeEach } from "vitest";
import { DistillationAgent } from "../../src/agents/distillationAgent.js";
import type { Run } from "../../src/domain/types.js";
import { RunState } from "../../src/domain/runState.js";

// A further pass over DistillationAgent's remaining real branch gaps (beyond
// distillationAgent.gaps.test.ts and distillationAgent.gaps2.test.ts):
//   - summarizePlan/summarizeExecution/summarizeRemediation's schema-
//     validation-failure fallback (raw truncated JSON instead of the
//     structured markdown)
//   - truncate()'s actual-truncation branch (text longer than its cap)
//   - a plan with a non-empty, non-overflowing steps array, including a step
//     with an empty description
//   - checkLine()'s "non-pass status with details" branch
//   - summarizeRemediation()'s non-overflowing resolutions branch, including
//     a resolution item with an empty rationale
//   - the existingSkillsSummary name-fallback-to-taskCategory branch
//   - run.linearIssueTitle being null (falls back to "") and
//     linearIssueDescription actually being present
//   - the LLM-call catch block's non-Error rejection branch
//   - summarizeExecution()'s filesChanged ">40" overflow branch

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

function makeSkill(overrides: Record<string, unknown> = {}) {
  return {
    id: "skill-1",
    repoSlug: "test-repo",
    name: "db-caching",
    description: "Use when caching DB connections.",
    taskCategory: "database caching",
    skillMarkdown: "Cache DB connections in a pool.",
    successCount: 0,
    failureCount: 0,
    utilityScore: 0.5,
    lastUsedAt: new Date(),
    createdAt: new Date(),
    archivedAt: null,
    ...overrides,
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

function wireArtifacts(
  deps: ReturnType<typeof buildDeps>,
  payloads: { Plan?: unknown; ExecutionReport: unknown; Remediation?: unknown },
) {
  deps.artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
    if (type === "Plan" && payloads.Plan !== undefined) {
      return Promise.resolve({
        id: "artifact-plan",
        runId: "run-1",
        type: "Plan" as const,
        version: 1,
        payloadJson: payloads.Plan,
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
        payloadJson: payloads.ExecutionReport,
        rawText: "{}",
        createdAt: new Date(),
      });
    }
    if (type === "Remediation" && payloads.Remediation !== undefined) {
      return Promise.resolve({
        id: "artifact-remediation",
        runId: "run-1",
        type: "Remediation" as const,
        version: 1,
        payloadJson: payloads.Remediation,
        rawText: "{}",
        createdAt: new Date(),
      });
    }
    return Promise.resolve(null);
  });
}

describe("DistillationAgent — schema-validation-failure fallbacks", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("falls back to truncated raw JSON for Plan, ExecutionReport, and Remediation when they fail schema validation", async () => {
    const deps = buildDeps();
    const malformedPlan = { notAPlan: true, nested: { x: 1 } };
    const malformedExecution = { notAnExecutionReport: true };
    const malformedRemediation = { notRemediation: true };

    wireArtifacts(deps, {
      Plan: malformedPlan,
      ExecutionReport: malformedExecution,
      Remediation: malformedRemediation,
    });

    let capturedPrompt = "";
    deps.agentRunner.run.mockImplementation(async (_runtime: unknown, opts: { prompt: string }) => {
      capturedPrompt = opts.prompt;
      return { raw: "x", parsed: { stage: "distillation" as const, payload: { shouldPersist: false, reason: "n/a" } } };
    });

    const agent = buildAgent(deps);
    await agent.run("run-1", makeRun());

    // None of the structured-field headers should appear -- schema validation
    // failed for all three, so each falls back to truncated raw JSON instead.
    expect(capturedPrompt).not.toContain("**Confidence**:");
    expect(capturedPrompt).not.toContain("**Score**:");
    expect(capturedPrompt).not.toContain("**Ready for human review**:");
    expect(capturedPrompt).toContain(JSON.stringify(malformedPlan));
    expect(capturedPrompt).toContain(JSON.stringify(malformedExecution));
    expect(capturedPrompt).toContain("## Remediation Summary");
    expect(capturedPrompt).toContain(JSON.stringify(malformedRemediation));
  });
});

describe("DistillationAgent — non-overflowing lists, falsy fields, name fallback, and non-Error LLM failure", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("covers truncate()'s overflow, a non-overflowing steps list with an empty description, a non-pass check, a non-overflowing resolution list with an empty rationale, the skill-name fallback, a null issue title with a present description, and a non-Error LLM rejection", async () => {
    const deps = buildDeps();

    const longSummary = "S".repeat(700);
    const planPayload = {
      planVersion: 1,
      summary: longSummary,
      assumptions: [],
      openQuestions: [],
      risks: [],
      steps: [
        { id: "s1", title: "Step one", description: "" },
        { id: "s2", title: "Step two", description: "Do the second thing" },
      ],
      testPlan: "Run tests",
      confidence: 0.6,
    };

    const executionPayload = {
      executionVersion: 1,
      summary: "Implemented things.",
      filesChanged: ["src/a.ts"],
      checks: {
        lint: { status: "fail", details: "2 lint errors remain" },
        typecheck: { status: "pass", details: "ok" },
        tests: { status: "pass", details: "ok" },
      },
      notes: [],
      prDraftCreated: true,
      score: 0.4,
      scoreRationale: "Lint failures block merge.",
    };

    const remediationPayload = {
      reviewId: "rev-2",
      resolution: [
        { findingId: "f1", status: "accepted" as const, action: "Fixed the bug", rationale: "" },
        { findingId: "f2", status: "rejected" as const, action: "Won't fix", rationale: "Out of scope" },
      ],
      readyForHumanReview: true,
      executionReport: executionPayload,
    };

    wireArtifacts(deps, { Plan: planPayload, ExecutionReport: executionPayload, Remediation: remediationPayload });

    // A skill with name: null, dissimilar enough to avoid the novelty gate.
    deps.agentSkillRepo.findActiveByRepo.mockResolvedValue([
      makeSkill({ name: null, taskCategory: "rate limiting", skillMarkdown: "Use a token bucket for rate limiting." }),
    ]);

    let capturedPrompt = "";
    deps.agentRunner.run.mockImplementation(async (_runtime: unknown, opts: { prompt: string }) => {
      capturedPrompt = opts.prompt;
      // Non-Error rejection -- exercises the `err instanceof Error ? ... :
      // String(err)` false branch in the catch around this call.
      // eslint-disable-next-line @typescript-eslint/no-throw-literal
      throw "LLM transport exploded";
    });

    const run = makeRun({
      linearIssueTitle: null,
      linearIssueDescription: "Full description text for the issue.",
    });

    const agent = buildAgent(deps);
    await agent.run("run-1", run);

    // truncate() overflow: the 700-char summary is capped at 600 + an ellipsis.
    expect(capturedPrompt).not.toContain(longSummary);
    expect(capturedPrompt).toContain(`${"S".repeat(600)}…`);

    // Non-overflowing steps list (2 <= 12) with one empty description.
    expect(capturedPrompt).toContain("1. Step one");
    expect(capturedPrompt).not.toContain("1. Step one —");
    expect(capturedPrompt).toContain("2. Step two — Do the second thing");
    expect(capturedPrompt).not.toContain("more steps");

    // checkLine() non-pass-with-details branch.
    expect(capturedPrompt).toContain("lint: fail — 2 lint errors remain");

    // Non-overflowing resolutions (2 <= 15) with one empty rationale.
    expect(capturedPrompt).toContain("[accepted] f1: Fixed the bug");
    expect(capturedPrompt).not.toContain("Fixed the bug\n  *why*");
    expect(capturedPrompt).toContain("[rejected] f2: Won't fix\n  *why*: Out of scope");
    expect(capturedPrompt).not.toContain("more`");

    // existingSkillsSummary falls back to taskCategory when skill.name is null.
    expect(capturedPrompt).toContain("- [rate limiting] rate limiting:");

    // run.linearIssueTitle null -> "" fallback, with linearIssueDescription present.
    expect(capturedPrompt).toContain("**Task Category Hint**: ");

    // The non-Error rejection is handled gracefully: parse_error event, no throw.
    expect(deps.eventRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        payloadJson: expect.objectContaining({ shouldPersist: false, reason: "parse_error" }),
      }),
    );
    expect(deps.logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ runId: "run-1", error: "LLM transport exploded" }),
      "Distillation LLM call failed or parse error",
    );
  });

  it("overflows the filesChanged list past 40 entries", async () => {
    const deps = buildDeps();
    const manyFiles = Array.from({ length: 42 }, (_, i) => `src/file-${i}.ts`);
    const executionPayload = {
      executionVersion: 1,
      summary: "Touched a lot of files.",
      filesChanged: manyFiles,
      checks: {
        lint: { status: "pass", details: "ok" },
        typecheck: { status: "pass", details: "ok" },
        tests: { status: "pass", details: "ok" },
      },
      notes: [],
      prDraftCreated: true,
      score: 0.7,
      scoreRationale: "Large but mechanical change.",
    };
    wireArtifacts(deps, { ExecutionReport: executionPayload });

    let capturedPrompt = "";
    deps.agentRunner.run.mockImplementation(async (_runtime: unknown, opts: { prompt: string }) => {
      capturedPrompt = opts.prompt;
      return {
        raw: "x",
        parsed: { stage: "distillation" as const, payload: { shouldPersist: false, reason: "n/a" } },
      };
    });

    const agent = buildAgent(deps);
    await agent.run("run-1", makeRun());

    expect(capturedPrompt).toContain("**Files Changed** (42):");
    expect(capturedPrompt).toContain("- …and 2 more");
  });

  it("renders '_none_' for a plan with zero steps", async () => {
    const deps = buildDeps();
    const planPayload = {
      planVersion: 1,
      summary: "A plan with literally no steps yet.",
      assumptions: [],
      openQuestions: [],
      risks: [],
      steps: [],
      testPlan: "n/a",
      confidence: 0.3,
    };
    const executionPayload = {
      executionVersion: 1,
      summary: "n/a",
      filesChanged: [],
      checks: {
        lint: { status: "pass", details: "ok" },
        typecheck: { status: "pass", details: "ok" },
        tests: { status: "pass", details: "ok" },
      },
      notes: [],
      prDraftCreated: false,
      score: 0.1,
      scoreRationale: "n/a",
    };
    wireArtifacts(deps, { Plan: planPayload, ExecutionReport: executionPayload });

    let capturedPrompt = "";
    deps.agentRunner.run.mockImplementation(async (_runtime: unknown, opts: { prompt: string }) => {
      capturedPrompt = opts.prompt;
      return {
        raw: "x",
        parsed: { stage: "distillation" as const, payload: { shouldPersist: false, reason: "n/a" } },
      };
    });

    const agent = buildAgent(deps);
    await agent.run("run-1", makeRun());

    expect(capturedPrompt).toContain("**Steps**:\n_none_");
  });
});
