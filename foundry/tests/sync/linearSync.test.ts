import { describe, it, expect, vi, beforeEach } from "vitest";
import { LinearSyncService, getLabelForState } from "../../src/sync/linearSync.js";
import { RunState } from "../../src/domain/runState.js";
import type { Run } from "../../src/domain/types.js";
import type { LinearClient } from "../../src/linear/linearClient.js";

function makeRun(overrides: Partial<Run> = {}): Run {
  return {
    id: "run-1",
    linearIssueId: "LIN-1",
    linearIssueIdentifier: "LIN-1",
    linearIssueDescription: null,
    linearIssueTitle: null,
    linearIssueUrl: null,
    repo: "acme/backend",
    branchName: "ai/lin-1",
    prNumber: null,
    state: RunState.Implementing,
    planVersion: 1,
    approvedPlanVersion: 1,
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

function makeLinearClient(): { [K in keyof LinearClient]: ReturnType<typeof vi.fn> } {
  return {
    getIssue: vi.fn(),
    getRelatedContext: vi.fn(),
    searchIssues: vi.fn(),
    postComment: vi.fn().mockResolvedValue(undefined),
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
  it("maps every RunState to a distinct ai: label and a Linear issue state", () => {
    for (const state of Object.values(RunState)) {
      const mapping = getLabelForState(state);
      expect(mapping.label.startsWith("ai:")).toBe(true);
      expect(typeof mapping.issueState).toBe("string");
      expect(mapping.issueState.length).toBeGreaterThan(0);
    }
  });

  it("maps ReadyForHumanReview to the in-review label and state", () => {
    expect(getLabelForState(RunState.ReadyForHumanReview)).toEqual({
      label: "ai:ready-for-review",
      issueState: "In Review",
    });
  });

  it("maps Failed to the cancelled Linear state", () => {
    expect(getLabelForState(RunState.Failed)).toEqual({
      label: "ai:failed",
      issueState: "Cancelled",
    });
  });
});

describe("LinearSyncService.syncState", () => {
  let client: ReturnType<typeof makeLinearClient>;
  let logger: ReturnType<typeof makeLogger>;
  let service: LinearSyncService;

  beforeEach(() => {
    client = makeLinearClient();
    logger = makeLogger();
    service = new LinearSyncService(client as unknown as LinearClient, logger as never);
  });

  it("adds the new state label when it is not already present and updates issue state", async () => {
    client.listLabels.mockResolvedValueOnce([]);
    const run = makeRun({ state: RunState.Implementing, linearIssueId: "LIN-1" });

    await service.syncState(run);

    expect(client.addLabel).toHaveBeenCalledWith("LIN-1", "ai:implementing");
    expect(client.updateIssueState).toHaveBeenCalledWith("LIN-1", "In Progress");
    expect(client.removeLabel).not.toHaveBeenCalled();
  });

  it("does not re-add the label when it is already present", async () => {
    client.listLabels.mockResolvedValueOnce(["ai:implementing"]);
    const run = makeRun({ state: RunState.Implementing });

    await service.syncState(run);

    expect(client.addLabel).not.toHaveBeenCalled();
    expect(client.updateIssueState).toHaveBeenCalledWith("LIN-1", "In Progress");
  });

  it("removes stale ai: labels that don't match the current state's label", async () => {
    client.listLabels.mockResolvedValueOnce(["ai:planning", "bug", "ai:implementing"]);
    const run = makeRun({ state: RunState.Implementing });

    await service.syncState(run);

    expect(client.removeLabel).toHaveBeenCalledWith("LIN-1", "ai:planning");
    expect(client.removeLabel).not.toHaveBeenCalledWith("LIN-1", "bug");
    expect(client.removeLabel).not.toHaveBeenCalledWith("LIN-1", "ai:implementing");
    // Already present, so it should not be re-added.
    expect(client.addLabel).not.toHaveBeenCalled();
  });

  it("leaves non-ai labels untouched", async () => {
    client.listLabels.mockResolvedValueOnce(["bug", "urgent"]);
    const run = makeRun({ state: RunState.Done });

    await service.syncState(run);

    expect(client.removeLabel).not.toHaveBeenCalled();
    expect(client.addLabel).toHaveBeenCalledWith("LIN-1", "ai:done");
  });

  it("logs a debug summary including removed labels", async () => {
    client.listLabels.mockResolvedValueOnce(["ai:todo"]);
    const run = makeRun({ state: RunState.Planning, linearIssueId: "LIN-9" });

    await service.syncState(run);

    expect(logger.debug).toHaveBeenCalledWith(
      expect.objectContaining({
        issueId: "LIN-9",
        state: RunState.Planning,
        label: "ai:planning",
        issueState: "In Progress",
        removedLabels: ["ai:todo"],
      }),
      "Synced Linear state",
    );
  });

  it("propagates an error when the Linear API call fails", async () => {
    client.listLabels.mockRejectedValueOnce(new Error("Linear API unavailable"));

    await expect(service.syncState(makeRun())).rejects.toThrow("Linear API unavailable");
    expect(client.updateIssueState).not.toHaveBeenCalled();
  });

  it("propagates an error raised while updating the issue state", async () => {
    client.listLabels.mockResolvedValueOnce([]);
    client.updateIssueState.mockRejectedValueOnce(new Error("state transition rejected"));

    await expect(service.syncState(makeRun())).rejects.toThrow("state transition rejected");
  });
});
