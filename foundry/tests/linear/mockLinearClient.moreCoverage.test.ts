import { describe, it, expect } from "vitest";
import { MockLinearClient, type LinearIssue } from "../../src/linear/linearClient.js";

function makeIssue(overrides: Partial<LinearIssue> = {}): LinearIssue {
  return {
    id: "issue-1",
    title: "Focus issue",
    description: "desc",
    branchName: "ai/issue-1",
    state: "Todo",
    labels: [],
    priority: 1,
    ...overrides,
  };
}

describe("MockLinearClient", () => {
  describe("getIssue", () => {
    it("resolves a copy of the seeded issue with matching field values", async () => {
      const client = new MockLinearClient();
      client.seedIssue(makeIssue({ labels: ["a"] }));

      const issue = await client.getIssue("issue-1");

      expect(issue).toEqual(makeIssue({ labels: ["a"] }));
      expect(issue).not.toBe(makeIssue({ labels: ["a"] }));
    });

    it("throws synchronously when the issue was never seeded", () => {
      const client = new MockLinearClient();
      expect(() => client.getIssue("missing")).toThrow("Mock: Issue missing not found");
    });
  });

  describe("searchIssues", () => {
    it("filters by state only when no projectName is given", async () => {
      const client = new MockLinearClient();
      client.seedIssue(makeIssue({ id: "a", state: "Todo" }));
      client.seedIssue(makeIssue({ id: "b", state: "Done" }));

      const results = await client.searchIssues({ state: "Todo" });

      expect(results.map((i) => i.id)).toEqual(["a"]);
    });

    it("filters by state and projectName together", async () => {
      const client = new MockLinearClient();
      client.seedIssue(makeIssue({ id: "a", state: "Todo", project: "Alpha" }));
      client.seedIssue(makeIssue({ id: "b", state: "Todo", project: "Beta" }));

      const results = await client.searchIssues({ state: "Todo", projectName: "Beta" });

      expect(results.map((i) => i.id)).toEqual(["b"]);
    });

    it("returns an empty array when nothing matches", async () => {
      const client = new MockLinearClient();
      client.seedIssue(makeIssue({ id: "a", state: "Todo" }));

      const results = await client.searchIssues({ state: "In Progress" });

      expect(results).toEqual([]);
    });
  });

  describe("postComment / getPostedComments", () => {
    it("records posted comments and returns a defensive copy", async () => {
      const client = new MockLinearClient();

      await client.postComment("issue-1", "hello");
      const posted = client.getPostedComments();
      posted.push({ issueId: "injected", body: "should not persist" });

      expect(client.getPostedComments()).toEqual([{ issueId: "issue-1", body: "hello" }]);
    });
  });

  describe("updateIssueState", () => {
    it("updates the state of a seeded issue", async () => {
      const client = new MockLinearClient();
      client.seedIssue(makeIssue({ state: "Todo" }));

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
    it("adds a label to a seeded issue", async () => {
      const client = new MockLinearClient();
      client.seedIssue(makeIssue({ labels: [] }));

      await client.addLabel("issue-1", "urgent");

      expect(await client.listLabels("issue-1")).toEqual(["urgent"]);
    });

    it("does not duplicate a label that is already present", async () => {
      const client = new MockLinearClient();
      client.seedIssue(makeIssue({ labels: ["urgent"] }));

      await client.addLabel("issue-1", "urgent");

      expect(await client.listLabels("issue-1")).toEqual(["urgent"]);
    });

    it("is a no-op when the issue does not exist", async () => {
      const client = new MockLinearClient();
      await expect(client.addLabel("missing", "urgent")).resolves.toBeUndefined();
    });
  });

  describe("removeLabel", () => {
    it("removes an existing label from a seeded issue", async () => {
      const client = new MockLinearClient();
      client.seedIssue(makeIssue({ labels: ["urgent", "bug"] }));

      await client.removeLabel("issue-1", "urgent");

      expect(await client.listLabels("issue-1")).toEqual(["bug"]);
    });

    it("is a no-op when the label is not present on the issue", async () => {
      const client = new MockLinearClient();
      client.seedIssue(makeIssue({ labels: ["bug"] }));

      await client.removeLabel("issue-1", "urgent");

      expect(await client.listLabels("issue-1")).toEqual(["bug"]);
    });

    it("is a no-op when the issue does not exist", async () => {
      const client = new MockLinearClient();
      await expect(client.removeLabel("missing", "urgent")).resolves.toBeUndefined();
    });
  });

  describe("listLabels", () => {
    it("returns a defensive copy of the issue's labels", async () => {
      const client = new MockLinearClient();
      client.seedIssue(makeIssue({ labels: ["bug"] }));

      const labels = await client.listLabels("issue-1");
      labels.push("injected");

      expect(await client.listLabels("issue-1")).toEqual(["bug"]);
    });

    it("returns an empty array when the issue does not exist", async () => {
      const client = new MockLinearClient();
      expect(await client.listLabels("missing")).toEqual([]);
    });
  });
});
