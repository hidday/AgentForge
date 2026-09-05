import { describe, it, expect } from "vitest";
import { MockLinearClient, type LinearIssue } from "../../src/linear/linearClient.js";

function makeIssue(overrides: Partial<LinearIssue> = {}): LinearIssue {
  return {
    id: "issue-1",
    identifier: "PRY-1",
    title: "Some issue",
    description: "Some description",
    branchName: "ai/issue-1",
    state: "Todo",
    labels: [],
    priority: 0,
    ...overrides,
  };
}

describe("MockLinearClient", () => {
  it("getIssue returns a shallow copy of a seeded issue with matching fields", async () => {
    const client = new MockLinearClient();
    const issue = makeIssue();
    client.seedIssue(issue);

    const result = await client.getIssue("issue-1");
    expect(result).toEqual(issue);
    expect(result).not.toBe(issue);
  });

  it("getIssue throws for an unseeded issue id", () => {
    const client = new MockLinearClient();
    expect(() => client.getIssue("missing")).toThrow("Mock: Issue missing not found");
  });

  it("searchIssues filters by state only", async () => {
    const client = new MockLinearClient();
    client.seedIssue(makeIssue({ id: "a", state: "Todo" }));
    client.seedIssue(makeIssue({ id: "b", state: "Done" }));

    const results = await client.searchIssues({ state: "Todo" });
    expect(results.map((i) => i.id)).toEqual(["a"]);
  });

  it("searchIssues filters by state and projectName together", async () => {
    const client = new MockLinearClient();
    client.seedIssue(makeIssue({ id: "a", state: "Todo", project: "Alpha" }));
    client.seedIssue(makeIssue({ id: "b", state: "Todo", project: "Beta" }));
    client.seedIssue(makeIssue({ id: "c", state: "Done", project: "Alpha" }));

    const results = await client.searchIssues({ state: "Todo", projectName: "Alpha" });
    expect(results.map((i) => i.id)).toEqual(["a"]);
  });

  it("searchIssues returns an empty array when nothing matches", async () => {
    const client = new MockLinearClient();
    client.seedIssue(makeIssue({ id: "a", state: "Todo" }));

    const results = await client.searchIssues({ state: "Done" });
    expect(results).toEqual([]);
  });

  it("postComment records the comment and getPostedComments returns a snapshot", async () => {
    const client = new MockLinearClient();
    await client.postComment("issue-1", "hello");
    const snapshot = client.getPostedComments();
    await client.postComment("issue-1", "world");

    expect(snapshot).toEqual([{ issueId: "issue-1", body: "hello" }]);
    expect(client.getPostedComments()).toEqual([
      { issueId: "issue-1", body: "hello" },
      { issueId: "issue-1", body: "world" },
    ]);
  });

  it("updateIssueState updates state on a seeded issue", async () => {
    const client = new MockLinearClient();
    client.seedIssue(makeIssue({ id: "issue-1", state: "Todo" }));

    await client.updateIssueState("issue-1", "In Progress");

    const result = await client.getIssue("issue-1");
    expect(result.state).toBe("In Progress");
  });

  it("updateIssueState on an unseeded issue is a no-op that does not throw", async () => {
    const client = new MockLinearClient();
    await expect(client.updateIssueState("missing", "Done")).resolves.toBeUndefined();
  });

  it("addLabel adds a new label and does not duplicate an existing one", async () => {
    const client = new MockLinearClient();
    client.seedIssue(makeIssue({ id: "issue-1", labels: ["bug"] }));

    await client.addLabel("issue-1", "urgent");
    await client.addLabel("issue-1", "bug");

    const labels = await client.listLabels("issue-1");
    expect(labels).toEqual(["bug", "urgent"]);
  });

  it("addLabel on an unseeded issue is a no-op that does not throw", async () => {
    const client = new MockLinearClient();
    await expect(client.addLabel("missing", "urgent")).resolves.toBeUndefined();
  });

  it("removeLabel removes an existing label", async () => {
    const client = new MockLinearClient();
    client.seedIssue(makeIssue({ id: "issue-1", labels: ["bug", "urgent"] }));

    await client.removeLabel("issue-1", "bug");

    const labels = await client.listLabels("issue-1");
    expect(labels).toEqual(["urgent"]);
  });

  it("removeLabel on an unseeded issue is a no-op that does not throw", async () => {
    const client = new MockLinearClient();
    await expect(client.removeLabel("missing", "bug")).resolves.toBeUndefined();
  });

  it("listLabels returns an empty array for an unseeded issue", async () => {
    const client = new MockLinearClient();
    await expect(client.listLabels("missing")).resolves.toEqual([]);
  });

  it("listLabels returns a snapshot copy, not a live reference", async () => {
    const client = new MockLinearClient();
    client.seedIssue(makeIssue({ id: "issue-1", labels: ["bug"] }));

    const labels = await client.listLabels("issue-1");
    labels.push("mutated");

    const second = await client.listLabels("issue-1");
    expect(second).toEqual(["bug"]);
  });
});
