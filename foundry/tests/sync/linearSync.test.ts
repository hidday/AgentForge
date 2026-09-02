import { describe, it, expect, vi, beforeEach } from "vitest";
import { LinearSyncService, getLabelForState } from "../../src/sync/linearSync.js";
import { RunState } from "../../src/domain/runState.js";
import type { Run } from "../../src/domain/types.js";

function makeRun(overrides: Partial<Run> = {}): Run {
  return {
    id: "run-1",
    linearIssueId: "LIN-1",
    linearIssueIdentifier: "ENG-1",
    linearIssueDescription: null,
    linearIssueTitle: null,
    linearIssueUrl: null,
    repo: "acme/widgets",
    branchName: "ai/lin-1",
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

function buildLinearClient() {
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

function buildLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };
}

describe("getLabelForState", () => {
  it("maps every RunState to a label and issueState", () => {
    for (const state of Object.values(RunState)) {
      const mapping = getLabelForState(state);
      expect(mapping.label).toMatch(/^ai:/);
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

  it("maps Done to the 'Done' issue state", () => {
    expect(getLabelForState(RunState.Done)).toEqual({
      label: "ai:done",
      issueState: "Done",
    });
  });

  it("maps Failed to the 'Cancelled' issue state", () => {
    expect(getLabelForState(RunState.Failed)).toEqual({
      label: "ai:failed",
      issueState: "Cancelled",
    });
  });
});

describe("LinearSyncService.syncState", () => {
  let linearClient: ReturnType<typeof buildLinearClient>;
  let logger: ReturnType<typeof buildLogger>;
  let svc: LinearSyncService;

  beforeEach(() => {
    linearClient = buildLinearClient();
    logger = buildLogger();
    svc = new LinearSyncService(linearClient as never, logger as never);
  });

  it("adds the mapped label when it is not already present and updates the issue state", async () => {
    linearClient.listLabels.mockResolvedValue([]);
    const run = makeRun({ state: RunState.Implementing, linearIssueId: "LIN-1" });

    await svc.syncState(run);

    expect(linearClient.addLabel).toHaveBeenCalledWith("LIN-1", "ai:implementing");
    expect(linearClient.updateIssueState).toHaveBeenCalledWith("LIN-1", "In Progress");
    expect(linearClient.removeLabel).not.toHaveBeenCalled();
  });

  it("does not re-add the label when it is already present", async () => {
    linearClient.listLabels.mockResolvedValue(["ai:implementing"]);
    const run = makeRun({ state: RunState.Implementing });

    await svc.syncState(run);

    expect(linearClient.addLabel).not.toHaveBeenCalled();
    expect(linearClient.updateIssueState).toHaveBeenCalledWith("LIN-1", "In Progress");
  });

  it("removes stale ai: labels that don't match the current state's label", async () => {
    linearClient.listLabels.mockResolvedValue(["ai:planning", "ai:blocked", "not-ai-label"]);
    const run = makeRun({ state: RunState.Implementing });

    await svc.syncState(run);

    expect(linearClient.removeLabel).toHaveBeenCalledTimes(2);
    expect(linearClient.removeLabel).toHaveBeenCalledWith("LIN-1", "ai:planning");
    expect(linearClient.removeLabel).toHaveBeenCalledWith("LIN-1", "ai:blocked");
    expect(linearClient.removeLabel).not.toHaveBeenCalledWith("LIN-1", "not-ai-label");
    // Non-ai labels are left alone and the current label gets added.
    expect(linearClient.addLabel).toHaveBeenCalledWith("LIN-1", "ai:implementing");
  });

  it("does not remove a stale label that equals the current mapped label", async () => {
    linearClient.listLabels.mockResolvedValue(["ai:implementing"]);
    const run = makeRun({ state: RunState.Implementing });

    await svc.syncState(run);

    expect(linearClient.removeLabel).not.toHaveBeenCalled();
  });

  it("always calls updateIssueState with the mapped issue state", async () => {
    linearClient.listLabels.mockResolvedValue([]);
    const run = makeRun({ state: RunState.Done, linearIssueId: "LIN-9" });

    await svc.syncState(run);

    expect(linearClient.updateIssueState).toHaveBeenCalledWith("LIN-9", "Done");
  });

  it("logs the sync at debug level with removed labels included", async () => {
    linearClient.listLabels.mockResolvedValue(["ai:planning"]);
    const run = makeRun({ state: RunState.AIBlocked, linearIssueId: "LIN-1" });

    await svc.syncState(run);

    expect(logger.debug).toHaveBeenCalledWith(
      expect.objectContaining({
        issueId: "LIN-1",
        state: RunState.AIBlocked,
        label: "ai:blocked",
        issueState: "In Progress",
        removedLabels: ["ai:planning"],
      }),
      "Synced Linear state",
    );
  });

  it("propagates errors from the Linear client", async () => {
    linearClient.listLabels.mockRejectedValueOnce(new Error("Linear API down"));
    const run = makeRun();

    await expect(svc.syncState(run)).rejects.toThrow("Linear API down");
  });
});
