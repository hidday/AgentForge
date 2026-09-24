import { describe, it, expect, vi, beforeEach } from "vitest";
import { RealLinearClient } from "../../src/linear/realLinearClient.js";

// The existing `realLinearClient.relatedContext.test.ts` covers
// `getRelatedContext` (including the IssueRelationType.Blocks comparison
// logic via "blocks" vs. other relation types). This file covers the
// remaining public methods: getIssue, searchIssues, postComment,
// updateIssueState, addLabel, removeLabel, listLabels, and their error
// paths / private helper branches (resolveStateId, resolveOrCreateLabel).
//
// Like the existing related-context tests, we construct RealLinearClient
// with a dummy API key (the SDK constructor performs no network I/O) and
// then replace its private `sdk` field with a fake object exposing only
// the methods each code path calls, so no real network access ever
// happens.

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
    project: Promise.resolve({ name: "Project X" }),
    cycle: Promise.resolve({ name: "Cycle 4" }),
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

function makeClient(fakeSdk: Record<string, unknown>, logger = makeLogger()) {
  const client = new RealLinearClient("test-key", logger as never);
  (client as unknown as { sdk: unknown }).sdk = fakeSdk;
  return { client, logger };
}

describe("RealLinearClient.getIssue", () => {
  it("maps a fully-populated SDK issue to a LinearIssue", async () => {
    const fakeIssue = makeFakeIssue({
      id: "issue-1",
      identifier: "PRY-42",
      title: "Fix the bug",
      description: "Detailed description",
      branchName: "ai/pry-42",
      priority: 2,
      url: "https://linear.app/team/issue/PRY-42",
      labels: () => Promise.resolve({ nodes: [{ id: "l1", name: "bug" }] }),
      state: Promise.resolve({ id: "s1", name: "In Progress" }),
      project: Promise.resolve({ name: "Core" }),
      cycle: Promise.resolve({ name: "Cycle 7" }),
      team: Promise.resolve({ id: "team-1", key: "PRY" }),
    });
    const sdk = { issue: vi.fn().mockResolvedValue(fakeIssue) };
    const { client } = makeClient(sdk);

    const issue = await client.getIssue("issue-1");

    expect(sdk.issue).toHaveBeenCalledWith("issue-1");
    expect(issue).toEqual({
      id: "issue-1",
      identifier: "PRY-42",
      title: "Fix the bug",
      description: "Detailed description",
      branchName: "ai/pry-42",
      state: "In Progress",
      labels: ["bug"],
      priority: 2,
      url: "https://linear.app/team/issue/PRY-42",
      project: "Core",
      team: "PRY",
      cycle: "Cycle 7",
    });
  });

  it("falls back to defaults when description, state, project, cycle, and team are absent", async () => {
    const fakeIssue = makeFakeIssue({
      id: "issue-2",
      description: null,
      state: Promise.resolve(null),
      project: Promise.resolve(null),
      cycle: Promise.resolve(null),
      team: Promise.resolve(null),
    });
    const sdk = { issue: vi.fn().mockResolvedValue(fakeIssue) };
    const { client } = makeClient(sdk);

    const issue = await client.getIssue("issue-2");

    expect(issue.description).toBe("");
    expect(issue.state).toBe("Unknown");
    expect(issue.project).toBeUndefined();
    expect(issue.cycle).toBeUndefined();
    expect(issue.team).toBeUndefined();
  });

  it("propagates errors from the SDK", async () => {
    const sdk = { issue: vi.fn().mockRejectedValue(new Error("Issue not found")) };
    const { client } = makeClient(sdk);

    await expect(client.getIssue("missing")).rejects.toThrow("Issue not found");
  });

  it("defaults labels to [] when the labels connection has no nodes", async () => {
    const fakeIssue = makeFakeIssue({
      id: "issue-3",
      labels: () => Promise.resolve({} as { nodes: never[] }),
    });
    const sdk = { issue: vi.fn().mockResolvedValue(fakeIssue) };
    const { client } = makeClient(sdk);

    const issue = await client.getIssue("issue-3");

    expect(issue.labels).toEqual([]);
  });
});

describe("RealLinearClient.getRelatedContext — blocker hydration failure", () => {
  it("logs a warning and skips a blocker whose relation.issue rejects", async () => {
    const focus = makeFakeIssue({
      id: "focus-id",
      ...{
        parent: Promise.resolve(null),
        inverseRelations: () =>
          Promise.resolve({
            nodes: [
              {
                id: "rel-1",
                type: "blocks",
                issue: Promise.reject(new Error("hydrate failed")),
              },
            ],
          }),
      },
    } as never);
    const sdk = { issue: vi.fn().mockResolvedValue(focus) };
    const { client, logger } = makeClient(sdk);

    const ctx = await client.getRelatedContext("focus-id");

    expect(ctx.blockers).toEqual([]);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ relationId: "rel-1", focusIssueId: "focus-id" }),
      "Failed to hydrate blocker issue from relation",
    );
  });
});

describe("RealLinearClient.getRelatedContext — related-issue field fallbacks", () => {
  it("defaults labels to [] and state to 'Unknown' when absent on the parent issue", async () => {
    const parent = makeFakeIssue({
      id: "parent-id",
      labels: () => Promise.resolve({} as { nodes: never[] }),
      state: Promise.resolve(null),
    });
    const focus = makeFakeIssue({
      id: "focus-id",
      ...{
        parent: Promise.resolve(parent),
        inverseRelations: () => Promise.resolve({ nodes: [] }),
      },
    } as never);
    const { client } = makeClient({ issue: vi.fn().mockResolvedValue(focus) });

    const ctx = await client.getRelatedContext("focus-id");

    expect(ctx.parent?.labels).toEqual([]);
    expect(ctx.parent?.state).toBe("Unknown");
  });
});

describe("RealLinearClient.searchIssues", () => {
  function makeSearchIssue(id: string) {
    return makeFakeIssue({
      id,
      labels: () => Promise.resolve({ nodes: [{ id: "l1", name: "feature" }] }),
      project: Promise.resolve({ name: "Core" }),
      cycle: Promise.resolve({ name: "Cycle 1" }),
      team: Promise.resolve({ id: "team-1", key: "PRY" }),
    });
  }

  it("builds a filter with only state when no optional filters are given", async () => {
    const issues = vi.fn().mockResolvedValue({ nodes: [makeSearchIssue("i1")] });
    const { client } = makeClient({ issues });

    const results = await client.searchIssues({ state: "Todo" });

    expect(issues).toHaveBeenCalledWith({ filter: { state: { name: { eq: "Todo" } } } });
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      id: "i1",
      state: "Todo",
      labels: ["feature"],
      project: "Core",
      team: "PRY",
      cycle: "Cycle 1",
    });
  });

  it("adds projectName, assigneeMe, and team clauses when provided", async () => {
    const issues = vi.fn().mockResolvedValue({ nodes: [] });
    const { client } = makeClient({ issues });

    await client.searchIssues({
      state: "In Progress",
      projectName: "Core",
      assigneeMe: true,
      team: "PRY",
    });

    expect(issues).toHaveBeenCalledWith({
      filter: {
        state: { name: { eq: "In Progress" } },
        project: { name: { eq: "Core" } },
        assignee: { isMe: { eq: true } },
        team: { or: [{ name: { eq: "PRY" } }, { key: { eq: "PRY" } }] },
      },
    });
  });

  it("returns an empty array when the SDK returns no nodes", async () => {
    const issues = vi.fn().mockResolvedValue({ nodes: undefined });
    const { client } = makeClient({ issues });

    const results = await client.searchIssues({ state: "Todo" });

    expect(results).toEqual([]);
  });

  it("propagates errors from the SDK", async () => {
    const issues = vi.fn().mockRejectedValue(new Error("GraphQL error"));
    const { client } = makeClient({ issues });

    await expect(client.searchIssues({ state: "Todo" })).rejects.toThrow("GraphQL error");
  });

  it("defaults description/project/team/cycle/labels when absent on a result issue", async () => {
    const bareIssue = makeFakeIssue({
      id: "i2",
      description: null,
      labels: () => Promise.resolve({} as { nodes: never[] }),
      project: Promise.resolve(null),
      cycle: Promise.resolve(null),
      team: Promise.resolve(null),
    });
    const issues = vi.fn().mockResolvedValue({ nodes: [bareIssue] });
    const { client } = makeClient({ issues });

    const [result] = await client.searchIssues({ state: "Todo" });

    expect(result.description).toBe("");
    expect(result.labels).toEqual([]);
    expect(result.project).toBeUndefined();
    expect(result.team).toBeUndefined();
    expect(result.cycle).toBeUndefined();
  });
});

describe("RealLinearClient.postComment", () => {
  it("calls sdk.createComment with issueId and body", async () => {
    const createComment = vi.fn().mockResolvedValue({});
    const { client } = makeClient({ createComment });

    await client.postComment("issue-1", "Looks good");

    expect(createComment).toHaveBeenCalledWith({ issueId: "issue-1", body: "Looks good" });
  });

  it("propagates errors from the SDK", async () => {
    const createComment = vi.fn().mockRejectedValue(new Error("Comment failed"));
    const { client } = makeClient({ createComment });

    await expect(client.postComment("issue-1", "body")).rejects.toThrow("Comment failed");
  });
});

describe("RealLinearClient.updateIssueState", () => {
  it("warns and returns without updating when the issue has no team", async () => {
    const fakeIssue = makeFakeIssue({ id: "issue-1", team: Promise.resolve(null) });
    const updateIssue = vi.fn();
    const { client, logger } = makeClient({
      issue: vi.fn().mockResolvedValue(fakeIssue),
      updateIssue,
    });

    await client.updateIssueState("issue-1", "Done");

    expect(updateIssue).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(
      { issueId: "issue-1" },
      "Cannot update state: issue has no team",
    );
  });

  it("warns and returns without updating when the state name cannot be resolved", async () => {
    const fakeIssue = makeFakeIssue({
      id: "issue-1",
      team: Promise.resolve({ id: "team-1", key: "PRY" }),
    });
    const team = vi.fn().mockResolvedValue({
      states: () => Promise.resolve({ nodes: [{ id: "s1", name: "Todo" }] }),
    });
    const updateIssue = vi.fn();
    const { client, logger } = makeClient({
      issue: vi.fn().mockResolvedValue(fakeIssue),
      team,
      updateIssue,
    });

    await client.updateIssueState("issue-1", "Nonexistent State");

    expect(updateIssue).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(
      { issueId: "issue-1", stateName: "Nonexistent State", teamId: "team-1" },
      "Could not find workflow state by name",
    );
  });

  it("resolves the state id and calls sdk.updateIssue on success", async () => {
    const fakeIssue = makeFakeIssue({
      id: "issue-1",
      team: Promise.resolve({ id: "team-1", key: "PRY" }),
    });
    const states = vi.fn().mockResolvedValue({ nodes: [{ id: "state-done", name: "Done" }] });
    const team = vi.fn().mockResolvedValue({ states });
    const updateIssue = vi.fn().mockResolvedValue({});
    const { client } = makeClient({
      issue: vi.fn().mockResolvedValue(fakeIssue),
      team,
      updateIssue,
    });

    await client.updateIssueState("issue-1", "Done");

    expect(updateIssue).toHaveBeenCalledWith("issue-1", { stateId: "state-done" });
  });

  it("warns without updating when the team's states connection has no nodes", async () => {
    const fakeIssue = makeFakeIssue({
      id: "issue-1",
      team: Promise.resolve({ id: "team-1", key: "PRY" }),
    });
    const team = vi.fn().mockResolvedValue({ states: () => Promise.resolve({} as { nodes: never[] }) });
    const updateIssue = vi.fn();
    const { client, logger } = makeClient({
      issue: vi.fn().mockResolvedValue(fakeIssue),
      team,
      updateIssue,
    });

    await client.updateIssueState("issue-1", "Done");

    expect(updateIssue).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(
      { issueId: "issue-1", stateName: "Done", teamId: "team-1" },
      "Could not find workflow state by name",
    );
  });

  it("caches resolved states per team across calls", async () => {
    const fakeIssue1 = makeFakeIssue({
      id: "issue-1",
      team: Promise.resolve({ id: "team-1", key: "PRY" }),
    });
    const fakeIssue2 = makeFakeIssue({
      id: "issue-2",
      team: Promise.resolve({ id: "team-1", key: "PRY" }),
    });
    const states = vi.fn().mockResolvedValue({ nodes: [{ id: "state-done", name: "Done" }] });
    const team = vi.fn().mockResolvedValue({ states });
    const issue = vi.fn().mockResolvedValueOnce(fakeIssue1).mockResolvedValueOnce(fakeIssue2);
    const updateIssue = vi.fn().mockResolvedValue({});
    const { client } = makeClient({ issue, team, updateIssue });

    await client.updateIssueState("issue-1", "Done");
    await client.updateIssueState("issue-2", "Done");

    expect(team).toHaveBeenCalledTimes(1);
  });
});

describe("RealLinearClient.addLabel", () => {
  it("resolves an existing label via issueLabels lookup and adds it when missing", async () => {
    const fakeIssue = makeFakeIssue({
      id: "issue-1",
      team: Promise.resolve({ id: "team-1", key: "PRY" }),
      labelIds: ["existing-id"],
    });
    const issueLabels = vi.fn().mockResolvedValue({ nodes: [{ id: "label-1", name: "bug" }] });
    const updateIssue = vi.fn().mockResolvedValue({});
    const { client } = makeClient({
      issue: vi.fn().mockResolvedValue(fakeIssue),
      issueLabels,
      updateIssue,
    });

    await client.addLabel("issue-1", "bug");

    expect(issueLabels).toHaveBeenCalledWith({ filter: { name: { eq: "bug" } } });
    expect(updateIssue).toHaveBeenCalledWith("issue-1", { labelIds: ["existing-id", "label-1"] });
  });

  it("creates a new label via createIssueLabel when none exists", async () => {
    const fakeIssue = makeFakeIssue({
      id: "issue-1",
      team: Promise.resolve({ id: "team-1", key: "PRY" }),
      labelIds: [],
    });
    const issueLabels = vi.fn().mockResolvedValue({ nodes: [] });
    const createIssueLabel = vi.fn().mockResolvedValue({
      issueLabel: Promise.resolve({ id: "new-label-id", name: "urgent" }),
    });
    const updateIssue = vi.fn().mockResolvedValue({});
    const { client, logger } = makeClient({
      issue: vi.fn().mockResolvedValue(fakeIssue),
      issueLabels,
      createIssueLabel,
      updateIssue,
    });

    await client.addLabel("issue-1", "urgent");

    expect(createIssueLabel).toHaveBeenCalledWith({ name: "urgent", teamId: "team-1" });
    expect(updateIssue).toHaveBeenCalledWith("issue-1", { labelIds: ["new-label-id"] });
    expect(logger.info).toHaveBeenCalledWith(
      { labelName: "urgent", labelId: "new-label-id" },
      "Created new Linear label",
    );
  });

  it("creates a label without a teamId when the issue has no team", async () => {
    const fakeIssue = makeFakeIssue({ id: "issue-1", team: Promise.resolve(null), labelIds: [] });
    const issueLabels = vi.fn().mockResolvedValue({ nodes: [] });
    const createIssueLabel = vi.fn().mockResolvedValue({
      issueLabel: Promise.resolve({ id: "new-label-id", name: "urgent" }),
    });
    const updateIssue = vi.fn().mockResolvedValue({});
    const { client } = makeClient({
      issue: vi.fn().mockResolvedValue(fakeIssue),
      issueLabels,
      createIssueLabel,
      updateIssue,
    });

    await client.addLabel("issue-1", "urgent");

    expect(createIssueLabel).toHaveBeenCalledWith({ name: "urgent" });
  });

  it("throws when label creation returns no issueLabel", async () => {
    const fakeIssue = makeFakeIssue({
      id: "issue-1",
      team: Promise.resolve({ id: "team-1", key: "PRY" }),
      labelIds: [],
    });
    const issueLabels = vi.fn().mockResolvedValue({ nodes: [] });
    const createIssueLabel = vi.fn().mockResolvedValue({ issueLabel: Promise.resolve(null) });
    const { client } = makeClient({
      issue: vi.fn().mockResolvedValue(fakeIssue),
      issueLabels,
      createIssueLabel,
    });

    await expect(client.addLabel("issue-1", "urgent")).rejects.toThrow(
      "Failed to create label: urgent",
    );
  });

  it("does not call updateIssue when the label is already present", async () => {
    const fakeIssue = makeFakeIssue({
      id: "issue-1",
      team: Promise.resolve({ id: "team-1", key: "PRY" }),
      labelIds: ["label-1"],
    });
    const issueLabels = vi.fn().mockResolvedValue({ nodes: [{ id: "label-1", name: "bug" }] });
    const updateIssue = vi.fn();
    const { client } = makeClient({
      issue: vi.fn().mockResolvedValue(fakeIssue),
      issueLabels,
      updateIssue,
    });

    await client.addLabel("issue-1", "bug");

    expect(updateIssue).not.toHaveBeenCalled();
  });

  it("uses the label cache on a second call instead of re-querying issueLabels", async () => {
    const fakeIssue1 = makeFakeIssue({
      id: "issue-1",
      team: Promise.resolve({ id: "team-1", key: "PRY" }),
      labelIds: [],
    });
    const fakeIssue2 = makeFakeIssue({
      id: "issue-2",
      team: Promise.resolve({ id: "team-1", key: "PRY" }),
      labelIds: [],
    });
    const issueLabels = vi.fn().mockResolvedValue({ nodes: [{ id: "label-1", name: "bug" }] });
    const updateIssue = vi.fn().mockResolvedValue({});
    const issue = vi.fn().mockResolvedValueOnce(fakeIssue1).mockResolvedValueOnce(fakeIssue2);
    const { client } = makeClient({ issue, issueLabels, updateIssue });

    await client.addLabel("issue-1", "bug");
    await client.addLabel("issue-2", "bug");

    expect(issueLabels).toHaveBeenCalledTimes(1);
  });
});

describe("RealLinearClient.removeLabel", () => {
  it("removes a label found via issue.labels() and caches it", async () => {
    const fakeIssue = makeFakeIssue({
      id: "issue-1",
      labelIds: ["label-1", "label-2"],
      labels: () =>
        Promise.resolve({
          nodes: [
            { id: "label-1", name: "bug" },
            { id: "label-2", name: "urgent" },
          ],
        }),
    });
    const updateIssue = vi.fn().mockResolvedValue({});
    const { client } = makeClient({ issue: vi.fn().mockResolvedValue(fakeIssue), updateIssue });

    await client.removeLabel("issue-1", "bug");

    expect(updateIssue).toHaveBeenCalledWith("issue-1", { labelIds: ["label-2"] });
  });

  it("returns without updating when the label name has no match", async () => {
    const fakeIssue = makeFakeIssue({
      id: "issue-1",
      labelIds: ["label-1"],
      labels: () => Promise.resolve({ nodes: [{ id: "label-1", name: "bug" }] }),
    });
    const updateIssue = vi.fn();
    const { client } = makeClient({ issue: vi.fn().mockResolvedValue(fakeIssue), updateIssue });

    await client.removeLabel("issue-1", "nonexistent");

    expect(updateIssue).not.toHaveBeenCalled();
  });

  it("uses the cached label id on a subsequent call, skipping issue.labels()", async () => {
    const labelsFn = vi
      .fn()
      .mockResolvedValue({ nodes: [{ id: "label-1", name: "bug" }] });
    const fakeIssue1 = makeFakeIssue({
      id: "issue-1",
      labelIds: ["label-1"],
      labels: labelsFn,
    });
    const fakeIssue2 = makeFakeIssue({
      id: "issue-2",
      labelIds: ["label-1"],
      labels: labelsFn,
    });
    const updateIssue = vi.fn().mockResolvedValue({});
    const issue = vi.fn().mockResolvedValueOnce(fakeIssue1).mockResolvedValueOnce(fakeIssue2);
    const { client } = makeClient({ issue, updateIssue });

    await client.removeLabel("issue-1", "bug");
    await client.removeLabel("issue-2", "bug");

    expect(labelsFn).toHaveBeenCalledTimes(1);
    expect(updateIssue).toHaveBeenNthCalledWith(2, "issue-2", { labelIds: [] });
  });
});

describe("RealLinearClient.listLabels", () => {
  it("returns label names and populates the label cache", async () => {
    const fakeIssue = makeFakeIssue({
      id: "issue-1",
      labels: () =>
        Promise.resolve({
          nodes: [
            { id: "label-1", name: "bug" },
            { id: "label-2", name: "urgent" },
          ],
        }),
    });
    const { client } = makeClient({ issue: vi.fn().mockResolvedValue(fakeIssue) });

    const names = await client.listLabels("issue-1");

    expect(names).toEqual(["bug", "urgent"]);
  });

  it("returns an empty array when the issue has no labels", async () => {
    const fakeIssue = makeFakeIssue({ id: "issue-1", labels: () => Promise.resolve({ nodes: [] }) });
    const { client } = makeClient({ issue: vi.fn().mockResolvedValue(fakeIssue) });

    const names = await client.listLabels("issue-1");

    expect(names).toEqual([]);
  });

  it("returns an empty array and skips caching when the labels connection has no nodes", async () => {
    const fakeIssue = makeFakeIssue({
      id: "issue-1",
      labels: () => Promise.resolve({} as { nodes: never[] }),
    });
    const { client } = makeClient({ issue: vi.fn().mockResolvedValue(fakeIssue) });

    const names = await client.listLabels("issue-1");

    expect(names).toEqual([]);
  });

  it("populates the label cache so a later removeLabel skips issue.labels()", async () => {
    const labelsFn = vi.fn().mockResolvedValue({ nodes: [{ id: "label-1", name: "bug" }] });
    const fakeIssue = makeFakeIssue({ id: "issue-1", labelIds: ["label-1"], labels: labelsFn });
    const updateIssue = vi.fn().mockResolvedValue({});
    const { client } = makeClient({
      issue: vi.fn().mockResolvedValue(fakeIssue),
      updateIssue,
    });

    await client.listLabels("issue-1");
    await client.removeLabel("issue-1", "bug");

    // labels() is called once by listLabels; removeLabel uses the cache instead.
    expect(labelsFn).toHaveBeenCalledTimes(1);
    expect(updateIssue).toHaveBeenCalledWith("issue-1", { labelIds: [] });
  });
});
