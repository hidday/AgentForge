import { describe, it, expect, vi, beforeEach } from "vitest";
import { LinearSyncService, getLabelForState } from "../../src/sync/linearSync.js";
import { RunState } from "../../src/domain/runState.js";
import type { Run } from "../../src/domain/types.js";

function makeRun(overrides: Partial<Run> = {}): Run {
  return {
    id: "run-1",
    linearIssueId: "issue-1",
    linearIssueIdentifier: "PRY-1",
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
    latestArtifactVersion: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makeLinearClient(currentLabels: string[] = []) {
  return {
    listLabels: vi.fn().mockResolvedValue(currentLabels),
    removeLabel: vi.fn().mockResolvedValue(undefined),
    addLabel: vi.fn().mockResolvedValue(undefined),
    updateIssueState: vi.fn().mockResolvedValue(undefined),
  };
}

function makeLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
}

describe("getLabelForState", () => {
  it("maps every RunState to a distinct ai: label and issue state", () => {
    const seenLabels = new Set<string>();
    for (const state of Object.values(RunState)) {
      const mapping = getLabelForState(state);
      expect(mapping.label.startsWith("ai:")).toBe(true);
      expect(typeof mapping.issueState).toBe("string");
      seenLabels.add(mapping.label);
    }
    expect(seenLabels.size).toBe(Object.values(RunState).length);
  });
});

describe("LinearSyncService.syncState", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("adds the mapped label and updates issue state when the label is missing", async () => {
    const linearClient = makeLinearClient([]);
    const service = new LinearSyncService(linearClient as never, makeLogger() as never);

    await service.syncState(makeRun({ state: RunState.Planning }));

    expect(linearClient.addLabel).toHaveBeenCalledWith("issue-1", "ai:planning");
    expect(linearClient.updateIssueState).toHaveBeenCalledWith("issue-1", "In Progress");
    expect(linearClient.removeLabel).not.toHaveBeenCalled();
  });

  it("does not re-add the label when it is already present", async () => {
    const linearClient = makeLinearClient(["ai:planning"]);
    const service = new LinearSyncService(linearClient as never, makeLogger() as never);

    await service.syncState(makeRun({ state: RunState.Planning }));

    expect(linearClient.addLabel).not.toHaveBeenCalled();
    expect(linearClient.updateIssueState).toHaveBeenCalledWith("issue-1", "In Progress");
  });

  it("removes stale ai: labels that don't match the current state's label", async () => {
    const linearClient = makeLinearClient(["ai:todo", "ai:planning"]);
    const service = new LinearSyncService(linearClient as never, makeLogger() as never);

    await service.syncState(makeRun({ state: RunState.Planning }));

    expect(linearClient.removeLabel).toHaveBeenCalledTimes(1);
    expect(linearClient.removeLabel).toHaveBeenCalledWith("issue-1", "ai:todo");
    expect(linearClient.addLabel).not.toHaveBeenCalled();
  });

  it("leaves non-ai labels untouched", async () => {
    const linearClient = makeLinearClient(["bug", "ai:planning", "priority:high"]);
    const service = new LinearSyncService(linearClient as never, makeLogger() as never);

    await service.syncState(makeRun({ state: RunState.Planning }));

    expect(linearClient.removeLabel).not.toHaveBeenCalled();
  });

  it("logs a debug entry describing the sync outcome", async () => {
    const linearClient = makeLinearClient(["ai:todo"]);
    const logger = makeLogger();
    const service = new LinearSyncService(linearClient as never, logger as never);

    await service.syncState(makeRun({ state: RunState.Done, linearIssueId: "issue-9" }));

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
