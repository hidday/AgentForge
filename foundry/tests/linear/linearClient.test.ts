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
    priority: 1,
    url: "https://linear.app/team/issue/PRY-1",
    project: "Project A",
    team: "PRY",
    cycle: "Cycle 1",
    ...overrides,
  };
}

describe("MockLinearClient", () => {
  describe("getIssue", () => {
    it("returns a deep-cloned copy of a seeded issue", async () => {
      const client = new MockLinearClient();
      const issue = makeIssue();
      client.seedIssue(issue);

      const result = await client.getIssue("issue-1");

      expect(result).toEqual(issue);
      expect(result).not.toBe(issue);
    });

    it("mutating the returned issue does not affect the stored copy", async () => {
      const client = new MockLinearClient();
      client.seedIssue(makeIssue({ title: "Original" }));

      const first = await client.getIssue("issue-1");
      first.title = "Mutated";

      const second = await client.getIssue("issue-1");
      expect(second.title).toBe("Original");
    });

    it("throws when the issue was not seeded", () => {
      const client = new MockLinearClient();

      expect(() => client.getIssue("missing")).toThrow("Mock: Issue missing not found");
    });
  });

  describe("searchIssues", () => {
    it("matches issues by state only", async () => {
      const client = new MockLinearClient();
      client.seedIssue(makeIssue({ id: "a", state: "Todo" }));
      client.seedIssue(makeIssue({ id: "b", state: "Done" }));

      const results = await client.searchIssues({ state: "Todo" });

      expect(results.map((i) => i.id)).toEqual(["a"]);
    });

    it("excludes issues whose state does not match even with no other filters", async () => {
      const client = new MockLinearClient();
      client.seedIssue(makeIssue({ id: "a", state: "In Review" }));

      const results = await client.searchIssues({ state: "Todo" });

      expect(results).toEqual([]);
    });

    it("matches by state and projectName together", async () => {
      const client = new MockLinearClient();
      client.seedIssue(makeIssue({ id: "a", state: "Todo", project: "Alpha" }));
      client.seedIssue(makeIssue({ id: "b", state: "Todo", project: "Beta" }));

      const results = await client.searchIssues({ state: "Todo", projectName: "Alpha" });

      expect(results.map((i) => i.id)).toEqual(["a"]);
    });

    it("excludes matches on state when projectName filter does not match", async () => {
      const client = new MockLinearClient();
      client.seedIssue(makeIssue({ id: "a", state: "Todo", project: "Alpha" }));

      const results = await client.searchIssues({ state: "Todo", projectName: "Other" });

      expect(results).toEqual([]);
    });

    it("returns deep-cloned issues so mutation does not affect stored state", async () => {
      const client = new MockLinearClient();
      client.seedIssue(makeIssue({ id: "a", state: "Todo" }));

      const results = await client.searchIssues({ state: "Todo" });
      results[0].title = "Mutated";

      const second = await client.searchIssues({ state: "Todo" });
      expect(second[0].title).toBe("Issue title");
    });
  });

  describe("postComment / getPostedComments", () => {
    it("records posted comments and returns them via getPostedComments", async () => {
      const client = new MockLinearClient();

      await client.postComment("issue-1", "First comment");
      await client.postComment("issue-2", "Second comment");

      expect(client.getPostedComments()).toEqual([
        { issueId: "issue-1", body: "First comment" },
        { issueId: "issue-2", body: "Second comment" },
      ]);
    });

    it("returns a copy from getPostedComments so external mutation is isolated", async () => {
      const client = new MockLinearClient();
      await client.postComment("issue-1", "Comment");

      const comments = client.getPostedComments();
      comments.push({ issueId: "issue-2", body: "Injected" });

      expect(client.getPostedComments()).toEqual([{ issueId: "issue-1", body: "Comment" }]);
    });
  });

  describe("updateIssueState", () => {
    it("updates the state of a seeded issue", async () => {
      const client = new MockLinearClient();
      client.seedIssue(makeIssue({ id: "issue-1", state: "Todo" }));

      await client.updateIssueState("issue-1", "Done");

      const updated = await client.getIssue("issue-1");
      expect(updated.state).toBe("Done");
    });

    it("is a no-op when the issue was not seeded", async () => {
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

    it("does not duplicate a label that is already present", async () => {
      const client = new MockLinearClient();
      client.seedIssue(makeIssue({ id: "issue-1", labels: ["bug"] }));

      await client.addLabel("issue-1", "bug");

      const issue = await client.getIssue("issue-1");
      expect(issue.labels).toEqual(["bug"]);
    });

    it("is a no-op when the issue was not seeded", async () => {
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

    it("is a no-op when removing a label that is not present", async () => {
      const client = new MockLinearClient();
      client.seedIssue(makeIssue({ id: "issue-1", labels: ["urgent"] }));

      await client.removeLabel("issue-1", "bug");

      const issue = await client.getIssue("issue-1");
      expect(issue.labels).toEqual(["urgent"]);
    });

    it("is a no-op when the issue was not seeded", async () => {
      const client = new MockLinearClient();

      await expect(client.removeLabel("missing", "bug")).resolves.toBeUndefined();
    });
  });

  describe("listLabels", () => {
    it("returns a copy of the labels for a seeded issue", async () => {
      const client = new MockLinearClient();
      client.seedIssue(makeIssue({ id: "issue-1", labels: ["bug", "urgent"] }));

      const labels = await client.listLabels("issue-1");

      expect(labels).toEqual(["bug", "urgent"]);
    });

    it("returned labels array mutation does not affect stored state", async () => {
      const client = new MockLinearClient();
      client.seedIssue(makeIssue({ id: "issue-1", labels: ["bug"] }));

      const labels = await client.listLabels("issue-1");
      labels.push("injected");

      const second = await client.listLabels("issue-1");
      expect(second).toEqual(["bug"]);
    });

    it("returns an empty array when the issue was not seeded", async () => {
      const client = new MockLinearClient();

      const labels = await client.listLabels("missing");

      expect(labels).toEqual([]);
    });
  });
});
