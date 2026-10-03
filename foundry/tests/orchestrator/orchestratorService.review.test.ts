import { describe, it, expect, vi } from "vitest";
import { OrchestratorService } from "../../src/orchestrator/orchestratorService.js";
import { RunState } from "../../src/domain/runState.js";
import { PolicyViolationError } from "../../src/utils/errors.js";
import {
  buildDeps,
  makeRun,
  makePlan,
  makeArtifact,
  makeExecutionReport,
  makeReview,
} from "./_fixtures.js";

describe("OrchestratorService.runReview", () => {
  it("throws PolicyViolationError when run is not in AIReview state", async () => {
    const { deps, runRepo, artifactRepo, reviewerAgent } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    runRepo.findById.mockResolvedValue(makeRun({ state: RunState.Implementing, prNumber: 1 }));
    artifactRepo.findLatestByType.mockImplementation((_: string, type: string) =>
      type === "ExecutionReport" ? Promise.resolve(makeArtifact({ type: "ExecutionReport", payloadJson: makeExecutionReport() })) : Promise.resolve(null),
    );

    await expect(svc.runReview("run-1")).rejects.toBeInstanceOf(PolicyViolationError);
    expect(reviewerAgent.run).not.toHaveBeenCalled();
  });

  it("approved verdict: transitions to ReadyForHumanReview via markReady, without remediation", async () => {
    const { deps, runRepo, artifactRepo, reviewerAgent, githubSync, linearClient } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    const run = makeRun({ state: RunState.AIReview, prNumber: 7, approvedPlanVersion: 1 });
    runRepo.findById.mockResolvedValue(run);
    artifactRepo.findLatestByType.mockImplementation((_: string, type: string) => {
      if (type === "ExecutionReport") return Promise.resolve(makeArtifact({ type: "ExecutionReport", payloadJson: makeExecutionReport() }));
      if (type === "Plan") return Promise.resolve(makeArtifact({ type: "Plan", payloadJson: makePlan() }));
      if (type === "Review") return Promise.resolve(makeArtifact({ type: "Review", payloadJson: makeReview({ overallVerdict: "approved" }) }));
      return Promise.resolve(null);
    });
    (deps.linearClient.getIssue as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "LIN-1", title: "Test", description: "Test", branchName: "ai/lin-1", labels: [], priority: 0,
    });

    reviewerAgent.run.mockResolvedValue(makeReview({ overallVerdict: "approved" }));
    runRepo.update.mockResolvedValue(makeRun({ reviewerRuntime: "codex", state: RunState.AIReview, prNumber: 7 }));
    runRepo.updateState.mockResolvedValue(makeRun({ state: RunState.ReadyForHumanReview, prNumber: 7 }));

    const markReadySpy = vi.spyOn(svc, "markReady").mockResolvedValue(
      makeRun({ state: RunState.ReadyForHumanReview }),
    );

    const result = await svc.runReview("run-1");

    expect(githubSync.postReviewFindings).not.toHaveBeenCalled();
    expect(markReadySpy).toHaveBeenCalledWith("run-1");
    expect(linearClient.postComment).not.toHaveBeenCalled(); // approved path posts no code-review comment itself
    expect(result.state).toBe(RunState.ReadyForHumanReview); // transitionAndRecord's mocked return
  });

  it("changes_requested verdict: posts findings to GitHub and Linear, then runs remediation", async () => {
    const { deps, runRepo, artifactRepo, reviewerAgent, githubSync, linearClient } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    const run = makeRun({ state: RunState.AIReview, prNumber: 7, approvedPlanVersion: 1 });
    runRepo.findById.mockResolvedValue(run);
    artifactRepo.findLatestByType.mockImplementation((_: string, type: string) => {
      if (type === "ExecutionReport") return Promise.resolve(makeArtifact({ type: "ExecutionReport", payloadJson: makeExecutionReport() }));
      if (type === "Plan") return Promise.resolve(makeArtifact({ type: "Plan", payloadJson: makePlan() }));
      return Promise.resolve(null);
    });
    (deps.linearClient.getIssue as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "LIN-1", title: "Test", description: "Test", branchName: "ai/lin-1", labels: [], priority: 0,
    });

    const review = makeReview({
      overallVerdict: "changes_requested",
      findings: [{ id: "f1", severity: "important", type: "bug", file: "a.ts", title: "t", details: "d" }],
    });
    reviewerAgent.run.mockResolvedValue(review);
    githubSync.postReviewFindings.mockResolvedValue(new Map([["f1", 123]]));
    runRepo.update.mockResolvedValue(makeRun({ reviewerRuntime: "codex", state: RunState.AIReview, prNumber: 7 }));
    runRepo.updateState.mockResolvedValue(makeRun({ state: RunState.AddressingReview, prNumber: 7 }));

    const remediationResult = makeRun({ state: RunState.ReadyForHumanReview });
    const runRemediationSpy = vi.spyOn(svc, "runRemediation").mockResolvedValue(remediationResult);

    const result = await svc.runReview("run-1");

    expect(githubSync.postReviewFindings).toHaveBeenCalledWith("test-repo", 7, review.findings, "changes_requested");
    expect(linearClient.postComment).toHaveBeenCalledWith(
      run.linearIssueId,
      expect.stringContaining("Changes Requested"),
    );
    expect(runRemediationSpy).toHaveBeenCalledWith("run-1", { f1: 123 });
    expect(result).toBe(remediationResult);
  });

  it("skips posting GitHub findings (empty commentMap) when changes_requested but findings is empty", async () => {
    const { deps, runRepo, artifactRepo, reviewerAgent, githubSync } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    const run = makeRun({ state: RunState.AIReview, prNumber: 7, approvedPlanVersion: 1 });
    runRepo.findById.mockResolvedValue(run);
    artifactRepo.findLatestByType.mockImplementation((_: string, type: string) => {
      if (type === "ExecutionReport") return Promise.resolve(makeArtifact({ type: "ExecutionReport", payloadJson: makeExecutionReport() }));
      if (type === "Plan") return Promise.resolve(makeArtifact({ type: "Plan", payloadJson: makePlan() }));
      return Promise.resolve(null);
    });
    (deps.linearClient.getIssue as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "LIN-1", title: "Test", description: "Test", branchName: "ai/lin-1", labels: [], priority: 0,
    });
    reviewerAgent.run.mockResolvedValue(makeReview({ overallVerdict: "changes_requested", findings: [] }));
    runRepo.update.mockResolvedValue(makeRun({ state: RunState.AIReview, prNumber: 7 }));
    runRepo.updateState.mockResolvedValue(makeRun({ state: RunState.AddressingReview, prNumber: 7 }));
    const runRemediationSpy = vi
      .spyOn(svc, "runRemediation")
      .mockResolvedValue(makeRun({ state: RunState.ReadyForHumanReview }));

    await svc.runReview("run-1");

    expect(githubSync.postReviewFindings).not.toHaveBeenCalled();
    expect(runRemediationSpy).toHaveBeenCalledWith("run-1", {});
  });
});
