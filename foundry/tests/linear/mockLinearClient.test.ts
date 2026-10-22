import { describe, it, expect } from "vitest";
import { MockLinearClient, type RelatedLinearIssue } from "../../src/linear/linearClient.js";

function makeRelated(overrides: Partial<RelatedLinearIssue> = {}): RelatedLinearIssue {
  return {
    id: "rel-1",
    identifier: "PRY-200",
    title: "Related issue",
    description: "Description",
    state: "Todo",
    labels: ["foo"],
    priority: 3,
    url: "https://linear.app/team/issue/PRY-200",
    ...overrides,
  };
}

describe("MockLinearClient.getRelatedContext", () => {
  it("returns an empty blockers array when no relations have been seeded", async () => {
    const client = new MockLinearClient();
    client.seedIssue({
      id: "issue-1",
      title: "Focus",
      description: "",
      branchName: "ai/issue-1",
      state: "Todo",
      labels: [],
      priority: 0,
    });

    const ctx = await client.getRelatedContext("issue-1");

    expect(ctx).toEqual({ blockers: [] });
  });

  it("returns seeded parent and blockers via getRelatedContext", async () => {
    const client = new MockLinearClient();
    const parent = makeRelated({ id: "p1", identifier: "PRY-100", title: "Parent" });
    const blocker1 = makeRelated({ id: "b1", identifier: "PRY-101", title: "Blocker 1" });
    const blocker2 = makeRelated({ id: "b2", identifier: "PRY-102", title: "Blocker 2" });

    client.seedRelations("issue-1", { parent, blockers: [blocker1, blocker2] });

    const ctx = await client.getRelatedContext("issue-1");

    expect(ctx.parent).toEqual(parent);
    expect(ctx.blockers).toEqual([blocker1, blocker2]);
  });

  it("returns deep-cloned data so mutating the result does not affect future calls", async () => {
    const client = new MockLinearClient();
    const parent = makeRelated({ id: "p1", identifier: "PRY-100", title: "Original" });
    client.seedRelations("issue-1", { parent, blockers: [] });

    const first = await client.getRelatedContext("issue-1");
    if (first.parent) first.parent.title = "Mutated";

    const second = await client.getRelatedContext("issue-1");
    expect(second.parent?.title).toBe("Original");
  });

  it("supports overwriting previously seeded relations", async () => {
    const client = new MockLinearClient();
    client.seedRelations("issue-1", { blockers: [makeRelated({ id: "old" })] });
    client.seedRelations("issue-1", { blockers: [makeRelated({ id: "new" })] });

    const ctx = await client.getRelatedContext("issue-1");

    expect(ctx.blockers).toHaveLength(1);
    expect(ctx.blockers[0].id).toBe("new");
  });
});

function seedClientWithIssue(client: MockLinearClient, overrides: Record<string, unknown> = {}) {
  client.seedIssue({
    id: "issue-1",
    title: "Focus",
    description: "",
    branchName: "ai/issue-1",
    state: "Todo",
    labels: ["bug"],
    priority: 1,
    project: "Backend",
    ...overrides,
  });
}

describe("MockLinearClient.getIssue", () => {
  it("returns a cloned copy of a seeded issue", async () => {
    const client = new MockLinearClient();
    seedClientWithIssue(client, { title: "Original" });

    const issue = await client.getIssue("issue-1");
    expect(issue.title).toBe("Original");

    issue.title = "Mutated";
    const second = await client.getIssue("issue-1");
    expect(second.title).toBe("Original");
  });

  it("throws when the issue was never seeded", () => {
    const client = new MockLinearClient();
    expect(() => client.getIssue("nope")).toThrow(/not found/);
  });
});

describe("MockLinearClient.postComment / getPostedComments", () => {
  it("records posted comments and returns a defensive copy", async () => {
    const client = new MockLinearClient();
    await client.postComment("issue-1", "First comment");
    await client.postComment("issue-1", "Second comment");

    const comments = client.getPostedComments();
    expect(comments).toEqual([
      { issueId: "issue-1", body: "First comment" },
      { issueId: "issue-1", body: "Second comment" },
    ]);

    comments.push({ issueId: "x", body: "should not leak back" });
    expect(client.getPostedComments()).toHaveLength(2);
  });
});

describe("MockLinearClient.searchIssues", () => {
  it("matches only issues with the same state", async () => {
    const client = new MockLinearClient();
    seedClientWithIssue(client, { id: "todo-1", state: "Todo" });
    seedClientWithIssue(client, { id: "done-1", state: "Done" });

    const results = await client.searchIssues({ state: "Todo" });
    expect(results.map((r) => r.id)).toEqual(["todo-1"]);
  });

  it("further filters by projectName when provided", async () => {
    const client = new MockLinearClient();
    seedClientWithIssue(client, { id: "a", state: "Todo", project: "Backend" });
    seedClientWithIssue(client, { id: "b", state: "Todo", project: "Frontend" });

    const results = await client.searchIssues({ state: "Todo", projectName: "Backend" });
    expect(results.map((r) => r.id)).toEqual(["a"]);
  });

  it("returns an empty array when nothing matches", async () => {
    const client = new MockLinearClient();
    seedClientWithIssue(client, { id: "a", state: "Todo" });

    const results = await client.searchIssues({ state: "Done" });
    expect(results).toEqual([]);
  });
});

describe("MockLinearClient.updateIssueState", () => {
  it("updates the state of a seeded issue", async () => {
    const client = new MockLinearClient();
    seedClientWithIssue(client, { state: "Todo" });

    await client.updateIssueState("issue-1", "In Progress");

    const issue = await client.getIssue("issue-1");
    expect(issue.state).toBe("In Progress");
  });

  it("is a no-op when the issue does not exist", async () => {
    const client = new MockLinearClient();
    await expect(client.updateIssueState("nope", "Done")).resolves.toBeUndefined();
  });
});

describe("MockLinearClient.addLabel / removeLabel / listLabels", () => {
  it("adds a label to a seeded issue", async () => {
    const client = new MockLinearClient();
    seedClientWithIssue(client, { labels: ["bug"] });

    await client.addLabel("issue-1", "urgent");

    expect(await client.listLabels("issue-1")).toEqual(["bug", "urgent"]);
  });

  it("does not add a duplicate label", async () => {
    const client = new MockLinearClient();
    seedClientWithIssue(client, { labels: ["bug"] });

    await client.addLabel("issue-1", "bug");

    expect(await client.listLabels("issue-1")).toEqual(["bug"]);
  });

  it("is a no-op adding a label to a nonexistent issue", async () => {
    const client = new MockLinearClient();
    await expect(client.addLabel("nope", "urgent")).resolves.toBeUndefined();
  });

  it("removes an existing label", async () => {
    const client = new MockLinearClient();
    seedClientWithIssue(client, { labels: ["bug", "urgent"] });

    await client.removeLabel("issue-1", "urgent");

    expect(await client.listLabels("issue-1")).toEqual(["bug"]);
  });

  it("is a no-op removing a label from a nonexistent issue", async () => {
    const client = new MockLinearClient();
    await expect(client.removeLabel("nope", "urgent")).resolves.toBeUndefined();
  });

  it("returns an empty array of labels for a nonexistent issue", async () => {
    const client = new MockLinearClient();
    expect(await client.listLabels("nope")).toEqual([]);
  });
});
