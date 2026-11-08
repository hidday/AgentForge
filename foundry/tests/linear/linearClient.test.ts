import { describe, it, expect } from "vitest";
import { MockLinearClient, type LinearIssue } from "../../src/linear/linearClient.js";

function makeIssue(overrides: Partial<LinearIssue> = {}): LinearIssue {
  return {
    id: "issue-1",
    identifier: "PRY-1",
    title: "Issue title",
    description: "",
    branchName: "ai/issue-1",
    state: "Todo",
    labels: [],
    priority: 0,
    ...overrides,
  };
}

describe("MockLinearClient", () => {
  it("getIssue throws for an unseeded issue", () => {
    const client = new MockLinearClient();
    expect(() => client.getIssue("missing")).toThrow("Mock: Issue missing not found");
  });

  it("getIssue returns a clone of the seeded issue", async () => {
    const client = new MockLinearClient();
    const issue = makeIssue();
    client.seedIssue(issue);

    const result = await client.getIssue("issue-1");
    expect(result).toEqual(issue);
    result.title = "mutated";
    expect((await client.getIssue("issue-1")).title).toBe("Issue title");
  });

  it("searchIssues filters by state", async () => {
    const client = new MockLinearClient();
    client.seedIssue(makeIssue({ id: "a", state: "Todo" }));
    client.seedIssue(makeIssue({ id: "b", state: "Done" }));

    const results = await client.searchIssues({ state: "Todo" });
    expect(results.map((i) => i.id)).toEqual(["a"]);
  });

  it("searchIssues filters by projectName when provided", async () => {
    const client = new MockLinearClient();
    client.seedIssue(makeIssue({ id: "a", state: "Todo", project: "Alpha" }));
    client.seedIssue(makeIssue({ id: "b", state: "Todo", project: "Beta" }));

    const results = await client.searchIssues({ state: "Todo", projectName: "Alpha" });
    expect(results.map((i) => i.id)).toEqual(["a"]);
  });

  it("postComment records the comment and getPostedComments returns all of them", async () => {
    const client = new MockLinearClient();
    await client.postComment("issue-1", "hello");
    await client.postComment("issue-1", "world");

    expect(client.getPostedComments()).toEqual([
      { issueId: "issue-1", body: "hello" },
      { issueId: "issue-1", body: "world" },
    ]);
  });

  it("updateIssueState updates the seeded issue's state, and is a no-op when unseeded", async () => {
    const client = new MockLinearClient();
    client.seedIssue(makeIssue({ id: "issue-1", state: "Todo" }));

    await client.updateIssueState("issue-1", "Done");
    expect((await client.getIssue("issue-1")).state).toBe("Done");

    await expect(client.updateIssueState("unknown", "Done")).resolves.toBeUndefined();
  });

  it("addLabel appends a new label without duplicating an existing one", async () => {
    const client = new MockLinearClient();
    client.seedIssue(makeIssue({ id: "issue-1", labels: ["existing"] }));

    await client.addLabel("issue-1", "new-label");
    await client.addLabel("issue-1", "existing");

    const labels = await client.listLabels("issue-1");
    expect(labels).toEqual(["existing", "new-label"]);
  });

  it("addLabel is a no-op when the issue is unseeded", async () => {
    const client = new MockLinearClient();
    await expect(client.addLabel("unknown", "label")).resolves.toBeUndefined();
  });

  it("removeLabel removes an existing label and is a no-op when unseeded", async () => {
    const client = new MockLinearClient();
    client.seedIssue(makeIssue({ id: "issue-1", labels: ["a", "b"] }));

    await client.removeLabel("issue-1", "a");
    expect(await client.listLabels("issue-1")).toEqual(["b"]);

    await expect(client.removeLabel("unknown", "a")).resolves.toBeUndefined();
  });

  it("listLabels returns an empty array for an unseeded issue", async () => {
    const client = new MockLinearClient();
    await expect(client.listLabels("unknown")).resolves.toEqual([]);
  });
});
