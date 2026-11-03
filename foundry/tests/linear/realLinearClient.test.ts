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

function makeClient() {
  const logger = makeLogger();
  const client = new RealLinearClient("test-key", logger as never);
  return { client, logger };
}

function injectSdk(client: RealLinearClient, sdk: Record<string, unknown>) {
  (client as unknown as { sdk: Record<string, unknown> }).sdk = sdk;
}

describe("RealLinearClient.getIssue", () => {
  it("maps all fields from the SDK issue, including related entities", async () => {
    const { client } = makeClient();
    const issue = makeFakeIssue({
      id: "issue-1",
      identifier: "PRY-42",
      title: "Do the thing",
      description: "Some description",
      priority: 2,
      url: "https://linear.app/team/issue/PRY-42",
      labels: () => Promise.resolve({ nodes: [{ id: "l1", name: "bug" }] }),
      state: Promise.resolve({ id: "s1", name: "In Progress" }),
      project: Promise.resolve({ name: "Project X" }),
      cycle: Promise.resolve({ name: "Cycle 5" }),
      team: Promise.resolve({ id: "t1", key: "PRY" }),
    });
    injectSdk(client, { issue: vi.fn().mockResolvedValue(issue) });

    const result = await client.getIssue("issue-1");

    expect(result).toEqual({
      id: "issue-1",
      identifier: "PRY-42",
      title: "Do the thing",
      description: "Some description",
      branchName: "ai/issue-1",
      state: "In Progress",
      labels: ["bug"],
      priority: 2,
      url: "https://linear.app/team/issue/PRY-42",
      project: "Project X",
      team: "PRY",
      cycle: "Cycle 5",
    });
  });

  it("falls back to defaults when optional fields are missing", async () => {
    const { client } = makeClient();
    const issue = makeFakeIssue({
      id: "issue-1",
      description: null,
      state: Promise.resolve(null),
      project: Promise.resolve(null),
      cycle: Promise.resolve(null),
      team: Promise.resolve(null),
      labels: () => Promise.resolve(null),
    });
    injectSdk(client, { issue: vi.fn().mockResolvedValue(issue) });

    const result = await client.getIssue("issue-1");

    expect(result.description).toBe("");
    expect(result.state).toBe("Unknown");
    expect(result.project).toBeUndefined();
    expect(result.cycle).toBeUndefined();
    expect(result.team).toBeUndefined();
    expect(result.labels).toEqual([]);
  });

  it("propagates errors from the SDK (e.g. network failure)", async () => {
    const { client } = makeClient();
    injectSdk(client, { issue: vi.fn().mockRejectedValue(new Error("network error")) });

    await expect(client.getIssue("issue-1")).rejects.toThrow("network error");
  });
});

describe("RealLinearClient.searchIssues", () => {
  it("builds a GraphQL filter from all provided criteria and maps results", async () => {
    const { client, logger } = makeClient();
    const issue = makeFakeIssue({
      id: "issue-1",
      labels: () => Promise.resolve({ nodes: [{ id: "l1", name: "bug" }] }),
      project: Promise.resolve({ name: "Project X" }),
      cycle: Promise.resolve({ name: "Cycle 5" }),
      team: Promise.resolve({ id: "t1", key: "PRY" }),
    });
    const issuesMock = vi.fn().mockResolvedValue({ nodes: [issue] });
    injectSdk(client, { issues: issuesMock });

    const results = await client.searchIssues({
      state: "Todo",
      projectName: "Project X",
      assigneeMe: true,
      team: "PRY",
    });

    expect(issuesMock).toHaveBeenCalledWith({
      filter: {
        state: { name: { eq: "Todo" } },
        project: { name: { eq: "Project X" } },
        assignee: { isMe: { eq: true } },
        team: { or: [{ name: { eq: "PRY" } }, { key: { eq: "PRY" } }] },
      },
    });
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      id: "issue-1",
      state: "Todo",
      labels: ["bug"],
      project: "Project X",
      team: "PRY",
      cycle: "Cycle 5",
    });
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ count: 1 }),
      "Searched Linear issues",
    );
  });

  it("builds a minimal filter when only state is given", async () => {
    const { client } = makeClient();
    const issuesMock = vi.fn().mockResolvedValue({ nodes: [] });
    injectSdk(client, { issues: issuesMock });

    const results = await client.searchIssues({ state: "Todo" });

    expect(issuesMock).toHaveBeenCalledWith({
      filter: { state: { name: { eq: "Todo" } } },
    });
    expect(results).toEqual([]);
  });

  it("returns an empty array when the connection has no nodes", async () => {
    const { client } = makeClient();
    injectSdk(client, { issues: vi.fn().mockResolvedValue({ nodes: null }) });

    const results = await client.searchIssues({ state: "Todo" });

    expect(results).toEqual([]);
  });

  it("treats a null description as an empty string", async () => {
    const { client } = makeClient();
    const issue = makeFakeIssue({ id: "issue-1", description: null });
    injectSdk(client, { issues: vi.fn().mockResolvedValue({ nodes: [issue] }) });

    const [result] = await client.searchIssues({ state: "Todo" });

    expect(result.description).toBe("");
  });

  it("falls back to undefined project/team/cycle and empty labels when those are missing", async () => {
    const { client } = makeClient();
    const issue = makeFakeIssue({
      id: "issue-1",
      labels: () => Promise.resolve(null),
      project: Promise.resolve(null),
      cycle: Promise.resolve(null),
      team: Promise.resolve(null),
    });
    injectSdk(client, { issues: vi.fn().mockResolvedValue({ nodes: [issue] }) });

    const [result] = await client.searchIssues({ state: "Todo" });

    expect(result.labels).toEqual([]);
    expect(result.project).toBeUndefined();
    expect(result.team).toBeUndefined();
    expect(result.cycle).toBeUndefined();
  });

  it("handles a null issues connection without throwing", async () => {
    const { client } = makeClient();
    injectSdk(client, { issues: vi.fn().mockResolvedValue(null) });

    const results = await client.searchIssues({ state: "Todo" });

    expect(results).toEqual([]);
  });

  it("propagates errors from the SDK", async () => {
    const { client } = makeClient();
    injectSdk(client, { issues: vi.fn().mockRejectedValue(new Error("rate limited")) });

    await expect(client.searchIssues({ state: "Todo" })).rejects.toThrow("rate limited");
  });
});

describe("RealLinearClient.postComment", () => {
  it("creates a comment via the SDK and logs it", async () => {
    const { client, logger } = makeClient();
    const createCommentMock = vi.fn().mockResolvedValue({});
    injectSdk(client, { createComment: createCommentMock });

    await client.postComment("issue-1", "hello world");

    expect(createCommentMock).toHaveBeenCalledWith({ issueId: "issue-1", body: "hello world" });
    expect(logger.debug).toHaveBeenCalledWith(
      { issueId: "issue-1" },
      "Posted comment to Linear issue",
    );
  });

  it("propagates errors from the SDK", async () => {
    const { client } = makeClient();
    injectSdk(client, { createComment: vi.fn().mockRejectedValue(new Error("API error")) });

    await expect(client.postComment("issue-1", "body")).rejects.toThrow("API error");
  });
});

describe("RealLinearClient.updateIssueState", () => {
  it("resolves the state id by name and updates the issue", async () => {
    const { client, logger } = makeClient();
    const issue = makeFakeIssue({ id: "issue-1", team: Promise.resolve({ id: "t1", key: "PRY" }) });
    const statesMock = vi
      .fn()
      .mockResolvedValue({ nodes: [{ id: "state-done", name: "Done" }] });
    const updateIssueMock = vi.fn().mockResolvedValue({});
    injectSdk(client, {
      issue: vi.fn().mockResolvedValue(issue),
      team: vi.fn().mockResolvedValue({ id: "t1", states: statesMock }),
      updateIssue: updateIssueMock,
    });

    await client.updateIssueState("issue-1", "Done");

    expect(updateIssueMock).toHaveBeenCalledWith("issue-1", { stateId: "state-done" });
    expect(logger.debug).toHaveBeenCalledWith(
      { issueId: "issue-1", stateName: "Done", stateId: "state-done" },
      "Updated Linear issue state",
    );
  });

  it("caches resolved team states across calls (team() fetched only once)", async () => {
    const { client } = makeClient();
    const issue = makeFakeIssue({ id: "issue-1", team: Promise.resolve({ id: "t1", key: "PRY" }) });
    const statesMock = vi.fn().mockResolvedValue({
      nodes: [
        { id: "state-todo", name: "Todo" },
        { id: "state-done", name: "Done" },
      ],
    });
    const teamMock = vi.fn().mockResolvedValue({ id: "t1", states: statesMock });
    const updateIssueMock = vi.fn().mockResolvedValue({});
    injectSdk(client, {
      issue: vi.fn().mockResolvedValue(issue),
      team: teamMock,
      updateIssue: updateIssueMock,
    });

    await client.updateIssueState("issue-1", "Todo");
    await client.updateIssueState("issue-1", "Done");

    expect(teamMock).toHaveBeenCalledTimes(1);
    expect(updateIssueMock).toHaveBeenCalledTimes(2);
  });

  it("warns and no-ops when the issue has no team", async () => {
    const { client, logger } = makeClient();
    const issue = makeFakeIssue({ id: "issue-1", team: Promise.resolve(null) });
    const updateIssueMock = vi.fn();
    injectSdk(client, {
      issue: vi.fn().mockResolvedValue(issue),
      updateIssue: updateIssueMock,
    });

    await client.updateIssueState("issue-1", "Done");

    expect(updateIssueMock).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(
      { issueId: "issue-1" },
      "Cannot update state: issue has no team",
    );
  });

  it("warns and no-ops when the state name cannot be resolved", async () => {
    const { client, logger } = makeClient();
    const issue = makeFakeIssue({ id: "issue-1", team: Promise.resolve({ id: "t1", key: "PRY" }) });
    const updateIssueMock = vi.fn();
    injectSdk(client, {
      issue: vi.fn().mockResolvedValue(issue),
      team: vi.fn().mockResolvedValue({ id: "t1", states: vi.fn().mockResolvedValue({ nodes: [] }) }),
      updateIssue: updateIssueMock,
    });

    await client.updateIssueState("issue-1", "Nonexistent");

    expect(updateIssueMock).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(
      { issueId: "issue-1", stateName: "Nonexistent", teamId: "t1" },
      "Could not find workflow state by name",
    );
  });

  it("handles a null states connection without throwing", async () => {
    const { client } = makeClient();
    const issue = makeFakeIssue({ id: "issue-1", team: Promise.resolve({ id: "t1", key: "PRY" }) });
    injectSdk(client, {
      issue: vi.fn().mockResolvedValue(issue),
      team: vi.fn().mockResolvedValue({ id: "t1", states: vi.fn().mockResolvedValue(null) }),
      updateIssue: vi.fn(),
    });

    await expect(client.updateIssueState("issue-1", "Done")).resolves.toBeUndefined();
  });
});

describe("RealLinearClient.addLabel", () => {
  it("resolves an existing label by name and adds its id to the issue", async () => {
    const { client } = makeClient();
    const issue = makeFakeIssue({
      id: "issue-1",
      labelIds: ["existing-id"],
      team: Promise.resolve({ id: "t1", key: "PRY" }),
    });
    const updateIssueMock = vi.fn().mockResolvedValue({});
    injectSdk(client, {
      issue: vi.fn().mockResolvedValue(issue),
      issueLabels: vi.fn().mockResolvedValue({ nodes: [{ id: "label-id", name: "bug" }] }),
      updateIssue: updateIssueMock,
    });

    await client.addLabel("issue-1", "bug");

    expect(updateIssueMock).toHaveBeenCalledWith("issue-1", {
      labelIds: ["existing-id", "label-id"],
    });
  });

  it("creates a new label when none exists, scoping it to the issue's team", async () => {
    const { client, logger } = makeClient();
    const issue = makeFakeIssue({
      id: "issue-1",
      labelIds: [],
      team: Promise.resolve({ id: "t1", key: "PRY" }),
    });
    const createIssueLabelMock = vi.fn().mockResolvedValue({
      issueLabel: Promise.resolve({ id: "new-label-id" }),
    });
    const updateIssueMock = vi.fn().mockResolvedValue({});
    injectSdk(client, {
      issue: vi.fn().mockResolvedValue(issue),
      issueLabels: vi.fn().mockResolvedValue({ nodes: [] }),
      createIssueLabel: createIssueLabelMock,
      updateIssue: updateIssueMock,
    });

    await client.addLabel("issue-1", "new-label");

    expect(createIssueLabelMock).toHaveBeenCalledWith({ name: "new-label", teamId: "t1" });
    expect(updateIssueMock).toHaveBeenCalledWith("issue-1", { labelIds: ["new-label-id"] });
    expect(logger.info).toHaveBeenCalledWith(
      { labelName: "new-label", labelId: "new-label-id" },
      "Created new Linear label",
    );
  });

  it("creates a label without a teamId when the issue has no team", async () => {
    const { client } = makeClient();
    const issue = makeFakeIssue({ id: "issue-1", labelIds: [], team: Promise.resolve(null) });
    const createIssueLabelMock = vi.fn().mockResolvedValue({
      issueLabel: Promise.resolve({ id: "new-label-id" }),
    });
    injectSdk(client, {
      issue: vi.fn().mockResolvedValue(issue),
      issueLabels: vi.fn().mockResolvedValue({ nodes: [] }),
      createIssueLabel: createIssueLabelMock,
      updateIssue: vi.fn().mockResolvedValue({}),
    });

    await client.addLabel("issue-1", "new-label");

    expect(createIssueLabelMock).toHaveBeenCalledWith({ name: "new-label" });
  });

  it("does not duplicate an already-applied label id", async () => {
    const { client } = makeClient();
    const issue = makeFakeIssue({
      id: "issue-1",
      labelIds: ["label-id"],
      team: Promise.resolve({ id: "t1", key: "PRY" }),
    });
    const updateIssueMock = vi.fn();
    injectSdk(client, {
      issue: vi.fn().mockResolvedValue(issue),
      issueLabels: vi.fn().mockResolvedValue({ nodes: [{ id: "label-id", name: "bug" }] }),
      updateIssue: updateIssueMock,
    });

    await client.addLabel("issue-1", "bug");

    expect(updateIssueMock).not.toHaveBeenCalled();
  });

  it("caches resolved label ids across calls (issueLabels queried once)", async () => {
    const { client } = makeClient();
    const issue = makeFakeIssue({
      id: "issue-1",
      labelIds: [],
      team: Promise.resolve({ id: "t1", key: "PRY" }),
    });
    const issueLabelsMock = vi.fn().mockResolvedValue({ nodes: [{ id: "label-id", name: "bug" }] });
    injectSdk(client, {
      issue: vi.fn().mockResolvedValue(issue),
      issueLabels: issueLabelsMock,
      updateIssue: vi.fn().mockResolvedValue({}),
    });

    await client.addLabel("issue-1", "bug");
    await client.addLabel("issue-1", "bug");

    expect(issueLabelsMock).toHaveBeenCalledTimes(1);
  });

  it("throws when label creation fails to return an issueLabel", async () => {
    const { client } = makeClient();
    const issue = makeFakeIssue({ id: "issue-1", labelIds: [], team: Promise.resolve(null) });
    injectSdk(client, {
      issue: vi.fn().mockResolvedValue(issue),
      issueLabels: vi.fn().mockResolvedValue({ nodes: [] }),
      createIssueLabel: vi.fn().mockResolvedValue({ issueLabel: Promise.resolve(null) }),
      updateIssue: vi.fn(),
    });

    await expect(client.addLabel("issue-1", "broken")).rejects.toThrow(
      "Failed to create label: broken",
    );
  });
});

describe("RealLinearClient.removeLabel", () => {
  it("removes a label by looking it up on the issue when not cached", async () => {
    const { client } = makeClient();
    const issue = makeFakeIssue({ id: "issue-1", labelIds: ["label-id", "other-id"] });
    const updateIssueMock = vi.fn().mockResolvedValue({});
    injectSdk(client, {
      issue: vi.fn().mockResolvedValue(issue),
      updateIssue: updateIssueMock,
    });
    issue.labels = () => Promise.resolve({ nodes: [{ id: "label-id", name: "bug" }] });

    await client.removeLabel("issue-1", "bug");

    expect(updateIssueMock).toHaveBeenCalledWith("issue-1", { labelIds: ["other-id"] });
  });

  it("is a no-op when the label is not found on the issue", async () => {
    const { client } = makeClient();
    const issue = makeFakeIssue({ id: "issue-1", labelIds: ["other-id"] });
    issue.labels = () => Promise.resolve({ nodes: [] });
    const updateIssueMock = vi.fn();
    injectSdk(client, {
      issue: vi.fn().mockResolvedValue(issue),
      updateIssue: updateIssueMock,
    });

    await client.removeLabel("issue-1", "missing-label");

    expect(updateIssueMock).not.toHaveBeenCalled();
  });

  it("uses the cached label id on a subsequent call instead of re-querying labels", async () => {
    const { client } = makeClient();
    const issue = makeFakeIssue({ id: "issue-1", labelIds: ["label-id"] });
    const labelsMock = vi.fn().mockResolvedValue({ nodes: [{ id: "label-id", name: "bug" }] });
    issue.labels = labelsMock;
    const updateIssueMock = vi.fn().mockResolvedValue({});
    injectSdk(client, {
      issue: vi.fn().mockResolvedValue(issue),
      updateIssue: updateIssueMock,
    });

    // First call populates the cache via listLabels-style lookup inside removeLabel.
    await client.removeLabel("issue-1", "bug");
    issue.labelIds = ["label-id"];
    await client.removeLabel("issue-1", "bug");

    expect(labelsMock).toHaveBeenCalledTimes(1);
    expect(updateIssueMock).toHaveBeenCalledTimes(2);
  });
});

describe("RealLinearClient.listLabels", () => {
  it("returns label names and populates the label cache for later addLabel/removeLabel calls", async () => {
    const { client } = makeClient();
    const issue = makeFakeIssue({
      id: "issue-1",
      labelIds: ["label-id"],
      labels: () => Promise.resolve({ nodes: [{ id: "label-id", name: "bug" }] }),
    });
    injectSdk(client, { issue: vi.fn().mockResolvedValue(issue) });

    const labels = await client.listLabels("issue-1");
    expect(labels).toEqual(["bug"]);

    // Now removeLabel should use the cache instead of calling issue.labels() again.
    const labelsSpy = vi.fn().mockResolvedValue({ nodes: [{ id: "label-id", name: "bug" }] });
    issue.labels = labelsSpy;
    const updateIssueMock = vi.fn().mockResolvedValue({});
    injectSdk(client, { issue: vi.fn().mockResolvedValue(issue), updateIssue: updateIssueMock });

    await client.removeLabel("issue-1", "bug");
    expect(labelsSpy).not.toHaveBeenCalled();
    expect(updateIssueMock).toHaveBeenCalledWith("issue-1", { labelIds: [] });
  });

  it("returns an empty array when the issue has no labels connection", async () => {
    const { client } = makeClient();
    const issue = makeFakeIssue({ id: "issue-1", labels: () => Promise.resolve(null) });
    injectSdk(client, { issue: vi.fn().mockResolvedValue(issue) });

    const labels = await client.listLabels("issue-1");

    expect(labels).toEqual([]);
  });

  it("propagates errors from the SDK", async () => {
    const { client } = makeClient();
    injectSdk(client, { issue: vi.fn().mockRejectedValue(new Error("network down")) });

    await expect(client.listLabels("issue-1")).rejects.toThrow("network down");
  });
});

describe("RealLinearClient constructor", () => {
  it("constructs without throwing given an api key and logger", () => {
    expect(() => makeClient()).not.toThrow();
  });
});

describe("RealLinearClient.getRelatedContext blocker hydration failure", () => {
  it("logs a warning and drops a blocker whose relation.issue rejects", async () => {
    const { client, logger } = makeClient();
    const focus = makeFakeIssue({
      id: "focus-id",
      // getRelatedContext also reads `parent`, which isn't on FakeIssue's base shape
      // here, so extend with the needed fields directly.
    }) as unknown as {
      id: string;
      parent: Promise<null>;
      inverseRelations: () => Promise<{
        nodes: Array<{ id: string; type: string; issue: Promise<never> }>;
      }>;
    };
    focus.parent = Promise.resolve(null);
    focus.inverseRelations = () =>
      Promise.resolve({
        nodes: [
          {
            id: "rel-1",
            type: "blocks",
            issue: Promise.reject(new Error("blocker fetch failed")),
          },
        ],
      });

    injectSdk(client, { issue: vi.fn().mockResolvedValue(focus) });

    const ctx = await client.getRelatedContext("focus-id");

    expect(ctx.blockers).toEqual([]);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ relationId: "rel-1", focusIssueId: "focus-id" }),
      "Failed to hydrate blocker issue from relation",
    );
  });
});

describe("RealLinearClient.getRelatedContext missing inverseRelations connection", () => {
  it("treats a null inverseRelations connection as no blockers", async () => {
    const { client } = makeClient();
    const focus = makeFakeIssue({ id: "focus-id" }) as unknown as {
      id: string;
      parent: Promise<null>;
      inverseRelations: () => Promise<null>;
    };
    focus.parent = Promise.resolve(null);
    focus.inverseRelations = () => Promise.resolve(null);
    injectSdk(client, { issue: vi.fn().mockResolvedValue(focus) });

    const ctx = await client.getRelatedContext("focus-id");

    expect(ctx.blockers).toEqual([]);
  });
});

describe("RealLinearClient.getRelatedContext field fallbacks", () => {
  it("falls back to an empty labels array and 'Unknown' state for a parent missing both", async () => {
    const { client } = makeClient();
    const parent = makeFakeIssue({
      id: "parent-id",
      identifier: "PRY-100",
      labels: () => Promise.resolve(null),
      state: Promise.resolve(null),
    });
    const focus = makeFakeIssue({ id: "focus-id" }) as unknown as {
      id: string;
      parent: Promise<FakeIssue>;
      inverseRelations: () => Promise<{ nodes: never[] }>;
    };
    focus.parent = Promise.resolve(parent);
    focus.inverseRelations = () => Promise.resolve({ nodes: [] });

    injectSdk(client, {
      issue: vi.fn().mockImplementation((id: string) => {
        if (id === "focus-id") return Promise.resolve(focus);
        if (id === "parent-id") return Promise.resolve(parent);
        throw new Error(`unexpected id ${id}`);
      }),
    });

    const ctx = await client.getRelatedContext("focus-id");

    expect(ctx.parent?.labels).toEqual([]);
    expect(ctx.parent?.state).toBe("Unknown");
  });
});

describe("RealLinearClient.getRelatedContext logging", () => {
  it("logs a debug summary with hasParent and blockerCount", async () => {
    const { client, logger } = makeClient();
    const focus = makeFakeIssue({ id: "focus-id" }) as unknown as {
      id: string;
      parent: Promise<null>;
      inverseRelations: () => Promise<{ nodes: never[] }>;
    };
    focus.parent = Promise.resolve(null);
    focus.inverseRelations = () => Promise.resolve({ nodes: [] });
    injectSdk(client, { issue: vi.fn().mockResolvedValue(focus) });

    await client.getRelatedContext("focus-id");

    expect(logger.debug).toHaveBeenCalledWith(
      { issueId: "focus-id", hasParent: false, blockerCount: 0 },
      "Fetched related Linear context",
    );
  });
});

describe("RealLinearClient module wiring", () => {
  it("re-exports a class implementing the LinearClient interface shape", () => {
    const { client } = makeClient();
    expect(typeof client.getIssue).toBe("function");
    expect(typeof client.getRelatedContext).toBe("function");
    expect(typeof client.searchIssues).toBe("function");
    expect(typeof client.postComment).toBe("function");
    expect(typeof client.updateIssueState).toBe("function");
    expect(typeof client.addLabel).toBe("function");
    expect(typeof client.removeLabel).toBe("function");
    expect(typeof client.listLabels).toBe("function");
  });
});

// Keep beforeEach available for parity with the related-context test file in case
// shared setup is introduced later; currently each test constructs its own client.
beforeEach(() => {
  vi.clearAllMocks();
});
