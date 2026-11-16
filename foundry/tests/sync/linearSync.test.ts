import { describe, it, expect, vi } from "vitest";
import { LinearSyncService, getLabelForState } from "../../src/sync/linearSync.js";
import { RunState } from "../../src/domain/runState.js";
import type { Run } from "../../src/domain/types.js";

function makeRun(overrides: Partial<Run> = {}): Run {
  return {
    id: "run-1",
    linearIssueId: "iss-1",
    linearIssueIdentifier: "LIN-1",
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

function buildService(listLabelsResult: string[] = []) {
  const linearClient = {
    listLabels: vi.fn().mockResolvedValue(listLabelsResult),
    removeLabel: vi.fn().mockResolvedValue(undefined),
    addLabel: vi.fn().mockResolvedValue(undefined),
    updateIssueState: vi.fn().mockResolvedValue(undefined),
  };
  const logger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };
  const service = new LinearSyncService(linearClient as never, logger as never);
  return { service, linearClient, logger };
}

describe("getLabelForState", () => {
  it("maps Todo to ai:todo / Todo", () => {
    expect(getLabelForState(RunState.Todo)).toEqual({ label: "ai:todo", issueState: "Todo" });
  });

  it("maps Implementing to ai:implementing / In Progress", () => {
    expect(getLabelForState(RunState.Implementing)).toEqual({
      label: "ai:implementing",
      issueState: "In Progress",
    });
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
  it("removes a stale ai:* label that does not match the new mapping", async () => {
    const { service, linearClient } = buildService(["ai:planning", "other-label"]);
    const run = makeRun({ state: RunState.Implementing });

    await service.syncState(run);

    expect(linearClient.removeLabel).toHaveBeenCalledWith("iss-1", "ai:planning");
    expect(linearClient.removeLabel).toHaveBeenCalledTimes(1);
  });

  it("does not call addLabel when the correct new label is already present", async () => {
    const { service, linearClient } = buildService(["ai:implementing"]);
    const run = makeRun({ state: RunState.Implementing });

    await service.syncState(run);

    expect(linearClient.addLabel).not.toHaveBeenCalled();
    expect(linearClient.removeLabel).not.toHaveBeenCalled();
  });

  it("calls addLabel when the correct new label is missing", async () => {
    const { service, linearClient } = buildService([]);
    const run = makeRun({ state: RunState.Implementing });

    await service.syncState(run);

    expect(linearClient.addLabel).toHaveBeenCalledWith("iss-1", "ai:implementing");
  });

  it("always calls updateIssueState with the mapped issueState", async () => {
    const { service, linearClient } = buildService([]);
    const run = makeRun({ state: RunState.ReadyForHumanReview });

    await service.syncState(run);

    expect(linearClient.updateIssueState).toHaveBeenCalledWith("iss-1", "In Review");
  });

  it("logs the sync with removed labels and the new mapping", async () => {
    const { service, logger } = buildService(["ai:planning"]);
    const run = makeRun({ state: RunState.Implementing });

    await service.syncState(run);

    expect(logger.debug).toHaveBeenCalledWith(
      expect.objectContaining({
        issueId: "iss-1",
        state: RunState.Implementing,
        label: "ai:implementing",
        issueState: "In Progress",
        removedLabels: ["ai:planning"],
      }),
      "Synced Linear state",
    );
  });
});
