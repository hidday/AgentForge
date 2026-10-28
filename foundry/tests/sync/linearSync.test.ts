import { describe, it, expect, vi, beforeEach } from "vitest";
import { LinearSyncService, getLabelForState } from "../../src/sync/linearSync.js";
import { MockLinearClient } from "../../src/linear/linearClient.js";
import { RunState } from "../../src/domain/runState.js";
import type { Run } from "../../src/domain/types.js";

const noopLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  fatal: vi.fn(),
  child: () => noopLogger,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} as any;

function makeRun(overrides: Partial<Run> = {}): Run {
  return {
    id: "run-1",
    linearIssueId: "lin-1",
    linearIssueIdentifier: null,
    linearIssueDescription: null,
    linearIssueTitle: null,
    linearIssueUrl: null,
    repo: "org/repo",
    branchName: null,
    prNumber: null,
    state: RunState.Planning,
    planVersion: 1,
    approvedPlanVersion: null,
    plannerRuntime: null,
    executorRuntime: null,
    reviewerRuntime: null,
    remediationRuntime: null,
    workingDirectory: "/tmp/work",
    latestArtifactVersion: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe("getLabelForState", () => {
  it("maps every RunState to a distinct label and a sensible Linear issue state", () => {
    for (const state of Object.values(RunState)) {
      const mapping = getLabelForState(state);
      expect(mapping.label.startsWith("ai:")).toBe(true);
      expect(mapping.issueState).toBeTruthy();
    }
  });

  it("maps terminal states to Done/Cancelled Linear states", () => {
    expect(getLabelForState(RunState.Done).issueState).toBe("Done");
    expect(getLabelForState(RunState.Failed).issueState).toBe("Cancelled");
  });
});

describe("LinearSyncService.syncState", () => {
  let linearClient: MockLinearClient;
  let service: LinearSyncService;

  beforeEach(() => {
    linearClient = new MockLinearClient();
    linearClient.seedIssue({
      id: "lin-1",
      title: "Issue",
      description: "",
      branchName: "ai/lin-1",
      state: "Todo",
      labels: [],
      priority: 1,
    });
    service = new LinearSyncService(linearClient, noopLogger);
  });

  it("adds the state label and updates the issue state when no ai: label exists yet", async () => {
    await service.syncState(makeRun({ state: RunState.Planning }));

    expect(await linearClient.listLabels("lin-1")).toEqual(["ai:planning"]);
    expect((await linearClient.getIssue("lin-1")).state).toBe("In Progress");
  });

  it("removes stale ai: labels and adds the new one when the state changes", async () => {
    await linearClient.addLabel("lin-1", "ai:planning");
    await linearClient.addLabel("lin-1", "keep-me");

    await service.syncState(makeRun({ state: RunState.Implementing }));

    const labels = await linearClient.listLabels("lin-1");
    expect(labels).toContain("ai:implementing");
    expect(labels).toContain("keep-me");
    expect(labels).not.toContain("ai:planning");
  });

  it("does not re-add the label when it is already present", async () => {
    await linearClient.addLabel("lin-1", "ai:planning");
    const addLabelSpy = vi.spyOn(linearClient, "addLabel");

    await service.syncState(makeRun({ state: RunState.Planning }));

    expect(addLabelSpy).not.toHaveBeenCalled();
  });

  it("maps Done/Failed states to their respective Linear issue states", async () => {
    await service.syncState(makeRun({ state: RunState.Done }));
    expect((await linearClient.getIssue("lin-1")).state).toBe("Done");
  });
});
