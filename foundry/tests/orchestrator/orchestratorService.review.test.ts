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
  makeRemediation,
} from "./orchestratorServiceTestHelpers.js";

function runInAIReview(overrides: Record<string, unknown> = {}) {
  return makeRun({ state: RunState.AIReview, prNumber: 42, ...overrides });
}

function withReviewArtifacts(
  artifactRepo: { findLatestByType: ReturnType<typeof vi.fn> },
  byType: Record<string, unknown>,
) {
  artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) =>
    Promise.resolve(byType[type] ?? null),
  );
}

describe("OrchestratorService.runReview", () => {
  it("runs remediation when the reviewer requests changes", async () => {
    const { deps, runRepo, artifactRepo, githubClient, githubSync, reviewerAgent } = buildDeps(
      {},
      runInAIReview(),
    );
    withReviewArtifacts(artifactRepo, {
      ExecutionReport: makeArtifact({ type: "ExecutionReport", payloadJson: makeExecutionReport() }),
      Plan: makeArtifact({ type: "Plan", payloadJson: makePlan() }),
    });
    reviewerAgent.run.mockResolvedValue(
      makeReview({
        overallVerdict: "changes_requested",
        findings: [
          { id: "f1", severity: "important", type: "bug", file: "a.ts", title: "Bug", details: "x" },
        ],
      }),
    );
    githubSync.postReviewFindings.mockResolvedValue(new Map([["f1", 100]]));
    const svc = new OrchestratorService(deps as never);
    const remediationSpy = vi
      .spyOn(svc, "runRemediation")
      .mockResolvedValue(makeRun({ state: RunState.AddressingReview }));

    const result = await svc.runReview("run-1");

    expect(githubClient.getPRDiff).toHaveBeenCalledWith("test-repo", 42);
    expect(githubSync.postReviewFindings).toHaveBeenCalled();
    expect(remediationSpy).toHaveBeenCalledWith("run-1", { f1: 100 });
    expect(runRepo.update).toHaveBeenCalledWith("run-1", { reviewerRuntime: "codex" });
    expect(result.state).toBe(RunState.AddressingReview);
  });

  it("marks the run ready when the reviewer approves", async () => {
    const { deps, artifactRepo, githubSync, reviewerAgent } = buildDeps({}, runInAIReview());
    withReviewArtifacts(artifactRepo, {
      ExecutionReport: makeArtifact({ type: "ExecutionReport", payloadJson: makeExecutionReport() }),
      Plan: makeArtifact({ type: "Plan", payloadJson: makePlan() }),
    });
    reviewerAgent.run.mockResolvedValue(makeReview({ overallVerdict: "approved" }));
    const svc = new OrchestratorService(deps as never);
    const markReadySpy = vi.spyOn(svc, "markReady").mockResolvedValue(makeRun());

    const result = await svc.runReview("run-1");

    expect(githubSync.postReviewFindings).not.toHaveBeenCalled();
    expect(markReadySpy).toHaveBeenCalledWith("run-1");
    expect(result.state).toBe(RunState.ReadyForHumanReview);
  });

  it("skips fetching a PR diff when the run has no PR number", async () => {
    const { deps, artifactRepo, githubClient, reviewerAgent } = buildDeps(
      {},
      runInAIReview({ prNumber: null }),
    );
    withReviewArtifacts(artifactRepo, {
      ExecutionReport: makeArtifact({ type: "ExecutionReport", payloadJson: makeExecutionReport() }),
      Plan: makeArtifact({ type: "Plan", payloadJson: makePlan() }),
    });
    reviewerAgent.run.mockResolvedValue(makeReview({ overallVerdict: "approved" }));
    const svc = new OrchestratorService(deps as never);
    vi.spyOn(svc, "markReady").mockResolvedValue(makeRun());

    await svc.runReview("run-1");

    expect(githubClient.getPRDiff).not.toHaveBeenCalled();
    expect(reviewerAgent.run).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      "",
      expect.anything(),
      "run-1",
    );
  });

  it("rejects when the run is not in AIReview state", async () => {
    const { deps } = buildDeps({}, makeRun({ state: RunState.Todo }));
    const svc = new OrchestratorService(deps as never);
    await expect(svc.runReview("run-1")).rejects.toThrow(/Cannot review/);
  });
});

function runInAddressingReview(overrides: Record<string, unknown> = {}) {
  return makeRun({ state: RunState.AddressingReview, branchName: "ai/run-1", prNumber: 42, ...overrides });
}

describe("OrchestratorService.runRemediation", () => {
  it("applies remediation, posts updates, and marks the run ready", async () => {
    const { deps, runRepo, artifactRepo, gitService, githubSync, linearClient, remediationAgent } =
      buildDeps({}, runInAddressingReview());
    withReviewArtifacts(artifactRepo, {
      Review: makeArtifact({
        type: "Review",
        payloadJson: makeReview({
          overallVerdict: "changes_requested",
          findings: [
            { id: "f1", severity: "important", type: "bug", file: "a.ts", title: "Bug", details: "x" },
          ],
        }),
      }),
      ExecutionReport: makeArtifact({ type: "ExecutionReport", payloadJson: makeExecutionReport() }),
    });
    remediationAgent.run.mockResolvedValue(makeRemediation());
    const svc = new OrchestratorService(deps as never);
    const markReadySpy = vi.spyOn(svc, "markReady").mockResolvedValue(makeRun());

    const result = await svc.runRemediation("run-1", { f1: 100 });

    expect(gitService.commitAndPush).toHaveBeenCalled();
    expect(runRepo.update).toHaveBeenCalledWith("run-1", { remediationRuntime: "claude-code" });
    expect(githubSync.postExecutionReportUpdate).toHaveBeenCalled();
    expect(githubSync.postRemediationResolutions).toHaveBeenCalledWith(
      "test-repo",
      42,
      [],
      { f1: 100 },
    );
    expect(linearClient.postComment).toHaveBeenCalledTimes(2);
    expect(markReadySpy).toHaveBeenCalledWith("run-1");
    expect(result.state).toBe(RunState.AIReview);
  });

  it("rejects when there is no review to remediate against", async () => {
    const { deps } = buildDeps({}, runInAddressingReview());
    const svc = new OrchestratorService(deps as never);
    await expect(svc.runRemediation("run-1")).rejects.toThrow(/Cannot remediate/);
  });

  it("rejects when the run is not in AddressingReview state", async () => {
    const { deps } = buildDeps({}, makeRun({ state: RunState.Todo }));
    const svc = new OrchestratorService(deps as never);
    await expect(svc.runRemediation("run-1")).rejects.toThrow(/Cannot remediate/);
  });
});

describe("OrchestratorService.markReady", () => {
  it("posts a completion comment when the policy allows marking ready", async () => {
    const { deps, artifactRepo, linearClient } = buildDeps(
      {},
      makeRun({ state: RunState.AIReview, prNumber: 42 }),
    );
    withReviewArtifacts(artifactRepo, {
      Review: makeArtifact({ type: "Review", payloadJson: makeReview({ overallVerdict: "approved" }) }),
      ExecutionReport: makeArtifact({ type: "ExecutionReport", payloadJson: makeExecutionReport() }),
    });
    const svc = new OrchestratorService(deps as never);

    const result = await svc.markReady("run-1");

    expect(linearClient.postComment).toHaveBeenCalledWith(
      expect.any(String),
      expect.stringContaining("Ready for Human Review"),
    );
    expect(result).toBeDefined();
  });

  it("throws when there is no PR to mark ready", async () => {
    const { deps, artifactRepo } = buildDeps({}, makeRun({ state: RunState.AIReview, prNumber: null }));
    withReviewArtifacts(artifactRepo, {
      Review: makeArtifact({ type: "Review", payloadJson: makeReview({ overallVerdict: "approved" }) }),
      ExecutionReport: makeArtifact({ type: "ExecutionReport", payloadJson: makeExecutionReport() }),
    });
    const svc = new OrchestratorService(deps as never);
    await expect(svc.markReady("run-1")).rejects.toThrow(/Cannot mark ready/);
  });
});
