import { describe, it, expect, vi } from "vitest";
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
    linearIssueId: "lin-1",
    linearIssueIdentifier: "ENG-1",
    linearIssueDescription: null,
    linearIssueTitle: null,
    linearIssueUrl: null,
    repo: "acme/widgets",
    branchName: "ai/eng-1",
    prNumber: null,
    state: RunState.Implementing,
    planVersion: 1,
    approvedPlanVersion: 1,
    plannerRuntime: null,
    executorRuntime: null,
    reviewerRuntime: null,
    remediationRuntime: null,
    workingDirectory: "/tmp/wd",
    latestArtifactVersion: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe("getLabelForState", () => {
  it("maps every RunState to a label and issueState", () => {
    for (const state of Object.values(RunState)) {
      const mapping = getLabelForState(state);
      expect(mapping.label.startsWith("ai:")).toBe(true);
      expect(typeof mapping.issueState).toBe("string");
    }
  });

  it("maps specific states to their expected label/issueState pairs", () => {
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
  });
});

describe("LinearSyncService.syncState", () => {
  it("adds the state label and updates issue state when no ai: label exists yet", async () => {
    const linear = makeLinearClient();
    linear.listLabels.mockResolvedValue(["bug"]);
    const logger = makeLogger();
    const svc = new LinearSyncService(linear as never, logger as never);

    await svc.syncState(makeRun({ state: RunState.Implementing, linearIssueId: "lin-1" }));

    expect(linear.removeLabel).not.toHaveBeenCalled();
    expect(linear.addLabel).toHaveBeenCalledWith("lin-1", "ai:implementing");
    expect(linear.updateIssueState).toHaveBeenCalledWith("lin-1", "In Progress");
    expect(logger.debug).toHaveBeenCalledWith(
      expect.objectContaining({
        issueId: "lin-1",
        label: "ai:implementing",
        issueState: "In Progress",
        removedLabels: [],
      }),
      "Synced Linear state",
    );
  });

  it("removes stale ai: labels and does not re-add the label if already present", async () => {
    const linear = makeLinearClient();
    linear.listLabels.mockResolvedValue(["ai:planning", "bug", "ai:implementing"]);
    const svc = new LinearSyncService(linear as never, makeLogger() as never);

    await svc.syncState(makeRun({ state: RunState.Implementing, linearIssueId: "lin-1" }));

    expect(linear.removeLabel).toHaveBeenCalledTimes(1);
    expect(linear.removeLabel).toHaveBeenCalledWith("lin-1", "ai:planning");
    expect(linear.addLabel).not.toHaveBeenCalled();
    expect(linear.updateIssueState).toHaveBeenCalledWith("lin-1", "In Progress");
  });

  it("removes multiple stale ai: labels", async () => {
    const linear = makeLinearClient();
    linear.listLabels.mockResolvedValue(["ai:planning", "ai:code-review"]);
    const svc = new LinearSyncService(linear as never, makeLogger() as never);

    await svc.syncState(makeRun({ state: RunState.Done, linearIssueId: "lin-1" }));

    expect(linear.removeLabel).toHaveBeenCalledTimes(2);
    expect(linear.removeLabel).toHaveBeenCalledWith("lin-1", "ai:planning");
    expect(linear.removeLabel).toHaveBeenCalledWith("lin-1", "ai:code-review");
    expect(linear.addLabel).toHaveBeenCalledWith("lin-1", "ai:done");
  });

  it("does not treat non ai:-prefixed labels as stale", async () => {
    const linear = makeLinearClient();
    linear.listLabels.mockResolvedValue(["urgent", "backend"]);
    const svc = new LinearSyncService(linear as never, makeLogger() as never);

    await svc.syncState(makeRun({ state: RunState.Todo, linearIssueId: "lin-1" }));

    expect(linear.removeLabel).not.toHaveBeenCalled();
    expect(linear.addLabel).toHaveBeenCalledWith("lin-1", "ai:todo");
  });
});
