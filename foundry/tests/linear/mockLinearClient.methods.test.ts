import { describe, it, expect } from "vitest";
import { MockLinearClient, type LinearIssue } from "../../src/linear/linearClient.js";

function makeIssue(overrides: Partial<LinearIssue> & { id: string }): LinearIssue {
  return {
    identifier: "PRY-1",
    title: "Issue",
    description: "",
    branchName: "ai/issue-1",
    state: "Todo",
    labels: [],
    priority: 0,
    ...overrides,
  };
}

describe("MockLinearClient", () => {
  describe("getIssue", () => {
    it("returns a clone of the seeded issue (mutating the seed does not affect it)", async () => {
      const client = new MockLinearClient();
      const issue = makeIssue({ id: "issue-1", labels: ["bug"] });
      client.seedIssue(issue);
      issue.title = "Mutated after seeding";

      const result = await client.getIssue("issue-1");
      expect(result.title).toBe("Issue");
    });

    it("throws when the issue was not seeded", () => {
      const client = new MockLinearClient();
      expect(() => client.getIssue("missing")).toThrow("Mock: Issue missing not found");
    });
  });

  describe("searchIssues", () => {
    it("filters by state and returns matches", async () => {
      const client = new MockLinearClient();
      client.seedIssue(makeIssue({ id: "todo-1", state: "Todo" }));
      client.seedIssue(makeIssue({ id: "done-1", state: "Done" }));

      const results = await client.searchIssues({ state: "Todo" });

      expect(results.map((r) => r.id)).toEqual(["todo-1"]);
    });

    it("further filters by projectName when provided", async () => {
      const client = new MockLinearClient();
      client.seedIssue(makeIssue({ id: "match", state: "Todo", project: "Foundry" }));
      client.seedIssue(makeIssue({ id: "other-project", state: "Todo", project: "Other" }));
      client.seedIssue(makeIssue({ id: "no-project", state: "Todo" }));

      const results = await client.searchIssues({ state: "Todo", projectName: "Foundry" });

      expect(results.map((r) => r.id)).toEqual(["match"]);
    });

    it("returns no matches when nothing has the requested state", async () => {
      const client = new MockLinearClient();
      client.seedIssue(makeIssue({ id: "done-1", state: "Done" }));

      const results = await client.searchIssues({ state: "Todo" });

      expect(results).toEqual([]);
    });
  });

  describe("postComment", () => {
    it("records posted comments retrievable via getPostedComments", async () => {
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

      const result = await client.getIssue("issue-1");
      expect(result.state).toBe("Done");
    });

    it("is a no-op when the issue was not seeded", async () => {
      const client = new MockLinearClient();
      await expect(client.updateIssueState("missing", "Done")).resolves.toBeUndefined();
    });
  });

  describe("addLabel", () => {
    it("adds a new label to a seeded issue", async () => {
      const client = new MockLinearClient();
      client.seedIssue(makeIssue({ id: "issue-1", labels: [] }));

      await client.addLabel("issue-1", "bug");

      const result = await client.getIssue("issue-1");
      expect(result.labels).toEqual(["bug"]);
    });

    it("does not duplicate a label that is already present", async () => {
      const client = new MockLinearClient();
      client.seedIssue(makeIssue({ id: "issue-1", labels: ["bug"] }));

      await client.addLabel("issue-1", "bug");

      const result = await client.getIssue("issue-1");
      expect(result.labels).toEqual(["bug"]);
    });

    it("is a no-op when the issue was not seeded", async () => {
      const client = new MockLinearClient();
      await expect(client.addLabel("missing", "bug")).resolves.toBeUndefined();
    });
  });

  describe("removeLabel", () => {
    it("removes a label from a seeded issue", async () => {
      const client = new MockLinearClient();
      client.seedIssue(makeIssue({ id: "issue-1", labels: ["bug", "urgent"] }));

      await client.removeLabel("issue-1", "bug");

      const result = await client.getIssue("issue-1");
      expect(result.labels).toEqual(["urgent"]);
    });

    it("is a no-op when the label is not present", async () => {
      const client = new MockLinearClient();
      client.seedIssue(makeIssue({ id: "issue-1", labels: ["urgent"] }));

      await client.removeLabel("issue-1", "bug");

      const result = await client.getIssue("issue-1");
      expect(result.labels).toEqual(["urgent"]);
    });

    it("is a no-op when the issue was not seeded", async () => {
      const client = new MockLinearClient();
      await expect(client.removeLabel("missing", "bug")).resolves.toBeUndefined();
    });
  });

  describe("listLabels", () => {
    it("returns a copy of the seeded issue's labels", async () => {
      const client = new MockLinearClient();
      client.seedIssue(makeIssue({ id: "issue-1", labels: ["bug", "urgent"] }));

      const labels = await client.listLabels("issue-1");
      expect(labels).toEqual(["bug", "urgent"]);

      labels.push("mutated");
      const second = await client.listLabels("issue-1");
      expect(second).toEqual(["bug", "urgent"]);
    });

    it("returns [] when the issue was not seeded", async () => {
      const client = new MockLinearClient();
      const labels = await client.listLabels("missing");
      expect(labels).toEqual([]);
    });
  });
});
