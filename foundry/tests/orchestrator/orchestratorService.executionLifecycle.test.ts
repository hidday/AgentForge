import { describe, it, expect, vi } from "vitest";
import { OrchestratorService } from "../../src/orchestrator/orchestratorService.js";
import { RunState } from "../../src/domain/runState.js";
import { AgentTimeoutError, PolicyViolationError } from "../../src/utils/errors.js";
import {
  makeRun,
  makePlan,
  makeExecutionReport,
  makeReview,
  makeRunRepoFake,
  makeArtifactRepoFake,
  makeEventRepoFake,
  makeRepoRegistryFake,
  makeLoggerFake,
  makeGitServiceFake,
  makeLinearClientFake,
  makeGithubClientFake,
  makeGithubSyncFake,
  makeLinearSyncFake,
  makeDashboardEmitterFake,
  makeExecutorAgentFake,
  makeReviewerAgentFake,
  makeRemediationAgentFake,
} from "./orchestratorTestHelpers.js";

function buildDeps(
  runOverrides: Partial<ReturnType<typeof makeRun>> = {},
  overrides: Record<string, unknown> = {},
) {
  const run = makeRun({
    id: "run-1",
    state: RunState.Implementing,
    approvedPlanVersion: 1,
    prNumber: null,
    ...runOverrides,
  });
  const runRepo = makeRunRepoFake(run);
  const plan = makePlan({ planVersion: 1 });
  const artifactRepo = makeArtifactRepoFake({
    Plan: {
      id: "artifact-plan",
      runId: "run-1",
      type: "Plan",
      version: 1,
      payloadJson: plan,
      rawText: "{}",
      createdAt: new Date(),
    },
  });
  const eventRepo = makeEventRepoFake();
  const linearClient = makeLinearClientFake();
  const githubClient = makeGithubClientFake();
  const gitService = makeGitServiceFake();
  const repoRegistry = makeRepoRegistryFake();
  const linearSync = makeLinearSyncFake();
  const githubSync = makeGithubSyncFake();
  const dashboardEmitter = makeDashboardEmitterFake();
  const logger = makeLoggerFake();

  const executorAgent = makeExecutorAgentFake(artifactRepo);
  const reviewerAgent = makeReviewerAgentFake(artifactRepo);
  const remediationAgent = makeRemediationAgentFake(artifactRepo);
  const plannerAgent = { run: vi.fn() };
  const planReviewerAgent = { run: vi.fn() };
  const planReviserAgent = { run: vi.fn() };

  return {
    deps: {
      runRepo,
      artifactRepo,
      eventRepo,
      linearClient,
      githubClient,
      gitService,
      repoRegistry,
      linearSync,
      githubSync,
      plannerAgent,
      planReviewerAgent,
      planReviserAgent,
      executorAgent,
      reviewerAgent,
      remediationAgent,
      logger,
      dashboardEmitter,
      ...overrides,
    },
    runRepo,
    artifactRepo,
    eventRepo,
    linearClient,
    githubClient,
    gitService,
    githubSync,
    executorAgent,
    reviewerAgent,
    remediationAgent,
  };
}

describe("OrchestratorService.runExecution", () => {
  it("runs the executor, transitions to AIReview, and chains into an approved code review through to ReadyForHumanReview", async () => {
    const { deps, runRepo, githubSync, executorAgent, reviewerAgent } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    const run = await svc.runExecution("run-1");

    expect(executorAgent.run).toHaveBeenCalled();
    expect(reviewerAgent.run).toHaveBeenCalled();
    expect(githubSync.postReviewFindings).not.toHaveBeenCalled(); // no findings, approved verdict
    expect(run.state).toBe(RunState.ReadyForHumanReview);
    expect(runRepo.getCurrent().prNumber).toBe(42);
    expect(runRepo.getCurrent().executorRuntime).toBe("claude-code");
  });

  it("rejects execution when the run is not in the Implementing state", async () => {
    const { deps } = buildDeps({ state: RunState.Todo });
    const svc = new OrchestratorService(deps as never);

    await expect(svc.runExecution("run-1")).rejects.toThrow(PolicyViolationError);
  });

  it("rejects execution when the plan version does not match the approved plan version", async () => {
    const { deps } = buildDeps({ approvedPlanVersion: 2 });
    const svc = new OrchestratorService(deps as never);

    await expect(svc.runExecution("run-1")).rejects.toThrow(/version mismatch/);
  });

  it("blocks the run and posts a comment when the executor times out, without throwing", async () => {
    const { deps, linearClient, eventRepo } = buildDeps();
    (deps.executorAgent as { run: ReturnType<typeof vi.fn> }).run = vi
      .fn()
      .mockRejectedValue(new AgentTimeoutError("executor", 600_000));
    const svc = new OrchestratorService(deps as never);

    const run = await svc.runExecution("run-1");

    expect(run.state).toBe(RunState.AIBlocked);
    expect(linearClient.postComment).toHaveBeenCalledWith(
      "LIN-1",
      expect.stringContaining("timed out"),
    );
    expect(eventRepo.events.some((e) => e.eventType === "EXECUTION_TIMEOUT")).toBe(true);
  });

  it("re-throws non-timeout errors from the executor", async () => {
    const { deps } = buildDeps();
    (deps.executorAgent as { run: ReturnType<typeof vi.fn> }).run = vi
      .fn()
      .mockRejectedValue(new Error("boom"));
    const svc = new OrchestratorService(deps as never);

    await expect(svc.runExecution("run-1")).rejects.toThrow("boom");
  });

  it("recovers a stranded execution report without re-running the executor", async () => {
    const report = makeExecutionReport({ executionVersion: 1 });
    const { deps, artifactRepo, eventRepo, executorAgent } = buildDeps({
      prNumber: 42,
    });
    // Simulate: executor started, then produced a report, but EXECUTION_FINISHED
    // was never recorded (e.g. process crash). Timestamps are set explicitly
    // (rather than relying on wall-clock ordering of two fast `new Date()` calls)
    // so the recovery heuristic's ordering checks are deterministic.
    const startedAt = new Date("2024-01-01T00:00:00.000Z");
    const reportAt = new Date("2024-01-01T00:01:00.000Z");
    eventRepo.events.push({
      id: "evt-started",
      runId: "run-1",
      eventType: "EXECUTION_STARTED",
      source: "orchestrator",
      payloadJson: {},
      createdAt: startedAt,
    });
    artifactRepo.byType.set("ExecutionReport", {
      id: "a-exec-recover",
      runId: "run-1",
      type: "ExecutionReport",
      version: 1,
      payloadJson: report,
      rawText: "{}",
      createdAt: reportAt,
    });

    const svc = new OrchestratorService(deps as never);
    const run = await svc.runExecution("run-1");

    expect(executorAgent.run).not.toHaveBeenCalled();
    expect(run.state).toBe(RunState.ReadyForHumanReview);
    expect(
      eventRepo.events.some(
        (e) => e.eventType === "EXECUTION_FINISHED" && (e.payloadJson as { recovered?: boolean }).recovered,
      ),
    ).toBe(true);
  });
});

describe("OrchestratorService.runReview", () => {
  it("routes a changes_requested verdict into remediation and posts review findings to GitHub", async () => {
    const { deps, githubSync, remediationAgent } = buildDeps({
      state: RunState.AIReview,
      prNumber: 7,
    });
    const execReport = makeExecutionReport();
    (deps.artifactRepo as ReturnType<typeof makeArtifactRepoFake>).byType.set("ExecutionReport", {
      id: "a-exec",
      runId: "run-1",
      type: "ExecutionReport",
      version: 1,
      payloadJson: execReport,
      rawText: "{}",
      createdAt: new Date(),
    });
    (deps.reviewerAgent as { run: ReturnType<typeof vi.fn> }).run = vi.fn(async (_p, _e, _d, _b, runId) => {
      const review = makeReview({
        overallVerdict: "changes_requested",
        findings: [
          { id: "f1", severity: "important", type: "bug", file: "src/x.ts", title: "Bug", details: "..." },
        ],
      });
      await (deps.artifactRepo as ReturnType<typeof makeArtifactRepoFake>).create({
        runId,
        type: "Review",
        version: 1,
        payloadJson: review,
        rawText: "{}",
      });
      return review;
    });
    githubSync.postReviewFindings.mockResolvedValue(new Map([["f1", 123]]));

    const svc = new OrchestratorService(deps as never);

    // runReview -> runRemediation -> markReady chains synchronously; markReady
    // re-reads the latest "Review" artifact, which is still the changes_requested
    // one from above (remediation does not itself re-approve the review), so the
    // policy engine correctly refuses to mark the run ready. This documents the
    // orchestrator's actual current behavior rather than the intended happy path.
    await expect(svc.runReview("run-1")).rejects.toThrow(/must be "approved"/);

    expect(githubSync.postReviewFindings).toHaveBeenCalledWith(
      "test-repo",
      7,
      expect.any(Array),
      "changes_requested",
    );
    expect(remediationAgent.run).toHaveBeenCalled();
  });

  it("throws when reviewing without a PR", async () => {
    const { deps } = buildDeps({ state: RunState.AIReview, prNumber: null });
    (deps.artifactRepo as ReturnType<typeof makeArtifactRepoFake>).byType.set("ExecutionReport", {
      id: "a-exec",
      runId: "run-1",
      type: "ExecutionReport",
      version: 1,
      payloadJson: makeExecutionReport(),
      rawText: "{}",
      createdAt: new Date(),
    });
    const svc = new OrchestratorService(deps as never);

    await expect(svc.runReview("run-1")).rejects.toThrow(/without an existing PR/);
  });
});

describe("OrchestratorService.runRemediation", () => {
  function buildRemediationDeps() {
    const { deps, artifactRepo, githubSync, remediationAgent } = buildDeps({
      state: RunState.AddressingReview,
      prNumber: 7,
    });
    artifactRepo.byType.set("Review", {
      id: "a-review",
      runId: "run-1",
      type: "Review",
      version: 1,
      payloadJson: makeReview({
        overallVerdict: "changes_requested",
        findings: [
          { id: "f1", severity: "important", type: "bug", file: "src/x.ts", title: "Bug", details: "..." },
        ],
      }),
      rawText: "{}",
      createdAt: new Date(),
    });
    artifactRepo.byType.set("ExecutionReport", {
      id: "a-exec",
      runId: "run-1",
      type: "ExecutionReport",
      version: 1,
      payloadJson: makeExecutionReport(),
      rawText: "{}",
      createdAt: new Date(),
    });
    return { deps, artifactRepo, githubSync, remediationAgent };
  }

  it("commits remediation changes and posts comments, then refuses to mark ready because the review artifact is still changes_requested", async () => {
    const { deps, githubSync, remediationAgent } = buildRemediationDeps();
    const svc = new OrchestratorService(deps as never);

    // See the equivalent note in the runReview suite: markReady re-reads the
    // latest "Review" artifact, and remediation does not write an approved one.
    await expect(svc.runRemediation("run-1", { f1: 123 })).rejects.toThrow(/must be "approved"/);

    expect(remediationAgent.run).toHaveBeenCalled();
    expect(githubSync.postRemediationResolutions).toHaveBeenCalledWith(
      "test-repo",
      7,
      expect.any(Array),
      { f1: 123 },
    );
  });

  it("rejects remediation when the latest review is not changes_requested", async () => {
    const { deps, artifactRepo } = buildRemediationDeps();
    artifactRepo.byType.set("Review", {
      id: "a-review-2",
      runId: "run-1",
      type: "Review",
      version: 1,
      payloadJson: makeReview({ overallVerdict: "approved" }),
      rawText: "{}",
      createdAt: new Date(),
    });
    const svc = new OrchestratorService(deps as never);

    await expect(svc.runRemediation("run-1")).rejects.toThrow(PolicyViolationError);
  });
});

describe("OrchestratorService.markReady", () => {
  it("posts a completion comment when the PR, execution report, and review are all in a ready state", async () => {
    const { deps, artifactRepo, linearClient } = buildDeps({ state: RunState.AIReview, prNumber: 7 });
    artifactRepo.byType.set("Review", {
      id: "a-review",
      runId: "run-1",
      type: "Review",
      version: 1,
      payloadJson: makeReview({ overallVerdict: "approved" }),
      rawText: "{}",
      createdAt: new Date(),
    });
    artifactRepo.byType.set("ExecutionReport", {
      id: "a-exec",
      runId: "run-1",
      type: "ExecutionReport",
      version: 1,
      payloadJson: makeExecutionReport(),
      rawText: "{}",
      createdAt: new Date(),
    });
    const svc = new OrchestratorService(deps as never);

    const run = await svc.markReady("run-1");

    expect(run.id).toBe("run-1");
    expect(linearClient.postComment).toHaveBeenCalledWith(
      "LIN-1",
      expect.stringContaining("Ready for Human Review"),
    );
  });

  it("throws when checks are failing", async () => {
    const { deps, artifactRepo } = buildDeps({ state: RunState.AIReview, prNumber: 7 });
    artifactRepo.byType.set("Review", {
      id: "a-review",
      runId: "run-1",
      type: "Review",
      version: 1,
      payloadJson: makeReview({ overallVerdict: "approved" }),
      rawText: "{}",
      createdAt: new Date(),
    });
    artifactRepo.byType.set("ExecutionReport", {
      id: "a-exec",
      runId: "run-1",
      type: "ExecutionReport",
      version: 1,
      payloadJson: makeExecutionReport({
        checks: {
          lint: { status: "fail", details: "eslint error" },
          typecheck: { status: "pass", details: "" },
          tests: { status: "pass", details: "" },
        },
      }),
      rawText: "{}",
      createdAt: new Date(),
    });
    const svc = new OrchestratorService(deps as never);

    await expect(svc.markReady("run-1")).rejects.toThrow(/failing checks/);
  });

  it("throws when there are unresolved blocker findings", async () => {
    const { deps, artifactRepo } = buildDeps({ state: RunState.AIReview, prNumber: 7 });
    artifactRepo.byType.set("Review", {
      id: "a-review",
      runId: "run-1",
      type: "Review",
      version: 1,
      payloadJson: makeReview({
        overallVerdict: "approved",
        findings: [
          { id: "f1", severity: "blocker", type: "bug", file: "x.ts", title: "t", details: "d" },
        ],
      }),
      rawText: "{}",
      createdAt: new Date(),
    });
    artifactRepo.byType.set("ExecutionReport", {
      id: "a-exec",
      runId: "run-1",
      type: "ExecutionReport",
      version: 1,
      payloadJson: makeExecutionReport(),
      rawText: "{}",
      createdAt: new Date(),
    });
    const svc = new OrchestratorService(deps as never);

    await expect(svc.markReady("run-1")).rejects.toThrow(/unresolved blocker/);
  });
});

describe("OrchestratorService.approvePlan", () => {
  it("records the approved plan version and posts an approval comment including an operator note", async () => {
    const { deps, runRepo, linearClient } = buildDeps({ state: RunState.AwaitingPlanApproval });
    const svc = new OrchestratorService(deps as never);

    const run = await svc.approvePlan("run-1", { note: "Please keep it minimal" });

    expect(runRepo.getCurrent().approvedPlanVersion).toBe(1);
    expect(run.state).toBe(RunState.Implementing);
    expect(linearClient.postComment).toHaveBeenCalledWith(
      "LIN-1",
      expect.stringContaining("Please keep it minimal"),
    );
  });

  it("posts a plain approval comment when no operator note is given", async () => {
    const { deps, linearClient } = buildDeps({ state: RunState.AwaitingPlanApproval });
    const svc = new OrchestratorService(deps as never);

    await svc.approvePlan("run-1");

    expect(linearClient.postComment).toHaveBeenCalledWith(
      "LIN-1",
      "Plan v1 approved. Starting implementation...",
    );
  });

  it("throws when there is no plan artifact", async () => {
    const { deps, artifactRepo } = buildDeps({ state: RunState.AwaitingPlanApproval });
    artifactRepo.byType.delete("Plan");
    const svc = new OrchestratorService(deps as never);

    await expect(svc.approvePlan("run-1")).rejects.toThrow(/No plan artifact/);
  });
});
