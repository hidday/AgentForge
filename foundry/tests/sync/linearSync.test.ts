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
    repo: "acme/backend",
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
  it("maps every RunState to a label and Linear issueState", () => {
    for (const state of Object.values(RunState)) {
      const mapping = getLabelForState(state);
      expect(mapping.label.startsWith("ai:")).toBe(true);
      expect(mapping.issueState).toBeTruthy();
    }
  });

  it("maps specific states to their documented label/issueState pairs", () => {
    expect(getLabelForState(RunState.Todo)).toEqual({ label: "ai:todo", issueState: "Todo" });
    expect(getLabelForState(RunState.ReadyForHumanReview)).toEqual({
      label: "ai:ready-for-review",
      issueState: "In Review",
    });
    expect(getLabelForState(RunState.Done)).toEqual({ label: "ai:done", issueState: "Done" });
    expect(getLabelForState(RunState.Failed)).toEqual({
      label: "ai:failed",
      issueState: "Cancelled",
    });
  });
});

describe("LinearSyncService.syncState", () => {
  it("adds the mapped label and updates issue state when the label is not yet present", async () => {
    const linear = makeLinearClient();
    linear.listLabels.mockResolvedValue([]);
    const svc = new LinearSyncService(linear as never, makeLogger() as never);

    await svc.syncState(makeRun({ state: RunState.Planning }));

    expect(linear.addLabel).toHaveBeenCalledWith("issue-1", "ai:planning");
    expect(linear.removeLabel).not.toHaveBeenCalled();
    expect(linear.updateIssueState).toHaveBeenCalledWith("issue-1", "In Progress");
  });

  it("removes stale ai: labels that do not match the current state's label", async () => {
    const linear = makeLinearClient();
    linear.listLabels.mockResolvedValue(["ai:todo", "not-ai-label", "ai:planning"]);
    const svc = new LinearSyncService(linear as never, makeLogger() as never);

    await svc.syncState(makeRun({ state: RunState.Planning }));

    expect(linear.removeLabel).toHaveBeenCalledWith("issue-1", "ai:todo");
    expect(linear.removeLabel).not.toHaveBeenCalledWith("issue-1", "not-ai-label");
    expect(linear.removeLabel).not.toHaveBeenCalledWith("issue-1", "ai:planning");
    // Already present, so it should not be re-added.
    expect(linear.addLabel).not.toHaveBeenCalled();
  });

  it("does not add the label again when it is already present", async () => {
    const linear = makeLinearClient();
    linear.listLabels.mockResolvedValue(["ai:done"]);
    const svc = new LinearSyncService(linear as never, makeLogger() as never);

    await svc.syncState(makeRun({ state: RunState.Done }));

    expect(linear.addLabel).not.toHaveBeenCalled();
    expect(linear.updateIssueState).toHaveBeenCalledWith("issue-1", "Done");
  });
});
