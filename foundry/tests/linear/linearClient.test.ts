import { describe, it, expect } from "vitest";
import { MockLinearClient, type LinearIssue } from "../../src/linear/linearClient.js";

function makeIssue(overrides: Partial<LinearIssue> & { id: string }): LinearIssue {
  return {
    title: "Issue",
    description: "desc",
    branchName: "ai/issue",
    state: "Todo",
    labels: [],
    priority: 0,
    ...overrides,
  };
}

describe("MockLinearClient", () => {
  it("getIssue returns a copy of a seeded issue", async () => {
    const client = new MockLinearClient();
    const issue = makeIssue({ id: "i1", labels: ["a"] });
    client.seedIssue(issue);

    const result = await client.getIssue("i1");
    expect(result).toEqual(issue);
    expect(result).not.toBe(issue);
  });

  it("getIssue throws for an unseeded issue id", () => {
    const client = new MockLinearClient();
    expect(() => client.getIssue("missing")).toThrow("Mock: Issue missing not found");
  });

  it("searchIssues filters by state and, when provided, by project", async () => {
    const client = new MockLinearClient();
    client.seedIssue(makeIssue({ id: "i1", state: "Todo", project: "Alpha" }));
    client.seedIssue(makeIssue({ id: "i2", state: "Todo", project: "Beta" }));
    client.seedIssue(makeIssue({ id: "i3", state: "Done", project: "Alpha" }));

    const allTodo = await client.searchIssues({ state: "Todo" });
    expect(allTodo.map((i) => i.id).sort()).toEqual(["i1", "i2"]);

    const alphaTodo = await client.searchIssues({ state: "Todo", projectName: "Alpha" });
    expect(alphaTodo.map((i) => i.id)).toEqual(["i1"]);

    const noneMatch = await client.searchIssues({ state: "Cancelled" });
    expect(noneMatch).toEqual([]);
  });

  it("postComment records the comment and getPostedComments returns a copy", async () => {
    const client = new MockLinearClient();
    await client.postComment("i1", "hello");
    await client.postComment("i2", "world");

    const comments = client.getPostedComments();
    expect(comments).toEqual([
      { issueId: "i1", body: "hello" },
      { issueId: "i2", body: "world" },
    ]);

    comments.push({ issueId: "i3", body: "mutated" });
    expect(client.getPostedComments()).toHaveLength(2);
  });

  it("updateIssueState updates an existing issue's state", async () => {
    const client = new MockLinearClient();
    client.seedIssue(makeIssue({ id: "i1", state: "Todo" }));

    await client.updateIssueState("i1", "In Progress");

    const issue = await client.getIssue("i1");
    expect(issue.state).toBe("In Progress");
  });

  it("updateIssueState is a no-op for an unknown issue", async () => {
    const client = new MockLinearClient();
    await expect(client.updateIssueState("missing", "Done")).resolves.toBeUndefined();
  });

  it("addLabel adds a new label and does not duplicate an existing one", async () => {
    const client = new MockLinearClient();
    client.seedIssue(makeIssue({ id: "i1", labels: ["existing"] }));

    await client.addLabel("i1", "new-label");
    await client.addLabel("i1", "existing");

    expect(await client.listLabels("i1")).toEqual(["existing", "new-label"]);
  });

  it("addLabel is a no-op for an unknown issue", async () => {
    const client = new MockLinearClient();
    await expect(client.addLabel("missing", "label")).resolves.toBeUndefined();
  });

  it("removeLabel removes a label from an existing issue", async () => {
    const client = new MockLinearClient();
    client.seedIssue(makeIssue({ id: "i1", labels: ["a", "b"] }));

    await client.removeLabel("i1", "a");

    expect(await client.listLabels("i1")).toEqual(["b"]);
  });

  it("removeLabel is a no-op for an unknown issue", async () => {
    const client = new MockLinearClient();
    await expect(client.removeLabel("missing", "a")).resolves.toBeUndefined();
  });

  it("listLabels returns [] for an unknown issue", async () => {
    const client = new MockLinearClient();
    expect(await client.listLabels("missing")).toEqual([]);
  });
});
