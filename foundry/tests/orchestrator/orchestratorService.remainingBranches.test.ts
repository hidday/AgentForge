import { describe, it, expect, vi } from "vitest";
import { OrchestratorService } from "../../src/orchestrator/orchestratorService.js";
import { RunState } from "../../src/domain/runState.js";
import { RunEvent } from "../../src/domain/runEvent.js";
import {
  buildDeps,
  createStore,
  makeArtifact,
  makeExecutionReport,
  makePlan,
  makePlanReview,
  makeRun,
} from "./testSupport.js";

describe("OrchestratorService.startRun", () => {
  it("returns the existing active run without creating a new one or calling Linear/git", async () => {
    const existingRun = makeRun({ id: "run-existing", state: RunState.Planning });
    const store = createStore(makeRun({ id: "run-existing" }));
    const { deps, runRepo, linearClient, gitService } = buildDeps(store);
    runRepo.findActiveByIssueId.mockResolvedValue(existingRun);
    const svc = new OrchestratorService(deps as never);

    const result = await svc.startRun("LIN-1");

    expect(result).toBe(existingRun);
    expect(linearClient.getIssue).not.toHaveBeenCalled();
    expect(runRepo.create).not.toHaveBeenCalled();
    expect(gitService.setupRunWorktree).not.toHaveBeenCalled();
  });
});

describe("OrchestratorService.runPlanReview", () => {
  it("throws when there is no Plan artifact", async () => {
    const run = makeRun({ state: RunState.PlanReview });
    const store = createStore(run, []);
    const { deps } = buildDeps(store);
    const svc = new OrchestratorService(deps as never);

    await expect(svc.runPlanReview("run-1")).rejects.toThrow(
      "No plan artifact found for run run-1",
    );
  });

  it("on changes_requested: transitions PLAN_REVIEW_CHANGES_REQUESTED, posts the plan-review comment (covering both affectedStepId branches), and delegates to runPlanRevision", async () => {
    const run = makeRun({ state: RunState.PlanReview, planVersion: 1 });
    const store = createStore(run, [
      makeArtifact({ type: "Plan", version: 1, payloadJson: makePlan({ planVersion: 1 }) }),
    ]);
    const { deps, planReviewerAgent, linearClient } = buildDeps(store);
    planReviewerAgent.run.mockResolvedValue(
      makePlanReview({
        overallVerdict: "changes_requested",
        findings: [
          {
            id: "f1",
            severity: "blocker",
            type: "gap",
            affectedStepId: "s1",
            title: "Missing validation",
            details: "Step 1 needs input validation",
          },
          {
            id: "f2",
            severity: "nit",
            type: "style",
            title: "Wording",
            details: "Minor phrasing issue",
          },
        ],
      }),
    );
    const svc = new OrchestratorService(deps as never);
    const runPlanRevisionSpy = vi
      .spyOn(svc, "runPlanRevision")
      .mockResolvedValue(makeRun({ state: RunState.AwaitingPlanApproval }));

    const result = await svc.runPlanReview("run-1");

    const changesEvent = store.events.find(
      (e) => e.eventType === (RunEvent.PLAN_REVIEW_CHANGES_REQUESTED as string),
    );
    expect(changesEvent).toBeDefined();
    expect(runPlanRevisionSpy).toHaveBeenCalledWith("run-1");
    expect(result.state).toBe(RunState.AwaitingPlanApproval);

    const comment = linearClient.postComment.mock.calls.find((c: unknown[]) =>
      (c[1] as string).includes("AI Plan Review"),
    );
    expect(comment).toBeDefined();
    expect(comment![1]).toContain("Changes Requested");
    expect(comment![1]).toContain("(step s1)");
    expect(comment![1]).toContain("Missing validation");
    expect(comment![1]).toContain("Wording");
  });
});

describe("OrchestratorService.rejectPlan additional branches", () => {
  it("mode='fresh' skips loading prior plan/answers context (previousPlan/humanAnswers/researchedAnswers omitted)", async () => {
    const run = makeRun({ state: RunState.AwaitingPlanApproval, planVersion: 2 });
    const store = createStore(run, [
      makeArtifact({ type: "Plan", version: 2, payloadJson: makePlan({ planVersion: 2 }) }),
      makeArtifact({
        type: "HumanAnswers",
        version: 1,
        payloadJson: { answers: [{ questionId: "q1", answer: "yes" }] },
      }),
    ]);
    const { deps, plannerAgent, planReviewerAgent } = buildDeps(store);
    plannerAgent.run.mockResolvedValue(makePlan({ planVersion: 3, openQuestions: [] }));
    planReviewerAgent.run.mockResolvedValue(makePlanReview());

    const svc = new OrchestratorService(deps as never);
    await svc.rejectPlan("run-1", "start over", "api", "fresh");

    const callArgs = plannerAgent.run.mock.calls[0][2];
    expect(callArgs).not.toHaveProperty("previousPlan");
    expect(callArgs).not.toHaveProperty("humanAnswers");
    expect(callArgs).not.toHaveProperty("researchedAnswers");
    expect(callArgs).not.toHaveProperty("planReviewFindings");
    // humanFeedback still comes from the just-created RejectionContext artifact (mode-independent).
    expect(callArgs).toHaveProperty("humanFeedback", { planVersion: 2, feedback: "start over" });
  });

  it("pauses for human clarification when the re-plan after rejection still has blocking questions", async () => {
    const run = makeRun({ state: RunState.AwaitingPlanApproval, planVersion: 1 });
    const store = createStore(run, [
      makeArtifact({ type: "Plan", version: 1, payloadJson: makePlan({ planVersion: 1 }) }),
    ]);
    const { deps, plannerAgent, planReviewerAgent } = buildDeps(store);
    plannerAgent.run.mockResolvedValue(
      makePlan({
        planVersion: 2,
        openQuestions: [{ id: "q1", question: "Which region?", requiredForExecution: true }],
      }),
    );

    const svc = new OrchestratorService(deps as never);
    const result = await svc.rejectPlan("run-1", "needs more detail");

    expect(result.state).toBe(RunState.HumanClarificationNeeded);
    expect(planReviewerAgent.run).not.toHaveBeenCalled();
  });
});

describe("OrchestratorService.retryRun repo fallback", () => {
  it("falls back to repoRegistry.getDefaultRepo() when getRepoByName returns null", async () => {
    const run = makeRun({ state: RunState.Todo, branchName: null, repo: "unknown-repo" });
    const store = createStore(run, []);
    const { deps, plannerAgent, planReviewerAgent, repoRegistry, gitService } = buildDeps(store);
    repoRegistry.getRepoByName.mockReturnValue(null);
    mockDefaultReturn(repoRegistry);
    plannerAgent.run.mockImplementation(() => {
      store.artifacts.push(
        makeArtifact({ type: "Plan", version: 1, payloadJson: makePlan({ planVersion: 1, openQuestions: [] }) }),
      );
      return Promise.resolve(makePlan({ planVersion: 1, openQuestions: [] }));
    });
    planReviewerAgent.run.mockResolvedValue(makePlanReview());

    const svc = new OrchestratorService(deps as never);
    await svc.retryRun("run-1");

    expect(repoRegistry.getRepoByName).toHaveBeenCalledWith("unknown-repo");
    expect(repoRegistry.getDefaultRepo).toHaveBeenCalled();
    expect(gitService.setupRunWorktree).toHaveBeenCalledWith(
      "/tmp/main-repo",
      "run-1",
      "main",
      "ai/lin-1",
    );

    function mockDefaultReturn(reg: typeof repoRegistry) {
      reg.getDefaultRepo.mockReturnValue({
        name: "test-repo",
        defaultBranch: "main",
        allowedPaths: ["src/"],
        protectedPaths: [],
        constraints: {
          requiredChecks: [],
          maxFilesChanged: 10,
          maxDiffLines: 500,
          forbiddenPatterns: [],
          mustNotTouch: [],
        },
      });
    }
  });
});

describe("OrchestratorService buildTaskBundle default-branch reconciliation", () => {
  it("uses the remote default branch (and warns) when it differs from the configured value", async () => {
    const run = makeRun({ state: RunState.PlanReview, planVersion: 1 });
    const store = createStore(run, [
      makeArtifact({ type: "Plan", version: 1, payloadJson: makePlan({ planVersion: 1 }) }),
    ]);
    const { deps, githubClient, planReviewerAgent, logger, plannerAgent } = buildDeps(store);
    void plannerAgent;
    githubClient.getDefaultBranch.mockResolvedValue("trunk");
    planReviewerAgent.run.mockResolvedValue(makePlanReview());

    const svc = new OrchestratorService(deps as never);
    await svc.runPlanReview("run-1");

    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ repo: "test-repo", config: "main", remote: "trunk" }),
      "Config defaultBranch differs from GitHub, using remote value",
    );
    const bundleArg = planReviewerAgent.run.mock.calls[0][1] as { repo: { defaultBranch: string } };
    expect(bundleArg.repo.defaultBranch).toBe("trunk");
  });
});

describe("OrchestratorService.formatExecutionReportComment edge cases (via runExecution success)", () => {
  it("omits the Files changed section entirely when no files changed", async () => {
    const run = makeRun({ state: RunState.Implementing, approvedPlanVersion: 1, branchName: null });
    const store = createStore(run, [
      makeArtifact({ type: "Plan", version: 1, payloadJson: makePlan({ planVersion: 1 }) }),
    ]);
    const { deps, executorAgent, linearClient } = buildDeps(store);
    executorAgent.run.mockResolvedValue({
      report: makeExecutionReport({ filesChanged: [] }),
      prNumber: 1,
    });
    const svc = new OrchestratorService(deps as never);
    vi.spyOn(svc, "runReview").mockResolvedValue(makeRun());

    await svc.runExecution("run-1");

    const comment = linearClient.postComment.mock.calls[0][1] as string;
    expect(comment).not.toContain("Files changed");
  });

  it("collapses the file list inside <details> when more than 8 files changed", async () => {
    const run = makeRun({ state: RunState.Implementing, approvedPlanVersion: 1, branchName: null });
    const store = createStore(run, [
      makeArtifact({ type: "Plan", version: 1, payloadJson: makePlan({ planVersion: 1 }) }),
    ]);
    const { deps, executorAgent, linearClient } = buildDeps(store);
    const manyFiles = Array.from({ length: 9 }, (_, i) => `src/file${i}.ts`);
    executorAgent.run.mockResolvedValue({
      report: makeExecutionReport({ filesChanged: manyFiles }),
      prNumber: 1,
    });
    const svc = new OrchestratorService(deps as never);
    vi.spyOn(svc, "runReview").mockResolvedValue(makeRun());

    await svc.runExecution("run-1");

    const comment = linearClient.postComment.mock.calls[0][1] as string;
    expect(comment).toContain("<details>");
    expect(comment).toContain("Files changed (9)");
    expect(comment).toContain("src/file8.ts");
  });

  it("includes a Notes section when the execution report has notes", async () => {
    const run = makeRun({ state: RunState.Implementing, approvedPlanVersion: 1, branchName: null });
    const store = createStore(run, [
      makeArtifact({ type: "Plan", version: 1, payloadJson: makePlan({ planVersion: 1 }) }),
    ]);
    const { deps, executorAgent, linearClient } = buildDeps(store);
    executorAgent.run.mockResolvedValue({
      report: makeExecutionReport({ notes: ["Skipped optional migration"] }),
      prNumber: 1,
    });
    const svc = new OrchestratorService(deps as never);
    vi.spyOn(svc, "runReview").mockResolvedValue(makeRun());

    await svc.runExecution("run-1");

    const comment = linearClient.postComment.mock.calls[0][1] as string;
    expect(comment).toContain("### Notes");
    expect(comment).toContain("Skipped optional migration");
  });
});

describe("OrchestratorService.formatCodeReviewComment without a lineHint", () => {
  it("omits the :lineHint suffix when a finding has no lineHint", async () => {
    const run = makeRun({ state: RunState.AIReview, prNumber: 5 });
    const store = createStore(run, [
      makeArtifact({ type: "Plan", version: 1, payloadJson: makePlan() }),
      makeArtifact({ type: "ExecutionReport", version: 1, payloadJson: makeExecutionReport() }),
    ]);
    const { deps, reviewerAgent, linearClient, githubSync } = buildDeps(store);
    githubSync.postReviewFindings.mockResolvedValue(new Map());
    reviewerAgent.run.mockResolvedValue({
      reviewId: "rev-1",
      summary: "s",
      overallVerdict: "changes_requested",
      findings: [
        {
          id: "f1",
          severity: "important",
          type: "bug",
          file: "src/foo.ts",
          title: "No line hint",
          details: "d",
        },
      ],
    });
    const svc = new OrchestratorService(deps as never);
    vi.spyOn(svc, "runRemediation").mockResolvedValue(makeRun());

    await svc.runReview("run-1");

    const comment = linearClient.postComment.mock.calls.find((c: unknown[]) =>
      (c[1] as string).includes("AI Code Review"),
    );
    expect(comment![1]).toContain("(src/foo.ts)");
    expect(comment![1]).not.toContain("src/foo.ts:");
  });
});
