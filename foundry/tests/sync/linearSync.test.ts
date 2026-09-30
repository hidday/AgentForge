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

function makeLinearClient(overrides: Record<string, unknown> = {}) {
  return {
    getIssue: vi.fn(),
    getRelatedContext: vi.fn(),
    searchIssues: vi.fn(),
    postComment: vi.fn().mockResolvedValue(undefined),
    updateIssueState: vi.fn().mockResolvedValue(undefined),
    addLabel: vi.fn().mockResolvedValue(undefined),
    removeLabel: vi.fn().mockResolvedValue(undefined),
    listLabels: vi.fn().mockResolvedValue([]),
    ...overrides,
  };
}

function makeLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
}

describe("getLabelForState", () => {
  it("maps every RunState to a distinct ai: label and a Linear issueState", () => {
    for (const state of Object.values(RunState)) {
      const mapping = getLabelForState(state);
      expect(mapping.label.startsWith("ai:")).toBe(true);
      expect(typeof mapping.issueState).toBe("string");
      expect(mapping.issueState.length).toBeGreaterThan(0);
    }
  });

  it("maps terminal states to their expected Linear issue states", () => {
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
  let logger: ReturnType<typeof makeLogger>;

  beforeEach(() => {
    logger = makeLogger();
  });

  it("adds the new state label, updates issue state, and removes stale ai: labels", async () => {
    const linearClient = makeLinearClient({
      listLabels: vi.fn().mockResolvedValue(["ai:planning", "bug", "ai:code-review"]),
    });
    const svc = new LinearSyncService(linearClient as never, logger as never);
    const run = makeRun({ linearIssueId: "LIN-42", state: RunState.Implementing });

    await svc.syncState(run);

    expect(linearClient.removeLabel).toHaveBeenCalledWith("LIN-42", "ai:planning");
    expect(linearClient.removeLabel).toHaveBeenCalledWith("LIN-42", "ai:code-review");
    expect(linearClient.removeLabel).toHaveBeenCalledTimes(2);
    expect(linearClient.addLabel).toHaveBeenCalledWith("LIN-42", "ai:implementing");
    expect(linearClient.updateIssueState).toHaveBeenCalledWith("LIN-42", "In Progress");
    expect(logger.debug).toHaveBeenCalledWith(
      expect.objectContaining({
        issueId: "LIN-42",
        state: RunState.Implementing,
        label: "ai:implementing",
        issueState: "In Progress",
        removedLabels: ["ai:planning", "ai:code-review"],
      }),
      "Synced Linear state",
    );
  });

  it("does not remove the current label from the stale set and does not re-add it", async () => {
    const linearClient = makeLinearClient({
      listLabels: vi.fn().mockResolvedValue(["ai:implementing", "unrelated"]),
    });
    const svc = new LinearSyncService(linearClient as never, logger as never);
    const run = makeRun({ state: RunState.Implementing });

    await svc.syncState(run);

    expect(linearClient.removeLabel).not.toHaveBeenCalled();
    expect(linearClient.addLabel).not.toHaveBeenCalled();
    expect(linearClient.updateIssueState).toHaveBeenCalledWith("LIN-1", "In Progress");
  });

  it("does not remove non ai: prefixed labels even if they otherwise mismatch", async () => {
    const linearClient = makeLinearClient({
      listLabels: vi.fn().mockResolvedValue(["bug", "needs-triage"]),
    });
    const svc = new LinearSyncService(linearClient as never, logger as never);
    const run = makeRun({ state: RunState.Done });

    await svc.syncState(run);

    expect(linearClient.removeLabel).not.toHaveBeenCalled();
    expect(linearClient.addLabel).toHaveBeenCalledWith("LIN-1", "ai:done");
    expect(linearClient.updateIssueState).toHaveBeenCalledWith("LIN-1", "Done");
  });

  it("propagates an error from the Linear client without swallowing it", async () => {
    const error = new Error("Linear API unavailable");
    const linearClient = makeLinearClient({
      listLabels: vi.fn().mockRejectedValue(error),
    });
    const svc = new LinearSyncService(linearClient as never, logger as never);

    await expect(svc.syncState(makeRun())).rejects.toThrow("Linear API unavailable");
    expect(logger.debug).not.toHaveBeenCalled();
  });
});
