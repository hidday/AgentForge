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
    linearIssueId: "LIN-1",
    linearIssueIdentifier: "LIN-1",
    linearIssueDescription: "desc",
    linearIssueTitle: "title",
    linearIssueUrl: null,
    repo: "org/repo",
    branchName: "ai/run-1",
    prNumber: null,
    state: RunState.Implementing,
    planVersion: 1,
    approvedPlanVersion: 1,
    plannerRuntime: null,
    executorRuntime: null,
    reviewerRuntime: null,
    remediationRuntime: null,
    workingDirectory: "/tmp/run-1",
    latestArtifactVersion: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe("getLabelForState", () => {
  it("maps every RunState to a label and issueState", () => {
    const expected: Record<RunState, { label: string; issueState: string }> = {
      [RunState.Todo]: { label: "ai:todo", issueState: "Todo" },
      [RunState.Planning]: { label: "ai:planning", issueState: "In Progress" },
      [RunState.PlanReview]: { label: "ai:plan-review", issueState: "In Progress" },
      [RunState.PlanRevision]: { label: "ai:plan-revision", issueState: "In Progress" },
      [RunState.AwaitingPlanApproval]: {
        label: "ai:awaiting-approval",
        issueState: "In Progress",
      },
      [RunState.Implementing]: { label: "ai:implementing", issueState: "In Progress" },
      [RunState.AIReview]: { label: "ai:code-review", issueState: "In Progress" },
      [RunState.AddressingReview]: { label: "ai:remediation", issueState: "In Progress" },
      [RunState.ReadyForHumanReview]: { label: "ai:ready-for-review", issueState: "In Review" },
      [RunState.Done]: { label: "ai:done", issueState: "Done" },
      [RunState.AIBlocked]: { label: "ai:blocked", issueState: "In Progress" },
      [RunState.HumanClarificationNeeded]: {
        label: "ai:needs-clarification",
        issueState: "In Progress",
      },
      [RunState.Failed]: { label: "ai:failed", issueState: "Cancelled" },
    };

    for (const state of Object.values(RunState)) {
      expect(getLabelForState(state)).toEqual(expected[state]);
    }
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

  it("removes stale ai: labels, adds the target label, and updates issue state", async () => {
    linearClient.listLabels.mockResolvedValue(["ai:todo", "some-other-label"]);
    const run = makeRun({ state: RunState.Implementing, linearIssueId: "LIN-1" });

    await service.syncState(run);

    expect(linearClient.removeLabel).toHaveBeenCalledTimes(1);
    expect(linearClient.removeLabel).toHaveBeenCalledWith("LIN-1", "ai:todo");
    expect(linearClient.addLabel).toHaveBeenCalledWith("LIN-1", "ai:implementing");
    expect(linearClient.updateIssueState).toHaveBeenCalledWith("LIN-1", "In Progress");
    expect(logger.debug).toHaveBeenCalledWith(
      expect.objectContaining({ removedLabels: ["ai:todo"] }),
      "Synced Linear state",
    );
  });

  it("does not re-add the label when it is already present", async () => {
    linearClient.listLabels.mockResolvedValue(["ai:implementing"]);
    const run = makeRun({ state: RunState.Implementing });

    await service.syncState(run);

    expect(linearClient.addLabel).not.toHaveBeenCalled();
  });

  it("does not remove anything when there are no stale ai: labels", async () => {
    linearClient.listLabels.mockResolvedValue(["non-ai-label"]);
    const run = makeRun({ state: RunState.Done });

    await service.syncState(run);

    expect(linearClient.removeLabel).not.toHaveBeenCalled();
    expect(linearClient.addLabel).toHaveBeenCalledWith(run.linearIssueId, "ai:done");
    expect(linearClient.updateIssueState).toHaveBeenCalledWith(run.linearIssueId, "Done");
  });

  it("removes multiple stale ai: labels at once", async () => {
    linearClient.listLabels.mockResolvedValue(["ai:todo", "ai:planning", "keep-me"]);
    const run = makeRun({ state: RunState.AIBlocked });

    await service.syncState(run);

    expect(linearClient.removeLabel).toHaveBeenCalledTimes(2);
    expect(linearClient.removeLabel).toHaveBeenCalledWith(run.linearIssueId, "ai:todo");
    expect(linearClient.removeLabel).toHaveBeenCalledWith(run.linearIssueId, "ai:planning");
  });
});
