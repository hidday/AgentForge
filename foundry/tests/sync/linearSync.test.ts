import { describe, it, expect, vi } from "vitest";
import { LinearSyncService, getLabelForState } from "../../src/sync/linearSync.js";
import { RunState } from "../../src/domain/runState.js";
import type { Run } from "../../src/domain/types.js";

function makeLogger() {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

function makeRun(overrides: Partial<Run> = {}): Run {
  return {
    id: "run-1",
    linearIssueId: "issue-1",
    linearIssueIdentifier: null,
    linearIssueDescription: null,
    linearIssueTitle: null,
    linearIssueUrl: null,
    repo: "repo-a",
    branchName: null,
    prNumber: null,
    state: RunState.Planning,
    planVersion: 1,
    approvedPlanVersion: null,
    plannerRuntime: null,
    executorRuntime: null,
    reviewerRuntime: null,
    remediationRuntime: null,
    workingDirectory: "/tmp",
    latestArtifactVersion: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe("getLabelForState", () => {
  it("maps every RunState to a distinct label and issue state", () => {
    for (const state of Object.values(RunState)) {
      const mapping = getLabelForState(state);
      expect(mapping.label.startsWith("ai:")).toBe(true);
      expect(typeof mapping.issueState).toBe("string");
    }
    expect(getLabelForState(RunState.Done)).toEqual({ label: "ai:done", issueState: "Done" });
    expect(getLabelForState(RunState.Failed)).toEqual({
      label: "ai:failed",
      issueState: "Cancelled",
    });
  });
});

describe("LinearSyncService", () => {
  function makeDeps() {
    const linearClient = {
      listLabels: vi.fn(),
      removeLabel: vi.fn().mockResolvedValue(undefined),
      addLabel: vi.fn().mockResolvedValue(undefined),
      updateIssueState: vi.fn().mockResolvedValue(undefined),
    };
    const logger = makeLogger();
    const svc = new LinearSyncService(linearClient as never, logger as never);
    return { svc, linearClient, logger };
  }

  it("adds the mapped label and updates issue state when no ai: label exists yet", async () => {
    const { svc, linearClient, logger } = makeDeps();
    linearClient.listLabels.mockResolvedValue(["bug"]);

    await svc.syncState(makeRun({ state: RunState.Planning }));

    expect(linearClient.addLabel).toHaveBeenCalledWith("issue-1", "ai:planning");
    expect(linearClient.removeLabel).not.toHaveBeenCalled();
    expect(linearClient.updateIssueState).toHaveBeenCalledWith("issue-1", "In Progress");
    expect(logger.debug).toHaveBeenCalled();
  });

  it("removes a stale ai: label and adds the new one when the state changed", async () => {
    const { svc, linearClient } = makeDeps();
    linearClient.listLabels.mockResolvedValue(["ai:todo", "bug"]);

    await svc.syncState(makeRun({ state: RunState.Planning }));

    expect(linearClient.removeLabel).toHaveBeenCalledWith("issue-1", "ai:todo");
    expect(linearClient.addLabel).toHaveBeenCalledWith("issue-1", "ai:planning");
  });

  it("does not re-add the label when it is already present, and leaves non-stale ai: labels alone", async () => {
    const { svc, linearClient } = makeDeps();
    linearClient.listLabels.mockResolvedValue(["ai:planning"]);

    await svc.syncState(makeRun({ state: RunState.Planning }));

    expect(linearClient.addLabel).not.toHaveBeenCalled();
    expect(linearClient.removeLabel).not.toHaveBeenCalled();
    expect(linearClient.updateIssueState).toHaveBeenCalledWith("issue-1", "In Progress");
  });

  it("removes multiple stale ai: labels in one sync", async () => {
    const { svc, linearClient } = makeDeps();
    linearClient.listLabels.mockResolvedValue(["ai:todo", "ai:blocked", "ai:done"]);

    await svc.syncState(makeRun({ state: RunState.Failed }));

    expect(linearClient.removeLabel).toHaveBeenCalledWith("issue-1", "ai:todo");
    expect(linearClient.removeLabel).toHaveBeenCalledWith("issue-1", "ai:blocked");
    expect(linearClient.removeLabel).toHaveBeenCalledWith("issue-1", "ai:done");
    expect(linearClient.addLabel).toHaveBeenCalledWith("issue-1", "ai:failed");
  });
});
