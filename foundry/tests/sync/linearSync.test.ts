import { describe, it, expect, vi, beforeEach } from "vitest";
import { LinearSyncService, getLabelForState } from "../../src/sync/linearSync.js";
import { RunState } from "../../src/domain/runState.js";
import type { Run } from "../../src/domain/types.js";

function makeRun(overrides: Partial<Run> = {}): Run {
  return {
    id: "run-1",
    linearIssueId: "issue-1",
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
    workingDirectory: "/tmp/run-1",
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
    listLabels: vi.fn(),
  };
}

function makeLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
}

describe("getLabelForState", () => {
  it("returns a label and issueState for every RunState", () => {
    for (const state of Object.values(RunState)) {
      const mapping = getLabelForState(state);
      expect(mapping.label.startsWith("ai:")).toBe(true);
      expect(mapping.issueState).toBeTruthy();
    }
  });

  it("maps ReadyForHumanReview to the in-review label and state", () => {
    expect(getLabelForState(RunState.ReadyForHumanReview)).toEqual({
      label: "ai:ready-for-review",
      issueState: "In Review",
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

  it("adds the mapped label when it is not already present and has no stale labels to remove", async () => {
    linearClient.listLabels.mockResolvedValue(["some-other-label"]);
    const run = makeRun({ state: RunState.Implementing, linearIssueId: "issue-1" });

    await service.syncState(run);

    expect(linearClient.removeLabel).not.toHaveBeenCalled();
    expect(linearClient.addLabel).toHaveBeenCalledWith("issue-1", "ai:implementing");
    expect(linearClient.updateIssueState).toHaveBeenCalledWith("issue-1", "In Progress");
  });

  it("removes stale ai: labels that differ from the current mapping", async () => {
    linearClient.listLabels.mockResolvedValue(["ai:planning", "ai:todo", "not-ai"]);
    const run = makeRun({ state: RunState.Implementing, linearIssueId: "issue-1" });

    await service.syncState(run);

    expect(linearClient.removeLabel).toHaveBeenCalledWith("issue-1", "ai:planning");
    expect(linearClient.removeLabel).toHaveBeenCalledWith("issue-1", "ai:todo");
    expect(linearClient.removeLabel).not.toHaveBeenCalledWith("issue-1", "not-ai");
    expect(linearClient.addLabel).toHaveBeenCalledWith("issue-1", "ai:implementing");
  });

  it("does not re-add the label when it is already present", async () => {
    linearClient.listLabels.mockResolvedValue(["ai:implementing"]);
    const run = makeRun({ state: RunState.Implementing, linearIssueId: "issue-1" });

    await service.syncState(run);

    expect(linearClient.addLabel).not.toHaveBeenCalled();
    expect(linearClient.removeLabel).not.toHaveBeenCalled();
    expect(linearClient.updateIssueState).toHaveBeenCalledWith("issue-1", "In Progress");
  });

  it("always calls updateIssueState with the mapped issue state", async () => {
    linearClient.listLabels.mockResolvedValue([]);
    const run = makeRun({ state: RunState.Done, linearIssueId: "issue-9" });

    await service.syncState(run);

    expect(linearClient.updateIssueState).toHaveBeenCalledWith("issue-9", "Done");
  });
});
