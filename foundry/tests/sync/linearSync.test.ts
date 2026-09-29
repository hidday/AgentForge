import { describe, it, expect, vi, beforeEach } from "vitest";
import { LinearSyncService, getLabelForState } from "../../src/sync/linearSync.js";
import { RunState } from "../../src/domain/runState.js";
import type { Run } from "../../src/domain/types.js";

function makeRun(overrides: Partial<Run> = {}): Run {
  return {
    id: "run-1",
    linearIssueId: "LIN-1",
    linearIssueIdentifier: null,
    linearIssueDescription: null,
    linearIssueTitle: null,
    linearIssueUrl: null,
    repo: "test-repo",
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

function buildDeps(listLabels: string[] = []) {
  const linearClient = {
    getIssue: vi.fn(),
    getRelatedContext: vi.fn(),
    searchIssues: vi.fn(),
    postComment: vi.fn(),
    updateIssueState: vi.fn().mockResolvedValue(undefined),
    addLabel: vi.fn().mockResolvedValue(undefined),
    removeLabel: vi.fn().mockResolvedValue(undefined),
    listLabels: vi.fn().mockResolvedValue(listLabels),
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
  it("maps every run state to a label and issue state", () => {
    expect(getLabelForState(RunState.Todo)).toEqual({ label: "ai:todo", issueState: "Todo" });
    expect(getLabelForState(RunState.ReadyForHumanReview)).toEqual({
      label: "ai:ready-for-review",
      issueState: "In Review",
    });
    expect(getLabelForState(RunState.Done)).toEqual({ label: "ai:done", issueState: "Done" });
    expect(getLabelForState(RunState.Failed)).toEqual({ label: "ai:failed", issueState: "Cancelled" });
    expect(getLabelForState(RunState.AIBlocked)).toEqual({
      label: "ai:blocked",
      issueState: "In Progress",
    });
  });
});

describe("LinearSyncService.syncState", () => {
  it("adds the mapped label when it is not already present, with no stale labels to remove", async () => {
    const { linearClient, logger } = buildDeps([]);
    const svc = new LinearSyncService(linearClient as never, logger as never);
    const run = makeRun({ linearIssueId: "LIN-42", state: RunState.Implementing });

    await svc.syncState(run);

    expect(linearClient.listLabels).toHaveBeenCalledWith("LIN-42");
    expect(linearClient.removeLabel).not.toHaveBeenCalled();
    expect(linearClient.addLabel).toHaveBeenCalledWith("LIN-42", "ai:implementing");
    expect(linearClient.updateIssueState).toHaveBeenCalledWith("LIN-42", "In Progress");
    expect(logger.debug).toHaveBeenCalledWith(
      expect.objectContaining({
        issueId: "LIN-42",
        state: RunState.Implementing,
        label: "ai:implementing",
        issueState: "In Progress",
        removedLabels: [],
      }),
      "Synced Linear state",
    );
  });

  it("removes stale ai: labels that no longer match the current state", async () => {
    const { linearClient, logger } = buildDeps(["ai:planning", "ai:code-review", "bug"]);
    const svc = new LinearSyncService(linearClient as never, logger as never);
    const run = makeRun({ linearIssueId: "LIN-42", state: RunState.Implementing });

    await svc.syncState(run);

    expect(linearClient.removeLabel).toHaveBeenCalledWith("LIN-42", "ai:planning");
    expect(linearClient.removeLabel).toHaveBeenCalledWith("LIN-42", "ai:code-review");
    expect(linearClient.removeLabel).not.toHaveBeenCalledWith("LIN-42", "bug");
    expect(linearClient.addLabel).toHaveBeenCalledWith("LIN-42", "ai:implementing");
  });

  it("does not add the label again when it is already present", async () => {
    const { linearClient, logger } = buildDeps(["ai:implementing"]);
    const svc = new LinearSyncService(linearClient as never, logger as never);
    const run = makeRun({ linearIssueId: "LIN-42", state: RunState.Implementing });

    await svc.syncState(run);

    expect(linearClient.addLabel).not.toHaveBeenCalled();
    expect(linearClient.removeLabel).not.toHaveBeenCalled();
    expect(linearClient.updateIssueState).toHaveBeenCalledWith("LIN-42", "In Progress");
  });

  it("leaves non-ai labels untouched", async () => {
    const { linearClient, logger } = buildDeps(["bug", "urgent"]);
    const svc = new LinearSyncService(linearClient as never, logger as never);
    const run = makeRun({ linearIssueId: "LIN-1", state: RunState.Todo });

    await svc.syncState(run);

    expect(linearClient.removeLabel).not.toHaveBeenCalled();
    expect(linearClient.addLabel).toHaveBeenCalledWith("LIN-1", "ai:todo");
  });
});
