import { describe, it, expect } from "vitest";
import { RunState } from "../../src/domain/runState.js";
import { RunEvent } from "../../src/domain/runEvent.js";
import { AgentTimeoutError, PolicyViolationError } from "../../src/utils/errors.js";
import type { TaskBundle } from "../../src/schemas/taskBundle.js";
import {
  createHarness,
  makeExecutionReport,
  makePlan,
  makeRun,
  type HarnessOptions,
} from "./helpers/orchestratorHarness.js";

const READY_COMMENT = "AI workflow complete. Issue marked as **Ready for Human Review**.";

function implementingHarness(overrides: Partial<HarnessOptions> = {}) {
  return createHarness({
    run: makeRun({ state: RunState.Implementing, planVersion: 2, approvedPlanVersion: 2 }),
    artifacts: [{ type: "Plan", version: 2, payloadJson: makePlan({ planVersion: 2 }) }],
    ...overrides,
  });
}

async function expectPolicyRule(p: Promise<unknown>, rule: string): Promise<void> {
  const err = await p.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(PolicyViolationError);
  expect((err as PolicyViolationError).rule).toBe(rule);
}

describe("OrchestratorService.runExecution -- policy guard rails", () => {
  it("rejects when the run is not Implementing", async () => {
    const h = implementingHarness({
      run: makeRun({ state: RunState.AwaitingPlanApproval, approvedPlanVersion: 2 }),
    });
    await expectPolicyRule(h.svc.runExecution("run-1"), "execute_requires_implementing_state");
    expect(h.executorAgent.run).not.toHaveBeenCalled();
    expect(h.gitService.commitAndPush).not.toHaveBeenCalled();
  });

  it("rejects without an explicit plan approval", async () => {
    const h = implementingHarness({
      run: makeRun({ state: RunState.Implementing, approvedPlanVersion: null }),
    });
    await expectPolicyRule(h.svc.runExecution("run-1"), "execute_requires_explicit_approval");
    expect(h.executorAgent.run).not.toHaveBeenCalled();
  });

  it("rejects without a plan artifact", async () => {
    const h = implementingHarness({ artifacts: [] });
    await expectPolicyRule(h.svc.runExecution("run-1"), "execute_requires_plan_artifact");
    expect(h.executorAgent.run).not.toHaveBeenCalled();
  });

  it("rejects when the latest plan is not the approved version", async () => {
    const h = implementingHarness({
      artifacts: [
        { type: "Plan", version: 2, payloadJson: makePlan({ planVersion: 2 }) },
        { type: "Plan", version: 3, payloadJson: makePlan({ planVersion: 3 }) },
      ],
    });
    await expectPolicyRule(h.svc.runExecution("run-1"), "execute_plan_version_mismatch");
    expect(h.executorAgent.run).not.toHaveBeenCalled();
    expect(h.eventRepo.create).not.toHaveBeenCalled();
  });
});

describe("OrchestratorService.runExecution -- happy path", () => {
  it("checkpoints the branch, executes, reviews and marks the run ready", async () => {
    const h = implementingHarness({
      config: {
        executionReport: makeExecutionReport({
          filesChanged: ["src/a.ts", "src/b.ts"],
          notes: ["Refactored helper", "Added docs"],
          checks: {
            lint: { status: "pass", details: "clean" },
            typecheck: { status: "pass", details: "ok" },
            tests: { status: "skip", details: "no tests configured" },
          },
          score: 0.83,
          scoreRationale: "Good coverage",
        }),
        prNumber: 77,
      },
    });

    const run = await h.svc.runExecution("run-1");

    expect(h.gitService.assertBranch).toHaveBeenCalledWith(
      "/repos/test-repo/.worktrees/run-1",
      "ai/run-1",
    );
    expect(h.gitService.commitAndPush).toHaveBeenCalledWith(
      "/repos/test-repo/.worktrees/run-1",
      "ai/run-1",
      "[AI] WIP: checkpoint before executor run",
    );

    // Executor receives the approved plan, the bundle and retry context.
    expect(h.executorAgent.run).toHaveBeenCalledTimes(1);
    const [plan, bundle, runId, retry, execOpts] = h.executorAgent.run.mock.calls[0]!;
    expect((plan as { planVersion: number }).planVersion).toBe(2);
    expect((bundle as TaskBundle).repo.workingBranch).toBe("ai/run-1");
    expect(runId).toBe("run-1");
    expect(retry).toEqual({ existingBranch: "ai/run-1", existingPR: null });
    expect(execOpts).toBeUndefined();

    expect(h.runRepo.update).toHaveBeenCalledWith("run-1", {
      prNumber: 77,
      executorRuntime: "claude-code",
    });

    expect(h.recordedEventTypes()).toEqual([
      RunEvent.EXECUTION_STARTED,
      RunEvent.EXECUTION_FINISHED,
      RunEvent.REVIEW_APPROVED,
    ]);
    expect(h.recordedEvent(RunEvent.EXECUTION_STARTED)?.source).toBe("orchestrator");

    // Review stage fetched the diff for the new PR.
    expect(h.githubClient.getPRDiff).toHaveBeenCalledWith("test-repo", 77);
    expect(h.store.run?.reviewerRuntime).toBe("codex");
    // No findings -> nothing posted to the PR.
    expect(h.githubSync.postReviewFindings).not.toHaveBeenCalled();

    expect(run.state).toBe(RunState.ReadyForHumanReview);

    const [reportComment, readyComment] = h.comments();
    expect(reportComment).toBe(
      [
        "## Execution Report (v1) -- Score: 83%",
        "",
        "*Good coverage*",
        "",
        "Implemented the feature",
        "",
        "### Checks",
        "- :white_check_mark: **Lint** -- clean\n" +
          "- :white_check_mark: **Typecheck** -- ok\n" +
          "- :heavy_minus_sign: **Tests** -- no tests configured",
        "\n### Files changed (2)\n- `src/a.ts`\n- `src/b.ts`",
        "\n### Notes\n- Refactored helper\n- Added docs",
      ].join("\n"),
    );
    expect(readyComment).toBe(READY_COMMENT);
  });

  it("skips git checkpointing when the run has no branch and forwards the operator note", async () => {
    const h = implementingHarness({
      run: makeRun({
        state: RunState.Implementing,
        planVersion: 2,
        approvedPlanVersion: 2,
        branchName: null,
      }),
    });

    await h.svc.runExecution("run-1", { note: "avoid touching the API" });

    expect(h.gitService.assertBranch).not.toHaveBeenCalled();
    expect(h.gitService.commitAndPush).not.toHaveBeenCalled();
    const [, , , retry, execOpts] = h.executorAgent.run.mock.calls[0]!;
    expect(retry).toEqual({ existingBranch: null, existingPR: null });
    expect(execOpts).toEqual({ operatorNote: "avoid touching the API" });
  });

  it("collapses a long file list into a <details> block and omits empty sections", async () => {
    const files = Array.from({ length: 9 }, (_, i) => `src/f${i}.ts`);
    const h = implementingHarness({
      config: { executionReport: makeExecutionReport({ filesChanged: files, notes: [] }) },
    });

    await h.svc.runExecution("run-1");

    const reportComment = h.comments()[0] ?? "";
    expect(reportComment).toContain("<details>");
    expect(reportComment).toContain("<summary><strong>Files changed (9)</strong></summary>");
    expect(reportComment).toContain("- `src/f8.ts`");
    expect(reportComment).not.toContain("### Files changed");
    expect(reportComment).not.toContain("### Notes");
  });

  it("omits the files section entirely when nothing changed", async () => {
    const h = implementingHarness({
      config: { executionReport: makeExecutionReport({ filesChanged: [] }) },
    });

    await h.svc.runExecution("run-1");

    const reportComment = h.comments()[0] ?? "";
    expect(reportComment).not.toContain("Files changed");
    expect(reportComment).not.toContain("<details>");
  });
});

describe("OrchestratorService.runExecution -- failure paths", () => {
  it("blocks the run and notifies Linear when the executor times out", async () => {
    const h = implementingHarness();
    h.executorAgent.run.mockRejectedValue(new AgentTimeoutError("executor", 1_800_000));

    const run = await h.svc.runExecution("run-1");

    expect(run.state).toBe(RunState.AIBlocked);
    expect(h.recordedEventTypes()).toEqual([
      RunEvent.EXECUTION_STARTED,
      "EXECUTION_TIMEOUT",
      RunEvent.BLOCKED,
    ]);
    expect(h.recordedEvent("EXECUTION_TIMEOUT")?.payloadJson).toEqual({
      agent: "executor",
      timeoutMs: 1_800_000,
    });
    expect(h.recordedEvent(RunEvent.BLOCKED)?.payloadJson).toEqual({
      from: RunState.Implementing,
      to: RunState.AIBlocked,
      reason: "Executor timed out after 30m. Increase EXECUTOR_TIMEOUT_MS or retry.",
    });
    expect(h.comments()).toEqual([
      "Executor timed out after 30 minutes. The run has been paused — use the dashboard retry button or increase `EXECUTOR_TIMEOUT_MS` and retry.",
    ]);
    expect(h.reviewerAgent.run).not.toHaveBeenCalled();
    expect(h.store.run?.prNumber).toBeNull();
  });

  it("rethrows non-timeout executor errors without finishing execution", async () => {
    const h = implementingHarness();
    h.executorAgent.run.mockRejectedValue(new Error("claude exited with code 1"));

    await expect(h.svc.runExecution("run-1")).rejects.toThrow("claude exited with code 1");
    expect(h.recordedEventTypes()).toEqual([RunEvent.EXECUTION_STARTED]);
    expect(h.store.run?.state).toBe(RunState.Implementing);
    expect(h.linearClient.postComment).not.toHaveBeenCalled();
  });

  it("propagates a failed pre-execution checkpoint before the executor starts", async () => {
    const h = implementingHarness();
    h.gitService.assertBranch.mockRejectedValue(new Error("worktree on wrong branch: main"));

    await expect(h.svc.runExecution("run-1")).rejects.toThrow("worktree on wrong branch");
    expect(h.gitService.commitAndPush).not.toHaveBeenCalled();
    expect(h.executorAgent.run).not.toHaveBeenCalled();
    expect(h.eventRepo.create).not.toHaveBeenCalled();
  });

  it("rejects executor output that touches protected paths, after persisting the PR number", async () => {
    const h = implementingHarness({
      config: {
        executionReport: makeExecutionReport({ filesChanged: ["src/ok.ts", "infra/prod.tf"] }),
        prNumber: 55,
      },
    });

    await expectPolicyRule(h.svc.runExecution("run-1"), "executor_touched_protected_path");
    // The PR exists on GitHub so the number is retained for recovery.
    expect(h.store.run?.prNumber).toBe(55);
    expect(h.recordedEventTypes()).not.toContain(RunEvent.EXECUTION_FINISHED);
    expect(h.store.run?.state).toBe(RunState.Implementing);
    expect(h.reviewerAgent.run).not.toHaveBeenCalled();
  });

  it("rejects executor output that exceeds maxFilesChanged", async () => {
    const files = Array.from({ length: 11 }, (_, i) => `src/f${i}.ts`);
    const h = implementingHarness({
      config: { executionReport: makeExecutionReport({ filesChanged: files }) },
    });

    await expectPolicyRule(h.svc.runExecution("run-1"), "executor_exceeded_max_files");
    expect(h.recordedEventTypes()).not.toContain(RunEvent.EXECUTION_FINISHED);
  });
});

describe("OrchestratorService.runExecution -- stranded execution recovery", () => {
  function recoveryHarness() {
    return createHarness({
      run: makeRun({
        state: RunState.Implementing,
        planVersion: 2,
        approvedPlanVersion: 2,
        prNumber: 99,
      }),
      artifacts: [{ type: "Plan", version: 2, payloadJson: makePlan({ planVersion: 2 }) }],
    });
  }

  it("skips the executor and proceeds to review when a report exists after the last start", async () => {
    const h = recoveryHarness();
    h.addEvent(RunEvent.EXECUTION_STARTED);
    const report = h.addArtifact("ExecutionReport", 1, makeExecutionReport());

    const run = await h.svc.runExecution("run-1");

    expect(h.executorAgent.run).not.toHaveBeenCalled();
    expect(h.gitService.commitAndPush).not.toHaveBeenCalled();
    expect(h.recordedEvent(RunEvent.EXECUTION_FINISHED)).toEqual({
      runId: "run-1",
      eventType: RunEvent.EXECUTION_FINISHED,
      source: "executor-agent",
      payloadJson: {
        from: RunState.Implementing,
        to: RunState.AIReview,
        recovered: true,
        reportCreatedAt: report.createdAt.toISOString(),
      },
    });
    expect(h.reviewerAgent.run).toHaveBeenCalledTimes(1);
    expect(h.githubClient.getPRDiff).toHaveBeenCalledWith("test-repo", 99);
    expect(run.state).toBe(RunState.ReadyForHumanReview);
  });

  it("recovers when a previous attempt finished before the latest start", async () => {
    const h = recoveryHarness();
    h.addEvent(RunEvent.EXECUTION_STARTED);
    h.addEvent(RunEvent.EXECUTION_FINISHED);
    h.addEvent(RunEvent.EXECUTION_STARTED);
    h.addArtifact("ExecutionReport", 2, makeExecutionReport({ executionVersion: 2 }));

    await h.svc.runExecution("run-1");

    expect(h.executorAgent.run).not.toHaveBeenCalled();
    expect(h.recordedEvent(RunEvent.EXECUTION_FINISHED)?.payloadJson).toMatchObject({
      recovered: true,
    });
  });

  it("re-runs the executor when the report predates the latest EXECUTION_STARTED", async () => {
    const h = recoveryHarness();
    h.addArtifact("ExecutionReport", 1, makeExecutionReport());
    h.addEvent(RunEvent.EXECUTION_STARTED);

    await h.svc.runExecution("run-1");

    expect(h.executorAgent.run).toHaveBeenCalledTimes(1);
    expect(h.executorAgent.run.mock.calls[0]?.[3]).toEqual({
      existingBranch: "ai/run-1",
      existingPR: 99,
    });
    expect(h.recordedEvent(RunEvent.EXECUTION_FINISHED)?.payloadJson).not.toHaveProperty(
      "recovered",
    );
  });

  it("re-runs the executor when EXECUTION_FINISHED was already recorded after the report", async () => {
    const h = recoveryHarness();
    h.addEvent(RunEvent.EXECUTION_STARTED);
    h.addArtifact("ExecutionReport", 1, makeExecutionReport());
    h.addEvent(RunEvent.EXECUTION_FINISHED);

    await h.svc.runExecution("run-1");

    expect(h.executorAgent.run).toHaveBeenCalledTimes(1);
  });

  it("re-runs the executor when no EXECUTION_STARTED event exists", async () => {
    const h = recoveryHarness();
    h.addArtifact("ExecutionReport", 1, makeExecutionReport());

    await h.svc.runExecution("run-1");

    expect(h.executorAgent.run).toHaveBeenCalledTimes(1);
  });

  it("does not consult events when a report exists but the run has no PR", async () => {
    const h = implementingHarness();
    h.addEvent(RunEvent.EXECUTION_STARTED);
    h.addArtifact("ExecutionReport", 1, makeExecutionReport());

    await h.svc.runExecution("run-1");

    expect(h.executorAgent.run).toHaveBeenCalledTimes(1);
    // Without a PR the recovery check is short-circuited before reading events.
    expect(h.eventRepo.findByRunId).not.toHaveBeenCalled();
    expect(h.recordedEvent(RunEvent.EXECUTION_FINISHED)?.payloadJson).not.toHaveProperty(
      "recovered",
    );
  });
});
