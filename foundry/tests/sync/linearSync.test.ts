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
    linearIssueIdentifier: null,
    linearIssueDescription: null,
    linearIssueTitle: null,
    linearIssueUrl: null,
    repo: "org/repo",
    branchName: null,
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

describe("getLabelForState", () => {
  it("maps every RunState to a label and Linear issue state", () => {
    for (const state of Object.values(RunState)) {
      const mapping = getLabelForState(state);
      expect(mapping.label).toMatch(/^ai:/);
      expect(mapping.issueState).toBeTruthy();
    }
  });

  it("maps ReadyForHumanReview to the in-review label/state", () => {
    expect(getLabelForState(RunState.ReadyForHumanReview)).toEqual({
      label: "ai:ready-for-review",
      issueState: "In Review",
    });
  });

  it("maps Failed to the cancelled issue state", () => {
    expect(getLabelForState(RunState.Failed)).toEqual({
      label: "ai:failed",
      issueState: "Cancelled",
    });
  });
});

describe("LinearSyncService.syncState", () => {
  it("adds the new state label and updates the issue state when no ai label is present", async () => {
    const linearClient = makeLinearClient();
    linearClient.listLabels.mockResolvedValue(["unrelated-label"]);
    const svc = new LinearSyncService(linearClient as never, makeLogger() as never);
    const run = makeRun({ state: RunState.Implementing });

    await svc.syncState(run);

    expect(linearClient.addLabel).toHaveBeenCalledWith("issue-1", "ai:implementing");
    expect(linearClient.removeLabel).not.toHaveBeenCalled();
    expect(linearClient.updateIssueState).toHaveBeenCalledWith("issue-1", "In Progress");
  });

  it("removes stale ai: labels that don't match the current state", async () => {
    const linearClient = makeLinearClient();
    linearClient.listLabels.mockResolvedValue(["ai:planning", "ai:code-review", "user-label"]);
    const svc = new LinearSyncService(linearClient as never, makeLogger() as never);
    const run = makeRun({ state: RunState.AIReview });

    await svc.syncState(run);

    expect(linearClient.removeLabel).toHaveBeenCalledWith("issue-1", "ai:planning");
    expect(linearClient.removeLabel).not.toHaveBeenCalledWith("issue-1", "ai:code-review");
    expect(linearClient.removeLabel).not.toHaveBeenCalledWith("issue-1", "user-label");
    // ai:code-review is already the current label, so it should not be re-added.
    expect(linearClient.addLabel).not.toHaveBeenCalled();
  });

  it("does not re-add the label when it is already present", async () => {
    const linearClient = makeLinearClient();
    linearClient.listLabels.mockResolvedValue(["ai:done"]);
    const svc = new LinearSyncService(linearClient as never, makeLogger() as never);
    const run = makeRun({ state: RunState.Done });

    await svc.syncState(run);

    expect(linearClient.addLabel).not.toHaveBeenCalled();
    expect(linearClient.updateIssueState).toHaveBeenCalledWith("issue-1", "Done");
  });

  it("always calls updateIssueState, even when labels are already in sync", async () => {
    const linearClient = makeLinearClient();
    linearClient.listLabels.mockResolvedValue([]);
    const svc = new LinearSyncService(linearClient as never, makeLogger() as never);
    const run = makeRun({ state: RunState.Todo });

    await svc.syncState(run);

    expect(linearClient.addLabel).toHaveBeenCalledWith("issue-1", "ai:todo");
    expect(linearClient.updateIssueState).toHaveBeenCalledWith("issue-1", "Todo");
  });
});
