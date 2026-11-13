import { describe, it, expect } from "vitest";
import { MockLinearClient, type LinearIssue } from "../../src/linear/linearClient.js";

function makeIssue(overrides: Partial<LinearIssue> & { id: string }): LinearIssue {
  return {
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
    it("returns a clone of a previously seeded issue", async () => {
      const client = new MockLinearClient();
      const issue = makeIssue({ id: "issue-1", title: "Original" });
      client.seedIssue(issue);

      const result = await client.getIssue("issue-1");

      expect(result).toEqual(issue);
      expect(result).not.toBe(issue);
    });

    it("mutating the returned issue does not affect subsequent reads", async () => {
      const client = new MockLinearClient();
      client.seedIssue(makeIssue({ id: "issue-1", title: "Original" }));

      const first = await client.getIssue("issue-1");
      first.title = "Mutated";

      const second = await client.getIssue("issue-1");
      expect(second.title).toBe("Original");
    });

    it("throws synchronously when the issue was never seeded", () => {
      const client = new MockLinearClient();

      // getIssue is not an async function, so a missing issue throws
      // synchronously rather than returning a rejected promise.
      expect(() => client.getIssue("missing-issue")).toThrow(
        "Mock: Issue missing-issue not found",
      );
    });
  });

  describe("searchIssues", () => {
    it("filters by state only when no project is specified", async () => {
      const client = new MockLinearClient();
      client.seedIssue(makeIssue({ id: "1", state: "Todo" }));
      client.seedIssue(makeIssue({ id: "2", state: "Done" }));
      client.seedIssue(makeIssue({ id: "3", state: "Todo" }));

      const results = await client.searchIssues({ state: "Todo" });

      expect(results.map((i) => i.id).sort()).toEqual(["1", "3"]);
    });

    it("filters by state and project name together", async () => {
      const client = new MockLinearClient();
      client.seedIssue(makeIssue({ id: "1", state: "Todo", project: "Alpha" }));
      client.seedIssue(makeIssue({ id: "2", state: "Todo", project: "Beta" }));

      const results = await client.searchIssues({ state: "Todo", projectName: "Alpha" });

      expect(results).toHaveLength(1);
      expect(results[0].id).toBe("1");
    });

    it("returns an empty array when nothing matches", async () => {
      const client = new MockLinearClient();
      client.seedIssue(makeIssue({ id: "1", state: "Todo" }));

      const results = await client.searchIssues({ state: "Done" });

      expect(results).toEqual([]);
    });

    it("returns clones, not live references to seeded issues", async () => {
      const client = new MockLinearClient();
      client.seedIssue(makeIssue({ id: "1", state: "Todo", title: "Original" }));

      const results = await client.searchIssues({ state: "Todo" });
      results[0].title = "Mutated";

      const again = await client.searchIssues({ state: "Todo" });
      expect(again[0].title).toBe("Original");
    });
  });

  describe("postComment", () => {
    it("records posted comments and getPostedComments returns a copy", async () => {
      const client = new MockLinearClient();

      await client.postComment("issue-1", "hello world");

      const comments = client.getPostedComments();
      expect(comments).toEqual([{ issueId: "issue-1", body: "hello world" }]);

      comments.push({ issueId: "issue-2", body: "injected" });
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
    it("removes an existing label from a seeded issue", async () => {
      const client = new MockLinearClient();
      client.seedIssue(makeIssue({ id: "issue-1", labels: ["foo", "bar"] }));

      await client.removeLabel("issue-1", "foo");

      expect(await client.listLabels("issue-1")).toEqual(["bar"]);
    });

    it("is a no-op when the label is not present", async () => {
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
      client.seedIssue(makeIssue({ id: "issue-1", labels: ["foo", "bar"] }));

      const labels = await client.listLabels("issue-1");
      labels.push("injected");

      expect(await client.listLabels("issue-1")).toEqual(["foo", "bar"]);
    });

    it("returns an empty array when the issue does not exist", async () => {
      const client = new MockLinearClient();
      await expect(client.listLabels("missing")).resolves.toEqual([]);
    });
  });
});
