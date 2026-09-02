import { describe, it, expect, beforeEach } from "vitest";
import { MockLinearClient, type LinearIssue } from "../../src/linear/linearClient.js";

function makeIssue(overrides: Partial<LinearIssue> = {}): LinearIssue {
  return {
    id: "issue-1",
    identifier: "ENG-1",
    title: "Fix the bug",
    description: "Some description",
    branchName: "ai/issue-1",
    state: "Todo",
    labels: ["bug"],
    priority: 2,
    url: "https://linear.app/team/issue/ENG-1",
    project: "Core",
    ...overrides,
  };
}

describe("MockLinearClient", () => {
  let client: MockLinearClient;

  beforeEach(() => {
    client = new MockLinearClient();
  });

  describe("getIssue", () => {
    it("returns a shallow-cloned copy of a seeded issue (a distinct top-level object)", async () => {
      const issue = makeIssue();
      client.seedIssue(issue);

      const result = await client.getIssue("issue-1");
      expect(result).toEqual(issue);
      expect(result).not.toBe(issue);

      // Reassigning a top-level field on the returned object must not affect
      // internal state (seedIssue itself deep-copies on the way in).
      result.title = "Mutated title";
      const second = await client.getIssue("issue-1");
      expect(second.title).toBe("Fix the bug");
    });

    it("throws a descriptive error for an unknown issue id", () => {
      // The mock throws synchronously (before wrapping in a Promise), so it
      // must be asserted as a synchronous throw rather than a rejected promise.
      expect(() => client.getIssue("does-not-exist")).toThrow(
        "Mock: Issue does-not-exist not found",
      );
    });
  });

  describe("searchIssues", () => {
    it("matches issues by state only when no projectName filter given", async () => {
      client.seedIssue(makeIssue({ id: "i1", state: "Todo", project: "Core" }));
      client.seedIssue(makeIssue({ id: "i2", state: "Todo", project: "Other" }));
      client.seedIssue(makeIssue({ id: "i3", state: "Done", project: "Core" }));

      const results = await client.searchIssues({ state: "Todo" });
      expect(results.map((r) => r.id).sort()).toEqual(["i1", "i2"]);
    });

    it("filters by projectName when provided, in addition to state", async () => {
      client.seedIssue(makeIssue({ id: "i1", state: "Todo", project: "Core" }));
      client.seedIssue(makeIssue({ id: "i2", state: "Todo", project: "Other" }));

      const results = await client.searchIssues({ state: "Todo", projectName: "Core" });
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe("i1");
    });

    it("returns an empty array when no issues match the state", async () => {
      client.seedIssue(makeIssue({ id: "i1", state: "Todo" }));

      const results = await client.searchIssues({ state: "Done" });
      expect(results).toEqual([]);
    });

    it("returns cloned issues, not references to internal state", async () => {
      client.seedIssue(makeIssue({ id: "i1", state: "Todo" }));
      const [result] = await client.searchIssues({ state: "Todo" });
      result.title = "mutated title";

      const [second] = await client.searchIssues({ state: "Todo" });
      expect(second.title).toBe("Fix the bug");
    });
  });

  describe("postComment", () => {
    it("records posted comments retrievable via getPostedComments", async () => {
      await client.postComment("issue-1", "First comment");
      await client.postComment("issue-2", "Second comment");

      const comments = client.getPostedComments();
      expect(comments).toEqual([
        { issueId: "issue-1", body: "First comment" },
        { issueId: "issue-2", body: "Second comment" },
      ]);
    });

    it("getPostedComments returns a copy, not the live array", async () => {
      await client.postComment("issue-1", "Comment");
      const comments = client.getPostedComments();
      comments.push({ issueId: "hacked", body: "should not persist" });

      expect(client.getPostedComments()).toHaveLength(1);
    });

    it("does not require the issue to have been seeded", async () => {
      await expect(client.postComment("unknown-issue", "hi")).resolves.toBeUndefined();
      expect(client.getPostedComments()).toEqual([{ issueId: "unknown-issue", body: "hi" }]);
    });
  });

  describe("updateIssueState", () => {
    it("updates the state of a seeded issue", async () => {
      client.seedIssue(makeIssue({ id: "issue-1", state: "Todo" }));
      await client.updateIssueState("issue-1", "In Progress");

      const updated = await client.getIssue("issue-1");
      expect(updated.state).toBe("In Progress");
    });

    it("is a no-op (does not throw) for an unknown issue id", async () => {
      await expect(client.updateIssueState("unknown", "Done")).resolves.toBeUndefined();
    });
  });

  describe("addLabel", () => {
    it("adds a new label to a seeded issue", async () => {
      client.seedIssue(makeIssue({ id: "issue-1", labels: ["bug"] }));
      await client.addLabel("issue-1", "priority-high");

      const updated = await client.getIssue("issue-1");
      expect(updated.labels).toEqual(["bug", "priority-high"]);
    });

    it("does not duplicate a label the issue already has", async () => {
      client.seedIssue(makeIssue({ id: "issue-1", labels: ["bug"] }));
      await client.addLabel("issue-1", "bug");

      const updated = await client.getIssue("issue-1");
      expect(updated.labels).toEqual(["bug"]);
    });

    it("is a no-op (does not throw) for an unknown issue id", async () => {
      await expect(client.addLabel("unknown", "bug")).resolves.toBeUndefined();
    });
  });

  describe("removeLabel", () => {
    it("removes an existing label from a seeded issue", async () => {
      client.seedIssue(makeIssue({ id: "issue-1", labels: ["bug", "priority-high"] }));
      await client.removeLabel("issue-1", "bug");

      const updated = await client.getIssue("issue-1");
      expect(updated.labels).toEqual(["priority-high"]);
    });

    it("is a no-op when removing a label the issue does not have", async () => {
      client.seedIssue(makeIssue({ id: "issue-1", labels: ["bug"] }));
      await client.removeLabel("issue-1", "not-present");

      const updated = await client.getIssue("issue-1");
      expect(updated.labels).toEqual(["bug"]);
    });

    it("is a no-op (does not throw) for an unknown issue id", async () => {
      await expect(client.removeLabel("unknown", "bug")).resolves.toBeUndefined();
    });
  });

  describe("listLabels", () => {
    it("returns a copy of the seeded issue's labels", async () => {
      client.seedIssue(makeIssue({ id: "issue-1", labels: ["bug", "urgent"] }));
      const labels = await client.listLabels("issue-1");
      expect(labels).toEqual(["bug", "urgent"]);

      labels.push("mutated");
      const second = await client.listLabels("issue-1");
      expect(second).toEqual(["bug", "urgent"]);
    });

    it("returns an empty array for an unknown issue id", async () => {
      const labels = await client.listLabels("unknown");
      expect(labels).toEqual([]);
    });
  });
});
