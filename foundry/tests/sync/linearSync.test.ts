import { describe, it, expect, vi } from "vitest";
import { LinearSyncService, getLabelForState } from "../../src/sync/linearSync.js";
import { RunState } from "../../src/domain/runState.js";
import type { Run } from "../../src/domain/types.js";

function makeLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
}

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
  it("maps every RunState to a distinct ai: label and a Linear issue state", () => {
    for (const state of Object.values(RunState)) {
      const mapping = getLabelForState(state);
      expect(mapping.label.startsWith("ai:")).toBe(true);
      expect(typeof mapping.issueState).toBe("string");
    }
  });

  it("maps Done to the Done issue state", () => {
    expect(getLabelForState(RunState.Done)).toEqual({ label: "ai:done", issueState: "Done" });
  });

  it("maps Failed to the Cancelled issue state", () => {
    expect(getLabelForState(RunState.Failed)).toEqual({ label: "ai:failed", issueState: "Cancelled" });
  });
});

describe("LinearSyncService.syncState", () => {
  it("adds the new state label when it is not already present", async () => {
    const linearClient = {
      listLabels: vi.fn().mockResolvedValue([]),
      removeLabel: vi.fn(),
      addLabel: vi.fn(),
      updateIssueState: vi.fn(),
    };
    const svc = new LinearSyncService(linearClient as never, makeLogger() as never);

    await svc.syncState(makeRun({ state: RunState.Planning }));

    expect(linearClient.addLabel).toHaveBeenCalledWith("LIN-1", "ai:planning");
    expect(linearClient.updateIssueState).toHaveBeenCalledWith("LIN-1", "In Progress");
  });

  it("does not re-add the label when it is already present", async () => {
    const linearClient = {
      listLabels: vi.fn().mockResolvedValue(["ai:planning"]),
      removeLabel: vi.fn(),
      addLabel: vi.fn(),
      updateIssueState: vi.fn(),
    };
    const svc = new LinearSyncService(linearClient as never, makeLogger() as never);

    await svc.syncState(makeRun({ state: RunState.Planning }));

    expect(linearClient.addLabel).not.toHaveBeenCalled();
  });

  it("removes stale ai: labels that no longer match the current state", async () => {
    const linearClient = {
      listLabels: vi.fn().mockResolvedValue(["ai:todo", "other-label"]),
      removeLabel: vi.fn(),
      addLabel: vi.fn(),
      updateIssueState: vi.fn(),
    };
    const svc = new LinearSyncService(linearClient as never, makeLogger() as never);

    await svc.syncState(makeRun({ state: RunState.Planning }));

    expect(linearClient.removeLabel).toHaveBeenCalledWith("LIN-1", "ai:todo");
    expect(linearClient.removeLabel).not.toHaveBeenCalledWith("LIN-1", "other-label");
    expect(linearClient.addLabel).toHaveBeenCalledWith("LIN-1", "ai:planning");
  });

  it("always calls updateIssueState with the mapped Linear workflow state", async () => {
    const linearClient = {
      listLabels: vi.fn().mockResolvedValue(["ai:done"]),
      removeLabel: vi.fn(),
      addLabel: vi.fn(),
      updateIssueState: vi.fn(),
    };
    const svc = new LinearSyncService(linearClient as never, makeLogger() as never);

    await svc.syncState(makeRun({ state: RunState.Done }));

    expect(linearClient.updateIssueState).toHaveBeenCalledWith("LIN-1", "Done");
  });
});
