import { describe, it, expect } from "vitest";
import { MockLinearClient, type LinearIssue } from "../../src/linear/linearClient.js";

function makeIssue(overrides: Partial<LinearIssue> & { id: string }): LinearIssue {
  return {
    title: "Issue title",
    description: "Issue description",
    branchName: `ai/${overrides.id}`,
    state: "Todo",
    labels: [],
    priority: 0,
    ...overrides,
  };
}

describe("MockLinearClient", () => {
  describe("getIssue", () => {
    it("returns a copy of the seeded issue", async () => {
      const client = new MockLinearClient();
      client.seedIssue(makeIssue({ id: "issue-1", title: "Original" }));

      const issue = await client.getIssue("issue-1");
      expect(issue.title).toBe("Original");

      // Mutating the result must not leak back into the client's store.
      issue.title = "Mutated";
      const again = await client.getIssue("issue-1");
      expect(again.title).toBe("Original");
    });

    it("throws when the issue was never seeded", () => {
      const client = new MockLinearClient();
      expect(() => client.getIssue("missing")).toThrow("Mock: Issue missing not found");
    });
  });

  describe("searchIssues", () => {
    it("filters by state and project name", async () => {
      const client = new MockLinearClient();
      client.seedIssue(makeIssue({ id: "a", state: "Todo", project: "Alpha" }));
      client.seedIssue(makeIssue({ id: "b", state: "Todo", project: "Beta" }));
      client.seedIssue(makeIssue({ id: "c", state: "Done", project: "Alpha" }));

      const todoOnly = await client.searchIssues({ state: "Todo" });
      expect(todoOnly.map((i) => i.id).sort()).toEqual(["a", "b"]);

      const alphaTodo = await client.searchIssues({ state: "Todo", projectName: "Alpha" });
      expect(alphaTodo.map((i) => i.id)).toEqual(["a"]);
    });

    it("returns an empty array when nothing matches", async () => {
      const client = new MockLinearClient();
      client.seedIssue(makeIssue({ id: "a", state: "Todo" }));

      const result = await client.searchIssues({ state: "Done" });
      expect(result).toEqual([]);
    });
  });

  describe("postComment", () => {
    it("records posted comments and getPostedComments returns a copy", async () => {
      const client = new MockLinearClient();
      await client.postComment("issue-1", "hello");
      await client.postComment("issue-2", "world");

      const comments = client.getPostedComments();
      expect(comments).toEqual([
        { issueId: "issue-1", body: "hello" },
        { issueId: "issue-2", body: "world" },
      ]);

      comments.push({ issueId: "x", body: "y" });
      expect(client.getPostedComments()).toHaveLength(2);
    });
  });

  describe("updateIssueState", () => {
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

  describe("addLabel", () => {
    it("adds a new label to a seeded issue", async () => {
      const client = new MockLinearClient();
      client.seedIssue(makeIssue({ id: "issue-1", labels: ["foo"] }));

      await client.addLabel("issue-1", "bar");

      expect(await client.listLabels("issue-1")).toEqual(["foo", "bar"]);
    });

    it("does not duplicate a label that is already present", async () => {
      const client = new MockLinearClient();
      client.seedIssue(makeIssue({ id: "issue-1", labels: ["foo"] }));

      await client.addLabel("issue-1", "foo");

      expect(await client.listLabels("issue-1")).toEqual(["foo"]);
    });

    it("is a no-op when the issue does not exist", async () => {
      const client = new MockLinearClient();
      await expect(client.addLabel("missing", "foo")).resolves.toBeUndefined();
    });
  });

  describe("removeLabel", () => {
    it("removes an existing label", async () => {
      const client = new MockLinearClient();
      client.seedIssue(makeIssue({ id: "issue-1", labels: ["foo", "bar"] }));

      await client.removeLabel("issue-1", "foo");

      expect(await client.listLabels("issue-1")).toEqual(["bar"]);
    });

    it("is a no-op when removing a label that is not present", async () => {
      const client = new MockLinearClient();
      client.seedIssue(makeIssue({ id: "issue-1", labels: ["bar"] }));

      await client.removeLabel("issue-1", "foo");

      expect(await client.listLabels("issue-1")).toEqual(["bar"]);
    });

    it("is a no-op when the issue does not exist", async () => {
      const client = new MockLinearClient();
      await expect(client.removeLabel("missing", "foo")).resolves.toBeUndefined();
    });
  });

  describe("listLabels", () => {
    it("returns a copy of the issue's labels", async () => {
      const client = new MockLinearClient();
      client.seedIssue(makeIssue({ id: "issue-1", labels: ["foo"] }));

      const labels = await client.listLabels("issue-1");
      labels.push("mutated");

      expect(await client.listLabels("issue-1")).toEqual(["foo"]);
    });

    it("returns an empty array when the issue does not exist", async () => {
      const client = new MockLinearClient();
      await expect(client.listLabels("missing")).resolves.toEqual([]);
    });
  });
});
