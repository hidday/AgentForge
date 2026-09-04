import { describe, it, expect, vi, beforeEach } from "vitest";
import { LinearSyncService, getLabelForState } from "../../src/sync/linearSync.js";
import { RunState } from "../../src/domain/runState.js";
import type { Run } from "../../src/domain/types.js";

function makeRun(overrides: Partial<Run> = {}): Run {
  return {
    id: "run-1",
    linearIssueId: "issue-1",
    linearIssueIdentifier: "PRY-1",
    linearIssueDescription: null,
    linearIssueTitle: "Title",
    linearIssueUrl: null,
    repo: "org/repo",
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
    postComment: vi.fn(),
    updateIssueState: vi.fn().mockResolvedValue(undefined),
    addLabel: vi.fn().mockResolvedValue(undefined),
    removeLabel: vi.fn().mockResolvedValue(undefined),
    listLabels: vi.fn().mockResolvedValue([]),
  };
}

function makeLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
}

describe("getLabelForState", () => {
  it("maps every RunState to a label and issueState", () => {
    for (const state of Object.values(RunState)) {
      const mapping = getLabelForState(state);
      expect(mapping.label).toMatch(/^ai:/);
      expect(mapping.issueState).toBeTruthy();
    }
  });

  it("maps ReadyForHumanReview to the 'In Review' issue state", () => {
    expect(getLabelForState(RunState.ReadyForHumanReview)).toEqual({
      label: "ai:ready-for-review",
      issueState: "In Review",
    });
  });

  it("maps Failed to the Cancelled issue state", () => {
    expect(getLabelForState(RunState.Failed)).toEqual({
      label: "ai:failed",
      issueState: "Cancelled",
    });
  });

  it("maps Done to the Done issue state", () => {
    expect(getLabelForState(RunState.Done)).toEqual({
      label: "ai:done",
      issueState: "Done",
    });
  });
});

describe("LinearSyncService.syncState", () => {
  let linearClient: ReturnType<typeof makeLinearClient>;
  let service: LinearSyncService;

  beforeEach(() => {
    linearClient = makeLinearClient();
    service = new LinearSyncService(linearClient as never, makeLogger() as never);
  });

  it("adds the label for the new state when it is not already present", async () => {
    linearClient.listLabels.mockResolvedValue([]);
    const run = makeRun({ state: RunState.Implementing });

    await service.syncState(run);

    expect(linearClient.addLabel).toHaveBeenCalledWith("issue-1", "ai:implementing");
    expect(linearClient.updateIssueState).toHaveBeenCalledWith("issue-1", "In Progress");
  });

  it("does not re-add the label when it is already present", async () => {
    linearClient.listLabels.mockResolvedValue(["ai:implementing"]);
    const run = makeRun({ state: RunState.Implementing });

    await service.syncState(run);

    expect(linearClient.addLabel).not.toHaveBeenCalled();
  });

  it("removes stale ai: labels that do not match the new state", async () => {
    linearClient.listLabels.mockResolvedValue(["ai:planning", "ai:code-review", "bug"]);
    const run = makeRun({ state: RunState.Implementing });

    await service.syncState(run);

    expect(linearClient.removeLabel).toHaveBeenCalledWith("issue-1", "ai:planning");
    expect(linearClient.removeLabel).toHaveBeenCalledWith("issue-1", "ai:code-review");
    expect(linearClient.removeLabel).not.toHaveBeenCalledWith("issue-1", "bug");
    expect(linearClient.removeLabel).toHaveBeenCalledTimes(2);
  });

  it("does not remove a label that already matches the new state", async () => {
    linearClient.listLabels.mockResolvedValue(["ai:implementing"]);
    const run = makeRun({ state: RunState.Implementing });

    await service.syncState(run);

    expect(linearClient.removeLabel).not.toHaveBeenCalled();
  });

  it("always updates the Linear issue state to match the mapped issueState", async () => {
    linearClient.listLabels.mockResolvedValue([]);
    const run = makeRun({ state: RunState.Done });

    await service.syncState(run);

    expect(linearClient.updateIssueState).toHaveBeenCalledWith("issue-1", "Done");
  });

  it("does not touch non-ai-prefixed labels at all", async () => {
    linearClient.listLabels.mockResolvedValue(["priority:high", "team:eng"]);
    const run = makeRun({ state: RunState.Todo });

    await service.syncState(run);

    expect(linearClient.removeLabel).not.toHaveBeenCalled();
    expect(linearClient.addLabel).toHaveBeenCalledWith("issue-1", "ai:todo");
  });
});
