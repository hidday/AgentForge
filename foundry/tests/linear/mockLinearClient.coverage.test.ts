import { describe, it, expect } from "vitest";
import { MockLinearClient, type LinearIssue } from "../../src/linear/linearClient.js";

function makeIssue(overrides: Partial<LinearIssue> = {}): LinearIssue {
  return {
    id: "issue-1",
    identifier: "PRY-1",
    title: "Issue",
    description: "",
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
      client.seedIssue(makeIssue({ title: "Original" }));

      const issue = await client.getIssue("issue-1");
      issue.title = "Mutated";

      const second = await client.getIssue("issue-1");
      expect(second.title).toBe("Original");
    });

    it("throws synchronously for an unseeded issue id", () => {
      const client = new MockLinearClient();
      expect(() => client.getIssue("missing")).toThrow(/not found/);
    });
  });

  describe("searchIssues", () => {
    it("matches on state and optional project name", async () => {
      const client = new MockLinearClient();
      client.seedIssue(makeIssue({ id: "a", state: "Todo", project: "Core" }));
      client.seedIssue(makeIssue({ id: "b", state: "Todo", project: "Other" }));
      client.seedIssue(makeIssue({ id: "c", state: "Done", project: "Core" }));

      const results = await client.searchIssues({ state: "Todo", projectName: "Core" });

      expect(results.map((r) => r.id)).toEqual(["a"]);
    });

    it("matches purely on state when no projectName filter is given", async () => {
      const client = new MockLinearClient();
      client.seedIssue(makeIssue({ id: "a", state: "Todo" }));
      client.seedIssue(makeIssue({ id: "b", state: "Done" }));

      const results = await client.searchIssues({ state: "Todo" });

      expect(results.map((r) => r.id)).toEqual(["a"]);
    });
  });

  describe("postComment", () => {
    it("records posted comments", async () => {
      const client = new MockLinearClient();
      await client.postComment("issue-1", "hello");
      await client.postComment("issue-1", "world");

      expect(client.getPostedComments()).toEqual([
        { issueId: "issue-1", body: "hello" },
        { issueId: "issue-1", body: "world" },
      ]);
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

    it("is a no-op for an unseeded issue", async () => {
      const client = new MockLinearClient();
      await expect(client.updateIssueState("missing", "Done")).resolves.toBeUndefined();
    });
  });

  describe("addLabel", () => {
    it("adds a new label without duplicating an existing one", async () => {
      const client = new MockLinearClient();
      client.seedIssue(makeIssue({ labels: ["foo"] }));

      await client.addLabel("issue-1", "bar");
      await client.addLabel("issue-1", "foo");

      const issue = await client.getIssue("issue-1");
      expect(issue.labels).toEqual(["foo", "bar"]);
    });

    it("is a no-op for an unseeded issue", async () => {
      const client = new MockLinearClient();
      await expect(client.addLabel("missing", "bar")).resolves.toBeUndefined();
    });
  });

  describe("removeLabel", () => {
    it("removes a label from a seeded issue", async () => {
      const client = new MockLinearClient();
      client.seedIssue(makeIssue({ labels: ["foo", "bar"] }));

      await client.removeLabel("issue-1", "foo");

      const issue = await client.getIssue("issue-1");
      expect(issue.labels).toEqual(["bar"]);
    });

    it("is a no-op when removing a label that is not present", async () => {
      const client = new MockLinearClient();
      client.seedIssue(makeIssue({ labels: ["bar"] }));

      await client.removeLabel("issue-1", "foo");

      const issue = await client.getIssue("issue-1");
      expect(issue.labels).toEqual(["bar"]);
    });

    it("is a no-op for an unseeded issue", async () => {
      const client = new MockLinearClient();
      await expect(client.removeLabel("missing", "foo")).resolves.toBeUndefined();
    });
  });

  describe("listLabels", () => {
    it("returns a clone of the seeded issue's labels", async () => {
      const client = new MockLinearClient();
      client.seedIssue(makeIssue({ labels: ["foo", "bar"] }));

      const labels = await client.listLabels("issue-1");
      labels.push("mutated");

      expect(await client.listLabels("issue-1")).toEqual(["foo", "bar"]);
    });

    it("returns an empty array for an unseeded issue", async () => {
      const client = new MockLinearClient();
      await expect(client.listLabels("missing")).resolves.toEqual([]);
    });
  });
});
