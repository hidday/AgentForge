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
    priority: 0,
    project: "Project A",
    ...overrides,
  };
}

describe("MockLinearClient.getIssue", () => {
  it("returns a copy of the seeded issue", async () => {
    const client = new MockLinearClient();
    client.seedIssue(makeIssue());

    const issue = await client.getIssue("issue-1");

    expect(issue).toEqual(makeIssue());
  });

  it("mutating the returned issue does not affect a later getIssue call", async () => {
    const client = new MockLinearClient();
    client.seedIssue(makeIssue());

    const first = await client.getIssue("issue-1");
    first.title = "Mutated";

    const second = await client.getIssue("issue-1");
    expect(second.title).toBe("Focus issue");
  });

  it("throws a descriptive error for an unseeded issue id", () => {
    const client = new MockLinearClient();
    expect(() => client.getIssue("missing")).toThrowError("Mock: Issue missing not found");
  });
});

describe("MockLinearClient.searchIssues", () => {
  it("matches issues by state only when no other filters are given", async () => {
    const client = new MockLinearClient();
    client.seedIssue(makeIssue({ id: "a", state: "Todo" }));
    client.seedIssue(makeIssue({ id: "b", state: "Done" }));

    const results = await client.searchIssues({ state: "Todo" });

    expect(results.map((r) => r.id)).toEqual(["a"]);
  });

  it("filters additionally by projectName when provided", async () => {
    const client = new MockLinearClient();
    client.seedIssue(makeIssue({ id: "a", state: "Todo", project: "Project A" }));
    client.seedIssue(makeIssue({ id: "b", state: "Todo", project: "Project B" }));

    const results = await client.searchIssues({ state: "Todo", projectName: "Project B" });

    expect(results.map((r) => r.id)).toEqual(["b"]);
  });

  it("returns an empty array when nothing matches", async () => {
    const client = new MockLinearClient();
    client.seedIssue(makeIssue({ id: "a", state: "Todo" }));

    const results = await client.searchIssues({ state: "Done" });

    expect(results).toEqual([]);
  });

  it("returns copies so callers cannot mutate internal state", async () => {
    const client = new MockLinearClient();
    client.seedIssue(makeIssue({ id: "a", state: "Todo" }));

    const [result] = await client.searchIssues({ state: "Todo" });
    result.title = "mutated";

    const [again] = await client.searchIssues({ state: "Todo" });
    expect(again.title).toBe("Focus issue");
  });
});

describe("MockLinearClient.postComment", () => {
  it("records posted comments and getPostedComments returns them", async () => {
    const client = new MockLinearClient();

    await client.postComment("issue-1", "First comment");
    await client.postComment("issue-1", "Second comment");

    expect(client.getPostedComments()).toEqual([
      { issueId: "issue-1", body: "First comment" },
      { issueId: "issue-1", body: "Second comment" },
    ]);
  });

  it("getPostedComments returns a copy, not a live reference", async () => {
    const client = new MockLinearClient();
    await client.postComment("issue-1", "Comment");

    const comments = client.getPostedComments();
    comments.push({ issueId: "x", body: "injected" });

    expect(client.getPostedComments()).toHaveLength(1);
  });
});

describe("MockLinearClient.updateIssueState", () => {
  it("updates the state of a seeded issue", async () => {
    const client = new MockLinearClient();
    client.seedIssue(makeIssue({ state: "Todo" }));

    await client.updateIssueState("issue-1", "Done");

    const issue = await client.getIssue("issue-1");
    expect(issue.state).toBe("Done");
  });

  it("is a silent no-op for an unseeded issue id", async () => {
    const client = new MockLinearClient();
    await expect(client.updateIssueState("missing", "Done")).resolves.toBeUndefined();
  });
});

describe("MockLinearClient.addLabel / removeLabel / listLabels", () => {
  it("adds a label and listLabels reflects it", async () => {
    const client = new MockLinearClient();
    client.seedIssue(makeIssue({ labels: ["existing"] }));

    await client.addLabel("issue-1", "ai:planning");

    expect(await client.listLabels("issue-1")).toEqual(["existing", "ai:planning"]);
  });

  it("does not duplicate a label that is already present", async () => {
    const client = new MockLinearClient();
    client.seedIssue(makeIssue({ labels: ["ai:planning"] }));

    await client.addLabel("issue-1", "ai:planning");

    expect(await client.listLabels("issue-1")).toEqual(["ai:planning"]);
  });

  it("removeLabel removes only the matching label", async () => {
    const client = new MockLinearClient();
    client.seedIssue(makeIssue({ labels: ["ai:planning", "bug"] }));

    await client.removeLabel("issue-1", "ai:planning");

    expect(await client.listLabels("issue-1")).toEqual(["bug"]);
  });

  it("removeLabel is a no-op when the label is not present", async () => {
    const client = new MockLinearClient();
    client.seedIssue(makeIssue({ labels: ["bug"] }));

    await client.removeLabel("issue-1", "nonexistent");

    expect(await client.listLabels("issue-1")).toEqual(["bug"]);
  });

  it("addLabel/removeLabel are no-ops for an unseeded issue id", async () => {
    const client = new MockLinearClient();
    await expect(client.addLabel("missing", "x")).resolves.toBeUndefined();
    await expect(client.removeLabel("missing", "x")).resolves.toBeUndefined();
  });

  it("listLabels returns [] for an unseeded issue id", async () => {
    const client = new MockLinearClient();
    expect(await client.listLabels("missing")).toEqual([]);
  });

  it("listLabels returns a copy, not the live array", async () => {
    const client = new MockLinearClient();
    client.seedIssue(makeIssue({ labels: ["bug"] }));

    const labels = await client.listLabels("issue-1");
    labels.push("injected");

    expect(await client.listLabels("issue-1")).toEqual(["bug"]);
  });
});
