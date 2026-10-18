import { describe, it, expect } from "vitest";
import { PolicyEngine } from "../../src/orchestrator/policyEngine.js";
import { RunState } from "../../src/domain/runState.js";
import type { Run } from "../../src/domain/types.js";
import type { Plan } from "../../src/schemas/plan.js";
import type { ExecutionReport } from "../../src/schemas/executionReport.js";
import type { Review } from "../../src/schemas/review.js";
import type { TaskBundle } from "../../src/schemas/taskBundle.js";
import { PolicyViolationError } from "../../src/utils/errors.js";

function makeRun(overrides: Partial<Run> = {}): Run {
  return {
    id: "run-1",
    linearIssueId: "lin-1",
    linearIssueIdentifier: "LIN-1",
    linearIssueDescription: null,
    linearIssueTitle: null,
    linearIssueUrl: null,
    repo: "acme/widgets",
    branchName: null,
    prNumber: null,
    state: RunState.Todo,
    planVersion: 1,
    approvedPlanVersion: null,
    plannerRuntime: null,
    executorRuntime: null,
    reviewerRuntime: null,
    remediationRuntime: null,
    workingDirectory: "/workspace/acme-widgets",
    latestArtifactVersion: 0,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}

function makePlan(overrides: Partial<Plan> = {}): Plan {
  return {
    planVersion: 1,
    summary: "Add the thing",
    requirementsTraceability: "",
    assumptions: [],
    openQuestions: [],
    risks: [],
    steps: [{ id: "s1", title: "Do it", description: "Do the thing" }],
    testPlan: "Run the tests",
    confidence: 0.9,
    ...overrides,
  };
}

function makeExecutionReport(overrides: Partial<ExecutionReport> = {}): ExecutionReport {
  return {
    executionVersion: 1,
    summary: "Implemented the thing",
    filesChanged: ["src/thing.ts"],
    checks: {
      lint: { status: "pass", details: "" },
      typecheck: { status: "pass", details: "" },
      tests: { status: "pass", details: "" },
    },
    notes: [],
    prDraftCreated: true,
    score: 0.8,
    scoreRationale: "Looks solid",
    ...overrides,
  };
}

function makeReview(overrides: Partial<Review> = {}): Review {
  return {
    reviewId: "rev-1",
    summary: "Looks good",
    findings: [],
    overallVerdict: "approved",
    ...overrides,
  };
}

function makeTaskBundle(overrides: Partial<TaskBundle> = {}): TaskBundle {
  return {
    issue: {
      id: "LIN-1",
      title: "Add the thing",
      description: "Please add the thing",
      labels: [],
      priority: 2,
    },
    repo: {
      name: "widgets",
      defaultBranch: "main",
      workingBranch: "ai/lin-1",
      repoPath: "/workspace/acme-widgets",
      allowedPaths: ["src/"],
      protectedPaths: ["src/config/secrets.ts", ".github/"],
    },
    constraints: {
      requiredChecks: ["lint", "typecheck", "tests"],
      maxFilesChanged: 10,
      maxDiffLines: 500,
      forbiddenPatterns: [],
      mustNotTouch: [],
    },
    definitionOfDone: ["Tests pass"],
    ...overrides,
  };
}

describe("PolicyEngine.assertCanPlan", () => {
  it("allows planning from Todo", () => {
    const engine = new PolicyEngine();
    expect(() => engine.assertCanPlan(makeRun({ state: RunState.Todo }))).not.toThrow();
  });

  it("allows planning from Planning (re-entrant)", () => {
    const engine = new PolicyEngine();
    expect(() => engine.assertCanPlan(makeRun({ state: RunState.Planning }))).not.toThrow();
  });

  it("rejects planning from any other state with a PolicyViolationError", () => {
    const engine = new PolicyEngine();
    try {
      engine.assertCanPlan(makeRun({ state: RunState.Implementing }));
      throw new Error("expected assertCanPlan to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(PolicyViolationError);
      const violation = err as PolicyViolationError;
      expect(violation.rule).toBe("plan_requires_todo_or_planning_state");
      expect(violation.message).toContain(RunState.Implementing);
    }
  });
});

describe("PolicyEngine.assertCanExecute", () => {
  it("allows execution when Implementing, approved, with a matching plan version", () => {
    const engine = new PolicyEngine();
    const run = makeRun({ state: RunState.Implementing, approvedPlanVersion: 2 });
    const plan = makePlan({ planVersion: 2 });
    expect(() => engine.assertCanExecute(run, plan)).not.toThrow();
  });

  it("rejects when run is not Implementing", () => {
    const engine = new PolicyEngine();
    const run = makeRun({ state: RunState.Planning, approvedPlanVersion: 1 });
    try {
      engine.assertCanExecute(run, makePlan());
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(PolicyViolationError);
      expect((err as PolicyViolationError).rule).toBe("execute_requires_implementing_state");
    }
  });

  it("rejects when approvedPlanVersion is not set", () => {
    const engine = new PolicyEngine();
    const run = makeRun({ state: RunState.Implementing, approvedPlanVersion: null });
    try {
      engine.assertCanExecute(run, makePlan());
      throw new Error("expected throw");
    } catch (err) {
      expect((err as PolicyViolationError).rule).toBe("execute_requires_explicit_approval");
    }
  });

  it("rejects when there is no plan artifact", () => {
    const engine = new PolicyEngine();
    const run = makeRun({ state: RunState.Implementing, approvedPlanVersion: 1 });
    try {
      engine.assertCanExecute(run, null);
      throw new Error("expected throw");
    } catch (err) {
      expect((err as PolicyViolationError).rule).toBe("execute_requires_plan_artifact");
    }
  });

  it("rejects when the plan version does not match the approved version", () => {
    const engine = new PolicyEngine();
    const run = makeRun({ state: RunState.Implementing, approvedPlanVersion: 3 });
    const plan = makePlan({ planVersion: 2 });
    try {
      engine.assertCanExecute(run, plan);
      throw new Error("expected throw");
    } catch (err) {
      const violation = err as PolicyViolationError;
      expect(violation.rule).toBe("execute_plan_version_mismatch");
      expect(violation.message).toContain("v2");
      expect(violation.message).toContain("v3");
    }
  });
});

describe("PolicyEngine.assertCanReview", () => {
  it("allows review when AIReview, has a PR, and an execution report", () => {
    const engine = new PolicyEngine();
    const run = makeRun({ state: RunState.AIReview, prNumber: 42 });
    expect(() => engine.assertCanReview(run, makeExecutionReport())).not.toThrow();
  });

  it("rejects when run is not AIReview", () => {
    const engine = new PolicyEngine();
    const run = makeRun({ state: RunState.Implementing, prNumber: 42 });
    try {
      engine.assertCanReview(run, makeExecutionReport());
      throw new Error("expected throw");
    } catch (err) {
      expect((err as PolicyViolationError).rule).toBe("review_requires_ai_review_state");
    }
  });

  it("rejects when there is no PR number", () => {
    const engine = new PolicyEngine();
    const run = makeRun({ state: RunState.AIReview, prNumber: null });
    try {
      engine.assertCanReview(run, makeExecutionReport());
      throw new Error("expected throw");
    } catch (err) {
      expect((err as PolicyViolationError).rule).toBe("review_requires_pr");
    }
  });

  it("rejects when there is no execution report", () => {
    const engine = new PolicyEngine();
    const run = makeRun({ state: RunState.AIReview, prNumber: 42 });
    try {
      engine.assertCanReview(run, null);
      throw new Error("expected throw");
    } catch (err) {
      expect((err as PolicyViolationError).rule).toBe("review_requires_execution_report");
    }
  });
});

describe("PolicyEngine.assertCanRemediate", () => {
  it("allows remediation when AddressingReview with a changes_requested review with findings", () => {
    const engine = new PolicyEngine();
    const run = makeRun({ state: RunState.AddressingReview });
    const review = makeReview({
      overallVerdict: "changes_requested",
      findings: [
        {
          id: "f1",
          severity: "blocker",
          type: "bug",
          file: "src/thing.ts",
          title: "Missing null check",
          details: "...",
        },
      ],
    });
    expect(() => engine.assertCanRemediate(run, review)).not.toThrow();
  });

  it("rejects when run is not AddressingReview", () => {
    const engine = new PolicyEngine();
    const run = makeRun({ state: RunState.AIReview });
    try {
      engine.assertCanRemediate(run, makeReview({ overallVerdict: "changes_requested" }));
      throw new Error("expected throw");
    } catch (err) {
      expect((err as PolicyViolationError).rule).toBe(
        "remediate_requires_addressing_review_state",
      );
    }
  });

  it("rejects when there is no review artifact", () => {
    const engine = new PolicyEngine();
    const run = makeRun({ state: RunState.AddressingReview });
    try {
      engine.assertCanRemediate(run, null);
      throw new Error("expected throw");
    } catch (err) {
      expect((err as PolicyViolationError).rule).toBe("remediate_requires_review");
    }
  });

  it("rejects when the review verdict is approved, not changes_requested", () => {
    const engine = new PolicyEngine();
    const run = makeRun({ state: RunState.AddressingReview });
    try {
      engine.assertCanRemediate(run, makeReview({ overallVerdict: "approved" }));
      throw new Error("expected throw");
    } catch (err) {
      const violation = err as PolicyViolationError;
      expect(violation.rule).toBe("remediate_requires_changes_requested_verdict");
      expect(violation.message).toContain("approved");
    }
  });

  it("rejects when the review has changes_requested but no findings", () => {
    const engine = new PolicyEngine();
    const run = makeRun({ state: RunState.AddressingReview });
    try {
      engine.assertCanRemediate(
        run,
        makeReview({ overallVerdict: "changes_requested", findings: [] }),
      );
      throw new Error("expected throw");
    } catch (err) {
      expect((err as PolicyViolationError).rule).toBe("remediate_requires_findings");
    }
  });
});

describe("PolicyEngine.assertCanMarkReady", () => {
  it("allows marking ready with a PR, green checks, and an approved review with no blockers", () => {
    const engine = new PolicyEngine();
    const run = makeRun({ prNumber: 42 });
    expect(() =>
      engine.assertCanMarkReady(run, makeReview(), makeExecutionReport()),
    ).not.toThrow();
  });

  it("rejects when there is no PR number", () => {
    const engine = new PolicyEngine();
    const run = makeRun({ prNumber: null });
    try {
      engine.assertCanMarkReady(run, makeReview(), makeExecutionReport());
      throw new Error("expected throw");
    } catch (err) {
      expect((err as PolicyViolationError).rule).toBe("ready_requires_pr");
    }
  });

  it("rejects when there is no execution report", () => {
    const engine = new PolicyEngine();
    const run = makeRun({ prNumber: 42 });
    try {
      engine.assertCanMarkReady(run, makeReview(), null);
      throw new Error("expected throw");
    } catch (err) {
      expect((err as PolicyViolationError).rule).toBe("ready_requires_execution_report");
    }
  });

  it.each(["lint", "typecheck", "tests"] as const)(
    "rejects when the %s check failed",
    (checkName) => {
      const engine = new PolicyEngine();
      const run = makeRun({ prNumber: 42 });
      const report = makeExecutionReport({
        checks: {
          lint: { status: "pass", details: "" },
          typecheck: { status: "pass", details: "" },
          tests: { status: "pass", details: "" },
          [checkName]: { status: "fail", details: "boom" },
        },
      });
      try {
        engine.assertCanMarkReady(run, makeReview(), report);
        throw new Error("expected throw");
      } catch (err) {
        expect((err as PolicyViolationError).rule).toBe("ready_requires_green_checks");
      }
    },
  );

  it("rejects when there is no review", () => {
    const engine = new PolicyEngine();
    const run = makeRun({ prNumber: 42 });
    try {
      engine.assertCanMarkReady(run, null, makeExecutionReport());
      throw new Error("expected throw");
    } catch (err) {
      expect((err as PolicyViolationError).rule).toBe("ready_requires_review");
    }
  });

  it("rejects when the review verdict is changes_requested", () => {
    const engine = new PolicyEngine();
    const run = makeRun({ prNumber: 42 });
    try {
      engine.assertCanMarkReady(
        run,
        makeReview({ overallVerdict: "changes_requested" }),
        makeExecutionReport(),
      );
      throw new Error("expected throw");
    } catch (err) {
      const violation = err as PolicyViolationError;
      expect(violation.rule).toBe("ready_requires_approved_verdict");
      expect(violation.message).toContain("changes_requested");
    }
  });

  it("rejects when the approved review still has unresolved blocker findings", () => {
    const engine = new PolicyEngine();
    const run = makeRun({ prNumber: 42 });
    const review = makeReview({
      overallVerdict: "approved",
      findings: [
        {
          id: "f1",
          severity: "blocker",
          type: "bug",
          file: "src/thing.ts",
          title: "Still broken",
          details: "...",
        },
        {
          id: "f2",
          severity: "nit",
          type: "style",
          file: "src/thing.ts",
          title: "Formatting",
          details: "...",
        },
      ],
    });
    try {
      engine.assertCanMarkReady(run, review, makeExecutionReport());
      throw new Error("expected throw");
    } catch (err) {
      const violation = err as PolicyViolationError;
      expect(violation.rule).toBe("ready_requires_blockers_resolved");
      expect(violation.message).toContain("1 unresolved blocker");
    }
  });
});

describe("PolicyEngine.assertExecutorPaths", () => {
  it("allows changes within allowed, non-protected paths and under the file limit", () => {
    const engine = new PolicyEngine();
    expect(() =>
      engine.assertExecutorPaths(["src/thing.ts", "src/other.ts"], makeTaskBundle()),
    ).not.toThrow();
  });

  it("rejects when a changed file starts with a protected path", () => {
    const engine = new PolicyEngine();
    try {
      engine.assertExecutorPaths(["src/config/secrets.ts"], makeTaskBundle());
      throw new Error("expected throw");
    } catch (err) {
      const violation = err as PolicyViolationError;
      expect(violation.rule).toBe("executor_touched_protected_path");
      expect(violation.message).toContain("src/config/secrets.ts");
    }
  });

  it("rejects when the number of changed files exceeds maxFilesChanged", () => {
    const engine = new PolicyEngine();
    const bundle = makeTaskBundle({
      constraints: {
        requiredChecks: [],
        maxFilesChanged: 1,
        maxDiffLines: 500,
        forbiddenPatterns: [],
        mustNotTouch: [],
      },
    });
    try {
      engine.assertExecutorPaths(["src/a.ts", "src/b.ts"], bundle);
      throw new Error("expected throw");
    } catch (err) {
      const violation = err as PolicyViolationError;
      expect(violation.rule).toBe("executor_exceeded_max_files");
      expect(violation.message).toContain("2 files");
      expect(violation.message).toContain("max: 1");
    }
  });

  it("checks the protected-path rule before the file-count rule", () => {
    // A protected-path violation should win even if the file count is also over budget,
    // since assertExecutorPaths checks paths in the loop before the count check.
    const engine = new PolicyEngine();
    const bundle = makeTaskBundle({
      constraints: {
        requiredChecks: [],
        maxFilesChanged: 1,
        maxDiffLines: 500,
        forbiddenPatterns: [],
        mustNotTouch: [],
      },
    });
    try {
      engine.assertExecutorPaths(["src/config/secrets.ts", "src/b.ts"], bundle);
      throw new Error("expected throw");
    } catch (err) {
      expect((err as PolicyViolationError).rule).toBe("executor_touched_protected_path");
    }
  });
});
