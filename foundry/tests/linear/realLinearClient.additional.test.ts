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

// Minimal shape of the parts of the Linear SDK this client touches. Kept
// loose (any-ish) to match the fake-SDK-injection pattern used elsewhere in
// this test suite (see realLinearClient.relatedContext.test.ts).
interface FakeSdk {
  issue: (id: string) => Promise<FakeIssue>;
  issues: (args: unknown) => Promise<{ nodes: FakeIssue[] } | null>;
  createComment: (args: { issueId: string; body: string }) => Promise<unknown>;
  updateIssue: (id: string, patch: Record<string, unknown>) => Promise<unknown>;
  team: (id: string) => Promise<{ states: () => Promise<{ nodes: Array<{ id: string; name: string }> } | null> }>;
  issueLabels: (args: unknown) => Promise<{ nodes: Array<{ id: string; name: string }> } | null>;
  createIssueLabel: (args: unknown) => Promise<{ issueLabel: Promise<{ id: string } | null> }>;
}

function makeClient(sdk: Partial<FakeSdk>) {
  const logger = makeLogger();
  const client = new RealLinearClient("test-key", logger as never);
  (client as unknown as { sdk: FakeSdk }).sdk = sdk as FakeSdk;
  return { client, logger };
}

describe("RealLinearClient.getIssue", () => {
  it("maps all fields when present", async () => {
    const issue = makeFakeIssue({
      id: "i1",
      identifier: "PRY-5",
      title: "Do the thing",
      description: "Details",
      branchName: "ai/i1",
      priority: 2,
      url: "https://linear.app/x",
      state: Promise.resolve({ id: "s1", name: "In Progress" }),
      project: Promise.resolve({ name: "Project X" }),
      cycle: Promise.resolve({ name: "Cycle 3" }),
      team: Promise.resolve({ id: "t1", key: "PRY" }),
      labels: () => Promise.resolve({ nodes: [{ id: "l1", name: "bug" }] }),
    });
    const { client } = makeClient({ issue: () => Promise.resolve(issue) });

    const result = await client.getIssue("i1");

    expect(result).toEqual({
      id: "i1",
      identifier: "PRY-5",
      title: "Do the thing",
      description: "Details",
      branchName: "ai/i1",
      state: "In Progress",
      labels: ["bug"],
      priority: 2,
      url: "https://linear.app/x",
      project: "Project X",
      team: "PRY",
      cycle: "Cycle 3",
    });
  });

  it("falls back to defaults when optional fields are null/missing", async () => {
    const issue = makeFakeIssue({
      id: "i2",
      description: null,
      state: Promise.resolve(null),
      project: Promise.resolve(null),
      cycle: Promise.resolve(null),
      team: Promise.resolve(null),
      labels: () => Promise.resolve(null),
    });
    const { client } = makeClient({ issue: () => Promise.resolve(issue) });

    const result = await client.getIssue("i2");

    expect(result.description).toBe("");
    expect(result.state).toBe("Unknown");
    expect(result.project).toBeUndefined();
    expect(result.team).toBeUndefined();
    expect(result.cycle).toBeUndefined();
    expect(result.labels).toEqual([]);
  });
});

describe("RealLinearClient.searchIssues", () => {
  it("builds a filter with only state when no optional filters are set", async () => {
    const issuesSpy = vi.fn().mockResolvedValue({ nodes: [] });
    const { client } = makeClient({ issues: issuesSpy });

    await client.searchIssues({ state: "Todo" });

    expect(issuesSpy).toHaveBeenCalledWith({ filter: { state: { name: { eq: "Todo" } } } });
  });

  it("adds project, assignee, and team clauses when provided", async () => {
    const issuesSpy = vi.fn().mockResolvedValue({ nodes: [] });
    const { client } = makeClient({ issues: issuesSpy });

    await client.searchIssues({
      state: "Todo",
      projectName: "Proj",
      assigneeMe: true,
      team: "PRY",
    });

    expect(issuesSpy).toHaveBeenCalledWith({
      filter: {
        state: { name: { eq: "Todo" } },
        project: { name: { eq: "Proj" } },
        assignee: { isMe: { eq: true } },
        team: { or: [{ name: { eq: "PRY" } }, { key: { eq: "PRY" } }] },
      },
    });
  });

  it("maps returned issues, using the requested state name for each result", async () => {
    const issue = makeFakeIssue({
      id: "i1",
      identifier: "PRY-1",
      labels: () => Promise.resolve({ nodes: [{ id: "l1", name: "bug" }] }),
      project: Promise.resolve({ name: "Proj" }),
      team: Promise.resolve({ id: "t1", key: "PRY" }),
    });
    const { client } = makeClient({
      issues: vi.fn().mockResolvedValue({ nodes: [issue] }),
    });

    const results = await client.searchIssues({ state: "In Progress" });

    expect(results).toHaveLength(1);
    expect(results[0]).toEqual({
      id: "i1",
      identifier: "PRY-1",
      title: "Issue title",
      description: "Issue description",
      branchName: "ai/issue-1",
      state: "In Progress",
      labels: ["bug"],
      priority: 0,
      url: "https://linear.app/team/issue/PRY-1",
      project: "Proj",
      team: "PRY",
      cycle: undefined,
    });
  });

  it("returns an empty array when the SDK returns no nodes", async () => {
    const { client } = makeClient({ issues: vi.fn().mockResolvedValue(null) });

    const results = await client.searchIssues({ state: "Todo" });

    expect(results).toEqual([]);
  });
});

describe("RealLinearClient.postComment", () => {
  it("creates a comment via the SDK", async () => {
    const createComment = vi.fn().mockResolvedValue({});
    const { client } = makeClient({ createComment });

    await client.postComment("issue-1", "hello world");

    expect(createComment).toHaveBeenCalledWith({ issueId: "issue-1", body: "hello world" });
  });
});

describe("RealLinearClient.updateIssueState", () => {
  it("warns and does nothing when the issue has no team", async () => {
    const issue = makeFakeIssue({ id: "i1", team: Promise.resolve(null) });
    const updateIssue = vi.fn();
    const { client, logger } = makeClient({ issue: () => Promise.resolve(issue), updateIssue });

    await client.updateIssueState("i1", "Done");

    expect(updateIssue).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith({ issueId: "i1" }, "Cannot update state: issue has no team");
  });

  it("warns and does nothing when the state name cannot be resolved", async () => {
    const issue = makeFakeIssue({ id: "i1", team: Promise.resolve({ id: "t1", key: "PRY" }) });
    const teamStates = vi.fn().mockResolvedValue({ nodes: [{ id: "s1", name: "Todo" }] });
    const updateIssue = vi.fn();
    const { client, logger } = makeClient({
      issue: () => Promise.resolve(issue),
      updateIssue,
      team: () => Promise.resolve({ states: teamStates }),
    });

    await client.updateIssueState("i1", "Nonexistent State");

    expect(updateIssue).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(
      { issueId: "i1", stateName: "Nonexistent State", teamId: "t1" },
      "Could not find workflow state by name",
    );
  });

  it("resolves the state id and updates the issue", async () => {
    const issue = makeFakeIssue({ id: "i1", team: Promise.resolve({ id: "t1", key: "PRY" }) });
    const teamStates = vi.fn().mockResolvedValue({
      nodes: [
        { id: "s1", name: "Todo" },
        { id: "s2", name: "Done" },
      ],
    });
    const updateIssue = vi.fn().mockResolvedValue({});
    const { client } = makeClient({
      issue: () => Promise.resolve(issue),
      updateIssue,
      team: () => Promise.resolve({ states: teamStates }),
    });

    await client.updateIssueState("i1", "Done");

    expect(updateIssue).toHaveBeenCalledWith("i1", { stateId: "s2" });
  });

  it("caches resolved states per team, avoiding a second team() lookup", async () => {
    const issue = makeFakeIssue({ id: "i1", team: Promise.resolve({ id: "t1", key: "PRY" }) });
    const teamStates = vi.fn().mockResolvedValue({
      nodes: [
        { id: "s1", name: "Todo" },
        { id: "s2", name: "Done" },
      ],
    });
    const teamFn = vi.fn().mockResolvedValue({ states: teamStates });
    const updateIssue = vi.fn().mockResolvedValue({});
    const { client } = makeClient({
      issue: () => Promise.resolve(issue),
      updateIssue,
      team: teamFn,
    });

    await client.updateIssueState("i1", "Todo");
    await client.updateIssueState("i1", "Done");

    expect(teamFn).toHaveBeenCalledTimes(1);
    expect(updateIssue).toHaveBeenNthCalledWith(1, "i1", { stateId: "s1" });
    expect(updateIssue).toHaveBeenNthCalledWith(2, "i1", { stateId: "s2" });
  });
});

describe("RealLinearClient.addLabel", () => {
  it("creates a new label when none exists, and adds it to the issue", async () => {
    const issue = makeFakeIssue({
      id: "i1",
      labelIds: [],
      team: Promise.resolve({ id: "t1", key: "PRY" }),
    });
    const issueLabels = vi.fn().mockResolvedValue({ nodes: [] });
    const createIssueLabel = vi
      .fn()
      .mockResolvedValue({ issueLabel: Promise.resolve({ id: "label-new" }) });
    const updateIssue = vi.fn().mockResolvedValue({});
    const { client, logger } = makeClient({
      issue: () => Promise.resolve(issue),
      issueLabels,
      createIssueLabel,
      updateIssue,
    });

    await client.addLabel("i1", "ai:planning");

    expect(createIssueLabel).toHaveBeenCalledWith({ name: "ai:planning", teamId: "t1" });
    expect(updateIssue).toHaveBeenCalledWith("i1", { labelIds: ["label-new"] });
    expect(logger.info).toHaveBeenCalledWith(
      { labelName: "ai:planning", labelId: "label-new" },
      "Created new Linear label",
    );
  });

  it("reuses an existing label found by name instead of creating one", async () => {
    const issue = makeFakeIssue({ id: "i1", labelIds: [] });
    const issueLabels = vi.fn().mockResolvedValue({ nodes: [{ id: "label-existing", name: "ai:done" }] });
    const createIssueLabel = vi.fn();
    const updateIssue = vi.fn().mockResolvedValue({});
    const { client } = makeClient({
      issue: () => Promise.resolve(issue),
      issueLabels,
      createIssueLabel,
      updateIssue,
    });

    await client.addLabel("i1", "ai:done");

    expect(createIssueLabel).not.toHaveBeenCalled();
    expect(updateIssue).toHaveBeenCalledWith("i1", { labelIds: ["label-existing"] });
  });

  it("does not duplicate the label id when the issue already has it", async () => {
    const issue = makeFakeIssue({ id: "i1", labelIds: ["label-existing"] });
    const issueLabels = vi.fn().mockResolvedValue({ nodes: [{ id: "label-existing", name: "ai:done" }] });
    const updateIssue = vi.fn();
    const { client } = makeClient({
      issue: () => Promise.resolve(issue),
      issueLabels,
      updateIssue,
    });

    await client.addLabel("i1", "ai:done");

    expect(updateIssue).not.toHaveBeenCalled();
  });

  it("uses the cached label id on a second call without re-querying", async () => {
    const issue = makeFakeIssue({ id: "i1", labelIds: [] });
    const issueLabels = vi.fn().mockResolvedValue({ nodes: [{ id: "label-x", name: "ai:x" }] });
    const updateIssue = vi.fn().mockResolvedValue({});
    const { client } = makeClient({
      issue: () => Promise.resolve(issue),
      issueLabels,
      updateIssue,
    });

    await client.addLabel("i1", "ai:x");
    await client.addLabel("i1", "ai:x");

    expect(issueLabels).toHaveBeenCalledTimes(1);
  });

  it("throws when label creation returns no issueLabel", async () => {
    const issue = makeFakeIssue({ id: "i1", labelIds: [], team: Promise.resolve(null) });
    const issueLabels = vi.fn().mockResolvedValue({ nodes: [] });
    const createIssueLabel = vi.fn().mockResolvedValue({ issueLabel: Promise.resolve(null) });
    const { client } = makeClient({
      issue: () => Promise.resolve(issue),
      issueLabels,
      createIssueLabel,
    });

    await expect(client.addLabel("i1", "ai:broken")).rejects.toThrow(
      "Failed to create label: ai:broken",
    );
  });

  it("omits teamId when the issue has no team", async () => {
    const issue = makeFakeIssue({ id: "i1", labelIds: [], team: Promise.resolve(null) });
    const issueLabels = vi.fn().mockResolvedValue({ nodes: [] });
    const createIssueLabel = vi
      .fn()
      .mockResolvedValue({ issueLabel: Promise.resolve({ id: "label-new" }) });
    const updateIssue = vi.fn().mockResolvedValue({});
    const { client } = makeClient({
      issue: () => Promise.resolve(issue),
      issueLabels,
      createIssueLabel,
      updateIssue,
    });

    await client.addLabel("i1", "ai:no-team");

    expect(createIssueLabel).toHaveBeenCalledWith({ name: "ai:no-team" });
  });
});

describe("RealLinearClient.removeLabel", () => {
  it("removes a label using the cache when available", async () => {
    const issue1 = makeFakeIssue({
      id: "i1",
      labelIds: ["label-x"],
      labels: () => Promise.resolve({ nodes: [{ id: "label-x", name: "ai:x" }] }),
    });
    const updateIssue = vi.fn().mockResolvedValue({});
    const { client } = makeClient({
      issue: () => Promise.resolve(issue1),
      updateIssue,
    });

    // Prime the cache via listLabels.
    await client.listLabels("i1");
    await client.removeLabel("i1", "ai:x");

    expect(updateIssue).toHaveBeenCalledWith("i1", { labelIds: [] });
  });

  it("looks up the label by name when not cached, and removes it", async () => {
    const issue = makeFakeIssue({
      id: "i1",
      labelIds: ["label-y", "label-z"],
      labels: () => Promise.resolve({ nodes: [{ id: "label-y", name: "ai:y" }] }),
    });
    const updateIssue = vi.fn().mockResolvedValue({});
    const { client } = makeClient({
      issue: () => Promise.resolve(issue),
      updateIssue,
    });

    await client.removeLabel("i1", "ai:y");

    expect(updateIssue).toHaveBeenCalledWith("i1", { labelIds: ["label-z"] });
  });

  it("does nothing when the label is not found on the issue", async () => {
    const issue = makeFakeIssue({
      id: "i1",
      labelIds: ["label-z"],
      labels: () => Promise.resolve({ nodes: [{ id: "label-z", name: "ai:z" }] }),
    });
    const updateIssue = vi.fn();
    const { client } = makeClient({
      issue: () => Promise.resolve(issue),
      updateIssue,
    });

    await client.removeLabel("i1", "ai:not-present");

    expect(updateIssue).not.toHaveBeenCalled();
  });
});

describe("RealLinearClient.listLabels", () => {
  it("returns label names and populates the label cache", async () => {
    const issue = makeFakeIssue({
      id: "i1",
      labels: () =>
        Promise.resolve({
          nodes: [
            { id: "l1", name: "ai:planning" },
            { id: "l2", name: "ai:done" },
          ],
        }),
    });
    const { client } = makeClient({ issue: () => Promise.resolve(issue) });

    const names = await client.listLabels("i1");

    expect(names).toEqual(["ai:planning", "ai:done"]);
  });

  it("returns an empty array when the issue has no labels", async () => {
    const issue = makeFakeIssue({ id: "i1", labels: () => Promise.resolve(null) });
    const { client } = makeClient({ issue: () => Promise.resolve(issue) });

    await expect(client.listLabels("i1")).resolves.toEqual([]);
  });
});
