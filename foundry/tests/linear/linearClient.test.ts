import { describe, it, expect } from "vitest";
import { MockLinearClient, type LinearIssue } from "../../src/linear/linearClient.js";

function makeIssue(overrides: Partial<LinearIssue> = {}): LinearIssue {
  return {
    id: "issue-1",
    identifier: "ENG-1",
    title: "Title",
    description: "Description",
    branchName: "ai/issue-1",
    state: "Todo",
    labels: [],
    priority: 0,
    ...overrides,
  };
}

describe("MockLinearClient.getIssue", () => {
  it("returns the seeded issue's data wrapped in a new top-level object", async () => {
    const client = new MockLinearClient();
    client.seedIssue(makeIssue({ title: "Original title" }));

    const issue = await client.getIssue("issue-1");
    issue.title = "Mutated title";

    const second = await client.getIssue("issue-1");
    expect(second.title).toBe("Original title");
  });

  it("throws synchronously when the issue was never seeded", () => {
    const client = new MockLinearClient();
    expect(() => client.getIssue("missing")).toThrow(/not found/);
  });
});

describe("MockLinearClient.searchIssues", () => {
  it("matches only issues in the requested state", async () => {
    const client = new MockLinearClient();
    client.seedIssue(makeIssue({ id: "a", state: "Todo" }));
    client.seedIssue(makeIssue({ id: "b", state: "Done" }));

    const results = await client.searchIssues({ state: "Todo" });

    expect(results.map((i) => i.id)).toEqual(["a"]);
  });

  it("further filters by projectName when provided", async () => {
    const client = new MockLinearClient();
    client.seedIssue(makeIssue({ id: "a", state: "Todo", project: "Alpha" }));
    client.seedIssue(makeIssue({ id: "b", state: "Todo", project: "Beta" }));

    const results = await client.searchIssues({ state: "Todo", projectName: "Beta" });

    expect(results.map((i) => i.id)).toEqual(["b"]);
  });

  it("returns an empty array when nothing matches", async () => {
    const client = new MockLinearClient();
    client.seedIssue(makeIssue({ id: "a", state: "Todo" }));

    const results = await client.searchIssues({ state: "Done" });

    expect(results).toEqual([]);
  });
});

describe("MockLinearClient.postComment", () => {
  it("records posted comments and getPostedComments returns a copy", async () => {
    const client = new MockLinearClient();
    await client.postComment("issue-1", "hello");

    const comments = client.getPostedComments();
    expect(comments).toEqual([{ issueId: "issue-1", body: "hello" }]);

    comments.push({ issueId: "x", body: "y" });
    expect(client.getPostedComments()).toHaveLength(1);
  });
});

describe("MockLinearClient.updateIssueState", () => {
  it("updates the state of a seeded issue", async () => {
    const client = new MockLinearClient();
    client.seedIssue(makeIssue({ id: "issue-1", state: "Todo" }));

    await client.updateIssueState("issue-1", "Done");

    const issue = await client.getIssue("issue-1");
    expect(issue.state).toBe("Done");
  });

  it("is a no-op when the issue does not exist", async () => {
    const client = new MockLinearClient();
    await expect(client.updateIssueState("missing", "Done")).resolves.toBeUndefined();
  });
});

describe("MockLinearClient.addLabel / removeLabel / listLabels", () => {
  it("adds a label to a seeded issue", async () => {
    const client = new MockLinearClient();
    client.seedIssue(makeIssue({ id: "issue-1", labels: [] }));

    await client.addLabel("issue-1", "ai:todo");

    expect(await client.listLabels("issue-1")).toEqual(["ai:todo"]);
  });

  it("does not add a duplicate label", async () => {
    const client = new MockLinearClient();
    client.seedIssue(makeIssue({ id: "issue-1", labels: ["ai:todo"] }));

    await client.addLabel("issue-1", "ai:todo");

    expect(await client.listLabels("issue-1")).toEqual(["ai:todo"]);
  });

  it("addLabel is a no-op for a missing issue", async () => {
    const client = new MockLinearClient();
    await expect(client.addLabel("missing", "ai:todo")).resolves.toBeUndefined();
  });

  it("removes an existing label", async () => {
    const client = new MockLinearClient();
    client.seedIssue(makeIssue({ id: "issue-1", labels: ["ai:todo", "ai:done"] }));

    await client.removeLabel("issue-1", "ai:todo");

    expect(await client.listLabels("issue-1")).toEqual(["ai:done"]);
  });

  it("removeLabel is a no-op for a missing issue", async () => {
    const client = new MockLinearClient();
    await expect(client.removeLabel("missing", "ai:todo")).resolves.toBeUndefined();
  });

  it("listLabels returns an empty array for a missing issue", async () => {
    const client = new MockLinearClient();
    expect(await client.listLabels("missing")).toEqual([]);
  });
});
