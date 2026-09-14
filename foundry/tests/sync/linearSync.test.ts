import { describe, it, expect, vi } from "vitest";
import { LinearSyncService, getLabelForState } from "../../src/sync/linearSync.js";
import { RunState } from "../../src/domain/runState.js";
import type { Run } from "../../src/domain/types.js";

function makeRun(overrides: Partial<Run> = {}): Run {
  return {
    id: "run-1",
    linearIssueId: "issue-1",
    linearIssueIdentifier: "ENG-1",
    linearIssueDescription: null,
    linearIssueTitle: null,
    linearIssueUrl: null,
    repo: "acme/widgets",
    branchName: "feature/x",
    prNumber: null,
    state: RunState.Todo,
    planVersion: 1,
    approvedPlanVersion: null,
    plannerRuntime: null,
    executorRuntime: null,
    reviewerRuntime: null,
    remediationRuntime: null,
    workingDirectory: "/tmp",
    latestArtifactVersion: 0,
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
  it("maps every RunState to a distinct {label, issueState} pair", () => {
    for (const state of Object.values(RunState)) {
      const mapping = getLabelForState(state);
      expect(mapping.label.startsWith("ai:")).toBe(true);
      expect(typeof mapping.issueState).toBe("string");
    }
  });

  it("maps specific states to their expected label/issueState", () => {
    expect(getLabelForState(RunState.Todo)).toEqual({ label: "ai:todo", issueState: "Todo" });
    expect(getLabelForState(RunState.Done)).toEqual({ label: "ai:done", issueState: "Done" });
    expect(getLabelForState(RunState.Failed)).toEqual({
      label: "ai:failed",
      issueState: "Cancelled",
    });
    expect(getLabelForState(RunState.ReadyForHumanReview)).toEqual({
      label: "ai:ready-for-review",
      issueState: "In Review",
    });
  });
});

describe("LinearSyncService.syncState", () => {
  it("adds the target label and updates issue state when no ai: label exists yet", async () => {
    const linearClient = makeLinearClient();
    linearClient.listLabels.mockResolvedValue([]);
    const svc = new LinearSyncService(linearClient as never, makeLogger() as never);

    await svc.syncState(makeRun({ state: RunState.Planning }));

    expect(linearClient.addLabel).toHaveBeenCalledWith("issue-1", "ai:planning");
    expect(linearClient.updateIssueState).toHaveBeenCalledWith("issue-1", "In Progress");
    expect(linearClient.removeLabel).not.toHaveBeenCalled();
  });

  it("removes stale ai: labels that don't match the target state", async () => {
    const linearClient = makeLinearClient();
    linearClient.listLabels.mockResolvedValue(["ai:todo", "not-ai-label"]);
    const svc = new LinearSyncService(linearClient as never, makeLogger() as never);

    await svc.syncState(makeRun({ state: RunState.Planning }));

    expect(linearClient.removeLabel).toHaveBeenCalledWith("issue-1", "ai:todo");
    expect(linearClient.removeLabel).not.toHaveBeenCalledWith("issue-1", "not-ai-label");
    expect(linearClient.addLabel).toHaveBeenCalledWith("issue-1", "ai:planning");
  });

  it("does not re-add the target label when it's already present", async () => {
    const linearClient = makeLinearClient();
    linearClient.listLabels.mockResolvedValue(["ai:planning"]);
    const svc = new LinearSyncService(linearClient as never, makeLogger() as never);

    await svc.syncState(makeRun({ state: RunState.Planning }));

    expect(linearClient.addLabel).not.toHaveBeenCalled();
  });

  it("removes multiple stale ai: labels when present", async () => {
    const linearClient = makeLinearClient();
    linearClient.listLabels.mockResolvedValue(["ai:todo", "ai:planning", "ai:blocked"]);
    const svc = new LinearSyncService(linearClient as never, makeLogger() as never);

    await svc.syncState(makeRun({ state: RunState.Done }));

    expect(linearClient.removeLabel).toHaveBeenCalledTimes(3);
    expect(linearClient.removeLabel).toHaveBeenCalledWith("issue-1", "ai:todo");
    expect(linearClient.removeLabel).toHaveBeenCalledWith("issue-1", "ai:planning");
    expect(linearClient.removeLabel).toHaveBeenCalledWith("issue-1", "ai:blocked");
    expect(linearClient.addLabel).toHaveBeenCalledWith("issue-1", "ai:done");
  });

  it("always calls updateIssueState with the mapped issueState", async () => {
    const linearClient = makeLinearClient();
    linearClient.listLabels.mockResolvedValue([]);
    const svc = new LinearSyncService(linearClient as never, makeLogger() as never);

    await svc.syncState(makeRun({ state: RunState.AIBlocked }));

    expect(linearClient.updateIssueState).toHaveBeenCalledWith("issue-1", "In Progress");
  });

  it("logs a debug summary including the removed labels", async () => {
    const linearClient = makeLinearClient();
    linearClient.listLabels.mockResolvedValue(["ai:todo"]);
    const logger = makeLogger();
    const svc = new LinearSyncService(linearClient as never, logger as never);

    await svc.syncState(makeRun({ state: RunState.Planning }));

    expect(logger.debug).toHaveBeenCalledWith(
      {
        issueId: "issue-1",
        state: RunState.Planning,
        label: "ai:planning",
        issueState: "In Progress",
        removedLabels: ["ai:todo"],
      },
      "Synced Linear state",
    );
  });
});
