import { describe, it, expect } from "vitest";
import { MockLinearClient, type LinearIssue } from "../../src/linear/linearClient.js";

function makeIssue(overrides: Partial<LinearIssue> = {}): LinearIssue {
  return {
    id: "issue-1",
    identifier: "PRY-1",
    title: "Focus issue",
    description: "desc",
    branchName: "ai/issue-1",
    state: "Todo",
    labels: [],
    priority: 0,
    ...overrides,
  };
}

describe("MockLinearClient", () => {
  describe("getIssue", () => {
    it("returns a seeded issue by id", async () => {
      const client = new MockLinearClient();
      client.seedIssue(makeIssue());

      const issue = await client.getIssue("issue-1");

      expect(issue).toEqual(makeIssue());
    });

    it("returns a clone, not the stored reference", async () => {
      const client = new MockLinearClient();
      client.seedIssue(makeIssue());

      const issue = await client.getIssue("issue-1");
      issue.title = "Mutated";

      const second = await client.getIssue("issue-1");
      expect(second.title).toBe("Focus issue");
    });

    it("throws when the issue was not seeded", () => {
      const client = new MockLinearClient();
      expect(() => client.getIssue("missing")).toThrow("Mock: Issue missing not found");
    });
  });

  describe("searchIssues", () => {
    it("filters by state only", async () => {
      const client = new MockLinearClient();
      client.seedIssue(makeIssue({ id: "a", state: "Todo" }));
      client.seedIssue(makeIssue({ id: "b", state: "Done" }));

      const results = await client.searchIssues({ state: "Todo" });

      expect(results).toHaveLength(1);
      expect(results[0].id).toBe("a");
    });

    it("filters by state and projectName together", async () => {
      const client = new MockLinearClient();
      client.seedIssue(makeIssue({ id: "a", state: "Todo", project: "Alpha" }));
      client.seedIssue(makeIssue({ id: "b", state: "Todo", project: "Beta" }));

      const results = await client.searchIssues({ state: "Todo", projectName: "Alpha" });

      expect(results).toHaveLength(1);
      expect(results[0].id).toBe("a");
    });

    it("returns an empty array when nothing matches", async () => {
      const client = new MockLinearClient();
      client.seedIssue(makeIssue({ id: "a", state: "Todo" }));

      const results = await client.searchIssues({ state: "Done" });

      expect(results).toEqual([]);
    });

    it("returns clones so mutating a result does not affect the store", async () => {
      const client = new MockLinearClient();
      client.seedIssue(makeIssue({ id: "a", state: "Todo" }));

      const [result] = await client.searchIssues({ state: "Todo" });
      result.title = "Mutated";

      const [second] = await client.searchIssues({ state: "Todo" });
      expect(second.title).toBe("Focus issue");
    });
  });

  describe("postComment", () => {
    it("records the comment and exposes it via getPostedComments", async () => {
      const client = new MockLinearClient();
      await client.postComment("issue-1", "hello world");

      expect(client.getPostedComments()).toEqual([{ issueId: "issue-1", body: "hello world" }]);
    });

    it("accumulates multiple comments in order", async () => {
      const client = new MockLinearClient();
      await client.postComment("issue-1", "first");
      await client.postComment("issue-2", "second");

      expect(client.getPostedComments()).toEqual([
        { issueId: "issue-1", body: "first" },
        { issueId: "issue-2", body: "second" },
      ]);
    });
  });

  describe("updateIssueState", () => {
    it("updates the state of a seeded issue", async () => {
      const client = new MockLinearClient();
      client.seedIssue(makeIssue({ state: "Todo" }));

      await client.updateIssueState("issue-1", "Done");

      const issue = await client.getIssue("issue-1");
      expect(issue.state).toBe("Done");
    });

    it("is a no-op when the issue does not exist", async () => {
      const client = new MockLinearClient();
      await expect(client.updateIssueState("missing", "Done")).resolves.toBeUndefined();
    });
  });

  describe("addLabel", () => {
    it("adds a new label to the issue", async () => {
      const client = new MockLinearClient();
      client.seedIssue(makeIssue({ labels: ["existing"] }));

      await client.addLabel("issue-1", "new-label");

      const labels = await client.listLabels("issue-1");
      expect(labels).toEqual(["existing", "new-label"]);
    });

    it("does not duplicate a label that is already present", async () => {
      const client = new MockLinearClient();
      client.seedIssue(makeIssue({ labels: ["existing"] }));

      await client.addLabel("issue-1", "existing");

      const labels = await client.listLabels("issue-1");
      expect(labels).toEqual(["existing"]);
    });

    it("is a no-op when the issue does not exist", async () => {
      const client = new MockLinearClient();
      await expect(client.addLabel("missing", "label")).resolves.toBeUndefined();
    });
  });

  describe("removeLabel", () => {
    it("removes a label present on the issue", async () => {
      const client = new MockLinearClient();
      client.seedIssue(makeIssue({ labels: ["a", "b"] }));

      await client.removeLabel("issue-1", "a");

      const labels = await client.listLabels("issue-1");
      expect(labels).toEqual(["b"]);
    });

    it("is a no-op when the label is not present", async () => {
      const client = new MockLinearClient();
      client.seedIssue(makeIssue({ labels: ["a"] }));

      await client.removeLabel("issue-1", "not-there");

      const labels = await client.listLabels("issue-1");
      expect(labels).toEqual(["a"]);
    });

    it("is a no-op when the issue does not exist", async () => {
      const client = new MockLinearClient();
      await expect(client.removeLabel("missing", "a")).resolves.toBeUndefined();
    });
  });

  describe("listLabels", () => {
    it("returns a clone of the issue's labels", async () => {
      const client = new MockLinearClient();
      client.seedIssue(makeIssue({ labels: ["a", "b"] }));

      const labels = await client.listLabels("issue-1");
      labels.push("mutated");

      const second = await client.listLabels("issue-1");
      expect(second).toEqual(["a", "b"]);
    });

    it("returns an empty array when the issue does not exist", async () => {
      const client = new MockLinearClient();
      await expect(client.listLabels("missing")).resolves.toEqual([]);
    });
  });
});
