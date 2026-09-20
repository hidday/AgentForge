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
    it("returns a cloned copy of a seeded issue", async () => {
      const client = new MockLinearClient();
      const issue = makeIssue();
      client.seedIssue(issue);

      const result = await client.getIssue("issue-1");

      expect(result).toEqual(issue);
      expect(result).not.toBe(issue);
    });

    it("throws when the issue was not seeded", () => {
      const client = new MockLinearClient();
      expect(() => client.getIssue("missing")).toThrow(
        "Mock: Issue missing not found",
      );
    });
  });

  describe("searchIssues", () => {
    it("matches issues by state only", async () => {
      const client = new MockLinearClient();
      client.seedIssue(makeIssue({ id: "a", state: "Todo" }));
      client.seedIssue(makeIssue({ id: "b", state: "Done" }));

      const results = await client.searchIssues({ state: "Todo" });

      expect(results).toHaveLength(1);
      expect(results[0].id).toBe("a");
    });

    it("filters by projectName when provided", async () => {
      const client = new MockLinearClient();
      client.seedIssue(makeIssue({ id: "a", state: "Todo", project: "Alpha" }));
      client.seedIssue(makeIssue({ id: "b", state: "Todo", project: "Beta" }));

      const results = await client.searchIssues({ state: "Todo", projectName: "Beta" });

      expect(results).toHaveLength(1);
      expect(results[0].id).toBe("b");
    });

    it("returns an empty array when nothing matches", async () => {
      const client = new MockLinearClient();
      client.seedIssue(makeIssue({ id: "a", state: "Done" }));

      const results = await client.searchIssues({ state: "Todo" });

      expect(results).toEqual([]);
    });

    it("returns cloned issues so mutation does not affect internal state", async () => {
      const client = new MockLinearClient();
      client.seedIssue(makeIssue({ id: "a", state: "Todo" }));

      const [result] = await client.searchIssues({ state: "Todo" });
      result.title = "Mutated";

      const [again] = await client.searchIssues({ state: "Todo" });
      expect(again.title).toBe("Focus issue");
    });
  });

  describe("postComment", () => {
    it("records posted comments and exposes them via getPostedComments", async () => {
      const client = new MockLinearClient();

      await client.postComment("issue-1", "First comment");
      await client.postComment("issue-2", "Second comment");

      expect(client.getPostedComments()).toEqual([
        { issueId: "issue-1", body: "First comment" },
        { issueId: "issue-2", body: "Second comment" },
      ]);
    });

    it("returns a copy from getPostedComments so callers cannot mutate internal state", async () => {
      const client = new MockLinearClient();
      await client.postComment("issue-1", "First comment");

      const comments = client.getPostedComments();
      comments.push({ issueId: "issue-x", body: "injected" });

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

    it("does nothing (and does not throw) when the issue is not seeded", async () => {
      const client = new MockLinearClient();
      await expect(client.updateIssueState("missing", "Done")).resolves.toBeUndefined();
    });
  });

  describe("addLabel", () => {
    it("adds a new label to a seeded issue", async () => {
      const client = new MockLinearClient();
      client.seedIssue(makeIssue({ id: "issue-1", labels: ["existing"] }));

      await client.addLabel("issue-1", "new-label");

      const issue = await client.getIssue("issue-1");
      expect(issue.labels).toEqual(["existing", "new-label"]);
    });

    it("does not add a duplicate label", async () => {
      const client = new MockLinearClient();
      client.seedIssue(makeIssue({ id: "issue-1", labels: ["existing"] }));

      await client.addLabel("issue-1", "existing");

      const issue = await client.getIssue("issue-1");
      expect(issue.labels).toEqual(["existing"]);
    });

    it("does nothing when the issue is not seeded", async () => {
      const client = new MockLinearClient();
      await expect(client.addLabel("missing", "label")).resolves.toBeUndefined();
    });
  });

  describe("removeLabel", () => {
    it("removes an existing label from a seeded issue", async () => {
      const client = new MockLinearClient();
      client.seedIssue(makeIssue({ id: "issue-1", labels: ["a", "b"] }));

      await client.removeLabel("issue-1", "a");

      const issue = await client.getIssue("issue-1");
      expect(issue.labels).toEqual(["b"]);
    });

    it("is a no-op when the label is not present", async () => {
      const client = new MockLinearClient();
      client.seedIssue(makeIssue({ id: "issue-1", labels: ["a"] }));

      await client.removeLabel("issue-1", "not-there");

      const issue = await client.getIssue("issue-1");
      expect(issue.labels).toEqual(["a"]);
    });

    it("does nothing (and does not throw) when the issue is not seeded", async () => {
      const client = new MockLinearClient();
      await expect(client.removeLabel("missing", "a")).resolves.toBeUndefined();
    });
  });

  describe("listLabels", () => {
    it("returns a cloned array of labels for a seeded issue", async () => {
      const client = new MockLinearClient();
      client.seedIssue(makeIssue({ id: "issue-1", labels: ["a", "b"] }));

      const labels = await client.listLabels("issue-1");
      labels.push("mutated");

      expect(await client.listLabels("issue-1")).toEqual(["a", "b"]);
    });

    it("returns an empty array when the issue is not seeded", async () => {
      const client = new MockLinearClient();
      expect(await client.listLabels("missing")).toEqual([]);
    });
  });
});
