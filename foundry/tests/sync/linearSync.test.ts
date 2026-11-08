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
    state: RunState.Planning,
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
  it("returns a distinct label/issueState mapping for every RunState", () => {
    const states = Object.values(RunState);
    for (const state of states) {
      const mapping = getLabelForState(state);
      expect(mapping.label.startsWith("ai:")).toBe(true);
      expect(mapping.issueState.length).toBeGreaterThan(0);
    }
  });

  it("maps ReadyForHumanReview to the In Review issue state", () => {
    expect(getLabelForState(RunState.ReadyForHumanReview)).toEqual({
      label: "ai:ready-for-review",
      issueState: "In Review",
    });
  });

  it("maps Failed to the Cancelled issue state", () => {
    expect(getLabelForState(RunState.Failed)).toEqual({
      label: "ai:failed",
      issueState: "Cancelled",
    });
  });
});

describe("LinearSyncService.syncState", () => {
  it("adds the mapped label and updates issue state when no AI label exists yet", async () => {
    const linear = makeLinearClient();
    linear.listLabels.mockResolvedValue(["bug"]);
    const svc = new LinearSyncService(linear as never, makeLogger() as never);

    await svc.syncState(makeRun({ state: RunState.Planning }));

    expect(linear.removeLabel).not.toHaveBeenCalled();
    expect(linear.addLabel).toHaveBeenCalledWith("issue-1", "ai:planning");
    expect(linear.updateIssueState).toHaveBeenCalledWith("issue-1", "In Progress");
  });

  it("removes stale ai: labels that don't match the current state's label", async () => {
    const linear = makeLinearClient();
    linear.listLabels.mockResolvedValue(["ai:todo", "bug"]);
    const svc = new LinearSyncService(linear as never, makeLogger() as never);

    await svc.syncState(makeRun({ state: RunState.Planning }));

    expect(linear.removeLabel).toHaveBeenCalledWith("issue-1", "ai:todo");
    expect(linear.addLabel).toHaveBeenCalledWith("issue-1", "ai:planning");
  });

  it("does not re-add the label when it is already present", async () => {
    const linear = makeLinearClient();
    linear.listLabels.mockResolvedValue(["ai:planning"]);
    const svc = new LinearSyncService(linear as never, makeLogger() as never);

    await svc.syncState(makeRun({ state: RunState.Planning }));

    expect(linear.addLabel).not.toHaveBeenCalled();
    expect(linear.updateIssueState).toHaveBeenCalledWith("issue-1", "In Progress");
  });

  it("does not remove a non-ai label even if it doesn't match the current mapping", async () => {
    const linear = makeLinearClient();
    linear.listLabels.mockResolvedValue(["bug", "urgent"]);
    const svc = new LinearSyncService(linear as never, makeLogger() as never);

    await svc.syncState(makeRun({ state: RunState.Done }));

    expect(linear.removeLabel).not.toHaveBeenCalled();
    expect(linear.addLabel).toHaveBeenCalledWith("issue-1", "ai:done");
  });

  it("always calls updateIssueState with the mapped issue state, even with no label changes", async () => {
    const linear = makeLinearClient();
    linear.listLabels.mockResolvedValue(["ai:done"]);
    const svc = new LinearSyncService(linear as never, makeLogger() as never);

    await svc.syncState(makeRun({ state: RunState.Done }));

    expect(linear.updateIssueState).toHaveBeenCalledWith("issue-1", "Done");
  });
});
