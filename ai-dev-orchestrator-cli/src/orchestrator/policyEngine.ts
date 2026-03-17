import { RunState } from "../domain/runState.js";
import type { Run } from "../domain/types.js";
import type { Plan } from "../schemas/plan.js";
import type { ExecutionReport } from "../schemas/executionReport.js";
import type { Review } from "../schemas/review.js";
import type { TaskBundle } from "../schemas/taskBundle.js";
import { PolicyViolationError } from "../utils/errors.js";

export class PolicyEngine {
  assertCanPlan(run: Run): void {
    if (run.state !== RunState.Todo && run.state !== RunState.Planning) {
      throw new PolicyViolationError(
        `Cannot plan when run is in state "${run.state}"`,
        "plan_requires_todo_or_planning_state",
      );
    }
  }

  assertCanExecute(run: Run, plan: Plan | null): void {
    if (run.state !== RunState.Implementing) {
      throw new PolicyViolationError(
        `Cannot execute when run is in state "${run.state}"`,
        "execute_requires_implementing_state",
      );
    }
    if (run.approvedPlanVersion == null) {
      throw new PolicyViolationError(
        "Cannot execute without explicit plan approval (approvedPlanVersion is not set)",
        "execute_requires_explicit_approval",
      );
    }
    if (!plan) {
      throw new PolicyViolationError(
        "Cannot execute without a plan artifact",
        "execute_requires_plan_artifact",
      );
    }
    if (plan.planVersion !== run.approvedPlanVersion) {
      throw new PolicyViolationError(
        `Plan version mismatch: plan is v${plan.planVersion} but approved version is v${run.approvedPlanVersion}`,
        "execute_plan_version_mismatch",
      );
    }
  }

  assertCanReview(run: Run, executionReport: ExecutionReport | null): void {
    if (run.state !== RunState.AIReview) {
      throw new PolicyViolationError(
        `Cannot review when run is in state "${run.state}"`,
        "review_requires_ai_review_state",
      );
    }
    if (!run.prNumber) {
      throw new PolicyViolationError("Cannot review without an existing PR", "review_requires_pr");
    }
    if (!executionReport) {
      throw new PolicyViolationError(
        "Cannot review without a completed execution report",
        "review_requires_execution_report",
      );
    }
  }

  assertCanRemediate(run: Run, review: Review | null): void {
    if (run.state !== RunState.AddressingReview) {
      throw new PolicyViolationError(
        `Cannot remediate when run is in state "${run.state}"`,
        "remediate_requires_addressing_review_state",
      );
    }
    if (!review) {
      throw new PolicyViolationError(
        "Cannot remediate without a review artifact",
        "remediate_requires_review",
      );
    }
    if (review.overallVerdict !== "changes_requested") {
      throw new PolicyViolationError(
        `Cannot remediate when review verdict is "${review.overallVerdict}" (must be "changes_requested")`,
        "remediate_requires_changes_requested_verdict",
      );
    }
    if (review.findings.length === 0) {
      throw new PolicyViolationError(
        "Cannot remediate without review findings",
        "remediate_requires_findings",
      );
    }
  }

  assertCanMarkReady(
    run: Run,
    review: Review | null,
    executionReport: ExecutionReport | null,
  ): void {
    if (!run.prNumber) {
      throw new PolicyViolationError(
        "Cannot mark ready without an existing PR",
        "ready_requires_pr",
      );
    }

    if (!executionReport) {
      throw new PolicyViolationError(
        "Cannot mark ready without execution report",
        "ready_requires_execution_report",
      );
    }

    const checks = executionReport.checks;
    if (
      checks.lint.status === "fail" ||
      checks.typecheck.status === "fail" ||
      checks.tests.status === "fail"
    ) {
      throw new PolicyViolationError(
        "Cannot mark ready with failing checks",
        "ready_requires_green_checks",
      );
    }

    if (!review) {
      throw new PolicyViolationError(
        "Cannot mark ready without a review (review stage must have run)",
        "ready_requires_review",
      );
    }

    if (review.overallVerdict !== "approved") {
      throw new PolicyViolationError(
        `Cannot mark ready when latest review verdict is "${review.overallVerdict}" (must be "approved")`,
        "ready_requires_approved_verdict",
      );
    }

    const unresolvedBlockers = review.findings.filter((f) => f.severity === "blocker");
    if (unresolvedBlockers.length > 0) {
      throw new PolicyViolationError(
        `Cannot mark ready with ${unresolvedBlockers.length} unresolved blocker findings`,
        "ready_requires_blockers_resolved",
      );
    }
  }

  assertExecutorPaths(filesChanged: string[], bundle: TaskBundle): void {
    for (const file of filesChanged) {
      const isProtected = bundle.repo.protectedPaths.some((p) => file.startsWith(p));
      if (isProtected) {
        throw new PolicyViolationError(
          `Executor modified protected path: ${file}`,
          "executor_touched_protected_path",
        );
      }
    }

    if (filesChanged.length > bundle.constraints.maxFilesChanged) {
      throw new PolicyViolationError(
        `Executor changed ${filesChanged.length} files (max: ${bundle.constraints.maxFilesChanged})`,
        "executor_exceeded_max_files",
      );
    }
  }

  assertReviewerRuntime(runtime: string): void {
    if (runtime !== "codex") {
      throw new PolicyViolationError(
        `Reviewer must use codex runtime, got "${runtime}"`,
        "reviewer_must_use_codex",
      );
    }
  }
}
