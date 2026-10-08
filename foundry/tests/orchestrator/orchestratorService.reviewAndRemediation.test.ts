import { describe, it, expect } from "vitest";
import { RunState } from "../../src/domain/runState.js";
import { RunEvent } from "../../src/domain/runEvent.js";
import { PolicyViolationError } from "../../src/utils/errors.js";
import type { Review } from "../../src/schemas/review.js";
import {
  createHarness,
  makeExecutionReport,
  makePlan,
  makeReview,
  makeRun,
  type HarnessOptions,
} from "./helpers/orchestratorHarness.js";

const READY_COMMENT = "AI workflow complete. Issue marked as **Ready for Human Review**.";

async function expectPolicyRule(p: Promise<unknown>, rule: string): Promise<void> {
  const err = await p.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(PolicyViolationError);
  expect((err as PolicyViolationError).rule).toBe(rule);
}

const changesRequested: Review = makeReview({
  reviewId: "rev-cr",
  summary: "Two problems found",
  overallVerdict: "changes_requested",
  findings: [
    {
      id: "f1",
      severity: "important",
      type: "bug",
      file: "src/a.ts",
      lineHint: 12,
      title: "Off by one",
      details: "Loop bound is wrong",
    },
    {
      id: "f2",
      severity: "suggestion",
      type: "style",
      file: "src/b.ts",
      title: "Rename var",
      details: "Use a clearer name",
    },
  ],
});

function reviewHarness(overrides: Partial<HarnessOptions> = {}) {
  return createHarness({
    run: makeRun({ state: RunState.AIReview, prNumber: 42, approvedPlanVersion: 1 }),
    artifacts: [
      { type: "Plan", version: 1, payloadJson: makePlan() },
      { type: "ExecutionReport", version: 1, payloadJson: makeExecutionReport() },
    ],
    ...overrides,
  });
}

// ---------------------------------------------------------------------------
// runReview
// ---------------------------------------------------------------------------
describe("OrchestratorService.runReview", () => {
  it("rejects when the run is not in AIReview", async () => {
    const h = reviewHarness({ run: makeRun({ state: RunState.Implementing, prNumber: 42 }) });
    await expectPolicyRule(h.svc.runReview("run-1"), "review_requires_ai_review_state");
    expect(h.reviewerAgent.run).not.toHaveBeenCalled();
  });

  it("rejects when the run has no PR", async () => {
    const h = reviewHarness({ run: makeRun({ state: RunState.AIReview, prNumber: null }) });
    await expectPolicyRule(h.svc.runReview("run-1"), "review_requires_pr");
    expect(h.githubClient.getPRDiff).not.toHaveBeenCalled();
  });

  it("rejects without an execution report", async () => {
    const h = reviewHarness({
      artifacts: [{ type: "Plan", version: 1, payloadJson: makePlan() }],
    });
    await expectPolicyRule(h.svc.runReview("run-1"), "review_requires_execution_report");
    expect(h.reviewerAgent.run).not.toHaveBeenCalled();
  });

  it("on approval with minor findings posts them to the PR and marks the run ready", async () => {
    const approvedWithNits = makeReview({
      findings: [
        {
          id: "n1",
          severity: "nit",
          type: "style",
          file: "src/a.ts",
          title: "Trailing space",
          details: "Remove it",
        },
      ],
    });
    const h = reviewHarness({ config: { reviews: [approvedWithNits] } });

    const run = await h.svc.runReview("run-1");

    expect(h.reviewerAgent.run).toHaveBeenCalledWith(
      makePlan(),
      makeExecutionReport(),
      "diff --git a/src/feature.ts",
      expect.objectContaining({ issue: expect.objectContaining({ id: "LIN-1" }) }),
      "run-1",
    );
    expect(h.runRepo.update).toHaveBeenCalledWith("run-1", { reviewerRuntime: "codex" });
    expect(h.githubSync.postReviewFindings).toHaveBeenCalledWith(
      "test-repo",
      42,
      approvedWithNits.findings,
      "approved",
    );
    expect(run.state).toBe(RunState.ReadyForHumanReview);
    expect(h.recordedEventTypes()).toEqual([RunEvent.REVIEW_APPROVED]);
    expect(h.recordedEvent(RunEvent.REVIEW_APPROVED)?.source).toBe("reviewer-agent");
    // No code-review summary comment on approval; only the ready notice.
    expect(h.comments()).toEqual([READY_COMMENT]);
    expect(h.remediationAgent.run).not.toHaveBeenCalled();
  });

  it("refuses to mark ready when an approved review still carries a blocker", async () => {
    const h = reviewHarness({
      config: {
        reviews: [
          makeReview({
            findings: [
              {
                id: "b1",
                severity: "blocker",
                type: "security",
                file: "src/auth.ts",
                title: "SQL injection",
                details: "Unescaped input",
              },
            ],
          }),
        ],
      },
    });

    await expectPolicyRule(h.svc.runReview("run-1"), "ready_requires_blockers_resolved");
    expect(h.comments()).not.toContain(READY_COMMENT);
  });

  it("refuses to mark ready when the execution report has failing checks", async () => {
    const h = reviewHarness({
      artifacts: [
        { type: "Plan", version: 1, payloadJson: makePlan() },
        {
          type: "ExecutionReport",
          version: 1,
          payloadJson: makeExecutionReport({
            checks: {
              lint: { status: "pass", details: "ok" },
              typecheck: { status: "pass", details: "ok" },
              tests: { status: "fail", details: "2 failing" },
            },
          }),
        },
      ],
    });

    await expectPolicyRule(h.svc.runReview("run-1"), "ready_requires_green_checks");
  });

  it("on changes_requested posts the review, maps PR comments and hands them to remediation", async () => {
    const h = reviewHarness({ config: { reviews: [changesRequested] } });
    h.githubSync.postReviewFindings.mockResolvedValue(
      new Map([
        ["f1", 1001],
        ["f2", 1002],
      ]),
    );

    // runRemediation ends in markReady, which (pre-existing behaviour) fails on
    // the still-"changes_requested" Review artifact. We assert the chain up to
    // that point.
    await expectPolicyRule(h.svc.runReview("run-1"), "ready_requires_approved_verdict");

    expect(h.recordedEventTypes()).toEqual([
      RunEvent.REVIEW_CHANGES_REQUESTED,
      RunEvent.REMEDIATION_FINISHED,
      RunEvent.REVIEW_APPROVED,
    ]);
    expect(h.comments()[0]).toBe(
      [
        "## AI Code Review -- Changes Requested",
        "",
        "Two problems found",
        "",
        "### Findings",
        "- **[IMPORTANT]** Off by one (src/a.ts:12)\n  Loop bound is wrong\n" +
          "- **[SUGGESTION]** Rename var (src/b.ts)\n  Use a clearer name",
      ].join("\n"),
    );
    expect(h.remediationAgent.run).toHaveBeenCalledTimes(1);
    expect(h.githubSync.postRemediationResolutions).toHaveBeenCalledWith(
      "test-repo",
      42,
      expect.any(Array),
      { f1: 1001, f2: 1002 },
    );
  });

  it("propagates reviewer failures without changing state", async () => {
    const h = reviewHarness();
    h.reviewerAgent.run.mockRejectedValue(new Error("codex crashed"));

    await expect(h.svc.runReview("run-1")).rejects.toThrow("codex crashed");
    expect(h.store.run?.state).toBe(RunState.AIReview);
    expect(h.eventRepo.create).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// runRemediation
// ---------------------------------------------------------------------------
function remediationHarness(overrides: Partial<HarnessOptions> = {}) {
  return createHarness({
    run: makeRun({ state: RunState.AddressingReview, prNumber: 42 }),
    artifacts: [
      { type: "Plan", version: 1, payloadJson: makePlan() },
      { type: "ExecutionReport", version: 1, payloadJson: makeExecutionReport({ score: 0.6 }) },
      { type: "Review", version: 1, payloadJson: changesRequested },
    ],
    ...overrides,
  });
}

describe("OrchestratorService.runRemediation", () => {
  it("rejects when the run is not AddressingReview", async () => {
    const h = remediationHarness({ run: makeRun({ state: RunState.AIReview, prNumber: 42 }) });
    await expectPolicyRule(
      h.svc.runRemediation("run-1"),
      "remediate_requires_addressing_review_state",
    );
    expect(h.remediationAgent.run).not.toHaveBeenCalled();
  });

  it("rejects without a review artifact", async () => {
    const h = remediationHarness({
      artifacts: [{ type: "ExecutionReport", version: 1, payloadJson: makeExecutionReport() }],
    });
    await expectPolicyRule(h.svc.runRemediation("run-1"), "remediate_requires_review");
  });

  it("rejects when the review verdict is approved", async () => {
    const h = remediationHarness({
      artifacts: [{ type: "Review", version: 1, payloadJson: makeReview() }],
    });
    await expectPolicyRule(
      h.svc.runRemediation("run-1"),
      "remediate_requires_changes_requested_verdict",
    );
  });

  it("rejects a changes_requested review with no findings", async () => {
    const h = remediationHarness({
      artifacts: [
        {
          type: "Review",
          version: 1,
          payloadJson: makeReview({ overallVerdict: "changes_requested", findings: [] }),
        },
      ],
    });
    await expectPolicyRule(h.svc.runRemediation("run-1"), "remediate_requires_findings");
    expect(h.gitService.assertBranch).not.toHaveBeenCalled();
  });

  it("runs remediation, pushes, posts reports to Linear and GitHub, then advances the state", async () => {
    const h = remediationHarness({
      config: {
        remediationReport: {
          checks: {
            lint: { status: "pass", details: "ok" },
            typecheck: { status: "fail", details: "TS2345" },
            tests: { status: "pass", details: "ok" },
          },
          score: 0.875,
          scoreRationale: "Most findings fixed",
        },
      },
    });

    // The remediation report has a failing typecheck so markReady refuses on
    // green checks -- which proves markReady read the post-remediation report.
    await expectPolicyRule(
      h.svc.runRemediation("run-1", { f1: 501 }),
      "ready_requires_green_checks",
    );

    expect(h.gitService.assertBranch).toHaveBeenCalledWith(
      "/repos/test-repo/.worktrees/run-1",
      "ai/run-1",
    );
    expect(h.remediationAgent.run).toHaveBeenCalledWith(
      changesRequested,
      makeExecutionReport({ score: 0.6 }),
      "/repos/test-repo/.worktrees/run-1",
      "run-1",
    );
    expect(h.gitService.commitAndPush).toHaveBeenCalledWith(
      "/repos/test-repo/.worktrees/run-1",
      "ai/run-1",
      "[AI] Remediation: address review findings",
    );
    expect(h.store.run?.remediationRuntime).toBe("claude-code");
    expect(h.recordedEventTypes()).toEqual([
      RunEvent.REMEDIATION_FINISHED,
      RunEvent.REVIEW_APPROVED,
    ]);
    expect(h.recordedEvent(RunEvent.REVIEW_APPROVED)?.source).toBe("remediation-agent");
    expect(h.store.run?.state).toBe(RunState.ReadyForHumanReview);

    // Execution report first, then the remediation summary.
    const [reportComment, remediationComment] = h.comments();
    expect(reportComment).toContain("## Execution Report (v2) -- Score: 88%");
    expect(reportComment).toContain(":x: **Typecheck** -- TS2345");
    expect(remediationComment).toBe(
      [
        "## Remediation Summary",
        "",
        "**Implementation score (v2): 0.88 (88%)** -- Most findings fixed",
        "",
        "- **f1** [accepted]: Fixed Off by one\n  *Rationale*: Valid finding\n" +
          "- **f2** [accepted]: Fixed Rename var\n  *Rationale*: Valid finding",
      ].join("\n"),
    );

    expect(h.githubSync.postExecutionReportUpdate).toHaveBeenCalledWith(
      "test-repo",
      42,
      expect.objectContaining({ executionVersion: 2, score: 0.875 }),
    );
    expect(h.githubSync.postRemediationResolutions).toHaveBeenCalledWith(
      "test-repo",
      42,
      [
        expect.objectContaining({ findingId: "f1", status: "accepted" }),
        expect.objectContaining({ findingId: "f2", status: "accepted" }),
      ],
      { f1: 501 },
    );
  });

  it("skips git and GitHub sync when the run has neither branch nor PR", async () => {
    const h = remediationHarness({
      run: makeRun({ state: RunState.AddressingReview, branchName: null, prNumber: null }),
    });

    await expectPolicyRule(h.svc.runRemediation("run-1"), "ready_requires_pr");

    expect(h.gitService.assertBranch).not.toHaveBeenCalled();
    expect(h.gitService.commitAndPush).not.toHaveBeenCalled();
    expect(h.githubSync.postExecutionReportUpdate).not.toHaveBeenCalled();
    expect(h.githubSync.postRemediationResolutions).not.toHaveBeenCalled();
    expect(h.recordedEventTypes()).toEqual([
      RunEvent.REMEDIATION_FINISHED,
      RunEvent.REVIEW_APPROVED,
    ]);
    // Defaults to an empty comment map when none is supplied.
    expect(h.remediationAgent.run).toHaveBeenCalledTimes(1);
  });

  it("does not push or transition when the remediation agent fails", async () => {
    const h = remediationHarness();
    h.remediationAgent.run.mockRejectedValue(new Error("remediation crashed"));

    await expect(h.svc.runRemediation("run-1")).rejects.toThrow("remediation crashed");
    expect(h.gitService.commitAndPush).not.toHaveBeenCalled();
    expect(h.eventRepo.create).not.toHaveBeenCalled();
    expect(h.store.run?.state).toBe(RunState.AddressingReview);
  });

  it("does not transition when pushing the remediation commit fails", async () => {
    const h = remediationHarness();
    h.gitService.commitAndPush.mockRejectedValue(new Error("push rejected (non-fast-forward)"));

    await expect(h.svc.runRemediation("run-1")).rejects.toThrow("push rejected");
    expect(h.remediationAgent.run).toHaveBeenCalledTimes(1);
    expect(h.eventRepo.create).not.toHaveBeenCalled();
    expect(h.linearClient.postComment).not.toHaveBeenCalled();
    expect(h.store.run?.remediationRuntime).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// markReady
// ---------------------------------------------------------------------------
describe("OrchestratorService.markReady", () => {
  function readyHarness(opts: {
    prNumber?: number | null;
    review?: Review | null;
    report?: ReturnType<typeof makeExecutionReport> | null;
  }) {
    const artifacts: HarnessOptions["artifacts"] = [];
    const review = opts.review === undefined ? makeReview() : opts.review;
    const report = opts.report === undefined ? makeExecutionReport() : opts.report;
    if (review) artifacts.push({ type: "Review", version: 1, payloadJson: review });
    if (report) artifacts.push({ type: "ExecutionReport", version: 1, payloadJson: report });
    return createHarness({
      run: makeRun({
        state: RunState.ReadyForHumanReview,
        prNumber: opts.prNumber === undefined ? 42 : opts.prNumber,
      }),
      artifacts,
    });
  }

  it("posts the completion comment without transitioning state", async () => {
    const h = readyHarness({
      report: makeExecutionReport({
        checks: {
          lint: { status: "skip", details: "n/a" },
          typecheck: { status: "pass", details: "ok" },
          tests: { status: "skip", details: "n/a" },
        },
      }),
    });

    const run = await h.svc.markReady("run-1");

    expect(run.state).toBe(RunState.ReadyForHumanReview);
    expect(h.comments()).toEqual([READY_COMMENT]);
    expect(h.eventRepo.create).not.toHaveBeenCalled();
    expect(h.runRepo.updateState).not.toHaveBeenCalled();
  });

  it.each([
    ["no PR", { prNumber: null }, "ready_requires_pr"],
    ["no execution report", { report: null }, "ready_requires_execution_report"],
    [
      "failing lint",
      {
        report: makeExecutionReport({
          checks: {
            lint: { status: "fail", details: "x" },
            typecheck: { status: "pass", details: "ok" },
            tests: { status: "pass", details: "ok" },
          },
        }),
      },
      "ready_requires_green_checks",
    ],
    [
      "failing typecheck",
      {
        report: makeExecutionReport({
          checks: {
            lint: { status: "pass", details: "ok" },
            typecheck: { status: "fail", details: "x" },
            tests: { status: "pass", details: "ok" },
          },
        }),
      },
      "ready_requires_green_checks",
    ],
    ["no review", { review: null }, "ready_requires_review"],
    [
      "changes_requested verdict",
      { review: makeReview({ overallVerdict: "changes_requested" }) },
      "ready_requires_approved_verdict",
    ],
  ] as const)("refuses when there is %s", async (_label, opts, rule) => {
    const h = readyHarness(opts as Parameters<typeof readyHarness>[0]);
    await expectPolicyRule(h.svc.markReady("run-1"), rule);
    expect(h.linearClient.postComment).not.toHaveBeenCalled();
  });

  it("throws for an unknown run", async () => {
    const h = createHarness({ run: null });
    await expect(h.svc.markReady("ghost")).rejects.toThrow("Run not found: ghost");
  });
});
