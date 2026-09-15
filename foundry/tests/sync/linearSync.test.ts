import { describe, it, expect, vi, beforeEach } from "vitest";
import { LinearSyncService, getLabelForState } from "../../src/sync/linearSync.js";
import { RunState } from "../../src/domain/runState.js";
import type { Run } from "../../src/domain/types.js";
import type { LinearClient } from "../../src/linear/linearClient.js";
import type { Logger } from "../../src/utils/logger.js";

function makeLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as unknown as Logger;
}

function makeLinearClient(currentLabels: string[] = []): LinearClient {
  return {
    getIssue: vi.fn(),
    getRelatedContext: vi.fn(),
    searchIssues: vi.fn(),
    postComment: vi.fn(),
    updateIssueState: vi.fn().mockResolvedValue(undefined),
    addLabel: vi.fn().mockResolvedValue(undefined),
    removeLabel: vi.fn().mockResolvedValue(undefined),
    listLabels: vi.fn().mockResolvedValue(currentLabels),
  } as unknown as LinearClient;
}

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

describe("getLabelForState", () => {
  const expected: Record<RunState, { label: string; issueState: string }> = {
    [RunState.Todo]: { label: "ai:todo", issueState: "Todo" },
    [RunState.Planning]: { label: "ai:planning", issueState: "In Progress" },
    [RunState.PlanReview]: { label: "ai:plan-review", issueState: "In Progress" },
    [RunState.PlanRevision]: { label: "ai:plan-revision", issueState: "In Progress" },
    [RunState.AwaitingPlanApproval]: { label: "ai:awaiting-approval", issueState: "In Progress" },
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
    it(`returns the exact mapping for ${state}`, () => {
      expect(getLabelForState(state)).toEqual(expected[state]);
    });
  }
});

describe("LinearSyncService", () => {
  let logger: Logger;

  beforeEach(() => {
    logger = makeLogger();
  });

  it("removes stale ai:* labels that don't match the target label", async () => {
    const linearClient = makeLinearClient(["ai:planning", "ai:code-review", "other-label"]);
    const service = new LinearSyncService(linearClient, logger);
    const run = makeRun({ state: RunState.Implementing, linearIssueId: "LIN-9" });

    await service.syncState(run);

    expect(linearClient.removeLabel).toHaveBeenCalledWith("LIN-9", "ai:planning");
    expect(linearClient.removeLabel).toHaveBeenCalledWith("LIN-9", "ai:code-review");
    expect(linearClient.removeLabel).not.toHaveBeenCalledWith("LIN-9", "other-label");
    expect(linearClient.removeLabel).toHaveBeenCalledTimes(2);
  });

  it("does not call addLabel when the target label is already present", async () => {
    const linearClient = makeLinearClient(["ai:implementing"]);
    const service = new LinearSyncService(linearClient, logger);
    const run = makeRun({ state: RunState.Implementing });

    await service.syncState(run);

    expect(linearClient.addLabel).not.toHaveBeenCalled();
  });

  it("calls addLabel when the target label is missing", async () => {
    const linearClient = makeLinearClient([]);
    const service = new LinearSyncService(linearClient, logger);
    const run = makeRun({ state: RunState.Implementing, linearIssueId: "LIN-2" });

    await service.syncState(run);

    expect(linearClient.addLabel).toHaveBeenCalledWith("LIN-2", "ai:implementing");
  });

  it("always calls updateIssueState with the mapped issueState", async () => {
    const linearClient = makeLinearClient([]);
    const service = new LinearSyncService(linearClient, logger);
    const run = makeRun({ state: RunState.Done, linearIssueId: "LIN-3" });

    await service.syncState(run);

    expect(linearClient.updateIssueState).toHaveBeenCalledWith("LIN-3", "Done");
  });
});
