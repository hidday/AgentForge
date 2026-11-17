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
    repo: "org/repo",
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

describe("getLabelForState", () => {
  it("maps RunState.Done to the ai:done label and 'Done' issue state", () => {
    expect(getLabelForState(RunState.Done)).toEqual({ label: "ai:done", issueState: "Done" });
  });

  it("maps RunState.Failed to the ai:failed label and 'Cancelled' issue state", () => {
    expect(getLabelForState(RunState.Failed)).toEqual({
      label: "ai:failed",
      issueState: "Cancelled",
    });
  });
});

describe("LinearSyncService.syncState", () => {
  function makeClient() {
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

  it("adds the mapped label and updates issue state when no ai: label is present", async () => {
    const client = makeClient();
    client.listLabels.mockResolvedValue(["bug"]);
    const service = new LinearSyncService(client, makeLogger() as never);

    await service.syncState(makeRun({ state: RunState.Implementing }));

    expect(client.removeLabel).not.toHaveBeenCalled();
    expect(client.addLabel).toHaveBeenCalledWith("LIN-1", "ai:implementing");
    expect(client.updateIssueState).toHaveBeenCalledWith("LIN-1", "In Progress");
  });

  it("removes stale ai: labels that don't match the current state's label", async () => {
    const client = makeClient();
    client.listLabels.mockResolvedValue(["ai:planning", "bug"]);
    const service = new LinearSyncService(client, makeLogger() as never);

    await service.syncState(makeRun({ state: RunState.Implementing }));

    expect(client.removeLabel).toHaveBeenCalledWith("LIN-1", "ai:planning");
    expect(client.addLabel).toHaveBeenCalledWith("LIN-1", "ai:implementing");
  });

  it("does not re-add the label when it is already present", async () => {
    const client = makeClient();
    client.listLabels.mockResolvedValue(["ai:implementing"]);
    const service = new LinearSyncService(client, makeLogger() as never);

    await service.syncState(makeRun({ state: RunState.Implementing }));

    expect(client.addLabel).not.toHaveBeenCalled();
    expect(client.updateIssueState).toHaveBeenCalledWith("LIN-1", "In Progress");
  });
});
