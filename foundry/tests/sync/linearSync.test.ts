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
    repo: "repo-a",
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

function buildDeps() {
  const linearClient = {
    getIssue: vi.fn(),
    getRelatedContext: vi.fn(),
    searchIssues: vi.fn(),
    postComment: vi.fn(),
    updateIssueState: vi.fn().mockResolvedValue(undefined),
    addLabel: vi.fn().mockResolvedValue(undefined),
    removeLabel: vi.fn().mockResolvedValue(undefined),
    listLabels: vi.fn().mockResolvedValue([]),
  };

  const logger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };

  return { linearClient, logger };
}

describe("getLabelForState", () => {
  it("maps every RunState to its label and Linear issueState", () => {
    expect(getLabelForState(RunState.Todo)).toEqual({ label: "ai:todo", issueState: "Todo" });
    expect(getLabelForState(RunState.Planning)).toEqual({
      label: "ai:planning",
      issueState: "In Progress",
    });
    expect(getLabelForState(RunState.PlanReview)).toEqual({
      label: "ai:plan-review",
      issueState: "In Progress",
    });
    expect(getLabelForState(RunState.PlanRevision)).toEqual({
      label: "ai:plan-revision",
      issueState: "In Progress",
    });
    expect(getLabelForState(RunState.AwaitingPlanApproval)).toEqual({
      label: "ai:awaiting-approval",
      issueState: "In Progress",
    });
    expect(getLabelForState(RunState.Implementing)).toEqual({
      label: "ai:implementing",
      issueState: "In Progress",
    });
    expect(getLabelForState(RunState.AIReview)).toEqual({
      label: "ai:code-review",
      issueState: "In Progress",
    });
    expect(getLabelForState(RunState.AddressingReview)).toEqual({
      label: "ai:remediation",
      issueState: "In Progress",
    });
    expect(getLabelForState(RunState.ReadyForHumanReview)).toEqual({
      label: "ai:ready-for-review",
      issueState: "In Review",
    });
    expect(getLabelForState(RunState.Done)).toEqual({ label: "ai:done", issueState: "Done" });
    expect(getLabelForState(RunState.AIBlocked)).toEqual({
      label: "ai:blocked",
      issueState: "In Progress",
    });
    expect(getLabelForState(RunState.HumanClarificationNeeded)).toEqual({
      label: "ai:needs-clarification",
      issueState: "In Progress",
    });
    expect(getLabelForState(RunState.Failed)).toEqual({
      label: "ai:failed",
      issueState: "Cancelled",
    });
  });
});

describe("LinearSyncService.syncState", () => {
  it("adds the mapped label and updates issue state when no ai: label currently exists", async () => {
    const { linearClient, logger } = buildDeps();
    linearClient.listLabels.mockResolvedValue(["other-label"]);
    const svc = new LinearSyncService(linearClient as never, logger as never);

    const run = makeRun({ linearIssueId: "issue-1", state: RunState.Implementing });
    await svc.syncState(run);

    expect(linearClient.listLabels).toHaveBeenCalledWith("issue-1");
    expect(linearClient.removeLabel).not.toHaveBeenCalled();
    expect(linearClient.addLabel).toHaveBeenCalledWith("issue-1", "ai:implementing");
    expect(linearClient.updateIssueState).toHaveBeenCalledWith("issue-1", "In Progress");
    expect(logger.debug).toHaveBeenCalledWith(
      {
        issueId: "issue-1",
        state: RunState.Implementing,
        label: "ai:implementing",
        issueState: "In Progress",
        removedLabels: [],
      },
      "Synced Linear state",
    );
  });

  it("removes stale ai: labels that differ from the target label and does not re-add the current one", async () => {
    const { linearClient, logger } = buildDeps();
    linearClient.listLabels.mockResolvedValue(["ai:planning", "ai:code-review", "unrelated"]);
    const svc = new LinearSyncService(linearClient as never, logger as never);

    const run = makeRun({ linearIssueId: "issue-2", state: RunState.AIReview });
    await svc.syncState(run);

    expect(linearClient.removeLabel).toHaveBeenCalledTimes(1);
    expect(linearClient.removeLabel).toHaveBeenCalledWith("issue-2", "ai:planning");
    // ai:code-review matches the target mapping label, so it should not be removed nor re-added.
    expect(linearClient.addLabel).not.toHaveBeenCalled();
    expect(linearClient.updateIssueState).toHaveBeenCalledWith("issue-2", "In Progress");
    expect(logger.debug).toHaveBeenCalledWith(
      expect.objectContaining({ removedLabels: ["ai:planning"] }),
      "Synced Linear state",
    );
  });

  it("removes multiple stale ai: labels and adds the new one when the target label is not present", async () => {
    const { linearClient, logger } = buildDeps();
    linearClient.listLabels.mockResolvedValue(["ai:todo", "ai:planning"]);
    const svc = new LinearSyncService(linearClient as never, logger as never);

    const run = makeRun({ linearIssueId: "issue-3", state: RunState.Done });
    await svc.syncState(run);

    expect(linearClient.removeLabel).toHaveBeenCalledTimes(2);
    expect(linearClient.removeLabel).toHaveBeenNthCalledWith(1, "issue-3", "ai:todo");
    expect(linearClient.removeLabel).toHaveBeenNthCalledWith(2, "issue-3", "ai:planning");
    expect(linearClient.addLabel).toHaveBeenCalledWith("issue-3", "ai:done");
    expect(linearClient.updateIssueState).toHaveBeenCalledWith("issue-3", "Done");
  });

  it("does nothing to labels when the current labels already contain exactly the target label", async () => {
    const { linearClient, logger } = buildDeps();
    linearClient.listLabels.mockResolvedValue(["ai:failed"]);
    const svc = new LinearSyncService(linearClient as never, logger as never);

    const run = makeRun({ linearIssueId: "issue-4", state: RunState.Failed });
    await svc.syncState(run);

    expect(linearClient.removeLabel).not.toHaveBeenCalled();
    expect(linearClient.addLabel).not.toHaveBeenCalled();
    expect(linearClient.updateIssueState).toHaveBeenCalledWith("issue-4", "Cancelled");
    void logger;
  });
});
