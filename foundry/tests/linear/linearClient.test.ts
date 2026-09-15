import { describe, it, expect } from "vitest";
import { MockLinearClient, type LinearIssue } from "../../src/linear/linearClient.js";

function makeIssue(overrides: Partial<LinearIssue> & { id: string }): LinearIssue {
  return {
    identifier: "PRY-1",
    title: "Issue title",
    description: "Description",
    branchName: "ai/issue-1",
    state: "Todo",
    labels: [],
    priority: 0,
    url: "https://linear.app/team/issue/PRY-1",
    ...overrides,
  };
}

describe("MockLinearClient", () => {
  describe("getIssue", () => {
    it("returns a copy of a seeded issue, so mutating the returned title does not affect storage", async () => {
      const client = new MockLinearClient();
      const issue = makeIssue({ id: "issue-1", labels: ["bug"] });
      client.seedIssue(issue);

      const result = await client.getIssue("issue-1");
      expect(result).toEqual(issue);

      result.title = "Mutated title";
      expect((await client.getIssue("issue-1")).title).toBe("Issue title");
    });

    it("throws synchronously when the issue was not seeded", () => {
      const client = new MockLinearClient();
      expect(() => client.getIssue("missing")).toThrow("Mock: Issue missing not found");
    });
  });

  describe("searchIssues", () => {
    it("matches only issues with the given state", async () => {
      const client = new MockLinearClient();
      client.seedIssue(makeIssue({ id: "todo-1", state: "Todo" }));
      client.seedIssue(makeIssue({ id: "done-1", state: "Done" }));

      const results = await client.searchIssues({ state: "Todo" });

      expect(results.map((i) => i.id)).toEqual(["todo-1"]);
    });

    it("further filters by projectName when provided", async () => {
      const client = new MockLinearClient();
      client.seedIssue(makeIssue({ id: "p1", state: "Todo", project: "Alpha" }));
      client.seedIssue(makeIssue({ id: "p2", state: "Todo", project: "Beta" }));

      const results = await client.searchIssues({ state: "Todo", projectName: "Alpha" });

      expect(results.map((i) => i.id)).toEqual(["p1"]);
    });

    it("returns an empty array when nothing matches", async () => {
      const client = new MockLinearClient();
      client.seedIssue(makeIssue({ id: "issue-1", state: "Todo" }));

      const results = await client.searchIssues({ state: "Done" });

      expect(results).toEqual([]);
    });
  });

  describe("postComment", () => {
    it("records posted comments and returns them via getPostedComments", async () => {
      const client = new MockLinearClient();

      await client.postComment("issue-1", "first");
      await client.postComment("issue-1", "second");

      expect(client.getPostedComments()).toEqual([
        { issueId: "issue-1", body: "first" },
        { issueId: "issue-1", body: "second" },
      ]);
    });
  });

  describe("updateIssueState", () => {
    it("updates the state of a seeded issue", async () => {
      const client = new MockLinearClient();
      client.seedIssue(makeIssue({ id: "issue-1", state: "Todo" }));

      await client.updateIssueState("issue-1", "Done");

      expect((await client.getIssue("issue-1")).state).toBe("Done");
    });

    it("does nothing when the issue was not seeded", async () => {
      const client = new MockLinearClient();
      await expect(client.updateIssueState("missing", "Done")).resolves.toBeUndefined();
    });
  });

  describe("addLabel", () => {
    it("adds a label that is not already present", async () => {
      const client = new MockLinearClient();
      client.seedIssue(makeIssue({ id: "issue-1", labels: ["bug"] }));

      await client.addLabel("issue-1", "urgent");

      expect((await client.getIssue("issue-1")).labels).toEqual(["bug", "urgent"]);
    });

    it("does not duplicate a label that is already present", async () => {
      const client = new MockLinearClient();
      client.seedIssue(makeIssue({ id: "issue-1", labels: ["bug"] }));

      await client.addLabel("issue-1", "bug");

      expect((await client.getIssue("issue-1")).labels).toEqual(["bug"]);
    });

    it("does nothing when the issue was not seeded", async () => {
      const client = new MockLinearClient();
      await expect(client.addLabel("missing", "bug")).resolves.toBeUndefined();
    });
  });

  describe("removeLabel", () => {
    it("removes a label from a seeded issue", async () => {
      const client = new MockLinearClient();
      client.seedIssue(makeIssue({ id: "issue-1", labels: ["bug", "urgent"] }));

      await client.removeLabel("issue-1", "bug");

      expect((await client.getIssue("issue-1")).labels).toEqual(["urgent"]);
    });

    it("does nothing when the issue was not seeded", async () => {
      const client = new MockLinearClient();
      await expect(client.removeLabel("missing", "bug")).resolves.toBeUndefined();
    });
  });

  describe("listLabels", () => {
    it("returns a copy of the seeded issue's labels", async () => {
      const client = new MockLinearClient();
      client.seedIssue(makeIssue({ id: "issue-1", labels: ["bug", "urgent"] }));

      const labels = await client.listLabels("issue-1");
      labels.push("mutated");

      expect(await client.listLabels("issue-1")).toEqual(["bug", "urgent"]);
    });

    it("returns an empty array when the issue was not seeded", async () => {
      const client = new MockLinearClient();
      expect(await client.listLabels("missing")).toEqual([]);
    });
  });
});
