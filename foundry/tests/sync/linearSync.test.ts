import { describe, it, expect, vi } from "vitest";
import { LinearSyncService, getLabelForState } from "../../src/sync/linearSync.js";
import { RunState } from "../../src/domain/runState.js";
import type { Run } from "../../src/domain/types.js";

function makeLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
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
    listLabels: vi.fn(),
  };
}

function makeRun(overrides: Partial<Run> = {}): Run {
  return {
    id: "run-1",
    linearIssueId: "issue-1",
    linearIssueIdentifier: "PRY-1",
    linearIssueDescription: null,
    linearIssueTitle: null,
    linearIssueUrl: null,
    repo: "acme/widgets",
    branchName: null,
    prNumber: null,
    state: RunState.Implementing,
    planVersion: 1,
    approvedPlanVersion: null,
    plannerRuntime: null,
    executorRuntime: null,
    reviewerRuntime: null,
    remediationRuntime: null,
    workingDirectory: "/tmp/repo",
    latestArtifactVersion: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe("getLabelForState", () => {
  it("maps every RunState to a distinct label/issueState pair", () => {
    for (const state of Object.values(RunState)) {
      const mapping = getLabelForState(state);
      expect(mapping.label.startsWith("ai:")).toBe(true);
      expect(typeof mapping.issueState).toBe("string");
    }
  });

  it("maps ReadyForHumanReview to ai:ready-for-review / In Review", () => {
    expect(getLabelForState(RunState.ReadyForHumanReview)).toEqual({
      label: "ai:ready-for-review",
      issueState: "In Review",
    });
  });

  it("maps Failed to ai:failed / Cancelled", () => {
    expect(getLabelForState(RunState.Failed)).toEqual({
      label: "ai:failed",
      issueState: "Cancelled",
    });
  });
});

describe("LinearSyncService.syncState", () => {
  it("is a no-op (no stale removal, no add) when the correct label is already present", async () => {
    const linearClient = makeLinearClient();
    linearClient.listLabels.mockResolvedValue(["ai:implementing", "bug"]);
    const service = new LinearSyncService(linearClient as never, makeLogger() as never);
    const run = makeRun({ state: RunState.Implementing });

    await service.syncState(run);

    expect(linearClient.removeLabel).not.toHaveBeenCalled();
    expect(linearClient.addLabel).not.toHaveBeenCalled();
    expect(linearClient.updateIssueState).toHaveBeenCalledWith("issue-1", "In Progress");
  });

  it("removes stale ai: labels and adds the correct one when drift is detected", async () => {
    const linearClient = makeLinearClient();
    linearClient.listLabels.mockResolvedValue(["ai:planning", "bug"]);
    const service = new LinearSyncService(linearClient as never, makeLogger() as never);
    const run = makeRun({ state: RunState.Implementing });

    await service.syncState(run);

    expect(linearClient.removeLabel).toHaveBeenCalledWith("issue-1", "ai:planning");
    expect(linearClient.removeLabel).toHaveBeenCalledTimes(1);
    expect(linearClient.addLabel).toHaveBeenCalledWith("issue-1", "ai:implementing");
    expect(linearClient.updateIssueState).toHaveBeenCalledWith("issue-1", "In Progress");
  });

  it("never removes non-ai labels", async () => {
    const linearClient = makeLinearClient();
    linearClient.listLabels.mockResolvedValue(["bug", "urgent"]);
    const service = new LinearSyncService(linearClient as never, makeLogger() as never);
    const run = makeRun({ state: RunState.Done });

    await service.syncState(run);

    expect(linearClient.removeLabel).not.toHaveBeenCalled();
    expect(linearClient.addLabel).toHaveBeenCalledWith("issue-1", "ai:done");
  });

  it("removes multiple stale ai: labels if present", async () => {
    const linearClient = makeLinearClient();
    linearClient.listLabels.mockResolvedValue(["ai:planning", "ai:blocked", "ai:done"]);
    const service = new LinearSyncService(linearClient as never, makeLogger() as never);
    const run = makeRun({ state: RunState.Failed });

    await service.syncState(run);

    expect(linearClient.removeLabel).toHaveBeenCalledWith("issue-1", "ai:planning");
    expect(linearClient.removeLabel).toHaveBeenCalledWith("issue-1", "ai:blocked");
    expect(linearClient.removeLabel).toHaveBeenCalledWith("issue-1", "ai:done");
    expect(linearClient.removeLabel).toHaveBeenCalledTimes(3);
    expect(linearClient.addLabel).toHaveBeenCalledWith("issue-1", "ai:failed");
  });

  it("propagates an error from the underlying Linear client without updating state", async () => {
    const linearClient = makeLinearClient();
    linearClient.listLabels.mockResolvedValue([]);
    linearClient.addLabel.mockRejectedValue(new Error("Linear API unavailable"));
    const service = new LinearSyncService(linearClient as never, makeLogger() as never);
    const run = makeRun({ state: RunState.Todo });

    await expect(service.syncState(run)).rejects.toThrow("Linear API unavailable");
    expect(linearClient.updateIssueState).not.toHaveBeenCalled();
  });
});
