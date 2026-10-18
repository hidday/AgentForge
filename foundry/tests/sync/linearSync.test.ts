import { describe, it, expect, vi } from "vitest";
import { LinearSyncService, getLabelForState } from "../../src/sync/linearSync.js";
import { RunState } from "../../src/domain/runState.js";
import type { Run } from "../../src/domain/types.js";

function makeRun(overrides: Partial<Run> = {}): Run {
  return {
    id: "run-1",
    linearIssueId: "lin-1",
    linearIssueIdentifier: "PRY-1",
    linearIssueDescription: null,
    linearIssueTitle: null,
    linearIssueUrl: null,
    repo: "test-repo",
    branchName: "ai/run-1",
    prNumber: null,
    state: RunState.Implementing,
    planVersion: 1,
    approvedPlanVersion: null,
    plannerRuntime: null,
    executorRuntime: null,
    reviewerRuntime: null,
    remediationRuntime: null,
    workingDirectory: "/tmp",
    latestArtifactVersion: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makeLinearClient() {
  return {
    getIssue: vi.fn(),
    getRelatedContext: vi.fn(),
    searchIssues: vi.fn(),
    postComment: vi.fn(),
    updateIssueState: vi.fn().mockResolvedValue(undefined),
    addLabel: vi.fn().mockResolvedValue(undefined),
    removeLabel: vi.fn().mockResolvedValue(undefined),
    listLabels: vi.fn().mockResolvedValue([]),
  };
}

function makeLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
}

describe("getLabelForState", () => {
  it("maps every RunState to a label and issueState", () => {
    for (const state of Object.values(RunState)) {
      const mapping = getLabelForState(state);
      expect(mapping.label.startsWith("ai:")).toBe(true);
      expect(typeof mapping.issueState).toBe("string");
      expect(mapping.issueState.length).toBeGreaterThan(0);
    }
  });

  it("maps ReadyForHumanReview to the ai:ready-for-review label and In Review state", () => {
    expect(getLabelForState(RunState.ReadyForHumanReview)).toEqual({
      label: "ai:ready-for-review",
      issueState: "In Review",
    });
  });

  it("maps Failed to the ai:failed label and Cancelled state", () => {
    expect(getLabelForState(RunState.Failed)).toEqual({
      label: "ai:failed",
      issueState: "Cancelled",
    });
  });
});

describe("LinearSyncService.syncState", () => {
  it("adds the mapped label when it is not already present and updates issue state", async () => {
    const linearClient = makeLinearClient();
    linearClient.listLabels.mockResolvedValue([]);
    const logger = makeLogger();
    const svc = new LinearSyncService(linearClient as never, logger as never);

    const run = makeRun({ linearIssueId: "lin-1", state: RunState.Implementing });
    await svc.syncState(run);

    expect(linearClient.addLabel).toHaveBeenCalledWith("lin-1", "ai:implementing");
    expect(linearClient.removeLabel).not.toHaveBeenCalled();
    expect(linearClient.updateIssueState).toHaveBeenCalledWith("lin-1", "In Progress");
    expect(logger.debug).toHaveBeenCalledWith(
      expect.objectContaining({
        issueId: "lin-1",
        state: RunState.Implementing,
        label: "ai:implementing",
        issueState: "In Progress",
        removedLabels: [],
      }),
      "Synced Linear state",
    );
  });

  it("does not re-add the label when it is already present", async () => {
    const linearClient = makeLinearClient();
    linearClient.listLabels.mockResolvedValue(["ai:implementing"]);
    const svc = new LinearSyncService(linearClient as never, makeLogger() as never);

    await svc.syncState(makeRun({ state: RunState.Implementing }));

    expect(linearClient.addLabel).not.toHaveBeenCalled();
  });

  it("removes stale ai: labels that don't match the target label", async () => {
    const linearClient = makeLinearClient();
    linearClient.listLabels.mockResolvedValue(["ai:planning", "ai:todo", "other-label"]);
    const svc = new LinearSyncService(linearClient as never, makeLogger() as never);

    await svc.syncState(makeRun({ state: RunState.Implementing }));

    expect(linearClient.removeLabel).toHaveBeenCalledTimes(2);
    expect(linearClient.removeLabel).toHaveBeenCalledWith("lin-1", "ai:planning");
    expect(linearClient.removeLabel).toHaveBeenCalledWith("lin-1", "ai:todo");
    // non-"ai:" labels are left alone
    expect(linearClient.removeLabel).not.toHaveBeenCalledWith("lin-1", "other-label");
    expect(linearClient.addLabel).toHaveBeenCalledWith("lin-1", "ai:implementing");
  });

  it("does not remove the current target label even if it's already present among stale-looking labels", async () => {
    const linearClient = makeLinearClient();
    linearClient.listLabels.mockResolvedValue(["ai:implementing"]);
    const svc = new LinearSyncService(linearClient as never, makeLogger() as never);

    await svc.syncState(makeRun({ state: RunState.Implementing }));

    expect(linearClient.removeLabel).not.toHaveBeenCalled();
  });

  it("propagates an error when listLabels fails and does not attempt further mutations", async () => {
    const linearClient = makeLinearClient();
    linearClient.listLabels.mockRejectedValue(new Error("linear api down"));
    const svc = new LinearSyncService(linearClient as never, makeLogger() as never);

    await expect(svc.syncState(makeRun())).rejects.toThrow("linear api down");
    expect(linearClient.addLabel).not.toHaveBeenCalled();
    expect(linearClient.updateIssueState).not.toHaveBeenCalled();
  });

  it("propagates an error when updateIssueState fails", async () => {
    const linearClient = makeLinearClient();
    linearClient.listLabels.mockResolvedValue([]);
    linearClient.updateIssueState.mockRejectedValue(new Error("update failed"));
    const svc = new LinearSyncService(linearClient as never, makeLogger() as never);

    await expect(svc.syncState(makeRun())).rejects.toThrow("update failed");
  });

  it("propagates an error when removeLabel fails for a stale label", async () => {
    const linearClient = makeLinearClient();
    linearClient.listLabels.mockResolvedValue(["ai:todo"]);
    linearClient.removeLabel.mockRejectedValue(new Error("remove failed"));
    const svc = new LinearSyncService(linearClient as never, makeLogger() as never);

    await expect(svc.syncState(makeRun({ state: RunState.Implementing }))).rejects.toThrow(
      "remove failed",
    );
    expect(linearClient.updateIssueState).not.toHaveBeenCalled();
  });
});
