import { describe, it, expect, vi, beforeEach } from "vitest";
import { LinearSyncService, getLabelForState } from "../../src/sync/linearSync.js";
import { RunState } from "../../src/domain/runState.js";
import type { Run } from "../../src/domain/types.js";

function makeRun(overrides: Partial<Run> = {}): Run {
  return {
    linearIssueId: "issue-1",
    state: RunState.Implementing,
    ...overrides,
  } as Run;
}

function makeLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };
}

function makeLinearClient(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    listLabels: vi.fn().mockResolvedValue([]),
    removeLabel: vi.fn().mockResolvedValue(undefined),
    addLabel: vi.fn().mockResolvedValue(undefined),
    updateIssueState: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe("getLabelForState", () => {
  it("returns the correct label/issueState mapping for every RunState", () => {
    expect(getLabelForState(RunState.Todo)).toEqual({ label: "ai:todo", issueState: "Todo" });
    expect(getLabelForState(RunState.Planning)).toEqual({
      label: "ai:planning",
      issueState: "In Progress",
    });
    expect(getLabelForState(RunState.PlanReview)).toEqual({
      label: "ai:plan-review",
      issueState: "In Progress",
    });
    expect(getLabelForState(RunState.PlanRevision)).toEqual({
      label: "ai:plan-revision",
      issueState: "In Progress",
    });
    expect(getLabelForState(RunState.AwaitingPlanApproval)).toEqual({
      label: "ai:awaiting-approval",
      issueState: "In Progress",
    });
    expect(getLabelForState(RunState.Implementing)).toEqual({
      label: "ai:implementing",
      issueState: "In Progress",
    });
    expect(getLabelForState(RunState.AIReview)).toEqual({
      label: "ai:code-review",
      issueState: "In Progress",
    });
    expect(getLabelForState(RunState.AddressingReview)).toEqual({
      label: "ai:remediation",
      issueState: "In Progress",
    });
    expect(getLabelForState(RunState.ReadyForHumanReview)).toEqual({
      label: "ai:ready-for-review",
      issueState: "In Review",
    });
    expect(getLabelForState(RunState.Done)).toEqual({ label: "ai:done", issueState: "Done" });
    expect(getLabelForState(RunState.AIBlocked)).toEqual({
      label: "ai:blocked",
      issueState: "In Progress",
    });
    expect(getLabelForState(RunState.HumanClarificationNeeded)).toEqual({
      label: "ai:needs-clarification",
      issueState: "In Progress",
    });
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

  it("adds the current state's label and updates the issue state when no ai: labels are present", async () => {
    const linearClient = makeLinearClient({ listLabels: vi.fn().mockResolvedValue([]) });
    const logger = makeLogger();
    const service = new LinearSyncService(linearClient as never, logger as never);

    await service.syncState(makeRun({ state: RunState.Implementing }));

    expect(linearClient.removeLabel).not.toHaveBeenCalled();
    expect(linearClient.addLabel).toHaveBeenCalledWith("issue-1", "ai:implementing");
    expect(linearClient.updateIssueState).toHaveBeenCalledWith("issue-1", "In Progress");
  });

  it("removes stale ai: labels that don't match the current state", async () => {
    const linearClient = makeLinearClient({
      listLabels: vi.fn().mockResolvedValue(["ai:planning", "ai:todo", "not-ai-label"]),
    });
    const logger = makeLogger();
    const service = new LinearSyncService(linearClient as never, logger as never);

    await service.syncState(makeRun({ state: RunState.Implementing }));

    expect(linearClient.removeLabel).toHaveBeenCalledWith("issue-1", "ai:planning");
    expect(linearClient.removeLabel).toHaveBeenCalledWith("issue-1", "ai:todo");
    expect(linearClient.removeLabel).not.toHaveBeenCalledWith("issue-1", "not-ai-label");
    expect(linearClient.removeLabel).toHaveBeenCalledTimes(2);
    expect(linearClient.addLabel).toHaveBeenCalledWith("issue-1", "ai:implementing");
  });

  it("does not re-add the label when it is already present among current labels", async () => {
    const linearClient = makeLinearClient({
      listLabels: vi.fn().mockResolvedValue(["ai:implementing"]),
    });
    const logger = makeLogger();
    const service = new LinearSyncService(linearClient as never, logger as never);

    await service.syncState(makeRun({ state: RunState.Implementing }));

    expect(linearClient.addLabel).not.toHaveBeenCalled();
    expect(linearClient.removeLabel).not.toHaveBeenCalled();
    expect(linearClient.updateIssueState).toHaveBeenCalledWith("issue-1", "In Progress");
  });

  it("logs a debug summary including the removed labels", async () => {
    const linearClient = makeLinearClient({
      listLabels: vi.fn().mockResolvedValue(["ai:todo"]),
    });
    const logger = makeLogger();
    const service = new LinearSyncService(linearClient as never, logger as never);

    await service.syncState(makeRun({ linearIssueId: "issue-9", state: RunState.Done }));

    expect(logger.debug).toHaveBeenCalledWith(
      {
        issueId: "issue-9",
        state: RunState.Done,
        label: "ai:done",
        issueState: "Done",
        removedLabels: ["ai:todo"],
      },
      "Synced Linear state",
    );
  });
});
