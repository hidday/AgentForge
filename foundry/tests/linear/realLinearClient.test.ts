import { describe, it, expect, vi } from "vitest";
import { RealLinearClient } from "../../src/linear/realLinearClient.js";

function makeLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };
}

// Minimal shape of the pieces of the Linear SDK this client touches, so we
// can inject a fully controlled fake in place of the real network client.
interface FakeSdk {
  issue: ReturnType<typeof vi.fn>;
  issues: ReturnType<typeof vi.fn>;
  team: ReturnType<typeof vi.fn>;
  createComment: ReturnType<typeof vi.fn>;
  updateIssue: ReturnType<typeof vi.fn>;
  issueLabels: ReturnType<typeof vi.fn>;
  createIssueLabel: ReturnType<typeof vi.fn>;
}

function makeFakeSdk(overrides: Partial<FakeSdk> = {}): FakeSdk {
  return {
    issue: vi.fn(),
    issues: vi.fn(),
    team: vi.fn(),
    createComment: vi.fn().mockResolvedValue(undefined),
    updateIssue: vi.fn().mockResolvedValue(undefined),
    issueLabels: vi.fn(),
    createIssueLabel: vi.fn(),
    ...overrides,
  };
}

function makeClient(sdk: FakeSdk) {
  const client = new RealLinearClient("test-key", makeLogger() as never);
  (client as unknown as { sdk: FakeSdk }).sdk = sdk;
  return client;
}

describe("RealLinearClient.getIssue", () => {
  it("maps an SDK issue with all related fields present", async () => {
    const sdk = makeFakeSdk({
      issue: vi.fn().mockResolvedValue({
        id: "issue-1",
        identifier: "PRY-1",
        title: "Title",
        description: "Desc",
        branchName: "ai/issue-1",
        priority: 2,
        url: "https://linear.app/team/issue/PRY-1",
        labels: () => Promise.resolve({ nodes: [{ id: "l1", name: "bug" }] }),
        state: Promise.resolve({ name: "Todo" }),
        project: Promise.resolve({ name: "Project X" }),
        cycle: Promise.resolve({ name: "Cycle 1" }),
        team: Promise.resolve({ key: "PRY" }),
      }),
    });
    const client = makeClient(sdk);

    const result = await client.getIssue("issue-1");

    expect(sdk.issue).toHaveBeenCalledWith("issue-1");
    expect(result).toEqual({
      id: "issue-1",
      identifier: "PRY-1",
      title: "Title",
      description: "Desc",
      branchName: "ai/issue-1",
      state: "Todo",
      labels: ["bug"],
      priority: 2,
      url: "https://linear.app/team/issue/PRY-1",
      project: "Project X",
      team: "PRY",
      cycle: "Cycle 1",
    });
  });

  it("falls back to defaults when description/state/project/cycle/team/labels are absent", async () => {
    const sdk = makeFakeSdk({
      issue: vi.fn().mockResolvedValue({
        id: "issue-2",
        identifier: "PRY-2",
        title: "Title",
        description: null,
        branchName: "ai/issue-2",
        priority: 0,
        url: "https://linear.app/team/issue/PRY-2",
        labels: () => Promise.resolve({ nodes: undefined }),
        state: Promise.resolve(undefined),
        project: Promise.resolve(undefined),
        cycle: Promise.resolve(undefined),
        team: Promise.resolve(undefined),
      }),
    });
    const client = makeClient(sdk);

    const result = await client.getIssue("issue-2");

    expect(result).toEqual({
      id: "issue-2",
      identifier: "PRY-2",
      title: "Title",
      description: "",
      branchName: "ai/issue-2",
      state: "Unknown",
      labels: [],
      priority: 0,
      url: "https://linear.app/team/issue/PRY-2",
      project: undefined,
      team: undefined,
      cycle: undefined,
    });
  });
});

describe("RealLinearClient.searchIssues", () => {
  function fakeSdkIssue(id: string) {
    return {
      id,
      identifier: `PRY-${id}`,
      title: `Title ${id}`,
      description: "Desc",
      branchName: `ai/${id}`,
      priority: 1,
      url: `https://linear.app/team/issue/${id}`,
      labels: () => Promise.resolve({ nodes: [{ id: "l1", name: "bug" }] }),
      project: Promise.resolve({ name: "Project X" }),
      cycle: Promise.resolve({ name: "Cycle 1" }),
      team: Promise.resolve({ key: "PRY" }),
    };
  }

  it("builds a filter with only state when no other filter fields are set", async () => {
    const issuesMock = vi.fn().mockResolvedValue({ nodes: [fakeSdkIssue("1")] });
    const sdk = makeFakeSdk({ issues: issuesMock });
    const client = makeClient(sdk);

    const results = await client.searchIssues({ state: "Todo" });

    expect(issuesMock).toHaveBeenCalledWith({
      filter: { state: { name: { eq: "Todo" } } },
    });
    expect(results).toEqual([
      {
        id: "1",
        identifier: "PRY-1",
        title: "Title 1",
        description: "Desc",
        branchName: "ai/1",
        state: "Todo",
        labels: ["bug"],
        priority: 1,
        url: "https://linear.app/team/issue/1",
        project: "Project X",
        team: "PRY",
        cycle: "Cycle 1",
      },
    ]);
  });

  it("adds project, assignee and team clauses when provided", async () => {
    const issuesMock = vi.fn().mockResolvedValue({ nodes: [] });
    const sdk = makeFakeSdk({ issues: issuesMock });
    const client = makeClient(sdk);

    await client.searchIssues({
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
  });

  it("returns an empty array when the connection has no nodes", async () => {
    const sdk = makeFakeSdk({ issues: vi.fn().mockResolvedValue({ nodes: undefined }) });
    const client = makeClient(sdk);

    const results = await client.searchIssues({ state: "Todo" });

    expect(results).toEqual([]);
  });

  it("falls back to an empty labels array when labels() itself resolves to a nullish connection", async () => {
    const sdk = makeFakeSdk({
      issues: vi.fn().mockResolvedValue({
        nodes: [
          {
            id: "1",
            identifier: "PRY-1",
            title: "Title",
            description: "Desc",
            branchName: "ai/1",
            priority: 0,
            url: "url",
            labels: () => Promise.resolve(undefined),
            project: Promise.resolve(undefined),
            cycle: Promise.resolve(undefined),
            team: Promise.resolve(undefined),
          },
        ],
      }),
    });
    const client = makeClient(sdk);

    const [result] = await client.searchIssues({ state: "Todo" });

    expect(result.labels).toEqual([]);
  });

  it("falls back to undefined project/team/cycle when absent", async () => {
    const sdk = makeFakeSdk({
      issues: vi.fn().mockResolvedValue({
        nodes: [
          {
            id: "1",
            identifier: "PRY-1",
            title: "Title",
            description: null,
            branchName: "ai/1",
            priority: 0,
            url: "url",
            labels: () => Promise.resolve({ nodes: [] }),
            project: Promise.resolve(undefined),
            cycle: Promise.resolve(undefined),
            team: Promise.resolve(undefined),
          },
        ],
      }),
    });
    const client = makeClient(sdk);

    const [result] = await client.searchIssues({ state: "Todo" });

    expect(result.description).toBe("");
    expect(result.project).toBeUndefined();
    expect(result.team).toBeUndefined();
    expect(result.cycle).toBeUndefined();
  });
});

describe("RealLinearClient.postComment", () => {
  it("creates a comment via the SDK", async () => {
    const sdk = makeFakeSdk();
    const client = makeClient(sdk);

    await client.postComment("issue-1", "Hello world");

    expect(sdk.createComment).toHaveBeenCalledWith({ issueId: "issue-1", body: "Hello world" });
  });
});

describe("RealLinearClient.updateIssueState", () => {
  it("logs and returns without updating when the issue has no team", async () => {
    const sdk = makeFakeSdk({
      issue: vi.fn().mockResolvedValue({ team: Promise.resolve(undefined) }),
    });
    const client = makeClient(sdk);

    await client.updateIssueState("issue-1", "Done");

    expect(sdk.updateIssue).not.toHaveBeenCalled();
  });

  it("logs and returns when the workflow state name cannot be resolved", async () => {
    const sdk = makeFakeSdk({
      issue: vi.fn().mockResolvedValue({ team: Promise.resolve({ id: "team-1" }) }),
      team: vi.fn().mockResolvedValue({
        states: () => Promise.resolve({ nodes: [{ id: "s1", name: "Todo" }] }),
      }),
    });
    const client = makeClient(sdk);

    await client.updateIssueState("issue-1", "Nonexistent State");

    expect(sdk.updateIssue).not.toHaveBeenCalled();
  });

  it("resolves the state id and updates the issue", async () => {
    const sdk = makeFakeSdk({
      issue: vi.fn().mockResolvedValue({ team: Promise.resolve({ id: "team-1" }) }),
      team: vi.fn().mockResolvedValue({
        states: () =>
          Promise.resolve({
            nodes: [
              { id: "s1", name: "Todo" },
              { id: "s2", name: "Done" },
            ],
          }),
      }),
    });
    const client = makeClient(sdk);

    await client.updateIssueState("issue-1", "Done");

    expect(sdk.updateIssue).toHaveBeenCalledWith("issue-1", { stateId: "s2" });
  });

  it("caches the resolved state map per team across calls", async () => {
    const teamMock = vi.fn().mockResolvedValue({
      states: () => Promise.resolve({ nodes: [{ id: "s1", name: "Todo" }] }),
    });
    const sdk = makeFakeSdk({
      issue: vi.fn().mockResolvedValue({ team: Promise.resolve({ id: "team-1" }) }),
      team: teamMock,
    });
    const client = makeClient(sdk);

    await client.updateIssueState("issue-1", "Todo");
    await client.updateIssueState("issue-2", "Todo");

    expect(teamMock).toHaveBeenCalledTimes(1);
  });

  it("handles a states connection with no nodes", async () => {
    const sdk = makeFakeSdk({
      issue: vi.fn().mockResolvedValue({ team: Promise.resolve({ id: "team-1" }) }),
      team: vi.fn().mockResolvedValue({ states: () => Promise.resolve({ nodes: undefined }) }),
    });
    const client = makeClient(sdk);

    await client.updateIssueState("issue-1", "Todo");

    expect(sdk.updateIssue).not.toHaveBeenCalled();
  });
});

describe("RealLinearClient.addLabel", () => {
  it("adds a label found in an existing issueLabels search", async () => {
    const sdk = makeFakeSdk({
      issue: vi.fn().mockResolvedValue({ team: Promise.resolve({ id: "team-1" }), labelIds: [] }),
      issueLabels: vi.fn().mockResolvedValue({ nodes: [{ id: "label-1", name: "bug" }] }),
    });
    const client = makeClient(sdk);

    await client.addLabel("issue-1", "bug");

    expect(sdk.issueLabels).toHaveBeenCalledWith({ filter: { name: { eq: "bug" } } });
    expect(sdk.updateIssue).toHaveBeenCalledWith("issue-1", { labelIds: ["label-1"] });
  });

  it("creates a new label when none exists, scoped to the issue's team", async () => {
    const sdk = makeFakeSdk({
      issue: vi.fn().mockResolvedValue({ team: Promise.resolve({ id: "team-1" }), labelIds: [] }),
      issueLabels: vi.fn().mockResolvedValue({ nodes: [] }),
      createIssueLabel: vi.fn().mockResolvedValue({
        issueLabel: Promise.resolve({ id: "new-label-id" }),
      }),
    });
    const client = makeClient(sdk);

    await client.addLabel("issue-1", "urgent");

    expect(sdk.createIssueLabel).toHaveBeenCalledWith({ name: "urgent", teamId: "team-1" });
    expect(sdk.updateIssue).toHaveBeenCalledWith("issue-1", { labelIds: ["new-label-id"] });
  });

  it("creates a new label without a teamId when the issue has no team", async () => {
    const sdk = makeFakeSdk({
      issue: vi.fn().mockResolvedValue({ team: Promise.resolve(undefined), labelIds: [] }),
      issueLabels: vi.fn().mockResolvedValue({ nodes: [] }),
      createIssueLabel: vi.fn().mockResolvedValue({
        issueLabel: Promise.resolve({ id: "new-label-id" }),
      }),
    });
    const client = makeClient(sdk);

    await client.addLabel("issue-1", "urgent");

    expect(sdk.createIssueLabel).toHaveBeenCalledWith({ name: "urgent" });
  });

  it("throws when label creation succeeds but returns no issueLabel", async () => {
    const sdk = makeFakeSdk({
      issue: vi.fn().mockResolvedValue({ team: Promise.resolve(undefined), labelIds: [] }),
      issueLabels: vi.fn().mockResolvedValue({ nodes: [] }),
      createIssueLabel: vi.fn().mockResolvedValue({ issueLabel: Promise.resolve(undefined) }),
    });
    const client = makeClient(sdk);

    await expect(client.addLabel("issue-1", "urgent")).rejects.toThrow(
      "Failed to create label: urgent",
    );
  });

  it("does not update the issue when the label id is already present", async () => {
    const sdk = makeFakeSdk({
      issue: vi.fn().mockResolvedValue({
        team: Promise.resolve({ id: "team-1" }),
        labelIds: ["label-1"],
      }),
      issueLabels: vi.fn().mockResolvedValue({ nodes: [{ id: "label-1", name: "bug" }] }),
    });
    const client = makeClient(sdk);

    await client.addLabel("issue-1", "bug");

    expect(sdk.updateIssue).not.toHaveBeenCalled();
  });

  it("reuses the label cache on a subsequent call for the same label name", async () => {
    const issueLabelsMock = vi.fn().mockResolvedValue({ nodes: [{ id: "label-1", name: "bug" }] });
    const sdk = makeFakeSdk({
      issue: vi.fn().mockResolvedValue({ team: Promise.resolve({ id: "team-1" }), labelIds: [] }),
      issueLabels: issueLabelsMock,
    });
    const client = makeClient(sdk);

    await client.addLabel("issue-1", "bug");
    await client.addLabel("issue-2", "bug");

    expect(issueLabelsMock).toHaveBeenCalledTimes(1);
  });
});

describe("RealLinearClient.removeLabel", () => {
  it("removes a label found via issue.labels() and caches its id", async () => {
    const sdk = makeFakeSdk({
      issue: vi.fn().mockResolvedValue({
        labelIds: ["label-1", "label-2"],
        labels: () =>
          Promise.resolve({
            nodes: [
              { id: "label-1", name: "bug" },
              { id: "label-2", name: "urgent" },
            ],
          }),
      }),
    });
    const client = makeClient(sdk);

    await client.removeLabel("issue-1", "bug");

    expect(sdk.updateIssue).toHaveBeenCalledWith("issue-1", { labelIds: ["label-2"] });
  });

  it("does nothing when the named label is not found on the issue", async () => {
    const sdk = makeFakeSdk({
      issue: vi.fn().mockResolvedValue({
        labelIds: ["label-2"],
        labels: () => Promise.resolve({ nodes: [{ id: "label-2", name: "urgent" }] }),
      }),
    });
    const client = makeClient(sdk);

    await client.removeLabel("issue-1", "bug");

    expect(sdk.updateIssue).not.toHaveBeenCalled();
  });

  it("uses the cached label id on a subsequent removal, skipping issue.labels()", async () => {
    const labelsMock = vi
      .fn()
      .mockResolvedValue({ nodes: [{ id: "label-1", name: "bug" }] });
    const sdk = makeFakeSdk({
      issue: vi.fn().mockResolvedValue({
        labelIds: ["label-1"],
        labels: labelsMock,
      }),
    });
    const client = makeClient(sdk);

    await client.removeLabel("issue-1", "bug");
    expect(labelsMock).toHaveBeenCalledTimes(1);

    await client.removeLabel("issue-1", "bug");
    expect(labelsMock).toHaveBeenCalledTimes(1);
    expect(sdk.updateIssue).toHaveBeenLastCalledWith("issue-1", { labelIds: [] });
  });
});

describe("RealLinearClient.listLabels", () => {
  it("returns label names and populates the label cache", async () => {
    const sdk = makeFakeSdk({
      issue: vi.fn().mockResolvedValue({
        labelIds: ["label-1"],
        labels: () => Promise.resolve({ nodes: [{ id: "label-1", name: "bug" }] }),
      }),
    });
    const client = makeClient(sdk);

    const names = await client.listLabels("issue-1");

    expect(names).toEqual(["bug"]);

    // Cache now populated: removeLabel should not need issue.labels() again.
    await client.removeLabel("issue-1", "bug");
    expect(sdk.updateIssue).toHaveBeenCalledWith("issue-1", { labelIds: [] });
  });

  it("returns an empty array when there are no label nodes", async () => {
    const sdk = makeFakeSdk({
      issue: vi.fn().mockResolvedValue({
        labelIds: [],
        labels: () => Promise.resolve({ nodes: undefined }),
      }),
    });
    const client = makeClient(sdk);

    await expect(client.listLabels("issue-1")).resolves.toEqual([]);
  });
});

describe("RealLinearClient.getRelatedContext nullish connections", () => {
  it("treats an inverseRelations() result with no nodes property as having no relations", async () => {
    const client = new RealLinearClient("test-key", makeLogger() as never);
    const focusIssue = {
      id: "focus-id",
      parent: Promise.resolve(null),
      inverseRelations: () => Promise.resolve(undefined),
    };
    (client as unknown as { sdk: { issue: (id: string) => Promise<unknown> } }).sdk = {
      issue: () => Promise.resolve(focusIssue),
    };

    const ctx = await client.getRelatedContext("focus-id");

    expect(ctx.blockers).toEqual([]);
  });

  it("falls back to an empty labels array and 'Unknown' state for a parent with nullish connections", async () => {
    const client = new RealLinearClient("test-key", makeLogger() as never);
    const parent = {
      id: "parent-id",
      identifier: "PRY-100",
      title: "Parent",
      description: "Desc",
      priority: 0,
      url: "url",
      labels: () => Promise.resolve(undefined),
      state: Promise.resolve(undefined),
    };
    const focusIssue = {
      id: "focus-id",
      parent: Promise.resolve(parent),
      inverseRelations: () => Promise.resolve({ nodes: [] }),
    };
    (client as unknown as { sdk: { issue: (id: string) => Promise<unknown> } }).sdk = {
      issue: (id: string) =>
        id === "parent-id" ? Promise.resolve(parent) : Promise.resolve(focusIssue),
    };

    const ctx = await client.getRelatedContext("focus-id");

    expect(ctx.parent).toEqual({
      id: "parent-id",
      identifier: "PRY-100",
      title: "Parent",
      description: "Desc",
      state: "Unknown",
      labels: [],
      priority: 0,
      url: "url",
    });
  });
});

describe("RealLinearClient.getRelatedContext blocker hydration failure", () => {
  it("logs a warning and drops a blocker whose relation.issue rejects", async () => {
    const logger = makeLogger();
    const client = new RealLinearClient("test-key", logger as never);
    const focusIssue = {
      id: "focus-id",
      parent: Promise.resolve(null),
      inverseRelations: () =>
        Promise.resolve({
          nodes: [
            { id: "rel-1", type: "blocks", issue: Promise.reject(new Error("hydrate failed")) },
          ],
        }),
    };
    (client as unknown as { sdk: { issue: (id: string) => Promise<unknown> } }).sdk = {
      issue: (id: string) =>
        id === "focus-id" ? Promise.resolve(focusIssue) : Promise.reject(new Error("not seeded")),
    };

    const ctx = await client.getRelatedContext("focus-id");

    expect(ctx.blockers).toEqual([]);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ relationId: "rel-1", focusIssueId: "focus-id" }),
      "Failed to hydrate blocker issue from relation",
    );
  });
});

describe("RealLinearClient constructor", () => {
  it("constructs without throwing given an api key and logger", () => {
    expect(() => new RealLinearClient("test-key", makeLogger() as never)).not.toThrow();
  });
});
