import { describe, it, expect, vi, beforeEach } from "vitest";
import { LinearSyncService, getLabelForState } from "../../src/sync/linearSync.js";
import { RunState } from "../../src/domain/runState.js";
import type { Run } from "../../src/domain/types.js";

function makeLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
}

function makeLinearClient() {
  return {
    listLabels: vi.fn().mockResolvedValue([]),
    removeLabel: vi.fn().mockResolvedValue(undefined),
    addLabel: vi.fn().mockResolvedValue(undefined),
    updateIssueState: vi.fn().mockResolvedValue(undefined),
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
  it("maps each RunState to its label and issueState", () => {
    expect(getLabelForState(RunState.Todo)).toEqual({ label: "ai:todo", issueState: "Todo" });
    expect(getLabelForState(RunState.Implementing)).toEqual({
      label: "ai:implementing",
      issueState: "In Progress",
    });
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
  let linearClient: ReturnType<typeof makeLinearClient>;
  let logger: ReturnType<typeof makeLogger>;
  let service: LinearSyncService;

  beforeEach(() => {
    linearClient = makeLinearClient();
    logger = makeLogger();
    service = new LinearSyncService(linearClient as never, logger as never);
  });

  it("adds the target label when it is not yet present", async () => {
    linearClient.listLabels.mockResolvedValue([]);
    const run = makeRun({ state: RunState.Implementing, linearIssueId: "LIN-1" });

    await service.syncState(run);

    expect(linearClient.addLabel).toHaveBeenCalledWith("LIN-1", "ai:implementing");
  });

  it("does not add the target label when it is already present", async () => {
    linearClient.listLabels.mockResolvedValue(["ai:implementing"]);
    const run = makeRun({ state: RunState.Implementing, linearIssueId: "LIN-1" });

    await service.syncState(run);

    expect(linearClient.addLabel).not.toHaveBeenCalled();
  });

  it("removes stale ai: labels that don't match the target label", async () => {
    linearClient.listLabels.mockResolvedValue(["ai:todo", "ai:planning", "not-ai-label"]);
    const run = makeRun({ state: RunState.Implementing, linearIssueId: "LIN-1" });

    await service.syncState(run);

    expect(linearClient.removeLabel).toHaveBeenCalledWith("LIN-1", "ai:todo");
    expect(linearClient.removeLabel).toHaveBeenCalledWith("LIN-1", "ai:planning");
    expect(linearClient.removeLabel).not.toHaveBeenCalledWith("LIN-1", "not-ai-label");
    expect(linearClient.removeLabel).toHaveBeenCalledTimes(2);
  });

  it("does not remove the current ai label even though it matches the ai: prefix", async () => {
    linearClient.listLabels.mockResolvedValue(["ai:implementing"]);
    const run = makeRun({ state: RunState.Implementing, linearIssueId: "LIN-1" });

    await service.syncState(run);

    expect(linearClient.removeLabel).not.toHaveBeenCalled();
  });

  it("never touches non-ai labels", async () => {
    linearClient.listLabels.mockResolvedValue(["bug", "frontend"]);
    const run = makeRun({ state: RunState.Implementing, linearIssueId: "LIN-1" });

    await service.syncState(run);

    expect(linearClient.removeLabel).not.toHaveBeenCalled();
    expect(linearClient.addLabel).toHaveBeenCalledWith("LIN-1", "ai:implementing");
  });

  it("always updates the issue state to the mapped issueState", async () => {
    const run = makeRun({ state: RunState.ReadyForHumanReview, linearIssueId: "LIN-1" });

    await service.syncState(run);

    expect(linearClient.updateIssueState).toHaveBeenCalledWith("LIN-1", "In Review");
  });

  it("logs the sync with removed labels and mapping details", async () => {
    linearClient.listLabels.mockResolvedValue(["ai:todo"]);
    const run = makeRun({ state: RunState.Planning, linearIssueId: "LIN-1" });

    await service.syncState(run);

    expect(logger.debug).toHaveBeenCalledWith(
      {
        issueId: "LIN-1",
        state: RunState.Planning,
        label: "ai:planning",
        issueState: "In Progress",
        removedLabels: ["ai:todo"],
      },
      "Synced Linear state",
    );
  });
});
