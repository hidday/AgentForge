import { describe, it, expect, vi } from "vitest";
import { LinearSyncService, getLabelForState } from "../../src/sync/linearSync.js";
import { RunState } from "../../src/domain/runState.js";
import type { Run } from "../../src/domain/types.js";
import type { LinearClient } from "../../src/linear/linearClient.js";
import type { Logger } from "../../src/utils/logger.js";

function makeMockLogger() {
  return {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  };
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
  it("maps every RunState to its label and issueState", () => {
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
    expect(getLabelForState(RunState.HumanClarificationNeeded)).toEqual({
      label: "ai:needs-clarification",
      issueState: "In Progress",
    });
  });
});

describe("LinearSyncService.syncState", () => {
  it("adds the target label and updates issue state when no ai label exists yet", async () => {
    const client = makeMockLinearClient();
    client.listLabels.mockResolvedValue(["bug", "urgent"]);
    const logger = makeMockLogger();
    const svc = new LinearSyncService(client as unknown as LinearClient, logger as unknown as Logger);

    const run = makeRun({ linearIssueId: "issue-1", state: RunState.Implementing });
    await svc.syncState(run);

    expect(client.removeLabel).not.toHaveBeenCalled();
    expect(client.addLabel).toHaveBeenCalledWith("issue-1", "ai:implementing");
    expect(client.updateIssueState).toHaveBeenCalledWith("issue-1", "In Progress");
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

  it("removes stale ai: labels that differ from the target label", async () => {
    const client = makeMockLinearClient();
    client.listLabels.mockResolvedValue(["ai:planning", "ai:code-review", "bug"]);
    const svc = new LinearSyncService(
      client as unknown as LinearClient,
      makeMockLogger() as unknown as Logger,
    );

    const run = makeRun({ linearIssueId: "issue-1", state: RunState.Implementing });
    await svc.syncState(run);

    expect(client.removeLabel).toHaveBeenCalledTimes(2);
    expect(client.removeLabel).toHaveBeenNthCalledWith(1, "issue-1", "ai:planning");
    expect(client.removeLabel).toHaveBeenNthCalledWith(2, "issue-1", "ai:code-review");
    // Non-"ai:" labels are left untouched.
    expect(client.removeLabel).not.toHaveBeenCalledWith("issue-1", "bug");
    expect(client.addLabel).toHaveBeenCalledWith("issue-1", "ai:implementing");
  });

  it("does not re-add the label when it is already present, and reports no removed labels", async () => {
    const client = makeMockLinearClient();
    client.listLabels.mockResolvedValue(["ai:implementing", "bug"]);
    const logger = makeMockLogger();
    const svc = new LinearSyncService(client as unknown as LinearClient, logger as unknown as Logger);

    const run = makeRun({ linearIssueId: "issue-1", state: RunState.Implementing });
    await svc.syncState(run);

    expect(client.addLabel).not.toHaveBeenCalled();
    expect(client.removeLabel).not.toHaveBeenCalled();
    expect(client.updateIssueState).toHaveBeenCalledWith("issue-1", "In Progress");
    expect(logger.debug).toHaveBeenCalledWith(
      expect.objectContaining({ removedLabels: [] }),
      "Synced Linear state",
    );
  });

  it("always updates the Linear issue workflow state to match the mapping", async () => {
    const client = makeMockLinearClient();
    client.listLabels.mockResolvedValue([]);
    const svc = new LinearSyncService(
      client as unknown as LinearClient,
      makeMockLogger() as unknown as Logger,
    );

    await svc.syncState(makeRun({ linearIssueId: "issue-9", state: RunState.Done }));

    expect(client.updateIssueState).toHaveBeenCalledWith("issue-9", "Done");
    expect(client.addLabel).toHaveBeenCalledWith("issue-9", "ai:done");
  });
});
