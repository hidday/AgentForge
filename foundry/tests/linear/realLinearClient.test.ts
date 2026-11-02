import { describe, it, expect, vi, beforeEach } from "vitest";
import { RealLinearClient } from "../../src/linear/realLinearClient.js";

interface FakeIssue {
  id: string;
  identifier: string;
  title: string;
  description: string | null;
  branchName: string;
  priority: number;
  url: string;
  labelIds: string[];
  parent: Promise<FakeIssue | null>;
  state: Promise<{ id: string; name: string } | null>;
  project: Promise<{ name: string } | null>;
  cycle: Promise<{ name: string } | null>;
  team: Promise<{ id: string; key: string } | null>;
  labels: () => Promise<{ nodes: Array<{ id: string; name: string }> }>;
  inverseRelations: () => Promise<{
    nodes: Array<{ id: string; type: string; issue: Promise<FakeIssue> }>;
  }>;
}

function makeFakeIssue(overrides: Partial<FakeIssue> & { id: string }): FakeIssue {
  return {
    identifier: "PRY-1",
    title: "Issue title",
    description: "Issue description",
    branchName: "ai/issue-1",
    priority: 0,
    url: "https://linear.app/team/issue/PRY-1",
    labelIds: [],
    parent: Promise.resolve(null),
    state: Promise.resolve({ id: "state-1", name: "Todo" }),
    project: Promise.resolve(null),
    cycle: Promise.resolve(null),
    team: Promise.resolve({ id: "team-1", key: "PRY" }),
    labels: () => Promise.resolve({ nodes: [] }),
    inverseRelations: () => Promise.resolve({ nodes: [] }),
    ...overrides,
  };
}

function makeLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
}

function makeSdk() {
  return {
    issue: vi.fn(),
    issues: vi.fn(),
    team: vi.fn(),
    createComment: vi.fn().mockResolvedValue(undefined),
    updateIssue: vi.fn().mockResolvedValue(undefined),
    issueLabels: vi.fn(),
    createIssueLabel: vi.fn(),
  };
}

function buildClient() {
  const logger = makeLogger();
  const client = new RealLinearClient("test-key", logger as never);
  const sdk = makeSdk();
  (client as unknown as { sdk: typeof sdk }).sdk = sdk;
  return { client, sdk, logger };
}

describe("RealLinearClient.getIssue", () => {
  it("maps a fully-populated SDK issue to a LinearIssue", async () => {
    const { client, sdk } = buildClient();
    const issue = makeFakeIssue({
      id: "issue-1",
      labels: () => Promise.resolve({ nodes: [{ id: "l1", name: "bug" }] }),
      project: Promise.resolve({ name: "Backend" }),
      cycle: Promise.resolve({ name: "Sprint 1" }),
    });
    sdk.issue.mockResolvedValue(issue);

    const result = await client.getIssue("issue-1");

    expect(result).toEqual({
      id: "issue-1",
      identifier: "PRY-1",
      title: "Issue title",
      description: "Issue description",
      branchName: "ai/issue-1",
      state: "Todo",
      labels: ["bug"],
      priority: 0,
      url: "https://linear.app/team/issue/PRY-1",
      project: "Backend",
      team: "PRY",
      cycle: "Sprint 1",
    });
  });

  it("falls back to defaults when description/state/project/cycle/team are missing", async () => {
    const { client, sdk } = buildClient();
    const issue = makeFakeIssue({
      id: "issue-1",
      description: null,
      state: Promise.resolve(null),
      project: Promise.resolve(null),
      cycle: Promise.resolve(null),
      team: Promise.resolve(null),
    });
    sdk.issue.mockResolvedValue(issue);

    const result = await client.getIssue("issue-1");

    expect(result.description).toBe("");
    expect(result.state).toBe("Unknown");
    expect(result.project).toBeUndefined();
    expect(result.cycle).toBeUndefined();
    expect(result.team).toBeUndefined();
  });
});

describe("RealLinearClient.getRelatedContext (error handling)", () => {
  it("drops a blocker relation whose issue fails to hydrate and logs a warning", async () => {
    const { client, sdk, logger } = buildClient();
    const goodBlocker = makeFakeIssue({ id: "blocker-ok" });
    const focus = makeFakeIssue({
      id: "focus-id",
      parent: Promise.resolve(null),
      inverseRelations: () =>
        Promise.resolve({
          nodes: [
            {
              id: "rel-bad",
              type: "blocks",
              issue: Promise.reject(new Error("fetch failed")) as Promise<FakeIssue>,
            },
            { id: "rel-good", type: "blocks", issue: Promise.resolve(goodBlocker) },
          ],
        }),
    });
    sdk.issue.mockResolvedValue(focus);

    const ctx = await client.getRelatedContext("focus-id");

    expect(ctx.blockers).toHaveLength(1);
    expect(ctx.blockers[0].id).toBe("blocker-ok");
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ relationId: "rel-bad" }),
      "Failed to hydrate blocker issue from relation",
    );
  });
});

describe("RealLinearClient.searchIssues", () => {
  it("builds a GraphQL filter from the state alone when nothing else is given", async () => {
    const { client, sdk } = buildClient();
    sdk.issues.mockResolvedValue({ nodes: [] });

    await client.searchIssues({ state: "Todo" });

    expect(sdk.issues).toHaveBeenCalledWith({ filter: { state: { name: { eq: "Todo" } } } });
  });

  it("adds project, assigneeMe, and team clauses when provided", async () => {
    const { client, sdk } = buildClient();
    sdk.issues.mockResolvedValue({ nodes: [] });

    await client.searchIssues({
      state: "Todo",
      projectName: "Backend",
      assigneeMe: true,
      team: "PRY",
    });

    expect(sdk.issues).toHaveBeenCalledWith({
      filter: {
        state: { name: { eq: "Todo" } },
        project: { name: { eq: "Backend" } },
        assignee: { isMe: { eq: true } },
        team: { or: [{ name: { eq: "PRY" } }, { key: { eq: "PRY" } }] },
      },
    });
  });

  it("maps every matching issue and logs the result count", async () => {
    const { client, sdk, logger } = buildClient();
    const issue = makeFakeIssue({ id: "issue-1" });
    sdk.issues.mockResolvedValue({ nodes: [issue] });

    const results = await client.searchIssues({ state: "Todo" });

    expect(results).toHaveLength(1);
    expect(results[0].id).toBe("issue-1");
    expect(results[0].state).toBe("Todo");
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ count: 1, stateName: "Todo" }),
      "Searched Linear issues",
    );
  });

  it("returns an empty array when the SDK returns no nodes", async () => {
    const { client, sdk } = buildClient();
    sdk.issues.mockResolvedValue(undefined);
    const results = await client.searchIssues({ state: "Todo" });
    expect(results).toEqual([]);
  });
});

describe("RealLinearClient.postComment", () => {
  it("creates a comment via the SDK", async () => {
    const { client, sdk } = buildClient();
    await client.postComment("issue-1", "hello");
    expect(sdk.createComment).toHaveBeenCalledWith({ issueId: "issue-1", body: "hello" });
  });
});

describe("RealLinearClient.updateIssueState", () => {
  it("warns and does nothing when the issue has no team", async () => {
    const { client, sdk, logger } = buildClient();
    sdk.issue.mockResolvedValue(makeFakeIssue({ id: "issue-1", team: Promise.resolve(null) }));

    await client.updateIssueState("issue-1", "Done");

    expect(sdk.updateIssue).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(
      { issueId: "issue-1" },
      "Cannot update state: issue has no team",
    );
  });

  it("warns and does nothing when the state name cannot be resolved for the team", async () => {
    const { client, sdk, logger } = buildClient();
    sdk.issue.mockResolvedValue(makeFakeIssue({ id: "issue-1" }));
    sdk.team.mockResolvedValue({ states: () => Promise.resolve({ nodes: [] }) });

    await client.updateIssueState("issue-1", "Nonexistent");

    expect(sdk.updateIssue).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ issueId: "issue-1", stateName: "Nonexistent" }),
      "Could not find workflow state by name",
    );
  });

  it("resolves the state id and updates the issue", async () => {
    const { client, sdk } = buildClient();
    sdk.issue.mockResolvedValue(makeFakeIssue({ id: "issue-1" }));
    sdk.team.mockResolvedValue({
      states: () => Promise.resolve({ nodes: [{ id: "state-done", name: "Done" }] }),
    });

    await client.updateIssueState("issue-1", "Done");

    expect(sdk.updateIssue).toHaveBeenCalledWith("issue-1", { stateId: "state-done" });
  });

  it("caches the resolved state map per team across calls", async () => {
    const { client, sdk } = buildClient();
    sdk.issue.mockResolvedValue(makeFakeIssue({ id: "issue-1" }));
    sdk.team.mockResolvedValue({
      states: () => Promise.resolve({ nodes: [{ id: "state-done", name: "Done" }] }),
    });

    await client.updateIssueState("issue-1", "Done");
    await client.updateIssueState("issue-1", "Done");

    expect(sdk.team).toHaveBeenCalledTimes(1);
  });
});

describe("RealLinearClient.addLabel", () => {
  it("creates a new label (no existing match) and adds it to the issue", async () => {
    const { client, sdk } = buildClient();
    sdk.issue.mockResolvedValue(makeFakeIssue({ id: "issue-1", labelIds: [] }));
    sdk.issueLabels.mockResolvedValue({ nodes: [] });
    sdk.createIssueLabel.mockResolvedValue({
      issueLabel: Promise.resolve({ id: "new-label-id" }),
    });

    await client.addLabel("issue-1", "urgent");

    expect(sdk.createIssueLabel).toHaveBeenCalledWith(
      expect.objectContaining({ name: "urgent", teamId: "team-1" }),
    );
    expect(sdk.updateIssue).toHaveBeenCalledWith("issue-1", { labelIds: ["new-label-id"] });
  });

  it("reuses an existing label found via issueLabels", async () => {
    const { client, sdk } = buildClient();
    sdk.issue.mockResolvedValue(makeFakeIssue({ id: "issue-1", labelIds: [] }));
    sdk.issueLabels.mockResolvedValue({ nodes: [{ id: "existing-label-id" }] });

    await client.addLabel("issue-1", "bug");

    expect(sdk.createIssueLabel).not.toHaveBeenCalled();
    expect(sdk.updateIssue).toHaveBeenCalledWith("issue-1", { labelIds: ["existing-label-id"] });
  });

  it("does not duplicate a label id already present on the issue", async () => {
    const { client, sdk } = buildClient();
    sdk.issue.mockResolvedValue(makeFakeIssue({ id: "issue-1", labelIds: ["existing-label-id"] }));
    sdk.issueLabels.mockResolvedValue({ nodes: [{ id: "existing-label-id" }] });

    await client.addLabel("issue-1", "bug");

    expect(sdk.updateIssue).not.toHaveBeenCalled();
  });

  it("throws when label creation does not return an issueLabel", async () => {
    const { client, sdk } = buildClient();
    sdk.issue.mockResolvedValue(makeFakeIssue({ id: "issue-1", labelIds: [] }));
    sdk.issueLabels.mockResolvedValue({ nodes: [] });
    sdk.createIssueLabel.mockResolvedValue({ issueLabel: Promise.resolve(undefined) });

    await expect(client.addLabel("issue-1", "urgent")).rejects.toThrow(
      "Failed to create label: urgent",
    );
  });

  it("creates a label with no teamId when the issue has no team", async () => {
    const { client, sdk } = buildClient();
    sdk.issue.mockResolvedValue(
      makeFakeIssue({ id: "issue-1", labelIds: [], team: Promise.resolve(null) }),
    );
    sdk.issueLabels.mockResolvedValue({ nodes: [] });
    sdk.createIssueLabel.mockResolvedValue({
      issueLabel: Promise.resolve({ id: "new-label-id" }),
    });

    await client.addLabel("issue-1", "urgent");

    expect(sdk.createIssueLabel).toHaveBeenCalledWith({ name: "urgent" });
  });

  it("caches a resolved label id so a second addLabel call skips SDK lookup", async () => {
    const { client, sdk } = buildClient();
    sdk.issue.mockResolvedValue(makeFakeIssue({ id: "issue-1", labelIds: [] }));
    sdk.issueLabels.mockResolvedValue({ nodes: [{ id: "label-id" }] });

    await client.addLabel("issue-1", "bug");
    await client.addLabel("issue-2", "bug");

    expect(sdk.issueLabels).toHaveBeenCalledTimes(1);
  });
});

describe("RealLinearClient.removeLabel", () => {
  it("looks up the label by name when not cached, and removes it if found", async () => {
    const { client, sdk } = buildClient();
    sdk.issue.mockResolvedValue(
      makeFakeIssue({
        id: "issue-1",
        labelIds: ["label-id", "other-id"],
        labels: () => Promise.resolve({ nodes: [{ id: "label-id", name: "bug" }] }),
      }),
    );

    await client.removeLabel("issue-1", "bug");

    expect(sdk.updateIssue).toHaveBeenCalledWith("issue-1", { labelIds: ["other-id"] });
  });

  it("is a no-op when the named label is not found on the issue", async () => {
    const { client, sdk } = buildClient();
    sdk.issue.mockResolvedValue(
      makeFakeIssue({
        id: "issue-1",
        labels: () => Promise.resolve({ nodes: [] }),
      }),
    );

    await client.removeLabel("issue-1", "missing-label");

    expect(sdk.updateIssue).not.toHaveBeenCalled();
  });

  it("uses the cached label id on a subsequent call without re-fetching labels", async () => {
    const { client, sdk } = buildClient();
    sdk.issue.mockResolvedValue(
      makeFakeIssue({
        id: "issue-1",
        labelIds: ["label-id"],
        labels: () => Promise.resolve({ nodes: [{ id: "label-id", name: "bug" }] }),
      }),
    );

    await client.removeLabel("issue-1", "bug");
    sdk.updateIssue.mockClear();

    sdk.issue.mockResolvedValue(
      makeFakeIssue({ id: "issue-2", labelIds: ["label-id", "another-id"] }),
    );
    await client.removeLabel("issue-2", "bug");

    expect(sdk.updateIssue).toHaveBeenCalledWith("issue-2", { labelIds: ["another-id"] });
  });
});

describe("RealLinearClient.listLabels", () => {
  it("returns label names and populates the label cache", async () => {
    const { client, sdk } = buildClient();
    sdk.issue.mockResolvedValue(
      makeFakeIssue({
        id: "issue-1",
        labels: () =>
          Promise.resolve({
            nodes: [
              { id: "l1", name: "bug" },
              { id: "l2", name: "urgent" },
            ],
          }),
      }),
    );

    const names = await client.listLabels("issue-1");
    expect(names).toEqual(["bug", "urgent"]);

    // Removing "urgent" afterward should hit the now-populated cache rather
    // than calling issue.labels() again.
    sdk.issue.mockResolvedValue(
      makeFakeIssue({ id: "issue-1", labelIds: ["l1", "l2"] }),
    );
    await client.removeLabel("issue-1", "urgent");
    expect(sdk.updateIssue).toHaveBeenCalledWith("issue-1", { labelIds: ["l1"] });
  });

  it("returns an empty array when the issue has no labels", async () => {
    const { client, sdk } = buildClient();
    sdk.issue.mockResolvedValue(makeFakeIssue({ id: "issue-1" }));
    const names = await client.listLabels("issue-1");
    expect(names).toEqual([]);
  });
});
