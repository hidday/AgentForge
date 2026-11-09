import { describe, it, expect, vi, beforeEach } from "vitest";
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
    linearIssueIdentifier: "PRY-1",
    linearIssueDescription: null,
    linearIssueTitle: null,
    linearIssueUrl: null,
    repo: "acme/widgets",
    branchName: null,
    prNumber: null,
    state: RunState.Implementing,
    planVersion: 1,
    approvedPlanVersion: 1,
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
  it("maps every RunState to a unique label and the expected Linear workflow state", () => {
    expect(getLabelForState(RunState.Todo)).toEqual({ label: "ai:todo", issueState: "Todo" });
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

  it("produces a distinct label for every RunState value", () => {
    const states = Object.values(RunState);
    const labels = states.map((s) => getLabelForState(s).label);
    expect(new Set(labels).size).toBe(states.length);
  });
});

describe("LinearSyncService.syncState", () => {
  let linearClient: ReturnType<typeof makeLinearClient>;
  let logger: ReturnType<typeof makeLogger>;
  let service: LinearSyncService;

  beforeEach(() => {
    linearClient = makeLinearClient();
    logger = makeLogger();
    service = new LinearSyncService(linearClient as never, logger as never);
  });

  it("adds the target label and updates issue state when no ai: label is present", async () => {
    linearClient.listLabels.mockResolvedValue(["bug"]);
    const run = makeRun({ state: RunState.Implementing });

    await service.syncState(run);

    expect(linearClient.removeLabel).not.toHaveBeenCalled();
    expect(linearClient.addLabel).toHaveBeenCalledWith("lin-1", "ai:implementing");
    expect(linearClient.updateIssueState).toHaveBeenCalledWith("lin-1", "In Progress");
  });

  it("removes stale ai: labels that do not match the target state", async () => {
    linearClient.listLabels.mockResolvedValue(["ai:planning", "ai:todo", "bug"]);
    const run = makeRun({ state: RunState.Implementing });

    await service.syncState(run);

    expect(linearClient.removeLabel).toHaveBeenCalledWith("lin-1", "ai:planning");
    expect(linearClient.removeLabel).toHaveBeenCalledWith("lin-1", "ai:todo");
    expect(linearClient.removeLabel).toHaveBeenCalledTimes(2);
    expect(linearClient.addLabel).toHaveBeenCalledWith("lin-1", "ai:implementing");
  });

  it("does not re-add the target label when it is already present", async () => {
    linearClient.listLabels.mockResolvedValue(["ai:implementing"]);
    const run = makeRun({ state: RunState.Implementing });

    await service.syncState(run);

    expect(linearClient.addLabel).not.toHaveBeenCalled();
    expect(linearClient.removeLabel).not.toHaveBeenCalled();
    expect(linearClient.updateIssueState).toHaveBeenCalledWith("lin-1", "In Progress");
  });

  it("always calls updateIssueState with the mapped Linear workflow state", async () => {
    linearClient.listLabels.mockResolvedValue([]);
    const run = makeRun({ state: RunState.Done });

    await service.syncState(run);

    expect(linearClient.updateIssueState).toHaveBeenCalledWith("lin-1", "Done");
    expect(linearClient.addLabel).toHaveBeenCalledWith("lin-1", "ai:done");
  });

  it("treats non-ai-prefixed labels as unrelated and never removes them", async () => {
    linearClient.listLabels.mockResolvedValue(["bug", "urgent", "frontend"]);
    const run = makeRun({ state: RunState.AIBlocked });

    await service.syncState(run);

    expect(linearClient.removeLabel).not.toHaveBeenCalled();
    expect(linearClient.addLabel).toHaveBeenCalledWith("lin-1", "ai:blocked");
  });
});
