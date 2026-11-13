import { describe, it, expect, vi, beforeEach } from "vitest";
import { LinearSyncService, getLabelForState } from "../../src/sync/linearSync.js";
import { RunState } from "../../src/domain/runState.js";
import type { Run } from "../../src/domain/types.js";

function makeRun(overrides: Partial<Run> = {}): Run {
  return {
    id: "run-1",
    linearIssueId: "lin-1",
    linearIssueIdentifier: "PRY-1",
    linearIssueDescription: null,
    linearIssueTitle: "Test issue",
    linearIssueUrl: null,
    repo: "acme/widgets",
    branchName: "ai/pry-1",
    prNumber: null,
    state: RunState.Implementing,
    planVersion: 1,
    approvedPlanVersion: 1,
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

function makeLinearClient() {
  return {
    getIssue: vi.fn(),
    getRelatedContext: vi.fn(),
    searchIssues: vi.fn(),
    postComment: vi.fn(),
    updateIssueState: vi.fn().mockResolvedValue(undefined),
    addLabel: vi.fn().mockResolvedValue(undefined),
    removeLabel: vi.fn().mockResolvedValue(undefined),
    listLabels: vi.fn().mockResolvedValue([]),
  };
}

function makeLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
}

describe("getLabelForState", () => {
  it("maps every RunState to a label and an issueState", () => {
    for (const state of Object.values(RunState)) {
      const mapping = getLabelForState(state);
      expect(mapping.label).toMatch(/^ai:/);
      expect(typeof mapping.issueState).toBe("string");
    }
  });

  it("maps Done to ai:done / Done", () => {
    expect(getLabelForState(RunState.Done)).toEqual({ label: "ai:done", issueState: "Done" });
  });

  it("maps Failed to ai:failed / Cancelled", () => {
    expect(getLabelForState(RunState.Failed)).toEqual({
      label: "ai:failed",
      issueState: "Cancelled",
    });
  });

  it("maps ReadyForHumanReview to ai:ready-for-review / In Review", () => {
    expect(getLabelForState(RunState.ReadyForHumanReview)).toEqual({
      label: "ai:ready-for-review",
      issueState: "In Review",
    });
  });
});

describe("LinearSyncService.syncState", () => {
  let linearClient: ReturnType<typeof makeLinearClient>;
  let logger: ReturnType<typeof makeLogger>;
  let svc: LinearSyncService;

  beforeEach(() => {
    linearClient = makeLinearClient();
    logger = makeLogger();
    svc = new LinearSyncService(linearClient as never, logger as never);
  });

  it("adds the mapped label when it is not already present", async () => {
    linearClient.listLabels.mockResolvedValue([]);
    const run = makeRun({ state: RunState.Implementing });

    await svc.syncState(run);

    expect(linearClient.addLabel).toHaveBeenCalledWith("lin-1", "ai:implementing");
    expect(linearClient.updateIssueState).toHaveBeenCalledWith("lin-1", "In Progress");
  });

  it("does not re-add the mapped label when it is already present", async () => {
    linearClient.listLabels.mockResolvedValue(["ai:implementing"]);
    const run = makeRun({ state: RunState.Implementing });

    await svc.syncState(run);

    expect(linearClient.addLabel).not.toHaveBeenCalled();
  });

  it("removes stale ai: labels that don't match the current state's mapping", async () => {
    linearClient.listLabels.mockResolvedValue(["ai:planning", "ai:todo", "other-label"]);
    const run = makeRun({ state: RunState.Implementing });

    await svc.syncState(run);

    expect(linearClient.removeLabel).toHaveBeenCalledWith("lin-1", "ai:planning");
    expect(linearClient.removeLabel).toHaveBeenCalledWith("lin-1", "ai:todo");
    expect(linearClient.removeLabel).not.toHaveBeenCalledWith("lin-1", "other-label");
    expect(linearClient.removeLabel).toHaveBeenCalledTimes(2);
  });

  it("does not remove a non-ai: label even if unrelated to current state", async () => {
    linearClient.listLabels.mockResolvedValue(["bug", "needs-triage"]);
    const run = makeRun({ state: RunState.Implementing });

    await svc.syncState(run);

    expect(linearClient.removeLabel).not.toHaveBeenCalled();
  });

  it("does not remove the label matching the current state", async () => {
    linearClient.listLabels.mockResolvedValue(["ai:implementing"]);
    const run = makeRun({ state: RunState.Implementing });

    await svc.syncState(run);

    expect(linearClient.removeLabel).not.toHaveBeenCalled();
  });

  it("always calls updateIssueState with the mapped issueState", async () => {
    linearClient.listLabels.mockResolvedValue([]);
    const run = makeRun({ state: RunState.Done });

    await svc.syncState(run);

    expect(linearClient.updateIssueState).toHaveBeenCalledWith("lin-1", "Done");
  });

  it("logs the sync details including removedLabels", async () => {
    linearClient.listLabels.mockResolvedValue(["ai:planning"]);
    const run = makeRun({ state: RunState.Implementing });

    await svc.syncState(run);

    expect(logger.debug).toHaveBeenCalledWith(
      expect.objectContaining({
        issueId: "lin-1",
        state: RunState.Implementing,
        label: "ai:implementing",
        issueState: "In Progress",
        removedLabels: ["ai:planning"],
      }),
      "Synced Linear state",
    );
  });
});
