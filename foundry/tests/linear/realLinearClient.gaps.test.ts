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

function makeFakeIssue(overrides: Record<string, unknown> = {}) {
  return {
    id: "issue-1",
    identifier: "PRY-1",
    title: "Title",
    description: "Description",
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

describe("RealLinearClient.getIssue", () => {
  let client: RealLinearClient;
  let sdk: { issue: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    client = new RealLinearClient("test-key", makeLogger() as never);
    sdk = { issue: vi.fn() };
    (client as unknown as { sdk: unknown }).sdk = sdk;
  });

  it("maps all fields including labels, state, project, cycle and team", async () => {
    sdk.issue.mockResolvedValue(
      makeFakeIssue({
        labels: () => Promise.resolve({ nodes: [{ id: "l1", name: "bug" }] }),
        state: Promise.resolve({ id: "s1", name: "In Progress" }),
        project: Promise.resolve({ name: "Alpha" }),
        cycle: Promise.resolve({ name: "Cycle 3" }),
        team: Promise.resolve({ id: "t1", key: "ENG" }),
      }),
    );

    const issue = await client.getIssue("issue-1");

    expect(issue).toEqual({
      id: "issue-1",
      identifier: "PRY-1",
      title: "Title",
      description: "Description",
      branchName: "ai/issue-1",
      state: "In Progress",
      labels: ["bug"],
      priority: 0,
      url: "https://linear.app/team/issue/PRY-1",
      project: "Alpha",
      team: "ENG",
      cycle: "Cycle 3",
    });
  });

  it("falls back to defaults when description/state/project/cycle/team are absent", async () => {
    sdk.issue.mockResolvedValue(
      makeFakeIssue({
        description: null,
        labels: () => Promise.resolve({ nodes: undefined }),
        state: Promise.resolve(null),
        team: Promise.resolve(null),
      }),
    );

    const issue = await client.getIssue("issue-1");

    expect(issue.description).toBe("");
    expect(issue.labels).toEqual([]);
    expect(issue.state).toBe("Unknown");
    expect(issue.project).toBeUndefined();
    expect(issue.team).toBeUndefined();
    expect(issue.cycle).toBeUndefined();
  });
});

describe("RealLinearClient.searchIssues", () => {
  let client: RealLinearClient;
  let sdk: { issues: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    client = new RealLinearClient("test-key", makeLogger() as never);
    sdk = { issues: vi.fn() };
    (client as unknown as { sdk: unknown }).sdk = sdk;
  });

  it("builds a state-only filter by default", async () => {
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

  it("maps matching issues, defaulting absent fields", async () => {
    sdk.issues.mockResolvedValue({
      nodes: [
        makeFakeIssue({
          id: "a",
          labels: () => Promise.resolve({ nodes: [{ id: "l1", name: "bug" }] }),
          project: Promise.resolve({ name: "Alpha" }),
          cycle: Promise.resolve(null),
          team: Promise.resolve({ id: "t1", key: "ENG" }),
        }),
      ],
    });

    const results = await client.searchIssues({ state: "Todo" });

    expect(results).toEqual([
      {
        id: "a",
        identifier: "PRY-1",
        title: "Title",
        description: "Description",
        branchName: "ai/issue-1",
        state: "Todo",
        labels: ["bug"],
        priority: 0,
        url: "https://linear.app/team/issue/PRY-1",
        project: "Alpha",
        team: "ENG",
        cycle: undefined,
      },
    ]);
  });

  it("returns an empty array when the connection has no nodes", async () => {
    sdk.issues.mockResolvedValue({ nodes: undefined });

    const results = await client.searchIssues({ state: "Todo" });

    expect(results).toEqual([]);
  });
});

describe("RealLinearClient.postComment", () => {
  it("delegates to sdk.createComment", async () => {
    const client = new RealLinearClient("test-key", makeLogger() as never);
    const createComment = vi.fn().mockResolvedValue(undefined);
    (client as unknown as { sdk: unknown }).sdk = { createComment };

    await client.postComment("issue-1", "Hello");

    expect(createComment).toHaveBeenCalledWith({ issueId: "issue-1", body: "Hello" });
  });
});

describe("RealLinearClient.updateIssueState", () => {
  let client: RealLinearClient;
  let sdk: {
    issue: ReturnType<typeof vi.fn>;
    team: ReturnType<typeof vi.fn>;
    updateIssue: ReturnType<typeof vi.fn>;
  };
  let logger: ReturnType<typeof makeLogger>;

  beforeEach(() => {
    logger = makeLogger();
    client = new RealLinearClient("test-key", logger as never);
    sdk = {
      issue: vi.fn(),
      team: vi.fn(),
      updateIssue: vi.fn().mockResolvedValue(undefined),
    };
    (client as unknown as { sdk: unknown }).sdk = sdk;
  });

  it("resolves the state id for the issue's team and updates the issue", async () => {
    sdk.issue.mockResolvedValue(
      makeFakeIssue({ team: Promise.resolve({ id: "team-1", key: "PRY" }) }),
    );
    sdk.team.mockResolvedValue({
      states: () =>
        Promise.resolve({
          nodes: [
            { id: "s-todo", name: "Todo" },
            { id: "s-done", name: "Done" },
          ],
        }),
    });

    await client.updateIssueState("issue-1", "Done");

    expect(sdk.updateIssue).toHaveBeenCalledWith("issue-1", { stateId: "s-done" });
  });

  it("caches the resolved state map across calls for the same team", async () => {
    sdk.issue.mockResolvedValue(
      makeFakeIssue({ team: Promise.resolve({ id: "team-1", key: "PRY" }) }),
    );
    const statesFn = vi.fn().mockResolvedValue({ nodes: [{ id: "s-todo", name: "Todo" }] });
    sdk.team.mockResolvedValue({ states: statesFn });

    await client.updateIssueState("issue-1", "Todo");
    await client.updateIssueState("issue-1", "Todo");

    expect(sdk.team).toHaveBeenCalledTimes(1);
  });

  it("warns and skips the update when the issue has no team", async () => {
    sdk.issue.mockResolvedValue(makeFakeIssue({ team: Promise.resolve(null) }));

    await client.updateIssueState("issue-1", "Done");

    expect(logger.warn).toHaveBeenCalledWith(
      { issueId: "issue-1" },
      "Cannot update state: issue has no team",
    );
    expect(sdk.updateIssue).not.toHaveBeenCalled();
  });

  it("warns and skips the update when the state name is not found", async () => {
    sdk.issue.mockResolvedValue(
      makeFakeIssue({ team: Promise.resolve({ id: "team-1", key: "PRY" }) }),
    );
    sdk.team.mockResolvedValue({ states: () => Promise.resolve({ nodes: [] }) });

    await client.updateIssueState("issue-1", "Nonexistent");

    expect(logger.warn).toHaveBeenCalledWith(
      { issueId: "issue-1", stateName: "Nonexistent", teamId: "team-1" },
      "Could not find workflow state by name",
    );
    expect(sdk.updateIssue).not.toHaveBeenCalled();
  });
});

describe("RealLinearClient.addLabel", () => {
  let client: RealLinearClient;
  let sdk: {
    issue: ReturnType<typeof vi.fn>;
    issueLabels: ReturnType<typeof vi.fn>;
    createIssueLabel: ReturnType<typeof vi.fn>;
    updateIssue: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    client = new RealLinearClient("test-key", makeLogger() as never);
    sdk = {
      issue: vi.fn(),
      issueLabels: vi.fn(),
      createIssueLabel: vi.fn(),
      updateIssue: vi.fn().mockResolvedValue(undefined),
    };
    (client as unknown as { sdk: unknown }).sdk = sdk;
  });

  it("reuses an existing label and appends it to the issue's labelIds", async () => {
    sdk.issue.mockResolvedValue(
      makeFakeIssue({
        labelIds: ["existing-1"],
        team: Promise.resolve({ id: "team-1", key: "PRY" }),
      }),
    );
    sdk.issueLabels.mockResolvedValue({ nodes: [{ id: "label-1", name: "bug" }] });

    await client.addLabel("issue-1", "bug");

    expect(sdk.createIssueLabel).not.toHaveBeenCalled();
    expect(sdk.updateIssue).toHaveBeenCalledWith("issue-1", {
      labelIds: ["existing-1", "label-1"],
    });
  });

  it("creates a new label scoped to the issue's team when none exists", async () => {
    sdk.issue.mockResolvedValue(
      makeFakeIssue({ labelIds: [], team: Promise.resolve({ id: "team-1", key: "PRY" }) }),
    );
    sdk.issueLabels.mockResolvedValue({ nodes: [] });
    sdk.createIssueLabel.mockResolvedValue({
      issueLabel: Promise.resolve({ id: "new-label", name: "bug" }),
    });

    await client.addLabel("issue-1", "bug");

    expect(sdk.createIssueLabel).toHaveBeenCalledWith({ name: "bug", teamId: "team-1" });
    expect(sdk.updateIssue).toHaveBeenCalledWith("issue-1", { labelIds: ["new-label"] });
  });

  it("does not add a label id the issue already has", async () => {
    sdk.issue.mockResolvedValue(
      makeFakeIssue({ labelIds: ["label-1"], team: Promise.resolve(null) }),
    );
    sdk.issueLabels.mockResolvedValue({ nodes: [{ id: "label-1", name: "bug" }] });

    await client.addLabel("issue-1", "bug");

    expect(sdk.updateIssue).not.toHaveBeenCalled();
  });

  it("throws when label creation does not return an issueLabel", async () => {
    sdk.issue.mockResolvedValue(makeFakeIssue({ labelIds: [], team: Promise.resolve(null) }));
    sdk.issueLabels.mockResolvedValue({ nodes: [] });
    sdk.createIssueLabel.mockResolvedValue({ issueLabel: Promise.resolve(undefined) });

    await expect(client.addLabel("issue-1", "bug")).rejects.toThrow(
      "Failed to create label: bug",
    );
  });
});

describe("RealLinearClient.removeLabel", () => {
  let client: RealLinearClient;
  let sdk: {
    issue: ReturnType<typeof vi.fn>;
    updateIssue: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    client = new RealLinearClient("test-key", makeLogger() as never);
    sdk = { issue: vi.fn(), updateIssue: vi.fn().mockResolvedValue(undefined) };
    (client as unknown as { sdk: unknown }).sdk = sdk;
  });

  it("looks up the label id by name and removes it when not cached", async () => {
    sdk.issue.mockResolvedValue(
      makeFakeIssue({
        labelIds: ["label-1", "label-2"],
        labels: () => Promise.resolve({ nodes: [{ id: "label-1", name: "bug" }] }),
      }),
    );

    await client.removeLabel("issue-1", "bug");

    expect(sdk.updateIssue).toHaveBeenCalledWith("issue-1", { labelIds: ["label-2"] });
  });

  it("is a no-op when the named label is not found on the issue", async () => {
    sdk.issue.mockResolvedValue(
      makeFakeIssue({ labelIds: ["label-1"], labels: () => Promise.resolve({ nodes: [] }) }),
    );

    await client.removeLabel("issue-1", "missing-label");

    expect(sdk.updateIssue).not.toHaveBeenCalled();
  });

  it("uses the cached label id on a subsequent call instead of re-fetching labels", async () => {
    sdk.issue.mockResolvedValue(
      makeFakeIssue({
        labelIds: ["label-1"],
        labels: () => Promise.resolve({ nodes: [{ id: "label-1", name: "bug" }] }),
      }),
    );

    await client.removeLabel("issue-1", "bug");

    sdk.issue.mockResolvedValue(
      makeFakeIssue({
        labelIds: ["label-1"],
        labels: vi.fn(() => {
          throw new Error("should not be called again");
        }),
      }),
    );

    await expect(client.removeLabel("issue-1", "bug")).resolves.toBeUndefined();
    expect(sdk.updateIssue).toHaveBeenCalledWith("issue-1", { labelIds: [] });
  });
});

describe("RealLinearClient.listLabels", () => {
  it("returns label names and populates the label cache", async () => {
    const client = new RealLinearClient("test-key", makeLogger() as never);
    const sdk = {
      issue: vi.fn().mockResolvedValue(
        makeFakeIssue({
          labels: () =>
            Promise.resolve({
              nodes: [
                { id: "l1", name: "bug" },
                { id: "l2", name: "ai:todo" },
              ],
            }),
        }),
      ),
    };
    (client as unknown as { sdk: unknown }).sdk = sdk;

    const labels = await client.listLabels("issue-1");

    expect(labels).toEqual(["bug", "ai:todo"]);
    expect(
      (client as unknown as { labelCache: Map<string, string> }).labelCache.get("bug"),
    ).toBe("l1");
  });

  it("returns an empty array when the issue has no labels", async () => {
    const client = new RealLinearClient("test-key", makeLogger() as never);
    (client as unknown as { sdk: unknown }).sdk = {
      issue: vi.fn().mockResolvedValue(makeFakeIssue({ labels: () => Promise.resolve({ nodes: undefined }) })),
    };

    expect(await client.listLabels("issue-1")).toEqual([]);
  });
});
