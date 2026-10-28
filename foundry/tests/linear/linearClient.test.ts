import { describe, it, expect, beforeEach } from "vitest";
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
  let client: MockLinearClient;

  beforeEach(() => {
    client = new MockLinearClient();
  });

  describe("getIssue", () => {
    it("returns a deep-cloned copy of a seeded issue", async () => {
      client.seedIssue(makeIssue());
      const result = await client.getIssue("issue-1");
      expect(result).toEqual(makeIssue());

      result.title = "mutated";
      expect((await client.getIssue("issue-1")).title).toBe("Focus issue");
    });

    it("throws when the issue was not seeded", () => {
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

    it("filters by projectName when given", async () => {
      client.seedIssue(makeIssue({ id: "a", state: "Todo", project: "Alpha" }));
      client.seedIssue(makeIssue({ id: "b", state: "Todo", project: "Beta" }));

      const results = await client.searchIssues({ state: "Todo", projectName: "Alpha" });

      expect(results.map((r) => r.id)).toEqual(["a"]);
    });

    it("returns deep-cloned results", async () => {
      client.seedIssue(makeIssue({ id: "a", state: "Todo" }));
      const [result] = await client.searchIssues({ state: "Todo" });
      result.title = "mutated";

      const [again] = await client.searchIssues({ state: "Todo" });
      expect(again.title).toBe("Focus issue");
    });
  });

  describe("postComment / getPostedComments", () => {
    it("records posted comments in order", async () => {
      await client.postComment("issue-1", "first");
      await client.postComment("issue-1", "second");

      expect(client.getPostedComments()).toEqual([
        { issueId: "issue-1", body: "first" },
        { issueId: "issue-1", body: "second" },
      ]);
    });
  });

  describe("updateIssueState", () => {
    it("updates the state of a known issue", async () => {
      client.seedIssue(makeIssue());
      await client.updateIssueState("issue-1", "Done");
      expect((await client.getIssue("issue-1")).state).toBe("Done");
    });

    it("is a no-op for an unknown issue", async () => {
      await expect(client.updateIssueState("missing", "Done")).resolves.toBeUndefined();
    });
  });

  describe("labels", () => {
    it("addLabel appends a new label and avoids duplicates", async () => {
      client.seedIssue(makeIssue({ labels: ["a"] }));

      await client.addLabel("issue-1", "b");
      await client.addLabel("issue-1", "b");

      expect(await client.listLabels("issue-1")).toEqual(["a", "b"]);
    });

    it("addLabel is a no-op for an unknown issue", async () => {
      await expect(client.addLabel("missing", "b")).resolves.toBeUndefined();
    });

    it("removeLabel removes an existing label", async () => {
      client.seedIssue(makeIssue({ labels: ["a", "b"] }));
      await client.removeLabel("issue-1", "a");
      expect(await client.listLabels("issue-1")).toEqual(["b"]);
    });

    it("removeLabel is a no-op for an unknown issue", async () => {
      await expect(client.removeLabel("missing", "a")).resolves.toBeUndefined();
    });

    it("listLabels returns an empty array for an unknown issue", async () => {
      expect(await client.listLabels("missing")).toEqual([]);
    });
  });
});
