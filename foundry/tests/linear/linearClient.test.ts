import { describe, it, expect } from "vitest";
import { MockLinearClient, type LinearIssue } from "../../src/linear/linearClient.js";

function makeIssue(overrides: Partial<LinearIssue> = {}): LinearIssue {
  return {
    id: "issue-1",
    identifier: "PRY-1",
    title: "Do the thing",
    description: "Some description",
    branchName: "ai/issue-1",
    state: "Todo",
    labels: [],
    priority: 1,
    project: "Project A",
    ...overrides,
  };
}

describe("MockLinearClient", () => {
  describe("getIssue", () => {
    it("returns a clone of the seeded issue", async () => {
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
    it("matches issues by state only when no projectName filter is given", async () => {
      const client = new MockLinearClient();
      client.seedIssue(makeIssue({ id: "a", state: "Todo" }));
      client.seedIssue(makeIssue({ id: "b", state: "Done" }));

      const result = await client.searchIssues({ state: "Todo" });

      expect(result.map((i) => i.id)).toEqual(["a"]);
    });

    it("filters by projectName when provided", async () => {
      const client = new MockLinearClient();
      client.seedIssue(makeIssue({ id: "a", state: "Todo", project: "Project A" }));
      client.seedIssue(makeIssue({ id: "b", state: "Todo", project: "Project B" }));

      const result = await client.searchIssues({ state: "Todo", projectName: "Project A" });

      expect(result.map((i) => i.id)).toEqual(["a"]);
    });

    it("returns an empty array when nothing matches", async () => {
      const client = new MockLinearClient();
      client.seedIssue(makeIssue({ id: "a", state: "Done" }));

      const result = await client.searchIssues({ state: "Todo" });

      expect(result).toEqual([]);
    });

    it("returns clones so mutating results does not affect stored issues", async () => {
      const client = new MockLinearClient();
      client.seedIssue(makeIssue({ id: "a", state: "Todo" }));

      const result = await client.searchIssues({ state: "Todo" });
      result[0].title = "Mutated";

      const second = await client.getIssue("a");
      expect(second.title).toBe("Do the thing");
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

    it("returns a defensive copy from getPostedComments", async () => {
      const client = new MockLinearClient();
      await client.postComment("issue-1", "Hello");

      const comments = client.getPostedComments();
      comments.push({ issueId: "x", body: "y" });

      expect(client.getPostedComments()).toHaveLength(1);
    });
  });

  describe("updateIssueState", () => {
    it("updates the state of a seeded issue", async () => {
      const client = new MockLinearClient();
      client.seedIssue(makeIssue({ id: "issue-1", state: "Todo" }));

      await client.updateIssueState("issue-1", "In Progress");

      const result = await client.getIssue("issue-1");
      expect(result.state).toBe("In Progress");
    });

    it("is a no-op when the issue was never seeded", async () => {
      const client = new MockLinearClient();

      await expect(client.updateIssueState("missing", "Done")).resolves.toBeUndefined();
    });
  });

  describe("addLabel", () => {
    it("adds a label to a seeded issue", async () => {
      const client = new MockLinearClient();
      client.seedIssue(makeIssue({ id: "issue-1", labels: [] }));

      await client.addLabel("issue-1", "ai:todo");

      expect(await client.listLabels("issue-1")).toEqual(["ai:todo"]);
    });

    it("does not add a duplicate label that is already present", async () => {
      const client = new MockLinearClient();
      client.seedIssue(makeIssue({ id: "issue-1", labels: ["ai:todo"] }));

      await client.addLabel("issue-1", "ai:todo");

      expect(await client.listLabels("issue-1")).toEqual(["ai:todo"]);
    });

    it("is a no-op when the issue was never seeded", async () => {
      const client = new MockLinearClient();

      await expect(client.addLabel("missing", "ai:todo")).resolves.toBeUndefined();
    });
  });

  describe("removeLabel", () => {
    it("removes an existing label", async () => {
      const client = new MockLinearClient();
      client.seedIssue(makeIssue({ id: "issue-1", labels: ["ai:todo", "bug"] }));

      await client.removeLabel("issue-1", "ai:todo");

      expect(await client.listLabels("issue-1")).toEqual(["bug"]);
    });

    it("is a no-op when the label is not present", async () => {
      const client = new MockLinearClient();
      client.seedIssue(makeIssue({ id: "issue-1", labels: ["bug"] }));

      await client.removeLabel("issue-1", "ai:todo");

      expect(await client.listLabels("issue-1")).toEqual(["bug"]);
    });

    it("is a no-op when the issue was never seeded", async () => {
      const client = new MockLinearClient();

      await expect(client.removeLabel("missing", "ai:todo")).resolves.toBeUndefined();
    });
  });

  describe("listLabels", () => {
    it("returns [] for an issue that was never seeded", async () => {
      const client = new MockLinearClient();

      const labels = await client.listLabels("missing");

      expect(labels).toEqual([]);
    });

    it("returns a defensive copy of the issue's labels", async () => {
      const client = new MockLinearClient();
      client.seedIssue(makeIssue({ id: "issue-1", labels: ["ai:todo"] }));

      const labels = await client.listLabels("issue-1");
      labels.push("mutated");

      expect(await client.listLabels("issue-1")).toEqual(["ai:todo"]);
    });
  });
});
