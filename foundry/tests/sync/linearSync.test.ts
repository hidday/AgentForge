import { describe, it, expect, vi, beforeEach } from "vitest";
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

function buildClient(currentLabels: string[] = []) {
  return {
    getIssue: vi.fn(),
    getRelatedContext: vi.fn(),
    searchIssues: vi.fn(),
    postComment: vi.fn(),
    updateIssueState: vi.fn().mockResolvedValue(undefined),
    addLabel: vi.fn().mockResolvedValue(undefined),
    removeLabel: vi.fn().mockResolvedValue(undefined),
    listLabels: vi.fn().mockResolvedValue(currentLabels),
  };
}

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };

beforeEach(() => logger.debug.mockClear());

describe("getLabelForState", () => {
  it("maps every RunState to a distinct ai: label and a Linear issue state", () => {
    for (const state of Object.values(RunState)) {
      const mapping = getLabelForState(state);
      expect(mapping.label).toMatch(/^ai:/);
      expect(mapping.issueState).toBeTruthy();
    }
  });

  it("maps Done to ai:done / Done", () => {
    expect(getLabelForState(RunState.Done)).toEqual({ label: "ai:done", issueState: "Done" });
  });

  it("maps Failed to ai:failed / Cancelled", () => {
    expect(getLabelForState(RunState.Failed)).toEqual({
      label: "ai:failed",
      issueState: "Cancelled",
    });
  });
});

describe("LinearSyncService.syncState", () => {
  it("adds the new state label when not already present", async () => {
    const client = buildClient([]);
    const svc = new LinearSyncService(client as never, logger as never);

    await svc.syncState(makeRun({ state: RunState.Implementing }));

    expect(client.addLabel).toHaveBeenCalledWith("LIN-1", "ai:implementing");
  });

  it("does not re-add the label when it is already present", async () => {
    const client = buildClient(["ai:implementing"]);
    const svc = new LinearSyncService(client as never, logger as never);

    await svc.syncState(makeRun({ state: RunState.Implementing }));

    expect(client.addLabel).not.toHaveBeenCalled();
  });

  it("removes stale ai: labels that don't match the current state", async () => {
    const client = buildClient(["ai:planning", "ai:implementing", "bug"]);
    const svc = new LinearSyncService(client as never, logger as never);

    await svc.syncState(makeRun({ state: RunState.Implementing }));

    expect(client.removeLabel).toHaveBeenCalledWith("LIN-1", "ai:planning");
    expect(client.removeLabel).toHaveBeenCalledTimes(1);
    expect(client.removeLabel).not.toHaveBeenCalledWith("LIN-1", "bug");
  });

  it("updates the Linear issue state to the mapped issueState", async () => {
    const client = buildClient([]);
    const svc = new LinearSyncService(client as never, logger as never);

    await svc.syncState(makeRun({ state: RunState.ReadyForHumanReview }));

    expect(client.updateIssueState).toHaveBeenCalledWith("LIN-1", "In Review");
  });

  it("logs the sync including removed labels", async () => {
    const client = buildClient(["ai:planning"]);
    const svc = new LinearSyncService(client as never, logger as never);

    await svc.syncState(makeRun({ state: RunState.Done }));

    expect(logger.debug).toHaveBeenCalledWith(
      expect.objectContaining({ removedLabels: ["ai:planning"], label: "ai:done" }),
      "Synced Linear state",
    );
  });
});
