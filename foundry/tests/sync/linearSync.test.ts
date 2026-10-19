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
    linearIssueId: "issue-1",
    linearIssueIdentifier: "ENG-1",
    linearIssueDescription: null,
    linearIssueTitle: "Title",
    linearIssueUrl: null,
    repo: "owner/repo",
    branchName: null,
    prNumber: null,
    state: RunState.Planning,
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
  it("maps every RunState to a unique ai:* label", () => {
    const allStates = Object.values(RunState);
    const labels = allStates.map((s) => getLabelForState(s).label);
    expect(new Set(labels).size).toBe(allStates.length);
    for (const label of labels) {
      expect(label).toMatch(/^ai:/);
    }
  });

  it("maps Done to the 'Done' Linear issue state and Failed to 'Cancelled'", () => {
    expect(getLabelForState(RunState.Done).issueState).toBe("Done");
    expect(getLabelForState(RunState.Failed).issueState).toBe("Cancelled");
  });
});

describe("LinearSyncService.syncState", () => {
  let linearClient: ReturnType<typeof makeLinearClient>;
  let service: LinearSyncService;

  beforeEach(() => {
    linearClient = makeLinearClient();
    service = new LinearSyncService(linearClient as never, makeLogger() as never);
  });

  it("adds the mapped label and updates issue state when no ai: label is present", async () => {
    linearClient.listLabels.mockResolvedValue(["bug"]);
    await service.syncState(makeRun({ state: RunState.Planning }));

    expect(linearClient.addLabel).toHaveBeenCalledWith("issue-1", "ai:planning");
    expect(linearClient.removeLabel).not.toHaveBeenCalled();
    expect(linearClient.updateIssueState).toHaveBeenCalledWith("issue-1", "In Progress");
  });

  it("removes stale ai: labels that don't match the current state", async () => {
    linearClient.listLabels.mockResolvedValue(["ai:todo", "bug"]);
    await service.syncState(makeRun({ state: RunState.Planning }));

    expect(linearClient.removeLabel).toHaveBeenCalledWith("issue-1", "ai:todo");
    expect(linearClient.addLabel).toHaveBeenCalledWith("issue-1", "ai:planning");
  });

  it("does not re-add the label when it is already present", async () => {
    linearClient.listLabels.mockResolvedValue(["ai:planning"]);
    await service.syncState(makeRun({ state: RunState.Planning }));

    expect(linearClient.addLabel).not.toHaveBeenCalled();
  });

  it("removes multiple stale ai: labels in one sync", async () => {
    linearClient.listLabels.mockResolvedValue(["ai:todo", "ai:blocked"]);
    await service.syncState(makeRun({ state: RunState.Implementing }));

    expect(linearClient.removeLabel).toHaveBeenCalledWith("issue-1", "ai:todo");
    expect(linearClient.removeLabel).toHaveBeenCalledWith("issue-1", "ai:blocked");
    expect(linearClient.removeLabel).toHaveBeenCalledTimes(2);
  });

  it("maps Done state to the 'ai:done' label and 'Done' issue state", async () => {
    linearClient.listLabels.mockResolvedValue([]);
    await service.syncState(makeRun({ state: RunState.Done }));

    expect(linearClient.addLabel).toHaveBeenCalledWith("issue-1", "ai:done");
    expect(linearClient.updateIssueState).toHaveBeenCalledWith("issue-1", "Done");
  });
});
