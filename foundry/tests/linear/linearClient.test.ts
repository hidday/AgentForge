import { describe, it, expect, beforeEach } from "vitest";
import { MockLinearClient, type LinearIssue } from "../../src/linear/linearClient.js";

function makeIssue(overrides: Partial<LinearIssue> = {}): LinearIssue {
  return {
    id: "issue-1",
    identifier: "ENG-1",
    title: "Fix the bug",
    description: "Details",
    branchName: "ai/issue-1",
    state: "Todo",
    labels: [],
    priority: 2,
    ...overrides,
  };
}

describe("MockLinearClient", () => {
  let client: MockLinearClient;

  beforeEach(() => {
    client = new MockLinearClient();
  });

  describe("getIssue", () => {
    it("returns a clone of the seeded issue", async () => {
      const issue = makeIssue();
      client.seedIssue(issue);

      const result = await client.getIssue("issue-1");

      expect(result).toEqual(issue);
      expect(result).not.toBe(issue);
    });

    it("throws synchronously when the issue was never seeded", () => {
      expect(() => client.getIssue("missing")).toThrow("Mock: Issue missing not found");
    });
  });

  describe("searchIssues", () => {
    beforeEach(() => {
      client.seedIssue(makeIssue({ id: "1", state: "Todo", project: "Alpha" }));
      client.seedIssue(makeIssue({ id: "2", state: "Done", project: "Alpha" }));
      client.seedIssue(makeIssue({ id: "3", state: "Todo", project: "Beta" }));
    });

    it("filters by state", async () => {
      const results = await client.searchIssues({ state: "Todo" });
      expect(results.map((r) => r.id).sort()).toEqual(["1", "3"]);
    });

    it("filters by state and projectName together", async () => {
      const results = await client.searchIssues({ state: "Todo", projectName: "Alpha" });
      expect(results.map((r) => r.id)).toEqual(["1"]);
    });

    it("returns an empty array when nothing matches", async () => {
      const results = await client.searchIssues({ state: "Cancelled" });
      expect(results).toEqual([]);
    });

    it("returns clones, not live references", async () => {
      const [result] = await client.searchIssues({ state: "Todo" });
      result!.title = "mutated";
      const [again] = await client.searchIssues({ state: "Todo" });
      expect(again!.title).not.toBe("mutated");
    });
  });

  describe("postComment", () => {
    it("records the comment and getPostedComments returns it", async () => {
      await client.postComment("issue-1", "hello");
      await client.postComment("issue-2", "world");

      expect(client.getPostedComments()).toEqual([
        { issueId: "issue-1", body: "hello" },
        { issueId: "issue-2", body: "world" },
      ]);
    });
  });

  describe("updateIssueState", () => {
    it("updates the state of a seeded issue", async () => {
      client.seedIssue(makeIssue({ state: "Todo" }));
      await client.updateIssueState("issue-1", "In Progress");

      const issue = await client.getIssue("issue-1");
      expect(issue.state).toBe("In Progress");
    });

    it("is a no-op for an unseeded issue (does not throw)", async () => {
      await expect(client.updateIssueState("missing", "Done")).resolves.toBeUndefined();
    });
  });

  describe("addLabel / removeLabel / listLabels", () => {
    it("adds a label to a seeded issue", async () => {
      client.seedIssue(makeIssue({ labels: [] }));
      await client.addLabel("issue-1", "ai-plan");

      expect(await client.listLabels("issue-1")).toEqual(["ai-plan"]);
    });

    it("does not add a duplicate label", async () => {
      client.seedIssue(makeIssue({ labels: ["ai-plan"] }));
      await client.addLabel("issue-1", "ai-plan");

      expect(await client.listLabels("issue-1")).toEqual(["ai-plan"]);
    });

    it("is a no-op adding a label to an unseeded issue", async () => {
      await expect(client.addLabel("missing", "x")).resolves.toBeUndefined();
    });

    it("removes a label from a seeded issue", async () => {
      client.seedIssue(makeIssue({ labels: ["ai-plan", "urgent"] }));
      await client.removeLabel("issue-1", "ai-plan");

      expect(await client.listLabels("issue-1")).toEqual(["urgent"]);
    });

    it("is a no-op removing a label from an unseeded issue", async () => {
      await expect(client.removeLabel("missing", "x")).resolves.toBeUndefined();
    });

    it("listLabels returns [] for an unseeded issue", async () => {
      expect(await client.listLabels("missing")).toEqual([]);
    });

    it("listLabels returns a clone (mutating it does not affect the client)", async () => {
      client.seedIssue(makeIssue({ labels: ["a"] }));
      const labels = await client.listLabels("issue-1");
      labels.push("b");

      expect(await client.listLabels("issue-1")).toEqual(["a"]);
    });
  });
});
