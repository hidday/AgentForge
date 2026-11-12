import { describe, it, expect, vi, beforeEach } from "vitest";
import { DistillationAgent } from "../../src/agents/distillationAgent.js";
import type { Run } from "../../src/domain/types.js";
import { RunState } from "../../src/domain/runState.js";

/**
 * Covers the field-aware summarizePlan / summarizeRemediation helpers
 * (distillationAgent.ts lines 27-61, 100-122) and the prompt-assembly branches
 * in run() that feed them a real Plan/Remediation artifact and a non-empty
 * existing-skills pool (lines 203-218). Neither existing test file
 * (distillationAgent.test.ts, distillationAgent.edgecases.test.ts) ever
 * supplies a Plan or Remediation artifact, so those code paths were dead
 * in coverage.
 */

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
    id: "skill-existing-1",
    repoSlug: "test-repo",
    name: "existing-skill",
    description: "An existing skill in the pool.",
    taskCategory: "auth middleware",
    skillMarkdown: "Use JWT tokens consistently across middleware.",
    successCount: 2,
    failureCount: 0,
    utilityScore: 0.6,
    lastUsedAt: new Date(),
    createdAt: new Date(),
    archivedAt: null,
    ...overrides,
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
    parsed: { stage: "distillation" as const, payload: decision },
  };
}

function validPlanPayload(stepCount: number, assumptionCount: number, riskCount: number) {
  return {
    planVersion: 1,
    summary: "Add Zod-based request validation middleware across all endpoints.",
    requirementsTraceability: "Covers all stated requirements.",
    assumptions: Array.from({ length: assumptionCount }, (_, i) => `Assumption number ${i + 1}`),
    openQuestions: [],
    risks: Array.from({ length: riskCount }, (_, i) => `Risk number ${i + 1}`),
    steps: Array.from({ length: stepCount }, (_, i) => ({
      id: `s${i + 1}`,
      title: `Step title ${i + 1}`,
      description: `Step description ${i + 1}`,
    })),
    testPlan: "Test every endpoint with valid, missing, and malformed input.",
    confidence: 0.87,
  };
}

function validExecutionPayload() {
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

function validRemediationPayload(resolutionCount: number) {
  return {
    reviewId: "rev-001",
    resolution: Array.from({ length: resolutionCount }, (_, i) => ({
      findingId: `f${i + 1}`,
      status: "accepted" as const,
      action: `Action taken for finding ${i + 1}`,
      rationale: `Rationale for finding ${i + 1}`,
    })),
    readyForHumanReview: true,
    executionReport: validExecutionPayload(),
  };
}

function buildDeps() {
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

function capturedPrompt(deps: ReturnType<typeof buildDeps>): string {
  expect(deps.agentRunner.run).toHaveBeenCalledOnce();
  const [, input] = deps.agentRunner.run.mock.calls[0]!;
  return (input as { prompt: string }).prompt;
}

describe("DistillationAgent — summarizePlan is exercised with a real Plan artifact", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders summary, confidence, assumptions, risks, steps, and test plan when steps/assumptions/risks are within the display cap", async () => {
    const deps = buildDeps();
    deps.artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
      if (type === "Plan") {
        return Promise.resolve({
          id: "plan-1",
          runId: "run-1",
          type: "Plan",
          version: 1,
          payloadJson: validPlanPayload(3, 2, 2),
          rawText: "",
          createdAt: new Date(),
        });
      }
      if (type === "ExecutionReport") {
        return Promise.resolve({
          id: "artifact-1",
          runId: "run-1",
          type: "ExecutionReport",
          version: 1,
          payloadJson: validExecutionPayload(),
          rawText: "",
          createdAt: new Date(),
        });
      }
      return Promise.resolve(null);
    });
    deps.agentRunner.run.mockResolvedValue(
      makeDistillationOutput({ shouldPersist: false, reason: "not generalizable" }),
    );

    const agent = buildAgent(deps);
    await agent.run("run-1", makeRun());

    const prompt = capturedPrompt(deps);
    expect(prompt).toContain(
      "**Summary**: Add Zod-based request validation middleware across all endpoints.",
    );
    expect(prompt).toContain("**Confidence**: 0.87");
    expect(prompt).toContain("- Assumption number 1");
    expect(prompt).toContain("- Assumption number 2");
    expect(prompt).toContain("- Risk number 1");
    expect(prompt).toContain("1. Step title 1 — Step description 1");
    expect(prompt).toContain("3. Step title 3 — Step description 3");
    expect(prompt).toContain(
      "**Test Plan**: Test every endpoint with valid, missing, and malformed input.",
    );
    // Within caps, so no "...and N more" truncation markers appear.
    expect(prompt).not.toContain("more steps");
  });

  it("truncates assumptions/risks beyond the cap of 8 and steps beyond the cap of 12, each with an '…and N more' marker", async () => {
    const deps = buildDeps();
    deps.artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
      if (type === "Plan") {
        return Promise.resolve({
          id: "plan-1",
          runId: "run-1",
          type: "Plan",
          version: 1,
          payloadJson: validPlanPayload(15, 10, 9),
          rawText: "",
          createdAt: new Date(),
        });
      }
      if (type === "ExecutionReport") {
        return Promise.resolve({
          id: "artifact-1",
          runId: "run-1",
          type: "ExecutionReport",
          version: 1,
          payloadJson: validExecutionPayload(),
          rawText: "",
          createdAt: new Date(),
        });
      }
      return Promise.resolve(null);
    });
    deps.agentRunner.run.mockResolvedValue(
      makeDistillationOutput({ shouldPersist: false, reason: "not generalizable" }),
    );

    const agent = buildAgent(deps);
    await agent.run("run-1", makeRun());

    const prompt = capturedPrompt(deps);
    // 15 steps, cap 12 -> 3 more
    expect(prompt).toContain("…and 3 more steps");
    // 10 assumptions, cap 8 -> 2 more
    expect(prompt).toContain("- …and 2 more");
    // 9 risks, cap 8 -> 1 more
    expect(prompt).toContain("- …and 1 more");
    // Only the first 12 step titles should appear, not the 13th+.
    expect(prompt).toContain("12. Step title 12");
    expect(prompt).not.toContain("13. Step title 13");
  });

  it("falls back to truncated JSON when the Plan artifact payload does not match PlanSchema", async () => {
    const deps = buildDeps();
    deps.artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
      if (type === "Plan") {
        return Promise.resolve({
          id: "plan-1",
          runId: "run-1",
          type: "Plan",
          version: 1,
          // Missing required fields (summary, steps, confidence, etc.) -> safeParse fails.
          payloadJson: { notAPlan: true },
          rawText: "",
          createdAt: new Date(),
        });
      }
      if (type === "ExecutionReport") {
        return Promise.resolve({
          id: "artifact-1",
          runId: "run-1",
          type: "ExecutionReport",
          version: 1,
          payloadJson: validExecutionPayload(),
          rawText: "",
          createdAt: new Date(),
        });
      }
      return Promise.resolve(null);
    });
    deps.agentRunner.run.mockResolvedValue(
      makeDistillationOutput({ shouldPersist: false, reason: "not generalizable" }),
    );

    const agent = buildAgent(deps);
    await agent.run("run-1", makeRun());

    const prompt = capturedPrompt(deps);
    expect(prompt).toContain(JSON.stringify({ notAPlan: true }));
    expect(prompt).not.toContain("**Confidence**:");
  });
});

describe("DistillationAgent — summarizeRemediation is exercised with a real Remediation artifact", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the remediation heading, readiness flag, final score, and each resolution's action/rationale", async () => {
    const deps = buildDeps();
    deps.artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
      if (type === "Remediation") {
        return Promise.resolve({
          id: "rem-1",
          runId: "run-1",
          type: "Remediation",
          version: 1,
          payloadJson: validRemediationPayload(3),
          rawText: "",
          createdAt: new Date(),
        });
      }
      if (type === "ExecutionReport") {
        return Promise.resolve({
          id: "artifact-1",
          runId: "run-1",
          type: "ExecutionReport",
          version: 1,
          payloadJson: validExecutionPayload(),
          rawText: "",
          createdAt: new Date(),
        });
      }
      return Promise.resolve(null);
    });
    deps.agentRunner.run.mockResolvedValue(
      makeDistillationOutput({ shouldPersist: false, reason: "not generalizable" }),
    );

    const agent = buildAgent(deps);
    await agent.run("run-1", makeRun());

    const prompt = capturedPrompt(deps);
    expect(prompt).toContain("## Remediation Summary");
    expect(prompt).toContain("**Ready for human review**: true");
    expect(prompt).toContain("**Final score**: 0.82 — Implementation matches plan and all checks pass.");
    expect(prompt).toContain("- [accepted] f1: Action taken for finding 1");
    expect(prompt).toContain("*why*: Rationale for finding 1");
    expect(prompt).not.toContain("…and");
  });

  it("truncates resolutions beyond the cap of 15 with an '…and N more' marker", async () => {
    const deps = buildDeps();
    deps.artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
      if (type === "Remediation") {
        return Promise.resolve({
          id: "rem-1",
          runId: "run-1",
          type: "Remediation",
          version: 1,
          payloadJson: validRemediationPayload(18),
          rawText: "",
          createdAt: new Date(),
        });
      }
      if (type === "ExecutionReport") {
        return Promise.resolve({
          id: "artifact-1",
          runId: "run-1",
          type: "ExecutionReport",
          version: 1,
          payloadJson: validExecutionPayload(),
          rawText: "",
          createdAt: new Date(),
        });
      }
      return Promise.resolve(null);
    });
    deps.agentRunner.run.mockResolvedValue(
      makeDistillationOutput({ shouldPersist: false, reason: "not generalizable" }),
    );

    const agent = buildAgent(deps);
    await agent.run("run-1", makeRun());

    const prompt = capturedPrompt(deps);
    expect(prompt).toContain("- …and 3 more");
    expect(prompt).toContain("- [accepted] f15: Action taken for finding 15");
    expect(prompt).not.toContain("f16:");
  });

  it("falls back to a truncated-JSON remediation summary when the payload does not match RemediationSchema", async () => {
    const deps = buildDeps();
    deps.artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
      if (type === "Remediation") {
        return Promise.resolve({
          id: "rem-1",
          runId: "run-1",
          type: "Remediation",
          version: 1,
          payloadJson: { notRemediation: true },
          rawText: "",
          createdAt: new Date(),
        });
      }
      if (type === "ExecutionReport") {
        return Promise.resolve({
          id: "artifact-1",
          runId: "run-1",
          type: "ExecutionReport",
          version: 1,
          payloadJson: validExecutionPayload(),
          rawText: "",
          createdAt: new Date(),
        });
      }
      return Promise.resolve(null);
    });
    deps.agentRunner.run.mockResolvedValue(
      makeDistillationOutput({ shouldPersist: false, reason: "not generalizable" }),
    );

    const agent = buildAgent(deps);
    await agent.run("run-1", makeRun());

    const prompt = capturedPrompt(deps);
    expect(prompt).toContain("## Remediation Summary");
    expect(prompt).toContain(JSON.stringify({ notRemediation: true }));
    expect(prompt).not.toContain("**Ready for human review**:");
  });
});

describe("DistillationAgent — existingSkillsSummary with a non-empty active skill pool", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders each active skill as a bullet using its name/taskCategory and snippet instead of the 'No existing skills.' fallback", async () => {
    const deps = buildDeps();
    deps.artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
      if (type === "ExecutionReport") {
        return Promise.resolve({
          id: "artifact-1",
          runId: "run-1",
          type: "ExecutionReport",
          version: 1,
          payloadJson: validExecutionPayload(),
          rawText: "",
          createdAt: new Date(),
        });
      }
      return Promise.resolve(null);
    });
    deps.agentSkillRepo.findActiveByRepo.mockResolvedValue([
      makeSkill({
        id: "skill-a",
        name: "named-skill",
        taskCategory: "auth middleware",
        skillMarkdown: "A snippet of the named skill's markdown body.",
      }),
      makeSkill({
        id: "skill-b",
        name: null,
        taskCategory: "validation layer",
        skillMarkdown: "A snippet of the unnamed skill's markdown body.",
      }),
    ]);
    // Keep the novelty gate from short-circuiting before the LLM call by using
    // an unrelated task query relative to the skills above.
    deps.agentRunner.run.mockResolvedValue(
      makeDistillationOutput({ shouldPersist: false, reason: "not generalizable" }),
    );

    const agent = buildAgent(deps);
    await agent.run(
      "run-1",
      makeRun({ linearIssueTitle: "Completely unrelated payments refactor" }),
    );

    const prompt = capturedPrompt(deps);
    expect(prompt).not.toContain("No existing skills.");
    expect(prompt).toContain(
      "- [named-skill] auth middleware: A snippet of the named skill's markdown body.",
    );
    expect(prompt).toContain(
      "- [validation layer] validation layer: A snippet of the unnamed skill's markdown body.",
    );
  });
});
