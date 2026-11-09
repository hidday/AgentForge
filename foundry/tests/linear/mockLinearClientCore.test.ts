import { describe, it, expect, beforeEach } from "vitest";
import { MockLinearClient, type LinearIssue } from "../../src/linear/linearClient.js";
import { MOCK_ISSUE } from "../../src/mocks/mockLinearData.js";

function makeIssue(overrides: Partial<LinearIssue> = {}): LinearIssue {
  return {
    id: "issue-1",
    title: "Fix bug",
    description: "Description",
    branchName: "ai/issue-1",
    state: "Todo",
    labels: [],
    priority: 1,
    ...overrides,
  };
}

describe("MockLinearClient core CRUD methods", () => {
  let client: MockLinearClient;

  beforeEach(() => {
    client = new MockLinearClient();
  });

  describe("getIssue", () => {
    it("returns a clone of the seeded issue", async () => {
      client.seedIssue(MOCK_ISSUE);
      const issue = await client.getIssue(MOCK_ISSUE.id);
      expect(issue).toEqual(MOCK_ISSUE);
      expect(issue).not.toBe(MOCK_ISSUE);
    });

    it("throws synchronously when the issue was never seeded", () => {
      expect(() => client.getIssue("missing")).toThrow("Mock: Issue missing not found");
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
      client.seedIssue(makeIssue({ id: "a", state: "Todo", project: "Platform" }));
      client.seedIssue(makeIssue({ id: "b", state: "Todo", project: "Mobile" }));

      const results = await client.searchIssues({ state: "Todo", projectName: "Platform" });

      expect(results.map((r) => r.id)).toEqual(["a"]);
    });

    it("returns an empty array when nothing matches", async () => {
      client.seedIssue(makeIssue({ id: "a", state: "Done" }));
      const results = await client.searchIssues({ state: "Todo" });
      expect(results).toEqual([]);
    });

    it("returns clones, not live references", async () => {
      client.seedIssue(makeIssue({ id: "a", state: "Todo" }));
      const [result] = await client.searchIssues({ state: "Todo" });
      result.title = "Mutated";
      const issue = await client.getIssue("a");
      expect(issue.title).toBe("Fix bug");
    });
  });

  describe("postComment", () => {
    it("records the comment and makes it retrievable", async () => {
      await client.postComment("issue-1", "First comment");
      await client.postComment("issue-1", "Second comment");
      expect(client.getPostedComments()).toEqual([
        { issueId: "issue-1", body: "First comment" },
        { issueId: "issue-1", body: "Second comment" },
      ]);
    });
  });

  describe("updateIssueState", () => {
    it("updates the state of a seeded issue", async () => {
      client.seedIssue(makeIssue({ id: "a", state: "Todo" }));
      await client.updateIssueState("a", "In Progress");
      const issue = await client.getIssue("a");
      expect(issue.state).toBe("In Progress");
    });

    it("is a no-op when the issue does not exist", async () => {
      await expect(client.updateIssueState("missing", "Done")).resolves.toBeUndefined();
    });
  });

  describe("addLabel / removeLabel / listLabels", () => {
    it("adds a label that is not already present", async () => {
      client.seedIssue(makeIssue({ id: "a", labels: ["bug"] }));
      await client.addLabel("a", "urgent");
      expect(await client.listLabels("a")).toEqual(["bug", "urgent"]);
    });

    it("does not duplicate a label that is already present", async () => {
      client.seedIssue(makeIssue({ id: "a", labels: ["bug"] }));
      await client.addLabel("a", "bug");
      expect(await client.listLabels("a")).toEqual(["bug"]);
    });

    it("addLabel on a missing issue is a no-op", async () => {
      await expect(client.addLabel("missing", "bug")).resolves.toBeUndefined();
    });

    it("removes an existing label", async () => {
      client.seedIssue(makeIssue({ id: "a", labels: ["bug", "urgent"] }));
      await client.removeLabel("a", "bug");
      expect(await client.listLabels("a")).toEqual(["urgent"]);
    });

    it("removeLabel is a no-op when the label is not present", async () => {
      client.seedIssue(makeIssue({ id: "a", labels: ["urgent"] }));
      await client.removeLabel("a", "bug");
      expect(await client.listLabels("a")).toEqual(["urgent"]);
    });

    it("removeLabel on a missing issue is a no-op", async () => {
      await expect(client.removeLabel("missing", "bug")).resolves.toBeUndefined();
    });

    it("listLabels returns an empty array for a missing issue", async () => {
      expect(await client.listLabels("missing")).toEqual([]);
    });

    it("listLabels returns a clone of the labels array", async () => {
      client.seedIssue(makeIssue({ id: "a", labels: ["bug"] }));
      const labels = await client.listLabels("a");
      labels.push("mutated");
      expect(await client.listLabels("a")).toEqual(["bug"]);
    });
  });
});
