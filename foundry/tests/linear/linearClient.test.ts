import { describe, it, expect } from "vitest";
import { MockLinearClient, type LinearIssue } from "../../src/linear/linearClient.js";

function makeIssue(overrides: Partial<LinearIssue> = {}): LinearIssue {
  return {
    id: "issue-1",
    identifier: "PRY-1",
    title: "Focus issue",
    description: "Some description",
    branchName: "ai/issue-1",
    state: "Todo",
    labels: [],
    priority: 0,
    url: "https://linear.app/team/issue/PRY-1",
    project: "Payments",
    ...overrides,
  };
}

describe("MockLinearClient core operations", () => {
  describe("getIssue", () => {
    it("returns a copy of the seeded issue", async () => {
      const client = new MockLinearClient();
      const issue = makeIssue();
      client.seedIssue(issue);

      const result = await client.getIssue("issue-1");

      expect(result).toEqual(issue);
      expect(result).not.toBe(issue);
    });

    it("throws synchronously when the issue was never seeded", () => {
      const client = new MockLinearClient();

      expect(() => client.getIssue("missing")).toThrow("Mock: Issue missing not found");
    });

    it("returns an independent copy so external mutation does not leak between calls", async () => {
      const client = new MockLinearClient();
      client.seedIssue(makeIssue({ title: "Original" }));

      const first = await client.getIssue("issue-1");
      first.title = "Mutated";

      const second = await client.getIssue("issue-1");
      expect(second.title).toBe("Original");
    });
  });

  describe("searchIssues", () => {
    it("filters by state only", async () => {
      const client = new MockLinearClient();
      client.seedIssue(makeIssue({ id: "a", state: "Todo" }));
      client.seedIssue(makeIssue({ id: "b", state: "Done" }));

      const results = await client.searchIssues({ state: "Todo" });

      expect(results.map((i) => i.id)).toEqual(["a"]);
    });

    it("filters by state and projectName together", async () => {
      const client = new MockLinearClient();
      client.seedIssue(makeIssue({ id: "a", state: "Todo", project: "Payments" }));
      client.seedIssue(makeIssue({ id: "b", state: "Todo", project: "Billing" }));

      const results = await client.searchIssues({ state: "Todo", projectName: "Billing" });

      expect(results.map((i) => i.id)).toEqual(["b"]);
    });

    it("returns an empty array when nothing matches", async () => {
      const client = new MockLinearClient();
      client.seedIssue(makeIssue({ id: "a", state: "Todo" }));

      const results = await client.searchIssues({ state: "Done" });

      expect(results).toEqual([]);
    });

    it("returns copies, not references to the stored issues", async () => {
      const client = new MockLinearClient();
      client.seedIssue(makeIssue({ id: "a", state: "Todo" }));

      const [result] = await client.searchIssues({ state: "Todo" });
      result.title = "Mutated";

      const [second] = await client.searchIssues({ state: "Todo" });
      expect(second.title).toBe("Focus issue");
    });
  });

  describe("postComment", () => {
    it("records the comment and exposes it via getPostedComments", async () => {
      const client = new MockLinearClient();

      await client.postComment("issue-1", "hello");
      await client.postComment("issue-2", "world");

      expect(client.getPostedComments()).toEqual([
        { issueId: "issue-1", body: "hello" },
        { issueId: "issue-2", body: "world" },
      ]);
    });

    it("getPostedComments returns a snapshot copy", async () => {
      const client = new MockLinearClient();
      await client.postComment("issue-1", "hello");

      const snapshot = client.getPostedComments();
      snapshot.push({ issueId: "extra", body: "injected" });

      expect(client.getPostedComments()).toEqual([{ issueId: "issue-1", body: "hello" }]);
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

    it("is a no-op for an issue that was never seeded", async () => {
      const client = new MockLinearClient();

      await expect(client.updateIssueState("missing", "Done")).resolves.toBeUndefined();
    });
  });

  describe("addLabel", () => {
    it("adds a label to a seeded issue", async () => {
      const client = new MockLinearClient();
      client.seedIssue(makeIssue({ id: "issue-1", labels: [] }));

      await client.addLabel("issue-1", "bug");

      const issue = await client.getIssue("issue-1");
      expect(issue.labels).toEqual(["bug"]);
    });

    it("does not add a duplicate label", async () => {
      const client = new MockLinearClient();
      client.seedIssue(makeIssue({ id: "issue-1", labels: ["bug"] }));

      await client.addLabel("issue-1", "bug");

      const issue = await client.getIssue("issue-1");
      expect(issue.labels).toEqual(["bug"]);
    });

    it("is a no-op for an issue that was never seeded", async () => {
      const client = new MockLinearClient();

      await expect(client.addLabel("missing", "bug")).resolves.toBeUndefined();
    });
  });

  describe("removeLabel", () => {
    it("removes a label from a seeded issue", async () => {
      const client = new MockLinearClient();
      client.seedIssue(makeIssue({ id: "issue-1", labels: ["bug", "urgent"] }));

      await client.removeLabel("issue-1", "bug");

      const issue = await client.getIssue("issue-1");
      expect(issue.labels).toEqual(["urgent"]);
    });

    it("is a no-op when the label is not present", async () => {
      const client = new MockLinearClient();
      client.seedIssue(makeIssue({ id: "issue-1", labels: ["urgent"] }));

      await client.removeLabel("issue-1", "bug");

      const issue = await client.getIssue("issue-1");
      expect(issue.labels).toEqual(["urgent"]);
    });

    it("is a no-op for an issue that was never seeded", async () => {
      const client = new MockLinearClient();

      await expect(client.removeLabel("missing", "bug")).resolves.toBeUndefined();
    });
  });

  describe("listLabels", () => {
    it("returns a copy of the issue's labels", async () => {
      const client = new MockLinearClient();
      client.seedIssue(makeIssue({ id: "issue-1", labels: ["bug", "urgent"] }));

      const labels = await client.listLabels("issue-1");

      expect(labels).toEqual(["bug", "urgent"]);
    });

    it("returns an empty array for an issue that was never seeded", async () => {
      const client = new MockLinearClient();

      await expect(client.listLabels("missing")).resolves.toEqual([]);
    });

    it("returns an independent copy so mutation does not affect the stored issue", async () => {
      const client = new MockLinearClient();
      client.seedIssue(makeIssue({ id: "issue-1", labels: ["bug"] }));

      const labels = await client.listLabels("issue-1");
      labels.push("mutated");

      expect(await client.listLabels("issue-1")).toEqual(["bug"]);
    });
  });
});
