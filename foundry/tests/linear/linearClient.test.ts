import { describe, it, expect } from "vitest";
import { MockLinearClient, type LinearIssue } from "../../src/linear/linearClient.js";

function makeIssue(overrides: Partial<LinearIssue> = {}): LinearIssue {
  return {
    id: "issue-1",
    identifier: "PRY-1",
    title: "Focus issue",
    description: "Description",
    branchName: "ai/issue-1",
    state: "Todo",
    labels: [],
    priority: 0,
    ...overrides,
  };
}

describe("MockLinearClient", () => {
  describe("getIssue", () => {
    it("returns a deep copy of a seeded issue", async () => {
      const client = new MockLinearClient();
      const issue = makeIssue();
      client.seedIssue(issue);

      const fetched = await client.getIssue("issue-1");
      expect(fetched).toEqual(issue);

      fetched.title = "Mutated";
      const second = await client.getIssue("issue-1");
      expect(second.title).toBe("Focus issue");
    });

    it("throws when the issue was not seeded", () => {
      const client = new MockLinearClient();
      expect(() => client.getIssue("missing")).toThrow(/not found/);
    });
  });

  describe("searchIssues", () => {
    it("filters by state", async () => {
      const client = new MockLinearClient();
      client.seedIssue(makeIssue({ id: "a", state: "Todo" }));
      client.seedIssue(makeIssue({ id: "b", state: "Done" }));

      const results = await client.searchIssues({ state: "Todo" });
      expect(results.map((i) => i.id)).toEqual(["a"]);
    });

    it("filters by projectName in addition to state", async () => {
      const client = new MockLinearClient();
      client.seedIssue(makeIssue({ id: "a", state: "Todo", project: "Backend" }));
      client.seedIssue(makeIssue({ id: "b", state: "Todo", project: "Frontend" }));

      const results = await client.searchIssues({ state: "Todo", projectName: "Backend" });
      expect(results.map((i) => i.id)).toEqual(["a"]);
    });

    it("returns an empty array when nothing matches", async () => {
      const client = new MockLinearClient();
      client.seedIssue(makeIssue({ id: "a", state: "Done" }));

      const results = await client.searchIssues({ state: "Todo" });
      expect(results).toEqual([]);
    });
  });

  describe("postComment", () => {
    it("records posted comments and getPostedComments returns a copy", async () => {
      const client = new MockLinearClient();
      await client.postComment("issue-1", "Hello");
      await client.postComment("issue-1", "World");

      const comments = client.getPostedComments();
      expect(comments).toEqual([
        { issueId: "issue-1", body: "Hello" },
        { issueId: "issue-1", body: "World" },
      ]);

      comments.push({ issueId: "x", body: "y" });
      expect(client.getPostedComments()).toHaveLength(2);
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

    it("is a no-op for an unseeded issue", async () => {
      const client = new MockLinearClient();
      await expect(client.updateIssueState("missing", "Done")).resolves.toBeUndefined();
    });
  });

  describe("addLabel / removeLabel / listLabels", () => {
    it("addLabel appends a new label without duplicating an existing one", async () => {
      const client = new MockLinearClient();
      client.seedIssue(makeIssue({ id: "issue-1", labels: ["bug"] }));

      await client.addLabel("issue-1", "urgent");
      await client.addLabel("issue-1", "bug");

      expect(await client.listLabels("issue-1")).toEqual(["bug", "urgent"]);
    });

    it("addLabel is a no-op for an unseeded issue", async () => {
      const client = new MockLinearClient();
      await expect(client.addLabel("missing", "urgent")).resolves.toBeUndefined();
    });

    it("removeLabel drops a label from a seeded issue", async () => {
      const client = new MockLinearClient();
      client.seedIssue(makeIssue({ id: "issue-1", labels: ["bug", "urgent"] }));

      await client.removeLabel("issue-1", "bug");

      expect(await client.listLabels("issue-1")).toEqual(["urgent"]);
    });

    it("removeLabel is a no-op for an unseeded issue", async () => {
      const client = new MockLinearClient();
      await expect(client.removeLabel("missing", "bug")).resolves.toBeUndefined();
    });

    it("listLabels returns an empty array for an unseeded issue", async () => {
      const client = new MockLinearClient();
      await expect(client.listLabels("missing")).resolves.toEqual([]);
    });
  });
});
