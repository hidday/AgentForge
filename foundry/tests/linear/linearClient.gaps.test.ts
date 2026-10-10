import { describe, it, expect } from "vitest";
import { MockLinearClient, type LinearIssue } from "../../src/linear/linearClient.js";

function makeIssue(overrides: Partial<LinearIssue> & { id: string }): LinearIssue {
  return {
    title: "Issue title",
    description: "desc",
    branchName: "ai/issue",
    state: "Todo",
    labels: [],
    priority: 0,
    ...overrides,
  };
}

describe("MockLinearClient (gaps not covered by mockLinearClient.test.ts)", () => {
  it("getIssue returns a cloned seeded issue", async () => {
    const client = new MockLinearClient();
    const seeded = makeIssue({ id: "issue-1", title: "Hello", labels: ["a"] });
    client.seedIssue(seeded);

    const result = await client.getIssue("issue-1");

    expect(result).toEqual(seeded);
    expect(result).not.toBe(seeded);
  });

  it("getIssue throws for an unseeded issue id", async () => {
    const client = new MockLinearClient();
    await expect(client.getIssue("missing")).rejects.toThrow("Mock: Issue missing not found");
  });

  it("searchIssues filters by state only", async () => {
    const client = new MockLinearClient();
    client.seedIssue(makeIssue({ id: "a", state: "Todo" }));
    client.seedIssue(makeIssue({ id: "b", state: "Done" }));

    const results = await client.searchIssues({ state: "Todo" });

    expect(results).toHaveLength(1);
    expect(results[0].id).toBe("a");
  });

  it("searchIssues filters by state and projectName together", async () => {
    const client = new MockLinearClient();
    client.seedIssue(makeIssue({ id: "a", state: "Todo", project: "Alpha" }));
    client.seedIssue(makeIssue({ id: "b", state: "Todo", project: "Beta" }));
    client.seedIssue(makeIssue({ id: "c", state: "Done", project: "Alpha" }));

    const results = await client.searchIssues({ state: "Todo", projectName: "Alpha" });

    expect(results).toHaveLength(1);
    expect(results[0].id).toBe("a");
  });

  it("searchIssues ignores projectName filter when not provided", async () => {
    const client = new MockLinearClient();
    client.seedIssue(makeIssue({ id: "a", state: "Todo", project: "Alpha" }));
    client.seedIssue(makeIssue({ id: "b", state: "Todo", project: "Beta" }));

    const results = await client.searchIssues({ state: "Todo" });

    expect(results.map((r) => r.id).sort()).toEqual(["a", "b"]);
  });

  it("searchIssues returns cloned issues, not live references", async () => {
    const client = new MockLinearClient();
    client.seedIssue(makeIssue({ id: "a", state: "Todo" }));

    const [result] = await client.searchIssues({ state: "Todo" });
    result.title = "Mutated";

    const [second] = await client.searchIssues({ state: "Todo" });
    expect(second.title).toBe("Issue title");
  });

  it("postComment records the comment and getPostedComments returns it", async () => {
    const client = new MockLinearClient();
    await client.postComment("issue-1", "hello world");
    await client.postComment("issue-2", "another comment");

    expect(client.getPostedComments()).toEqual([
      { issueId: "issue-1", body: "hello world" },
      { issueId: "issue-2", body: "another comment" },
    ]);
  });

  it("updateIssueState updates the state of a seeded issue", async () => {
    const client = new MockLinearClient();
    client.seedIssue(makeIssue({ id: "issue-1", state: "Todo" }));

    await client.updateIssueState("issue-1", "Done");

    const issue = await client.getIssue("issue-1");
    expect(issue.state).toBe("Done");
  });

  it("updateIssueState is a no-op for an unseeded issue id", async () => {
    const client = new MockLinearClient();
    await expect(client.updateIssueState("missing", "Done")).resolves.toBeUndefined();
  });

  it("addLabel appends a new label to a seeded issue", async () => {
    const client = new MockLinearClient();
    client.seedIssue(makeIssue({ id: "issue-1", labels: ["existing"] }));

    await client.addLabel("issue-1", "new-label");

    const labels = await client.listLabels("issue-1");
    expect(labels).toEqual(["existing", "new-label"]);
  });

  it("addLabel does not duplicate a label that is already present", async () => {
    const client = new MockLinearClient();
    client.seedIssue(makeIssue({ id: "issue-1", labels: ["existing"] }));

    await client.addLabel("issue-1", "existing");

    const labels = await client.listLabels("issue-1");
    expect(labels).toEqual(["existing"]);
  });

  it("addLabel is a no-op for an unseeded issue id", async () => {
    const client = new MockLinearClient();
    await expect(client.addLabel("missing", "label")).resolves.toBeUndefined();
  });

  it("removeLabel removes an existing label from a seeded issue", async () => {
    const client = new MockLinearClient();
    client.seedIssue(makeIssue({ id: "issue-1", labels: ["a", "b"] }));

    await client.removeLabel("issue-1", "a");

    const labels = await client.listLabels("issue-1");
    expect(labels).toEqual(["b"]);
  });

  it("removeLabel is a no-op for an unseeded issue id", async () => {
    const client = new MockLinearClient();
    await expect(client.removeLabel("missing", "a")).resolves.toBeUndefined();
  });

  it("listLabels returns an empty array for an unseeded issue id", async () => {
    const client = new MockLinearClient();
    await expect(client.listLabels("missing")).resolves.toEqual([]);
  });

  it("listLabels returns a cloned array for a seeded issue", async () => {
    const client = new MockLinearClient();
    client.seedIssue(makeIssue({ id: "issue-1", labels: ["a"] }));

    const labels = await client.listLabels("issue-1");
    labels.push("mutated");

    const second = await client.listLabels("issue-1");
    expect(second).toEqual(["a"]);
  });
});
