import { describe, it, expect } from "vitest";
import { MockLinearClient, type LinearIssue } from "../../src/linear/linearClient.js";

function makeIssue(overrides: Partial<LinearIssue> = {}): LinearIssue {
  return {
    id: "issue-1",
    title: "Focus issue",
    description: "desc",
    branchName: "ai/issue-1",
    state: "Todo",
    labels: ["bug"],
    priority: 1,
    project: "Backend",
    ...overrides,
  };
}

describe("MockLinearClient", () => {
  describe("getIssue", () => {
    it("returns a clone of the seeded issue", async () => {
      const client = new MockLinearClient();
      client.seedIssue(makeIssue());

      const issue = await client.getIssue("issue-1");

      expect(issue).toEqual(makeIssue());
      issue.title = "mutated";
      expect((await client.getIssue("issue-1")).title).toBe("Focus issue");
    });

    it("throws when the issue was never seeded", () => {
      const client = new MockLinearClient();
      expect(() => client.getIssue("missing")).toThrow(/Issue missing not found/);
    });
  });

  describe("searchIssues", () => {
    it("filters by state", async () => {
      const client = new MockLinearClient();
      client.seedIssue(makeIssue({ id: "a", state: "Todo" }));
      client.seedIssue(makeIssue({ id: "b", state: "Done" }));

      const result = await client.searchIssues({ state: "Todo" });

      expect(result.map((i) => i.id)).toEqual(["a"]);
    });

    it("filters by projectName when given", async () => {
      const client = new MockLinearClient();
      client.seedIssue(makeIssue({ id: "a", state: "Todo", project: "Backend" }));
      client.seedIssue(makeIssue({ id: "b", state: "Todo", project: "Frontend" }));

      const result = await client.searchIssues({ state: "Todo", projectName: "Frontend" });

      expect(result.map((i) => i.id)).toEqual(["b"]);
    });

    it("returns an empty array when nothing matches", async () => {
      const client = new MockLinearClient();
      client.seedIssue(makeIssue({ state: "Todo" }));

      const result = await client.searchIssues({ state: "Done" });

      expect(result).toEqual([]);
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

    it("getPostedComments returns a copy, not a live reference", async () => {
      const client = new MockLinearClient();
      await client.postComment("issue-1", "hello");
      const comments = client.getPostedComments();
      comments.push({ issueId: "mutated", body: "x" });

      expect(client.getPostedComments()).toHaveLength(1);
    });
  });

  describe("updateIssueState", () => {
    it("updates the state of a seeded issue", async () => {
      const client = new MockLinearClient();
      client.seedIssue(makeIssue({ state: "Todo" }));

      await client.updateIssueState("issue-1", "In Progress");

      expect((await client.getIssue("issue-1")).state).toBe("In Progress");
    });

    it("is a no-op for an issue that was never seeded", async () => {
      const client = new MockLinearClient();
      await expect(client.updateIssueState("missing", "Done")).resolves.toBeUndefined();
    });
  });

  describe("addLabel / removeLabel / listLabels", () => {
    it("addLabel adds a new label without duplicating an existing one", async () => {
      const client = new MockLinearClient();
      client.seedIssue(makeIssue({ labels: ["bug"] }));

      await client.addLabel("issue-1", "urgent");
      await client.addLabel("issue-1", "bug");

      expect(await client.listLabels("issue-1")).toEqual(["bug", "urgent"]);
    });

    it("removeLabel removes a label if present", async () => {
      const client = new MockLinearClient();
      client.seedIssue(makeIssue({ labels: ["bug", "urgent"] }));

      await client.removeLabel("issue-1", "bug");

      expect(await client.listLabels("issue-1")).toEqual(["urgent"]);
    });

    it("addLabel/removeLabel are no-ops for an issue that was never seeded", async () => {
      const client = new MockLinearClient();
      await expect(client.addLabel("missing", "x")).resolves.toBeUndefined();
      await expect(client.removeLabel("missing", "x")).resolves.toBeUndefined();
    });

    it("listLabels returns an empty array for an unseeded issue", async () => {
      const client = new MockLinearClient();
      expect(await client.listLabels("missing")).toEqual([]);
    });
  });
});
