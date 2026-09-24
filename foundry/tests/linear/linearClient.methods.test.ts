import { describe, it, expect } from "vitest";
import { MockLinearClient, type LinearIssue } from "../../src/linear/linearClient.js";

// The existing `mockLinearClient.test.ts` covers `getRelatedContext` /
// `seedRelations` in depth. This file covers the remaining MockLinearClient
// methods (getIssue, searchIssues, postComment, updateIssueState, addLabel,
// removeLabel, listLabels, getPostedComments) which are otherwise
// completely uncovered.

function makeIssue(overrides: Partial<LinearIssue> & { id: string }): LinearIssue {
  return {
    title: "Issue title",
    description: "Issue description",
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
    const issue = makeIssue({ id: "issue-1", title: "Fix bug" });
    client.seedIssue(issue);

    const result = await client.getIssue("issue-1");

    expect(result).toEqual(issue);
    expect(result).not.toBe(issue);
  });

  it("throws when the issue was not seeded", () => {
    const client = new MockLinearClient();

    // getIssue throws synchronously (before returning a Promise) when the
    // issue isn't seeded, rather than rejecting.
    expect(() => client.getIssue("missing")).toThrow("Mock: Issue missing not found");
  });
});

describe("MockLinearClient.searchIssues", () => {
  it("matches issues by state only", async () => {
    const client = new MockLinearClient();
    client.seedIssue(makeIssue({ id: "i1", state: "Todo" }));
    client.seedIssue(makeIssue({ id: "i2", state: "Done" }));

    const results = await client.searchIssues({ state: "Todo" });

    expect(results.map((i) => i.id)).toEqual(["i1"]);
  });

  it("filters by projectName when provided", async () => {
    const client = new MockLinearClient();
    client.seedIssue(makeIssue({ id: "i1", state: "Todo", project: "Core" }));
    client.seedIssue(makeIssue({ id: "i2", state: "Todo", project: "Other" }));

    const results = await client.searchIssues({ state: "Todo", projectName: "Core" });

    expect(results.map((i) => i.id)).toEqual(["i1"]);
  });

  it("returns an empty array when nothing matches", async () => {
    const client = new MockLinearClient();
    client.seedIssue(makeIssue({ id: "i1", state: "Todo" }));

    const results = await client.searchIssues({ state: "Done" });

    expect(results).toEqual([]);
  });

  it("returns cloned issues so mutation doesn't affect the store", async () => {
    const client = new MockLinearClient();
    client.seedIssue(makeIssue({ id: "i1", state: "Todo" }));

    const [first] = await client.searchIssues({ state: "Todo" });
    first.title = "Mutated";

    const [second] = await client.searchIssues({ state: "Todo" });
    expect(second.title).toBe("Issue title");
  });
});

describe("MockLinearClient.postComment / getPostedComments", () => {
  it("records posted comments and returns them via getPostedComments", async () => {
    const client = new MockLinearClient();

    await client.postComment("issue-1", "First comment");
    await client.postComment("issue-2", "Second comment");

    expect(client.getPostedComments()).toEqual([
      { issueId: "issue-1", body: "First comment" },
      { issueId: "issue-2", body: "Second comment" },
    ]);
  });

  it("returns a copy so mutating the result does not affect internal state", async () => {
    const client = new MockLinearClient();
    await client.postComment("issue-1", "First comment");

    const comments = client.getPostedComments();
    comments.push({ issueId: "issue-2", body: "Injected" });

    expect(client.getPostedComments()).toEqual([{ issueId: "issue-1", body: "First comment" }]);
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

describe("MockLinearClient.addLabel", () => {
  it("adds a new label to a seeded issue", async () => {
    const client = new MockLinearClient();
    client.seedIssue(makeIssue({ id: "issue-1", labels: ["existing"] }));

    await client.addLabel("issue-1", "new-label");

    const labels = await client.listLabels("issue-1");
    expect(labels).toEqual(["existing", "new-label"]);
  });

  it("does not duplicate a label that is already present", async () => {
    const client = new MockLinearClient();
    client.seedIssue(makeIssue({ id: "issue-1", labels: ["dup"] }));

    await client.addLabel("issue-1", "dup");

    const labels = await client.listLabels("issue-1");
    expect(labels).toEqual(["dup"]);
  });

  it("is a no-op when the issue does not exist", async () => {
    const client = new MockLinearClient();

    await expect(client.addLabel("missing", "label")).resolves.toBeUndefined();
  });
});

describe("MockLinearClient.removeLabel", () => {
  it("removes a label from a seeded issue", async () => {
    const client = new MockLinearClient();
    client.seedIssue(makeIssue({ id: "issue-1", labels: ["a", "b"] }));

    await client.removeLabel("issue-1", "a");

    const labels = await client.listLabels("issue-1");
    expect(labels).toEqual(["b"]);
  });

  it("is a no-op when removing a label that isn't present", async () => {
    const client = new MockLinearClient();
    client.seedIssue(makeIssue({ id: "issue-1", labels: ["a"] }));

    await client.removeLabel("issue-1", "nonexistent");

    const labels = await client.listLabels("issue-1");
    expect(labels).toEqual(["a"]);
  });

  it("is a no-op when the issue does not exist", async () => {
    const client = new MockLinearClient();

    await expect(client.removeLabel("missing", "label")).resolves.toBeUndefined();
  });
});

describe("MockLinearClient.listLabels", () => {
  it("returns a cloned array of labels for a seeded issue", async () => {
    const client = new MockLinearClient();
    client.seedIssue(makeIssue({ id: "issue-1", labels: ["a", "b"] }));

    const labels = await client.listLabels("issue-1");
    labels.push("mutated");

    expect(await client.listLabels("issue-1")).toEqual(["a", "b"]);
  });

  it("returns an empty array when the issue does not exist", async () => {
    const client = new MockLinearClient();

    expect(await client.listLabels("missing")).toEqual([]);
  });
});
