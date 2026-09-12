import { describe, it, expect } from "vitest";
import { MockLinearClient, type LinearIssue } from "../../src/linear/linearClient.js";

function makeIssue(overrides: Partial<LinearIssue> = {}): LinearIssue {
  return {
    id: "issue-1",
    identifier: "PRY-1",
    title: "Test issue",
    description: "A description",
    branchName: "ai/issue-1",
    state: "Todo",
    labels: [],
    priority: 1,
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
      expect(() => client.getIssue("missing")).toThrow("Mock: Issue missing not found");
    });
  });

  describe("searchIssues", () => {
    it("matches only issues in the requested state", async () => {
      const client = new MockLinearClient();
      client.seedIssue(makeIssue({ id: "a", state: "Todo" }));
      client.seedIssue(makeIssue({ id: "b", state: "Done" }));

      const results = await client.searchIssues({ state: "Todo" });

      expect(results.map((i) => i.id)).toEqual(["a"]);
    });

    it("further filters by projectName when provided", async () => {
      const client = new MockLinearClient();
      client.seedIssue(makeIssue({ id: "a", state: "Todo", project: "Foundry" }));
      client.seedIssue(makeIssue({ id: "b", state: "Todo", project: "Other" }));

      const results = await client.searchIssues({ state: "Todo", projectName: "Foundry" });

      expect(results.map((i) => i.id)).toEqual(["a"]);
    });

    it("returns cloned issues, not references to the internal store", async () => {
      const client = new MockLinearClient();
      client.seedIssue(makeIssue({ id: "a", state: "Todo" }));

      const [result] = await client.searchIssues({ state: "Todo" });
      result.title = "Mutated";

      const [second] = await client.searchIssues({ state: "Todo" });
      expect(second.title).toBe("Test issue");
    });
  });

  describe("postComment", () => {
    it("records posted comments and exposes them via getPostedComments", async () => {
      const client = new MockLinearClient();

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
      const client = new MockLinearClient();
      client.seedIssue(makeIssue({ id: "issue-1", state: "Todo" }));

      await client.updateIssueState("issue-1", "In Progress");

      const issue = await client.getIssue("issue-1");
      expect(issue.state).toBe("In Progress");
    });

    it("is a no-op for an issue that was never seeded", async () => {
      const client = new MockLinearClient();
      await expect(client.updateIssueState("missing", "Done")).resolves.toBeUndefined();
    });
  });

  describe("addLabel / removeLabel / listLabels", () => {
    it("adds a label that is not already present", async () => {
      const client = new MockLinearClient();
      client.seedIssue(makeIssue({ id: "issue-1", labels: ["existing"] }));

      await client.addLabel("issue-1", "new-label");

      expect(await client.listLabels("issue-1")).toEqual(["existing", "new-label"]);
    });

    it("does not duplicate a label that is already present", async () => {
      const client = new MockLinearClient();
      client.seedIssue(makeIssue({ id: "issue-1", labels: ["existing"] }));

      await client.addLabel("issue-1", "existing");

      expect(await client.listLabels("issue-1")).toEqual(["existing"]);
    });

    it("addLabel is a no-op for an unseeded issue", async () => {
      const client = new MockLinearClient();
      await expect(client.addLabel("missing", "label")).resolves.toBeUndefined();
    });

    it("removes an existing label", async () => {
      const client = new MockLinearClient();
      client.seedIssue(makeIssue({ id: "issue-1", labels: ["a", "b"] }));

      await client.removeLabel("issue-1", "a");

      expect(await client.listLabels("issue-1")).toEqual(["b"]);
    });

    it("removeLabel is a no-op for an unseeded issue", async () => {
      const client = new MockLinearClient();
      await expect(client.removeLabel("missing", "label")).resolves.toBeUndefined();
    });

    it("listLabels returns an empty array for an unseeded issue", async () => {
      const client = new MockLinearClient();
      expect(await client.listLabels("missing")).toEqual([]);
    });

    it("listLabels returns a defensive copy", async () => {
      const client = new MockLinearClient();
      client.seedIssue(makeIssue({ id: "issue-1", labels: ["a"] }));

      const labels = await client.listLabels("issue-1");
      labels.push("mutated");

      expect(await client.listLabels("issue-1")).toEqual(["a"]);
    });
  });
});
