import { describe, it, expect, vi, beforeEach } from "vitest";
import { LinearSyncService, getLabelForState } from "../../src/sync/linearSync.js";
import { RunState } from "../../src/domain/runState.js";
import type { Run } from "../../src/domain/types.js";

function makeLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
}

function makeLinearClient() {
  return {
    listLabels: vi.fn().mockResolvedValue([]),
    removeLabel: vi.fn().mockResolvedValue(undefined),
    addLabel: vi.fn().mockResolvedValue(undefined),
    updateIssueState: vi.fn().mockResolvedValue(undefined),
  };
}

function makeRun(overrides: Partial<Run> = {}): Run {
  return {
    id: "run-1",
    linearIssueId: "LIN-1",
    linearIssueIdentifier: "LIN-1",
    linearIssueDescription: null,
    linearIssueTitle: null,
    linearIssueUrl: null,
    repo: "acme/repo",
    branchName: null,
    prNumber: null,
    state: RunState.Todo,
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
  it("maps every RunState to a distinct label/issueState pair with the ai: prefix", () => {
    for (const state of Object.values(RunState)) {
      const mapping = getLabelForState(state);
      expect(mapping.label.startsWith("ai:")).toBe(true);
      expect(mapping.issueState.length).toBeGreaterThan(0);
    }
  });

  it("maps Done to the ai:done label and Done issue state", () => {
    expect(getLabelForState(RunState.Done)).toEqual({ label: "ai:done", issueState: "Done" });
  });

  it("maps Failed to the ai:failed label and Cancelled issue state", () => {
    expect(getLabelForState(RunState.Failed)).toEqual({
      label: "ai:failed",
      issueState: "Cancelled",
    });
  });
});

describe("LinearSyncService.syncState", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("adds the mapped label when it is not already present and updates issue state", async () => {
    const linearClient = makeLinearClient();
    linearClient.listLabels.mockResolvedValue([]);
    const svc = new LinearSyncService(linearClient as never, makeLogger() as never);

    await svc.syncState(makeRun({ state: RunState.Implementing }));

    expect(linearClient.addLabel).toHaveBeenCalledWith("LIN-1", "ai:implementing");
    expect(linearClient.updateIssueState).toHaveBeenCalledWith("LIN-1", "In Progress");
    expect(linearClient.removeLabel).not.toHaveBeenCalled();
  });

  it("removes stale ai: labels that don't match the current state's label", async () => {
    const linearClient = makeLinearClient();
    linearClient.listLabels.mockResolvedValue(["ai:planning", "bug"]);
    const svc = new LinearSyncService(linearClient as never, makeLogger() as never);

    await svc.syncState(makeRun({ state: RunState.Implementing }));

    expect(linearClient.removeLabel).toHaveBeenCalledWith("LIN-1", "ai:planning");
    expect(linearClient.removeLabel).not.toHaveBeenCalledWith("LIN-1", "bug");
    expect(linearClient.addLabel).toHaveBeenCalledWith("LIN-1", "ai:implementing");
  });

  it("does not re-add the label when it is already present", async () => {
    const linearClient = makeLinearClient();
    linearClient.listLabels.mockResolvedValue(["ai:implementing"]);
    const svc = new LinearSyncService(linearClient as never, makeLogger() as never);

    await svc.syncState(makeRun({ state: RunState.Implementing }));

    expect(linearClient.addLabel).not.toHaveBeenCalled();
    expect(linearClient.removeLabel).not.toHaveBeenCalled();
  });

  it("never removes non-ai: labels even if they happen to equal the current mapping's label text", async () => {
    const linearClient = makeLinearClient();
    linearClient.listLabels.mockResolvedValue(["feature", "priority:high"]);
    const svc = new LinearSyncService(linearClient as never, makeLogger() as never);

    await svc.syncState(makeRun({ state: RunState.Done }));

    expect(linearClient.removeLabel).not.toHaveBeenCalled();
    expect(linearClient.addLabel).toHaveBeenCalledWith("LIN-1", "ai:done");
  });
});
