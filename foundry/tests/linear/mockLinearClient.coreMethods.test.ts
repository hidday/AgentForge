import { describe, it, expect } from "vitest";
import { MockLinearClient, type LinearIssue } from "../../src/linear/linearClient.js";

function makeIssue(overrides: Partial<LinearIssue> = {}): LinearIssue {
  return {
    id: "issue-1",
    identifier: "PRY-1",
    title: "Focus issue",
    description: "desc",
    branchName: "ai/issue-1",
    state: "Todo",
    labels: [],
    priority: 1,
    project: "Core",
    ...overrides,
  };
}

describe("MockLinearClient core methods", () => {
  it("getIssue returns a deep-cloned copy of a seeded issue", async () => {
    const client = new MockLinearClient();
    const issue = makeIssue();
    client.seedIssue(issue);

    const fetched = await client.getIssue("issue-1");
    expect(fetched).toEqual(issue);

    fetched.title = "Mutated";
    const fetchedAgain = await client.getIssue("issue-1");
    expect(fetchedAgain.title).toBe("Focus issue");
  });

  it("getIssue throws for an unseeded issue id", () => {
    const client = new MockLinearClient();
    expect(() => client.getIssue("missing")).toThrow("Mock: Issue missing not found");
  });

  it("searchIssues filters by state and optional projectName", async () => {
    const client = new MockLinearClient();
    client.seedIssue(makeIssue({ id: "a", state: "Todo", project: "Core" }));
    client.seedIssue(makeIssue({ id: "b", state: "Todo", project: "Other" }));
    client.seedIssue(makeIssue({ id: "c", state: "Done", project: "Core" }));

    const byStateOnly = await client.searchIssues({ state: "Todo" });
    expect(byStateOnly.map((i) => i.id).sort()).toEqual(["a", "b"]);

    const byStateAndProject = await client.searchIssues({ state: "Todo", projectName: "Core" });
    expect(byStateAndProject.map((i) => i.id)).toEqual(["a"]);
  });

  it("searchIssues returns an empty array when nothing matches", async () => {
    const client = new MockLinearClient();
    client.seedIssue(makeIssue({ id: "a", state: "Todo" }));
    const result = await client.searchIssues({ state: "Done" });
    expect(result).toEqual([]);
  });

  it("postComment records the comment and getPostedComments returns a copy", async () => {
    const client = new MockLinearClient();
    await client.postComment("issue-1", "hello");
    await client.postComment("issue-1", "world");

    const comments = client.getPostedComments();
    expect(comments).toEqual([
      { issueId: "issue-1", body: "hello" },
      { issueId: "issue-1", body: "world" },
    ]);
    comments.push({ issueId: "x", body: "y" });
    expect(client.getPostedComments()).toHaveLength(2);
  });

  it("updateIssueState mutates the seeded issue's state", async () => {
    const client = new MockLinearClient();
    client.seedIssue(makeIssue({ id: "issue-1", state: "Todo" }));
    await client.updateIssueState("issue-1", "In Progress");
    const issue = await client.getIssue("issue-1");
    expect(issue.state).toBe("In Progress");
  });

  it("updateIssueState is a no-op for an unseeded issue id", async () => {
    const client = new MockLinearClient();
    await expect(client.updateIssueState("missing", "Done")).resolves.toBeUndefined();
  });

  it("addLabel adds a label once and avoids duplicates", async () => {
    const client = new MockLinearClient();
    client.seedIssue(makeIssue({ id: "issue-1", labels: ["existing"] }));
    await client.addLabel("issue-1", "new-label");
    await client.addLabel("issue-1", "new-label");

    const labels = await client.listLabels("issue-1");
    expect(labels).toEqual(["existing", "new-label"]);
  });

  it("addLabel is a no-op for an unseeded issue id", async () => {
    const client = new MockLinearClient();
    await expect(client.addLabel("missing", "label")).resolves.toBeUndefined();
  });

  it("removeLabel removes a label if present", async () => {
    const client = new MockLinearClient();
    client.seedIssue(makeIssue({ id: "issue-1", labels: ["a", "b"] }));
    await client.removeLabel("issue-1", "a");
    const labels = await client.listLabels("issue-1");
    expect(labels).toEqual(["b"]);
  });

  it("removeLabel is a no-op when the label is not present or issue is unseeded", async () => {
    const client = new MockLinearClient();
    client.seedIssue(makeIssue({ id: "issue-1", labels: ["a"] }));
    await client.removeLabel("issue-1", "not-there");
    expect(await client.listLabels("issue-1")).toEqual(["a"]);

    await expect(client.removeLabel("missing", "a")).resolves.toBeUndefined();
  });

  it("listLabels returns an empty array for an unseeded issue id", async () => {
    const client = new MockLinearClient();
    expect(await client.listLabels("missing")).toEqual([]);
  });

  it("listLabels returns a copy that does not alias the issue's internal labels array", async () => {
    const client = new MockLinearClient();
    client.seedIssue(makeIssue({ id: "issue-1", labels: ["a"] }));
    const labels = await client.listLabels("issue-1");
    labels.push("mutated");
    expect(await client.listLabels("issue-1")).toEqual(["a"]);
  });
});
