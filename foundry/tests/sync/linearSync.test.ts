import { describe, it, expect, vi, beforeEach } from "vitest";
import { LinearSyncService, getLabelForState } from "../../src/sync/linearSync.js";
import { RunState } from "../../src/domain/runState.js";
import type { Run } from "../../src/domain/types.js";

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
    linearIssueId: "issue-1",
    linearIssueIdentifier: "PRY-1",
    linearIssueDescription: null,
    linearIssueTitle: null,
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
    workingDirectory: "/tmp/repo",
    latestArtifactVersion: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe("getLabelForState", () => {
  it("maps every RunState to a distinct ai: label and its Linear workflow state", () => {
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
  let service: LinearSyncService;

  beforeEach(() => {
    linearClient = makeLinearClient();
    service = new LinearSyncService(linearClient as never, makeLogger() as never);
  });

  it("adds the mapped label and removes stale ai: labels when the current label doesn't match", async () => {
    linearClient.listLabels.mockResolvedValue(["ai:planning", "feature-x"]);

    await service.syncState(makeRun({ state: RunState.Implementing }));

    expect(linearClient.removeLabel).toHaveBeenCalledWith("issue-1", "ai:planning");
    expect(linearClient.removeLabel).not.toHaveBeenCalledWith("issue-1", "feature-x");
    expect(linearClient.addLabel).toHaveBeenCalledWith("issue-1", "ai:implementing");
    expect(linearClient.updateIssueState).toHaveBeenCalledWith("issue-1", "In Progress");
  });

  it("does not add the label again when it is already present", async () => {
    linearClient.listLabels.mockResolvedValue(["ai:implementing"]);

    await service.syncState(makeRun({ state: RunState.Implementing }));

    expect(linearClient.addLabel).not.toHaveBeenCalled();
    expect(linearClient.removeLabel).not.toHaveBeenCalled();
    expect(linearClient.updateIssueState).toHaveBeenCalledWith("issue-1", "In Progress");
  });

  it("removes multiple stale ai: labels at once, leaving non-ai labels untouched", async () => {
    linearClient.listLabels.mockResolvedValue(["ai:todo", "ai:planning", "bug", "ai:done"]);

    await service.syncState(makeRun({ state: RunState.ReadyForHumanReview }));

    expect(linearClient.removeLabel).toHaveBeenCalledWith("issue-1", "ai:todo");
    expect(linearClient.removeLabel).toHaveBeenCalledWith("issue-1", "ai:planning");
    expect(linearClient.removeLabel).toHaveBeenCalledWith("issue-1", "ai:done");
    expect(linearClient.removeLabel).toHaveBeenCalledTimes(3);
    expect(linearClient.addLabel).toHaveBeenCalledWith("issue-1", "ai:ready-for-review");
  });

  it("does nothing with labels when there are no current labels at all", async () => {
    linearClient.listLabels.mockResolvedValue([]);

    await service.syncState(makeRun({ state: RunState.Todo }));

    expect(linearClient.removeLabel).not.toHaveBeenCalled();
    expect(linearClient.addLabel).toHaveBeenCalledWith("issue-1", "ai:todo");
    expect(linearClient.updateIssueState).toHaveBeenCalledWith("issue-1", "Todo");
  });
});
