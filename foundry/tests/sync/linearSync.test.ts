import { describe, it, expect, vi } from "vitest";
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
    listLabels: vi.fn(),
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

  it("maps specific states to their expected label/issueState pairs", () => {
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
  it("adds the mapped label and updates issue state when no AI labels exist yet", async () => {
    const linearClient = makeLinearClient();
    linearClient.listLabels.mockResolvedValue(["unrelated"]);
    const service = new LinearSyncService(linearClient as never, makeLogger() as never);

    await service.syncState(makeRun({ state: RunState.Implementing }));

    expect(linearClient.addLabel).toHaveBeenCalledWith("issue-1", "ai:implementing");
    expect(linearClient.removeLabel).not.toHaveBeenCalled();
    expect(linearClient.updateIssueState).toHaveBeenCalledWith("issue-1", "In Progress");
  });

  it("removes stale ai: labels that do not match the current state", async () => {
    const linearClient = makeLinearClient();
    linearClient.listLabels.mockResolvedValue(["ai:planning", "ai:todo", "keep-me"]);
    const service = new LinearSyncService(linearClient as never, makeLogger() as never);

    await service.syncState(makeRun({ state: RunState.Implementing }));

    expect(linearClient.removeLabel).toHaveBeenCalledWith("issue-1", "ai:planning");
    expect(linearClient.removeLabel).toHaveBeenCalledWith("issue-1", "ai:todo");
    expect(linearClient.removeLabel).not.toHaveBeenCalledWith("issue-1", "keep-me");
    expect(linearClient.addLabel).toHaveBeenCalledWith("issue-1", "ai:implementing");
  });

  it("does not re-add the label when it is already present", async () => {
    const linearClient = makeLinearClient();
    linearClient.listLabels.mockResolvedValue(["ai:implementing"]);
    const service = new LinearSyncService(linearClient as never, makeLogger() as never);

    await service.syncState(makeRun({ state: RunState.Implementing }));

    expect(linearClient.addLabel).not.toHaveBeenCalled();
  });

  it("always calls updateIssueState with the mapped issueState", async () => {
    const linearClient = makeLinearClient();
    linearClient.listLabels.mockResolvedValue([]);
    const service = new LinearSyncService(linearClient as never, makeLogger() as never);

    await service.syncState(makeRun({ state: RunState.AIBlocked }));

    expect(linearClient.updateIssueState).toHaveBeenCalledWith("issue-1", "In Progress");
    expect(linearClient.addLabel).toHaveBeenCalledWith("issue-1", "ai:blocked");
  });
});
