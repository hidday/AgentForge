import { describe, it, expect, vi, beforeEach } from "vitest";
import { RealLinearClient } from "../../src/linear/realLinearClient.js";

function makeLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
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
  team: Promise<{ id: string; key: string } | null>;
  labels: () => Promise<{ nodes: Array<{ id: string; name: string }> }>;
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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function injectSdk(client: RealLinearClient, sdk: Record<string, any>): void {
  (client as unknown as { sdk: unknown }).sdk = sdk;
}

describe("RealLinearClient.getIssue", () => {
  let client: RealLinearClient;

  beforeEach(() => {
    client = new RealLinearClient("test-key", makeLogger() as never);
  });

  it("maps all fields, including project/team/cycle names, when present", async () => {
    const issue = makeFakeIssue({
      id: "issue-1",
      identifier: "PRY-1",
      title: "Do the thing",
      description: "Details",
      branchName: "ai/issue-1",
      priority: 2,
      url: "https://linear.app/x/PRY-1",
      state: Promise.resolve({ id: "s1", name: "In Progress" }),
      project: Promise.resolve({ name: "Alpha" }),
      cycle: Promise.resolve({ name: "Cycle 3" }),
      team: Promise.resolve({ id: "t1", key: "PRY" }),
      labels: () => Promise.resolve({ nodes: [{ id: "l1", name: "bug" }] }),
    });
    injectSdk(client, { issue: () => Promise.resolve(issue) });

    const result = await client.getIssue("issue-1");

    expect(result).toEqual({
      id: "issue-1",
      identifier: "PRY-1",
      title: "Do the thing",
      description: "Details",
      branchName: "ai/issue-1",
      state: "In Progress",
      labels: ["bug"],
      priority: 2,
      url: "https://linear.app/x/PRY-1",
      project: "Alpha",
      team: "PRY",
      cycle: "Cycle 3",
    });
  });

  it("falls back to 'Unknown' state, empty description, and undefined project/team/cycle when absent", async () => {
    const issue = makeFakeIssue({
      id: "issue-2",
      description: null,
      state: Promise.resolve(null),
      project: Promise.resolve(null),
      cycle: Promise.resolve(null),
      team: Promise.resolve(null),
      labels: () => Promise.resolve({ nodes: [] }),
    });
    injectSdk(client, { issue: () => Promise.resolve(issue) });

    const result = await client.getIssue("issue-2");

    expect(result.state).toBe("Unknown");
    expect(result.description).toBe("");
    expect(result.project).toBeUndefined();
    expect(result.team).toBeUndefined();
    expect(result.cycle).toBeUndefined();
  });

  it("defaults labels to an empty array when the labels connection is nullish", async () => {
    const issue = makeFakeIssue({
      id: "issue-3",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      labels: () => Promise.resolve({ nodes: undefined }) as any,
    });
    injectSdk(client, { issue: () => Promise.resolve(issue) });

    const result = await client.getIssue("issue-3");
    expect(result.labels).toEqual([]);
  });
});

describe("RealLinearClient.searchIssues", () => {
  let client: RealLinearClient;

  beforeEach(() => {
    client = new RealLinearClient("test-key", makeLogger() as never);
  });

  it("builds a filter from state alone and maps results", async () => {
    const issuesFn = vi.fn().mockResolvedValue({
      nodes: [
        makeFakeIssue({
          id: "i1",
          identifier: "PRY-10",
          labels: () => Promise.resolve({ nodes: [{ id: "l1", name: "infra" }] }),
          project: Promise.resolve({ name: "Alpha" }),
          cycle: Promise.resolve({ name: "C1" }),
          team: Promise.resolve({ id: "t1", key: "PRY" }),
        }),
      ],
    });
    injectSdk(client, { issues: issuesFn });

    const results = await client.searchIssues({ state: "Todo" });

    expect(issuesFn).toHaveBeenCalledWith({ filter: { state: { name: { eq: "Todo" } } } });
    expect(results).toEqual([
      {
        id: "i1",
        identifier: "PRY-10",
        title: "Issue title",
        description: "Issue description",
        branchName: "ai/issue-1",
        state: "Todo",
        labels: ["infra"],
        priority: 0,
        url: "https://linear.app/team/issue/PRY-1",
        project: "Alpha",
        team: "PRY",
        cycle: "C1",
      },
    ]);
  });

  it("adds project, assigneeMe, and team clauses to the filter when provided", async () => {
    const issuesFn = vi.fn().mockResolvedValue({ nodes: [] });
    injectSdk(client, { issues: issuesFn });

    await client.searchIssues({
      state: "Todo",
      projectName: "Alpha",
      assigneeMe: true,
      team: "PRY",
    });

    expect(issuesFn).toHaveBeenCalledWith({
      filter: {
        state: { name: { eq: "Todo" } },
        project: { name: { eq: "Alpha" } },
        assignee: { isMe: { eq: true } },
        team: { or: [{ name: { eq: "PRY" } }, { key: { eq: "PRY" } }] },
      },
    });
  });

  it("returns an empty array when the issues connection has no nodes", async () => {
    injectSdk(client, { issues: vi.fn().mockResolvedValue({ nodes: undefined }) });
    const results = await client.searchIssues({ state: "Todo" });
    expect(results).toEqual([]);
  });

  it("defaults labels to an empty array per-issue when the labels connection is nullish", async () => {
    injectSdk(client, {
      issues: vi.fn().mockResolvedValue({
        nodes: [
          makeFakeIssue({
            id: "i2",
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            labels: () => Promise.resolve({ nodes: undefined }) as any,
          }),
        ],
      }),
    });
    const results = await client.searchIssues({ state: "Todo" });
    expect(results[0]!.labels).toEqual([]);
  });
});

describe("RealLinearClient.postComment", () => {
  it("creates a comment via the SDK", async () => {
    const client = new RealLinearClient("test-key", makeLogger() as never);
    const createComment = vi.fn().mockResolvedValue(undefined);
    injectSdk(client, { createComment });

    await client.postComment("issue-1", "hello world");

    expect(createComment).toHaveBeenCalledWith({ issueId: "issue-1", body: "hello world" });
  });
});

describe("RealLinearClient.updateIssueState", () => {
  let client: RealLinearClient;

  beforeEach(() => {
    client = new RealLinearClient("test-key", makeLogger() as never);
  });

  it("resolves the state id via the team's workflow states and updates the issue", async () => {
    const updateIssue = vi.fn().mockResolvedValue(undefined);
    const statesFn = vi.fn().mockResolvedValue({
      nodes: [
        { id: "s-todo", name: "Todo" },
        { id: "s-progress", name: "In Progress" },
      ],
    });
    injectSdk(client, {
      issue: () =>
        Promise.resolve(makeFakeIssue({ id: "issue-1", team: Promise.resolve({ id: "team-1", key: "PRY" }) })),
      team: vi.fn().mockResolvedValue({ states: statesFn }),
      updateIssue,
    });

    await client.updateIssueState("issue-1", "In Progress");

    expect(updateIssue).toHaveBeenCalledWith("issue-1", { stateId: "s-progress" });
  });

  it("caches the resolved state map per team across calls", async () => {
    const updateIssue = vi.fn().mockResolvedValue(undefined);
    const statesFn = vi.fn().mockResolvedValue({ nodes: [{ id: "s-todo", name: "Todo" }] });
    const teamFn = vi.fn().mockResolvedValue({ states: statesFn });
    injectSdk(client, {
      issue: () =>
        Promise.resolve(makeFakeIssue({ id: "issue-1", team: Promise.resolve({ id: "team-1", key: "PRY" }) })),
      team: teamFn,
      updateIssue,
    });

    await client.updateIssueState("issue-1", "Todo");
    await client.updateIssueState("issue-1", "Todo");

    expect(teamFn).toHaveBeenCalledTimes(1);
  });

  it("logs a warning and returns without updating when the issue has no team", async () => {
    const logger = makeLogger();
    client = new RealLinearClient("test-key", logger as never);
    const updateIssue = vi.fn();
    injectSdk(client, {
      issue: () => Promise.resolve(makeFakeIssue({ id: "issue-1", team: Promise.resolve(null) })),
      updateIssue,
    });

    await client.updateIssueState("issue-1", "Todo");

    expect(updateIssue).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(
      { issueId: "issue-1" },
      "Cannot update state: issue has no team",
    );
  });

  it("logs a warning and returns without updating when the state name has no matching workflow state", async () => {
    const logger = makeLogger();
    client = new RealLinearClient("test-key", logger as never);
    const updateIssue = vi.fn();
    injectSdk(client, {
      issue: () =>
        Promise.resolve(makeFakeIssue({ id: "issue-1", team: Promise.resolve({ id: "team-1", key: "PRY" }) })),
      team: vi.fn().mockResolvedValue({ states: () => Promise.resolve({ nodes: [] }) }),
      updateIssue,
    });

    await client.updateIssueState("issue-1", "Nonexistent State");

    expect(updateIssue).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(
      { issueId: "issue-1", stateName: "Nonexistent State", teamId: "team-1" },
      "Could not find workflow state by name",
    );
  });

  it("treats a nullish states connection as having no states", async () => {
    const updateIssue = vi.fn();
    injectSdk(client, {
      issue: () =>
        Promise.resolve(makeFakeIssue({ id: "issue-1", team: Promise.resolve({ id: "team-1", key: "PRY" }) })),
      team: vi.fn().mockResolvedValue({ states: () => Promise.resolve({ nodes: undefined }) }),
      updateIssue,
    });

    await client.updateIssueState("issue-1", "Todo");
    expect(updateIssue).not.toHaveBeenCalled();
  });
});

describe("RealLinearClient.addLabel", () => {
  let client: RealLinearClient;

  beforeEach(() => {
    client = new RealLinearClient("test-key", makeLogger() as never);
  });

  it("finds and reuses an existing label, then adds it to the issue's labelIds", async () => {
    const updateIssue = vi.fn().mockResolvedValue(undefined);
    const issueLabels = vi.fn().mockResolvedValue({ nodes: [{ id: "label-1", name: "ai:planning" }] });
    injectSdk(client, {
      issue: () =>
        Promise.resolve(
          makeFakeIssue({ id: "issue-1", labelIds: ["other"], team: Promise.resolve({ id: "t1", key: "PRY" }) }),
        ),
      issueLabels,
      updateIssue,
    });

    await client.addLabel("issue-1", "ai:planning");

    expect(issueLabels).toHaveBeenCalledWith({ filter: { name: { eq: "ai:planning" } } });
    expect(updateIssue).toHaveBeenCalledWith("issue-1", { labelIds: ["other", "label-1"] });
  });

  it("creates a new label (scoped to the issue's team) when none exists yet", async () => {
    const updateIssue = vi.fn().mockResolvedValue(undefined);
    const createIssueLabel = vi.fn().mockResolvedValue({
      issueLabel: Promise.resolve({ id: "label-new" }),
    });
    injectSdk(client, {
      issue: () =>
        Promise.resolve(
          makeFakeIssue({ id: "issue-1", labelIds: [], team: Promise.resolve({ id: "team-9", key: "PRY" }) }),
        ),
      issueLabels: vi.fn().mockResolvedValue({ nodes: [] }),
      createIssueLabel,
      updateIssue,
    });

    await client.addLabel("issue-1", "ai:new-label");

    expect(createIssueLabel).toHaveBeenCalledWith({ name: "ai:new-label", teamId: "team-9" });
    expect(updateIssue).toHaveBeenCalledWith("issue-1", { labelIds: ["label-new"] });
  });

  it("creates a label without a teamId when the issue has no team", async () => {
    const createIssueLabel = vi.fn().mockResolvedValue({
      issueLabel: Promise.resolve({ id: "label-new" }),
    });
    injectSdk(client, {
      issue: () => Promise.resolve(makeFakeIssue({ id: "issue-1", labelIds: [], team: Promise.resolve(null) })),
      issueLabels: vi.fn().mockResolvedValue({ nodes: [] }),
      createIssueLabel,
      updateIssue: vi.fn().mockResolvedValue(undefined),
    });

    await client.addLabel("issue-1", "ai:new-label");

    expect(createIssueLabel).toHaveBeenCalledWith({ name: "ai:new-label" });
  });

  it("throws when label creation succeeds at the API layer but returns no issueLabel", async () => {
    injectSdk(client, {
      issue: () =>
        Promise.resolve(
          makeFakeIssue({ id: "issue-1", labelIds: [], team: Promise.resolve({ id: "t1", key: "PRY" }) }),
        ),
      issueLabels: vi.fn().mockResolvedValue({ nodes: [] }),
      createIssueLabel: vi.fn().mockResolvedValue({ issueLabel: Promise.resolve(null) }),
    });

    await expect(client.addLabel("issue-1", "ai:broken")).rejects.toThrow(
      "Failed to create label: ai:broken",
    );
  });

  it("does not duplicate a label already present on the issue's labelIds", async () => {
    const updateIssue = vi.fn();
    injectSdk(client, {
      issue: () =>
        Promise.resolve(
          makeFakeIssue({
            id: "issue-1",
            labelIds: ["label-1"],
            team: Promise.resolve({ id: "t1", key: "PRY" }),
          }),
        ),
      issueLabels: vi.fn().mockResolvedValue({ nodes: [{ id: "label-1", name: "ai:planning" }] }),
      updateIssue,
    });

    await client.addLabel("issue-1", "ai:planning");

    expect(updateIssue).not.toHaveBeenCalled();
  });

  it("caches the resolved label id across repeated addLabel calls for the same name", async () => {
    const updateIssue = vi.fn().mockResolvedValue(undefined);
    const issueLabels = vi.fn().mockResolvedValue({ nodes: [{ id: "label-1", name: "ai:planning" }] });
    injectSdk(client, {
      issue: () =>
        Promise.resolve(
          makeFakeIssue({ id: "issue-1", labelIds: [], team: Promise.resolve({ id: "t1", key: "PRY" }) }),
        ),
      issueLabels,
      updateIssue,
    });

    await client.addLabel("issue-1", "ai:planning");
    await client.addLabel("issue-1", "ai:planning");

    expect(issueLabels).toHaveBeenCalledTimes(1);
  });

  it("defaults to an empty nodes list when issueLabels returns a nullish connection", async () => {
    const createIssueLabel = vi.fn().mockResolvedValue({
      issueLabel: Promise.resolve({ id: "label-new" }),
    });
    injectSdk(client, {
      issue: () =>
        Promise.resolve(
          makeFakeIssue({ id: "issue-1", labelIds: [], team: Promise.resolve({ id: "t1", key: "PRY" }) }),
        ),
      issueLabels: vi.fn().mockResolvedValue({ nodes: undefined }),
      createIssueLabel,
      updateIssue: vi.fn().mockResolvedValue(undefined),
    });

    await client.addLabel("issue-1", "ai:new-label");
    expect(createIssueLabel).toHaveBeenCalled();
  });
});

describe("RealLinearClient.removeLabel", () => {
  let client: RealLinearClient;

  beforeEach(() => {
    client = new RealLinearClient("test-key", makeLogger() as never);
  });

  it("looks up the label id from the issue's labels when not cached, then removes it", async () => {
    const updateIssue = vi.fn().mockResolvedValue(undefined);
    injectSdk(client, {
      issue: () =>
        Promise.resolve(
          makeFakeIssue({
            id: "issue-1",
            labelIds: ["label-1", "label-2"],
            labels: () => Promise.resolve({ nodes: [{ id: "label-1", name: "ai:planning" }] }),
          }),
        ),
      updateIssue,
    });

    await client.removeLabel("issue-1", "ai:planning");

    expect(updateIssue).toHaveBeenCalledWith("issue-1", { labelIds: ["label-2"] });
  });

  it("is a no-op when the named label is not present on the issue", async () => {
    const updateIssue = vi.fn();
    injectSdk(client, {
      issue: () =>
        Promise.resolve(
          makeFakeIssue({
            id: "issue-1",
            labelIds: ["label-2"],
            labels: () => Promise.resolve({ nodes: [] }),
          }),
        ),
      updateIssue,
    });

    await client.removeLabel("issue-1", "ai:missing");

    expect(updateIssue).not.toHaveBeenCalled();
  });

  it("uses the cached label id on a second call without re-querying labels", async () => {
    const updateIssue = vi.fn().mockResolvedValue(undefined);
    const labelsFn = vi.fn().mockResolvedValue({ nodes: [{ id: "label-1", name: "ai:planning" }] });
    injectSdk(client, {
      issue: () =>
        Promise.resolve(
          makeFakeIssue({ id: "issue-1", labelIds: ["label-1"], labels: labelsFn }),
        ),
      updateIssue,
    });

    await client.removeLabel("issue-1", "ai:planning");
    await client.removeLabel("issue-1", "ai:planning");

    expect(labelsFn).toHaveBeenCalledTimes(1);
    expect(updateIssue).toHaveBeenCalledTimes(2);
  });
});

describe("RealLinearClient.listLabels", () => {
  it("returns label names and populates the label cache as a side effect", async () => {
    const client = new RealLinearClient("test-key", makeLogger() as never);
    const updateIssue = vi.fn().mockResolvedValue(undefined);
    injectSdk(client, {
      issue: () =>
        Promise.resolve(
          makeFakeIssue({
            id: "issue-1",
            labelIds: ["label-1"],
            labels: () => Promise.resolve({ nodes: [{ id: "label-1", name: "ai:planning" }] }),
          }),
        ),
      updateIssue,
    });

    const names = await client.listLabels("issue-1");
    expect(names).toEqual(["ai:planning"]);

    // Cache populated by listLabels should be reused by a subsequent removeLabel
    // without re-fetching the issue's labels connection.
    await client.removeLabel("issue-1", "ai:planning");
    expect(updateIssue).toHaveBeenCalledWith("issue-1", { labelIds: [] });
  });

  it("returns an empty array when the labels connection is nullish", async () => {
    const client = new RealLinearClient("test-key", makeLogger() as never);
    injectSdk(client, {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      issue: () => Promise.resolve(makeFakeIssue({ id: "issue-1", labels: () => Promise.resolve({ nodes: undefined }) as any })),
    });

    expect(await client.listLabels("issue-1")).toEqual([]);
  });
});
