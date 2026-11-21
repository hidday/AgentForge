import { describe, it, expect } from "vitest";
import { RunState } from "../../src/domain/runState.js";
import {
  createHarness,
  makeExecutionReport,
  makePlan,
  makePlanReview,
  makeReview,
  makeRun,
} from "./helpers/orchestratorHarness.js";

// These exercise the private Linear-comment formatting helpers directly.
// Both real call sites of formatPlanComment() always pass a literal
// statusNote, and the findings fixtures used elsewhere always happen to set
// affectedStepId/lineHint, so the "not provided" branch of each ternary is
// never hit by the higher-level state-machine tests even though it's a real,
// reachable branch of the function's own (optional-field) contract.

describe("OrchestratorService comment formatting - omitted optional fields", () => {
  it("formatPlanComment omits the status line when no statusNote is given", () => {
    const h = createHarness({ run: null });
    const plan = makePlan();

    const withNote = (h.svc as any).formatPlanComment(plan, "Revised after AI review") as string;
    const withoutNote = (h.svc as any).formatPlanComment(plan) as string;

    expect(withNote).toContain("Revised after AI review");
    expect(withoutNote).not.toContain("Revised after AI review");
    expect(withoutNote).not.toMatch(/\n\n\*.*\*\n/);
    expect(withoutNote).toContain(plan.summary);
  });

  it("formatPlanReviewComment omits the step reference for a finding with no affectedStepId, for both verdicts", () => {
    const h = createHarness({ run: null });
    const findings = [
      {
        id: "pf1",
        severity: "nit" as const,
        type: "style",
        title: "Naming nit",
        details: "Prefer camelCase",
      },
    ];

    const changesRequested = (h.svc as any).formatPlanReviewComment(
      makePlanReview({ overallVerdict: "changes_requested", findings }),
    ) as string;
    const approved = (h.svc as any).formatPlanReviewComment(
      makePlanReview({ overallVerdict: "approved", findings }),
    ) as string;

    expect(changesRequested).toContain("Changes Requested");
    expect(changesRequested).not.toContain(" (step ");
    expect(approved).toContain("## AI Plan Review -- Approved");
    expect(approved).not.toContain(" (step ");
  });

  it("formatCodeReviewComment omits the line reference for a finding with no lineHint, for both verdicts", () => {
    const h = createHarness({ run: null });
    const findings = [
      {
        id: "f1",
        severity: "suggestion" as const,
        type: "style",
        file: "src/foo.ts",
        title: "Consider renaming",
        details: "This variable name is unclear",
      },
    ];

    const changesRequested = (h.svc as any).formatCodeReviewComment(
      makeReview({ overallVerdict: "changes_requested", findings }),
    ) as string;
    const approved = (h.svc as any).formatCodeReviewComment(
      makeReview({ overallVerdict: "approved", findings }),
    ) as string;

    expect(changesRequested).toContain("Changes Requested");
    expect(changesRequested).not.toMatch(/src\/foo\.ts:\d/);
    expect(approved).toContain("## AI Code Review -- Approved");
    expect(approved).not.toMatch(/src\/foo\.ts:\d/);
  });

  it("runReview does not post PR findings when the review has none", async () => {
    const h = createHarness({
      run: makeRun({ state: RunState.AIReview, prNumber: 42, approvedPlanVersion: 1 }),
      artifacts: [
        { type: "Plan", version: 1, payloadJson: makePlan() },
        { type: "ExecutionReport", version: 1, payloadJson: makeExecutionReport() },
      ],
      config: { reviews: [makeReview({ overallVerdict: "approved", findings: [] })] },
    });

    const run = await h.svc.runReview("run-1");

    expect(h.githubSync.postReviewFindings).not.toHaveBeenCalled();
    expect(run.state).toBe(RunState.ReadyForHumanReview);
  });
});
