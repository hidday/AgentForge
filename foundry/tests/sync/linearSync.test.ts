import { describe, it, expect, vi, beforeEach } from "vitest";
import { LinearSyncService, getLabelForState } from "../../src/sync/linearSync.js";
import { RunState } from "../../src/domain/runState.js";
import type { Run } from "../../src/domain/types.js";

function makeRun(overrides: Partial<Run> = {}): Run {
  return {
    id: "run-1",
    linearIssueId: "issue-1",
    linearIssueIdentifier: "ENG-42",
    linearIssueDescription: "Test issue",
    linearIssueTitle: "Test Issue",
    linearIssueUrl: null,
    repo: "acme/widgets",
    branchName: "ai/run-1",
    prNumber: null,
    state: RunState.Todo,
    planVersion: 1,
    approvedPlanVersion: null,
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

function makeLogger() {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
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

const EXPECTED_MAP: Record<RunState, { label: string; issueState: string }> = {
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

describe("getLabelForState", () => {
  it.each(Object.entries(EXPECTED_MAP))(
    "maps %s to the expected label/issueState",
    (state, expected) => {
      expect(getLabelForState(state as RunState)).toEqual(expected);
    },
  );
});

describe("LinearSyncService", () => {
  let linearClient: ReturnType<typeof makeLinearClient>;
  let logger: ReturnType<typeof makeLogger>;
  let service: LinearSyncService;

  beforeEach(() => {
    linearClient = makeLinearClient();
    logger = makeLogger();
    service = new LinearSyncService(linearClient as never, logger as never);
  });

  it.each(Object.entries(EXPECTED_MAP))(
    "syncs %s by adding the mapped label and updating issue state",
    async (state, expected) => {
      linearClient.listLabels.mockResolvedValue([]);
      const run = makeRun({ linearIssueId: "issue-42", state: state as RunState });

      await service.syncState(run);

      expect(linearClient.listLabels).toHaveBeenCalledWith("issue-42");
      expect(linearClient.addLabel).toHaveBeenCalledWith("issue-42", expected.label);
      expect(linearClient.updateIssueState).toHaveBeenCalledWith("issue-42", expected.issueState);
    },
  );

  it("does not re-add a label that is already present", async () => {
    linearClient.listLabels.mockResolvedValue(["ai:implementing"]);
    const run = makeRun({ state: RunState.Implementing });

    await service.syncState(run);

    expect(linearClient.addLabel).not.toHaveBeenCalled();
    expect(linearClient.updateIssueState).toHaveBeenCalledWith(
      run.linearIssueId,
      "In Progress",
    );
  });

  it("removes stale ai: labels that don't match the new state", async () => {
    linearClient.listLabels.mockResolvedValue(["ai:todo", "ai:planning", "not-ai-label"]);
    const run = makeRun({ state: RunState.AIReview });

    await service.syncState(run);

    expect(linearClient.removeLabel).toHaveBeenCalledTimes(2);
    expect(linearClient.removeLabel).toHaveBeenCalledWith(run.linearIssueId, "ai:todo");
    expect(linearClient.removeLabel).toHaveBeenCalledWith(run.linearIssueId, "ai:planning");
    expect(linearClient.removeLabel).not.toHaveBeenCalledWith(run.linearIssueId, "not-ai-label");
    expect(linearClient.addLabel).toHaveBeenCalledWith(run.linearIssueId, "ai:code-review");
  });

  it("does not remove the current label as stale", async () => {
    linearClient.listLabels.mockResolvedValue(["ai:done"]);
    const run = makeRun({ state: RunState.Done });

    await service.syncState(run);

    expect(linearClient.removeLabel).not.toHaveBeenCalled();
    expect(linearClient.addLabel).not.toHaveBeenCalled();
  });

  it("leaves non-ai labels untouched", async () => {
    linearClient.listLabels.mockResolvedValue(["bug", "priority:high"]);
    const run = makeRun({ state: RunState.Failed });

    await service.syncState(run);

    expect(linearClient.removeLabel).not.toHaveBeenCalled();
    expect(linearClient.addLabel).toHaveBeenCalledWith(run.linearIssueId, "ai:failed");
  });

  it("logs the sync with removed labels and mapping details", async () => {
    linearClient.listLabels.mockResolvedValue(["ai:todo"]);
    const run = makeRun({ state: RunState.Planning, linearIssueId: "issue-log" });

    await service.syncState(run);

    expect(logger.debug).toHaveBeenCalledWith(
      {
        issueId: "issue-log",
        state: RunState.Planning,
        label: "ai:planning",
        issueState: "In Progress",
        removedLabels: ["ai:todo"],
      },
      "Synced Linear state",
    );
  });
});
