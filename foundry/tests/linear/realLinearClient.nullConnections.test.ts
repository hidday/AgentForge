import { describe, it, expect, vi } from "vitest";
import { RealLinearClient } from "../../src/linear/realLinearClient.js";

function makeLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
}

function buildClient() {
  const logger = makeLogger();
  const client = new RealLinearClient("test-key", logger as never);
  const sdk = {
    issue: vi.fn(),
    issues: vi.fn(),
    createComment: vi.fn(),
    updateIssue: vi.fn(),
    team: vi.fn(),
    issueLabels: vi.fn(),
    createIssueLabel: vi.fn(),
  };
  (client as unknown as { sdk: typeof sdk }).sdk = sdk;
  return { client, sdk, logger };
}

// These tests exercise the `?? []` / `?? undefined` fallback branches for
// every optional GraphQL connection RealLinearClient touches, by returning a
// null connection object (rather than an empty-but-present one) from the
// fake SDK.

describe("RealLinearClient - null GraphQL connections (fallback branches)", () => {
  it("getIssue defaults labels to [] and team/project/cycle to undefined when their connections are null", async () => {
    const { client, sdk } = buildClient();
    sdk.issue.mockResolvedValue({
      id: "issue-1",
      identifier: "PRY-1",
      title: "Title",
      description: "Desc",
      branchName: "ai/issue-1",
      priority: 0,
      url: "https://linear.app/x",
      labelIds: [],
      state: Promise.resolve(null),
      project: Promise.resolve(null),
      cycle: Promise.resolve(null),
      team: Promise.resolve(null),
      labels: () => Promise.resolve(null),
    });

    const result = await client.getIssue("issue-1");

    expect(result.labels).toEqual([]);
    expect(result.state).toBe("Unknown");
    expect(result.project).toBeUndefined();
    expect(result.team).toBeUndefined();
    expect(result.cycle).toBeUndefined();
  });

  it("fetchBlockers returns no blockers when inverseRelations() resolves to a null connection", async () => {
    const { client, sdk } = buildClient();
    sdk.issue.mockResolvedValue({
      id: "focus-id",
      identifier: "PRY-1",
      title: "Title",
      description: "Desc",
      branchName: "ai/issue-1",
      priority: 0,
      url: "https://linear.app/x",
      labelIds: [],
      state: Promise.resolve({ id: "s1", name: "Todo" }),
      project: Promise.resolve(null),
      cycle: Promise.resolve(null),
      team: Promise.resolve(null),
      parent: Promise.resolve(null),
      labels: () => Promise.resolve({ nodes: [] }),
      inverseRelations: () => Promise.resolve(null),
    });

    const ctx = await client.getRelatedContext("focus-id");

    expect(ctx.blockers).toEqual([]);
  });

  it("toRelatedLinearIssue defaults labels to [] and state to 'Unknown' for a blocker with null connections", async () => {
    const { client, sdk } = buildClient();
    const blocker = {
      id: "blocker-id",
      identifier: "PRY-101",
      title: "Blocker",
      description: "Blocker desc",
      priority: 1,
      url: "https://linear.app/x",
      state: Promise.resolve(null),
      labels: () => Promise.resolve(null),
    };
    const focus = {
      id: "focus-id",
      parent: Promise.resolve(null),
      inverseRelations: () =>
        Promise.resolve({
          nodes: [{ id: "rel-1", type: "blocks", issue: Promise.resolve(blocker) }],
        }),
    };
    sdk.issue.mockResolvedValue(focus);

    const ctx = await client.getRelatedContext("focus-id");

    expect(ctx.blockers).toHaveLength(1);
    expect(ctx.blockers[0]).toMatchObject({ id: "blocker-id", labels: [], state: "Unknown" });
  });

  it("searchIssues defaults labels/project/cycle/team when their connections are null for a result row", async () => {
    const { client, sdk } = buildClient();
    sdk.issues.mockResolvedValue({
      nodes: [
        {
          id: "issue-1",
          identifier: "PRY-1",
          title: "Title",
          description: null,
          branchName: "ai/issue-1",
          priority: 0,
          url: "https://linear.app/x",
          labels: () => Promise.resolve(null),
          project: Promise.resolve(null),
          cycle: Promise.resolve(null),
          team: Promise.resolve(null),
        },
      ],
    });

    const [result] = await client.searchIssues({ state: "Todo" });

    expect(result.labels).toEqual([]);
    expect(result.project).toBeUndefined();
    expect(result.team).toBeUndefined();
    expect(result.cycle).toBeUndefined();
    expect(result.description).toBe("");
  });

  it("resolveStateId (via updateIssueState) treats a null states() connection as no states found", async () => {
    const { client, sdk, logger } = buildClient();
    sdk.issue.mockResolvedValue({
      id: "issue-1",
      team: Promise.resolve({ id: "team-1", key: "PRY" }),
    });
    sdk.team.mockResolvedValue({ states: () => Promise.resolve(null) });

    await client.updateIssueState("issue-1", "Todo");

    expect(sdk.updateIssue).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ stateName: "Todo" }),
      expect.stringContaining("Could not find workflow state"),
    );
  });

  it("resolveOrCreateLabel (via addLabel) treats a null issueLabels() connection as no existing match", async () => {
    const { client, sdk } = buildClient();
    sdk.issue.mockResolvedValue({
      id: "issue-1",
      labelIds: [],
      team: Promise.resolve({ id: "team-1", key: "PRY" }),
    });
    sdk.issueLabels.mockResolvedValue(null);
    sdk.createIssueLabel.mockResolvedValue({ issueLabel: Promise.resolve({ id: "label-new" }) });
    sdk.updateIssue.mockResolvedValue({});

    await client.addLabel("issue-1", "urgent");

    expect(sdk.createIssueLabel).toHaveBeenCalledWith({ name: "urgent", teamId: "team-1" });
  });
});
