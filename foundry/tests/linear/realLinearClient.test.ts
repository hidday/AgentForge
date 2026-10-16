import { describe, it, expect, vi, beforeEach } from "vitest";
import { RealLinearClient } from "../../src/linear/realLinearClient.js";

function makeLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };
}

interface FakeIssue {
  id: string;
  identifier: string;
  title: string;
  description: string | null;
  branchName: string;
  priority: number;
  url: string;
  labelIds: string[];
  state: Promise<{ id: string; name: string } | undefined>;
  project: Promise<{ name: string } | undefined>;
  cycle: Promise<{ name: string } | undefined>;
  team: Promise<{ id: string; key: string } | undefined>;
  labels: () => Promise<{ nodes: Array<{ id: string; name: string }> } | undefined>;
  parent?: Promise<FakeIssue | undefined>;
  inverseRelations?: () => Promise<{
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
    state: Promise.resolve({ id: "state-1", name: "Todo" }),
    project: Promise.resolve({ name: "Project A" }),
    cycle: Promise.resolve({ name: "Cycle 1" }),
    team: Promise.resolve({ id: "team-1", key: "PRY" }),
    labels: () => Promise.resolve({ nodes: [] }),
    ...overrides,
  };
}

function makeFakeSdk() {
  return {
    issue: vi.fn(),
    issues: vi.fn(),
    createComment: vi.fn().mockResolvedValue(undefined),
    updateIssue: vi.fn().mockResolvedValue(undefined),
    team: vi.fn(),
    issueLabels: vi.fn(),
    createIssueLabel: vi.fn(),
  };
}

function injectSdk(client: RealLinearClient, sdk: ReturnType<typeof makeFakeSdk>) {
  (client as unknown as { sdk: ReturnType<typeof makeFakeSdk> }).sdk = sdk;
}

describe("RealLinearClient.getIssue", () => {
  it("maps all fields when they are present", async () => {
    const logger = makeLogger();
    const client = new RealLinearClient("key", logger as never);
    const sdk = makeFakeSdk();
    const issue = makeFakeIssue({
      id: "issue-1",
      labels: () => Promise.resolve({ nodes: [{ id: "l1", name: "bug" }] }),
    });
    sdk.issue.mockResolvedValue(issue);
    injectSdk(client, sdk);

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
      project: "Project A",
      team: "PRY",
      cycle: "Cycle 1",
    });
  });

  it("falls back to defaults when description, state, project, team, cycle and labels are missing", async () => {
    const logger = makeLogger();
    const client = new RealLinearClient("key", logger as never);
    const sdk = makeFakeSdk();
    const issue = makeFakeIssue({
      id: "issue-2",
      description: null,
      state: Promise.resolve(undefined),
      project: Promise.resolve(undefined),
      cycle: Promise.resolve(undefined),
      team: Promise.resolve(undefined),
      labels: () => Promise.resolve(undefined),
    });
    sdk.issue.mockResolvedValue(issue);
    injectSdk(client, sdk);

    const result = await client.getIssue("issue-2");

    expect(result.description).toBe("");
    expect(result.state).toBe("Unknown");
    expect(result.project).toBeUndefined();
    expect(result.team).toBeUndefined();
    expect(result.cycle).toBeUndefined();
    expect(result.labels).toEqual([]);
  });
});

describe("RealLinearClient.getRelatedContext", () => {
  it("logs a warning and drops a blocker when hydrating its issue rejects", async () => {
    const logger = makeLogger();
    const client = new RealLinearClient("key", logger as never);
    const sdk = makeFakeSdk();
    const failingRelationIssue = Promise.reject(new Error("hydrate failed"));
    const okBlocker = makeFakeIssue({ id: "blocker-ok" });
    const focus = makeFakeIssue({
      id: "focus-id",
      parent: Promise.resolve(undefined),
      inverseRelations: () =>
        Promise.resolve({
          nodes: [
            { id: "rel-bad", type: "blocks", issue: failingRelationIssue },
            { id: "rel-good", type: "blocks", issue: Promise.resolve(okBlocker) },
          ],
        }),
    });
    sdk.issue.mockResolvedValue(focus);
    injectSdk(client, sdk);

    const ctx = await client.getRelatedContext("focus-id");

    expect(ctx.blockers).toHaveLength(1);
    expect(ctx.blockers[0].id).toBe("blocker-ok");
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ relationId: "rel-bad", focusIssueId: "focus-id" }),
      "Failed to hydrate blocker issue from relation",
    );
  });
});

describe("RealLinearClient.searchIssues", () => {
  let logger: ReturnType<typeof makeLogger>;
  let client: RealLinearClient;
  let sdk: ReturnType<typeof makeFakeSdk>;

  beforeEach(() => {
    logger = makeLogger();
    client = new RealLinearClient("key", logger as never);
    sdk = makeFakeSdk();
    injectSdk(client, sdk);
  });

  it("builds a filter with only state when no optional filters are given", async () => {
    sdk.issues.mockResolvedValue({ nodes: [] });

    await client.searchIssues({ state: "Todo" });

    expect(sdk.issues).toHaveBeenCalledWith({
      filter: { state: { name: { eq: "Todo" } } },
    });
  });

  it("includes project, assignee and team clauses when provided", async () => {
    sdk.issues.mockResolvedValue({ nodes: [] });

    await client.searchIssues({
      state: "Todo",
      projectName: "Project A",
      assigneeMe: true,
      team: "PRY",
    });

    expect(sdk.issues).toHaveBeenCalledWith({
      filter: {
        state: { name: { eq: "Todo" } },
        project: { name: { eq: "Project A" } },
        assignee: { isMe: { eq: true } },
        team: { or: [{ name: { eq: "PRY" } }, { key: { eq: "PRY" } }] },
      },
    });
  });

  it("omits the assignee clause when assigneeMe is false", async () => {
    sdk.issues.mockResolvedValue({ nodes: [] });

    await client.searchIssues({ state: "Todo", assigneeMe: false });

    expect(sdk.issues).toHaveBeenCalledWith({
      filter: { state: { name: { eq: "Todo" } } },
    });
  });

  it("maps each returned issue using the filter's state name, not the issue's actual state", async () => {
    const issue = makeFakeIssue({
      id: "issue-1",
      labels: () => Promise.resolve({ nodes: [{ id: "l1", name: "bug" }] }),
    });
    sdk.issues.mockResolvedValue({ nodes: [issue] });

    const result = await client.searchIssues({ state: "Todo" });

    expect(result).toEqual([
      {
        id: "issue-1",
        identifier: "PRY-1",
        title: "Issue title",
        description: "Issue description",
        branchName: "ai/issue-1",
        state: "Todo",
        labels: ["bug"],
        priority: 0,
        url: "https://linear.app/team/issue/PRY-1",
        project: "Project A",
        team: "PRY",
        cycle: "Cycle 1",
      },
    ]);
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ stateName: "Todo", count: 1 }),
      "Searched Linear issues",
    );
  });

  it("returns [] when the SDK result has no nodes", async () => {
    sdk.issues.mockResolvedValue(undefined);

    const result = await client.searchIssues({ state: "Todo" });

    expect(result).toEqual([]);
  });

  it("falls back to undefined project/team/cycle when missing on a result issue", async () => {
    const issue = makeFakeIssue({
      id: "issue-1",
      project: Promise.resolve(undefined),
      cycle: Promise.resolve(undefined),
      team: Promise.resolve(undefined),
    });
    sdk.issues.mockResolvedValue({ nodes: [issue] });

    const result = await client.searchIssues({ state: "Todo" });

    expect(result[0].project).toBeUndefined();
    expect(result[0].team).toBeUndefined();
    expect(result[0].cycle).toBeUndefined();
  });
});

describe("RealLinearClient.postComment", () => {
  it("creates a comment via the SDK and logs it", async () => {
    const logger = makeLogger();
    const client = new RealLinearClient("key", logger as never);
    const sdk = makeFakeSdk();
    injectSdk(client, sdk);

    await client.postComment("issue-1", "Hello");

    expect(sdk.createComment).toHaveBeenCalledWith({ issueId: "issue-1", body: "Hello" });
    expect(logger.debug).toHaveBeenCalledWith({ issueId: "issue-1" }, "Posted comment to Linear issue");
  });
});

describe("RealLinearClient.updateIssueState", () => {
  let logger: ReturnType<typeof makeLogger>;
  let client: RealLinearClient;
  let sdk: ReturnType<typeof makeFakeSdk>;

  beforeEach(() => {
    logger = makeLogger();
    client = new RealLinearClient("key", logger as never);
    sdk = makeFakeSdk();
    injectSdk(client, sdk);
  });

  it("warns and does not update when the issue has no team", async () => {
    sdk.issue.mockResolvedValue(makeFakeIssue({ id: "issue-1", team: Promise.resolve(undefined) }));

    await client.updateIssueState("issue-1", "Done");

    expect(logger.warn).toHaveBeenCalledWith({ issueId: "issue-1" }, "Cannot update state: issue has no team");
    expect(sdk.updateIssue).not.toHaveBeenCalled();
  });

  it("warns and does not update when the named workflow state cannot be resolved", async () => {
    sdk.issue.mockResolvedValue(makeFakeIssue({ id: "issue-1" }));
    sdk.team.mockResolvedValue({ states: () => Promise.resolve({ nodes: [{ name: "Todo", id: "s1" }] }) });

    await client.updateIssueState("issue-1", "Nonexistent");

    expect(logger.warn).toHaveBeenCalledWith(
      { issueId: "issue-1", stateName: "Nonexistent", teamId: "team-1" },
      "Could not find workflow state by name",
    );
    expect(sdk.updateIssue).not.toHaveBeenCalled();
  });

  it("updates the issue's state when the workflow state resolves successfully", async () => {
    sdk.issue.mockResolvedValue(makeFakeIssue({ id: "issue-1" }));
    sdk.team.mockResolvedValue({
      states: () => Promise.resolve({ nodes: [{ name: "Done", id: "state-done" }] }),
    });

    await client.updateIssueState("issue-1", "Done");

    expect(sdk.updateIssue).toHaveBeenCalledWith("issue-1", { stateId: "state-done" });
    expect(logger.debug).toHaveBeenCalledWith(
      { issueId: "issue-1", stateName: "Done", stateId: "state-done" },
      "Updated Linear issue state",
    );
  });

  it("caches the team's workflow states across calls (fetches team.states() only once)", async () => {
    sdk.issue.mockResolvedValue(makeFakeIssue({ id: "issue-1" }));
    sdk.team.mockResolvedValue({
      states: () => Promise.resolve({ nodes: [{ name: "Done", id: "state-done" }] }),
    });

    await client.updateIssueState("issue-1", "Done");
    await client.updateIssueState("issue-1", "Done");

    expect(sdk.team).toHaveBeenCalledTimes(1);
  });
});

describe("RealLinearClient.addLabel", () => {
  let logger: ReturnType<typeof makeLogger>;
  let client: RealLinearClient;
  let sdk: ReturnType<typeof makeFakeSdk>;

  beforeEach(() => {
    logger = makeLogger();
    client = new RealLinearClient("key", logger as never);
    sdk = makeFakeSdk();
    injectSdk(client, sdk);
  });

  it("creates a new label and attaches it when the issue has no labels yet", async () => {
    sdk.issue.mockResolvedValue(makeFakeIssue({ id: "issue-1", labelIds: [] }));
    sdk.issueLabels.mockResolvedValue({ nodes: [] });
    sdk.createIssueLabel.mockResolvedValue({
      issueLabel: Promise.resolve({ id: "new-label-id", name: "ai:todo" }),
    });

    await client.addLabel("issue-1", "ai:todo");

    expect(sdk.createIssueLabel).toHaveBeenCalledWith({ name: "ai:todo", teamId: "team-1" });
    expect(sdk.updateIssue).toHaveBeenCalledWith("issue-1", { labelIds: ["new-label-id"] });
    expect(logger.info).toHaveBeenCalledWith(
      { labelName: "ai:todo", labelId: "new-label-id" },
      "Created new Linear label",
    );
  });

  it("reuses an existing label found via issueLabels without creating a new one", async () => {
    sdk.issue.mockResolvedValue(makeFakeIssue({ id: "issue-1", labelIds: [] }));
    sdk.issueLabels.mockResolvedValue({ nodes: [{ id: "existing-id", name: "ai:todo" }] });

    await client.addLabel("issue-1", "ai:todo");

    expect(sdk.createIssueLabel).not.toHaveBeenCalled();
    expect(sdk.updateIssue).toHaveBeenCalledWith("issue-1", { labelIds: ["existing-id"] });
  });

  it("does not call updateIssue when the label is already attached to the issue", async () => {
    sdk.issue.mockResolvedValue(makeFakeIssue({ id: "issue-1", labelIds: ["existing-id"] }));
    sdk.issueLabels.mockResolvedValue({ nodes: [{ id: "existing-id", name: "ai:todo" }] });

    await client.addLabel("issue-1", "ai:todo");

    expect(sdk.updateIssue).not.toHaveBeenCalled();
  });

  it("creates a label without a teamId when the issue has no team", async () => {
    sdk.issue.mockResolvedValue(
      makeFakeIssue({ id: "issue-1", labelIds: [], team: Promise.resolve(undefined) }),
    );
    sdk.issueLabels.mockResolvedValue({ nodes: [] });
    sdk.createIssueLabel.mockResolvedValue({
      issueLabel: Promise.resolve({ id: "new-label-id", name: "ai:todo" }),
    });

    await client.addLabel("issue-1", "ai:todo");

    expect(sdk.createIssueLabel).toHaveBeenCalledWith({ name: "ai:todo" });
  });

  it("throws when label creation does not return an issueLabel", async () => {
    sdk.issue.mockResolvedValue(makeFakeIssue({ id: "issue-1", labelIds: [] }));
    sdk.issueLabels.mockResolvedValue({ nodes: [] });
    sdk.createIssueLabel.mockResolvedValue({ issueLabel: Promise.resolve(undefined) });

    await expect(client.addLabel("issue-1", "ai:todo")).rejects.toThrow(
      "Failed to create label: ai:todo",
    );
  });

  it("caches a resolved label id across calls (does not re-query issueLabels)", async () => {
    sdk.issue.mockResolvedValue(makeFakeIssue({ id: "issue-1", labelIds: [] }));
    sdk.issueLabels.mockResolvedValue({ nodes: [{ id: "cached-id", name: "ai:todo" }] });

    await client.addLabel("issue-1", "ai:todo");
    await client.addLabel("issue-2", "ai:todo");

    expect(sdk.issueLabels).toHaveBeenCalledTimes(1);
  });
});

describe("RealLinearClient.removeLabel", () => {
  let logger: ReturnType<typeof makeLogger>;
  let client: RealLinearClient;
  let sdk: ReturnType<typeof makeFakeSdk>;

  beforeEach(() => {
    logger = makeLogger();
    client = new RealLinearClient("key", logger as never);
    sdk = makeFakeSdk();
    injectSdk(client, sdk);
  });

  it("removes a label found via the issue's labels() when not cached", async () => {
    sdk.issue.mockResolvedValue(
      makeFakeIssue({
        id: "issue-1",
        labelIds: ["label-a", "label-b"],
        labels: () => Promise.resolve({ nodes: [{ id: "label-a", name: "ai:todo" }] }),
      }),
    );

    await client.removeLabel("issue-1", "ai:todo");

    expect(sdk.updateIssue).toHaveBeenCalledWith("issue-1", { labelIds: ["label-b"] });
    expect(logger.debug).toHaveBeenCalledWith(
      { issueId: "issue-1", labelName: "ai:todo" },
      "Removed label from Linear issue",
    );
  });

  it("does nothing when the label is not found on the issue", async () => {
    sdk.issue.mockResolvedValue(
      makeFakeIssue({
        id: "issue-1",
        labelIds: ["label-b"],
        labels: () => Promise.resolve({ nodes: [{ id: "label-c", name: "other" }] }),
      }),
    );

    await client.removeLabel("issue-1", "ai:todo");

    expect(sdk.updateIssue).not.toHaveBeenCalled();
    expect(logger.debug).not.toHaveBeenCalled();
  });

  it("uses the cached label id on a later call instead of re-fetching labels()", async () => {
    const labelsFn = vi.fn().mockResolvedValue({ nodes: [{ id: "label-a", name: "ai:todo" }] });
    sdk.issue.mockResolvedValue(
      makeFakeIssue({ id: "issue-1", labelIds: ["label-a", "label-b"], labels: labelsFn }),
    );

    await client.removeLabel("issue-1", "ai:todo");
    expect(labelsFn).toHaveBeenCalledTimes(1);

    sdk.issue.mockResolvedValue(
      makeFakeIssue({ id: "issue-1", labelIds: ["label-a", "label-b"], labels: labelsFn }),
    );
    await client.removeLabel("issue-1", "ai:todo");

    expect(labelsFn).toHaveBeenCalledTimes(1);
    expect(sdk.updateIssue).toHaveBeenCalledTimes(2);
  });
});

describe("RealLinearClient.listLabels", () => {
  it("returns the issue's label names and seeds the label cache", async () => {
    const logger = makeLogger();
    const client = new RealLinearClient("key", logger as never);
    const sdk = makeFakeSdk();
    sdk.issue.mockResolvedValue(
      makeFakeIssue({
        id: "issue-1",
        labelIds: ["label-a"],
        labels: () => Promise.resolve({ nodes: [{ id: "label-a", name: "ai:todo" }] }),
      }),
    );
    injectSdk(client, sdk);

    const names = await client.listLabels("issue-1");
    expect(names).toEqual(["ai:todo"]);

    // The label cache should now be seeded, so removeLabel should not need
    // to call issue.labels() again.
    const labelsFn = vi.fn().mockResolvedValue({ nodes: [{ id: "label-a", name: "ai:todo" }] });
    sdk.issue.mockResolvedValue(
      makeFakeIssue({ id: "issue-1", labelIds: ["label-a"], labels: labelsFn }),
    );
    await client.removeLabel("issue-1", "ai:todo");
    expect(labelsFn).not.toHaveBeenCalled();
  });

  it("returns [] when the issue has no labels connection", async () => {
    const logger = makeLogger();
    const client = new RealLinearClient("key", logger as never);
    const sdk = makeFakeSdk();
    sdk.issue.mockResolvedValue(makeFakeIssue({ id: "issue-1", labels: () => Promise.resolve(undefined) }));
    injectSdk(client, sdk);

    const names = await client.listLabels("issue-1");

    expect(names).toEqual([]);
  });
});
