import { describe, it, expect, vi } from "vitest";
import { LinearSyncService, getLabelForState } from "../../src/sync/linearSync.js";
import { RunState } from "../../src/domain/runState.js";
import type { Run } from "../../src/domain/types.js";

function makeLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
}

function makeRun(overrides: Partial<Run> = {}): Run {
  return {
    id: "run-1",
    linearIssueId: "LIN-1",
    linearIssueIdentifier: null,
    linearIssueDescription: null,
    linearIssueTitle: null,
    linearIssueUrl: null,
    repo: "acme/repo",
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

describe("getLabelForState", () => {
  it("maps every RunState to a label/issueState pair", () => {
    for (const state of Object.values(RunState)) {
      const mapping = getLabelForState(state);
      expect(mapping.label.startsWith("ai:")).toBe(true);
      expect(typeof mapping.issueState).toBe("string");
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
  function makeClient(overrides: Record<string, unknown> = {}) {
    return {
      listLabels: vi.fn().mockResolvedValue([]),
      removeLabel: vi.fn().mockResolvedValue(undefined),
      addLabel: vi.fn().mockResolvedValue(undefined),
      updateIssueState: vi.fn().mockResolvedValue(undefined),
      ...overrides,
    };
  }

  it("adds the target label and updates issue state when no labels exist yet", async () => {
    const client = makeClient();
    const svc = new LinearSyncService(client as never, makeLogger() as never);

    await svc.syncState(makeRun({ state: RunState.Planning }));

    expect(client.addLabel).toHaveBeenCalledWith("LIN-1", "ai:planning");
    expect(client.updateIssueState).toHaveBeenCalledWith("LIN-1", "In Progress");
    expect(client.removeLabel).not.toHaveBeenCalled();
  });

  it("removes stale ai: labels that don't match the target label", async () => {
    const client = makeClient({
      listLabels: vi.fn().mockResolvedValue(["ai:todo", "bug"]),
    });
    const svc = new LinearSyncService(client as never, makeLogger() as never);

    await svc.syncState(makeRun({ state: RunState.Planning }));

    expect(client.removeLabel).toHaveBeenCalledWith("LIN-1", "ai:todo");
    expect(client.removeLabel).not.toHaveBeenCalledWith("LIN-1", "bug");
    expect(client.addLabel).toHaveBeenCalledWith("LIN-1", "ai:planning");
  });

  it("does not re-add the target label when it's already present", async () => {
    const client = makeClient({
      listLabels: vi.fn().mockResolvedValue(["ai:planning"]),
    });
    const svc = new LinearSyncService(client as never, makeLogger() as never);

    await svc.syncState(makeRun({ state: RunState.Planning }));

    expect(client.addLabel).not.toHaveBeenCalled();
  });

  it("leaves non-ai labels untouched", async () => {
    const client = makeClient({
      listLabels: vi.fn().mockResolvedValue(["bug", "urgent"]),
    });
    const svc = new LinearSyncService(client as never, makeLogger() as never);

    await svc.syncState(makeRun({ state: RunState.Done }));

    expect(client.removeLabel).not.toHaveBeenCalled();
    expect(client.addLabel).toHaveBeenCalledWith("LIN-1", "ai:done");
  });
});
