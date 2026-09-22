import { describe, it, expect } from "vitest";
import { MockLinearClient, type LinearIssue } from "../../src/linear/linearClient.js";

function makeIssue(overrides: Partial<LinearIssue> = {}): LinearIssue {
  return {
    id: "issue-1",
    identifier: "ENG-1",
    title: "Title",
    description: "Desc",
    branchName: "ai/issue-1",
    state: "Todo",
    labels: [],
    priority: 0,
    project: undefined,
    ...overrides,
  };
}

describe("MockLinearClient", () => {
  describe("getIssue", () => {
    it("returns a shallow copy: top-level field edits don't affect the store", async () => {
      const client = new MockLinearClient();
      client.seedIssue(makeIssue());

      const issue = await client.getIssue("issue-1");
      issue.title = "Mutated";

      const second = await client.getIssue("issue-1");
      expect(second.title).toBe("Title");
    });

    it("throws synchronously for an unseeded issue id", () => {
      const client = new MockLinearClient();
      expect(() => client.getIssue("missing")).toThrow("Mock: Issue missing not found");
    });
  });

  describe("searchIssues", () => {
    it("filters by state, and by project when projectName is given", async () => {
      const client = new MockLinearClient();
      client.seedIssue(makeIssue({ id: "a", state: "Todo", project: "Proj A" }));
      client.seedIssue(makeIssue({ id: "b", state: "Todo", project: "Proj B" }));
      client.seedIssue(makeIssue({ id: "c", state: "Done", project: "Proj A" }));

      const todoOnly = await client.searchIssues({ state: "Todo" });
      expect(todoOnly.map((i) => i.id).sort()).toEqual(["a", "b"]);

      const projA = await client.searchIssues({ state: "Todo", projectName: "Proj A" });
      expect(projA.map((i) => i.id)).toEqual(["a"]);
    });

    it("returns [] when nothing matches", async () => {
      const client = new MockLinearClient();
      client.seedIssue(makeIssue({ id: "a", state: "Todo" }));

      const result = await client.searchIssues({ state: "Done" });

      expect(result).toEqual([]);
    });
  });

  describe("postComment / getPostedComments", () => {
    it("records posted comments in order", async () => {
      const client = new MockLinearClient();

      await client.postComment("issue-1", "first");
      await client.postComment("issue-2", "second");

      expect(client.getPostedComments()).toEqual([
        { issueId: "issue-1", body: "first" },
        { issueId: "issue-2", body: "second" },
      ]);
    });

    it("returns a copy, not a live reference, from getPostedComments", async () => {
      const client = new MockLinearClient();
      await client.postComment("issue-1", "first");

      const snapshot = client.getPostedComments();
      snapshot.push({ issueId: "x", body: "y" });

      expect(client.getPostedComments()).toHaveLength(1);
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

    it("is a no-op for an unseeded issue id", async () => {
      const client = new MockLinearClient();
      await expect(client.updateIssueState("missing", "Done")).resolves.toBeUndefined();
    });
  });

  describe("addLabel", () => {
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

    it("is a no-op for an unseeded issue id", async () => {
      const client = new MockLinearClient();
      await expect(client.addLabel("missing", "bug")).resolves.toBeUndefined();
    });
  });

  describe("removeLabel", () => {
    it("removes an existing label from a seeded issue", async () => {
      const client = new MockLinearClient();
      client.seedIssue(makeIssue({ id: "issue-1", labels: ["bug", "urgent"] }));

      await client.removeLabel("issue-1", "bug");

      const issue = await client.getIssue("issue-1");
      expect(issue.labels).toEqual(["urgent"]);
    });

    it("is a no-op when the label isn't present", async () => {
      const client = new MockLinearClient();
      client.seedIssue(makeIssue({ id: "issue-1", labels: ["urgent"] }));

      await client.removeLabel("issue-1", "missing-label");

      const issue = await client.getIssue("issue-1");
      expect(issue.labels).toEqual(["urgent"]);
    });

    it("is a no-op for an unseeded issue id", async () => {
      const client = new MockLinearClient();
      await expect(client.removeLabel("missing", "bug")).resolves.toBeUndefined();
    });
  });

  describe("listLabels", () => {
    it("returns the labels of a seeded issue", async () => {
      const client = new MockLinearClient();
      client.seedIssue(makeIssue({ id: "issue-1", labels: ["bug", "urgent"] }));

      const labels = await client.listLabels("issue-1");

      expect(labels).toEqual(["bug", "urgent"]);
    });

    it("returns [] for an unseeded issue id", async () => {
      const client = new MockLinearClient();
      const labels = await client.listLabels("missing");
      expect(labels).toEqual([]);
    });
  });
});
