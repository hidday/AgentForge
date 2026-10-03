import { describe, it, expect, vi } from "vitest";
import { OrchestratorService } from "../../src/orchestrator/orchestratorService.js";
import { RunState } from "../../src/domain/runState.js";
import { RunEvent } from "../../src/domain/runEvent.js";
import { PolicyViolationError } from "../../src/utils/errors.js";
import {
  buildDeps,
  makeRun,
  makeArtifact,
  makeExecutionReport,
  makeReview,
} from "./_fixtures.js";

describe("OrchestratorService.runRemediation", () => {
  it("throws PolicyViolationError when run is not in AddressingReview state", async () => {
    const { deps, runRepo, artifactRepo, remediationAgent } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    runRepo.findById.mockResolvedValue(makeRun({ state: RunState.AIReview }));
    artifactRepo.findLatestByType.mockImplementation((_: string, type: string) =>
      type === "Review"
        ? Promise.resolve(makeArtifact({ type: "Review", payloadJson: makeReview({ overallVerdict: "changes_requested", findings: [{ id: "f1", severity: "important", type: "bug", file: "a.ts", title: "t", details: "d" }] }) }))
        : Promise.resolve(null),
    );

    await expect(svc.runRemediation("run-1")).rejects.toBeInstanceOf(PolicyViolationError);
    expect(remediationAgent.run).not.toHaveBeenCalled();
  });

  it("runs the remediation agent, commits the fix, posts comments, and marks ready", async () => {
    const { deps, runRepo, artifactRepo, remediationAgent, gitService, linearClient, githubSync, eventRepo } =
      buildDeps();
    const svc = new OrchestratorService(deps as never);

    const run = makeRun({ state: RunState.AddressingReview, prNumber: 12, branchName: "ai/run-1" });
    runRepo.findById.mockResolvedValue(run);

    const review = makeReview({
      overallVerdict: "changes_requested",
      findings: [{ id: "f1", severity: "important", type: "bug", file: "a.ts", title: "t", details: "d" }],
    });
    const execReport = makeExecutionReport({ executionVersion: 1, score: 0.5 });
    artifactRepo.findLatestByType.mockImplementation((_: string, type: string) => {
      if (type === "Review") return Promise.resolve(makeArtifact({ type: "Review", payloadJson: review }));
      if (type === "ExecutionReport") return Promise.resolve(makeArtifact({ type: "ExecutionReport", payloadJson: execReport }));
      return Promise.resolve(null);
    });

    const newExecReport = makeExecutionReport({ executionVersion: 2, score: 0.9 });
    const remediation = {
      reviewId: "rev-1",
      resolution: [{ findingId: "f1", status: "accepted", action: "Fixed", rationale: "Real bug" }],
      readyForHumanReview: true,
      executionReport: newExecReport,
    };
    remediationAgent.run.mockResolvedValue(remediation);

    runRepo.update.mockResolvedValue(makeRun({ remediationRuntime: "claude-code", state: RunState.AddressingReview, prNumber: 12 }));
    runRepo.updateState
      .mockResolvedValueOnce(makeRun({ state: RunState.AIReview, prNumber: 12 })) // REMEDIATION_FINISHED
      .mockResolvedValueOnce(makeRun({ state: RunState.ReadyForHumanReview, prNumber: 12 })); // REVIEW_APPROVED

    const markReadySpy = vi.spyOn(svc, "markReady").mockResolvedValue(
      makeRun({ state: RunState.ReadyForHumanReview }),
    );

    const result = await svc.runRemediation("run-1");

    expect(remediationAgent.run).toHaveBeenCalledWith(review, execReport, run.workingDirectory, "run-1");
    expect(gitService.commitAndPush).toHaveBeenCalledWith(
      run.workingDirectory,
      "ai/run-1",
      "[AI] Remediation: address review findings",
    );
    expect(linearClient.postComment).toHaveBeenCalledWith(
      run.linearIssueId,
      expect.stringContaining("Execution Report"),
    );
    expect(linearClient.postComment).toHaveBeenCalledWith(
      run.linearIssueId,
      expect.stringContaining("Remediation Summary"),
    );
    expect(githubSync.postExecutionReportUpdate).toHaveBeenCalledWith("test-repo", 12, newExecReport);
    expect(githubSync.postRemediationResolutions).toHaveBeenCalledWith(
      "test-repo",
      12,
      remediation.resolution,
      {},
    );

    const eventTypes = eventRepo.create.mock.calls.map((c: unknown[]) => (c[0] as { eventType: string }).eventType);
    expect(eventTypes).toContain(RunEvent.REMEDIATION_FINISHED);
    expect(eventTypes).toContain(RunEvent.REVIEW_APPROVED);

    expect(markReadySpy).toHaveBeenCalledWith("run-1");
    expect(result.state).toBe(RunState.ReadyForHumanReview);
  });

  it("skips git operations and GitHub sync when there is no branch/PR", async () => {
    const { deps, runRepo, artifactRepo, remediationAgent, gitService, githubSync } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    const run = makeRun({ state: RunState.AddressingReview, prNumber: null, branchName: null });
    runRepo.findById.mockResolvedValue(run);

    const review = makeReview({
      overallVerdict: "changes_requested",
      findings: [{ id: "f1", severity: "important", type: "bug", file: "a.ts", title: "t", details: "d" }],
    });
    const execReport = makeExecutionReport({ executionVersion: 1 });
    artifactRepo.findLatestByType.mockImplementation((_: string, type: string) => {
      if (type === "Review") return Promise.resolve(makeArtifact({ type: "Review", payloadJson: review }));
      if (type === "ExecutionReport") return Promise.resolve(makeArtifact({ type: "ExecutionReport", payloadJson: execReport }));
      return Promise.resolve(null);
    });

    remediationAgent.run.mockResolvedValue({
      reviewId: "rev-1",
      resolution: [],
      readyForHumanReview: true,
      executionReport: makeExecutionReport({ executionVersion: 2 }),
    });
    runRepo.update.mockResolvedValue(makeRun({ state: RunState.AddressingReview, prNumber: null }));
    runRepo.updateState.mockResolvedValue(makeRun({ state: RunState.AIReview, prNumber: null }));
    vi.spyOn(svc, "markReady").mockResolvedValue(makeRun({ state: RunState.ReadyForHumanReview }));

    await svc.runRemediation("run-1");

    expect(gitService.assertBranch).not.toHaveBeenCalled();
    expect(gitService.commitAndPush).not.toHaveBeenCalled();
    expect(githubSync.postExecutionReportUpdate).not.toHaveBeenCalled();
    expect(githubSync.postRemediationResolutions).not.toHaveBeenCalled();
  });
});
