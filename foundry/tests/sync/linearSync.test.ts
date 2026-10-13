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

function makeLinearClient() {
  return {
    getIssue: vi.fn(),
    getRelatedContext: vi.fn(),
    searchIssues: vi.fn(),
    postComment: vi.fn().mockResolvedValue(undefined),
    updateIssueState: vi.fn().mockResolvedValue(undefined),
    addLabel: vi.fn().mockResolvedValue(undefined),
    removeLabel: vi.fn().mockResolvedValue(undefined),
    listLabels: vi.fn(),
  };
}

function makeLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };
}

describe("getLabelForState", () => {
  it("maps every run state to a label and Linear issue state", () => {
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

describe("LinearSyncService", () => {
  let linearClient: ReturnType<typeof makeLinearClient>;
  let logger: ReturnType<typeof makeLogger>;
  let service: LinearSyncService;

  beforeEach(() => {
    linearClient = makeLinearClient();
    logger = makeLogger();
    service = new LinearSyncService(linearClient as never, logger as never);
  });

  it("adds the target label and updates issue state when the issue has no AI labels yet", async () => {
    linearClient.listLabels.mockResolvedValue([]);
    const run = makeRun({ linearIssueId: "LIN-42", state: RunState.Implementing });

    await service.syncState(run);

    expect(linearClient.removeLabel).not.toHaveBeenCalled();
    expect(linearClient.addLabel).toHaveBeenCalledWith("LIN-42", "ai:implementing");
    expect(linearClient.updateIssueState).toHaveBeenCalledWith("LIN-42", "In Progress");
  });

  it("is a no-op for labels when the target label is already present", async () => {
    linearClient.listLabels.mockResolvedValue(["ai:implementing", "bug"]);
    const run = makeRun({ linearIssueId: "LIN-42", state: RunState.Implementing });

    await service.syncState(run);

    expect(linearClient.addLabel).not.toHaveBeenCalled();
    expect(linearClient.removeLabel).not.toHaveBeenCalled();
    expect(linearClient.updateIssueState).toHaveBeenCalledWith("LIN-42", "In Progress");
  });

  it("removes stale ai: labels that don't match the new state before adding the new one", async () => {
    linearClient.listLabels.mockResolvedValue(["ai:planning", "ai:code-review", "bug"]);
    const run = makeRun({ linearIssueId: "LIN-42", state: RunState.ReadyForHumanReview });

    await service.syncState(run);

    expect(linearClient.removeLabel).toHaveBeenCalledTimes(2);
    expect(linearClient.removeLabel).toHaveBeenCalledWith("LIN-42", "ai:planning");
    expect(linearClient.removeLabel).toHaveBeenCalledWith("LIN-42", "ai:code-review");
    expect(linearClient.addLabel).toHaveBeenCalledWith("LIN-42", "ai:ready-for-review");
    expect(linearClient.updateIssueState).toHaveBeenCalledWith("LIN-42", "In Review");
  });

  it("never removes non-ai labels", async () => {
    linearClient.listLabels.mockResolvedValue(["bug", "urgent"]);
    const run = makeRun({ linearIssueId: "LIN-42", state: RunState.Done });

    await service.syncState(run);

    expect(linearClient.removeLabel).not.toHaveBeenCalled();
    expect(linearClient.addLabel).toHaveBeenCalledWith("LIN-42", "ai:done");
  });

  it("logs the sync outcome including removed labels", async () => {
    linearClient.listLabels.mockResolvedValue(["ai:planning"]);
    const run = makeRun({ linearIssueId: "LIN-42", state: RunState.AIReview });

    await service.syncState(run);

    expect(logger.debug).toHaveBeenCalledWith(
      {
        issueId: "LIN-42",
        state: RunState.AIReview,
        label: "ai:code-review",
        issueState: "In Progress",
        removedLabels: ["ai:planning"],
      },
      "Synced Linear state",
    );
  });

  it("propagates an error from the Linear API without swallowing it", async () => {
    linearClient.listLabels.mockRejectedValue(new Error("Linear API down"));
    const run = makeRun({ linearIssueId: "LIN-42", state: RunState.Implementing });

    await expect(service.syncState(run)).rejects.toThrow("Linear API down");
    expect(linearClient.addLabel).not.toHaveBeenCalled();
  });
});
