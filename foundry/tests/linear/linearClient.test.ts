import { describe, it, expect } from "vitest";
import { MockLinearClient, type LinearIssue } from "../../src/linear/linearClient.js";

function makeIssue(overrides: Partial<LinearIssue> = {}): LinearIssue {
  return {
    id: "issue-1",
    identifier: "PRY-1",
    title: "Fix the bug",
    description: "Some description",
    branchName: "ai/issue-1",
    state: "Todo",
    labels: [],
    priority: 1,
    url: "https://linear.app/team/issue/PRY-1",
    project: "Project A",
    team: "PRY",
    cycle: undefined,
    ...overrides,
  };
}

describe("MockLinearClient", () => {
  describe("getIssue", () => {
    it("returns a copy of the seeded issue", async () => {
      const client = new MockLinearClient();
      client.seedIssue(makeIssue());

      const result = await client.getIssue("issue-1");

      expect(result).toEqual(makeIssue());
    });

    it("mutating the returned issue does not affect subsequent reads", async () => {
      const client = new MockLinearClient();
      client.seedIssue(makeIssue());

      const first = await client.getIssue("issue-1");
      first.title = "Mutated";

      const second = await client.getIssue("issue-1");
      expect(second.title).toBe("Fix the bug");
    });

    it("throws synchronously when the issue was never seeded", () => {
      const client = new MockLinearClient();

      // getIssue throws synchronously (before returning a Promise) rather
      // than rejecting, so the throw must be asserted on the call itself.
      expect(() => client.getIssue("missing")).toThrow("Mock: Issue missing not found");
    });
  });

  describe("searchIssues", () => {
    it("matches only issues with the given state", async () => {
      const client = new MockLinearClient();
      client.seedIssue(makeIssue({ id: "a", state: "Todo" }));
      client.seedIssue(makeIssue({ id: "b", state: "Done" }));

      const results = await client.searchIssues({ state: "Todo" });

      expect(results.map((i) => i.id)).toEqual(["a"]);
    });

    it("further filters by projectName when provided", async () => {
      const client = new MockLinearClient();
      client.seedIssue(makeIssue({ id: "a", state: "Todo", project: "Project A" }));
      client.seedIssue(makeIssue({ id: "b", state: "Todo", project: "Project B" }));

      const results = await client.searchIssues({ state: "Todo", projectName: "Project B" });

      expect(results.map((i) => i.id)).toEqual(["b"]);
    });

    it("returns an empty array when nothing matches", async () => {
      const client = new MockLinearClient();
      client.seedIssue(makeIssue({ id: "a", state: "Todo" }));

      const results = await client.searchIssues({ state: "Done" });

      expect(results).toEqual([]);
    });

    it("returns copies so mutating results does not affect stored issues", async () => {
      const client = new MockLinearClient();
      client.seedIssue(makeIssue({ id: "a", state: "Todo" }));

      const results = await client.searchIssues({ state: "Todo" });
      results[0].title = "Mutated";

      const again = await client.searchIssues({ state: "Todo" });
      expect(again[0].title).toBe("Fix the bug");
    });
  });

  describe("postComment", () => {
    it("records the posted comment and makes it available via getPostedComments", async () => {
      const client = new MockLinearClient();

      await client.postComment("issue-1", "hello world");

      expect(client.getPostedComments()).toEqual([{ issueId: "issue-1", body: "hello world" }]);
    });

    it("getPostedComments returns a copy, not a live reference", async () => {
      const client = new MockLinearClient();
      await client.postComment("issue-1", "hello");

      const comments = client.getPostedComments();
      comments.push({ issueId: "x", body: "y" });

      expect(client.getPostedComments()).toHaveLength(1);
    });
  });

  describe("updateIssueState", () => {
    it("updates the state of a seeded issue", async () => {
      const client = new MockLinearClient();
      client.seedIssue(makeIssue({ state: "Todo" }));

      await client.updateIssueState("issue-1", "In Progress");

      const issue = await client.getIssue("issue-1");
      expect(issue.state).toBe("In Progress");
    });

    it("is a no-op when the issue does not exist", async () => {
      const client = new MockLinearClient();

      await expect(client.updateIssueState("missing", "Done")).resolves.toBeUndefined();
    });
  });

  describe("addLabel / removeLabel / listLabels", () => {
    it("adds a label that is not already present", async () => {
      const client = new MockLinearClient();
      client.seedIssue(makeIssue({ labels: ["bug"] }));

      await client.addLabel("issue-1", "urgent");

      await expect(client.listLabels("issue-1")).resolves.toEqual(["bug", "urgent"]);
    });

    it("does not duplicate a label that is already present", async () => {
      const client = new MockLinearClient();
      client.seedIssue(makeIssue({ labels: ["bug"] }));

      await client.addLabel("issue-1", "bug");

      await expect(client.listLabels("issue-1")).resolves.toEqual(["bug"]);
    });

    it("addLabel is a no-op when the issue does not exist", async () => {
      const client = new MockLinearClient();

      await expect(client.addLabel("missing", "bug")).resolves.toBeUndefined();
    });

    it("removes a label that is present", async () => {
      const client = new MockLinearClient();
      client.seedIssue(makeIssue({ labels: ["bug", "urgent"] }));

      await client.removeLabel("issue-1", "urgent");

      await expect(client.listLabels("issue-1")).resolves.toEqual(["bug"]);
    });

    it("removeLabel is a no-op when the label is not present", async () => {
      const client = new MockLinearClient();
      client.seedIssue(makeIssue({ labels: ["bug"] }));

      await client.removeLabel("issue-1", "nonexistent");

      await expect(client.listLabels("issue-1")).resolves.toEqual(["bug"]);
    });

    it("removeLabel is a no-op when the issue does not exist", async () => {
      const client = new MockLinearClient();

      await expect(client.removeLabel("missing", "bug")).resolves.toBeUndefined();
    });

    it("listLabels returns an empty array for a nonexistent issue", async () => {
      const client = new MockLinearClient();

      await expect(client.listLabels("missing")).resolves.toEqual([]);
    });

    it("listLabels returns a copy of the labels array", async () => {
      const client = new MockLinearClient();
      client.seedIssue(makeIssue({ labels: ["bug"] }));

      const labels = await client.listLabels("issue-1");
      labels.push("mutated");

      await expect(client.listLabels("issue-1")).resolves.toEqual(["bug"]);
    });
  });
});
