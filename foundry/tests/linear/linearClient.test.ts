import { describe, it, expect } from "vitest";
import { MockLinearClient, type LinearIssue } from "../../src/linear/linearClient.js";

function makeIssue(overrides: Partial<LinearIssue> = {}): LinearIssue {
  return {
    id: "issue-1",
    identifier: "ENG-1",
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
  it("returns a copy of the seeded issue (not the same object reference)", async () => {
    const client = new MockLinearClient();
    const issue = makeIssue({ labels: ["bug"] });
    client.seedIssue(issue);

    const result = await client.getIssue("issue-1");

    expect(result).toEqual(issue);
    expect(result).not.toBe(issue);
    result.title = "Mutated";
    const second = await client.getIssue("issue-1");
    expect(second.title).toBe("Issue title");
  });

  it("throws synchronously when the issue was not seeded", () => {
    const client = new MockLinearClient();
    expect(() => client.getIssue("missing")).toThrow("Mock: Issue missing not found");
  });
});

describe("MockLinearClient.searchIssues", () => {
  it("matches only issues with the given state", async () => {
    const client = new MockLinearClient();
    client.seedIssue(makeIssue({ id: "a", state: "Todo" }));
    client.seedIssue(makeIssue({ id: "b", state: "Done" }));

    const results = await client.searchIssues({ state: "Todo" });

    expect(results.map((i) => i.id)).toEqual(["a"]);
  });

  it("filters by projectName when provided", async () => {
    const client = new MockLinearClient();
    client.seedIssue(makeIssue({ id: "a", state: "Todo", project: "Alpha" }));
    client.seedIssue(makeIssue({ id: "b", state: "Todo", project: "Beta" }));

    const results = await client.searchIssues({ state: "Todo", projectName: "Beta" });

    expect(results.map((i) => i.id)).toEqual(["b"]);
  });

  it("excludes issues missing the requested project when projectName is set", async () => {
    const client = new MockLinearClient();
    client.seedIssue(makeIssue({ id: "a", state: "Todo" }));

    const results = await client.searchIssues({ state: "Todo", projectName: "Beta" });

    expect(results).toEqual([]);
  });

  it("returns clones, not references, of matched issues", async () => {
    const client = new MockLinearClient();
    client.seedIssue(makeIssue({ id: "a", state: "Todo" }));

    const [result] = await client.searchIssues({ state: "Todo" });
    result.title = "Mutated";

    const [second] = await client.searchIssues({ state: "Todo" });
    expect(second.title).toBe("Issue title");
  });

  it("returns an empty array when no issues match", async () => {
    const client = new MockLinearClient();
    client.seedIssue(makeIssue({ id: "a", state: "Done" }));

    const results = await client.searchIssues({ state: "Todo" });

    expect(results).toEqual([]);
  });
});

describe("MockLinearClient.postComment", () => {
  it("records posted comments and exposes them via getPostedComments", async () => {
    const client = new MockLinearClient();

    await client.postComment("issue-1", "First comment");
    await client.postComment("issue-1", "Second comment");

    expect(client.getPostedComments()).toEqual([
      { issueId: "issue-1", body: "First comment" },
      { issueId: "issue-1", body: "Second comment" },
    ]);
  });

  it("returns a copy so mutating the returned array does not affect internal state", async () => {
    const client = new MockLinearClient();
    await client.postComment("issue-1", "Comment");

    const comments = client.getPostedComments();
    comments.push({ issueId: "issue-2", body: "Injected" });

    expect(client.getPostedComments()).toHaveLength(1);
  });
});

describe("MockLinearClient.updateIssueState", () => {
  it("updates the state of an existing issue", async () => {
    const client = new MockLinearClient();
    client.seedIssue(makeIssue({ id: "issue-1", state: "Todo" }));

    await client.updateIssueState("issue-1", "Done");

    const issue = await client.getIssue("issue-1");
    expect(issue.state).toBe("Done");
  });

  it("does nothing (and does not throw) when the issue does not exist", async () => {
    const client = new MockLinearClient();

    await expect(client.updateIssueState("missing", "Done")).resolves.toBeUndefined();
  });
});

describe("MockLinearClient.addLabel", () => {
  it("adds a label to an existing issue", async () => {
    const client = new MockLinearClient();
    client.seedIssue(makeIssue({ id: "issue-1", labels: [] }));

    await client.addLabel("issue-1", "bug");

    const issue = await client.getIssue("issue-1");
    expect(issue.labels).toEqual(["bug"]);
  });

  it("does not duplicate a label that is already present", async () => {
    const client = new MockLinearClient();
    client.seedIssue(makeIssue({ id: "issue-1", labels: ["bug"] }));

    await client.addLabel("issue-1", "bug");

    const issue = await client.getIssue("issue-1");
    expect(issue.labels).toEqual(["bug"]);
  });

  it("does nothing when the issue does not exist", async () => {
    const client = new MockLinearClient();

    await expect(client.addLabel("missing", "bug")).resolves.toBeUndefined();
  });
});

describe("MockLinearClient.removeLabel", () => {
  it("removes an existing label from an issue", async () => {
    const client = new MockLinearClient();
    client.seedIssue(makeIssue({ id: "issue-1", labels: ["bug", "infra"] }));

    await client.removeLabel("issue-1", "bug");

    const issue = await client.getIssue("issue-1");
    expect(issue.labels).toEqual(["infra"]);
  });

  it("does nothing when the label is not present on the issue", async () => {
    const client = new MockLinearClient();
    client.seedIssue(makeIssue({ id: "issue-1", labels: ["infra"] }));

    await client.removeLabel("issue-1", "bug");

    const issue = await client.getIssue("issue-1");
    expect(issue.labels).toEqual(["infra"]);
  });

  it("does nothing (and does not throw) when the issue does not exist", async () => {
    const client = new MockLinearClient();

    await expect(client.removeLabel("missing", "bug")).resolves.toBeUndefined();
  });
});

describe("MockLinearClient.listLabels", () => {
  it("returns a copy of the issue's labels", async () => {
    const client = new MockLinearClient();
    client.seedIssue(makeIssue({ id: "issue-1", labels: ["bug", "infra"] }));

    const labels = await client.listLabels("issue-1");

    expect(labels).toEqual(["bug", "infra"]);
    labels.push("mutated");
    expect(await client.listLabels("issue-1")).toEqual(["bug", "infra"]);
  });

  it("returns an empty array when the issue does not exist", async () => {
    const client = new MockLinearClient();

    const labels = await client.listLabels("missing");

    expect(labels).toEqual([]);
  });
});
