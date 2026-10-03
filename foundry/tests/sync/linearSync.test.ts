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
    listLabels: vi.fn().mockResolvedValue([]),
  };
}

function makeRun(overrides: Partial<Run> = {}): Run {
  return {
    id: "run-1",
    linearIssueId: "LIN-1",
    linearIssueIdentifier: null,
    linearIssueDescription: null,
    linearIssueTitle: null,
    linearIssueUrl: null,
    repo: "owner/repo",
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
  it("maps every RunState to a distinct ai: label and a valid issueState", () => {
    for (const state of Object.values(RunState)) {
      const mapping = getLabelForState(state);
      expect(mapping.label.startsWith("ai:")).toBe(true);
      expect(mapping.issueState.length).toBeGreaterThan(0);
    }
  });

  it("maps ReadyForHumanReview to the ready-for-review label and In Review issue state", () => {
    expect(getLabelForState(RunState.ReadyForHumanReview)).toEqual({
      label: "ai:ready-for-review",
      issueState: "In Review",
    });
  });

  it("maps Done to the done label and Done issue state", () => {
    expect(getLabelForState(RunState.Done)).toEqual({ label: "ai:done", issueState: "Done" });
  });

  it("maps Failed to the failed label and Cancelled issue state", () => {
    expect(getLabelForState(RunState.Failed)).toEqual({
      label: "ai:failed",
      issueState: "Cancelled",
    });
  });
});

describe("LinearSyncService.syncState", () => {
  it("adds the new state label when it is not already present", async () => {
    const linearClient = makeLinearClient();
    linearClient.listLabels.mockResolvedValue([]);
    const service = new LinearSyncService(linearClient as never, makeLogger() as never);

    await service.syncState(makeRun({ state: RunState.Planning, linearIssueId: "LIN-1" }));

    expect(linearClient.addLabel).toHaveBeenCalledWith("LIN-1", "ai:planning");
    expect(linearClient.updateIssueState).toHaveBeenCalledWith("LIN-1", "In Progress");
  });

  it("does not re-add the label when it is already present", async () => {
    const linearClient = makeLinearClient();
    linearClient.listLabels.mockResolvedValue(["ai:planning"]);
    const service = new LinearSyncService(linearClient as never, makeLogger() as never);

    await service.syncState(makeRun({ state: RunState.Planning }));

    expect(linearClient.addLabel).not.toHaveBeenCalled();
  });

  it("removes stale ai: labels that don't match the current state", async () => {
    const linearClient = makeLinearClient();
    linearClient.listLabels.mockResolvedValue(["ai:todo", "ai:blocked", "not-ai-label"]);
    const service = new LinearSyncService(linearClient as never, makeLogger() as never);

    await service.syncState(makeRun({ state: RunState.Implementing, linearIssueId: "LIN-1" }));

    expect(linearClient.removeLabel).toHaveBeenCalledWith("LIN-1", "ai:todo");
    expect(linearClient.removeLabel).toHaveBeenCalledWith("LIN-1", "ai:blocked");
    expect(linearClient.removeLabel).not.toHaveBeenCalledWith("LIN-1", "not-ai-label");
    expect(linearClient.addLabel).toHaveBeenCalledWith("LIN-1", "ai:implementing");
  });

  it("does not remove the label that already matches the current state", async () => {
    const linearClient = makeLinearClient();
    linearClient.listLabels.mockResolvedValue(["ai:implementing"]);
    const service = new LinearSyncService(linearClient as never, makeLogger() as never);

    await service.syncState(makeRun({ state: RunState.Implementing }));

    expect(linearClient.removeLabel).not.toHaveBeenCalled();
    expect(linearClient.addLabel).not.toHaveBeenCalled();
  });

  it("always updates the Linear issue workflow state to match the run state", async () => {
    const linearClient = makeLinearClient();
    const service = new LinearSyncService(linearClient as never, makeLogger() as never);

    await service.syncState(makeRun({ state: RunState.AIBlocked, linearIssueId: "LIN-9" }));

    expect(linearClient.updateIssueState).toHaveBeenCalledWith("LIN-9", "In Progress");
  });
});
