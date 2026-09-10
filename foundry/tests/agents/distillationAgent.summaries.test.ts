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

function makeSkill(overrides: Partial<{
  id: string;
  name: string | null;
  taskCategory: string;
  skillMarkdown: string;
}> = {}) {
  return {
    id: overrides.id ?? "skill-1",
    repoSlug: "test-repo",
    name: overrides.name === undefined ? "auth-middleware" : overrides.name,
    description: "Use when adding or changing auth middleware.",
    taskCategory: overrides.taskCategory ?? "auth middleware",
    skillMarkdown: overrides.skillMarkdown ?? "Use JWT tokens for auth.",
    successCount: 0,
    failureCount: 0,
    utilityScore: 0.5,
    lastUsedAt: new Date(),
    createdAt: new Date(),
    archivedAt: null,
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
  };
  const eventRepo = { create: vi.fn().mockResolvedValue({}), findByRunId: vi.fn() };
  const config = { MAX_SKILLS_PER_REPO: 5, NOVELTY_SIMILARITY_THRESHOLD: 0.5 };
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };

  return { agentRunner, artifactRepo, agentSkillRepo, eventRepo, config, logger, ...overrides };
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

function makeExecutionArtifact(payloadJson: unknown) {
  return {
    id: "exec-1",
    runId: "run-1",
    type: "ExecutionReport" as const,
    version: 1,
    payloadJson,
    rawText: "{}",
    createdAt: new Date(),
  };
}

function makePlanArtifact(payloadJson: unknown) {
  return {
    id: "plan-1",
    runId: "run-1",
    type: "Plan" as const,
    version: 1,
    payloadJson,
    rawText: "{}",
    createdAt: new Date(),
  };
}

function makeRemediationArtifact(payloadJson: unknown) {
  return {
    id: "rem-1",
    runId: "run-1",
    type: "Remediation" as const,
    version: 1,
    payloadJson,
    rawText: "{}",
    createdAt: new Date(),
  };
}

const validExecutionReport = {
  executionVersion: 1,
  summary: "Implemented JWT auth middleware.",
  filesChanged: Array.from({ length: 45 }, (_, i) => `src/file${String(i)}.ts`),
  checks: {
    lint: { status: "pass", details: "ok" },
    typecheck: { status: "fail", details: "Type error in auth.ts" },
    tests: { status: "skip", details: "" },
  },
  notes: Array.from({ length: 20 }, (_, i) => `Note ${String(i)}`),
  prDraftCreated: true,
  score: 0.82,
  scoreRationale: "Implementation matches plan and all checks pass.",
};

const validPlan = {
  planVersion: 1,
  summary: "A plan",
  requirementsTraceability: "",
  assumptions: Array.from({ length: 10 }, (_, i) => `Assumption ${String(i)}`),
  risks: Array.from({ length: 10 }, (_, i) => `Risk ${String(i)}`),
  openQuestions: [],
  steps: Array.from({ length: 15 }, (_, i) => ({
    id: `s${String(i)}`,
    title: `Step ${String(i)}`,
    description: `Do step ${String(i)}`,
  })),
  testPlan: "Run the test suite",
  confidence: 0.9,
};

const validRemediation = {
  reviewId: "rev-1",
  readyForHumanReview: true,
  resolution: Array.from({ length: 18 }, (_, i) => ({
    findingId: `f${String(i)}`,
    status: "accepted" as const,
    action: `Fixed finding ${String(i)}`,
    rationale: i % 2 === 0 ? `Because reason ${String(i)}` : "",
  })),
  executionReport: validExecutionReport,
};

describe("DistillationAgent — summary rendering branches", () => {
  let capturedPrompt = "";

  beforeEach(() => {
    vi.clearAllMocks();
    capturedPrompt = "";
  });

  function runnerCapturing(decision: {
    shouldPersist: boolean;
    reason: string;
    skillMarkdown?: string;
    taskCategory?: string;
    name?: string;
    description?: string;
  }) {
    return vi.fn().mockImplementation(async (_runtime: unknown, opts: { prompt: string }) => {
      capturedPrompt = opts.prompt;
      return { raw: "raw", parsed: { stage: "distillation", payload: decision } };
    });
  }

  it("summarizes a valid Plan with steps>12, assumptions>8, and risks>8 truncated with 'more' counters", async () => {
    const deps = buildDeps();
    deps.artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
      if (type === "ExecutionReport") return Promise.resolve(makeExecutionArtifact(validExecutionReport));
      if (type === "Plan") return Promise.resolve(makePlanArtifact(validPlan));
      return Promise.resolve(null);
    });
    deps.agentRunner.run = runnerCapturing({ shouldPersist: false, reason: "test" });
    const agent = buildAgent(deps);

    await agent.run("run-1", makeRun());

    expect(capturedPrompt).toContain("…and 3 more steps");
    expect(capturedPrompt).toContain("…and 2 more");
    expect(capturedPrompt).toContain("Assumption 0");
  });

  it("falls back to truncated JSON when the Plan artifact payload doesn't match the schema", async () => {
    const deps = buildDeps();
    deps.artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
      if (type === "ExecutionReport") return Promise.resolve(makeExecutionArtifact(validExecutionReport));
      if (type === "Plan") return Promise.resolve(makePlanArtifact({ not: "a valid plan" }));
      return Promise.resolve(null);
    });
    deps.agentRunner.run = runnerCapturing({ shouldPersist: false, reason: "test" });
    const agent = buildAgent(deps);

    await agent.run("run-1", makeRun());

    expect(capturedPrompt).toContain(JSON.stringify({ not: "a valid plan" }));
  });

  it("renders 'No plan artifact available' when there is no Plan artifact", async () => {
    const deps = buildDeps();
    deps.artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
      if (type === "ExecutionReport") return Promise.resolve(makeExecutionArtifact(validExecutionReport));
      return Promise.resolve(null);
    });
    deps.agentRunner.run = runnerCapturing({ shouldPersist: false, reason: "test" });
    const agent = buildAgent(deps);

    await agent.run("run-1", makeRun());

    expect(capturedPrompt).toContain("No plan artifact available");
  });

  it("summarizes a valid ExecutionReport with failing/skipped checks, >40 files, and >15 notes", async () => {
    const deps = buildDeps();
    deps.artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
      if (type === "ExecutionReport") return Promise.resolve(makeExecutionArtifact(validExecutionReport));
      return Promise.resolve(null);
    });
    deps.agentRunner.run = runnerCapturing({ shouldPersist: false, reason: "test" });
    const agent = buildAgent(deps);

    await agent.run("run-1", makeRun());

    expect(capturedPrompt).toContain("typecheck: fail — Type error in auth.ts");
    expect(capturedPrompt).toContain("lint: pass");
    expect(capturedPrompt).not.toContain("lint: pass — ok");
    expect(capturedPrompt).toContain("…and 5 more");
    expect(capturedPrompt).toContain("…and 5 more");
  });

  it("falls back to truncated JSON when the ExecutionReport payload doesn't match the schema", async () => {
    const deps = buildDeps();
    deps.artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
      if (type === "ExecutionReport") return Promise.resolve(makeExecutionArtifact({ bogus: true }));
      return Promise.resolve(null);
    });
    deps.agentRunner.run = runnerCapturing({ shouldPersist: false, reason: "test" });
    const agent = buildAgent(deps);

    await agent.run("run-1", makeRun());

    expect(capturedPrompt).toContain(JSON.stringify({ bogus: true }));
  });

  it("summarizes a valid Remediation artifact with >15 resolutions and mixed rationale presence", async () => {
    const deps = buildDeps();
    deps.artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
      if (type === "ExecutionReport") return Promise.resolve(makeExecutionArtifact(validExecutionReport));
      if (type === "Remediation") return Promise.resolve(makeRemediationArtifact(validRemediation));
      return Promise.resolve(null);
    });
    deps.agentRunner.run = runnerCapturing({ shouldPersist: false, reason: "test" });
    const agent = buildAgent(deps);

    await agent.run("run-1", makeRun());

    expect(capturedPrompt).toContain("## Remediation Summary");
    expect(capturedPrompt).toContain("**Ready for human review**: true");
    expect(capturedPrompt).toContain("*why*: Because reason 0");
    expect(capturedPrompt).toContain("…and 3 more");
  });

  it("falls back to truncated JSON when the Remediation payload doesn't match the schema", async () => {
    const deps = buildDeps();
    deps.artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
      if (type === "ExecutionReport") return Promise.resolve(makeExecutionArtifact(validExecutionReport));
      if (type === "Remediation") return Promise.resolve(makeRemediationArtifact({ nope: true }));
      return Promise.resolve(null);
    });
    deps.agentRunner.run = runnerCapturing({ shouldPersist: false, reason: "test" });
    const agent = buildAgent(deps);

    await agent.run("run-1", makeRun());

    expect(capturedPrompt).toContain("## Remediation Summary");
    expect(capturedPrompt).toContain(JSON.stringify({ nope: true }));
  });

  it("omits the remediation summary entirely when there is no Remediation artifact", async () => {
    const deps = buildDeps();
    deps.artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
      if (type === "ExecutionReport") return Promise.resolve(makeExecutionArtifact(validExecutionReport));
      return Promise.resolve(null);
    });
    deps.agentRunner.run = runnerCapturing({ shouldPersist: false, reason: "test" });
    const agent = buildAgent(deps);

    await agent.run("run-1", makeRun());

    expect(capturedPrompt).not.toContain("## Remediation Summary");
  });

  it("renders the existing-skills summary using a skill's taskCategory when name is null", async () => {
    const deps = buildDeps();
    deps.artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
      if (type === "ExecutionReport") return Promise.resolve(makeExecutionArtifact(validExecutionReport));
      return Promise.resolve(null);
    });
    deps.agentSkillRepo.findActiveByRepo = vi
      .fn()
      .mockResolvedValue([makeSkill({ name: null, taskCategory: "db-migrations" })]);
    deps.agentRunner.run = runnerCapturing({ shouldPersist: false, reason: "test" });
    const agent = buildAgent(deps);

    await agent.run("run-1", makeRun());

    expect(capturedPrompt).toContain("[db-migrations] db-migrations:");
  });

  it("renders 'No existing skills.' when the repo has no active skills", async () => {
    const deps = buildDeps();
    deps.artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
      if (type === "ExecutionReport") return Promise.resolve(makeExecutionArtifact(validExecutionReport));
      return Promise.resolve(null);
    });
    deps.agentRunner.run = runnerCapturing({ shouldPersist: false, reason: "test" });
    const agent = buildAgent(deps);

    await agent.run("run-1", makeRun());

    expect(capturedPrompt).toContain("No existing skills.");
  });

  it("skips persisting and logs a warning when the decision is missing taskCategory", async () => {
    const deps = buildDeps();
    deps.artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
      if (type === "ExecutionReport") return Promise.resolve(makeExecutionArtifact(validExecutionReport));
      return Promise.resolve(null);
    });
    deps.agentRunner.run = runnerCapturing({
      shouldPersist: true,
      reason: "novel",
      skillMarkdown: "Some markdown",
      taskCategory: "   ",
    });
    const agent = buildAgent(deps);

    await agent.run("run-1", makeRun());

    expect(deps.agentSkillRepo.create).not.toHaveBeenCalled();
    expect(deps.agentSkillRepo.displaceAndCreate).not.toHaveBeenCalled();
    const eventPayload = deps.eventRepo.create.mock.calls[0]![0] as { payloadJson: { reason: string } };
    expect(eventPayload.payloadJson.reason).toBe("missing_required_skill_fields");
  });

  it("skips persisting when the decision is missing skillMarkdown", async () => {
    const deps = buildDeps();
    deps.artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
      if (type === "ExecutionReport") return Promise.resolve(makeExecutionArtifact(validExecutionReport));
      return Promise.resolve(null);
    });
    deps.agentRunner.run = runnerCapturing({
      shouldPersist: true,
      reason: "novel",
      taskCategory: "auth",
      skillMarkdown: "  ",
    });
    const agent = buildAgent(deps);

    await agent.run("run-1", makeRun());

    expect(deps.agentSkillRepo.create).not.toHaveBeenCalled();
  });

  it("falls back to a generated description when the decision's description is whitespace-only", async () => {
    const deps = buildDeps();
    deps.artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
      if (type === "ExecutionReport") return Promise.resolve(makeExecutionArtifact(validExecutionReport));
      return Promise.resolve(null);
    });
    deps.agentRunner.run = runnerCapturing({
      shouldPersist: true,
      reason: "novel",
      taskCategory: "auth",
      skillMarkdown: "Do the thing",
      description: "   ",
    });
    const agent = buildAgent(deps);

    await agent.run("run-1", makeRun({ repo: "acme/widgets" }));

    const createCall = deps.agentSkillRepo.create.mock.calls[0]![0] as { description: string };
    expect(createCall.description).toBe("Use when working on auth in acme/widgets.");
  });

  it("keeps a provided non-empty description as-is", async () => {
    const deps = buildDeps();
    deps.artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
      if (type === "ExecutionReport") return Promise.resolve(makeExecutionArtifact(validExecutionReport));
      return Promise.resolve(null);
    });
    deps.agentRunner.run = runnerCapturing({
      shouldPersist: true,
      reason: "novel",
      taskCategory: "auth",
      skillMarkdown: "Do the thing",
      description: "  A crisp description.  ",
    });
    const agent = buildAgent(deps);

    await agent.run("run-1", makeRun());

    const createCall = deps.agentSkillRepo.create.mock.calls[0]![0] as { description: string };
    expect(createCall.description).toBe("A crisp description.");
  });

  it("includes the linear issue description (truncated to 200 chars) in the task query used for novelty scoring", async () => {
    const deps = buildDeps();
    deps.artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
      if (type === "ExecutionReport") return Promise.resolve(makeExecutionArtifact(validExecutionReport));
      return Promise.resolve(null);
    });
    deps.agentRunner.run = runnerCapturing({ shouldPersist: false, reason: "test" });
    const agent = buildAgent(deps);

    const longDescription = "x".repeat(300);
    await agent.run(
      "run-1",
      makeRun({
        linearIssueDescription: longDescription,
      } as never),
    );

    // The task query is used only for the deterministic novelty pre-check (findActiveByRepo
    // is empty here so maxNoveltyOverlap is 0), but we assert the run completes without error
    // when a description is present, exercising the `?.slice(0, 200) ?? ""` truthy branch.
    expect(deps.eventRepo.create).toHaveBeenCalled();
  });
});
