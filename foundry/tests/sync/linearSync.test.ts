import { describe, it, expect, vi, beforeEach } from "vitest";
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
    linearIssueId: "LIN-1",
    linearIssueIdentifier: null,
    linearIssueDescription: null,
    linearIssueTitle: null,
    linearIssueUrl: null,
    repo: "owner/repo",
    branchName: null,
    prNumber: null,
    state: RunState.Implementing,
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
  it("maps each run state to its corresponding label and issue state", () => {
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
  let logger: ReturnType<typeof makeLogger>;
  let linearClient: ReturnType<typeof makeLinearClient>;
  let svc: LinearSyncService;

  beforeEach(() => {
    logger = makeLogger();
    linearClient = makeLinearClient();
    svc = new LinearSyncService(linearClient as never, logger as never);
  });

  it("adds the mapped label and updates issue state when the label is not yet present", async () => {
    linearClient.listLabels.mockResolvedValue([]);

    await svc.syncState(makeRun({ state: RunState.Implementing }));

    expect(linearClient.addLabel).toHaveBeenCalledWith("LIN-1", "ai:implementing");
    expect(linearClient.updateIssueState).toHaveBeenCalledWith("LIN-1", "In Progress");
    expect(linearClient.removeLabel).not.toHaveBeenCalled();
  });

  it("does not re-add the label when it is already present", async () => {
    linearClient.listLabels.mockResolvedValue(["ai:implementing"]);

    await svc.syncState(makeRun({ state: RunState.Implementing }));

    expect(linearClient.addLabel).not.toHaveBeenCalled();
    expect(linearClient.updateIssueState).toHaveBeenCalledWith("LIN-1", "In Progress");
  });

  it("removes stale ai: labels that differ from the target label", async () => {
    linearClient.listLabels.mockResolvedValue(["ai:planning", "unrelated-label"]);

    await svc.syncState(makeRun({ state: RunState.Implementing }));

    expect(linearClient.removeLabel).toHaveBeenCalledWith("LIN-1", "ai:planning");
    expect(linearClient.removeLabel).not.toHaveBeenCalledWith("LIN-1", "unrelated-label");
    expect(linearClient.addLabel).toHaveBeenCalledWith("LIN-1", "ai:implementing");
  });

  it("does not remove a non-ai label even if it doesn't match the target label", async () => {
    linearClient.listLabels.mockResolvedValue(["unrelated-label"]);

    await svc.syncState(makeRun({ state: RunState.Done }));

    expect(linearClient.removeLabel).not.toHaveBeenCalled();
  });

  it("always calls updateIssueState with the mapped issue state for the run's state", async () => {
    linearClient.listLabels.mockResolvedValue(["ai:done"]);

    await svc.syncState(makeRun({ state: RunState.Failed }));

    expect(linearClient.updateIssueState).toHaveBeenCalledWith("LIN-1", "Cancelled");
    expect(linearClient.addLabel).toHaveBeenCalledWith("LIN-1", "ai:failed");
  });
});
