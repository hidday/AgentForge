import { describe, it, expect, vi, beforeEach } from "vitest";
import { DistillationAgent } from "../../src/agents/distillationAgent.js";
import type { Run } from "../../src/domain/types.js";
import { RunState } from "../../src/domain/runState.js";

// Covers DistillationAgent branches not exercised by distillationAgent.test.ts
// or distillationAgent.edgeCases.test.ts:
//   - the existingSkillsSummary non-empty branch (active skill pool rendered
//     into the user prompt instead of "No existing skills.")
//   - the remediationArtifact-present branch (summarizeRemediation actually
//     invoked, including its ">15 resolutions" overflow line)

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

function makeSkill(overrides: {
  id?: string;
  name?: string | null;
  description?: string | null;
  taskCategory?: string;
  skillMarkdown?: string;
  repoSlug?: string;
  utilityScore?: number;
  successCount?: number;
  failureCount?: number;
  lastUsedAt?: Date;
  archivedAt?: Date | null;
} = {}) {
  return {
    id: overrides.id ?? "skill-1",
    repoSlug: overrides.repoSlug ?? "test-repo",
    name: overrides.name ?? "db-caching",
    description: overrides.description ?? "Use when caching DB connections.",
    taskCategory: overrides.taskCategory ?? "database caching",
    skillMarkdown: overrides.skillMarkdown ?? "Cache DB connections in a pool.",
    successCount: overrides.successCount ?? 0,
    failureCount: overrides.failureCount ?? 0,
    utilityScore: overrides.utilityScore ?? 0.5,
    lastUsedAt: overrides.lastUsedAt ?? new Date(),
    createdAt: new Date(),
    archivedAt: overrides.archivedAt ?? null,
  };
}

function makeDistillationOutput(decision: {
  shouldPersist: boolean;
  reason: string;
  skillMarkdown?: string;
  taskCategory?: string;
  name?: string;
  description?: string;
}) {
  return {
    raw: "raw output",
    parsed: {
      stage: "distillation" as const,
      payload: decision,
    },
  };
}

function makeExecutionReportPayload() {
  return {
    executionVersion: 1,
    summary: "Implemented JWT auth middleware.",
    filesChanged: ["src/middleware/auth.ts"],
    checks: {
      lint: { status: "pass", details: "ok" },
      typecheck: { status: "pass", details: "ok" },
      tests: { status: "pass", details: "ok" },
    },
    notes: [],
    prDraftCreated: true,
    score: 0.82,
    scoreRationale: "Implementation matches plan and all checks pass.",
  };
}

function buildDeps(overrides: Record<string, unknown> = {}) {
  const agentRunner = { run: vi.fn() };
  const artifactRepo = { findLatestByType: vi.fn(), findByRunId: vi.fn(), create: vi.fn() };
  const agentSkillRepo = {
    findActiveByRepo: vi.fn().mockResolvedValue([]),
    countActiveByRepo: vi.fn().mockResolvedValue(0),
    create: vi.fn().mockResolvedValue(makeSkill({ id: "new-skill-1" })),
    displaceAndCreate: vi.fn().mockResolvedValue({
      newSkill: makeSkill({ id: "new-skill-1" }),
      displacedSkillId: "displaced-skill-1",
    }),
    findById: vi.fn(),
    findLowestUtilityActive: vi.fn(),
    archiveById: vi.fn(),
    findTopKByRelevance: vi.fn().mockResolvedValue([]),
    incrementSuccess: vi.fn(),
    incrementFailure: vi.fn(),
    archiveIfLowUtility: vi.fn(),
  };
  const eventRepo = { create: vi.fn().mockResolvedValue({}), findByRunId: vi.fn() };
  const config = {
    MAX_SKILLS_PER_REPO: 5,
    NOVELTY_SIMILARITY_THRESHOLD: 0.5,
  };
  const logger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };

  const executionArtifact = {
    id: "artifact-1",
    runId: "run-1",
    type: "ExecutionReport" as const,
    version: 1,
    payloadJson: makeExecutionReportPayload(),
    rawText: '{"outcome":"success"}',
    createdAt: new Date(),
  };

  artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
    if (type === "ExecutionReport") return Promise.resolve(executionArtifact);
    return Promise.resolve(null);
  });

  return {
    agentRunner,
    artifactRepo,
    agentSkillRepo,
    eventRepo,
    config,
    logger,
    ...overrides,
  };
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

describe("DistillationAgent gaps", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the active skill pool into the prompt's existingSkillsSummary section when non-empty", async () => {
    const deps = buildDeps();
    // Deliberately dissimilar to the task query ("Add auth middleware") so the
    // novelty pre-check does not short-circuit before the LLM call.
    const dissimilarSkill = makeSkill({
      name: "db-caching",
      taskCategory: "database connection caching",
      skillMarkdown: "Reuse pooled database connections across requests.",
    });
    deps.agentSkillRepo.findActiveByRepo.mockResolvedValue([dissimilarSkill]);

    let capturedPrompt = "";
    deps.agentRunner.run.mockImplementation(async (_runtime: unknown, opts: { prompt: string }) => {
      capturedPrompt = opts.prompt;
      return makeDistillationOutput({ shouldPersist: false, reason: "nothing new here" });
    });

    const agent = buildAgent(deps);
    await agent.run("run-1", makeRun());

    expect(deps.agentRunner.run).toHaveBeenCalled();
    expect(capturedPrompt).not.toContain("No existing skills.");
    expect(capturedPrompt).toContain("db-caching");
    expect(capturedPrompt).toContain("database connection caching");
    expect(capturedPrompt).toContain("Reuse pooled database connections across requests.");
  });

  it("summarizes a present Remediation artifact, including the >15-resolutions overflow line", async () => {
    const deps = buildDeps();

    const resolution = Array.from({ length: 17 }, (_, i) => ({
      findingId: `finding-${i}`,
      status: "accepted" as const,
      action: `Fixed issue number ${i}`,
      rationale: `Because of reason ${i}`,
    }));
    const remediationArtifact = {
      id: "artifact-remediation",
      runId: "run-1",
      type: "Remediation" as const,
      version: 1,
      payloadJson: {
        reviewId: "rev-1",
        resolution,
        readyForHumanReview: true,
        executionReport: makeExecutionReportPayload(),
      },
      rawText: "{}",
      createdAt: new Date(),
    };

    deps.artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
      if (type === "ExecutionReport") {
        return Promise.resolve({
          id: "artifact-1",
          runId: "run-1",
          type: "ExecutionReport" as const,
          version: 1,
          payloadJson: makeExecutionReportPayload(),
          rawText: "{}",
          createdAt: new Date(),
        });
      }
      if (type === "Remediation") return Promise.resolve(remediationArtifact);
      return Promise.resolve(null);
    });

    let capturedPrompt = "";
    deps.agentRunner.run.mockImplementation(async (_runtime: unknown, opts: { prompt: string }) => {
      capturedPrompt = opts.prompt;
      return makeDistillationOutput({ shouldPersist: false, reason: "nothing new here" });
    });

    const agent = buildAgent(deps);
    await agent.run("run-1", makeRun());

    expect(capturedPrompt).toContain("## Remediation Summary");
    expect(capturedPrompt).toContain("Fixed issue number 0");
    // 17 resolutions, capped display at 15 -> "...and 2 more"
    expect(capturedPrompt).toContain("…and 2 more");
  });
});
