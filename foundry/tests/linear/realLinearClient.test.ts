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
  state: Promise<{ id: string; name: string } | null>;
  project: Promise<{ name: string } | null>;
  cycle: Promise<{ name: string } | null>;
  team: Promise<{ id: string; key: string } | null>;
  labels: () => Promise<{ nodes: Array<{ id: string; name: string }> } | null>;
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
    project: Promise.resolve(null),
    cycle: Promise.resolve(null),
    team: Promise.resolve({ id: "team-1", key: "PRY" }),
    labels: () => Promise.resolve({ nodes: [] }),
    ...overrides,
  };
}

function makeLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };
}

function makeFakeSdk(overrides: Record<string, unknown> = {}) {
  return {
    issue: vi.fn(),
    issues: vi.fn().mockResolvedValue({ nodes: [] }),
    createComment: vi.fn().mockResolvedValue({}),
    updateIssue: vi.fn().mockResolvedValue({}),
    team: vi.fn(),
    issueLabels: vi.fn().mockResolvedValue({ nodes: [] }),
    createIssueLabel: vi.fn(),
    ...overrides,
  };
}

type FakeSdk = ReturnType<typeof makeFakeSdk>;

function makeClient(): { client: RealLinearClient; sdk: FakeSdk; logger: ReturnType<typeof makeLogger> } {
  const logger = makeLogger();
  const client = new RealLinearClient("test-key", logger as never);
  const sdk = makeFakeSdk();
  (client as unknown as { sdk: FakeSdk }).sdk = sdk;
  return { client, sdk, logger };
}

describe("RealLinearClient.getIssue", () => {
  let client: RealLinearClient;
  let sdk: FakeSdk;

  beforeEach(() => {
    ({ client, sdk } = makeClient());
  });

  it("maps a fully populated SDK issue to a LinearIssue", async () => {
    const issue = makeFakeIssue({
      id: "issue-1",
      identifier: "PRY-1",
      title: "Fix bug",
      description: "Details",
      priority: 2,
      labels: () => Promise.resolve({ nodes: [{ id: "l1", name: "bug" }] }),
      state: Promise.resolve({ id: "s1", name: "In Progress" }),
      project: Promise.resolve({ name: "Platform" }),
      cycle: Promise.resolve({ name: "Sprint 1" }),
      team: Promise.resolve({ id: "t1", key: "PRY" }),
    });
    sdk.issue.mockResolvedValue(issue);

    const result = await client.getIssue("issue-1");

    expect(result).toEqual({
      id: "issue-1",
      identifier: "PRY-1",
      title: "Fix bug",
      description: "Details",
      branchName: "ai/issue-1",
      state: "In Progress",
      labels: ["bug"],
      priority: 2,
      url: "https://linear.app/team/issue/PRY-1",
      project: "Platform",
      team: "PRY",
      cycle: "Sprint 1",
    });
  });

  it("defaults null description to an empty string", async () => {
    sdk.issue.mockResolvedValue(makeFakeIssue({ id: "issue-1", description: null }));
    const result = await client.getIssue("issue-1");
    expect(result.description).toBe("");
  });

  it("defaults missing state to 'Unknown' and missing project/cycle/team to undefined", async () => {
    sdk.issue.mockResolvedValue(
      makeFakeIssue({
        id: "issue-1",
        state: Promise.resolve(null),
        project: Promise.resolve(null),
        cycle: Promise.resolve(null),
        team: Promise.resolve(null),
      }),
    );

    const result = await client.getIssue("issue-1");

    expect(result.state).toBe("Unknown");
    expect(result.project).toBeUndefined();
    expect(result.cycle).toBeUndefined();
    expect(result.team).toBeUndefined();
  });

  it("defaults labels to an empty array when the labels connection has no nodes", async () => {
    sdk.issue.mockResolvedValue(
      makeFakeIssue({ id: "issue-1", labels: () => Promise.resolve(null) }),
    );

    const result = await client.getIssue("issue-1");
    expect(result.labels).toEqual([]);
  });
});

describe("RealLinearClient.searchIssues", () => {
  let client: RealLinearClient;
  let sdk: FakeSdk;
  let logger: ReturnType<typeof makeLogger>;

  beforeEach(() => {
    ({ client, sdk, logger } = makeClient());
  });

  it("builds a state-only filter when no optional filters are given", async () => {
    sdk.issues.mockResolvedValue({ nodes: [] });

    await client.searchIssues({ state: "Todo" });

    expect(sdk.issues).toHaveBeenCalledWith({
      filter: { state: { name: { eq: "Todo" } } },
    });
  });

  it("adds project, assignee and team clauses when provided", async () => {
    sdk.issues.mockResolvedValue({ nodes: [] });

    await client.searchIssues({
      state: "Todo",
      projectName: "Platform",
      assigneeMe: true,
      team: "PRY",
    });

    expect(sdk.issues).toHaveBeenCalledWith({
      filter: {
        state: { name: { eq: "Todo" } },
        project: { name: { eq: "Platform" } },
        assignee: { isMe: { eq: true } },
        team: { or: [{ name: { eq: "PRY" } }, { key: { eq: "PRY" } }] },
      },
    });
  });

  it("maps matched issues, using the requested state rather than the SDK's own state field", async () => {
    const issue = makeFakeIssue({
      id: "issue-1",
      labels: () => Promise.resolve({ nodes: [{ id: "l1", name: "bug" }] }),
      project: Promise.resolve({ name: "Platform" }),
      cycle: Promise.resolve({ name: "Sprint 1" }),
      team: Promise.resolve({ id: "t1", key: "PRY" }),
    });
    sdk.issues.mockResolvedValue({ nodes: [issue] });

    const results = await client.searchIssues({ state: "Todo" });

    expect(results).toEqual([
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
        project: "Platform",
        team: "PRY",
        cycle: "Sprint 1",
      },
    ]);
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ stateName: "Todo", count: 1 }),
      "Searched Linear issues",
    );
  });

  it("returns an empty array when the issues connection has no nodes", async () => {
    sdk.issues.mockResolvedValue({ nodes: undefined });
    const results = await client.searchIssues({ state: "Todo" });
    expect(results).toEqual([]);
  });

  it("defaults labels/description/project/cycle/team to empty/undefined when absent", async () => {
    const issue = makeFakeIssue({
      id: "issue-1",
      description: null,
      labels: () => Promise.resolve(null),
      project: Promise.resolve(null),
      cycle: Promise.resolve(null),
      team: Promise.resolve(null),
    });
    sdk.issues.mockResolvedValue({ nodes: [issue] });

    const [result] = await client.searchIssues({ state: "Todo" });

    expect(result.labels).toEqual([]);
    expect(result.description).toBe("");
    expect(result.project).toBeUndefined();
    expect(result.cycle).toBeUndefined();
    expect(result.team).toBeUndefined();
  });
});

describe("RealLinearClient.postComment", () => {
  it("posts a comment via the SDK", async () => {
    const { client, sdk, logger } = makeClient();

    await client.postComment("issue-1", "Hello world");

    expect(sdk.createComment).toHaveBeenCalledWith({ issueId: "issue-1", body: "Hello world" });
    expect(logger.debug).toHaveBeenCalled();
  });
});

describe("RealLinearClient.updateIssueState", () => {
  let client: RealLinearClient;
  let sdk: FakeSdk;
  let logger: ReturnType<typeof makeLogger>;

  beforeEach(() => {
    ({ client, sdk, logger } = makeClient());
  });

  it("warns and does not update when the issue has no team", async () => {
    sdk.issue.mockResolvedValue(makeFakeIssue({ id: "issue-1", team: Promise.resolve(null) }));

    await client.updateIssueState("issue-1", "Done");

    expect(logger.warn).toHaveBeenCalledWith(
      { issueId: "issue-1" },
      "Cannot update state: issue has no team",
    );
    expect(sdk.updateIssue).not.toHaveBeenCalled();
  });

  it("warns and does not update when the state name cannot be resolved", async () => {
    sdk.issue.mockResolvedValue(makeFakeIssue({ id: "issue-1" }));
    sdk.team.mockResolvedValue({
      states: () => Promise.resolve({ nodes: [{ id: "s1", name: "Todo" }] }),
    });

    await client.updateIssueState("issue-1", "Nonexistent State");

    expect(logger.warn).toHaveBeenCalledWith(
      { issueId: "issue-1", stateName: "Nonexistent State", teamId: "team-1" },
      "Could not find workflow state by name",
    );
    expect(sdk.updateIssue).not.toHaveBeenCalled();
  });

  it("resolves the state id from the team's workflow states and updates the issue", async () => {
    sdk.issue.mockResolvedValue(makeFakeIssue({ id: "issue-1" }));
    sdk.team.mockResolvedValue({
      states: () =>
        Promise.resolve({
          nodes: [
            { id: "s1", name: "Todo" },
            { id: "s2", name: "Done" },
          ],
        }),
    });

    await client.updateIssueState("issue-1", "Done");

    expect(sdk.updateIssue).toHaveBeenCalledWith("issue-1", { stateId: "s2" });
  });

  it("treats a missing states connection as no workflow states (warns, no update)", async () => {
    sdk.issue.mockResolvedValue(makeFakeIssue({ id: "issue-1" }));
    sdk.team.mockResolvedValue({ states: () => Promise.resolve(null) });

    await client.updateIssueState("issue-1", "Done");

    expect(logger.warn).toHaveBeenCalledWith(
      { issueId: "issue-1", stateName: "Done", teamId: "team-1" },
      "Could not find workflow state by name",
    );
    expect(sdk.updateIssue).not.toHaveBeenCalled();
  });

  it("caches the team's workflow states across calls (fetches the team only once)", async () => {
    sdk.issue.mockResolvedValue(makeFakeIssue({ id: "issue-1" }));
    sdk.team.mockResolvedValue({
      states: () =>
        Promise.resolve({
          nodes: [
            { id: "s1", name: "Todo" },
            { id: "s2", name: "Done" },
          ],
        }),
    });

    await client.updateIssueState("issue-1", "Todo");
    await client.updateIssueState("issue-1", "Done");

    expect(sdk.team).toHaveBeenCalledTimes(1);
  });
});

describe("RealLinearClient.addLabel", () => {
  let client: RealLinearClient;
  let sdk: FakeSdk;
  let logger: ReturnType<typeof makeLogger>;

  beforeEach(() => {
    ({ client, sdk, logger } = makeClient());
  });

  it("finds an existing label by name and adds it to the issue", async () => {
    sdk.issue.mockResolvedValue(makeFakeIssue({ id: "issue-1", labelIds: ["existing"] }));
    sdk.issueLabels.mockResolvedValue({ nodes: [{ id: "label-urgent", name: "urgent" }] });

    await client.addLabel("issue-1", "urgent");

    expect(sdk.issueLabels).toHaveBeenCalledWith({ filter: { name: { eq: "urgent" } } });
    expect(sdk.updateIssue).toHaveBeenCalledWith("issue-1", {
      labelIds: ["existing", "label-urgent"],
    });
    expect(logger.info).not.toHaveBeenCalled();
  });

  it("creates a new label scoped to the issue's team when none exists", async () => {
    sdk.issue.mockResolvedValue(makeFakeIssue({ id: "issue-1", labelIds: [] }));
    sdk.issueLabels.mockResolvedValue({ nodes: [] });
    sdk.createIssueLabel.mockResolvedValue({
      issueLabel: Promise.resolve({ id: "label-new", name: "new-label" }),
    });

    await client.addLabel("issue-1", "new-label");

    expect(sdk.createIssueLabel).toHaveBeenCalledWith({ name: "new-label", teamId: "team-1" });
    expect(sdk.updateIssue).toHaveBeenCalledWith("issue-1", { labelIds: ["label-new"] });
    expect(logger.info).toHaveBeenCalledWith(
      { labelName: "new-label", labelId: "label-new" },
      "Created new Linear label",
    );
  });

  it("creates a label without a teamId when the issue has no team", async () => {
    sdk.issue.mockResolvedValue(
      makeFakeIssue({ id: "issue-1", labelIds: [], team: Promise.resolve(null) }),
    );
    sdk.issueLabels.mockResolvedValue({ nodes: [] });
    sdk.createIssueLabel.mockResolvedValue({
      issueLabel: Promise.resolve({ id: "label-new", name: "new-label" }),
    });

    await client.addLabel("issue-1", "new-label");

    expect(sdk.createIssueLabel).toHaveBeenCalledWith({ name: "new-label" });
  });

  it("throws when label creation returns no issueLabel", async () => {
    sdk.issue.mockResolvedValue(makeFakeIssue({ id: "issue-1", labelIds: [] }));
    sdk.issueLabels.mockResolvedValue({ nodes: [] });
    sdk.createIssueLabel.mockResolvedValue({ issueLabel: Promise.resolve(undefined) });

    await expect(client.addLabel("issue-1", "broken-label")).rejects.toThrow(
      "Failed to create label: broken-label",
    );
  });

  it("does not add a duplicate when the label id is already present on the issue", async () => {
    sdk.issue.mockResolvedValue(makeFakeIssue({ id: "issue-1", labelIds: ["label-urgent"] }));
    sdk.issueLabels.mockResolvedValue({ nodes: [{ id: "label-urgent", name: "urgent" }] });

    await client.addLabel("issue-1", "urgent");

    expect(sdk.updateIssue).not.toHaveBeenCalled();
  });

  it("caches a resolved label id, skipping the lookup on a second call", async () => {
    sdk.issue.mockResolvedValue(makeFakeIssue({ id: "issue-1", labelIds: [] }));
    sdk.issueLabels.mockResolvedValue({ nodes: [{ id: "label-urgent", name: "urgent" }] });

    await client.addLabel("issue-1", "urgent");
    await client.addLabel("issue-1", "urgent");

    expect(sdk.issueLabels).toHaveBeenCalledTimes(1);
  });
});

describe("RealLinearClient.removeLabel", () => {
  let client: RealLinearClient;
  let sdk: FakeSdk;

  beforeEach(() => {
    ({ client, sdk } = makeClient());
  });

  it("looks up the label by name and removes it from labelIds", async () => {
    sdk.issue.mockResolvedValue(
      makeFakeIssue({
        id: "issue-1",
        labelIds: ["label-urgent", "label-bug"],
        labels: () =>
          Promise.resolve({
            nodes: [
              { id: "label-urgent", name: "urgent" },
              { id: "label-bug", name: "bug" },
            ],
          }),
      }),
    );

    await client.removeLabel("issue-1", "urgent");

    expect(sdk.updateIssue).toHaveBeenCalledWith("issue-1", { labelIds: ["label-bug"] });
  });

  it("is a no-op when the label name is not found on the issue", async () => {
    sdk.issue.mockResolvedValue(
      makeFakeIssue({
        id: "issue-1",
        labelIds: ["label-bug"],
        labels: () => Promise.resolve({ nodes: [{ id: "label-bug", name: "bug" }] }),
      }),
    );

    await client.removeLabel("issue-1", "urgent");

    expect(sdk.updateIssue).not.toHaveBeenCalled();
  });

  it("uses the cached label id (from a prior listLabels/addLabel) without re-fetching labels", async () => {
    const labelsFn = vi
      .fn()
      .mockResolvedValue({ nodes: [{ id: "label-urgent", name: "urgent" }] });
    sdk.issue.mockResolvedValue(
      makeFakeIssue({ id: "issue-1", labelIds: ["label-urgent"], labels: labelsFn }),
    );

    // Prime the cache via listLabels first.
    await client.listLabels("issue-1");
    labelsFn.mockClear();

    await client.removeLabel("issue-1", "urgent");

    expect(labelsFn).not.toHaveBeenCalled();
    expect(sdk.updateIssue).toHaveBeenCalledWith("issue-1", { labelIds: [] });
  });
});

describe("RealLinearClient.listLabels", () => {
  it("returns label names and populates the label cache", async () => {
    const { client, sdk } = makeClient();
    sdk.issue.mockResolvedValue(
      makeFakeIssue({
        id: "issue-1",
        labels: () =>
          Promise.resolve({ nodes: [{ id: "l1", name: "bug" }, { id: "l2", name: "urgent" }] }),
      }),
    );

    const names = await client.listLabels("issue-1");

    expect(names).toEqual(["bug", "urgent"]);
  });

  it("returns an empty array when the labels connection has no nodes", async () => {
    const { client, sdk } = makeClient();
    sdk.issue.mockResolvedValue(
      makeFakeIssue({ id: "issue-1", labels: () => Promise.resolve(null) }),
    );

    await expect(client.listLabels("issue-1")).resolves.toEqual([]);
  });
});
