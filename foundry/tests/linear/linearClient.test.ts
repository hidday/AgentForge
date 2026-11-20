import { describe, it, expect } from "vitest";
import { MockLinearClient, type LinearIssue } from "../../src/linear/linearClient.js";

function makeIssue(overrides: Partial<LinearIssue> = {}): LinearIssue {
  return {
    id: "issue-1",
    identifier: "ENG-1",
    title: "Fix the bug",
    description: "Something is broken",
    branchName: "ai/issue-1",
    state: "Todo",
    labels: ["bug"],
    priority: 1,
    url: "https://linear.app/team/issue/ENG-1",
    project: "Backend",
    team: "ENG",
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

    it("throws when the issue was never seeded", () => {
      const client = new MockLinearClient();
      // getIssue throws synchronously (its body is not an async function), so
      // the throw happens on invocation rather than via promise rejection.
      expect(() => client.getIssue("missing")).toThrow(/Mock: Issue missing not found/);
    });
  });

  describe("searchIssues", () => {
    it("matches only issues whose state equals the filter state", async () => {
      const client = new MockLinearClient();
      client.seedIssue(makeIssue({ id: "a", state: "Todo" }));
      client.seedIssue(makeIssue({ id: "b", state: "Done" }));

      const results = await client.searchIssues({ state: "Todo" });

      expect(results.map((r) => r.id)).toEqual(["a"]);
    });

    it("further narrows by projectName when provided", async () => {
      const client = new MockLinearClient();
      client.seedIssue(makeIssue({ id: "a", state: "Todo", project: "Backend" }));
      client.seedIssue(makeIssue({ id: "b", state: "Todo", project: "Frontend" }));

      const results = await client.searchIssues({ state: "Todo", projectName: "Frontend" });

      expect(results.map((r) => r.id)).toEqual(["b"]);
    });

    it("returns an empty array when nothing matches", async () => {
      const client = new MockLinearClient();
      client.seedIssue(makeIssue({ id: "a", state: "Todo" }));

      const results = await client.searchIssues({ state: "Done" });

      expect(results).toEqual([]);
    });

    it("returns cloned issues so mutation does not affect the store", async () => {
      const client = new MockLinearClient();
      client.seedIssue(makeIssue({ id: "a", state: "Todo", title: "Original" }));

      const [found] = await client.searchIssues({ state: "Todo" });
      found.title = "Mutated";

      const [again] = await client.searchIssues({ state: "Todo" });
      expect(again.title).toBe("Original");
    });
  });

  describe("postComment", () => {
    it("records the comment and makes it visible via getPostedComments", async () => {
      const client = new MockLinearClient();
      await client.postComment("issue-1", "hello world");
      await client.postComment("issue-2", "another");

      expect(client.getPostedComments()).toEqual([
        { issueId: "issue-1", body: "hello world" },
        { issueId: "issue-2", body: "another" },
      ]);
    });
  });

  describe("updateIssueState", () => {
    it("updates the state of a seeded issue", async () => {
      const client = new MockLinearClient();
      client.seedIssue(makeIssue({ id: "a", state: "Todo" }));

      await client.updateIssueState("a", "In Progress");

      const updated = await client.getIssue("a");
      expect(updated.state).toBe("In Progress");
    });

    it("is a no-op (does not throw) for an unseeded issue id", async () => {
      const client = new MockLinearClient();
      await expect(client.updateIssueState("missing", "Done")).resolves.toBeUndefined();
    });
  });

  describe("addLabel / removeLabel / listLabels", () => {
    it("adds a new label to an existing issue", async () => {
      const client = new MockLinearClient();
      client.seedIssue(makeIssue({ id: "a", labels: ["bug"] }));

      await client.addLabel("a", "urgent");

      expect(await client.listLabels("a")).toEqual(["bug", "urgent"]);
    });

    it("does not duplicate a label that is already present", async () => {
      const client = new MockLinearClient();
      client.seedIssue(makeIssue({ id: "a", labels: ["bug"] }));

      await client.addLabel("a", "bug");

      expect(await client.listLabels("a")).toEqual(["bug"]);
    });

    it("addLabel is a no-op for an unseeded issue", async () => {
      const client = new MockLinearClient();
      await expect(client.addLabel("missing", "bug")).resolves.toBeUndefined();
    });

    it("removes an existing label", async () => {
      const client = new MockLinearClient();
      client.seedIssue(makeIssue({ id: "a", labels: ["bug", "urgent"] }));

      await client.removeLabel("a", "bug");

      expect(await client.listLabels("a")).toEqual(["urgent"]);
    });

    it("removeLabel is a no-op when the label is absent", async () => {
      const client = new MockLinearClient();
      client.seedIssue(makeIssue({ id: "a", labels: ["bug"] }));

      await client.removeLabel("a", "nonexistent");

      expect(await client.listLabels("a")).toEqual(["bug"]);
    });

    it("removeLabel is a no-op for an unseeded issue", async () => {
      const client = new MockLinearClient();
      await expect(client.removeLabel("missing", "bug")).resolves.toBeUndefined();
    });

    it("listLabels returns an empty array for an unseeded issue", async () => {
      const client = new MockLinearClient();
      expect(await client.listLabels("missing")).toEqual([]);
    });

    it("listLabels returns a cloned array that does not alias internal state", async () => {
      const client = new MockLinearClient();
      client.seedIssue(makeIssue({ id: "a", labels: ["bug"] }));

      const labels = await client.listLabels("a");
      labels.push("mutated");

      expect(await client.listLabels("a")).toEqual(["bug"]);
    });
  });
});
