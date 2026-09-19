import { describe, it, expect, vi } from "vitest";
import { LinearSyncService, getLabelForState } from "../../src/sync/linearSync.js";
import { RunState } from "../../src/domain/runState.js";
import type { Run } from "../../src/domain/types.js";

function makeLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
}

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

function makeRun(overrides: Partial<Run> = {}): Run {
  return {
    id: "run-1",
    linearIssueId: "LIN-1",
    linearIssueIdentifier: "LIN-1",
    linearIssueDescription: null,
    linearIssueTitle: null,
    linearIssueUrl: null,
    repo: "org/repo",
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
  it("maps every RunState to a distinct ai:-prefixed label and a Linear issueState", () => {
    for (const state of Object.values(RunState)) {
      const mapping = getLabelForState(state);
      expect(mapping.label.startsWith("ai:")).toBe(true);
      expect(typeof mapping.issueState).toBe("string");
      expect(mapping.issueState.length).toBeGreaterThan(0);
    }
  });

  it("maps ReadyForHumanReview to the 'In Review' issue state", () => {
    expect(getLabelForState(RunState.ReadyForHumanReview)).toEqual({
      label: "ai:ready-for-review",
      issueState: "In Review",
    });
  });

  it("maps Failed to the 'Cancelled' issue state", () => {
    expect(getLabelForState(RunState.Failed)).toEqual({ label: "ai:failed", issueState: "Cancelled" });
  });
});

describe("LinearSyncService.syncState", () => {
  it("adds the new state's label and updates the issue state when no ai: label is present yet", async () => {
    const client = makeClient();
    client.listLabels.mockResolvedValue(["some-other-label"]);
    const svc = new LinearSyncService(client as never, makeLogger() as never);

    await svc.syncState(makeRun({ state: RunState.Planning }));

    expect(client.removeLabel).not.toHaveBeenCalled();
    expect(client.addLabel).toHaveBeenCalledWith("LIN-1", "ai:planning");
    expect(client.updateIssueState).toHaveBeenCalledWith("LIN-1", "In Progress");
  });

  it("removes stale ai: labels that don't match the new state's label", async () => {
    const client = makeClient();
    client.listLabels.mockResolvedValue(["ai:todo", "ai:planning", "keep-me"]);
    const svc = new LinearSyncService(client as never, makeLogger() as never);

    await svc.syncState(makeRun({ state: RunState.PlanReview }));

    expect(client.removeLabel).toHaveBeenCalledWith("LIN-1", "ai:todo");
    expect(client.removeLabel).toHaveBeenCalledWith("LIN-1", "ai:planning");
    expect(client.removeLabel).not.toHaveBeenCalledWith("LIN-1", "keep-me");
    expect(client.addLabel).toHaveBeenCalledWith("LIN-1", "ai:plan-review");
  });

  it("does not re-add the label when it is already present", async () => {
    const client = makeClient();
    client.listLabels.mockResolvedValue(["ai:done"]);
    const svc = new LinearSyncService(client as never, makeLogger() as never);

    await svc.syncState(makeRun({ state: RunState.Done }));

    expect(client.addLabel).not.toHaveBeenCalled();
    expect(client.removeLabel).not.toHaveBeenCalled();
    expect(client.updateIssueState).toHaveBeenCalledWith("LIN-1", "Done");
  });

  it("logs the sync outcome at debug level", async () => {
    const client = makeClient();
    client.listLabels.mockResolvedValue([]);
    const logger = makeLogger();
    const svc = new LinearSyncService(client as never, logger as never);

    await svc.syncState(makeRun({ state: RunState.AIBlocked }));

    expect(logger.debug).toHaveBeenCalledWith(
      expect.objectContaining({
        issueId: "LIN-1",
        state: RunState.AIBlocked,
        label: "ai:blocked",
        issueState: "In Progress",
      }),
      "Synced Linear state",
    );
  });
});
