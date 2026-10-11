import { describe, it, expect, vi } from "vitest";
import { LinearSyncService, getLabelForState } from "../../src/sync/linearSync.js";
import { RunState } from "../../src/domain/runState.js";
import type { Run } from "../../src/domain/types.js";

function makeRun(overrides: Partial<Run> = {}): Run {
  return {
    id: "run-1",
    linearIssueId: "LIN-1",
    linearIssueIdentifier: null,
    linearIssueDescription: null,
    linearIssueTitle: null,
    linearIssueUrl: null,
    repo: "test-repo",
    branchName: null,
    prNumber: null,
    state: RunState.Implementing,
    planVersion: 1,
    approvedPlanVersion: 1,
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

function makeLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
}

function makeLinearClient(overrides: Record<string, unknown> = {}) {
  return {
    listLabels: vi.fn().mockResolvedValue([]),
    addLabel: vi.fn().mockResolvedValue(undefined),
    removeLabel: vi.fn().mockResolvedValue(undefined),
    updateIssueState: vi.fn().mockResolvedValue(undefined),
    getIssue: vi.fn(),
    getRelatedContext: vi.fn(),
    searchIssues: vi.fn(),
    postComment: vi.fn(),
    ...overrides,
  };
}

describe("getLabelForState", () => {
  it("maps every RunState to a label/issueState pair", () => {
    for (const state of Object.values(RunState)) {
      const mapping = getLabelForState(state);
      expect(mapping.label.startsWith("ai:")).toBe(true);
      expect(typeof mapping.issueState).toBe("string");
    }
  });

  it("maps ReadyForHumanReview to the 'In Review' issue state", () => {
    expect(getLabelForState(RunState.ReadyForHumanReview)).toEqual({
      label: "ai:ready-for-review",
      issueState: "In Review",
    });
  });

  it("maps Failed to the 'Cancelled' issue state", () => {
    expect(getLabelForState(RunState.Failed)).toEqual({
      label: "ai:failed",
      issueState: "Cancelled",
    });
  });
});

describe("LinearSyncService.syncState", () => {
  it("adds the mapped label when it is not already present", async () => {
    const linearClient = makeLinearClient({ listLabels: vi.fn().mockResolvedValue([]) });
    const svc = new LinearSyncService(linearClient as never, makeLogger() as never);

    await svc.syncState(makeRun({ state: RunState.Implementing, linearIssueId: "LIN-1" }));

    expect(linearClient.addLabel).toHaveBeenCalledWith("LIN-1", "ai:implementing");
    expect(linearClient.updateIssueState).toHaveBeenCalledWith("LIN-1", "In Progress");
  });

  it("does not add the label again when it is already present", async () => {
    const linearClient = makeLinearClient({
      listLabels: vi.fn().mockResolvedValue(["ai:implementing"]),
    });
    const svc = new LinearSyncService(linearClient as never, makeLogger() as never);

    await svc.syncState(makeRun({ state: RunState.Implementing }));

    expect(linearClient.addLabel).not.toHaveBeenCalled();
  });

  it("removes stale ai: labels that do not match the new state's label", async () => {
    const linearClient = makeLinearClient({
      listLabels: vi.fn().mockResolvedValue(["ai:planning", "ai:code-review", "other-label"]),
    });
    const svc = new LinearSyncService(linearClient as never, makeLogger() as never);

    await svc.syncState(makeRun({ state: RunState.Implementing, linearIssueId: "LIN-1" }));

    expect(linearClient.removeLabel).toHaveBeenCalledWith("LIN-1", "ai:planning");
    expect(linearClient.removeLabel).toHaveBeenCalledWith("LIN-1", "ai:code-review");
    expect(linearClient.removeLabel).not.toHaveBeenCalledWith("LIN-1", "other-label");
    expect(linearClient.removeLabel).toHaveBeenCalledTimes(2);
  });

  it("does not remove or re-add a label that already matches the current state", async () => {
    const linearClient = makeLinearClient({
      listLabels: vi.fn().mockResolvedValue(["ai:implementing", "other-label"]),
    });
    const svc = new LinearSyncService(linearClient as never, makeLogger() as never);

    await svc.syncState(makeRun({ state: RunState.Implementing }));

    expect(linearClient.removeLabel).not.toHaveBeenCalled();
    expect(linearClient.addLabel).not.toHaveBeenCalled();
  });

  it("always calls updateIssueState with the mapped issueState", async () => {
    const linearClient = makeLinearClient();
    const svc = new LinearSyncService(linearClient as never, makeLogger() as never);

    await svc.syncState(makeRun({ state: RunState.Done, linearIssueId: "LIN-2" }));

    expect(linearClient.updateIssueState).toHaveBeenCalledWith("LIN-2", "Done");
  });

  it("propagates an error thrown by listLabels", async () => {
    const linearClient = makeLinearClient({
      listLabels: vi.fn().mockRejectedValue(new Error("Linear API down")),
    });
    const svc = new LinearSyncService(linearClient as never, makeLogger() as never);

    await expect(svc.syncState(makeRun())).rejects.toThrow("Linear API down");
  });

  it("propagates an error thrown by updateIssueState", async () => {
    const linearClient = makeLinearClient({
      updateIssueState: vi.fn().mockRejectedValue(new Error("state update failed")),
    });
    const svc = new LinearSyncService(linearClient as never, makeLogger() as never);

    await expect(svc.syncState(makeRun())).rejects.toThrow("state update failed");
  });
});
