import { describe, it, expect, vi } from "vitest";
import { OrchestratorService } from "../../src/orchestrator/orchestratorService.js";
import { RunState } from "../../src/domain/runState.js";
import {
  buildDeps,
  makeRun,
  makePlan,
  makeArtifact,
  makeExecutionReport,
  makeReview,
} from "./orchestratorTestHelpers.js";

function withArtifacts(
  artifactRepo: ReturnType<typeof buildDeps>["artifactRepo"],
  overrides: Record<string, unknown> = {},
) {
  artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
    if (type === "Plan") return Promise.resolve(makeArtifact({ type: "Plan", payloadJson: makePlan() }));
    if (type === "ExecutionReport") {
      return Promise.resolve(
        makeArtifact({ type: "ExecutionReport", payloadJson: makeExecutionReport() }),
      );
    }
    if (type === "Review" && overrides.review) {
      return Promise.resolve(makeArtifact({ type: "Review", payloadJson: overrides.review }));
    }
    return Promise.resolve(null);
  });
}

describe("OrchestratorService.runReview", () => {
  it("fetches the PR diff and approves straight to markReady when the review is clean", async () => {
    const { deps, runRepo, artifactRepo, githubClient, reviewerAgent } = buildDeps();
    runRepo.setCurrent(makeRun({ state: RunState.AIReview, prNumber: 9 }));
    withArtifacts(artifactRepo);
    reviewerAgent.run.mockResolvedValue(makeReview({ overallVerdict: "approved" }));
    const svc = new OrchestratorService(deps as never);
    const markReadySpy = vi.spyOn(svc, "markReady").mockResolvedValue(makeRun());

    const run = await svc.runReview("run-1");

    expect(githubClient.getPRDiff).toHaveBeenCalledWith("test-repo", 9);
    expect(run.state).toBe(RunState.ReadyForHumanReview);
    expect(markReadySpy).toHaveBeenCalledWith("run-1");
  });

  it("posts review findings to GitHub and starts remediation when changes are requested", async () => {
    const { deps, runRepo, artifactRepo, githubSync, reviewerAgent } = buildDeps();
    runRepo.setCurrent(makeRun({ state: RunState.AIReview, prNumber: 9 }));
    withArtifacts(artifactRepo);
    reviewerAgent.run.mockResolvedValue(
      makeReview({
        overallVerdict: "changes_requested",
        findings: [
          { id: "f1", severity: "blocker", type: "bug", file: "a.ts", title: "t", details: "d" },
        ],
      }),
    );
    githubSync.postReviewFindings.mockResolvedValue(new Map([["f1", 500]]));
    const svc = new OrchestratorService(deps as never);
    const runRemediationSpy = vi
      .spyOn(svc, "runRemediation")
      .mockResolvedValue(makeRun({ state: RunState.AddressingReview }));

    const run = await svc.runReview("run-1");

    expect(githubSync.postReviewFindings).toHaveBeenCalledWith(
      "test-repo",
      9,
      expect.any(Array),
      "changes_requested",
    );
    expect(runRemediationSpy).toHaveBeenCalledWith("run-1", { f1: 500 });
    expect(run.state).toBe(RunState.AddressingReview);
  });

  it("does not post findings to GitHub when the review has no findings", async () => {
    const { deps, runRepo, artifactRepo, githubSync, reviewerAgent } = buildDeps();
    runRepo.setCurrent(makeRun({ state: RunState.AIReview, prNumber: 9 }));
    withArtifacts(artifactRepo);
    reviewerAgent.run.mockResolvedValue(makeReview({ overallVerdict: "changes_requested", findings: [] }));
    const svc = new OrchestratorService(deps as never);
    vi.spyOn(svc, "runRemediation").mockResolvedValue(makeRun());

    await svc.runReview("run-1");

    expect(githubSync.postReviewFindings).not.toHaveBeenCalled();
  });

  it("rejects when the run has no PR at all (policy: review requires a PR)", async () => {
    const { deps, runRepo, artifactRepo } = buildDeps();
    runRepo.setCurrent(makeRun({ state: RunState.AIReview, prNumber: null }));
    withArtifacts(artifactRepo);
    const svc = new OrchestratorService(deps as never);

    await expect(svc.runReview("run-1")).rejects.toThrow(/without an existing PR/);
  });
});

describe("OrchestratorService.runRemediation", () => {
  it("remediates, pushes a checkpoint commit, and posts GitHub updates when there is a PR", async () => {
    const { deps, runRepo, artifactRepo, gitService, githubSync, remediationAgent } = buildDeps();
    runRepo.setCurrent(
      makeRun({ state: RunState.AddressingReview, prNumber: 9, branchName: "ai/run-1" }),
    );
    withArtifacts(artifactRepo, {
      review: makeReview({
        overallVerdict: "changes_requested",
        findings: [
          { id: "f1", severity: "blocker", type: "bug", file: "a.ts", title: "t", details: "d" },
        ],
      }),
    });
    const svc = new OrchestratorService(deps as never);
    const markReadySpy = vi.spyOn(svc, "markReady").mockResolvedValue(makeRun());

    const run = await svc.runRemediation("run-1", { f1: 500 });

    expect(remediationAgent.run).toHaveBeenCalledTimes(1);
    expect(gitService.commitAndPush).toHaveBeenCalledWith(
      "/tmp/run-1",
      "ai/run-1",
      expect.stringContaining("Remediation"),
    );
    expect(githubSync.postExecutionReportUpdate).toHaveBeenCalledWith(
      "test-repo",
      9,
      expect.objectContaining({ executionVersion: 2 }),
    );
    expect(githubSync.postRemediationResolutions).toHaveBeenCalledWith("test-repo", 9, [], { f1: 500 });
    expect(markReadySpy).toHaveBeenCalledWith("run-1");
    expect(run.state).toBe(RunState.ReadyForHumanReview);
  });

  it("skips GitHub updates when the run has no PR number", async () => {
    const { deps, runRepo, artifactRepo, githubSync } = buildDeps();
    runRepo.setCurrent(makeRun({ state: RunState.AddressingReview, prNumber: null, branchName: null }));
    withArtifacts(artifactRepo, {
      review: makeReview({
        overallVerdict: "changes_requested",
        findings: [
          { id: "f1", severity: "blocker", type: "bug", file: "a.ts", title: "t", details: "d" },
        ],
      }),
    });
    const svc = new OrchestratorService(deps as never);
    vi.spyOn(svc, "markReady").mockResolvedValue(makeRun());

    await svc.runRemediation("run-1");

    expect(githubSync.postExecutionReportUpdate).not.toHaveBeenCalled();
    expect(githubSync.postRemediationResolutions).not.toHaveBeenCalled();
  });

  it("rejects remediation when the review has no findings", async () => {
    const { deps, runRepo, artifactRepo } = buildDeps();
    runRepo.setCurrent(makeRun({ state: RunState.AddressingReview }));
    withArtifacts(artifactRepo, {
      review: makeReview({ overallVerdict: "changes_requested", findings: [] }),
    });
    const svc = new OrchestratorService(deps as never);

    await expect(svc.runRemediation("run-1")).rejects.toThrow(/without review findings/);
  });
});

describe("OrchestratorService.markReady", () => {
  it("posts the completion comment when policy allows marking ready", async () => {
    const { deps, runRepo, artifactRepo, linearClient } = buildDeps();
    runRepo.setCurrent(makeRun({ state: RunState.ReadyForHumanReview, prNumber: 9 }));
    withArtifacts(artifactRepo, { review: makeReview({ overallVerdict: "approved" }) });
    const svc = new OrchestratorService(deps as never);

    const run = await svc.markReady("run-1");

    expect(linearClient.postComment).toHaveBeenCalledWith(
      "LIN-1",
      expect.stringContaining("Ready for Human Review"),
    );
    expect(run.state).toBe(RunState.ReadyForHumanReview);
  });

  it("rejects when there is no execution report", async () => {
    const { deps, runRepo, artifactRepo } = buildDeps();
    runRepo.setCurrent(makeRun({ state: RunState.ReadyForHumanReview, prNumber: 9 }));
    artifactRepo.findLatestByType.mockResolvedValue(null);
    const svc = new OrchestratorService(deps as never);

    await expect(svc.markReady("run-1")).rejects.toThrow(/without execution report/);
  });
});
