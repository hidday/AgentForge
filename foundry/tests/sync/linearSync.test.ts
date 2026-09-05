import { describe, it, expect, vi } from "vitest";
import { LinearSyncService, getLabelForState } from "../../src/sync/linearSync.js";
import { RunState } from "../../src/domain/runState.js";
import type { Run } from "../../src/domain/types.js";

function makeMockLogger() {
  return { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() };
}

function makeMockLinearClient() {
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
    linearIssueTitle: null,
    linearIssueUrl: null,
    repo: "acme/widgets",
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
  it("returns the correct label/issueState mapping for every RunState", () => {
    expect(getLabelForState(RunState.Todo)).toEqual({ label: "ai:todo", issueState: "Todo" });
    expect(getLabelForState(RunState.Planning)).toEqual({
      label: "ai:planning",
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
    expect(getLabelForState(RunState.AIBlocked)).toEqual({
      label: "ai:blocked",
      issueState: "In Progress",
    });
    expect(getLabelForState(RunState.HumanClarificationNeeded)).toEqual({
      label: "ai:needs-clarification",
      issueState: "In Progress",
    });
  });
});

describe("LinearSyncService.syncState", () => {
  it("adds the state label and updates issue state when no AI label exists yet", async () => {
    const client = makeMockLinearClient();
    client.listLabels.mockResolvedValue(["bug"]);
    const logger = makeMockLogger();
    const svc = new LinearSyncService(client as never, logger as never);

    const run = makeRun({ state: RunState.Implementing, linearIssueId: "issue-1" });
    await svc.syncState(run);

    expect(client.listLabels).toHaveBeenCalledWith("issue-1");
    expect(client.removeLabel).not.toHaveBeenCalled();
    expect(client.addLabel).toHaveBeenCalledWith("issue-1", "ai:implementing");
    expect(client.updateIssueState).toHaveBeenCalledWith("issue-1", "In Progress");
    expect(logger.debug).toHaveBeenCalled();
  });

  it("does not re-add the label when the current label already matches", async () => {
    const client = makeMockLinearClient();
    client.listLabels.mockResolvedValue(["ai:implementing", "bug"]);
    const svc = new LinearSyncService(client as never, makeMockLogger() as never);

    await svc.syncState(makeRun({ state: RunState.Implementing }));

    expect(client.addLabel).not.toHaveBeenCalled();
    expect(client.removeLabel).not.toHaveBeenCalled();
    expect(client.updateIssueState).toHaveBeenCalledWith("issue-1", "In Progress");
  });

  it("removes stale ai: labels that no longer match the target state", async () => {
    const client = makeMockLinearClient();
    client.listLabels.mockResolvedValue(["ai:planning", "ai:code-review", "bug"]);
    const svc = new LinearSyncService(client as never, makeMockLogger() as never);

    await svc.syncState(makeRun({ state: RunState.ReadyForHumanReview }));

    expect(client.removeLabel).toHaveBeenCalledWith("issue-1", "ai:planning");
    expect(client.removeLabel).toHaveBeenCalledWith("issue-1", "ai:code-review");
    expect(client.removeLabel).toHaveBeenCalledTimes(2);
    expect(client.addLabel).toHaveBeenCalledWith("issue-1", "ai:ready-for-review");
    expect(client.updateIssueState).toHaveBeenCalledWith("issue-1", "In Review");
  });

  it("does not remove a non-ai label even if it isn't the target label", async () => {
    const client = makeMockLinearClient();
    client.listLabels.mockResolvedValue(["bug", "urgent"]);
    const svc = new LinearSyncService(client as never, makeMockLogger() as never);

    await svc.syncState(makeRun({ state: RunState.Done }));

    expect(client.removeLabel).not.toHaveBeenCalled();
    expect(client.addLabel).toHaveBeenCalledWith("issue-1", "ai:done");
  });

  it("handles an empty label list", async () => {
    const client = makeMockLinearClient();
    client.listLabels.mockResolvedValue([]);
    const svc = new LinearSyncService(client as never, makeMockLogger() as never);

    await svc.syncState(makeRun({ state: RunState.Todo }));

    expect(client.removeLabel).not.toHaveBeenCalled();
    expect(client.addLabel).toHaveBeenCalledWith("issue-1", "ai:todo");
    expect(client.updateIssueState).toHaveBeenCalledWith("issue-1", "Todo");
  });
});
