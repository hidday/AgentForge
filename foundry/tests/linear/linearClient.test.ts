import { describe, it, expect } from "vitest";
import { MockLinearClient, type LinearIssue } from "../../src/linear/linearClient.js";

function makeIssue(overrides: Partial<LinearIssue> = {}): LinearIssue {
  return {
    id: "issue-1",
    identifier: "PRY-1",
    title: "Issue title",
    description: "Issue description",
    branchName: "ai/issue-1",
    state: "Todo",
    labels: [],
    priority: 0,
    ...overrides,
  };
}

describe("MockLinearClient", () => {
  describe("getIssue", () => {
    it("returns a clone of the seeded issue", async () => {
      const client = new MockLinearClient();
      const issue = makeIssue();
      client.seedIssue(issue);

      const result = await client.getIssue("issue-1");

      expect(result).toEqual(issue);
      expect(result).not.toBe(issue);
    });

    it("mutating the returned issue does not affect subsequent reads", async () => {
      const client = new MockLinearClient();
      client.seedIssue(makeIssue({ title: "Original" }));

      const first = await client.getIssue("issue-1");
      first.title = "Mutated";

      const second = await client.getIssue("issue-1");
      expect(second.title).toBe("Original");
    });

    it("throws synchronously when the issue was never seeded", () => {
      const client = new MockLinearClient();
      expect(() => client.getIssue("missing")).toThrow("Mock: Issue missing not found");
    });
  });

  describe("searchIssues", () => {
    it("matches only issues with the requested state", async () => {
      const client = new MockLinearClient();
      client.seedIssue(makeIssue({ id: "a", state: "Todo" }));
      client.seedIssue(makeIssue({ id: "b", state: "Done" }));

      const results = await client.searchIssues({ state: "Todo" });

      expect(results.map((i) => i.id)).toEqual(["a"]);
    });

    it("filters by projectName when provided", async () => {
      const client = new MockLinearClient();
      client.seedIssue(makeIssue({ id: "a", state: "Todo", project: "alpha" }));
      client.seedIssue(makeIssue({ id: "b", state: "Todo", project: "beta" }));

      const results = await client.searchIssues({ state: "Todo", projectName: "alpha" });

      expect(results.map((i) => i.id)).toEqual(["a"]);
    });

    it("ignores projectName filter when an issue has no project set and filter is absent", async () => {
      const client = new MockLinearClient();
      client.seedIssue(makeIssue({ id: "a", state: "Todo" }));

      const results = await client.searchIssues({ state: "Todo" });

      expect(results.map((i) => i.id)).toEqual(["a"]);
    });

    it("returns an empty array when nothing matches", async () => {
      const client = new MockLinearClient();
      client.seedIssue(makeIssue({ id: "a", state: "Todo" }));

      const results = await client.searchIssues({ state: "Done" });

      expect(results).toEqual([]);
    });

    it("returns clones so mutating results does not affect stored issues", async () => {
      const client = new MockLinearClient();
      client.seedIssue(makeIssue({ id: "a", state: "Todo" }));

      const results = await client.searchIssues({ state: "Todo" });
      results[0].title = "Mutated";

      const second = await client.searchIssues({ state: "Todo" });
      expect(second[0].title).toBe("Issue title");
    });
  });

  describe("postComment / getPostedComments", () => {
    it("records posted comments and exposes them via getPostedComments", async () => {
      const client = new MockLinearClient();

      await client.postComment("issue-1", "First comment");
      await client.postComment("issue-2", "Second comment");

      expect(client.getPostedComments()).toEqual([
        { issueId: "issue-1", body: "First comment" },
        { issueId: "issue-2", body: "Second comment" },
      ]);
    });

    it("getPostedComments returns a copy, not a live reference", async () => {
      const client = new MockLinearClient();
      await client.postComment("issue-1", "Comment");

      const comments = client.getPostedComments();
      comments.push({ issueId: "issue-2", body: "Injected" });

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

  describe("addLabel", () => {
    it("adds a new label to a seeded issue", async () => {
      const client = new MockLinearClient();
      client.seedIssue(makeIssue({ labels: ["existing"] }));

      await client.addLabel("issue-1", "new-label");

      const labels = await client.listLabels("issue-1");
      expect(labels).toEqual(["existing", "new-label"]);
    });

    it("does not duplicate a label that is already present", async () => {
      const client = new MockLinearClient();
      client.seedIssue(makeIssue({ labels: ["existing"] }));

      await client.addLabel("issue-1", "existing");

      const labels = await client.listLabels("issue-1");
      expect(labels).toEqual(["existing"]);
    });

    it("is a no-op when the issue does not exist", async () => {
      const client = new MockLinearClient();
      await expect(client.addLabel("missing", "label")).resolves.toBeUndefined();
    });
  });

  describe("removeLabel", () => {
    it("removes an existing label from a seeded issue", async () => {
      const client = new MockLinearClient();
      client.seedIssue(makeIssue({ labels: ["a", "b"] }));

      await client.removeLabel("issue-1", "a");

      const labels = await client.listLabels("issue-1");
      expect(labels).toEqual(["b"]);
    });

    it("is a no-op when the label is not present", async () => {
      const client = new MockLinearClient();
      client.seedIssue(makeIssue({ labels: ["a"] }));

      await client.removeLabel("issue-1", "not-there");

      const labels = await client.listLabels("issue-1");
      expect(labels).toEqual(["a"]);
    });

    it("is a no-op when the issue does not exist", async () => {
      const client = new MockLinearClient();
      await expect(client.removeLabel("missing", "label")).resolves.toBeUndefined();
    });
  });

  describe("listLabels", () => {
    it("returns an empty array for an issue that does not exist", async () => {
      const client = new MockLinearClient();
      const labels = await client.listLabels("missing");
      expect(labels).toEqual([]);
    });

    it("returns a copy of the labels array", async () => {
      const client = new MockLinearClient();
      client.seedIssue(makeIssue({ labels: ["a"] }));

      const labels = await client.listLabels("issue-1");
      labels.push("injected");

      const second = await client.listLabels("issue-1");
      expect(second).toEqual(["a"]);
    });
  });
});
