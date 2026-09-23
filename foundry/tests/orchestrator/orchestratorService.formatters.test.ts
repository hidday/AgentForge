import { describe, it, expect, vi } from "vitest";
import { OrchestratorService } from "../../src/orchestrator/orchestratorService.js";
import { RunState } from "../../src/domain/runState.js";
import {
  buildFullDeps,
  makeRun,
  makePlan,
  makePlanReview,
  makeReview,
  makeExecutionReport,
} from "./_helpers/fixtures.js";

// The comment-formatting helpers (formatPlanComment, formatExecutionReportComment,
// formatPlanReviewComment, formatCodeReviewComment) are private; exercised here
// through the public flows that call them, targeting branches not yet covered
// elsewhere (risks list, open questions list, "skip" check icon, findings with
// no affectedStepId/lineHint).

describe("formatPlanComment via runPlanReview (approved path)", () => {
  it("includes an Open Questions section and a Risks section when the plan has both", async () => {
    const run = makeRun({ id: "run-1", state: RunState.PlanReview });
    const { deps, artifactRepo, planReviewerAgent, linearClient } = buildFullDeps(run);
    artifactRepo.seed(
      "Plan",
      makePlan({
        risks: ["Data migration could be slow", "Rollback plan needed"],
        openQuestions: [
          { id: "q1", question: "Optional nice-to-have?", requiredForExecution: false },
          { id: "q2", question: "Blocking one?", requiredForExecution: true },
        ],
      }),
    );
    planReviewerAgent.run.mockResolvedValue(makePlanReview({ overallVerdict: "approved" }));

    const svc = new OrchestratorService(deps as never);
    await svc.runPlanReview("run-1");

    const commentCall = (linearClient.postComment as ReturnType<typeof vi.fn>).mock.calls.find(
      (call) => typeof call[1] === "string" && (call[1] as string).includes("AI Plan (v"),
    );
    expect(commentCall).toBeDefined();
    const body = commentCall![1] as string;
    expect(body).toContain("**Open Questions:**");
    expect(body).toContain("Blocking one? *blocks execution*");
    expect(body).toContain("Optional nice-to-have?");
    expect(body).not.toContain("Optional nice-to-have? *blocks execution*");
    expect(body).toContain("**Risks:**");
    expect(body).toContain("Data migration could be slow");
  });

  it("omits the Open Questions and Risks sections when the plan has neither", async () => {
    const run = makeRun({ id: "run-1", state: RunState.PlanReview });
    const { deps, artifactRepo, planReviewerAgent, linearClient } = buildFullDeps(run);
    artifactRepo.seed("Plan", makePlan({ risks: [], openQuestions: [] }));
    planReviewerAgent.run.mockResolvedValue(makePlanReview({ overallVerdict: "approved" }));

    const svc = new OrchestratorService(deps as never);
    await svc.runPlanReview("run-1");

    const commentCall = (linearClient.postComment as ReturnType<typeof vi.fn>).mock.calls.find(
      (call) => typeof call[1] === "string" && (call[1] as string).includes("AI Plan (v"),
    );
    const body = commentCall![1] as string;
    expect(body).not.toContain("**Open Questions:**");
    expect(body).not.toContain("**Risks:**");
  });
});

describe("formatExecutionReportComment 'skip' check icon via runExecution", () => {
  it("renders the heavy-minus-sign icon for a 'skip' status check", async () => {
    const run = makeRun({
      id: "run-1",
      state: RunState.Implementing,
      approvedPlanVersion: 1,
      branchName: null,
    });
    const { deps, artifactRepo, executorAgent, reviewerAgent, linearClient } = buildFullDeps(run);
    artifactRepo.seed("Plan", makePlan({ planVersion: 1 }));
    const report = makeExecutionReport({
      checks: {
        lint: { status: "skip", details: "linting disabled" },
        typecheck: { status: "pass", details: "ok" },
        tests: { status: "pass", details: "ok" },
      },
    });
    executorAgent.run.mockResolvedValue({ report, prNumber: 202 });
    artifactRepo.seed("ExecutionReport", report);
    const review = makeReview({ overallVerdict: "approved" });
    reviewerAgent.run.mockResolvedValue(review);
    artifactRepo.seed("Review", review);

    const svc = new OrchestratorService(deps as never);
    await svc.runExecution("run-1");

    const commentCall = (linearClient.postComment as ReturnType<typeof vi.fn>).mock.calls.find(
      (call) => typeof call[1] === "string" && (call[1] as string).includes("Execution Report"),
    );
    const body = commentCall![1] as string;
    expect(body).toContain(":heavy_minus_sign:");
    expect(body).toContain("linting disabled");
  });
});

describe("formatExecutionReportComment 'fail' check icon via runExecution timeout-free path", () => {
  it("renders the :x: icon for a 'fail' status check", async () => {
    const run = makeRun({
      id: "run-1",
      state: RunState.Implementing,
      approvedPlanVersion: 1,
      branchName: null,
    });
    const { deps, artifactRepo, executorAgent, reviewerAgent, linearClient } = buildFullDeps(run);
    artifactRepo.seed("Plan", makePlan({ planVersion: 1 }));
    const report = makeExecutionReport({
      checks: {
        lint: { status: "pass", details: "ok" },
        typecheck: { status: "pass", details: "ok" },
        tests: { status: "fail", details: "1 test failing" },
      },
    });
    executorAgent.run.mockResolvedValue({ report, prNumber: 202 });
    artifactRepo.seed("ExecutionReport", report);
    // assertCanExecute/assertExecutorPaths don't care about check status; the
    // policy that *rejects* failing checks (assertCanMarkReady) is exercised
    // separately in orchestratorService.runReview.test.ts. Here we only need
    // runReview to be reachable up to posting the comment, so make the review
    // path approved (checks failing doesn't block AI code review itself).
    const review = makeReview({ overallVerdict: "approved" });
    reviewerAgent.run.mockResolvedValue(review);

    const svc = new OrchestratorService(deps as never);
    // markReady will reject (failing checks), but the execution-report comment
    // is posted before that, which is what this test targets.
    await svc.runExecution("run-1").catch(() => undefined);

    const commentCall = (linearClient.postComment as ReturnType<typeof vi.fn>).mock.calls.find(
      (call) => typeof call[1] === "string" && (call[1] as string).includes("Execution Report"),
    );
    const body = commentCall![1] as string;
    expect(body).toContain(":x:");
    expect(body).toContain("1 test failing");
  });
});

describe("formatPlanReviewComment affectedStepId branch via runPlanReview (changes_requested)", () => {
  it("omits the '(step ...)' suffix when a finding has no affectedStepId", async () => {
    const run = makeRun({ id: "run-1", state: RunState.PlanReview, planVersion: 1 });
    const { deps, artifactRepo, planReviewerAgent, planReviserAgent, linearClient } =
      buildFullDeps(run);
    artifactRepo.seed("Plan", makePlan({ planVersion: 1 }));
    planReviewerAgent.run.mockResolvedValue(
      makePlanReview({
        overallVerdict: "changes_requested",
        findings: [
          { id: "f1", severity: "nit", type: "style", title: "General nit", details: "no step tied" },
        ],
      }),
    );
    planReviserAgent.run.mockResolvedValue({
      revision: { dispositions: [] },
      revisedPlan: makePlan({ planVersion: 2 }),
    });

    const svc = new OrchestratorService(deps as never);
    await svc.runPlanReview("run-1");

    const commentCall = (linearClient.postComment as ReturnType<typeof vi.fn>).mock.calls.find(
      (call) => typeof call[1] === "string" && (call[1] as string).includes("General nit"),
    );
    expect(commentCall).toBeDefined();
    const body = commentCall![1] as string;
    expect(body).not.toContain("(step");
  });
});

describe("formatCodeReviewComment lineHint branch via runReview (changes_requested)", () => {
  it("omits the ':lineHint' suffix when a finding has no lineHint", async () => {
    const run = makeRun({ id: "run-1", state: RunState.AIReview, prNumber: 202 });
    const { deps, artifactRepo, reviewerAgent, linearClient } = buildFullDeps(run);
    artifactRepo.seed("ExecutionReport", makeExecutionReport());
    artifactRepo.seed("Plan", makePlan());
    const review = makeReview({
      overallVerdict: "changes_requested",
      findings: [
        { id: "f1", severity: "important", type: "bug", file: "src/a.ts", title: "No line hint", details: "..." },
      ],
    });
    reviewerAgent.run.mockResolvedValue(review);
    artifactRepo.seed("Review", review);

    const svc = new OrchestratorService(deps as never);
    // This chains into runRemediation, which will throw (documented pre-existing
    // gap: markReady after remediation currently requires an approved Review that
    // remediation never writes). We only need the changes_requested comment to
    // have been posted before that failure, so catch and ignore it.
    await svc.runReview("run-1").catch(() => undefined);

    const commentCall = (linearClient.postComment as ReturnType<typeof vi.fn>).mock.calls.find(
      (call) => typeof call[1] === "string" && (call[1] as string).includes("No line hint"),
    );
    expect(commentCall).toBeDefined();
    const body = commentCall![1] as string;
    expect(body).toContain("(src/a.ts)\n");
    expect(body).not.toMatch(/src\/a\.ts:\d/);
  });

  it("includes the ':lineHint' suffix when a finding has a lineHint", async () => {
    const run = makeRun({ id: "run-1", state: RunState.AIReview, prNumber: 202 });
    const { deps, artifactRepo, reviewerAgent, linearClient } = buildFullDeps(run);
    artifactRepo.seed("ExecutionReport", makeExecutionReport());
    artifactRepo.seed("Plan", makePlan());
    const review = makeReview({
      overallVerdict: "changes_requested",
      findings: [
        {
          id: "f1",
          severity: "important",
          type: "bug",
          file: "src/a.ts",
          lineHint: 42,
          title: "Has a line hint",
          details: "...",
        },
      ],
    });
    reviewerAgent.run.mockResolvedValue(review);
    artifactRepo.seed("Review", review);

    const svc = new OrchestratorService(deps as never);
    await svc.runReview("run-1").catch(() => undefined);

    const commentCall = (linearClient.postComment as ReturnType<typeof vi.fn>).mock.calls.find(
      (call) => typeof call[1] === "string" && (call[1] as string).includes("Has a line hint"),
    );
    expect(commentCall).toBeDefined();
    expect(commentCall![1] as string).toContain("(src/a.ts:42)");
  });
});
