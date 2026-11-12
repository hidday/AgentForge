import { describe, it, expect } from "vitest";
import { MockLinearClient, type LinearIssue } from "../../src/linear/linearClient.js";

function makeIssue(overrides: Partial<LinearIssue> & { id: string }): LinearIssue {
  return {
    title: "Issue",
    description: "Description",
    branchName: "ai/issue",
    state: "Todo",
    labels: [],
    priority: 0,
    ...overrides,
  };
}

describe("MockLinearClient.getIssue", () => {
  it("returns a deep clone of a seeded issue", async () => {
    const client = new MockLinearClient();
    const issue = makeIssue({ id: "issue-1", labels: ["bug"] });
    client.seedIssue(issue);

    const result = await client.getIssue("issue-1");

    expect(result).toEqual(issue);
    result.labels.push("mutated");
    const second = await client.getIssue("issue-1");
    expect(second.labels).toEqual(["bug"]);
  });

  it("throws when the issue was never seeded", async () => {
    const client = new MockLinearClient();

    await expect(client.getIssue("missing-issue")).rejects.toThrow(
      "Mock: Issue missing-issue not found",
    );
  });
});

describe("MockLinearClient.searchIssues", () => {
  it("matches only issues with the requested state", async () => {
    const client = new MockLinearClient();
    client.seedIssue(makeIssue({ id: "a", state: "Todo" }));
    client.seedIssue(makeIssue({ id: "b", state: "Done" }));

    const results = await client.searchIssues({ state: "Todo" });

    expect(results.map((r) => r.id)).toEqual(["a"]);
  });

  it("further filters by projectName when provided", async () => {
    const client = new MockLinearClient();
    client.seedIssue(makeIssue({ id: "a", state: "Todo", project: "Backend" }));
    client.seedIssue(makeIssue({ id: "b", state: "Todo", project: "Frontend" }));

    const results = await client.searchIssues({ state: "Todo", projectName: "Backend" });

    expect(results.map((r) => r.id)).toEqual(["a"]);
  });

  it("excludes an issue with no project when projectName is requested", async () => {
    const client = new MockLinearClient();
    client.seedIssue(makeIssue({ id: "a", state: "Todo" }));

    const results = await client.searchIssues({ state: "Todo", projectName: "Backend" });

    expect(results).toEqual([]);
  });

  it("returns clones, not references to the stored issues", async () => {
    const client = new MockLinearClient();
    client.seedIssue(makeIssue({ id: "a", state: "Todo" }));

    const results = await client.searchIssues({ state: "Todo" });
    results[0].title = "mutated";

    const second = await client.searchIssues({ state: "Todo" });
    expect(second[0].title).toBe("Issue");
  });
});

describe("MockLinearClient.postComment / getPostedComments", () => {
  it("records posted comments and returns a defensive copy", async () => {
    const client = new MockLinearClient();

    await client.postComment("issue-1", "first");
    await client.postComment("issue-1", "second");

    const comments = client.getPostedComments();
    expect(comments).toEqual([
      { issueId: "issue-1", body: "first" },
      { issueId: "issue-1", body: "second" },
    ]);

    comments.push({ issueId: "issue-2", body: "should not persist" });
    expect(client.getPostedComments()).toHaveLength(2);
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

  it("does nothing when the issue was not seeded", async () => {
    const client = new MockLinearClient();

    await expect(client.updateIssueState("missing", "Done")).resolves.toBeUndefined();
  });
});

describe("MockLinearClient.addLabel", () => {
  it("adds a new label to a seeded issue", async () => {
    const client = new MockLinearClient();
    client.seedIssue(makeIssue({ id: "issue-1", labels: ["bug"] }));

    await client.addLabel("issue-1", "urgent");

    const issue = await client.getIssue("issue-1");
    expect(issue.labels).toEqual(["bug", "urgent"]);
  });

  it("does not duplicate a label that is already present", async () => {
    const client = new MockLinearClient();
    client.seedIssue(makeIssue({ id: "issue-1", labels: ["bug"] }));

    await client.addLabel("issue-1", "bug");

    const issue = await client.getIssue("issue-1");
    expect(issue.labels).toEqual(["bug"]);
  });

  it("does nothing when the issue was not seeded", async () => {
    const client = new MockLinearClient();

    await expect(client.addLabel("missing", "bug")).resolves.toBeUndefined();
  });
});

describe("MockLinearClient.removeLabel", () => {
  it("removes a label from a seeded issue", async () => {
    const client = new MockLinearClient();
    client.seedIssue(makeIssue({ id: "issue-1", labels: ["bug", "urgent"] }));

    await client.removeLabel("issue-1", "bug");

    const issue = await client.getIssue("issue-1");
    expect(issue.labels).toEqual(["urgent"]);
  });

  it("does nothing when the label isn't present", async () => {
    const client = new MockLinearClient();
    client.seedIssue(makeIssue({ id: "issue-1", labels: ["urgent"] }));

    await client.removeLabel("issue-1", "bug");

    const issue = await client.getIssue("issue-1");
    expect(issue.labels).toEqual(["urgent"]);
  });

  it("does nothing when the issue was not seeded", async () => {
    const client = new MockLinearClient();

    await expect(client.removeLabel("missing", "bug")).resolves.toBeUndefined();
  });
});

describe("MockLinearClient.listLabels", () => {
  it("returns a copy of the seeded issue's labels", async () => {
    const client = new MockLinearClient();
    client.seedIssue(makeIssue({ id: "issue-1", labels: ["bug", "urgent"] }));

    const labels = await client.listLabels("issue-1");
    expect(labels).toEqual(["bug", "urgent"]);

    labels.push("mutated");
    expect(await client.listLabels("issue-1")).toEqual(["bug", "urgent"]);
  });

  it("returns an empty array when the issue was not seeded", async () => {
    const client = new MockLinearClient();

    const labels = await client.listLabels("missing");
    expect(labels).toEqual([]);
  });
});
