import { describe, it, expect } from "vitest";
import { MockLinearClient, type LinearIssue } from "../../src/linear/linearClient.js";

// NOTE: `LinearClient`, `LinearIssue`, `RelatedLinearIssue`, `RelatedIssueContext`, and
// `IssueSearchFilter` in linearClient.ts are pure TypeScript types/interfaces with no
// runtime representation, so there is nothing to execute or assert about them directly;
// they are exercised implicitly through `MockLinearClient`'s implementation below.
// `getRelatedContext` and `seedRelations`/`getPostedComments` basics are already covered by
// tests/linear/mockLinearClient.test.ts, so this file focuses on the remaining exported
// methods of `MockLinearClient` not yet exercised anywhere.

function makeIssue(overrides: Partial<LinearIssue> & { id: string }): LinearIssue {
  return {
    title: "Issue title",
    description: "Issue description",
    branchName: `ai/${overrides.id}`,
    state: "Todo",
    labels: [],
    priority: 0,
    ...overrides,
  };
}

describe("MockLinearClient", () => {
  describe("getIssue", () => {
    it("returns a copy of a seeded issue with equal contents", async () => {
      const client = new MockLinearClient();
      const seeded = makeIssue({ id: "issue-1", labels: ["bug"] });
      client.seedIssue(seeded);

      const result = await client.getIssue("issue-1");
      expect(result).toEqual(seeded);
      expect(result).not.toBe(seeded);

      // Top-level fields are shallow-copied: reassigning one on the returned
      // object does not affect the client's stored issue.
      result.state = "Done";
      const second = await client.getIssue("issue-1");
      expect(second.state).toBe("Todo");
    });

    it("throws synchronously for an issue id that was never seeded", () => {
      const client = new MockLinearClient();
      // getIssue is not declared `async`, so the "not found" error is thrown
      // synchronously rather than surfacing as a rejected promise.
      expect(() => client.getIssue("missing")).toThrow("Mock: Issue missing not found");
    });
  });

  describe("searchIssues", () => {
    it("matches only issues with the requested state", async () => {
      const client = new MockLinearClient();
      client.seedIssue(makeIssue({ id: "todo-1", state: "Todo" }));
      client.seedIssue(makeIssue({ id: "done-1", state: "Done" }));

      const results = await client.searchIssues({ state: "Todo" });

      expect(results).toHaveLength(1);
      expect(results[0].id).toBe("todo-1");
    });

    it("filters by projectName when provided", async () => {
      const client = new MockLinearClient();
      client.seedIssue(makeIssue({ id: "a", state: "Todo", project: "Alpha" }));
      client.seedIssue(makeIssue({ id: "b", state: "Todo", project: "Beta" }));

      const results = await client.searchIssues({ state: "Todo", projectName: "Alpha" });

      expect(results).toHaveLength(1);
      expect(results[0].id).toBe("a");
    });

    it("excludes issues with no project when projectName filter is set", async () => {
      const client = new MockLinearClient();
      client.seedIssue(makeIssue({ id: "a", state: "Todo" }));

      const results = await client.searchIssues({ state: "Todo", projectName: "Alpha" });

      expect(results).toEqual([]);
    });

    it("ignores projectName/team/assigneeMe filters that this mock does not implement beyond project name", async () => {
      const client = new MockLinearClient();
      client.seedIssue(makeIssue({ id: "a", state: "Todo", project: "Alpha" }));

      const results = await client.searchIssues({
        state: "Todo",
        assigneeMe: true,
        team: "ENG",
      });

      expect(results).toHaveLength(1);
    });

    it("returns an empty array when no issues match the state", async () => {
      const client = new MockLinearClient();
      client.seedIssue(makeIssue({ id: "a", state: "Todo" }));

      const results = await client.searchIssues({ state: "Done" });

      expect(results).toEqual([]);
    });

    it("returns shallow-cloned issue objects distinct from the stored ones", async () => {
      const client = new MockLinearClient();
      client.seedIssue(makeIssue({ id: "a", state: "Todo", labels: ["x"] }));

      const [result] = await client.searchIssues({ state: "Todo" });
      expect(result).not.toBe(await client.getIssue("a"));

      result.state = "Done";
      const [second] = await client.searchIssues({ state: "Todo" });
      expect(second.state).toBe("Todo");
    });
  });

  describe("postComment", () => {
    it("records the posted comment and returns it via getPostedComments", async () => {
      const client = new MockLinearClient();

      await client.postComment("issue-1", "Hello world");

      expect(client.getPostedComments()).toEqual([{ issueId: "issue-1", body: "Hello world" }]);
    });

    it("accumulates multiple comments in call order", async () => {
      const client = new MockLinearClient();

      await client.postComment("issue-1", "first");
      await client.postComment("issue-2", "second");

      expect(client.getPostedComments()).toEqual([
        { issueId: "issue-1", body: "first" },
        { issueId: "issue-2", body: "second" },
      ]);
    });

    it("returns a snapshot copy from getPostedComments (not a live reference)", async () => {
      const client = new MockLinearClient();
      await client.postComment("issue-1", "first");

      const snapshot = client.getPostedComments();
      snapshot.push({ issueId: "issue-2", body: "injected" });

      expect(client.getPostedComments()).toEqual([{ issueId: "issue-1", body: "first" }]);
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

    it("is a no-op for an issue id that was never seeded", async () => {
      const client = new MockLinearClient();

      await expect(client.updateIssueState("missing", "Done")).resolves.toBeUndefined();
    });
  });

  describe("addLabel", () => {
    it("adds a label to a seeded issue", async () => {
      const client = new MockLinearClient();
      client.seedIssue(makeIssue({ id: "issue-1", labels: ["bug"] }));

      await client.addLabel("issue-1", "urgent");

      const labels = await client.listLabels("issue-1");
      expect(labels).toEqual(["bug", "urgent"]);
    });

    it("does not duplicate a label that already exists on the issue", async () => {
      const client = new MockLinearClient();
      client.seedIssue(makeIssue({ id: "issue-1", labels: ["bug"] }));

      await client.addLabel("issue-1", "bug");

      const labels = await client.listLabels("issue-1");
      expect(labels).toEqual(["bug"]);
    });

    it("is a no-op for an issue id that was never seeded", async () => {
      const client = new MockLinearClient();

      await expect(client.addLabel("missing", "bug")).resolves.toBeUndefined();
    });
  });

  describe("removeLabel", () => {
    it("removes a label from a seeded issue", async () => {
      const client = new MockLinearClient();
      client.seedIssue(makeIssue({ id: "issue-1", labels: ["bug", "urgent"] }));

      await client.removeLabel("issue-1", "bug");

      const labels = await client.listLabels("issue-1");
      expect(labels).toEqual(["urgent"]);
    });

    it("is a no-op when removing a label that is not present", async () => {
      const client = new MockLinearClient();
      client.seedIssue(makeIssue({ id: "issue-1", labels: ["urgent"] }));

      await client.removeLabel("issue-1", "bug");

      const labels = await client.listLabels("issue-1");
      expect(labels).toEqual(["urgent"]);
    });

    it("is a no-op for an issue id that was never seeded", async () => {
      const client = new MockLinearClient();

      await expect(client.removeLabel("missing", "bug")).resolves.toBeUndefined();
    });
  });

  describe("listLabels", () => {
    it("returns the labels for a seeded issue", async () => {
      const client = new MockLinearClient();
      client.seedIssue(makeIssue({ id: "issue-1", labels: ["bug", "urgent"] }));

      await expect(client.listLabels("issue-1")).resolves.toEqual(["bug", "urgent"]);
    });

    it("returns an empty array for an issue id that was never seeded", async () => {
      const client = new MockLinearClient();

      await expect(client.listLabels("missing")).resolves.toEqual([]);
    });

    it("returns a cloned array that does not alias internal state", async () => {
      const client = new MockLinearClient();
      client.seedIssue(makeIssue({ id: "issue-1", labels: ["bug"] }));

      const labels = await client.listLabels("issue-1");
      labels.push("mutated");

      await expect(client.listLabels("issue-1")).resolves.toEqual(["bug"]);
    });
  });
});
