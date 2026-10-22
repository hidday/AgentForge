import { describe, it, expect } from "vitest";
import { PolicyEngine } from "../../src/orchestrator/policyEngine.js";
import { RunState } from "../../src/domain/runState.js";
import type { Run } from "../../src/domain/types.js";
import type { Plan } from "../../src/schemas/plan.js";
import type { ExecutionReport, CheckResult } from "../../src/schemas/executionReport.js";
import type { Review, Finding } from "../../src/schemas/review.js";
import type { TaskBundle } from "../../src/schemas/taskBundle.js";
import { PolicyViolationError } from "../../src/utils/errors.js";

function makeRun(overrides: Partial<Run> = {}): Run {
  return {
    id: "run-1",
    linearIssueId: "issue-1",
    linearIssueIdentifier: "ENG-1",
    linearIssueDescription: null,
    linearIssueTitle: null,
    linearIssueUrl: null,
    repo: "org/repo",
    branchName: null,
    prNumber: null,
    state: RunState.Todo,
    planVersion: 0,
    approvedPlanVersion: null,
    plannerRuntime: null,
    executorRuntime: null,
    reviewerRuntime: null,
    remediationRuntime: null,
    workingDirectory: "/work",
    latestArtifactVersion: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makePlan(overrides: Partial<Plan> = {}): Plan {
  return {
    planVersion: 1,
    summary: "summary",
    requirementsTraceability: "",
    assumptions: [],
    openQuestions: [],
    risks: [],
    steps: [],
    testPlan: "test plan",
    confidence: 0.8,
    ...overrides,
  };
}

function makeCheck(status: CheckResult["status"] = "pass"): CheckResult {
  return { status, details: "" };
}

function makeExecutionReport(overrides: Partial<ExecutionReport> = {}): ExecutionReport {
  return {
    executionVersion: 1,
    summary: "summary",
    filesChanged: [],
    checks: {
      lint: makeCheck(),
      typecheck: makeCheck(),
      tests: makeCheck(),
    },
    notes: [],
    prDraftCreated: true,
    score: 0.9,
    scoreRationale: "",
    ...overrides,
  };
}

function makeFinding(overrides: Partial<Finding> = {}): Finding {
  return {
    id: "f1",
    severity: "nit",
    type: "style",
    file: "a.ts",
    title: "title",
    details: "details",
    ...overrides,
  };
}

function makeReview(overrides: Partial<Review> = {}): Review {
  return {
    reviewId: "r1",
    summary: "summary",
    findings: [],
    overallVerdict: "approved",
    ...overrides,
  };
}

function makeBundle(overrides: Partial<TaskBundle> = {}): TaskBundle {
  return {
    issue: {
      id: "issue-1",
      title: "title",
      description: "desc",
      labels: [],
      priority: 1,
    },
    repo: {
      name: "repo",
      defaultBranch: "main",
      workingBranch: "feature",
      repoPath: "/repo",
      allowedPaths: [],
      protectedPaths: [],
    },
    constraints: {
      requiredChecks: [],
      maxFilesChanged: 10,
      maxDiffLines: 1000,
      forbiddenPatterns: [],
      mustNotTouch: [],
    },
    definitionOfDone: [],
    ...overrides,
  };
}

describe("PolicyEngine.assertCanPlan", () => {
  const engine = new PolicyEngine();

  it("allows planning from Todo", () => {
    expect(() => engine.assertCanPlan(makeRun({ state: RunState.Todo }))).not.toThrow();
  });

  it("allows planning from Planning (re-entrant)", () => {
    expect(() => engine.assertCanPlan(makeRun({ state: RunState.Planning }))).not.toThrow();
  });

  it("rejects planning from any other state with a PolicyViolationError", () => {
    const run = makeRun({ state: RunState.Implementing });
    expect(() => engine.assertCanPlan(run)).toThrow(PolicyViolationError);
    try {
      engine.assertCanPlan(run);
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(PolicyViolationError);
      expect((err as PolicyViolationError).rule).toBe("plan_requires_todo_or_planning_state");
      expect((err as Error).message).toContain("Implementing");
    }
  });
});

describe("PolicyEngine.assertCanExecute", () => {
  const engine = new PolicyEngine();

  it("rejects when run is not Implementing", () => {
    const run = makeRun({ state: RunState.Todo, approvedPlanVersion: 1 });
    expect(() => engine.assertCanExecute(run, makePlan({ planVersion: 1 }))).toThrow(
      PolicyViolationError,
    );
    try {
      engine.assertCanExecute(run, makePlan({ planVersion: 1 }));
    } catch (err) {
      expect((err as PolicyViolationError).rule).toBe("execute_requires_implementing_state");
    }
  });

  it("rejects when approvedPlanVersion is not set", () => {
    const run = makeRun({ state: RunState.Implementing, approvedPlanVersion: null });
    try {
      engine.assertCanExecute(run, makePlan({ planVersion: 1 }));
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(PolicyViolationError);
      expect((err as PolicyViolationError).rule).toBe("execute_requires_explicit_approval");
    }
  });

  it("rejects when approvedPlanVersion is 0 (falsy but explicitly set) only via == null check", () => {
    // approvedPlanVersion === 0 should NOT trip the "not set" check (only null/undefined does)
    const run = makeRun({ state: RunState.Implementing, approvedPlanVersion: 0 });
    try {
      engine.assertCanExecute(run, makePlan({ planVersion: 0 }));
    } catch (err) {
      // Should fail on plan artifact/version mismatch rules, not on "requires explicit approval"
      expect((err as PolicyViolationError).rule).not.toBe("execute_requires_explicit_approval");
    }
  });

  it("rejects when there is no plan artifact", () => {
    const run = makeRun({ state: RunState.Implementing, approvedPlanVersion: 1 });
    try {
      engine.assertCanExecute(run, null);
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(PolicyViolationError);
      expect((err as PolicyViolationError).rule).toBe("execute_requires_plan_artifact");
    }
  });

  it("rejects when plan version does not match approved version", () => {
    const run = makeRun({ state: RunState.Implementing, approvedPlanVersion: 2 });
    try {
      engine.assertCanExecute(run, makePlan({ planVersion: 1 }));
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(PolicyViolationError);
      expect((err as PolicyViolationError).rule).toBe("execute_plan_version_mismatch");
      expect((err as Error).message).toContain("v1");
      expect((err as Error).message).toContain("v2");
    }
  });

  it("allows execution when state, approval and plan version all line up", () => {
    const run = makeRun({ state: RunState.Implementing, approvedPlanVersion: 3 });
    expect(() => engine.assertCanExecute(run, makePlan({ planVersion: 3 }))).not.toThrow();
  });
});

describe("PolicyEngine.assertCanReview", () => {
  const engine = new PolicyEngine();

  it("rejects when run is not AIReview", () => {
    const run = makeRun({ state: RunState.Implementing, prNumber: 1 });
    try {
      engine.assertCanReview(run, makeExecutionReport());
      throw new Error("expected throw");
    } catch (err) {
      expect((err as PolicyViolationError).rule).toBe("review_requires_ai_review_state");
    }
  });

  it("rejects when run has no PR", () => {
    const run = makeRun({ state: RunState.AIReview, prNumber: null });
    try {
      engine.assertCanReview(run, makeExecutionReport());
      throw new Error("expected throw");
    } catch (err) {
      expect((err as PolicyViolationError).rule).toBe("review_requires_pr");
    }
  });

  it("rejects when there is no execution report", () => {
    const run = makeRun({ state: RunState.AIReview, prNumber: 7 });
    try {
      engine.assertCanReview(run, null);
      throw new Error("expected throw");
    } catch (err) {
      expect((err as PolicyViolationError).rule).toBe("review_requires_execution_report");
    }
  });

  it("allows review when state, PR and execution report are all present", () => {
    const run = makeRun({ state: RunState.AIReview, prNumber: 7 });
    expect(() => engine.assertCanReview(run, makeExecutionReport())).not.toThrow();
  });
});

describe("PolicyEngine.assertCanRemediate", () => {
  const engine = new PolicyEngine();

  it("rejects when run is not AddressingReview", () => {
    const run = makeRun({ state: RunState.AIReview });
    try {
      engine.assertCanRemediate(
        run,
        makeReview({ overallVerdict: "changes_requested", findings: [makeFinding()] }),
      );
      throw new Error("expected throw");
    } catch (err) {
      expect((err as PolicyViolationError).rule).toBe(
        "remediate_requires_addressing_review_state",
      );
    }
  });

  it("rejects when there is no review artifact", () => {
    const run = makeRun({ state: RunState.AddressingReview });
    try {
      engine.assertCanRemediate(run, null);
      throw new Error("expected throw");
    } catch (err) {
      expect((err as PolicyViolationError).rule).toBe("remediate_requires_review");
    }
  });

  it("rejects when review verdict is not changes_requested", () => {
    const run = makeRun({ state: RunState.AddressingReview });
    try {
      engine.assertCanRemediate(
        run,
        makeReview({ overallVerdict: "approved", findings: [makeFinding()] }),
      );
      throw new Error("expected throw");
    } catch (err) {
      expect((err as PolicyViolationError).rule).toBe(
        "remediate_requires_changes_requested_verdict",
      );
    }
  });

  it("rejects when review has no findings", () => {
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

  it("allows remediation when state, verdict and findings all line up", () => {
    const run = makeRun({ state: RunState.AddressingReview });
    expect(() =>
      engine.assertCanRemediate(
        run,
        makeReview({ overallVerdict: "changes_requested", findings: [makeFinding()] }),
      ),
    ).not.toThrow();
  });
});

describe("PolicyEngine.assertCanMarkReady", () => {
  const engine = new PolicyEngine();

  it("rejects when run has no PR", () => {
    const run = makeRun({ prNumber: null });
    try {
      engine.assertCanMarkReady(run, makeReview(), makeExecutionReport());
      throw new Error("expected throw");
    } catch (err) {
      expect((err as PolicyViolationError).rule).toBe("ready_requires_pr");
    }
  });

  it("rejects when there is no execution report", () => {
    const run = makeRun({ prNumber: 1 });
    try {
      engine.assertCanMarkReady(run, makeReview(), null);
      throw new Error("expected throw");
    } catch (err) {
      expect((err as PolicyViolationError).rule).toBe("ready_requires_execution_report");
    }
  });

  it.each(["lint", "typecheck", "tests"] as const)(
    "rejects when %s check failed",
    (checkName) => {
      const run = makeRun({ prNumber: 1 });
      const report = makeExecutionReport({
        checks: {
          lint: makeCheck(),
          typecheck: makeCheck(),
          tests: makeCheck(),
          [checkName]: makeCheck("fail"),
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

  it("allows a 'skip' check status through (only 'fail' blocks)", () => {
    const run = makeRun({ prNumber: 1 });
    const report = makeExecutionReport({
      checks: {
        lint: makeCheck("skip"),
        typecheck: makeCheck(),
        tests: makeCheck(),
      },
    });
    expect(() => engine.assertCanMarkReady(run, makeReview(), report)).not.toThrow();
  });

  it("rejects when there is no review", () => {
    const run = makeRun({ prNumber: 1 });
    try {
      engine.assertCanMarkReady(run, null, makeExecutionReport());
      throw new Error("expected throw");
    } catch (err) {
      expect((err as PolicyViolationError).rule).toBe("ready_requires_review");
    }
  });

  it("rejects when review verdict is not approved", () => {
    const run = makeRun({ prNumber: 1 });
    const review = makeReview({ overallVerdict: "changes_requested" });
    try {
      engine.assertCanMarkReady(run, review, makeExecutionReport());
      throw new Error("expected throw");
    } catch (err) {
      expect((err as PolicyViolationError).rule).toBe("ready_requires_approved_verdict");
    }
  });

  it("rejects when there are unresolved blocker findings even if verdict is approved", () => {
    const run = makeRun({ prNumber: 1 });
    const review = makeReview({
      overallVerdict: "approved",
      findings: [makeFinding({ severity: "blocker" }), makeFinding({ severity: "nit" })],
    });
    try {
      engine.assertCanMarkReady(run, review, makeExecutionReport());
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(PolicyViolationError);
      expect((err as PolicyViolationError).rule).toBe("ready_requires_blockers_resolved");
      expect((err as Error).message).toContain("1 unresolved blocker");
    }
  });

  it("allows marking ready when everything is green and approved with no blockers", () => {
    const run = makeRun({ prNumber: 1 });
    const review = makeReview({
      overallVerdict: "approved",
      findings: [makeFinding({ severity: "nit" })],
    });
    expect(() => engine.assertCanMarkReady(run, review, makeExecutionReport())).not.toThrow();
  });
});

describe("PolicyEngine.assertExecutorPaths", () => {
  const engine = new PolicyEngine();

  it("throws when a changed file starts with a protected path prefix", () => {
    const bundle = makeBundle({
      repo: {
        name: "repo",
        defaultBranch: "main",
        workingBranch: "feature",
        repoPath: "/repo",
        allowedPaths: [],
        protectedPaths: ["src/config/"],
      },
    });
    try {
      engine.assertExecutorPaths(["src/config/env.ts"], bundle);
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(PolicyViolationError);
      expect((err as PolicyViolationError).rule).toBe("executor_touched_protected_path");
      expect((err as Error).message).toContain("src/config/env.ts");
    }
  });

  it("does not throw when changed files do not touch any protected path", () => {
    const bundle = makeBundle({
      repo: {
        name: "repo",
        defaultBranch: "main",
        workingBranch: "feature",
        repoPath: "/repo",
        allowedPaths: [],
        protectedPaths: ["src/config/"],
      },
    });
    expect(() => engine.assertExecutorPaths(["src/utils/time.ts"], bundle)).not.toThrow();
  });

  it("throws when the number of changed files exceeds maxFilesChanged", () => {
    const bundle = makeBundle({
      constraints: {
        requiredChecks: [],
        maxFilesChanged: 2,
        maxDiffLines: 1000,
        forbiddenPatterns: [],
        mustNotTouch: [],
      },
    });
    try {
      engine.assertExecutorPaths(["a.ts", "b.ts", "c.ts"], bundle);
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(PolicyViolationError);
      expect((err as PolicyViolationError).rule).toBe("executor_exceeded_max_files");
      expect((err as Error).message).toContain("3");
      expect((err as Error).message).toContain("max: 2");
    }
  });

  it("allows exactly maxFilesChanged files (boundary, not exceeding)", () => {
    const bundle = makeBundle({
      constraints: {
        requiredChecks: [],
        maxFilesChanged: 2,
        maxDiffLines: 1000,
        forbiddenPatterns: [],
        mustNotTouch: [],
      },
    });
    expect(() => engine.assertExecutorPaths(["a.ts", "b.ts"], bundle)).not.toThrow();
  });
});
