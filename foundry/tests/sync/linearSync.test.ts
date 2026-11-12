import { describe, it, expect, vi } from "vitest";
import { LinearSyncService, getLabelForState } from "../../src/sync/linearSync.js";
import { RunState } from "../../src/domain/runState.js";
import type { Run } from "../../src/domain/types.js";

function makeRun(overrides: Partial<Run> = {}): Run {
  return {
    id: "run-1",
    linearIssueId: "issue-1",
    linearIssueIdentifier: "PRY-1",
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

function makeLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };
}

function makeLinearClient(overrides: Record<string, unknown> = {}) {
  return {
    listLabels: vi.fn().mockResolvedValue([]),
    removeLabel: vi.fn().mockResolvedValue(undefined),
    addLabel: vi.fn().mockResolvedValue(undefined),
    updateIssueState: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe("getLabelForState", () => {
  it("maps RunState.Implementing to the 'ai:implementing' label and 'In Progress' issue state", () => {
    expect(getLabelForState(RunState.Implementing)).toEqual({
      label: "ai:implementing",
      issueState: "In Progress",
    });
  });

  it("maps RunState.ReadyForHumanReview to the 'ai:ready-for-review' label and 'In Review' issue state", () => {
    expect(getLabelForState(RunState.ReadyForHumanReview)).toEqual({
      label: "ai:ready-for-review",
      issueState: "In Review",
    });
  });

  it("maps RunState.Done to the 'ai:done' label and 'Done' issue state", () => {
    expect(getLabelForState(RunState.Done)).toEqual({ label: "ai:done", issueState: "Done" });
  });

  it("maps RunState.Failed to the 'ai:failed' label and 'Cancelled' issue state", () => {
    expect(getLabelForState(RunState.Failed)).toEqual({
      label: "ai:failed",
      issueState: "Cancelled",
    });
  });
});

describe("LinearSyncService.syncState", () => {
  it("adds the mapped label and updates issue state when no ai labels currently exist", async () => {
    const linearClient = makeLinearClient({ listLabels: vi.fn().mockResolvedValue(["bug"]) });
    const logger = makeLogger();
    const service = new LinearSyncService(linearClient as never, logger as never);
    const run = makeRun({ linearIssueId: "issue-1", state: RunState.Implementing });

    await service.syncState(run);

    expect(linearClient.removeLabel).not.toHaveBeenCalled();
    expect(linearClient.addLabel).toHaveBeenCalledWith("issue-1", "ai:implementing");
    expect(linearClient.updateIssueState).toHaveBeenCalledWith("issue-1", "In Progress");
    expect(logger.debug).toHaveBeenCalledWith(
      expect.objectContaining({
        issueId: "issue-1",
        state: RunState.Implementing,
        label: "ai:implementing",
        issueState: "In Progress",
        removedLabels: [],
      }),
      "Synced Linear state",
    );
  });

  it("removes stale ai: labels that don't match the current state's label", async () => {
    const linearClient = makeLinearClient({
      listLabels: vi.fn().mockResolvedValue(["ai:planning", "bug"]),
    });
    const service = new LinearSyncService(linearClient as never, makeLogger() as never);
    const run = makeRun({ state: RunState.Implementing });

    await service.syncState(run);

    expect(linearClient.removeLabel).toHaveBeenCalledWith("issue-1", "ai:planning");
    expect(linearClient.addLabel).toHaveBeenCalledWith("issue-1", "ai:implementing");
  });

  it("does not add the label again when it is already present", async () => {
    const linearClient = makeLinearClient({
      listLabels: vi.fn().mockResolvedValue(["ai:implementing"]),
    });
    const service = new LinearSyncService(linearClient as never, makeLogger() as never);
    const run = makeRun({ state: RunState.Implementing });

    await service.syncState(run);

    expect(linearClient.addLabel).not.toHaveBeenCalled();
    expect(linearClient.removeLabel).not.toHaveBeenCalled();
  });

  it("removes multiple stale ai labels while leaving non-ai labels untouched", async () => {
    const linearClient = makeLinearClient({
      listLabels: vi.fn().mockResolvedValue(["ai:planning", "ai:code-review", "feature"]),
    });
    const service = new LinearSyncService(linearClient as never, makeLogger() as never);
    const run = makeRun({ state: RunState.Done });

    await service.syncState(run);

    expect(linearClient.removeLabel).toHaveBeenCalledWith("issue-1", "ai:planning");
    expect(linearClient.removeLabel).toHaveBeenCalledWith("issue-1", "ai:code-review");
    expect(linearClient.removeLabel).toHaveBeenCalledTimes(2);
    expect(linearClient.addLabel).toHaveBeenCalledWith("issue-1", "ai:done");
    expect(linearClient.updateIssueState).toHaveBeenCalledWith("issue-1", "Done");
  });
});
