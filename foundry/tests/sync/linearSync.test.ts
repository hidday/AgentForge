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

function makeLinearClient(labels: string[] = []) {
  return {
    getIssue: vi.fn(),
    getRelatedContext: vi.fn(),
    searchIssues: vi.fn(),
    postComment: vi.fn(),
    updateIssueState: vi.fn().mockResolvedValue(undefined),
    addLabel: vi.fn().mockResolvedValue(undefined),
    removeLabel: vi.fn().mockResolvedValue(undefined),
    listLabels: vi.fn().mockResolvedValue(labels),
  };
}

function makeLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
}

describe("getLabelForState", () => {
  it("maps every run state to a distinct ai: label and Linear workflow state", () => {
    for (const state of Object.values(RunState)) {
      const mapping = getLabelForState(state);
      expect(mapping.label.startsWith("ai:")).toBe(true);
      expect(typeof mapping.issueState).toBe("string");
    }
  });

  it("maps Done to the Done workflow state and Failed to Cancelled", () => {
    expect(getLabelForState(RunState.Done)).toEqual({ label: "ai:done", issueState: "Done" });
    expect(getLabelForState(RunState.Failed)).toEqual({ label: "ai:failed", issueState: "Cancelled" });
  });
});

describe("LinearSyncService.syncState", () => {
  it("adds the label for the current state when it is not already present", async () => {
    const linearClient = makeLinearClient([]);
    const svc = new LinearSyncService(linearClient as never, makeLogger() as never);

    await svc.syncState(makeRun({ state: RunState.Planning }));

    expect(linearClient.addLabel).toHaveBeenCalledWith("LIN-1", "ai:planning");
    expect(linearClient.updateIssueState).toHaveBeenCalledWith("LIN-1", "In Progress");
  });

  it("does not re-add a label that is already present", async () => {
    const linearClient = makeLinearClient(["ai:planning"]);
    const svc = new LinearSyncService(linearClient as never, makeLogger() as never);

    await svc.syncState(makeRun({ state: RunState.Planning }));

    expect(linearClient.addLabel).not.toHaveBeenCalled();
  });

  it("removes stale ai: labels that don't match the current state", async () => {
    const linearClient = makeLinearClient(["ai:todo", "ai:planning", "bug"]);
    const svc = new LinearSyncService(linearClient as never, makeLogger() as never);

    await svc.syncState(makeRun({ state: RunState.PlanReview }));

    expect(linearClient.removeLabel).toHaveBeenCalledWith("LIN-1", "ai:todo");
    expect(linearClient.removeLabel).toHaveBeenCalledWith("LIN-1", "ai:planning");
    expect(linearClient.removeLabel).not.toHaveBeenCalledWith("LIN-1", "bug");
    expect(linearClient.addLabel).toHaveBeenCalledWith("LIN-1", "ai:plan-review");
  });

  it("logs the sync outcome", async () => {
    const linearClient = makeLinearClient([]);
    const logger = makeLogger();
    const svc = new LinearSyncService(linearClient as never, logger as never);

    await svc.syncState(makeRun({ state: RunState.Done }));

    expect(logger.debug).toHaveBeenCalledWith(
      expect.objectContaining({ issueId: "LIN-1", label: "ai:done", issueState: "Done" }),
      "Synced Linear state",
    );
  });
});
