import { describe, it, expect } from "vitest";
import { MockLinearClient, type LinearIssue } from "../../src/linear/linearClient.js";

function makeIssue(overrides: Partial<LinearIssue> = {}): LinearIssue {
  return {
    id: "issue-1",
    identifier: "PRY-1",
    title: "Fix bug",
    description: "Some description",
    branchName: "ai/issue-1",
    state: "Todo",
    labels: [],
    priority: 1,
    url: "https://linear.app/team/issue/PRY-1",
    project: "Core",
    team: "PRY",
    cycle: "Cycle 1",
    ...overrides,
  };
}

describe("MockLinearClient", () => {
  describe("getIssue", () => {
    it("returns a deep-cloned copy of the seeded issue", async () => {
      const client = new MockLinearClient();
      const issue = makeIssue();
      client.seedIssue(issue);

      const result = await client.getIssue("issue-1");

      expect(result).toEqual(issue);
      expect(result).not.toBe(issue);
    });

    it("throws when the issue was not seeded", () => {
      const client = new MockLinearClient();

      expect(() => client.getIssue("missing")).toThrow("Mock: Issue missing not found");
    });
  });

  describe("searchIssues", () => {
    it("matches issues by state only when no other filter is given", async () => {
      const client = new MockLinearClient();
      client.seedIssue(makeIssue({ id: "a", state: "Todo" }));
      client.seedIssue(makeIssue({ id: "b", state: "Done" }));

      const results = await client.searchIssues({ state: "Todo" });

      expect(results.map((r) => r.id)).toEqual(["a"]);
    });

    it("filters out issues with a different state", async () => {
      const client = new MockLinearClient();
      client.seedIssue(makeIssue({ id: "a", state: "In Progress" }));

      const results = await client.searchIssues({ state: "Todo" });

      expect(results).toEqual([]);
    });

    it("additionally filters by projectName when provided", async () => {
      const client = new MockLinearClient();
      client.seedIssue(makeIssue({ id: "a", state: "Todo", project: "Core" }));
      client.seedIssue(makeIssue({ id: "b", state: "Todo", project: "Other" }));

      const results = await client.searchIssues({ state: "Todo", projectName: "Core" });

      expect(results.map((r) => r.id)).toEqual(["a"]);
    });

    it("excludes issues whose project does not match projectName", async () => {
      const client = new MockLinearClient();
      client.seedIssue(makeIssue({ id: "a", state: "Todo", project: undefined }));

      const results = await client.searchIssues({ state: "Todo", projectName: "Core" });

      expect(results).toEqual([]);
    });

    it("returns deep-cloned issues so mutating the result does not affect the store", async () => {
      const client = new MockLinearClient();
      client.seedIssue(makeIssue({ id: "a", state: "Todo" }));

      const [result] = await client.searchIssues({ state: "Todo" });
      result.title = "Mutated";

      const [again] = await client.searchIssues({ state: "Todo" });
      expect(again.title).toBe("Fix bug");
    });
  });

  describe("postComment", () => {
    it("records the comment and makes it retrievable via getPostedComments", async () => {
      const client = new MockLinearClient();

      await client.postComment("issue-1", "Hello world");
      await client.postComment("issue-2", "Second comment");

      expect(client.getPostedComments()).toEqual([
        { issueId: "issue-1", body: "Hello world" },
        { issueId: "issue-2", body: "Second comment" },
      ]);
    });

    it("returns a copy from getPostedComments so callers cannot mutate internal state", async () => {
      const client = new MockLinearClient();
      await client.postComment("issue-1", "Hello");

      const comments = client.getPostedComments();
      comments.push({ issueId: "issue-x", body: "injected" });

      expect(client.getPostedComments()).toEqual([{ issueId: "issue-1", body: "Hello" }]);
    });
  });

  describe("updateIssueState", () => {
    it("updates the state of a seeded issue", async () => {
      const client = new MockLinearClient();
      client.seedIssue(makeIssue({ id: "issue-1", state: "Todo" }));

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
    it("adds a new label to a seeded issue", async () => {
      const client = new MockLinearClient();
      client.seedIssue(makeIssue({ id: "issue-1", labels: ["existing"] }));

      await client.addLabel("issue-1", "urgent");

      const issue = await client.getIssue("issue-1");
      expect(issue.labels).toEqual(["existing", "urgent"]);
    });

    it("does not duplicate a label that is already present", async () => {
      const client = new MockLinearClient();
      client.seedIssue(makeIssue({ id: "issue-1", labels: ["urgent"] }));

      await client.addLabel("issue-1", "urgent");

      const issue = await client.getIssue("issue-1");
      expect(issue.labels).toEqual(["urgent"]);
    });

    it("is a no-op when the issue does not exist", async () => {
      const client = new MockLinearClient();

      await expect(client.addLabel("missing", "urgent")).resolves.toBeUndefined();
    });
  });

  describe("removeLabel", () => {
    it("removes a label present on a seeded issue", async () => {
      const client = new MockLinearClient();
      client.seedIssue(makeIssue({ id: "issue-1", labels: ["urgent", "bug"] }));

      await client.removeLabel("issue-1", "urgent");

      const issue = await client.getIssue("issue-1");
      expect(issue.labels).toEqual(["bug"]);
    });

    it("is a no-op when the label is not present", async () => {
      const client = new MockLinearClient();
      client.seedIssue(makeIssue({ id: "issue-1", labels: ["bug"] }));

      await client.removeLabel("issue-1", "urgent");

      const issue = await client.getIssue("issue-1");
      expect(issue.labels).toEqual(["bug"]);
    });

    it("is a no-op when the issue does not exist", async () => {
      const client = new MockLinearClient();

      await expect(client.removeLabel("missing", "urgent")).resolves.toBeUndefined();
    });
  });

  describe("listLabels", () => {
    it("returns a copy of the seeded issue's labels", async () => {
      const client = new MockLinearClient();
      client.seedIssue(makeIssue({ id: "issue-1", labels: ["a", "b"] }));

      const labels = await client.listLabels("issue-1");

      expect(labels).toEqual(["a", "b"]);
    });

    it("returns a copy so mutating it does not affect the stored issue", async () => {
      const client = new MockLinearClient();
      client.seedIssue(makeIssue({ id: "issue-1", labels: ["a"] }));

      const labels = await client.listLabels("issue-1");
      labels.push("injected");

      const again = await client.listLabels("issue-1");
      expect(again).toEqual(["a"]);
    });

    it("returns an empty array when the issue does not exist", async () => {
      const client = new MockLinearClient();

      const labels = await client.listLabels("missing");

      expect(labels).toEqual([]);
    });
  });
});
