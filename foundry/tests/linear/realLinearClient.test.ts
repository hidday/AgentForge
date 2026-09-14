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
  project: Promise<{ id: string; name: string } | null>;
  cycle: Promise<{ id: string; name: string } | null>;
  team: Promise<{ id: string; key: string } | null>;
  labels: () => Promise<{ nodes: Array<{ id: string; name: string }> } | null>;
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

interface FakeSdk {
  issue: ReturnType<typeof vi.fn>;
  issues: ReturnType<typeof vi.fn>;
  createComment: ReturnType<typeof vi.fn>;
  updateIssue: ReturnType<typeof vi.fn>;
  team: ReturnType<typeof vi.fn>;
  issueLabels: ReturnType<typeof vi.fn>;
  createIssueLabel: ReturnType<typeof vi.fn>;
}

function makeClient() {
  const logger = makeLogger();
  const client = new RealLinearClient("test-key", logger as never);
  const sdk: FakeSdk = {
    issue: vi.fn(),
    issues: vi.fn(),
    createComment: vi.fn().mockResolvedValue({}),
    updateIssue: vi.fn().mockResolvedValue({}),
    team: vi.fn(),
    issueLabels: vi.fn(),
    createIssueLabel: vi.fn(),
  };
  (client as unknown as { sdk: FakeSdk }).sdk = sdk;
  return { client, sdk, logger };
}

describe("RealLinearClient.getIssue", () => {
  it("maps all fields, including derived names, when everything is present", async () => {
    const { client, sdk } = makeClient();
    sdk.issue.mockResolvedValue(
      makeFakeIssue({
        id: "i1",
        identifier: "PRY-5",
        title: "Do the thing",
        description: "Full description",
        priority: 3,
        url: "https://linear.app/x/i1",
        labels: () => Promise.resolve({ nodes: [{ id: "l1", name: "bug" }] }),
        state: Promise.resolve({ id: "s1", name: "In Progress" }),
        project: Promise.resolve({ id: "p1", name: "Q1 Roadmap" }),
        cycle: Promise.resolve({ id: "c1", name: "Cycle 12" }),
        team: Promise.resolve({ id: "t1", key: "PRY" }),
      }),
    );

    const result = await client.getIssue("i1");

    expect(result).toEqual({
      id: "i1",
      identifier: "PRY-5",
      title: "Do the thing",
      description: "Full description",
      branchName: "ai/issue-1",
      state: "In Progress",
      labels: ["bug"],
      priority: 3,
      url: "https://linear.app/x/i1",
      project: "Q1 Roadmap",
      team: "PRY",
      cycle: "Cycle 12",
    });
    expect(sdk.issue).toHaveBeenCalledWith("i1");
  });

  it("defaults description to '', state to 'Unknown', labels to [], and project/team/cycle to undefined when absent", async () => {
    const { client, sdk } = makeClient();
    sdk.issue.mockResolvedValue(
      makeFakeIssue({
        id: "i2",
        description: null,
        state: Promise.resolve(null),
        project: Promise.resolve(null),
        cycle: Promise.resolve(null),
        team: Promise.resolve(null),
        labels: () => Promise.resolve(null),
      }),
    );

    const result = await client.getIssue("i2");

    expect(result.description).toBe("");
    expect(result.state).toBe("Unknown");
    expect(result.labels).toEqual([]);
    expect(result.project).toBeUndefined();
    expect(result.team).toBeUndefined();
    expect(result.cycle).toBeUndefined();
  });
});

describe("RealLinearClient.getRelatedContext: blocker hydration failure", () => {
  it("logs a warning and drops a blocker whose relation.issue rejects", async () => {
    const { client, sdk, logger } = makeClient();
    const focus = makeFakeIssue({
      id: "focus-id",
      parent: Promise.resolve(null),
      inverseRelations: () =>
        Promise.resolve({
          nodes: [
            {
              id: "rel-broken",
              type: "blocks",
              issue: Promise.reject(new Error("issue fetch failed")),
            },
          ],
        }),
    });
    sdk.issue.mockImplementation((id: string) =>
      id === "focus-id" ? Promise.resolve(focus) : Promise.reject(new Error("not seeded")),
    );

    const ctx = await client.getRelatedContext("focus-id");

    expect(ctx.blockers).toEqual([]);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ relationId: "rel-broken", focusIssueId: "focus-id" }),
      "Failed to hydrate blocker issue from relation",
    );
  });
});

describe("RealLinearClient.searchIssues", () => {
  it("builds the base filter from state alone and maps results", async () => {
    const { client, sdk } = makeClient();
    sdk.issues.mockResolvedValue({
      nodes: [
        makeFakeIssue({
          id: "s1",
          labels: () => Promise.resolve({ nodes: [{ id: "l1", name: "x" }] }),
          project: Promise.resolve({ id: "p", name: "Proj" }),
          cycle: Promise.resolve({ id: "c", name: "Cyc" }),
          team: Promise.resolve({ id: "t", key: "ENG" }),
        }),
      ],
    });

    const results = await client.searchIssues({ state: "Todo" });

    expect(sdk.issues).toHaveBeenCalledWith({ filter: { state: { name: { eq: "Todo" } } } });
    expect(results).toEqual([
      expect.objectContaining({
        id: "s1",
        state: "Todo",
        labels: ["x"],
        project: "Proj",
        team: "ENG",
        cycle: "Cyc",
      }),
    ]);
  });

  it("adds project, assignee and team filter clauses when provided", async () => {
    const { client, sdk } = makeClient();
    sdk.issues.mockResolvedValue({ nodes: [] });

    await client.searchIssues({
      state: "Todo",
      projectName: "Alpha",
      assigneeMe: true,
      team: "PRY",
    });

    expect(sdk.issues).toHaveBeenCalledWith({
      filter: {
        state: { name: { eq: "Todo" } },
        project: { name: { eq: "Alpha" } },
        assignee: { isMe: { eq: true } },
        team: { or: [{ name: { eq: "PRY" } }, { key: { eq: "PRY" } }] },
      },
    });
  });

  it("returns [] when issuesConn is null/nodes missing", async () => {
    const { client, sdk } = makeClient();
    sdk.issues.mockResolvedValue(null);

    const results = await client.searchIssues({ state: "Todo" });
    expect(results).toEqual([]);
  });

  it("defaults labels to [] and project/team/cycle to undefined per-result when absent", async () => {
    const { client, sdk } = makeClient();
    sdk.issues.mockResolvedValue({
      nodes: [
        makeFakeIssue({
          id: "s2",
          labels: () => Promise.resolve(null),
          project: Promise.resolve(null),
          cycle: Promise.resolve(null),
          team: Promise.resolve(null),
        }),
      ],
    });

    const [result] = await client.searchIssues({ state: "Done" });

    expect(result!.labels).toEqual([]);
    expect(result!.project).toBeUndefined();
    expect(result!.team).toBeUndefined();
    expect(result!.cycle).toBeUndefined();
  });

  it("logs the search summary", async () => {
    const { client, sdk, logger } = makeClient();
    sdk.issues.mockResolvedValue({ nodes: [] });

    await client.searchIssues({ state: "Todo", projectName: "Alpha" });

    expect(logger.info).toHaveBeenCalledWith(
      { projectName: "Alpha", assigneeMe: undefined, team: undefined, stateName: "Todo", count: 0 },
      "Searched Linear issues",
    );
  });
});

describe("RealLinearClient.postComment", () => {
  it("posts the comment and logs debug", async () => {
    const { client, sdk, logger } = makeClient();

    await client.postComment("issue-1", "hello world");

    expect(sdk.createComment).toHaveBeenCalledWith({ issueId: "issue-1", body: "hello world" });
    expect(logger.debug).toHaveBeenCalledWith({ issueId: "issue-1" }, "Posted comment to Linear issue");
  });
});

describe("RealLinearClient.updateIssueState", () => {
  it("warns and does nothing when the issue has no team", async () => {
    const { client, sdk, logger } = makeClient();
    sdk.issue.mockResolvedValue(makeFakeIssue({ id: "i1", team: Promise.resolve(null) }));

    await client.updateIssueState("i1", "Done");

    expect(sdk.updateIssue).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(
      { issueId: "i1" },
      "Cannot update state: issue has no team",
    );
  });

  it("warns and does nothing when the named state cannot be resolved for the team", async () => {
    const { client, sdk, logger } = makeClient();
    sdk.issue.mockResolvedValue(
      makeFakeIssue({ id: "i1", team: Promise.resolve({ id: "team-1", key: "ENG" }) }),
    );
    sdk.team.mockResolvedValue({
      states: () => Promise.resolve({ nodes: [{ id: "s1", name: "Todo" }] }),
    });

    await client.updateIssueState("i1", "Nonexistent State");

    expect(sdk.updateIssue).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(
      { issueId: "i1", stateName: "Nonexistent State", teamId: "team-1" },
      "Could not find workflow state by name",
    );
  });

  it("resolves the state id and updates the issue", async () => {
    const { client, sdk, logger } = makeClient();
    sdk.issue.mockResolvedValue(
      makeFakeIssue({ id: "i1", team: Promise.resolve({ id: "team-1", key: "ENG" }) }),
    );
    sdk.team.mockResolvedValue({
      states: () => Promise.resolve({ nodes: [{ id: "state-done", name: "Done" }] }),
    });

    await client.updateIssueState("i1", "Done");

    expect(sdk.updateIssue).toHaveBeenCalledWith("i1", { stateId: "state-done" });
    expect(logger.debug).toHaveBeenCalledWith(
      { issueId: "i1", stateName: "Done", stateId: "state-done" },
      "Updated Linear issue state",
    );
  });

  it("caches the team's state map so a second call does not re-fetch sdk.team", async () => {
    const { client, sdk } = makeClient();
    sdk.issue.mockResolvedValue(
      makeFakeIssue({ id: "i1", team: Promise.resolve({ id: "team-1", key: "ENG" }) }),
    );
    sdk.team.mockResolvedValue({
      states: () => Promise.resolve({ nodes: [{ id: "state-done", name: "Done" }] }),
    });

    await client.updateIssueState("i1", "Done");
    await client.updateIssueState("i1", "Done");

    expect(sdk.team).toHaveBeenCalledTimes(1);
    expect(sdk.updateIssue).toHaveBeenCalledTimes(2);
  });

  it("handles a null states connection by resolving to an empty state map", async () => {
    const { client, sdk, logger } = makeClient();
    sdk.issue.mockResolvedValue(
      makeFakeIssue({ id: "i1", team: Promise.resolve({ id: "team-2", key: "OPS" }) }),
    );
    sdk.team.mockResolvedValue({ states: () => Promise.resolve(null) });

    await client.updateIssueState("i1", "Done");

    expect(logger.warn).toHaveBeenCalledWith(
      { issueId: "i1", stateName: "Done", teamId: "team-2" },
      "Could not find workflow state by name",
    );
  });
});

describe("RealLinearClient.addLabel", () => {
  it("uses an existing label found via issueLabels and appends it to the issue", async () => {
    const { client, sdk, logger } = makeClient();
    sdk.issue.mockResolvedValue(
      makeFakeIssue({
        id: "i1",
        labelIds: ["existing-1"],
        team: Promise.resolve({ id: "team-1", key: "ENG" }),
      }),
    );
    sdk.issueLabels.mockResolvedValue({ nodes: [{ id: "label-x", name: "urgent" }] });

    await client.addLabel("i1", "urgent");

    expect(sdk.issueLabels).toHaveBeenCalledWith({ filter: { name: { eq: "urgent" } } });
    expect(sdk.createIssueLabel).not.toHaveBeenCalled();
    expect(sdk.updateIssue).toHaveBeenCalledWith("i1", { labelIds: ["existing-1", "label-x"] });
    expect(logger.debug).toHaveBeenCalledWith(
      { issueId: "i1", labelName: "urgent", labelId: "label-x" },
      "Added label to Linear issue",
    );
  });

  it("does not call updateIssue when the label is already present on the issue", async () => {
    const { client, sdk } = makeClient();
    sdk.issue.mockResolvedValue(
      makeFakeIssue({
        id: "i1",
        labelIds: ["label-x"],
        team: Promise.resolve({ id: "team-1", key: "ENG" }),
      }),
    );
    sdk.issueLabels.mockResolvedValue({ nodes: [{ id: "label-x", name: "urgent" }] });

    await client.addLabel("i1", "urgent");

    expect(sdk.updateIssue).not.toHaveBeenCalled();
  });

  it("creates a new label (with teamId) when none exists yet", async () => {
    const { client, sdk, logger } = makeClient();
    sdk.issue.mockResolvedValue(
      makeFakeIssue({
        id: "i1",
        labelIds: [],
        team: Promise.resolve({ id: "team-9", key: "ENG" }),
      }),
    );
    sdk.issueLabels.mockResolvedValue({ nodes: [] });
    sdk.createIssueLabel.mockResolvedValue({
      issueLabel: Promise.resolve({ id: "new-label-id" }),
    });

    await client.addLabel("i1", "brand-new");

    expect(sdk.createIssueLabel).toHaveBeenCalledWith({ name: "brand-new", teamId: "team-9" });
    expect(sdk.updateIssue).toHaveBeenCalledWith("i1", { labelIds: ["new-label-id"] });
    expect(logger.info).toHaveBeenCalledWith(
      { labelName: "brand-new", labelId: "new-label-id" },
      "Created new Linear label",
    );
  });

  it("creates a new label without a teamId when the issue has no team", async () => {
    const { client, sdk } = makeClient();
    sdk.issue.mockResolvedValue(
      makeFakeIssue({ id: "i1", labelIds: [], team: Promise.resolve(null) }),
    );
    sdk.issueLabels.mockResolvedValue({ nodes: [] });
    sdk.createIssueLabel.mockResolvedValue({
      issueLabel: Promise.resolve({ id: "new-label-id" }),
    });

    await client.addLabel("i1", "no-team-label");

    expect(sdk.createIssueLabel).toHaveBeenCalledWith({ name: "no-team-label" });
  });

  it("throws when label creation resolves without an issueLabel", async () => {
    const { client, sdk } = makeClient();
    sdk.issue.mockResolvedValue(
      makeFakeIssue({ id: "i1", labelIds: [], team: Promise.resolve(null) }),
    );
    sdk.issueLabels.mockResolvedValue({ nodes: [] });
    sdk.createIssueLabel.mockResolvedValue({ issueLabel: Promise.resolve(null) });

    await expect(client.addLabel("i1", "broken-label")).rejects.toThrow(
      "Failed to create label: broken-label",
    );
  });

  it("caches a resolved label id across addLabel calls (second call skips issueLabels lookup)", async () => {
    const { client, sdk } = makeClient();
    sdk.issue.mockResolvedValue(
      makeFakeIssue({ id: "i1", labelIds: [], team: Promise.resolve(null) }),
    );
    sdk.issueLabels.mockResolvedValue({ nodes: [{ id: "cached-id", name: "reused" }] });

    await client.addLabel("i1", "reused");
    await client.addLabel("i1", "reused");

    expect(sdk.issueLabels).toHaveBeenCalledTimes(1);
  });
});

describe("RealLinearClient.removeLabel", () => {
  it("looks up the label by name, removes it, and caches the id", async () => {
    const { client, sdk, logger } = makeClient();
    sdk.issue.mockResolvedValue(
      makeFakeIssue({
        id: "i1",
        labelIds: ["label-a", "label-b"],
        labels: () =>
          Promise.resolve({
            nodes: [
              { id: "label-a", name: "keep" },
              { id: "label-b", name: "remove-me" },
            ],
          }),
      }),
    );

    await client.removeLabel("i1", "remove-me");

    expect(sdk.updateIssue).toHaveBeenCalledWith("i1", { labelIds: ["label-a"] });
    expect(logger.debug).toHaveBeenCalledWith(
      { issueId: "i1", labelName: "remove-me" },
      "Removed label from Linear issue",
    );
  });

  it("does nothing (no updateIssue call, no debug log) when the label name is not found", async () => {
    const { client, sdk, logger } = makeClient();
    sdk.issue.mockResolvedValue(
      makeFakeIssue({
        id: "i1",
        labelIds: ["label-a"],
        labels: () => Promise.resolve({ nodes: [{ id: "label-a", name: "keep" }] }),
      }),
    );

    await client.removeLabel("i1", "does-not-exist");

    expect(sdk.updateIssue).not.toHaveBeenCalled();
    expect(logger.debug).not.toHaveBeenCalled();
  });

  it("uses the cached label id on a second removeLabel call, skipping issue.labels()", async () => {
    const { client, sdk } = makeClient();
    const labelsSpy = vi.fn().mockResolvedValue({
      nodes: [{ id: "label-a", name: "flaky" }],
    });
    sdk.issue.mockResolvedValue(
      makeFakeIssue({ id: "i1", labelIds: ["label-a"], labels: labelsSpy }),
    );

    await client.removeLabel("i1", "flaky");
    await client.removeLabel("i1", "flaky");

    expect(labelsSpy).toHaveBeenCalledTimes(1);
    expect(sdk.updateIssue).toHaveBeenCalledTimes(2);
  });
});

describe("RealLinearClient.listLabels", () => {
  it("returns label names and populates the label cache", async () => {
    const { client, sdk } = makeClient();
    sdk.issue.mockResolvedValue(
      makeFakeIssue({
        id: "i1",
        labels: () =>
          Promise.resolve({
            nodes: [
              { id: "l1", name: "bug" },
              { id: "l2", name: "urgent" },
            ],
          }),
      }),
    );

    const names = await client.listLabels("i1");

    expect(names).toEqual(["bug", "urgent"]);

    // The cache populated by listLabels should let removeLabel skip issue.labels().
    const labelsSpy = vi.fn().mockResolvedValue({ nodes: [] });
    sdk.issue.mockResolvedValue(makeFakeIssue({ id: "i1", labelIds: ["l2"], labels: labelsSpy }));
    await client.removeLabel("i1", "urgent");
    expect(labelsSpy).not.toHaveBeenCalled();
    expect(sdk.updateIssue).toHaveBeenCalledWith("i1", { labelIds: [] });
  });

  it("returns [] when the labels connection is null", async () => {
    const { client, sdk } = makeClient();
    sdk.issue.mockResolvedValue(makeFakeIssue({ id: "i1", labels: () => Promise.resolve(null) }));

    expect(await client.listLabels("i1")).toEqual([]);
  });
});
