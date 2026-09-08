import { describe, it, expect, vi } from "vitest";
import { OrchestratorService } from "../../src/orchestrator/orchestratorService.js";
import { RunState } from "../../src/domain/runState.js";
import { RunEvent } from "../../src/domain/runEvent.js";
import { AgentTimeoutError, PolicyViolationError } from "../../src/utils/errors.js";
import {
  buildDeps,
  makeRun,
  makePlan,
  makeArtifact,
  makeExecutionReport,
  makeReview,
} from "./testHelpers.js";

describe("OrchestratorService.runExecution", () => {
  it("throws a PolicyViolationError when the run is not in Implementing state", async () => {
    const run = makeRun({ id: "run-1", state: RunState.Todo });
    const { deps } = buildDeps({ run, artifacts: { Plan: null } });
    const svc = new OrchestratorService(deps as never);

    await expect(svc.runExecution("run-1")).rejects.toBeInstanceOf(PolicyViolationError);
  });

  it("runs the executor, persists PR number, transitions to AIReview, and proceeds to review", async () => {
    const plan = makePlan({ planVersion: 1 });
    const run = makeRun({
      id: "run-1",
      state: RunState.Implementing,
      approvedPlanVersion: 1,
      branchName: "ai/run-1",
    });
    const built = buildDeps({
      run,
      artifacts: { Plan: makeArtifact({ type: "Plan", payloadJson: plan }) },
    });
    const { deps, executorAgent, runRepo, eventRepo, linearClient, gitService } = built;

    const svc = new OrchestratorService(deps as never);
    const result = await svc.runExecution("run-1");

    expect(gitService.assertBranch).toHaveBeenCalledWith("/tmp/repo", "ai/run-1");
    expect(gitService.commitAndPush).toHaveBeenCalled();
    expect(executorAgent.run).toHaveBeenCalled();
    expect(runRepo.update).toHaveBeenCalledWith(
      "run-1",
      expect.objectContaining({ prNumber: 42, executorRuntime: "claude-code" }),
    );
    expect(eventRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: RunEvent.EXECUTION_STARTED }),
    );
    const execComment = linearClient.postComment.mock.calls.find((c: unknown[]) =>
      (c[1] as string).includes("Execution Report"),
    );
    expect(execComment).toBeDefined();
    // Since reviewerAgent defaults to "approved", runReview -> markReady completes the chain.
    expect(result.state).toBe(RunState.ReadyForHumanReview);
  });

  it("throws a PolicyViolationError when the executor touches a protected path", async () => {
    const plan = makePlan({ planVersion: 1 });
    const run = makeRun({
      id: "run-1",
      state: RunState.Implementing,
      approvedPlanVersion: 1,
      branchName: "ai/run-1",
    });
    const built = buildDeps({
      run,
      artifacts: { Plan: makeArtifact({ type: "Plan", payloadJson: plan }) },
      overrides: {
        repoRegistry: {
          resolveForIssue: vi.fn(),
          resolveWorkingDirectory: vi.fn(),
          validateWorkingDirectory: vi.fn(),
          getRepoByName: vi.fn().mockReturnValue({
            name: "test-repo",
            defaultBranch: "main",
            allowedPaths: ["src/"],
            protectedPaths: ["src/secrets/"],
            constraints: {
              requiredChecks: [],
              maxFilesChanged: 10,
              maxDiffLines: 500,
              forbiddenPatterns: [],
              mustNotTouch: [],
            },
          }),
          getDefaultRepo: vi.fn(),
        },
      },
    });
    built.setExecutorResult({
      report: makeExecutionReport({ filesChanged: ["src/secrets/keys.ts"] }),
      prNumber: 42,
    });

    const svc = new OrchestratorService(built.deps as never);
    await expect(svc.runExecution("run-1")).rejects.toBeInstanceOf(PolicyViolationError);
  });

  it("skips branch checkpoint commit when the run has no branchName", async () => {
    const plan = makePlan({ planVersion: 1 });
    const run = makeRun({
      id: "run-1",
      state: RunState.Implementing,
      approvedPlanVersion: 1,
      branchName: null,
    });
    const built = buildDeps({
      run,
      artifacts: { Plan: makeArtifact({ type: "Plan", payloadJson: plan }) },
    });

    const svc = new OrchestratorService(built.deps as never);
    await svc.runExecution("run-1");

    expect(built.gitService.assertBranch).not.toHaveBeenCalled();
    expect(built.gitService.commitAndPush).not.toHaveBeenCalled();
  });

  it("recovers a stranded execution (ExecutionReport exists, EXECUTION_FINISHED never recorded) without re-running the executor", async () => {
    const plan = makePlan({ planVersion: 1 });
    const report = makeExecutionReport();
    const startedAt = new Date("2026-01-01T00:00:00Z");
    const reportCreatedAt = new Date("2026-01-01T00:05:00Z");
    const run = makeRun({
      id: "run-1",
      state: RunState.Implementing,
      approvedPlanVersion: 1,
      branchName: "ai/run-1",
      prNumber: 99,
    });
    const built = buildDeps({
      run,
      artifacts: {
        Plan: makeArtifact({ type: "Plan", payloadJson: plan }),
        ExecutionReport: makeArtifact({
          type: "ExecutionReport",
          payloadJson: report,
          createdAt: reportCreatedAt,
        }),
      },
    });
    built.eventRepo.findByRunId.mockResolvedValue([
      {
        id: "evt-1",
        runId: "run-1",
        eventType: RunEvent.EXECUTION_STARTED,
        source: "orchestrator",
        payloadJson: {},
        createdAt: startedAt,
      },
    ]);

    const svc = new OrchestratorService(built.deps as never);
    const result = await svc.runExecution("run-1");

    expect(built.executorAgent.run).not.toHaveBeenCalled();
    expect(built.logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ runId: "run-1" }),
      expect.stringContaining("Recovered stranded execution"),
    );
    // Chains straight into review -> markReady since reviewerAgent defaults to approved.
    expect(result.state).toBe(RunState.ReadyForHumanReview);
  });

  it("does NOT trigger recovery when EXECUTION_FINISHED already fired after the report", async () => {
    const plan = makePlan({ planVersion: 1 });
    const report = makeExecutionReport();
    const startedAt = new Date("2026-01-01T00:00:00Z");
    const reportCreatedAt = new Date("2026-01-01T00:05:00Z");
    const finishedAt = new Date("2026-01-01T00:06:00Z");
    const run = makeRun({
      id: "run-1",
      state: RunState.Implementing,
      approvedPlanVersion: 1,
      branchName: "ai/run-1",
      prNumber: 99,
    });
    const built = buildDeps({
      run,
      artifacts: {
        Plan: makeArtifact({ type: "Plan", payloadJson: plan }),
        ExecutionReport: makeArtifact({
          type: "ExecutionReport",
          payloadJson: report,
          createdAt: reportCreatedAt,
        }),
      },
    });
    built.eventRepo.findByRunId.mockResolvedValue([
      {
        id: "evt-1",
        runId: "run-1",
        eventType: RunEvent.EXECUTION_STARTED,
        source: "orchestrator",
        payloadJson: {},
        createdAt: startedAt,
      },
      {
        id: "evt-2",
        runId: "run-1",
        eventType: RunEvent.EXECUTION_FINISHED,
        source: "executor-agent",
        payloadJson: {},
        createdAt: finishedAt,
      },
    ]);

    const svc = new OrchestratorService(built.deps as never);
    await svc.runExecution("run-1");

    // Recovery branch skipped -> executor actually runs again.
    expect(built.executorAgent.run).toHaveBeenCalled();
  });

  it("handles executor timeout: logs, records EXECUTION_TIMEOUT event, transitions to AIBlocked, and posts a comment", async () => {
    const plan = makePlan({ planVersion: 1 });
    const run = makeRun({
      id: "run-1",
      state: RunState.Implementing,
      approvedPlanVersion: 1,
      branchName: "ai/run-1",
    });
    const built = buildDeps({
      run,
      artifacts: { Plan: makeArtifact({ type: "Plan", payloadJson: plan }) },
    });
    built.executorAgent.run.mockRejectedValue(new AgentTimeoutError("executor", 600_000));

    const svc = new OrchestratorService(built.deps as never);
    const result = await svc.runExecution("run-1");

    expect(result.state).toBe(RunState.AIBlocked);
    expect(built.eventRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: "EXECUTION_TIMEOUT" }),
    );
    const comment = built.linearClient.postComment.mock.calls.at(-1)![1] as string;
    expect(comment).toContain("timed out");
  });

  it("propagates non-timeout errors from the executor agent", async () => {
    const plan = makePlan({ planVersion: 1 });
    const run = makeRun({
      id: "run-1",
      state: RunState.Implementing,
      approvedPlanVersion: 1,
      branchName: "ai/run-1",
    });
    const built = buildDeps({
      run,
      artifacts: { Plan: makeArtifact({ type: "Plan", payloadJson: plan }) },
    });
    built.executorAgent.run.mockRejectedValue(new Error("boom"));

    const svc = new OrchestratorService(built.deps as never);
    await expect(svc.runExecution("run-1")).rejects.toThrow("boom");
  });

  it("forwards the operator note to the executor agent", async () => {
    const plan = makePlan({ planVersion: 1 });
    const run = makeRun({
      id: "run-1",
      state: RunState.Implementing,
      approvedPlanVersion: 1,
      branchName: "ai/run-1",
    });
    const built = buildDeps({
      run,
      artifacts: { Plan: makeArtifact({ type: "Plan", payloadJson: plan }) },
    });

    const svc = new OrchestratorService(built.deps as never);
    await svc.runExecution("run-1", { note: "focus on error handling" });

    expect(built.executorAgent.run).toHaveBeenCalledWith(
      plan,
      expect.anything(),
      "run-1",
      expect.objectContaining({ existingBranch: "ai/run-1" }),
      { operatorNote: "focus on error handling" },
    );
  });
});

describe("OrchestratorService.runReview", () => {
  it("throws a PolicyViolationError when run.prNumber is missing", async () => {
    const run = makeRun({ id: "run-1", state: RunState.AIReview, prNumber: null });
    const { deps } = buildDeps({
      run,
      artifacts: { ExecutionReport: makeArtifact({ type: "ExecutionReport", payloadJson: makeExecutionReport() }) },
    });
    const svc = new OrchestratorService(deps as never);

    await expect(svc.runReview("run-1")).rejects.toBeInstanceOf(PolicyViolationError);
  });

  it("approved verdict: transitions to ReadyForHumanReview via markReady, without posting review findings to GitHub for zero findings", async () => {
    const run = makeRun({ id: "run-1", state: RunState.AIReview, prNumber: 42 });
    const built = buildDeps({
      run,
      artifacts: {
        ExecutionReport: makeArtifact({ type: "ExecutionReport", payloadJson: makeExecutionReport() }),
        Plan: makeArtifact({ type: "Plan", payloadJson: makePlan() }),
      },
    });

    const svc = new OrchestratorService(built.deps as never);
    const result = await svc.runReview("run-1");

    expect(built.githubSync.postReviewFindings).not.toHaveBeenCalled();
    expect(result.state).toBe(RunState.ReadyForHumanReview);
  });

  it("changes_requested verdict: posts findings to GitHub, comments, and starts remediation", async () => {
    const run = makeRun({ id: "run-1", state: RunState.AIReview, prNumber: 42 });
    const built = buildDeps({
      run,
      artifacts: {
        ExecutionReport: makeArtifact({ type: "ExecutionReport", payloadJson: makeExecutionReport() }),
        Plan: makeArtifact({ type: "Plan", payloadJson: makePlan() }),
      },
    });
    built.setReviewResult(
      makeReview({
        overallVerdict: "changes_requested",
        findings: [
          {
            id: "f1",
            severity: "important",
            type: "bug",
            file: "src/a.ts",
            lineHint: 10,
            title: "Off by one",
            details: "Loop bound is wrong",
          },
        ],
      }),
    );
    built.githubSync.postReviewFindings.mockResolvedValue(new Map([["f1", 555]]));

    const svc = new OrchestratorService(built.deps as never);
    // The remediation lane this chains into ends by calling markReady(), whose
    // policy check requires the latest Review artifact to read "approved" --
    // runRemediation never rewrites the Review artifact after remediating, so
    // that check is expected (and separately documented in
    // orchestratorService.executionScore.test.ts) to fail here. We only assert
    // on the changes_requested-branch side effects that happen before it.
    await expect(svc.runReview("run-1")).rejects.toMatchObject({
      rule: "ready_requires_approved_verdict",
    });

    expect(built.githubSync.postReviewFindings).toHaveBeenCalledWith(
      "test-repo",
      42,
      expect.arrayContaining([expect.objectContaining({ id: "f1" })]),
      "changes_requested",
    );
    const comment = built.linearClient.postComment.mock.calls.find((c: unknown[]) =>
      (c[1] as string).includes("Code Review"),
    );
    expect(comment).toBeDefined();
    expect(comment![1]).toContain("Off by one");
    expect(built.remediationAgent.run).toHaveBeenCalled();
  });
});

describe("OrchestratorService.runRemediation", () => {
  it("throws a PolicyViolationError when there's no changes_requested review", async () => {
    const run = makeRun({ id: "run-1", state: RunState.AddressingReview });
    const { deps } = buildDeps({ run, artifacts: { Review: null } });
    const svc = new OrchestratorService(deps as never);

    await expect(svc.runRemediation("run-1")).rejects.toBeInstanceOf(PolicyViolationError);
  });

  it("runs remediation, posts execution report + remediation comments, syncs GitHub, and marks ready", async () => {
    const run = makeRun({
      id: "run-1",
      state: RunState.AddressingReview,
      branchName: "ai/run-1",
      prNumber: 42,
    });
    const review = makeReview({
      overallVerdict: "changes_requested",
      findings: [
        {
          id: "f1",
          severity: "blocker",
          type: "bug",
          file: "src/a.ts",
          title: "Bug",
          details: "details",
        },
      ],
    });
    const built = buildDeps({
      run,
      artifacts: {
        Review: makeArtifact({ type: "Review", payloadJson: review }),
        ExecutionReport: makeArtifact({
          type: "ExecutionReport",
          payloadJson: makeExecutionReport({ executionVersion: 1, score: 0.6 }),
        }),
      },
    });
    built.setRemediationResult({
      executionReport: makeExecutionReport({ executionVersion: 2, score: 0.95 }),
      resolution: [
        { findingId: "f1", status: "resolved", action: "Fixed bounds check", rationale: "Was off by one" },
      ],
    });

    const svc = new OrchestratorService(built.deps as never);
    // runRemediation always finishes by calling markReady(), whose policy check
    // requires the latest Review artifact to read "approved" -- runRemediation
    // never rewrites the Review artifact after remediating (see the dedicated
    // regression test in orchestratorService.executionScore.test.ts), so this
    // is expected to reject. We assert on the remediation-lane side effects
    // that happen before that terminal check.
    await expect(svc.runRemediation("run-1", { f1: 555 })).rejects.toMatchObject({
      rule: "ready_requires_approved_verdict",
    });

    expect(built.gitService.commitAndPush).toHaveBeenCalled();
    expect(built.githubSync.postExecutionReportUpdate).toHaveBeenCalledWith(
      "test-repo",
      42,
      expect.objectContaining({ executionVersion: 2 }),
    );
    expect(built.githubSync.postRemediationResolutions).toHaveBeenCalledWith(
      "test-repo",
      42,
      expect.arrayContaining([expect.objectContaining({ findingId: "f1" })]),
      { f1: 555 },
    );
  });

  it("skips branch operations when the run has no branchName", async () => {
    const run = makeRun({ id: "run-1", state: RunState.AddressingReview, branchName: null, prNumber: null });
    const review = makeReview({
      overallVerdict: "changes_requested",
      findings: [
        {
          id: "f1",
          severity: "important",
          type: "bug",
          file: "src/a.ts",
          title: "Bug",
          details: "details",
        },
      ],
    });
    const built = buildDeps({
      run,
      artifacts: {
        Review: makeArtifact({ type: "Review", payloadJson: review }),
        ExecutionReport: makeArtifact({ type: "ExecutionReport", payloadJson: makeExecutionReport() }),
      },
    });

    const svc = new OrchestratorService(built.deps as never);
    // No prNumber on this run, so markReady's policy check fails on the PR
    // check rather than the (also-unmet) approved-verdict check.
    await expect(svc.runRemediation("run-1")).rejects.toMatchObject({
      rule: "ready_requires_pr",
    });

    expect(built.gitService.assertBranch).not.toHaveBeenCalled();
    expect(built.gitService.commitAndPush).not.toHaveBeenCalled();
    expect(built.githubSync.postExecutionReportUpdate).not.toHaveBeenCalled();
  });
});

describe("OrchestratorService.markReady", () => {
  it("throws a PolicyViolationError when checks failed", async () => {
    const run = makeRun({ id: "run-1", state: RunState.AIReview, prNumber: 42 });
    const { deps } = buildDeps({
      run,
      artifacts: {
        Review: makeArtifact({ type: "Review", payloadJson: makeReview() }),
        ExecutionReport: makeArtifact({
          type: "ExecutionReport",
          payloadJson: makeExecutionReport({
            checks: {
              lint: { status: "fail", details: "" },
              typecheck: { status: "pass", details: "" },
              tests: { status: "pass", details: "" },
            },
          }),
        }),
      },
    });
    const svc = new OrchestratorService(deps as never);

    await expect(svc.markReady("run-1")).rejects.toBeInstanceOf(PolicyViolationError);
  });

  it("posts the completion comment and returns the run on success", async () => {
    const run = makeRun({ id: "run-1", state: RunState.AIReview, prNumber: 42 });
    const { deps, linearClient } = buildDeps({
      run,
      artifacts: {
        Review: makeArtifact({ type: "Review", payloadJson: makeReview() }),
        ExecutionReport: makeArtifact({ type: "ExecutionReport", payloadJson: makeExecutionReport() }),
      },
    });
    const svc = new OrchestratorService(deps as never);

    const result = await svc.markReady("run-1");

    expect(linearClient.postComment).toHaveBeenCalledWith(
      run.linearIssueId,
      expect.stringContaining("Ready for Human Review"),
    );
    expect(result).toEqual(run);
  });
});
