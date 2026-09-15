import { describe, it, expect, vi } from "vitest";
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

function makeLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
}

describe("getLabelForState", () => {
  it("maps every RunState to a label/issueState pair", () => {
    for (const state of Object.values(RunState)) {
      const mapping = getLabelForState(state);
      expect(mapping.label.startsWith("ai:")).toBe(true);
      expect(typeof mapping.issueState).toBe("string");
      expect(mapping.issueState.length).toBeGreaterThan(0);
    }
  });

  it("returns the expected mapping for ReadyForHumanReview", () => {
    expect(getLabelForState(RunState.ReadyForHumanReview)).toEqual({
      label: "ai:ready-for-review",
      issueState: "In Review",
    });
  });

  it("returns the expected mapping for Failed", () => {
    expect(getLabelForState(RunState.Failed)).toEqual({
      label: "ai:failed",
      issueState: "Cancelled",
    });
  });
});

describe("LinearSyncService.syncState", () => {
  it("adds the mapped label and updates issue state when no ai: label is present", async () => {
    const linearClient = {
      listLabels: vi.fn().mockResolvedValue(["bug"]),
      removeLabel: vi.fn().mockResolvedValue(undefined),
      addLabel: vi.fn().mockResolvedValue(undefined),
      updateIssueState: vi.fn().mockResolvedValue(undefined),
    };
    const logger = makeLogger();
    const svc = new LinearSyncService(linearClient as never, logger as never);

    const run = makeRun({ state: RunState.Implementing });
    await svc.syncState(run);

    expect(linearClient.removeLabel).not.toHaveBeenCalled();
    expect(linearClient.addLabel).toHaveBeenCalledWith("LIN-1", "ai:implementing");
    expect(linearClient.updateIssueState).toHaveBeenCalledWith("LIN-1", "In Progress");
    expect(logger.debug).toHaveBeenCalled();
  });

  it("removes stale ai: labels that differ from the target label", async () => {
    const linearClient = {
      listLabels: vi.fn().mockResolvedValue(["ai:planning", "ai:implementing", "bug"]),
      removeLabel: vi.fn().mockResolvedValue(undefined),
      addLabel: vi.fn().mockResolvedValue(undefined),
      updateIssueState: vi.fn().mockResolvedValue(undefined),
    };
    const logger = makeLogger();
    const svc = new LinearSyncService(linearClient as never, logger as never);

    const run = makeRun({ state: RunState.AIReview });
    await svc.syncState(run);

    expect(linearClient.removeLabel).toHaveBeenCalledWith("LIN-1", "ai:planning");
    expect(linearClient.removeLabel).toHaveBeenCalledWith("LIN-1", "ai:implementing");
    expect(linearClient.removeLabel).toHaveBeenCalledTimes(2);
    expect(linearClient.addLabel).toHaveBeenCalledWith("LIN-1", "ai:code-review");
  });

  it("does not re-add the label when it is already present", async () => {
    const linearClient = {
      listLabels: vi.fn().mockResolvedValue(["ai:done"]),
      removeLabel: vi.fn().mockResolvedValue(undefined),
      addLabel: vi.fn().mockResolvedValue(undefined),
      updateIssueState: vi.fn().mockResolvedValue(undefined),
    };
    const logger = makeLogger();
    const svc = new LinearSyncService(linearClient as never, logger as never);

    const run = makeRun({ state: RunState.Done });
    await svc.syncState(run);

    expect(linearClient.addLabel).not.toHaveBeenCalled();
    expect(linearClient.removeLabel).not.toHaveBeenCalled();
    expect(linearClient.updateIssueState).toHaveBeenCalledWith("LIN-1", "Done");
  });

  it("does not treat the current mapped label as stale", async () => {
    const linearClient = {
      listLabels: vi.fn().mockResolvedValue(["ai:blocked"]),
      removeLabel: vi.fn().mockResolvedValue(undefined),
      addLabel: vi.fn().mockResolvedValue(undefined),
      updateIssueState: vi.fn().mockResolvedValue(undefined),
    };
    const logger = makeLogger();
    const svc = new LinearSyncService(linearClient as never, logger as never);

    await svc.syncState(makeRun({ state: RunState.AIBlocked }));

    expect(linearClient.removeLabel).not.toHaveBeenCalled();
  });
});
