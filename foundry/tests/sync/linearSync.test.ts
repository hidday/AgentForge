import { describe, it, expect, vi, beforeEach } from "vitest";
import { LinearSyncService, getLabelForState } from "../../src/sync/linearSync.js";
import { RunState } from "../../src/domain/runState.js";
import type { Run } from "../../src/domain/types.js";
import type { LinearClient } from "../../src/linear/linearClient.js";

function makeLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };
}

function makeLinearClient() {
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
    state: RunState.Todo,
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
  it("maps every RunState to a label and issue state", () => {
    for (const state of Object.values(RunState)) {
      const mapping = getLabelForState(state);
      expect(mapping.label).toMatch(/^ai:/);
      expect(mapping.issueState).toBeTruthy();
    }
  });

  it("maps specific states to their expected label/issueState pairs", () => {
    expect(getLabelForState(RunState.ReadyForHumanReview)).toEqual({
      label: "ai:ready-for-review",
      issueState: "In Review",
    });
    expect(getLabelForState(RunState.Failed)).toEqual({
      label: "ai:failed",
      issueState: "Cancelled",
    });
    expect(getLabelForState(RunState.Done)).toEqual({ label: "ai:done", issueState: "Done" });
  });
});

describe("LinearSyncService", () => {
  let linearClient: ReturnType<typeof makeLinearClient>;
  let logger: ReturnType<typeof makeLogger>;
  let service: LinearSyncService;

  beforeEach(() => {
    linearClient = makeLinearClient();
    logger = makeLogger();
    service = new LinearSyncService(linearClient as unknown as LinearClient, logger as never);
  });

  it("removes stale ai: labels, adds the new label, and updates issue state", async () => {
    linearClient.listLabels.mockResolvedValue(["ai:planning", "other-label"]);

    const run = makeRun({ state: RunState.Implementing, linearIssueId: "LIN-9" });
    await service.syncState(run);

    expect(linearClient.removeLabel).toHaveBeenCalledWith("LIN-9", "ai:planning");
    expect(linearClient.removeLabel).not.toHaveBeenCalledWith("LIN-9", "other-label");
    expect(linearClient.addLabel).toHaveBeenCalledWith("LIN-9", "ai:implementing");
    expect(linearClient.updateIssueState).toHaveBeenCalledWith("LIN-9", "In Progress");
    expect(logger.debug).toHaveBeenCalledWith(
      expect.objectContaining({
        issueId: "LIN-9",
        label: "ai:implementing",
        removedLabels: ["ai:planning"],
      }),
      "Synced Linear state",
    );
  });

  it("does not add the label again when it is already present", async () => {
    linearClient.listLabels.mockResolvedValue(["ai:implementing"]);

    const run = makeRun({ state: RunState.Implementing, linearIssueId: "LIN-9" });
    await service.syncState(run);

    expect(linearClient.addLabel).not.toHaveBeenCalled();
    expect(linearClient.removeLabel).not.toHaveBeenCalled();
    expect(linearClient.updateIssueState).toHaveBeenCalledWith("LIN-9", "In Progress");
  });

  it("does not remove non-ai labels even if unrelated to the mapping", async () => {
    linearClient.listLabels.mockResolvedValue(["team:backend", "priority:high"]);

    const run = makeRun({ state: RunState.Done, linearIssueId: "LIN-9" });
    await service.syncState(run);

    expect(linearClient.removeLabel).not.toHaveBeenCalled();
    expect(linearClient.addLabel).toHaveBeenCalledWith("LIN-9", "ai:done");
  });

  it("removes multiple stale ai: labels in one sync", async () => {
    linearClient.listLabels.mockResolvedValue(["ai:planning", "ai:code-review"]);

    const run = makeRun({ state: RunState.Failed, linearIssueId: "LIN-9" });
    await service.syncState(run);

    expect(linearClient.removeLabel).toHaveBeenCalledWith("LIN-9", "ai:planning");
    expect(linearClient.removeLabel).toHaveBeenCalledWith("LIN-9", "ai:code-review");
    expect(linearClient.removeLabel).toHaveBeenCalledTimes(2);
    expect(linearClient.addLabel).toHaveBeenCalledWith("LIN-9", "ai:failed");
  });
});
