import { describe, it, expect, vi, beforeEach } from "vitest";
import { RealLinearClient } from "../../src/linear/realLinearClient.js";

interface FakeTeam {
  id: string;
  key: string;
  states: () => Promise<{ nodes: Array<{ id: string; name: string }> }>;
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
  state: Promise<{ id: string; name: string } | null>;
  project: Promise<{ name: string } | null>;
  cycle: Promise<{ name: string } | null>;
  team: Promise<FakeTeam | null>;
  labels: () => Promise<{ nodes: Array<{ id: string; name: string }> }>;
  inverseRelations: () => Promise<{ nodes: never[] }>;
}

function makeFakeTeam(overrides: Partial<FakeTeam> & { id: string }): FakeTeam {
  return {
    key: "PRY",
    states: () => Promise.resolve({ nodes: [] }),
    ...overrides,
  };
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
    team: Promise.resolve(makeFakeTeam({ id: "team-1" })),
    labels: () => Promise.resolve({ nodes: [] }),
    inverseRelations: () => Promise.resolve({ nodes: [] }),
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

function buildFakeSdk(issuesById: Map<string, FakeIssue>) {
  return {
    issue: vi.fn((id: string) => {
      const found = issuesById.get(id);
      if (!found) throw new Error(`Fake SDK: issue ${id} not seeded`);
      return Promise.resolve(found);
    }),
    issues: vi.fn(),
    createComment: vi.fn().mockResolvedValue({}),
    updateIssue: vi.fn().mockResolvedValue({}),
    team: vi.fn(),
    issueLabels: vi.fn(),
    createIssueLabel: vi.fn(),
  };
}

type FakeSdk = ReturnType<typeof buildFakeSdk>;

function buildClient(): {
  client: RealLinearClient;
  sdk: FakeSdk;
  issuesById: Map<string, FakeIssue>;
  logger: ReturnType<typeof makeLogger>;
} {
  const issuesById = new Map<string, FakeIssue>();
  const logger = makeLogger();
  const client = new RealLinearClient("test-key", logger as never);
  const sdk = buildFakeSdk(issuesById);
  (client as unknown as { sdk: FakeSdk }).sdk = sdk;
  return { client, sdk, issuesById, logger };
}

describe("RealLinearClient.getIssue", () => {
  let client: RealLinearClient;
  let issuesById: Map<string, FakeIssue>;

  beforeEach(() => {
    ({ client, issuesById } = buildClient());
  });

  it("maps a fully populated issue", async () => {
    issuesById.set(
      "issue-1",
      makeFakeIssue({
        id: "issue-1",
        labels: () => Promise.resolve({ nodes: [{ id: "l1", name: "bug" }] }),
        project: Promise.resolve({ name: "Backend" }),
        cycle: Promise.resolve({ name: "Sprint 1" }),
      }),
    );

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

  it("defaults null description to empty string and missing state/project/team/cycle to safe fallbacks", async () => {
    issuesById.set(
      "issue-2",
      makeFakeIssue({
        id: "issue-2",
        description: null,
        state: Promise.resolve(null),
        project: Promise.resolve(null),
        cycle: Promise.resolve(null),
        team: Promise.resolve(null),
      }),
    );

    const result = await client.getIssue("issue-2");

    expect(result.description).toBe("");
    expect(result.state).toBe("Unknown");
    expect(result.project).toBeUndefined();
    expect(result.team).toBeUndefined();
    expect(result.cycle).toBeUndefined();
  });
});

describe("RealLinearClient.searchIssues", () => {
  let client: RealLinearClient;
  let sdk: FakeSdk;

  beforeEach(() => {
    ({ client, sdk } = buildClient());
  });

  it("builds a minimal filter (state only) and maps results", async () => {
    sdk.issues.mockResolvedValue({
      nodes: [
        makeFakeIssue({
          id: "r1",
          labels: () => Promise.resolve({ nodes: [{ id: "l1", name: "bug" }] }),
        }),
      ],
    });

    const results = await client.searchIssues({ state: "Todo" });

    expect(sdk.issues).toHaveBeenCalledWith({ filter: { state: { name: { eq: "Todo" } } } });
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ id: "r1", state: "Todo", labels: ["bug"], team: "PRY" });
  });

  it("adds project, assignee, and team clauses when provided", async () => {
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

  it("returns an empty array when the connection has no nodes", async () => {
    sdk.issues.mockResolvedValue({ nodes: undefined });
    const results = await client.searchIssues({ state: "Done" });
    expect(results).toEqual([]);
  });

  it("returns an empty array when the sdk returns a nullish connection", async () => {
    sdk.issues.mockResolvedValue(null);
    const results = await client.searchIssues({ state: "Done" });
    expect(results).toEqual([]);
  });
});

describe("RealLinearClient.postComment", () => {
  it("posts via the sdk", async () => {
    const { client, sdk } = buildClient();
    await client.postComment("issue-1", "hello");
    expect(sdk.createComment).toHaveBeenCalledWith({ issueId: "issue-1", body: "hello" });
  });
});

describe("RealLinearClient.updateIssueState", () => {
  let client: RealLinearClient;
  let sdk: FakeSdk;
  let issuesById: Map<string, FakeIssue>;
  let logger: ReturnType<typeof makeLogger>;

  beforeEach(() => {
    ({ client, sdk, issuesById, logger } = buildClient());
  });

  it("warns and does not update when the issue has no team", async () => {
    issuesById.set("issue-1", makeFakeIssue({ id: "issue-1", team: Promise.resolve(null) }));

    await client.updateIssueState("issue-1", "Done");

    expect(sdk.updateIssue).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalled();
  });

  it("warns and does not update when the state name cannot be resolved", async () => {
    issuesById.set("issue-1", makeFakeIssue({ id: "issue-1" }));
    sdk.team.mockResolvedValue(
      makeFakeTeam({ id: "team-1", states: () => Promise.resolve({ nodes: [] }) }),
    );

    await client.updateIssueState("issue-1", "Nonexistent");

    expect(sdk.updateIssue).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalled();
  });

  it("resolves the state id and updates the issue", async () => {
    issuesById.set("issue-1", makeFakeIssue({ id: "issue-1" }));
    sdk.team.mockResolvedValue(
      makeFakeTeam({
        id: "team-1",
        states: () => Promise.resolve({ nodes: [{ id: "state-done", name: "Done" }] }),
      }),
    );

    await client.updateIssueState("issue-1", "Done");

    expect(sdk.updateIssue).toHaveBeenCalledWith("issue-1", { stateId: "state-done" });
  });

  it("caches the team's state map across calls for the same team", async () => {
    issuesById.set("issue-1", makeFakeIssue({ id: "issue-1" }));
    issuesById.set("issue-2", makeFakeIssue({ id: "issue-2" }));
    sdk.team.mockResolvedValue(
      makeFakeTeam({
        id: "team-1",
        states: () =>
          Promise.resolve({
            nodes: [
              { id: "state-done", name: "Done" },
              { id: "state-todo", name: "Todo" },
            ],
          }),
      }),
    );

    await client.updateIssueState("issue-1", "Done");
    await client.updateIssueState("issue-2", "Todo");

    expect(sdk.team).toHaveBeenCalledTimes(1);
    expect(sdk.updateIssue).toHaveBeenNthCalledWith(1, "issue-1", { stateId: "state-done" });
    expect(sdk.updateIssue).toHaveBeenNthCalledWith(2, "issue-2", { stateId: "state-todo" });
  });
});

describe("RealLinearClient.addLabel", () => {
  let client: RealLinearClient;
  let sdk: FakeSdk;
  let issuesById: Map<string, FakeIssue>;

  beforeEach(() => {
    ({ client, sdk, issuesById } = buildClient());
  });

  it("reuses an existing label found via issueLabels and adds it to the issue", async () => {
    issuesById.set("issue-1", makeFakeIssue({ id: "issue-1", labelIds: ["existing-id"] }));
    sdk.issueLabels.mockResolvedValue({ nodes: [{ id: "label-urgent", name: "urgent" }] });

    await client.addLabel("issue-1", "urgent");

    expect(sdk.createIssueLabel).not.toHaveBeenCalled();
    expect(sdk.updateIssue).toHaveBeenCalledWith("issue-1", {
      labelIds: ["existing-id", "label-urgent"],
    });
  });

  it("creates a new label (scoped to the issue's team) when none exists", async () => {
    issuesById.set("issue-1", makeFakeIssue({ id: "issue-1", labelIds: [] }));
    sdk.issueLabels.mockResolvedValue({ nodes: [] });
    sdk.createIssueLabel.mockResolvedValue({
      issueLabel: Promise.resolve({ id: "label-new", name: "urgent" }),
    });

    await client.addLabel("issue-1", "urgent");

    expect(sdk.createIssueLabel).toHaveBeenCalledWith({ name: "urgent", teamId: "team-1" });
    expect(sdk.updateIssue).toHaveBeenCalledWith("issue-1", { labelIds: ["label-new"] });
  });

  it("creates a label with no teamId when the issue has no team", async () => {
    issuesById.set(
      "issue-1",
      makeFakeIssue({ id: "issue-1", labelIds: [], team: Promise.resolve(null) }),
    );
    sdk.issueLabels.mockResolvedValue({ nodes: [] });
    sdk.createIssueLabel.mockResolvedValue({
      issueLabel: Promise.resolve({ id: "label-new", name: "urgent" }),
    });

    await client.addLabel("issue-1", "urgent");

    expect(sdk.createIssueLabel).toHaveBeenCalledWith({ name: "urgent" });
  });

  it("throws when label creation returns no issueLabel", async () => {
    issuesById.set("issue-1", makeFakeIssue({ id: "issue-1", labelIds: [] }));
    sdk.issueLabels.mockResolvedValue({ nodes: [] });
    sdk.createIssueLabel.mockResolvedValue({ issueLabel: Promise.resolve(undefined) });

    await expect(client.addLabel("issue-1", "urgent")).rejects.toThrow(
      "Failed to create label: urgent",
    );
  });

  it("does not add a duplicate label id when the issue already has it", async () => {
    issuesById.set("issue-1", makeFakeIssue({ id: "issue-1", labelIds: ["label-urgent"] }));
    sdk.issueLabels.mockResolvedValue({ nodes: [{ id: "label-urgent", name: "urgent" }] });

    await client.addLabel("issue-1", "urgent");

    expect(sdk.updateIssue).not.toHaveBeenCalled();
  });

  it("uses the label cache on a second call instead of re-querying issueLabels", async () => {
    issuesById.set("issue-1", makeFakeIssue({ id: "issue-1", labelIds: [] }));
    issuesById.set("issue-2", makeFakeIssue({ id: "issue-2", labelIds: [] }));
    sdk.issueLabels.mockResolvedValue({ nodes: [{ id: "label-urgent", name: "urgent" }] });

    await client.addLabel("issue-1", "urgent");
    await client.addLabel("issue-2", "urgent");

    expect(sdk.issueLabels).toHaveBeenCalledTimes(1);
  });
});

describe("RealLinearClient.removeLabel", () => {
  let client: RealLinearClient;
  let sdk: FakeSdk;
  let issuesById: Map<string, FakeIssue>;

  beforeEach(() => {
    ({ client, sdk, issuesById } = buildClient());
  });

  it("removes a label found by looking up the issue's labels", async () => {
    issuesById.set(
      "issue-1",
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
    issuesById.set(
      "issue-1",
      makeFakeIssue({
        id: "issue-1",
        labelIds: ["label-bug"],
        labels: () => Promise.resolve({ nodes: [{ id: "label-bug", name: "bug" }] }),
      }),
    );

    await client.removeLabel("issue-1", "urgent");

    expect(sdk.updateIssue).not.toHaveBeenCalled();
  });

  it("uses the cached label id (populated by a prior listLabels call) without re-querying labels()", async () => {
    const labelsFn = vi
      .fn()
      .mockResolvedValue({ nodes: [{ id: "label-urgent", name: "urgent" }] });
    issuesById.set(
      "issue-1",
      makeFakeIssue({ id: "issue-1", labelIds: ["label-urgent"], labels: labelsFn }),
    );

    await client.listLabels("issue-1");
    labelsFn.mockClear();

    await client.removeLabel("issue-1", "urgent");

    expect(labelsFn).not.toHaveBeenCalled();
    expect(sdk.updateIssue).toHaveBeenCalledWith("issue-1", { labelIds: [] });
  });
});

describe("RealLinearClient.listLabels", () => {
  it("returns label names and populates the label cache as a side effect", async () => {
    const { client, sdk, issuesById } = buildClient();
    issuesById.set(
      "issue-1",
      makeFakeIssue({
        id: "issue-1",
        labelIds: ["label-a"],
        labels: () => Promise.resolve({ nodes: [{ id: "label-a", name: "alpha" }] }),
      }),
    );

    const labels = await client.listLabels("issue-1");
    expect(labels).toEqual(["alpha"]);

    // Second issue reuses the cache entry for the same label name.
    issuesById.set("issue-2", makeFakeIssue({ id: "issue-2", labelIds: [] }));
    sdk.issueLabels.mockResolvedValue({ nodes: [] });
    await client.addLabel("issue-2", "alpha");

    expect(sdk.issueLabels).not.toHaveBeenCalled();
  });

  it("returns an empty array when the issue has no labels", async () => {
    const { client, issuesById } = buildClient();
    issuesById.set("issue-1", makeFakeIssue({ id: "issue-1", labels: () => Promise.resolve({ nodes: [] }) }));

    await expect(client.listLabels("issue-1")).resolves.toEqual([]);
  });
});
