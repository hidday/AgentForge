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

function makeLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
}

function makeLinearClient() {
  return {
    listLabels: vi.fn().mockResolvedValue([]),
    removeLabel: vi.fn().mockResolvedValue(undefined),
    addLabel: vi.fn().mockResolvedValue(undefined),
    updateIssueState: vi.fn().mockResolvedValue(undefined),
    getIssue: vi.fn(),
    getRelatedContext: vi.fn(),
    searchIssues: vi.fn(),
    postComment: vi.fn(),
  };
}

describe("getLabelForState", () => {
  it("maps Todo to ai:todo / Todo", () => {
    expect(getLabelForState(RunState.Todo)).toEqual({ label: "ai:todo", issueState: "Todo" });
  });

  it("maps Planning to ai:planning / In Progress", () => {
    expect(getLabelForState(RunState.Planning)).toEqual({
      label: "ai:planning",
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

  it("maps ReadyForHumanReview to ai:ready-for-review / In Review", () => {
    expect(getLabelForState(RunState.ReadyForHumanReview)).toEqual({
      label: "ai:ready-for-review",
      issueState: "In Review",
    });
  });
});

describe("LinearSyncService.syncState", () => {
  it("removes multiple stale ai:-prefixed labels not matching the target label", async () => {
    const linearClient = makeLinearClient();
    linearClient.listLabels.mockResolvedValue(["ai:planning", "ai:code-review", "ai:done"]);
    const service = new LinearSyncService(linearClient as never, makeLogger() as never);
    const run = makeRun({ linearIssueId: "issue-1", state: RunState.Done });

    await service.syncState(run);

    expect(linearClient.removeLabel).toHaveBeenCalledTimes(2);
    expect(linearClient.removeLabel).toHaveBeenCalledWith("issue-1", "ai:planning");
    expect(linearClient.removeLabel).toHaveBeenCalledWith("issue-1", "ai:code-review");
    // The matching label "ai:done" must not be removed.
    expect(linearClient.removeLabel).not.toHaveBeenCalledWith("issue-1", "ai:done");
  });

  it("leaves non-ai:-prefixed labels alone (never passed to removeLabel)", async () => {
    const linearClient = makeLinearClient();
    linearClient.listLabels.mockResolvedValue(["bug", "urgent", "ai:planning"]);
    const service = new LinearSyncService(linearClient as never, makeLogger() as never);
    const run = makeRun({ linearIssueId: "issue-1", state: RunState.Done });

    await service.syncState(run);

    expect(linearClient.removeLabel).toHaveBeenCalledTimes(1);
    expect(linearClient.removeLabel).toHaveBeenCalledWith("issue-1", "ai:planning");
    expect(linearClient.removeLabel).not.toHaveBeenCalledWith("issue-1", "bug");
    expect(linearClient.removeLabel).not.toHaveBeenCalledWith("issue-1", "urgent");
  });

  it("adds the target label when not already present", async () => {
    const linearClient = makeLinearClient();
    linearClient.listLabels.mockResolvedValue([]);
    const service = new LinearSyncService(linearClient as never, makeLogger() as never);
    const run = makeRun({ linearIssueId: "issue-1", state: RunState.Todo });

    await service.syncState(run);

    expect(linearClient.addLabel).toHaveBeenCalledWith("issue-1", "ai:todo");
  });

  it("does not re-add the target label when already present", async () => {
    const linearClient = makeLinearClient();
    linearClient.listLabels.mockResolvedValue(["ai:todo"]);
    const service = new LinearSyncService(linearClient as never, makeLogger() as never);
    const run = makeRun({ linearIssueId: "issue-1", state: RunState.Todo });

    await service.syncState(run);

    expect(linearClient.addLabel).not.toHaveBeenCalled();
  });

  it("always calls updateIssueState with the mapped issueState", async () => {
    const linearClient = makeLinearClient();
    linearClient.listLabels.mockResolvedValue([]);
    const service = new LinearSyncService(linearClient as never, makeLogger() as never);
    const run = makeRun({ linearIssueId: "issue-7", state: RunState.AIBlocked });

    await service.syncState(run);

    expect(linearClient.updateIssueState).toHaveBeenCalledWith("issue-7", "In Progress");
  });
});
