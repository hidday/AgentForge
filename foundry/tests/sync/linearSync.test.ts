import { describe, it, expect, vi } from "vitest";
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

function buildLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
}

function buildLinearClient(overrides: Record<string, unknown> = {}) {
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
  };
}

describe("getLabelForState", () => {
  it("returns the correct label/issueState mapping for Todo", () => {
    expect(getLabelForState(RunState.Todo)).toEqual({ label: "ai:todo", issueState: "Todo" });
  });

  it("returns the correct label/issueState mapping for Implementing", () => {
    expect(getLabelForState(RunState.Implementing)).toEqual({
      label: "ai:implementing",
      issueState: "In Progress",
    });
  });

  it("returns the correct label/issueState mapping for Done", () => {
    expect(getLabelForState(RunState.Done)).toEqual({ label: "ai:done", issueState: "Done" });
  });

  it("returns the correct label/issueState mapping for Failed", () => {
    expect(getLabelForState(RunState.Failed)).toEqual({
      label: "ai:failed",
      issueState: "Cancelled",
    });
  });

  it("returns the correct label/issueState mapping for ReadyForHumanReview", () => {
    expect(getLabelForState(RunState.ReadyForHumanReview)).toEqual({
      label: "ai:ready-for-review",
      issueState: "In Review",
    });
  });
});

describe("LinearSyncService.syncState", () => {
  it("adds the target label when current labels do not include it", async () => {
    const linearClient = buildLinearClient({ listLabels: vi.fn().mockResolvedValue([]) });
    const logger = buildLogger();
    const svc = new LinearSyncService(linearClient as never, logger as never);

    const run = makeRun({ linearIssueId: "LIN-1", state: RunState.Implementing });
    await svc.syncState(run);

    expect(linearClient.addLabel).toHaveBeenCalledWith("LIN-1", "ai:implementing");
    expect(linearClient.updateIssueState).toHaveBeenCalledWith("LIN-1", "In Progress");
  });

  it("does not add the target label when current labels already include it", async () => {
    const linearClient = buildLinearClient({
      listLabels: vi.fn().mockResolvedValue(["ai:implementing"]),
    });
    const logger = buildLogger();
    const svc = new LinearSyncService(linearClient as never, logger as never);

    const run = makeRun({ linearIssueId: "LIN-1", state: RunState.Implementing });
    await svc.syncState(run);

    expect(linearClient.addLabel).not.toHaveBeenCalled();
    expect(linearClient.updateIssueState).toHaveBeenCalledWith("LIN-1", "In Progress");
  });

  it("removes stale ai:* labels that do not match the target label", async () => {
    const linearClient = buildLinearClient({
      listLabels: vi.fn().mockResolvedValue(["ai:todo", "ai:planning", "other-label"]),
    });
    const logger = buildLogger();
    const svc = new LinearSyncService(linearClient as never, logger as never);

    const run = makeRun({ linearIssueId: "LIN-1", state: RunState.Implementing });
    await svc.syncState(run);

    expect(linearClient.removeLabel).toHaveBeenCalledTimes(2);
    expect(linearClient.removeLabel).toHaveBeenCalledWith("LIN-1", "ai:todo");
    expect(linearClient.removeLabel).toHaveBeenCalledWith("LIN-1", "ai:planning");
    expect(linearClient.removeLabel).not.toHaveBeenCalledWith("LIN-1", "other-label");
    expect(linearClient.addLabel).toHaveBeenCalledWith("LIN-1", "ai:implementing");
  });

  it("does not remove any labels when there are no stale ai:* labels", async () => {
    const linearClient = buildLinearClient({
      listLabels: vi.fn().mockResolvedValue(["ai:implementing", "other-label"]),
    });
    const logger = buildLogger();
    const svc = new LinearSyncService(linearClient as never, logger as never);

    const run = makeRun({ linearIssueId: "LIN-1", state: RunState.Implementing });
    await svc.syncState(run);

    expect(linearClient.removeLabel).not.toHaveBeenCalled();
  });

  it("always calls updateIssueState with the mapped issueState and logs debug", async () => {
    const linearClient = buildLinearClient({
      listLabels: vi.fn().mockResolvedValue(["ai:planning"]),
    });
    const logger = buildLogger();
    const svc = new LinearSyncService(linearClient as never, logger as never);

    const run = makeRun({ linearIssueId: "LIN-9", state: RunState.Done });
    await svc.syncState(run);

    expect(linearClient.updateIssueState).toHaveBeenCalledWith("LIN-9", "Done");
    expect(logger.debug).toHaveBeenCalledWith(
      {
        issueId: "LIN-9",
        state: RunState.Done,
        label: "ai:done",
        issueState: "Done",
        removedLabels: ["ai:planning"],
      },
      "Synced Linear state",
    );
  });
});
