import { describe, it, expect, vi } from "vitest";
import { LinearSyncService, getLabelForState } from "../../src/sync/linearSync.js";
import { RunState } from "../../src/domain/runState.js";
import type { Run } from "../../src/domain/types.js";

function makeRun(overrides: Partial<Run> = {}): Run {
  return {
    id: "run-1",
    linearIssueId: "li-1",
    linearIssueIdentifier: "ENG-1",
    linearIssueDescription: null,
    linearIssueTitle: null,
    linearIssueUrl: null,
    repo: "agentforge",
    branchName: null,
    prNumber: null,
    state: RunState.Todo,
    planVersion: 1,
    approvedPlanVersion: null,
    plannerRuntime: null,
    executorRuntime: null,
    reviewerRuntime: null,
    remediationRuntime: null,
    workingDirectory: "/repo",
    latestArtifactVersion: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makeLinearClient() {
  return {
    listLabels: vi.fn().mockResolvedValue([]),
    addLabel: vi.fn().mockResolvedValue(undefined),
    removeLabel: vi.fn().mockResolvedValue(undefined),
    updateIssueState: vi.fn().mockResolvedValue(undefined),
  };
}

function makeLogger() {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

describe("getLabelForState", () => {
  it("maps every run state to a distinct AI label and Linear issue state", () => {
    for (const state of Object.values(RunState)) {
      const mapping = getLabelForState(state);
      expect(mapping.label).toMatch(/^ai:/);
      expect(typeof mapping.issueState).toBe("string");
    }
  });

  it("maps Done to the Done issue state and Failed to Cancelled", () => {
    expect(getLabelForState(RunState.Done)).toEqual({ label: "ai:done", issueState: "Done" });
    expect(getLabelForState(RunState.Failed)).toEqual({ label: "ai:failed", issueState: "Cancelled" });
  });
});

describe("LinearSyncService.syncState", () => {
  it("adds the new label and updates issue state when no AI label exists yet", async () => {
    const linearClient = makeLinearClient();
    const service = new LinearSyncService(linearClient as never, makeLogger() as never);

    await service.syncState(makeRun({ state: RunState.Planning }));

    expect(linearClient.addLabel).toHaveBeenCalledWith("li-1", "ai:planning");
    expect(linearClient.updateIssueState).toHaveBeenCalledWith("li-1", "In Progress");
    expect(linearClient.removeLabel).not.toHaveBeenCalled();
  });

  it("removes stale AI labels that no longer match the current state", async () => {
    const linearClient = makeLinearClient();
    linearClient.listLabels.mockResolvedValue(["ai:todo", "bug"]);
    const service = new LinearSyncService(linearClient as never, makeLogger() as never);

    await service.syncState(makeRun({ state: RunState.Planning }));

    expect(linearClient.removeLabel).toHaveBeenCalledWith("li-1", "ai:todo");
    expect(linearClient.removeLabel).not.toHaveBeenCalledWith("li-1", "bug");
    expect(linearClient.addLabel).toHaveBeenCalledWith("li-1", "ai:planning");
  });

  it("does not re-add the label when it is already present", async () => {
    const linearClient = makeLinearClient();
    linearClient.listLabels.mockResolvedValue(["ai:planning"]);
    const service = new LinearSyncService(linearClient as never, makeLogger() as never);

    await service.syncState(makeRun({ state: RunState.Planning }));

    expect(linearClient.addLabel).not.toHaveBeenCalled();
  });

  it("leaves non-AI labels untouched", async () => {
    const linearClient = makeLinearClient();
    linearClient.listLabels.mockResolvedValue(["bug", "urgent"]);
    const service = new LinearSyncService(linearClient as never, makeLogger() as never);

    await service.syncState(makeRun({ state: RunState.Done }));

    expect(linearClient.removeLabel).not.toHaveBeenCalled();
    expect(linearClient.addLabel).toHaveBeenCalledWith("li-1", "ai:done");
  });
});
