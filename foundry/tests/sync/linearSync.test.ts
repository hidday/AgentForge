import { describe, it, expect, vi, beforeEach } from "vitest";
import { LinearSyncService, getLabelForState } from "../../src/sync/linearSync.js";
import { RunState } from "../../src/domain/runState.js";
import type { Run } from "../../src/domain/types.js";
import type { LinearClient } from "../../src/linear/linearClient.js";
import type { Logger } from "../../src/utils/logger.js";

function makeLogger(): Logger {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
    trace: vi.fn(),
    child: () => makeLogger(),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

function makeRun(overrides: Partial<Run> = {}): Run {
  return {
    id: "run-1",
    linearIssueId: "issue-1",
    linearIssueIdentifier: "ENG-1",
    linearIssueDescription: "desc",
    linearIssueTitle: "title",
    linearIssueUrl: null,
    repo: "org/repo",
    branchName: "ai/eng-1",
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

describe("getLabelForState", () => {
  it("maps every RunState to a unique ai: label and a Linear issue state", () => {
    const seenLabels = new Set<string>();
    for (const state of Object.values(RunState)) {
      const mapping = getLabelForState(state);
      expect(mapping.label).toMatch(/^ai:/);
      expect(typeof mapping.issueState).toBe("string");
      expect(mapping.issueState.length).toBeGreaterThan(0);
      seenLabels.add(mapping.label);
    }
    // every state should map to a distinct label
    expect(seenLabels.size).toBe(Object.values(RunState).length);
  });

  it("maps specific known states to their documented label/issueState pairs", () => {
    expect(getLabelForState(RunState.Todo)).toEqual({ label: "ai:todo", issueState: "Todo" });
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
});

describe("LinearSyncService", () => {
  let linearClient: {
    listLabels: ReturnType<typeof vi.fn>;
    removeLabel: ReturnType<typeof vi.fn>;
    addLabel: ReturnType<typeof vi.fn>;
    updateIssueState: ReturnType<typeof vi.fn>;
  };
  let logger: Logger;
  let service: LinearSyncService;

  beforeEach(() => {
    linearClient = {
      listLabels: vi.fn().mockResolvedValue([]),
      removeLabel: vi.fn().mockResolvedValue(undefined),
      addLabel: vi.fn().mockResolvedValue(undefined),
      updateIssueState: vi.fn().mockResolvedValue(undefined),
    };
    logger = makeLogger();
    service = new LinearSyncService(linearClient as unknown as LinearClient, logger);
  });

  it("adds the target label when it is not already present and there are no stale labels", async () => {
    linearClient.listLabels.mockResolvedValue(["some-other-label"]);
    const run = makeRun({ state: RunState.Implementing });

    await service.syncState(run);

    expect(linearClient.removeLabel).not.toHaveBeenCalled();
    expect(linearClient.addLabel).toHaveBeenCalledWith("issue-1", "ai:implementing");
    expect(linearClient.updateIssueState).toHaveBeenCalledWith("issue-1", "In Progress");
  });

  it("removes stale ai: labels that differ from the target label", async () => {
    linearClient.listLabels.mockResolvedValue(["ai:planning", "ai:code-review", "unrelated"]);
    const run = makeRun({ state: RunState.Implementing });

    await service.syncState(run);

    expect(linearClient.removeLabel).toHaveBeenCalledWith("issue-1", "ai:planning");
    expect(linearClient.removeLabel).toHaveBeenCalledWith("issue-1", "ai:code-review");
    expect(linearClient.removeLabel).not.toHaveBeenCalledWith("issue-1", "unrelated");
    expect(linearClient.addLabel).toHaveBeenCalledWith("issue-1", "ai:implementing");
  });

  it("does not re-add the target label when it is already present", async () => {
    linearClient.listLabels.mockResolvedValue(["ai:implementing"]);
    const run = makeRun({ state: RunState.Implementing });

    await service.syncState(run);

    expect(linearClient.addLabel).not.toHaveBeenCalled();
  });

  it("always calls updateIssueState with the mapped issue state", async () => {
    const run = makeRun({ state: RunState.Done });

    await service.syncState(run);

    expect(linearClient.updateIssueState).toHaveBeenCalledWith("issue-1", "Done");
  });

  it("logs debug with the removed labels and resulting label/state", async () => {
    linearClient.listLabels.mockResolvedValue(["ai:planning"]);
    const run = makeRun({ state: RunState.AIBlocked });

    await service.syncState(run);

    expect(logger.debug).toHaveBeenCalledWith(
      expect.objectContaining({
        issueId: "issue-1",
        state: RunState.AIBlocked,
        label: "ai:blocked",
        issueState: "In Progress",
        removedLabels: ["ai:planning"],
      }),
      "Synced Linear state",
    );
  });

  it("handles an issue with no labels at all", async () => {
    linearClient.listLabels.mockResolvedValue([]);
    const run = makeRun({ state: RunState.Failed });

    await service.syncState(run);

    expect(linearClient.removeLabel).not.toHaveBeenCalled();
    expect(linearClient.addLabel).toHaveBeenCalledWith("issue-1", "ai:failed");
    expect(linearClient.updateIssueState).toHaveBeenCalledWith("issue-1", "Cancelled");
  });
});
