import { describe, it, expect } from "vitest";
import { RunState } from "../../src/domain/runState.js";
import { RunEvent } from "../../src/domain/runEvent.js";
import { AgentTimeoutError, PolicyViolationError } from "../../src/utils/errors.js";
import {
  createHarness,
  makeRun,
  makePlan,
  makeExecutionReport,
  makeReview,
  REPO_ENTRY,
} from "./orchestratorHarness.js";

function implementing(overrides: Parameters<typeof makeRun>[0] = {}) {
  const h = createHarness({
    run: makeRun({ state: RunState.Implementing, approvedPlanVersion: 1, ...overrides }),
  });
  h.addArtifact("Plan", makePlan({ planVersion: 1 }));
  return h;
}

describe("OrchestratorService.runExecution", () => {
  it("happy path: checkpoints branch, runs executor, records PR, reviews and marks ready", async () => {
    const h = implementing();

    const result = await h.svc.runExecution("run-1");

    expect(h.gitService.assertBranch).toHaveBeenCalledWith(
      "/repos/test-repo/.worktrees/run-1",
      "ai/run-1",
    );
    expect(h.gitService.commitAndPush).toHaveBeenCalledWith(
      "/repos/test-repo/.worktrees/run-1",
      "ai/run-1",
      "[AI] WIP: checkpoint before executor run",
    );
    const execArgs = h.executorAgent.run.mock.calls[0] as unknown[];
    expect(execArgs[2]).toBe("run-1");
    expect(execArgs[3]).toEqual({ existingBranch: "ai/run-1", existingPR: null });
    expect(execArgs[4]).toBeUndefined();

    expect(h.eventTypes()).toEqual([
      RunEvent.EXECUTION_STARTED,
      RunEvent.EXECUTION_FINISHED,
      RunEvent.REVIEW_APPROVED,
    ]);
    expect(h.currentRun().prNumber).toBe(77);
    expect(h.currentRun().executorRuntime).toBe("claude-code");
    expect(h.currentRun().reviewerRuntime).toBe("codex");
    expect(result.state).toBe(RunState.ReadyForHumanReview);

    // Reviewer got the PR diff; approved with no findings -> nothing posted to GitHub
    expect(h.githubClient.getPRDiff).toHaveBeenCalledWith("test-repo", 77);
    expect(h.reviewerAgent.run.mock.calls[0]![2]).toContain("diff --git");
    expect(h.githubSync.postReviewFindings).not.toHaveBeenCalled();

    const bodies = h.state.comments.map((c) => c.body);
    expect(bodies[0]).toContain("## Execution Report (v1) -- Score: 90%");
    expect(bodies.at(-1)).toBe("AI workflow complete. Issue marked as **Ready for Human Review**.");
  });

  it("skips git checkpointing when the run has no branch and forwards the operator note", async () => {
    const h = implementing({ branchName: null });
    await h.svc.runExecution("run-1", { note: "be careful" });
    expect(h.gitService.assertBranch).not.toHaveBeenCalled();
    expect(h.gitService.commitAndPush).not.toHaveBeenCalled();
    expect(h.executorAgent.run.mock.calls[0]![4]).toEqual({ operatorNote: "be careful" });
  });

  it("refuses to execute an unapproved plan version and never invokes the executor", async () => {
    const h = createHarness({
      run: makeRun({ state: RunState.Implementing, approvedPlanVersion: 1 }),
    });
    h.addArtifact("Plan", makePlan({ planVersion: 2 }), 2);
    await expect(h.svc.runExecution("run-1")).rejects.toMatchObject({
      rule: "execute_plan_version_mismatch",
    });
    expect(h.executorAgent.run).not.toHaveBeenCalled();
    expect(h.state.events).toHaveLength(0);
  });

  it("refuses to execute without any plan artifact", async () => {
    const h = createHarness({
      run: makeRun({ state: RunState.Implementing, approvedPlanVersion: 1 }),
    });
    await expect(h.svc.runExecution("run-1")).rejects.toMatchObject({
      rule: "execute_requires_plan_artifact",
    });
  });

  it("blocks the run and reports minutes on executor timeout", async () => {
    const h = implementing();
    h.executorAgent.run.mockRejectedValueOnce(new AgentTimeoutError("executor", 150_000));

    const result = await h.svc.runExecution("run-1");

    expect(result.state).toBe(RunState.AIBlocked);
    expect(h.eventTypes()).toEqual([
      RunEvent.EXECUTION_STARTED,
      "EXECUTION_TIMEOUT",
      RunEvent.BLOCKED,
    ]);
    expect(h.state.events[1]!.payloadJson).toEqual({ agent: "executor", timeoutMs: 150_000 });
    // 150s rounds to 3 minutes
    expect(h.state.events[2]!.payloadJson).toMatchObject({
      reason: "Executor timed out after 3m. Increase EXECUTOR_TIMEOUT_MS or retry.",
    });
    expect(h.state.comments.at(-1)!.body).toContain("Executor timed out after 3 minutes.");
    expect(h.logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ runId: "run-1", timeoutMs: 150_000, agent: "executor" }),
      "Executor agent timed out",
    );
    expect(h.reviewerAgent.run).not.toHaveBeenCalled();
  });

  it("rethrows non-timeout executor failures without changing state", async () => {
    const h = implementing();
    h.executorAgent.run.mockRejectedValueOnce(new Error("claude crashed"));
    await expect(h.svc.runExecution("run-1")).rejects.toThrow("claude crashed");
    expect(h.currentRun().state).toBe(RunState.Implementing);
    expect(h.eventTypes()).toEqual([RunEvent.EXECUTION_STARTED]);
  });

  it("rejects executor output that touched a protected path (PR number is still recorded)", async () => {
    const h = implementing();
    h.executorAgent.run.mockImplementationOnce(async () => ({
      report: makeExecutionReport({ filesChanged: [".github/workflows/ci.yml"] }),
      prNumber: 88,
    }));
    const err = await h.svc.runExecution("run-1").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PolicyViolationError);
    expect((err as PolicyViolationError).rule).toBe("executor_touched_protected_path");
    expect(h.currentRun().prNumber).toBe(88);
    expect(h.currentRun().state).toBe(RunState.Implementing);
    expect(h.eventTypes()).not.toContain(RunEvent.EXECUTION_FINISHED);
  });

  describe("stranded-execution recovery", () => {
    it("skips the executor when a report exists after the last start with no finish", async () => {
      const h = implementing({ prNumber: 42 });
      h.addEvent(RunEvent.EXECUTION_STARTED);
      const report = h.addArtifact("ExecutionReport", makeExecutionReport());

      const result = await h.svc.runExecution("run-1");

      expect(h.executorAgent.run).not.toHaveBeenCalled();
      expect(h.gitService.commitAndPush).not.toHaveBeenCalled();
      const finished = h.state.events.find((e) => e.eventType === RunEvent.EXECUTION_FINISHED)!;
      expect(finished.payloadJson).toMatchObject({
        recovered: true,
        reportCreatedAt: report.createdAt.toISOString(),
      });
      expect(h.logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ runId: "run-1", prNumber: 42 }),
        expect.stringContaining("Recovered stranded execution"),
      );
      expect(result.state).toBe(RunState.ReadyForHumanReview);
    });

    it("recovers when the last finish predates the report (second attempt stranded)", async () => {
      const h = implementing({ prNumber: 42 });
      h.addEvent(RunEvent.EXECUTION_STARTED);
      h.addEvent(RunEvent.EXECUTION_FINISHED);
      h.addEvent(RunEvent.EXECUTION_STARTED);
      h.addArtifact("ExecutionReport", makeExecutionReport());
      await h.svc.runExecution("run-1");
      expect(h.executorAgent.run).not.toHaveBeenCalled();
    });

    it("re-runs the executor when the report predates the last start", async () => {
      const h = implementing({ prNumber: 42 });
      h.addArtifact("ExecutionReport", makeExecutionReport());
      h.addEvent(RunEvent.EXECUTION_STARTED);
      await h.svc.runExecution("run-1");
      expect(h.executorAgent.run).toHaveBeenCalledTimes(1);
      expect(h.executorAgent.run.mock.calls[0]![3]).toEqual({
        existingBranch: "ai/run-1",
        existingPR: 42,
      });
    });

    it("re-runs the executor when a finish was recorded after the report", async () => {
      const h = implementing({ prNumber: 42 });
      h.addEvent(RunEvent.EXECUTION_STARTED);
      h.addArtifact("ExecutionReport", makeExecutionReport());
      h.addEvent(RunEvent.EXECUTION_FINISHED);
      await h.svc.runExecution("run-1");
      expect(h.executorAgent.run).toHaveBeenCalledTimes(1);
    });

    it("re-runs the executor when there is no EXECUTION_STARTED event at all", async () => {
      const h = implementing({ prNumber: 42 });
      h.addArtifact("ExecutionReport", makeExecutionReport());
      await h.svc.runExecution("run-1");
      expect(h.executorAgent.run).toHaveBeenCalledTimes(1);
    });

    it("does not inspect events when the report exists but no PR was recorded", async () => {
      const h = implementing({ prNumber: null });
      h.addEvent(RunEvent.EXECUTION_STARTED);
      h.addArtifact("ExecutionReport", makeExecutionReport());
      await h.svc.runExecution("run-1");
      expect(h.executorAgent.run).toHaveBeenCalledTimes(1);
    });
  });
});

describe("OrchestratorService.runReview -> runRemediation", () => {
  const findings = [
    {
      id: "f1",
      severity: "important" as const,
      type: "bug",
      file: "src/widget.ts",
      lineHint: 12,
      title: "Off by one",
      details: "Loop bound",
    },
    {
      id: "f2",
      severity: "nit" as const,
      type: "style",
      file: "src/util.ts",
      title: "Naming",
      details: "Rename x",
    },
  ];

  function inReview(overrides: Parameters<typeof makeRun>[0] = {}) {
    const h = createHarness({
      run: makeRun({ state: RunState.AIReview, prNumber: 42, approvedPlanVersion: 1, ...overrides }),
    });
    h.addArtifact("Plan", makePlan());
    h.addArtifact("ExecutionReport", makeExecutionReport({ score: 0.6 }));
    h.reviewerAgent.run.mockImplementation(async () => {
      const r = makeReview({ overallVerdict: "changes_requested", summary: "Needs work", findings });
      h.addArtifact("Review", r);
      return r;
    });
    return h;
  }

  it("changes requested: posts findings to the PR, remediates, pushes and syncs resolutions with the comment map", async () => {
    const h = inReview();

    const err = await h.svc.runReview("run-1").catch((e: unknown) => e);

    // Pre-existing behaviour: remediation does not produce a fresh approved
    // Review, so the final markReady refuses on the verdict check. The v2
    // (green) execution report is read, so the green-checks rule passes first.
    expect(err).toBeInstanceOf(PolicyViolationError);
    expect((err as PolicyViolationError).rule).toBe("ready_requires_approved_verdict");

    expect(h.githubSync.postReviewFindings).toHaveBeenCalledWith(
      "test-repo",
      42,
      findings,
      "changes_requested",
    );
    expect(h.eventTypes()).toEqual([
      RunEvent.REVIEW_CHANGES_REQUESTED,
      RunEvent.REMEDIATION_FINISHED,
      RunEvent.REVIEW_APPROVED,
    ]);
    expect(h.currentRun().state).toBe(RunState.ReadyForHumanReview);
    expect(h.currentRun().remediationRuntime).toBe("claude-code");

    expect(h.gitService.assertBranch).toHaveBeenCalledWith(
      "/repos/test-repo/.worktrees/run-1",
      "ai/run-1",
    );
    expect(h.gitService.commitAndPush).toHaveBeenCalledWith(
      "/repos/test-repo/.worktrees/run-1",
      "ai/run-1",
      "[AI] Remediation: address review findings",
    );

    // Remediation received the review + the v1 execution report
    const [reviewArg, reportArg, cwdArg] = h.remediationAgent.run.mock.calls[0] as unknown[];
    expect((reviewArg as { overallVerdict: string }).overallVerdict).toBe("changes_requested");
    expect((reportArg as { executionVersion: number }).executionVersion).toBe(1);
    expect(cwdArg).toBe("/repos/test-repo/.worktrees/run-1");

    expect(h.githubSync.postExecutionReportUpdate).toHaveBeenCalledWith(
      "test-repo",
      42,
      expect.objectContaining({ executionVersion: 2 }),
    );
    expect(h.githubSync.postRemediationResolutions).toHaveBeenCalledWith(
      "test-repo",
      42,
      [{ findingId: "f1", status: "accepted", action: "Fixed the bug", rationale: "Valid" }],
      { f1: 1001 },
    );

    const bodies = h.state.comments.map((c) => c.body);
    const reviewComment = bodies.find((b) => b.startsWith("## AI Code Review"))!;
    expect(reviewComment).toContain("## AI Code Review -- Changes Requested");
    expect(reviewComment).toContain("- **[IMPORTANT]** Off by one (src/widget.ts:12)\n  Loop bound");
    expect(reviewComment).toContain("- **[NIT]** Naming (src/util.ts)\n  Rename x");

    // Execution report v2 is posted before the remediation summary
    const execIdx = bodies.findIndex((b) => b.startsWith("## Execution Report (v2)"));
    const remIdx = bodies.findIndex((b) => b.startsWith("## Remediation Summary"));
    expect(execIdx).toBeGreaterThan(-1);
    expect(remIdx).toBe(execIdx + 1);
    expect(bodies[remIdx]).toContain(
      "**Implementation score (v2): 0.95 (95%)** -- Fixed",
    );
    expect(bodies[remIdx]).toContain("- **f1** [accepted]: Fixed the bug\n  *Rationale*: Valid");

    // Score delta is logged relative to the pre-remediation report
    const logCall = h.logger.info.mock.calls.find(
      (c) => c[1] === "Remediation complete, marking ready for human review",
    )!;
    expect(logCall[0]).toMatchObject({
      prevExecutionVersion: 1,
      newExecutionVersion: 2,
      prevScore: 0.6,
      newScore: 0.95,
    });
    expect((logCall[0] as { scoreDelta: number }).scoreDelta).toBeCloseTo(0.35);
  });

  it("approved review with findings still posts them to the PR, then marks ready", async () => {
    const h = inReview();
    h.reviewerAgent.run.mockImplementation(async () => {
      const r = makeReview({ overallVerdict: "approved", findings: [findings[1]!] });
      h.addArtifact("Review", r);
      return r;
    });
    const result = await h.svc.runReview("run-1");
    expect(h.githubSync.postReviewFindings).toHaveBeenCalledWith(
      "test-repo",
      42,
      [findings[1]],
      "approved",
    );
    expect(h.remediationAgent.run).not.toHaveBeenCalled();
    expect(result.state).toBe(RunState.ReadyForHumanReview);
  });

  it("refuses to review without a PR", async () => {
    const h = inReview({ prNumber: null });
    await expect(h.svc.runReview("run-1")).rejects.toMatchObject({ rule: "review_requires_pr" });
    expect(h.reviewerAgent.run).not.toHaveBeenCalled();
  });

  it("runRemediation without branch or PR skips git and GitHub sync; markReady then refuses for missing PR", async () => {
    const h = createHarness({
      run: makeRun({ state: RunState.AddressingReview, branchName: null, prNumber: null }),
    });
    h.addArtifact("ExecutionReport", makeExecutionReport());
    h.addArtifact("Review", makeReview({ overallVerdict: "changes_requested", findings }));

    const err = await h.svc.runRemediation("run-1").catch((e: unknown) => e);

    expect((err as PolicyViolationError).rule).toBe("ready_requires_pr");
    expect(h.gitService.assertBranch).not.toHaveBeenCalled();
    expect(h.gitService.commitAndPush).not.toHaveBeenCalled();
    expect(h.githubSync.postExecutionReportUpdate).not.toHaveBeenCalled();
    expect(h.githubSync.postRemediationResolutions).not.toHaveBeenCalled();
    expect(h.eventTypes()).toEqual([RunEvent.REMEDIATION_FINISHED, RunEvent.REVIEW_APPROVED]);
  });

  it("runRemediation refuses when the latest review approved the change", async () => {
    const h = createHarness({ run: makeRun({ state: RunState.AddressingReview }) });
    h.addArtifact("Review", makeReview({ overallVerdict: "approved", findings }));
    await expect(h.svc.runRemediation("run-1")).rejects.toMatchObject({
      rule: "remediate_requires_changes_requested_verdict",
    });
    expect(h.remediationAgent.run).not.toHaveBeenCalled();
  });
});

describe("OrchestratorService.markReady", () => {
  it("refuses when the latest report has failing checks and posts nothing", async () => {
    const h = createHarness({ run: makeRun({ state: RunState.ReadyForHumanReview, prNumber: 1 }) });
    h.addArtifact("Review", makeReview());
    const report = makeExecutionReport();
    report.checks.lint = { status: "fail", details: "2 errors" };
    h.addArtifact("ExecutionReport", report);
    await expect(h.svc.markReady("run-1")).rejects.toMatchObject({
      rule: "ready_requires_green_checks",
    });
    expect(h.linearClient.postComment).not.toHaveBeenCalled();
  });

  it("posts the completion comment and returns the run unchanged when all gates pass", async () => {
    const h = createHarness({ run: makeRun({ state: RunState.ReadyForHumanReview, prNumber: 1 }) });
    h.addArtifact("Review", makeReview());
    h.addArtifact("ExecutionReport", makeExecutionReport());
    const result = await h.svc.markReady("run-1");
    expect(result.state).toBe(RunState.ReadyForHumanReview);
    expect(h.state.events).toHaveLength(0);
    expect(h.linearClient.postComment).toHaveBeenCalledWith(
      "LIN-1",
      "AI workflow complete. Issue marked as **Ready for Human Review**.",
    );
  });
});

describe("OrchestratorService execution report comment formatting", () => {
  async function commentFor(report: ReturnType<typeof makeExecutionReport>) {
    const h = implementing({ branchName: null });
    h.executorAgent.run.mockImplementationOnce(async () => {
      h.addArtifact("ExecutionReport", report);
      return { report, prNumber: 5 };
    });
    // Raise the file limit so large change sets pass the executor path policy.
    h.repoRegistry.getRepoByName.mockReturnValue({
      ...REPO_ENTRY,
      constraints: { ...REPO_ENTRY.constraints, maxFilesChanged: 100 },
    });
    // The downstream markReady gate may refuse (e.g. failing checks); only the
    // execution comment posted before that matters here.
    await h.svc.runExecution("run-1").catch(() => undefined);
    return h.state.comments.find((c) => c.body.startsWith("## Execution Report"))!.body;
  }

  it("renders check icons for pass/fail/skip, notes, and an inline file list", async () => {
    const body = await commentFor(
      makeExecutionReport({
        score: 0.456,
        scoreRationale: "Partial",
        summary: "Did stuff",
        filesChanged: ["src/a.ts", "src/b.ts"],
        notes: ["note one", "note two"],
        checks: {
          lint: { status: "pass", details: "ok" },
          typecheck: { status: "fail", details: "3 errors" },
          tests: { status: "skip", details: "not run" },
        },
      }),
    );
    expect(body).toBe(
      [
        "## Execution Report (v1) -- Score: 46%",
        "",
        "*Partial*",
        "",
        "Did stuff",
        "",
        "### Checks",
        "- :white_check_mark: **Lint** -- ok\n- :x: **Typecheck** -- 3 errors\n- :heavy_minus_sign: **Tests** -- not run",
        "\n### Files changed (2)\n- `src/a.ts`\n- `src/b.ts`",
        "\n### Notes\n- note one\n- note two",
      ].join("\n"),
    );
  });

  it("omits the files and notes sections when empty", async () => {
    const body = await commentFor(makeExecutionReport({ filesChanged: [], notes: [] }));
    expect(body).not.toContain("Files changed");
    expect(body).not.toContain("### Notes");
  });

  it("keeps exactly 8 files inline (threshold boundary)", async () => {
    const files = Array.from({ length: 8 }, (_, i) => `src/f${i}.ts`);
    const body = await commentFor(makeExecutionReport({ filesChanged: files }));
    expect(body).toContain("### Files changed (8)");
    expect(body).not.toContain("<details>");
  });

  it("collapses more than 8 files into a <details> block", async () => {
    const files = Array.from({ length: 9 }, (_, i) => `src/f${i}.ts`);
    const body = await commentFor(makeExecutionReport({ filesChanged: files }));
    expect(body).toContain(
      "<details>\n<summary><strong>Files changed (9)</strong></summary>\n\n- `src/f0.ts`",
    );
    expect(body).toContain("- `src/f8.ts`\n\n</details>");
    expect(body).not.toContain("### Files changed");
  });
});

describe("OrchestratorService plan comment formatting", () => {
  it("lists open questions (flagging blockers) and risks in the approved-plan comment", async () => {
    const h = createHarness({ run: makeRun({ state: RunState.PlanReview }) });
    h.addArtifact(
      "Plan",
      makePlan({
        planVersion: 2,
        confidence: 0.755,
        summary: "Do it",
        steps: [
          { id: "s1", title: "One", description: "first" },
          { id: "s2", title: "Two", description: "second" },
        ],
        openQuestions: [
          { id: "q1", question: "Which DB?", requiredForExecution: true },
          { id: "q2", question: "Color?", requiredForExecution: false },
        ],
        risks: ["Migration risk"],
      }),
      2,
    );
    await h.svc.runPlanReview("run-1");
    const body = h.state.comments.at(-1)!.body;
    expect(body.startsWith("## AI Plan (v2) -- Confidence: 76%")).toBe(true);
    expect(body).toContain("1. **One**: first\n2. **Two**: second");
    expect(body).toContain(
      "**Open Questions:**\n- Which DB? *blocks execution*\n- Color?",
    );
    expect(body).toContain("**Risks:**\n- Migration risk");
    expect(body).toContain("Reply `/approve-plan` to proceed or `/reject-plan` to revise.");
  });

  it("omits open-question and risk sections when empty", async () => {
    const h = createHarness({ run: makeRun({ state: RunState.PlanReview }) });
    h.addArtifact("Plan", makePlan());
    await h.svc.runPlanReview("run-1");
    const body = h.state.comments.at(-1)!.body;
    expect(body).not.toContain("Open Questions");
    expect(body).not.toContain("Risks");
  });
});
