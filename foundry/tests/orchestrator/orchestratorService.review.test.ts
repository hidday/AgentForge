import { describe, it, expect } from "vitest";
import { OrchestratorService } from "../../src/orchestrator/orchestratorService.js";
import { RunState } from "../../src/domain/runState.js";
import { PolicyViolationError } from "../../src/utils/errors.js";
import {
  buildStorefulDeps,
  makeRun,
  makePlan,
  makeExecutionReport,
  makeReview,
  makeRemediation,
  stubReviewer,
  stubRemediation,
} from "./helpers/testKit.js";

function seedForReview(h: ReturnType<typeof buildStorefulDeps>) {
  return Promise.all([
    h.artifactRepo.create({
      runId: h.store.run.id,
      type: "Plan",
      version: 1,
      payloadJson: makePlan({ planVersion: 1 }),
    }),
    h.artifactRepo.create({
      runId: h.store.run.id,
      type: "ExecutionReport",
      version: 1,
      payloadJson: makeExecutionReport(),
    }),
  ]);
}

describe("OrchestratorService.runReview", () => {
  it("throws when the run is not in AIReview state", async () => {
    const run = makeRun({ id: "run-1", state: RunState.Implementing });
    const h = buildStorefulDeps(run);
    const svc = new OrchestratorService(h.deps as never);

    await expect(svc.runReview("run-1")).rejects.toThrow(PolicyViolationError);
  });

  it("fetches the PR diff, posts findings to GitHub, and marks ready when the review approves", async () => {
    const run = makeRun({ id: "run-1", state: RunState.AIReview, prNumber: 7 });
    const h = buildStorefulDeps(run);
    await seedForReview(h);
    stubReviewer(h, makeReview({ overallVerdict: "approved" }));

    const svc = new OrchestratorService(h.deps as never);
    const result = await svc.runReview("run-1");

    expect(h.githubClient.getPRDiff).toHaveBeenCalledWith("test-repo", 7);
    expect(result.state).toBe(RunState.ReadyForHumanReview);
    expect(h.linearClient.postComment).toHaveBeenCalledWith(
      "LIN-1",
      "AI workflow complete. Issue marked as **Ready for Human Review**.",
    );
  });

  it("throws PolicyViolationError when the run has no prNumber (review_requires_pr)", async () => {
    const run = makeRun({ id: "run-1", state: RunState.AIReview, prNumber: null });
    const h = buildStorefulDeps(run);
    await seedForReview(h);

    const svc = new OrchestratorService(h.deps as never);

    await expect(svc.runReview("run-1")).rejects.toMatchObject({
      rule: "review_requires_pr",
    });
    expect(h.githubClient.getPRDiff).not.toHaveBeenCalled();
    expect(h.reviewerAgent.run).not.toHaveBeenCalled();
  });

  // NOTE: runRemediation always finishes by calling markReady() against the
  // *original* (changes_requested) Review artifact -- it does not create a
  // fresh, approved Review artifact after remediation. So any changes_requested
  // path through runReview -> runRemediation -> markReady currently ends in a
  // PolicyViolationError ("ready_requires_approved_verdict"). This is a documented,
  // pre-existing limitation (see orchestratorService.executionScore.test.ts) --
  // these tests assert the real behavior, including the side effects that DO
  // happen before that final failure.
  it("posts findings to GitHub only when there is a prNumber AND findings exist", async () => {
    const run = makeRun({ id: "run-1", state: RunState.AIReview, prNumber: 7 });
    const h = buildStorefulDeps(run);
    await seedForReview(h);
    stubReviewer(
      h,
      makeReview({
        overallVerdict: "changes_requested",
        findings: [
          {
            id: "f1",
            severity: "important",
            type: "bug",
            file: "src/foo.ts",
            title: "Bug",
            details: "Fix it",
          },
        ],
      }),
    );
    stubRemediation(h, makeRemediation());

    const svc = new OrchestratorService(h.deps as never);
    await expect(svc.runReview("run-1")).rejects.toMatchObject({
      rule: "ready_requires_approved_verdict",
    });

    expect(h.githubSync.postReviewFindings).toHaveBeenCalledWith(
      "test-repo",
      7,
      expect.arrayContaining([expect.objectContaining({ id: "f1" })]),
      "changes_requested",
    );
  });

  it("does not post findings to GitHub when the review has no findings even with a prNumber", async () => {
    const run = makeRun({ id: "run-1", state: RunState.AIReview, prNumber: 7 });
    const h = buildStorefulDeps(run);
    await seedForReview(h);
    stubReviewer(h, makeReview({ overallVerdict: "approved", findings: [] }));

    const svc = new OrchestratorService(h.deps as never);
    await svc.runReview("run-1");

    expect(h.githubSync.postReviewFindings).not.toHaveBeenCalled();
  });

  it("requests changes and chains into remediation (invokes the remediation agent)", async () => {
    const run = makeRun({ id: "run-1", state: RunState.AIReview, prNumber: 7 });
    const h = buildStorefulDeps(run);
    await seedForReview(h);
    stubReviewer(
      h,
      makeReview({
        overallVerdict: "changes_requested",
        findings: [
          {
            id: "f1",
            severity: "blocker",
            type: "bug",
            file: "src/foo.ts",
            title: "Bug",
            details: "Fix it",
          },
        ],
      }),
    );
    stubRemediation(h, makeRemediation());

    const svc = new OrchestratorService(h.deps as never);
    await expect(svc.runReview("run-1")).rejects.toMatchObject({
      rule: "ready_requires_approved_verdict",
    });

    expect(h.remediationAgent.run).toHaveBeenCalledTimes(1);
    // The remediation lane itself completed (REMEDIATION_FINISHED + REVIEW_APPROVED
    // recorded) before markReady's policy check failed.
    const eventTypes = h.store.events.map((e) => e.eventType);
    expect(eventTypes).toContain("REMEDIATION_FINISHED");
    expect(eventTypes).toContain("REVIEW_APPROVED");
  });
});

describe("OrchestratorService.runRemediation", () => {
  function seedForRemediation(h: ReturnType<typeof buildStorefulDeps>) {
    return Promise.all([
      h.artifactRepo.create({
        runId: h.store.run.id,
        type: "Review",
        version: 1,
        payloadJson: makeReview({
          overallVerdict: "changes_requested",
          findings: [
            {
              id: "f1",
              severity: "important",
              type: "bug",
              file: "src/foo.ts",
              title: "Bug",
              details: "Fix it",
            },
          ],
        }),
      }),
      h.artifactRepo.create({
        runId: h.store.run.id,
        type: "ExecutionReport",
        version: 1,
        payloadJson: makeExecutionReport(),
      }),
    ]);
  }

  it("throws when review verdict is not changes_requested (policy)", async () => {
    const run = makeRun({ id: "run-1", state: RunState.AddressingReview, prNumber: 7 });
    const h = buildStorefulDeps(run);
    await h.artifactRepo.create({
      runId: "run-1",
      type: "Review",
      version: 1,
      payloadJson: makeReview({ overallVerdict: "approved" }),
    });
    await h.artifactRepo.create({
      runId: "run-1",
      type: "ExecutionReport",
      version: 1,
      payloadJson: makeExecutionReport(),
    });

    const svc = new OrchestratorService(h.deps as never);
    await expect(svc.runRemediation("run-1")).rejects.toThrow(PolicyViolationError);
  });

  it("commits the fix and posts execution/remediation comments and GitHub updates before the (pre-existing) markReady policy failure", async () => {
    const run = makeRun({
      id: "run-1",
      state: RunState.AddressingReview,
      prNumber: 7,
      branchName: "ai/run-1",
    });
    const h = buildStorefulDeps(run);
    await seedForRemediation(h);
    const remediation = makeRemediation();
    stubRemediation(h, remediation);

    const svc = new OrchestratorService(h.deps as never);
    await expect(svc.runRemediation("run-1", { f1: 555 })).rejects.toMatchObject({
      rule: "ready_requires_approved_verdict",
    });

    expect(h.gitService.assertBranch).toHaveBeenCalledWith("/tmp/worktree", "ai/run-1");
    expect(h.gitService.commitAndPush).toHaveBeenCalledWith(
      "/tmp/worktree",
      "ai/run-1",
      expect.stringContaining("Remediation"),
    );
    expect(h.githubSync.postExecutionReportUpdate).toHaveBeenCalledWith(
      "test-repo",
      7,
      remediation.executionReport,
    );
    expect(h.githubSync.postRemediationResolutions).toHaveBeenCalledWith(
      "test-repo",
      7,
      remediation.resolution,
      { f1: 555 },
    );
  });

  it("skips branch assertion/commit and GitHub sync when there is no branchName/prNumber", async () => {
    const run = makeRun({
      id: "run-1",
      state: RunState.AddressingReview,
      prNumber: null,
      branchName: null,
    });
    const h = buildStorefulDeps(run);
    await seedForRemediation(h);
    stubRemediation(h, makeRemediation());

    const svc = new OrchestratorService(h.deps as never);
    await expect(svc.runRemediation("run-1")).rejects.toMatchObject({
      rule: "ready_requires_pr",
    });

    expect(h.gitService.assertBranch).not.toHaveBeenCalled();
    expect(h.gitService.commitAndPush).not.toHaveBeenCalled();
    expect(h.githubSync.postExecutionReportUpdate).not.toHaveBeenCalled();
    expect(h.githubSync.postRemediationResolutions).not.toHaveBeenCalled();
  });
});

describe("OrchestratorService.markReady", () => {
  it("posts the ready-for-review comment when policy allows", async () => {
    const run = makeRun({ id: "run-1", state: RunState.AIReview, prNumber: 7 });
    const h = buildStorefulDeps(run);
    await h.artifactRepo.create({
      runId: "run-1",
      type: "Review",
      version: 1,
      payloadJson: makeReview({ overallVerdict: "approved" }),
    });
    await h.artifactRepo.create({
      runId: "run-1",
      type: "ExecutionReport",
      version: 1,
      payloadJson: makeExecutionReport(),
    });

    const svc = new OrchestratorService(h.deps as never);
    await svc.markReady("run-1");

    expect(h.linearClient.postComment).toHaveBeenCalledWith(
      "LIN-1",
      "AI workflow complete. Issue marked as **Ready for Human Review**.",
    );
  });

  it("throws PolicyViolationError without a PR", async () => {
    const run = makeRun({ id: "run-1", state: RunState.AIReview, prNumber: null });
    const h = buildStorefulDeps(run);
    const svc = new OrchestratorService(h.deps as never);

    await expect(svc.markReady("run-1")).rejects.toThrow(PolicyViolationError);
  });

  it("throws PolicyViolationError with unresolved blocker findings", async () => {
    const run = makeRun({ id: "run-1", state: RunState.AIReview, prNumber: 7 });
    const h = buildStorefulDeps(run);
    await h.artifactRepo.create({
      runId: "run-1",
      type: "ExecutionReport",
      version: 1,
      payloadJson: makeExecutionReport(),
    });
    await h.artifactRepo.create({
      runId: "run-1",
      type: "Review",
      version: 1,
      payloadJson: makeReview({
        overallVerdict: "approved",
        findings: [
          {
            id: "f1",
            severity: "blocker",
            type: "bug",
            file: "x.ts",
            title: "t",
            details: "d",
          },
        ],
      }),
    });

    const svc = new OrchestratorService(h.deps as never);
    await expect(svc.markReady("run-1")).rejects.toThrow(PolicyViolationError);
  });
});
