import { describe, it, expect } from "vitest";
import { MockLinearClient, type LinearIssue } from "../../src/linear/linearClient.js";

function makeIssue(overrides: Partial<LinearIssue> & { id: string }): LinearIssue {
  return {
    title: "Issue title",
    description: "",
    branchName: "ai/issue-1",
    state: "Todo",
    labels: [],
    priority: 0,
    ...overrides,
  };
}

describe("MockLinearClient.getIssue", () => {
  it("returns a cloned copy of the seeded issue", async () => {
    const client = new MockLinearClient();
    const issue = makeIssue({ id: "i1", title: "Do the thing" });
    client.seedIssue(issue);

    const result = await client.getIssue("i1");

    expect(result).toEqual(issue);
    expect(result).not.toBe(issue);
  });

  it("throws synchronously when the issue was never seeded", () => {
    const client = new MockLinearClient();
    expect(() => client.getIssue("missing")).toThrow("Mock: Issue missing not found");
  });
});

describe("MockLinearClient.searchIssues", () => {
  it("matches only issues with the requested state", async () => {
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

  it("returns clones, not references to the internal store", async () => {
    const client = new MockLinearClient();
    client.seedIssue(makeIssue({ id: "i1", state: "Todo" }));

    const [result] = await client.searchIssues({ state: "Todo" });
    result.title = "Mutated";

    const [again] = await client.searchIssues({ state: "Todo" });
    expect(again.title).toBe("Issue title");
  });
});

describe("MockLinearClient.postComment / getPostedComments", () => {
  it("records posted comments and returns a snapshot copy", async () => {
    const client = new MockLinearClient();

    await client.postComment("i1", "First comment");
    await client.postComment("i1", "Second comment");

    const comments = client.getPostedComments();
    expect(comments).toEqual([
      { issueId: "i1", body: "First comment" },
      { issueId: "i1", body: "Second comment" },
    ]);

    // Mutating the returned array must not affect internal state.
    comments.push({ issueId: "i2", body: "Should not persist" });
    expect(client.getPostedComments()).toHaveLength(2);
  });
});

describe("MockLinearClient.updateIssueState", () => {
  it("updates the state of a seeded issue", async () => {
    const client = new MockLinearClient();
    client.seedIssue(makeIssue({ id: "i1", state: "Todo" }));

    await client.updateIssueState("i1", "Done");

    const issue = await client.getIssue("i1");
    expect(issue.state).toBe("Done");
  });

  it("does nothing when the issue does not exist", async () => {
    const client = new MockLinearClient();
    await expect(client.updateIssueState("missing", "Done")).resolves.toBeUndefined();
  });
});

describe("MockLinearClient.addLabel", () => {
  it("adds a new label to a seeded issue", async () => {
    const client = new MockLinearClient();
    client.seedIssue(makeIssue({ id: "i1", labels: ["foo"] }));

    await client.addLabel("i1", "bar");

    const issue = await client.getIssue("i1");
    expect(issue.labels).toEqual(["foo", "bar"]);
  });

  it("does not duplicate a label that is already present", async () => {
    const client = new MockLinearClient();
    client.seedIssue(makeIssue({ id: "i1", labels: ["foo"] }));

    await client.addLabel("i1", "foo");

    const issue = await client.getIssue("i1");
    expect(issue.labels).toEqual(["foo"]);
  });

  it("does nothing when the issue does not exist", async () => {
    const client = new MockLinearClient();
    await expect(client.addLabel("missing", "foo")).resolves.toBeUndefined();
  });
});

describe("MockLinearClient.removeLabel", () => {
  it("removes an existing label from a seeded issue", async () => {
    const client = new MockLinearClient();
    client.seedIssue(makeIssue({ id: "i1", labels: ["foo", "bar"] }));

    await client.removeLabel("i1", "foo");

    const issue = await client.getIssue("i1");
    expect(issue.labels).toEqual(["bar"]);
  });

  it("is a no-op when the label is not present", async () => {
    const client = new MockLinearClient();
    client.seedIssue(makeIssue({ id: "i1", labels: ["bar"] }));

    await client.removeLabel("i1", "not-there");

    const issue = await client.getIssue("i1");
    expect(issue.labels).toEqual(["bar"]);
  });

  it("does nothing when the issue does not exist", async () => {
    const client = new MockLinearClient();
    await expect(client.removeLabel("missing", "foo")).resolves.toBeUndefined();
  });
});

describe("MockLinearClient.listLabels", () => {
  it("returns a copy of the labels for a seeded issue", async () => {
    const client = new MockLinearClient();
    client.seedIssue(makeIssue({ id: "i1", labels: ["foo", "bar"] }));

    const labels = await client.listLabels("i1");
    expect(labels).toEqual(["foo", "bar"]);

    labels.push("mutated");
    expect(await client.listLabels("i1")).toEqual(["foo", "bar"]);
  });

  it("returns an empty array when the issue does not exist", async () => {
    const client = new MockLinearClient();
    expect(await client.listLabels("missing")).toEqual([]);
  });
});
