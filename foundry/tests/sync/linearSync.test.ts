import { describe, it, expect, vi } from "vitest";
import { LinearSyncService, getLabelForState } from "../../src/sync/linearSync.js";
import { RunState } from "../../src/domain/runState.js";
import type { Run } from "../../src/domain/types.js";
import type { LinearClient } from "../../src/linear/linearClient.js";
import type { Logger } from "../../src/utils/logger.js";

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
    latestArtifactVersion: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makeLinearClient(overrides: Partial<LinearClient> = {}): LinearClient {
  return {
    getIssue: vi.fn(),
    getRelatedContext: vi.fn(),
    searchIssues: vi.fn(),
    postComment: vi.fn(),
    updateIssueState: vi.fn().mockResolvedValue(undefined),
    addLabel: vi.fn().mockResolvedValue(undefined),
    removeLabel: vi.fn().mockResolvedValue(undefined),
    listLabels: vi.fn().mockResolvedValue([]),
    ...overrides,
  } as unknown as LinearClient;
}

function makeLogger(): Logger {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as unknown as Logger;
}

describe("getLabelForState", () => {
  it("maps every RunState to a distinct ai: label and a Linear issue state", () => {
    const seen = new Set<string>();
    for (const state of Object.values(RunState)) {
      const mapping = getLabelForState(state);
      expect(mapping.label.startsWith("ai:")).toBe(true);
      expect(mapping.issueState.length).toBeGreaterThan(0);
      seen.add(mapping.label);
    }
    // Every state maps to its own distinct label.
    expect(seen.size).toBe(Object.values(RunState).length);
  });

  it("maps ReadyForHumanReview to the In Review issue state", () => {
    expect(getLabelForState(RunState.ReadyForHumanReview)).toEqual({
      label: "ai:ready-for-review",
      issueState: "In Review",
    });
  });

  it("maps Done to the Done issue state and Failed to Cancelled", () => {
    expect(getLabelForState(RunState.Done).issueState).toBe("Done");
    expect(getLabelForState(RunState.Failed).issueState).toBe("Cancelled");
  });
});

describe("LinearSyncService.syncState", () => {
  it("adds the mapped label and updates issue state when no ai label is present yet", async () => {
    const client = makeLinearClient({ listLabels: vi.fn().mockResolvedValue(["other-label"]) });
    const logger = makeLogger();
    const svc = new LinearSyncService(client, logger);

    await svc.syncState(makeRun({ state: RunState.Planning }));

    expect(client.removeLabel).not.toHaveBeenCalled();
    expect(client.addLabel).toHaveBeenCalledWith("LIN-1", "ai:planning");
    expect(client.updateIssueState).toHaveBeenCalledWith("LIN-1", "In Progress");
    expect(logger.debug).toHaveBeenCalledWith(
      expect.objectContaining({
        issueId: "LIN-1",
        label: "ai:planning",
        issueState: "In Progress",
        removedLabels: [],
      }),
      "Synced Linear state",
    );
  });

  it("removes stale ai: labels that don't match the current state's label", async () => {
    const client = makeLinearClient({
      listLabels: vi.fn().mockResolvedValue(["ai:todo", "ai:planning", "other"]),
    });
    const svc = new LinearSyncService(client, makeLogger());

    await svc.syncState(makeRun({ state: RunState.PlanReview }));

    expect(client.removeLabel).toHaveBeenCalledTimes(2);
    expect(client.removeLabel).toHaveBeenCalledWith("LIN-1", "ai:todo");
    expect(client.removeLabel).toHaveBeenCalledWith("LIN-1", "ai:planning");
    expect(client.addLabel).toHaveBeenCalledWith("LIN-1", "ai:plan-review");
  });

  it("does not re-add the label when it is already present, but still removes other stale ai labels", async () => {
    const client = makeLinearClient({
      listLabels: vi.fn().mockResolvedValue(["ai:done", "ai:todo"]),
    });
    const svc = new LinearSyncService(client, makeLogger());

    await svc.syncState(makeRun({ state: RunState.Done }));

    expect(client.removeLabel).toHaveBeenCalledWith("LIN-1", "ai:todo");
    expect(client.removeLabel).not.toHaveBeenCalledWith("LIN-1", "ai:done");
    expect(client.addLabel).not.toHaveBeenCalled();
  });

  it("does not remove non-ai labels", async () => {
    const client = makeLinearClient({
      listLabels: vi.fn().mockResolvedValue(["bug", "frontend"]),
    });
    const svc = new LinearSyncService(client, makeLogger());

    await svc.syncState(makeRun({ state: RunState.Todo }));

    expect(client.removeLabel).not.toHaveBeenCalled();
    expect(client.addLabel).toHaveBeenCalledWith("LIN-1", "ai:todo");
  });

  it("always calls updateIssueState with the mapped issue state for the run's current state", async () => {
    const client = makeLinearClient();
    const svc = new LinearSyncService(client, makeLogger());

    await svc.syncState(makeRun({ state: RunState.AIBlocked }));

    expect(client.updateIssueState).toHaveBeenCalledWith("LIN-1", "In Progress");
  });
});
