import { describe, it, expect } from "vitest";
import { PolicyEngine } from "../../src/orchestrator/policyEngine.js";
import { RunState } from "../../src/domain/runState.js";
import { PolicyViolationError } from "../../src/utils/errors.js";
import type { TaskBundle } from "../../src/schemas/taskBundle.js";
import {
  makeRun,
  makePlan,
  makeExecutionReport,
  makeReview,
  REPO_ENTRY,
} from "./orchestratorHarness.js";

const policy = new PolicyEngine();

function ruleOf(fn: () => void): string | undefined {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(PolicyViolationError);
    return (err as PolicyViolationError).rule;
  }
  return undefined;
}

const blocker = {
  id: "f1",
  severity: "blocker" as const,
  type: "bug",
  file: "src/a.ts",
  title: "Crash",
  details: "NPE",
};
const nit = { ...blocker, id: "f2", severity: "nit" as const };

describe("PolicyEngine.assertCanPlan", () => {
  it.each([RunState.Todo, RunState.Planning])("allows planning from %s", (state) => {
    expect(() => policy.assertCanPlan(makeRun({ state }))).not.toThrow();
  });

  it.each([RunState.Implementing, RunState.AwaitingPlanApproval, RunState.Done])(
    "rejects planning from %s",
    (state) => {
      let err: unknown;
      try {
        policy.assertCanPlan(makeRun({ state }));
      } catch (e) {
        err = e;
      }
      expect(err).toBeInstanceOf(PolicyViolationError);
      expect((err as PolicyViolationError).rule).toBe("plan_requires_todo_or_planning_state");
      expect((err as Error).message).toContain(`"${state}"`);
    },
  );
});

describe("PolicyEngine.assertCanExecute", () => {
  const ready = makeRun({ state: RunState.Implementing, approvedPlanVersion: 2 });

  it("passes when implementing, approved and plan version matches", () => {
    expect(() => policy.assertCanExecute(ready, makePlan({ planVersion: 2 }))).not.toThrow();
  });

  it("rejects when not in Implementing state (checked first)", () => {
    expect(
      ruleOf(() =>
        policy.assertCanExecute(
          makeRun({ state: RunState.AwaitingPlanApproval, approvedPlanVersion: null }),
          null,
        ),
      ),
    ).toBe("execute_requires_implementing_state");
  });

  it("rejects when approvedPlanVersion is null (no explicit approval)", () => {
    expect(
      ruleOf(() =>
        policy.assertCanExecute(
          makeRun({ state: RunState.Implementing, approvedPlanVersion: null }),
          makePlan(),
        ),
      ),
    ).toBe("execute_requires_explicit_approval");
  });

  it("treats approvedPlanVersion 0 as an explicit approval (only null/undefined are missing)", () => {
    expect(
      ruleOf(() =>
        policy.assertCanExecute(
          makeRun({ state: RunState.Implementing, approvedPlanVersion: 0 }),
          makePlan({ planVersion: 1 }),
        ),
      ),
    ).toBe("execute_plan_version_mismatch");
  });

  it("rejects when the plan artifact is missing", () => {
    expect(ruleOf(() => policy.assertCanExecute(ready, null))).toBe(
      "execute_requires_plan_artifact",
    );
  });

  it("rejects when plan version differs from approved version and reports both versions", () => {
    let err: unknown;
    try {
      policy.assertCanExecute(ready, makePlan({ planVersion: 3 }));
    } catch (e) {
      err = e;
    }
    expect((err as PolicyViolationError).rule).toBe("execute_plan_version_mismatch");
    expect((err as Error).message).toBe(
      "Plan version mismatch: plan is v3 but approved version is v2",
    );
  });
});

describe("PolicyEngine.assertCanReview", () => {
  const ok = makeRun({ state: RunState.AIReview, prNumber: 5 });

  it("passes with AIReview state, PR and execution report", () => {
    expect(() => policy.assertCanReview(ok, makeExecutionReport())).not.toThrow();
  });

  it("rejects outside AIReview", () => {
    expect(
      ruleOf(() =>
        policy.assertCanReview(makeRun({ state: RunState.Implementing, prNumber: 5 }), null),
      ),
    ).toBe("review_requires_ai_review_state");
  });

  it("rejects without a PR (prNumber null)", () => {
    expect(
      ruleOf(() =>
        policy.assertCanReview(
          makeRun({ state: RunState.AIReview, prNumber: null }),
          makeExecutionReport(),
        ),
      ),
    ).toBe("review_requires_pr");
  });

  it("treats prNumber 0 as missing PR (falsy boundary)", () => {
    expect(
      ruleOf(() =>
        policy.assertCanReview(
          makeRun({ state: RunState.AIReview, prNumber: 0 }),
          makeExecutionReport(),
        ),
      ),
    ).toBe("review_requires_pr");
  });

  it("rejects without an execution report", () => {
    expect(ruleOf(() => policy.assertCanReview(ok, null))).toBe(
      "review_requires_execution_report",
    );
  });
});

describe("PolicyEngine.assertCanRemediate", () => {
  const ok = makeRun({ state: RunState.AddressingReview });
  const changes = makeReview({ overallVerdict: "changes_requested", findings: [nit] });

  it("passes with changes_requested review and findings", () => {
    expect(() => policy.assertCanRemediate(ok, changes)).not.toThrow();
  });

  it("rejects outside AddressingReview", () => {
    expect(
      ruleOf(() => policy.assertCanRemediate(makeRun({ state: RunState.AIReview }), changes)),
    ).toBe("remediate_requires_addressing_review_state");
  });

  it("rejects without a review", () => {
    expect(ruleOf(() => policy.assertCanRemediate(ok, null))).toBe("remediate_requires_review");
  });

  it("rejects an approved review", () => {
    let err: unknown;
    try {
      policy.assertCanRemediate(ok, makeReview({ overallVerdict: "approved", findings: [nit] }));
    } catch (e) {
      err = e;
    }
    expect((err as PolicyViolationError).rule).toBe(
      "remediate_requires_changes_requested_verdict",
    );
    expect((err as Error).message).toContain('"approved"');
  });

  it("rejects changes_requested with zero findings", () => {
    expect(
      ruleOf(() =>
        policy.assertCanRemediate(
          ok,
          makeReview({ overallVerdict: "changes_requested", findings: [] }),
        ),
      ),
    ).toBe("remediate_requires_findings");
  });
});

describe("PolicyEngine.assertCanMarkReady", () => {
  const run = makeRun({ state: RunState.ReadyForHumanReview, prNumber: 9 });
  const green = makeExecutionReport();

  it("passes with PR, green checks and approved review with only non-blocker findings", () => {
    expect(() =>
      policy.assertCanMarkReady(run, makeReview({ findings: [nit] }), green),
    ).not.toThrow();
  });

  it("treats 'skip' checks as not failing", () => {
    const skipped = makeExecutionReport({
      checks: {
        lint: { status: "skip", details: "" },
        typecheck: { status: "skip", details: "" },
        tests: { status: "skip", details: "" },
      },
    });
    expect(() => policy.assertCanMarkReady(run, makeReview(), skipped)).not.toThrow();
  });

  it("rejects without a PR", () => {
    expect(
      ruleOf(() =>
        policy.assertCanMarkReady(makeRun({ prNumber: null }), makeReview(), green),
      ),
    ).toBe("ready_requires_pr");
  });

  it("rejects without an execution report", () => {
    expect(ruleOf(() => policy.assertCanMarkReady(run, makeReview(), null))).toBe(
      "ready_requires_execution_report",
    );
  });

  it.each(["lint", "typecheck", "tests"] as const)(
    "rejects when the %s check fails",
    (which) => {
      const report = makeExecutionReport();
      report.checks[which] = { status: "fail", details: "broken" };
      expect(ruleOf(() => policy.assertCanMarkReady(run, makeReview(), report))).toBe(
        "ready_requires_green_checks",
      );
    },
  );

  it("checks failing before checking review presence", () => {
    const report = makeExecutionReport();
    report.checks.tests = { status: "fail", details: "x" };
    expect(ruleOf(() => policy.assertCanMarkReady(run, null, report))).toBe(
      "ready_requires_green_checks",
    );
  });

  it("rejects without a review", () => {
    expect(ruleOf(() => policy.assertCanMarkReady(run, null, green))).toBe(
      "ready_requires_review",
    );
  });

  it("rejects when review verdict is changes_requested", () => {
    expect(
      ruleOf(() =>
        policy.assertCanMarkReady(
          run,
          makeReview({ overallVerdict: "changes_requested", findings: [nit] }),
          green,
        ),
      ),
    ).toBe("ready_requires_approved_verdict");
  });

  it("rejects an approved review that still has blocker findings and counts them", () => {
    let err: unknown;
    try {
      policy.assertCanMarkReady(
        run,
        makeReview({ findings: [blocker, { ...blocker, id: "f3" }, nit] }),
        green,
      );
    } catch (e) {
      err = e;
    }
    expect((err as PolicyViolationError).rule).toBe("ready_requires_blockers_resolved");
    expect((err as Error).message).toBe("Cannot mark ready with 2 unresolved blocker findings");
  });
});

describe("PolicyEngine.assertExecutorPaths", () => {
  const bundle = {
    repo: { protectedPaths: REPO_ENTRY.protectedPaths },
    constraints: { maxFilesChanged: 3 },
  } as unknown as TaskBundle;

  it("passes for an empty change set", () => {
    expect(() => policy.assertExecutorPaths([], bundle)).not.toThrow();
  });

  it("passes at exactly maxFilesChanged files outside protected paths", () => {
    expect(() =>
      policy.assertExecutorPaths(["src/a.ts", "src/b.ts", "README.md"], bundle),
    ).not.toThrow();
  });

  it("rejects one more than maxFilesChanged", () => {
    let err: unknown;
    try {
      policy.assertExecutorPaths(["a", "b", "c", "d"], bundle);
    } catch (e) {
      err = e;
    }
    expect((err as PolicyViolationError).rule).toBe("executor_exceeded_max_files");
    expect((err as Error).message).toBe("Executor changed 4 files (max: 3)");
  });

  it("rejects a file under a protected path prefix and names the file", () => {
    let err: unknown;
    try {
      policy.assertExecutorPaths(["src/ok.ts", ".github/workflows/ci.yml"], bundle);
    } catch (e) {
      err = e;
    }
    expect((err as PolicyViolationError).rule).toBe("executor_touched_protected_path");
    expect((err as Error).message).toContain(".github/workflows/ci.yml");
  });

  it("protected-path check takes precedence over the file-count limit", () => {
    expect(ruleOf(() => policy.assertExecutorPaths(["a", "b", "c", "infra/main.tf"], bundle))).toBe(
      "executor_touched_protected_path",
    );
  });

  it("uses prefix matching, so a similarly-named non-prefixed path is allowed", () => {
    expect(() => policy.assertExecutorPaths(["src/infra/x.ts"], bundle)).not.toThrow();
  });
});
