import { describe, it, expect, vi, beforeEach } from "vitest";
import { DistillationAgent } from "../../src/agents/distillationAgent.js";
import type { Run } from "../../src/domain/types.js";
import { RunState } from "../../src/domain/runState.js";

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

function buildDeps() {
  const agentRunner = {
    run: vi.fn().mockImplementation(async (_runtime: unknown, opts: { prompt: string }) => {
      capturedPrompt = opts.prompt;
      return {
        raw: "raw output",
        parsed: { stage: "distillation" as const, payload: { shouldPersist: false, reason: "n/a" } },
      };
    }),
  };
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
  const config = { MAX_SKILLS_PER_REPO: 5, NOVELTY_SIMILARITY_THRESHOLD: 0.95 };
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };

  return { agentRunner, artifactRepo, agentSkillRepo, eventRepo, config, logger };
}

let capturedPrompt = "";

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

function makeExecutionArtifact(payloadJson: unknown) {
  return {
    id: "artifact-exec",
    runId: "run-1",
    type: "ExecutionReport" as const,
    version: 1,
    payloadJson,
    rawText: "{}",
    createdAt: new Date(),
  };
}

const validExecutionPayload = {
  executionVersion: 1,
  summary: "Implemented things.",
  filesChanged: [],
  checks: {
    lint: { status: "pass", details: "ok" },
    typecheck: { status: "pass", details: "ok" },
    tests: { status: "fail", details: "2 tests failed in auth.spec.ts" },
  },
  notes: Array.from({ length: 18 }, (_, i) => `note ${i}`),
  prDraftCreated: true,
  score: 0.5,
  scoreRationale: "x".repeat(500),
};

describe("DistillationAgent summarization helpers (via run())", () => {
  beforeEach(() => {
    capturedPrompt = "";
  });

  it("renders summarizeExecution with empty filesChanged as '_none_', overflowing notes list, and failing-check details", async () => {
    const deps = buildDeps();
    deps.artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
      if (type === "ExecutionReport") return Promise.resolve(makeExecutionArtifact(validExecutionPayload));
      return Promise.resolve(null);
    });

    const agent = buildAgent(deps);
    await agent.run("run-1", makeRun());

    expect(capturedPrompt).toContain("_none_");
    expect(capturedPrompt).toContain("…and 3 more");
    expect(capturedPrompt).toContain("tests: fail — 2 tests failed in auth.spec.ts");
    // long scoreRationale must be truncated with an ellipsis character
    expect(capturedPrompt).toContain("…");
    expect(capturedPrompt).not.toContain("x".repeat(500));
  });

  it("falls back to truncated JSON when the ExecutionReport payload fails schema validation", async () => {
    const deps = buildDeps();
    deps.artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
      if (type === "ExecutionReport") return Promise.resolve(makeExecutionArtifact({ not: "a valid report" }));
      return Promise.resolve(null);
    });

    const agent = buildAgent(deps);
    await agent.run("run-1", makeRun());

    expect(capturedPrompt).toContain(JSON.stringify({ not: "a valid report" }));
  });

  it("renders summarizePlan with >12 steps, risks, and assumptions when a Plan artifact is present", async () => {
    const deps = buildDeps();
    const planPayload = {
      planVersion: 1,
      summary: "Plan summary",
      requirementsTraceability: "",
      assumptions: Array.from({ length: 10 }, (_, i) => `assumption ${i}`),
      openQuestions: [],
      risks: Array.from({ length: 10 }, (_, i) => `risk ${i}`),
      steps: Array.from({ length: 14 }, (_, i) => ({
        id: `s${i}`,
        title: `Step ${i}`,
        description: `Description ${i}`,
      })),
      testPlan: "Run everything",
      confidence: 0.6,
    };
    deps.artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
      if (type === "ExecutionReport") return Promise.resolve(makeExecutionArtifact(validExecutionPayload));
      if (type === "Plan")
        return Promise.resolve({
          id: "artifact-plan",
          runId: "run-1",
          type: "Plan" as const,
          version: 1,
          payloadJson: planPayload,
          rawText: "{}",
          createdAt: new Date(),
        });
      return Promise.resolve(null);
    });

    const agent = buildAgent(deps);
    await agent.run("run-1", makeRun());

    expect(capturedPrompt).toContain("**Summary**: Plan summary");
    expect(capturedPrompt).toContain("**Confidence**: 0.60");
    expect(capturedPrompt).toContain("…and 2 more steps");
    expect(capturedPrompt).toContain("…and 2 more"); // assumptions/risks overflow past cap of 8
  });

  it("uses '_none_' for a Plan with no steps and falls back to truncated JSON for an invalid Plan payload", async () => {
    const deps = buildDeps();
    deps.artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
      if (type === "ExecutionReport") return Promise.resolve(makeExecutionArtifact(validExecutionPayload));
      if (type === "Plan")
        return Promise.resolve({
          id: "artifact-plan",
          runId: "run-1",
          type: "Plan" as const,
          version: 1,
          payloadJson: { bogus: true },
          rawText: "{}",
          createdAt: new Date(),
        });
      return Promise.resolve(null);
    });

    const agent = buildAgent(deps);
    await agent.run("run-1", makeRun());

    expect(capturedPrompt).toContain(JSON.stringify({ bogus: true }));
  });

  it("renders summarizeRemediation with >15 resolutions when a Remediation artifact is present", async () => {
    const deps = buildDeps();
    const remediationPayload = {
      reviewId: "rev-1",
      resolution: Array.from({ length: 17 }, (_, i) => ({
        findingId: `f${i}`,
        status: "accepted",
        action: `fix ${i}`,
        rationale: `because ${i}`,
      })),
      readyForHumanReview: true,
      executionReport: validExecutionPayload,
    };
    deps.artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
      if (type === "ExecutionReport") return Promise.resolve(makeExecutionArtifact(validExecutionPayload));
      if (type === "Remediation")
        return Promise.resolve({
          id: "artifact-rem",
          runId: "run-1",
          type: "Remediation" as const,
          version: 1,
          payloadJson: remediationPayload,
          rawText: "{}",
          createdAt: new Date(),
        });
      return Promise.resolve(null);
    });

    const agent = buildAgent(deps);
    await agent.run("run-1", makeRun());

    expect(capturedPrompt).toContain("## Remediation Summary");
    expect(capturedPrompt).toContain("**Ready for human review**: true");
    expect(capturedPrompt).toContain("…and 2 more");
  });

  it("falls back to a truncated-JSON Remediation Summary when the payload fails schema validation", async () => {
    const deps = buildDeps();
    deps.artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
      if (type === "ExecutionReport") return Promise.resolve(makeExecutionArtifact(validExecutionPayload));
      if (type === "Remediation")
        return Promise.resolve({
          id: "artifact-rem",
          runId: "run-1",
          type: "Remediation" as const,
          version: 1,
          payloadJson: { invalid: true },
          rawText: "{}",
          createdAt: new Date(),
        });
      return Promise.resolve(null);
    });

    const agent = buildAgent(deps);
    await agent.run("run-1", makeRun());

    expect(capturedPrompt).toContain("## Remediation Summary");
    expect(capturedPrompt).toContain(JSON.stringify({ invalid: true }));
  });

  it("renders the existing-skills summary line with [name] prefix and lists skills when the pool is non-empty", async () => {
    const deps = buildDeps();
    deps.artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
      if (type === "ExecutionReport") return Promise.resolve(makeExecutionArtifact(validExecutionPayload));
      return Promise.resolve(null);
    });
    deps.agentSkillRepo.findActiveByRepo.mockResolvedValue([
      {
        id: "skill-1",
        repoSlug: "test-repo",
        name: "Named Skill",
        description: null,
        taskCategory: "auth",
        skillMarkdown: "x".repeat(300),
        utilityScore: 0.5,
        lastUsedAt: new Date(),
      },
    ]);

    const agent = buildAgent(deps);
    await agent.run("run-1", makeRun());

    expect(capturedPrompt).toContain("[Named Skill] auth:");
  });
});
