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

describe("MockLinearClient", () => {
  it("getIssue returns the seeded issue's fields", async () => {
    const client = new MockLinearClient();
    client.seedIssue(makeIssue({ labels: ["bug"] }));

    const issue = await client.getIssue("issue-1");

    expect(issue).toEqual(makeIssue({ labels: ["bug"] }));
  });

  it("getIssue throws for an unseeded issue", () => {
    const client = new MockLinearClient();
    expect(() => client.getIssue("missing")).toThrow("Mock: Issue missing not found");
  });

  it("searchIssues filters by state and project", async () => {
    const client = new MockLinearClient();
    client.seedIssue(makeIssue({ id: "a", state: "Todo", project: "P1" }));
    client.seedIssue(makeIssue({ id: "b", state: "Todo", project: "P2" }));
    client.seedIssue(makeIssue({ id: "c", state: "Done", project: "P1" }));

    const results = await client.searchIssues({ state: "Todo", projectName: "P1" });

    expect(results.map((r) => r.id)).toEqual(["a"]);
  });

  it("searchIssues with no projectName matches all issues in the given state", async () => {
    const client = new MockLinearClient();
    client.seedIssue(makeIssue({ id: "a", state: "Todo" }));
    client.seedIssue(makeIssue({ id: "b", state: "Todo" }));
    client.seedIssue(makeIssue({ id: "c", state: "Done" }));

    const results = await client.searchIssues({ state: "Todo" });

    expect(results.map((r) => r.id).sort()).toEqual(["a", "b"]);
  });

  it("postComment records posted comments retrievable via getPostedComments", async () => {
    const client = new MockLinearClient();
    await client.postComment("issue-1", "first");
    await client.postComment("issue-1", "second");

    expect(client.getPostedComments()).toEqual([
      { issueId: "issue-1", body: "first" },
      { issueId: "issue-1", body: "second" },
    ]);
  });

  it("updateIssueState updates the seeded issue's state", async () => {
    const client = new MockLinearClient();
    client.seedIssue(makeIssue({ state: "Todo" }));

    await client.updateIssueState("issue-1", "In Progress");

    const issue = await client.getIssue("issue-1");
    expect(issue.state).toBe("In Progress");
  });

  it("updateIssueState is a no-op for an unseeded issue", async () => {
    const client = new MockLinearClient();
    await expect(client.updateIssueState("missing", "Done")).resolves.toBeUndefined();
  });

  describe("addLabel", () => {
    it("adds a new label to an existing issue", async () => {
      const client = new MockLinearClient();
      client.seedIssue(makeIssue({ labels: ["existing"] }));

      await client.addLabel("issue-1", "new-label");

      expect(await client.listLabels("issue-1")).toEqual(["existing", "new-label"]);
    });

    it("does not duplicate a label that is already present", async () => {
      const client = new MockLinearClient();
      client.seedIssue(makeIssue({ labels: ["dup"] }));

      await client.addLabel("issue-1", "dup");

      expect(await client.listLabels("issue-1")).toEqual(["dup"]);
    });

    it("is a no-op for an unseeded issue", async () => {
      const client = new MockLinearClient();
      await expect(client.addLabel("missing", "label")).resolves.toBeUndefined();
    });
  });

  describe("removeLabel", () => {
    it("removes an existing label", async () => {
      const client = new MockLinearClient();
      client.seedIssue(makeIssue({ labels: ["keep", "remove-me"] }));

      await client.removeLabel("issue-1", "remove-me");

      expect(await client.listLabels("issue-1")).toEqual(["keep"]);
    });

    it("is a no-op when the label is not present", async () => {
      const client = new MockLinearClient();
      client.seedIssue(makeIssue({ labels: ["keep"] }));

      await client.removeLabel("issue-1", "absent");

      expect(await client.listLabels("issue-1")).toEqual(["keep"]);
    });

    it("is a no-op for an unseeded issue", async () => {
      const client = new MockLinearClient();
      await expect(client.removeLabel("missing", "label")).resolves.toBeUndefined();
    });
  });

  describe("listLabels", () => {
    it("returns a copy of the issue's labels", async () => {
      const client = new MockLinearClient();
      client.seedIssue(makeIssue({ labels: ["a", "b"] }));

      const labels = await client.listLabels("issue-1");
      labels.push("mutated");

      expect(await client.listLabels("issue-1")).toEqual(["a", "b"]);
    });

    it("returns an empty array for an unseeded issue", async () => {
      const client = new MockLinearClient();
      await expect(client.listLabels("missing")).resolves.toEqual([]);
    });
  });
});
