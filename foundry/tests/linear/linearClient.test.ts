import { describe, it, expect } from "vitest";
import { MockLinearClient, type LinearIssue } from "../../src/linear/linearClient.js";

function makeIssue(overrides: Partial<LinearIssue> = {}): LinearIssue {
  return {
    id: "issue-1",
    identifier: "PRY-1",
    title: "Some issue",
    description: "desc",
    branchName: "ai/issue-1",
    state: "Todo",
    labels: [],
    priority: 0,
    ...overrides,
  };
}

describe("MockLinearClient", () => {
  describe("getIssue", () => {
    it("returns a shallow clone (own fields copied) of the seeded issue", async () => {
      const client = new MockLinearClient();
      client.seedIssue(makeIssue());

      const issue = await client.getIssue("issue-1");

      expect(issue).toEqual(makeIssue());
      // Reassigning a field on the returned object must not affect the stored issue.
      issue.title = "mutated title";
      const second = await client.getIssue("issue-1");
      expect(second.title).toBe("Some issue");
    });

    it("throws synchronously when the issue was never seeded", () => {
      const client = new MockLinearClient();
      expect(() => client.getIssue("missing")).toThrow("Mock: Issue missing not found");
    });
  });

  describe("searchIssues", () => {
    it("filters by state and returns clones", async () => {
      const client = new MockLinearClient();
      client.seedIssue(makeIssue({ id: "todo-1", state: "Todo" }));
      client.seedIssue(makeIssue({ id: "done-1", state: "Done" }));

      const results = await client.searchIssues({ state: "Todo" });

      expect(results.map((i) => i.id)).toEqual(["todo-1"]);
    });

    it("filters by projectName in addition to state", async () => {
      const client = new MockLinearClient();
      client.seedIssue(makeIssue({ id: "a", state: "Todo", project: "Alpha" }));
      client.seedIssue(makeIssue({ id: "b", state: "Todo", project: "Beta" }));

      const results = await client.searchIssues({ state: "Todo", projectName: "Alpha" });

      expect(results.map((i) => i.id)).toEqual(["a"]);
    });

    it("returns an empty array when nothing matches", async () => {
      const client = new MockLinearClient();
      client.seedIssue(makeIssue({ id: "a", state: "Todo" }));

      const results = await client.searchIssues({ state: "Done" });

      expect(results).toEqual([]);
    });
  });

  describe("postComment", () => {
    it("records posted comments and exposes them via getPostedComments", async () => {
      const client = new MockLinearClient();

      await client.postComment("issue-1", "first");
      await client.postComment("issue-1", "second");

      expect(client.getPostedComments()).toEqual([
        { issueId: "issue-1", body: "first" },
        { issueId: "issue-1", body: "second" },
      ]);
    });

    it("getPostedComments returns a defensive copy", async () => {
      const client = new MockLinearClient();
      await client.postComment("issue-1", "first");

      const comments = client.getPostedComments();
      comments.push({ issueId: "x", body: "y" });

      expect(client.getPostedComments()).toHaveLength(1);
    });
  });

  describe("updateIssueState", () => {
    it("updates the state of a seeded issue", async () => {
      const client = new MockLinearClient();
      client.seedIssue(makeIssue({ id: "issue-1", state: "Todo" }));

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
    it("adds a label to a seeded issue", async () => {
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

  describe("removeLabel", () => {
    it("removes a matching label from a seeded issue", async () => {
      const client = new MockLinearClient();
      client.seedIssue(makeIssue({ id: "issue-1", labels: ["a", "b"] }));

      await client.removeLabel("issue-1", "a");

      const labels = await client.listLabels("issue-1");
      expect(labels).toEqual(["b"]);
    });

    it("is a no-op when the label is not present", async () => {
      const client = new MockLinearClient();
      client.seedIssue(makeIssue({ id: "issue-1", labels: ["a"] }));

      await client.removeLabel("issue-1", "not-there");

      const labels = await client.listLabels("issue-1");
      expect(labels).toEqual(["a"]);
    });

    it("is a no-op when the issue does not exist", async () => {
      const client = new MockLinearClient();
      await expect(client.removeLabel("missing", "a")).resolves.toBeUndefined();
    });
  });

  describe("listLabels", () => {
    it("returns a clone of the seeded issue's labels", async () => {
      const client = new MockLinearClient();
      client.seedIssue(makeIssue({ id: "issue-1", labels: ["x", "y"] }));

      const labels = await client.listLabels("issue-1");
      labels.push("mutated");

      expect(await client.listLabels("issue-1")).toEqual(["x", "y"]);
    });

    it("returns an empty array for an unknown issue", async () => {
      const client = new MockLinearClient();
      await expect(client.listLabels("missing")).resolves.toEqual([]);
    });
  });
});
