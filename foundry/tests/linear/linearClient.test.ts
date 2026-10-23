import { describe, it, expect, beforeEach } from "vitest";
import { MockLinearClient, type LinearIssue } from "../../src/linear/linearClient.js";
import { MOCK_ISSUE } from "../../src/mocks/mockLinearData.js";

function makeIssue(overrides: Partial<LinearIssue> = {}): LinearIssue {
  return {
    id: "issue-1",
    identifier: "ENG-1",
    title: "Test issue",
    description: "Some description",
    branchName: "ai/issue-1",
    state: "Todo",
    labels: ["bug"],
    priority: 1,
    url: "https://linear.app/team/issue/ENG-1",
    project: "Backend Platform",
    ...overrides,
  };
}

describe("MockLinearClient", () => {
  let client: MockLinearClient;

  beforeEach(() => {
    client = new MockLinearClient();
  });

  describe("getIssue", () => {
    it("returns a clone of a seeded issue", async () => {
      client.seedIssue(makeIssue());

      const issue = await client.getIssue("issue-1");

      expect(issue).toEqual(makeIssue());
    });

    it("returns a defensive copy that does not mutate internal state", async () => {
      client.seedIssue(makeIssue());

      const issue = await client.getIssue("issue-1");
      issue.title = "Mutated";

      const second = await client.getIssue("issue-1");
      expect(second.title).toBe("Test issue");
    });

    it("throws synchronously when the issue was never seeded", () => {
      expect(() => client.getIssue("missing")).toThrow("Mock: Issue missing not found");
    });

    it("works with the realistic MOCK_ISSUE fixture", async () => {
      client.seedIssue(MOCK_ISSUE);

      const issue = await client.getIssue(MOCK_ISSUE.id);

      expect(issue).toEqual(MOCK_ISSUE);
    });
  });

  describe("searchIssues", () => {
    it("filters by state", async () => {
      client.seedIssue(makeIssue({ id: "a", state: "Todo" }));
      client.seedIssue(makeIssue({ id: "b", state: "Done" }));

      const results = await client.searchIssues({ state: "Todo" });

      expect(results.map((r) => r.id)).toEqual(["a"]);
    });

    it("filters by projectName in addition to state", async () => {
      client.seedIssue(makeIssue({ id: "a", state: "Todo", project: "Alpha" }));
      client.seedIssue(makeIssue({ id: "b", state: "Todo", project: "Beta" }));

      const results = await client.searchIssues({ state: "Todo", projectName: "Beta" });

      expect(results.map((r) => r.id)).toEqual(["b"]);
    });

    it("returns an empty array when nothing matches", async () => {
      client.seedIssue(makeIssue({ id: "a", state: "Todo" }));

      const results = await client.searchIssues({ state: "Done" });

      expect(results).toEqual([]);
    });

    it("returns defensive copies of matched issues", async () => {
      client.seedIssue(makeIssue({ id: "a", state: "Todo" }));

      const results = await client.searchIssues({ state: "Todo" });
      results[0].title = "Mutated";

      const second = await client.searchIssues({ state: "Todo" });
      expect(second[0].title).toBe("Test issue");
    });
  });

  describe("postComment", () => {
    it("records the comment and exposes it via getPostedComments", async () => {
      await client.postComment("issue-1", "First comment");
      await client.postComment("issue-1", "Second comment");

      expect(client.getPostedComments()).toEqual([
        { issueId: "issue-1", body: "First comment" },
        { issueId: "issue-1", body: "Second comment" },
      ]);
    });

    it("getPostedComments returns a defensive copy", async () => {
      await client.postComment("issue-1", "First comment");
      const comments = client.getPostedComments();
      comments.push({ issueId: "x", body: "y" });

      expect(client.getPostedComments()).toHaveLength(1);
    });
  });

  describe("updateIssueState", () => {
    it("updates the state of a seeded issue", async () => {
      client.seedIssue(makeIssue({ state: "Todo" }));

      await client.updateIssueState("issue-1", "In Progress");

      const issue = await client.getIssue("issue-1");
      expect(issue.state).toBe("In Progress");
    });

    it("is a no-op (does not throw) for an unknown issue", async () => {
      await expect(client.updateIssueState("missing", "Done")).resolves.toBeUndefined();
    });
  });

  describe("addLabel", () => {
    it("adds a new label to a seeded issue", async () => {
      client.seedIssue(makeIssue({ labels: ["bug"] }));

      await client.addLabel("issue-1", "urgent");

      const labels = await client.listLabels("issue-1");
      expect(labels).toEqual(["bug", "urgent"]);
    });

    it("does not duplicate a label that is already present", async () => {
      client.seedIssue(makeIssue({ labels: ["bug"] }));

      await client.addLabel("issue-1", "bug");

      const labels = await client.listLabels("issue-1");
      expect(labels).toEqual(["bug"]);
    });

    it("is a no-op (does not throw) for an unknown issue", async () => {
      await expect(client.addLabel("missing", "urgent")).resolves.toBeUndefined();
    });
  });

  describe("removeLabel", () => {
    it("removes an existing label from a seeded issue", async () => {
      client.seedIssue(makeIssue({ labels: ["bug", "urgent"] }));

      await client.removeLabel("issue-1", "bug");

      const labels = await client.listLabels("issue-1");
      expect(labels).toEqual(["urgent"]);
    });

    it("is a no-op when the label is not present", async () => {
      client.seedIssue(makeIssue({ labels: ["bug"] }));

      await client.removeLabel("issue-1", "nonexistent");

      const labels = await client.listLabels("issue-1");
      expect(labels).toEqual(["bug"]);
    });

    it("is a no-op (does not throw) for an unknown issue", async () => {
      await expect(client.removeLabel("missing", "bug")).resolves.toBeUndefined();
    });
  });

  describe("listLabels", () => {
    it("returns a defensive copy of the labels array", async () => {
      client.seedIssue(makeIssue({ labels: ["bug"] }));

      const labels = await client.listLabels("issue-1");
      labels.push("mutated");

      const second = await client.listLabels("issue-1");
      expect(second).toEqual(["bug"]);
    });

    it("returns an empty array for an unknown issue", async () => {
      await expect(client.listLabels("missing")).resolves.toEqual([]);
    });
  });
});
