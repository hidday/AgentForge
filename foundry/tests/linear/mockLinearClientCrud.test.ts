import { describe, it, expect } from "vitest";
import { MockLinearClient, type LinearIssue } from "../../src/linear/linearClient.js";

function makeIssue(overrides: Partial<LinearIssue> = {}): LinearIssue {
  return {
    id: "issue-1",
    title: "Test issue",
    description: "desc",
    branchName: "ai/issue-1",
    state: "Todo",
    labels: [],
    priority: 0,
    ...overrides,
  };
}

describe("MockLinearClient.getIssue", () => {
  it("returns a cloned copy of a seeded issue", async () => {
    const client = new MockLinearClient();
    const issue = makeIssue();
    client.seedIssue(issue);

    const result = await client.getIssue("issue-1");

    expect(result).toEqual(issue);
    expect(result).not.toBe(issue);
  });

  it("throws synchronously when the issue was never seeded", () => {
    const client = new MockLinearClient();
    expect(() => client.getIssue("missing")).toThrow("Mock: Issue missing not found");
  });
});

describe("MockLinearClient.searchIssues", () => {
  it("filters by state", async () => {
    const client = new MockLinearClient();
    client.seedIssue(makeIssue({ id: "i1", state: "Todo" }));
    client.seedIssue(makeIssue({ id: "i2", state: "Done" }));

    const results = await client.searchIssues({ state: "Todo" });

    expect(results.map((i) => i.id)).toEqual(["i1"]);
  });

  it("further filters by projectName when provided", async () => {
    const client = new MockLinearClient();
    client.seedIssue(makeIssue({ id: "i1", state: "Todo", project: "Alpha" }));
    client.seedIssue(makeIssue({ id: "i2", state: "Todo", project: "Beta" }));

    const results = await client.searchIssues({ state: "Todo", projectName: "Alpha" });

    expect(results.map((i) => i.id)).toEqual(["i1"]);
  });

  it("returns an empty array when nothing matches", async () => {
    const client = new MockLinearClient();
    client.seedIssue(makeIssue({ id: "i1", state: "Done" }));

    const results = await client.searchIssues({ state: "Todo" });

    expect(results).toEqual([]);
  });
});

describe("MockLinearClient.postComment / getPostedComments", () => {
  it("records posted comments and returns a copy of the log", async () => {
    const client = new MockLinearClient();

    await client.postComment("issue-1", "First comment");
    await client.postComment("issue-1", "Second comment");

    const comments = client.getPostedComments();
    expect(comments).toEqual([
      { issueId: "issue-1", body: "First comment" },
      { issueId: "issue-1", body: "Second comment" },
    ]);
  });
});

describe("MockLinearClient.updateIssueState", () => {
  it("updates the state of a seeded issue", async () => {
    const client = new MockLinearClient();
    client.seedIssue(makeIssue({ id: "i1", state: "Todo" }));

    await client.updateIssueState("i1", "In Progress");

    const issue = await client.getIssue("i1");
    expect(issue.state).toBe("In Progress");
  });

  it("is a no-op when the issue does not exist", async () => {
    const client = new MockLinearClient();
    await expect(client.updateIssueState("missing", "Done")).resolves.toBeUndefined();
  });
});

describe("MockLinearClient.addLabel / removeLabel / listLabels", () => {
  it("adds a label to a seeded issue", async () => {
    const client = new MockLinearClient();
    client.seedIssue(makeIssue({ id: "i1", labels: [] }));

    await client.addLabel("i1", "bug");

    expect(await client.listLabels("i1")).toEqual(["bug"]);
  });

  it("does not add a duplicate label", async () => {
    const client = new MockLinearClient();
    client.seedIssue(makeIssue({ id: "i1", labels: ["bug"] }));

    await client.addLabel("i1", "bug");

    expect(await client.listLabels("i1")).toEqual(["bug"]);
  });

  it("removes a label from a seeded issue", async () => {
    const client = new MockLinearClient();
    client.seedIssue(makeIssue({ id: "i1", labels: ["bug", "urgent"] }));

    await client.removeLabel("i1", "bug");

    expect(await client.listLabels("i1")).toEqual(["urgent"]);
  });

  it("is a no-op removing a label from a non-existent issue", async () => {
    const client = new MockLinearClient();
    await expect(client.removeLabel("missing", "bug")).resolves.toBeUndefined();
  });

  it("returns an empty array of labels for a non-existent issue", async () => {
    const client = new MockLinearClient();
    expect(await client.listLabels("missing")).toEqual([]);
  });

  it("addLabel is a no-op for a non-existent issue", async () => {
    const client = new MockLinearClient();
    await expect(client.addLabel("missing", "bug")).resolves.toBeUndefined();
  });
});
