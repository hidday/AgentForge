import { describe, it, expect } from "vitest";
import { MockLinearClient, type LinearIssue } from "../../src/linear/linearClient.js";

function makeIssue(overrides: Partial<LinearIssue> & { id: string }): LinearIssue {
  return {
    title: "Issue title",
    description: "Issue description",
    branchName: "ai/issue-1",
    state: "Todo",
    labels: [],
    priority: 0,
    ...overrides,
  };
}

describe("MockLinearClient", () => {
  it("getIssue returns a shallow-cloned copy of the seeded issue", async () => {
    const client = new MockLinearClient();
    const issue = makeIssue({ id: "issue-1", labels: ["bug"] });
    client.seedIssue(issue);

    const result = await client.getIssue("issue-1");

    expect(result).toEqual(issue);
    // seedIssue itself deep-copies on the way in, so the returned object is a
    // distinct top-level object from what was passed to seedIssue...
    expect(result).not.toBe(issue);
    // ...but getIssue's `{ ...issue }` spread is shallow, so nested arrays
    // (like labels) still refer to the same internal storage.
    result.labels.push("mutated");
    const second = await client.getIssue("issue-1");
    expect(second.labels).toEqual(["bug", "mutated"]);
  });

  it("getIssue throws synchronously when the issue was never seeded", () => {
    const client = new MockLinearClient();
    expect(() => client.getIssue("missing")).toThrow("Mock: Issue missing not found");
  });

  describe("searchIssues", () => {
    it("matches issues by state only when no projectName filter is given", async () => {
      const client = new MockLinearClient();
      client.seedIssue(makeIssue({ id: "a", state: "Todo" }));
      client.seedIssue(makeIssue({ id: "b", state: "Done" }));

      const results = await client.searchIssues({ state: "Todo" });

      expect(results.map((i) => i.id)).toEqual(["a"]);
    });

    it("excludes issues in a different state even if projectName matches", async () => {
      const client = new MockLinearClient();
      client.seedIssue(makeIssue({ id: "a", state: "Done", project: "Foo" }));

      const results = await client.searchIssues({ state: "Todo", projectName: "Foo" });

      expect(results).toEqual([]);
    });

    it("filters by projectName when provided", async () => {
      const client = new MockLinearClient();
      client.seedIssue(makeIssue({ id: "a", state: "Todo", project: "Foo" }));
      client.seedIssue(makeIssue({ id: "b", state: "Todo", project: "Bar" }));

      const results = await client.searchIssues({ state: "Todo", projectName: "Foo" });

      expect(results.map((i) => i.id)).toEqual(["a"]);
    });

    it("excludes an issue with no project when a projectName filter is set", async () => {
      const client = new MockLinearClient();
      client.seedIssue(makeIssue({ id: "a", state: "Todo" }));

      const results = await client.searchIssues({ state: "Todo", projectName: "Foo" });

      expect(results).toEqual([]);
    });

    it("returns cloned issues, not references to internal state", async () => {
      const client = new MockLinearClient();
      client.seedIssue(makeIssue({ id: "a", state: "Todo" }));

      const [result] = await client.searchIssues({ state: "Todo" });
      result.title = "Mutated";

      const [second] = await client.searchIssues({ state: "Todo" });
      expect(second.title).toBe("Issue title");
    });
  });

  describe("postComment", () => {
    it("records posted comments and exposes them via getPostedComments", async () => {
      const client = new MockLinearClient();

      await client.postComment("issue-1", "First comment");
      await client.postComment("issue-2", "Second comment");

      expect(client.getPostedComments()).toEqual([
        { issueId: "issue-1", body: "First comment" },
        { issueId: "issue-2", body: "Second comment" },
      ]);
    });

    it("getPostedComments returns a copy, not the live array", async () => {
      const client = new MockLinearClient();
      await client.postComment("issue-1", "Comment");

      const comments = client.getPostedComments();
      comments.push({ issueId: "issue-2", body: "Injected" });

      expect(client.getPostedComments()).toEqual([{ issueId: "issue-1", body: "Comment" }]);
    });
  });

  describe("updateIssueState", () => {
    it("updates the state of an existing issue", async () => {
      const client = new MockLinearClient();
      client.seedIssue(makeIssue({ id: "issue-1", state: "Todo" }));

      await client.updateIssueState("issue-1", "Done");

      const result = await client.getIssue("issue-1");
      expect(result.state).toBe("Done");
    });

    it("does nothing (and does not throw) for an issue that was never seeded", async () => {
      const client = new MockLinearClient();

      await expect(client.updateIssueState("missing", "Done")).resolves.toBeUndefined();
    });
  });

  describe("addLabel", () => {
    it("adds a new label to an existing issue", async () => {
      const client = new MockLinearClient();
      client.seedIssue(makeIssue({ id: "issue-1", labels: ["bug"] }));

      await client.addLabel("issue-1", "urgent");

      const labels = await client.listLabels("issue-1");
      expect(labels).toEqual(["bug", "urgent"]);
    });

    it("does not duplicate a label that is already present", async () => {
      const client = new MockLinearClient();
      client.seedIssue(makeIssue({ id: "issue-1", labels: ["bug"] }));

      await client.addLabel("issue-1", "bug");

      const labels = await client.listLabels("issue-1");
      expect(labels).toEqual(["bug"]);
    });

    it("does nothing (and does not throw) for an issue that was never seeded", async () => {
      const client = new MockLinearClient();

      await expect(client.addLabel("missing", "bug")).resolves.toBeUndefined();
    });
  });

  describe("removeLabel", () => {
    it("removes an existing label from an issue", async () => {
      const client = new MockLinearClient();
      client.seedIssue(makeIssue({ id: "issue-1", labels: ["bug", "urgent"] }));

      await client.removeLabel("issue-1", "bug");

      const labels = await client.listLabels("issue-1");
      expect(labels).toEqual(["urgent"]);
    });

    it("does nothing when the label is not present on the issue", async () => {
      const client = new MockLinearClient();
      client.seedIssue(makeIssue({ id: "issue-1", labels: ["urgent"] }));

      await client.removeLabel("issue-1", "bug");

      const labels = await client.listLabels("issue-1");
      expect(labels).toEqual(["urgent"]);
    });

    it("does nothing (and does not throw) for an issue that was never seeded", async () => {
      const client = new MockLinearClient();

      await expect(client.removeLabel("missing", "bug")).resolves.toBeUndefined();
    });
  });

  describe("listLabels", () => {
    it("returns a cloned copy of the issue's labels", async () => {
      const client = new MockLinearClient();
      client.seedIssue(makeIssue({ id: "issue-1", labels: ["bug"] }));

      const labels = await client.listLabels("issue-1");
      labels.push("mutated");

      expect(await client.listLabels("issue-1")).toEqual(["bug"]);
    });

    it("returns an empty array for an issue that was never seeded", async () => {
      const client = new MockLinearClient();

      await expect(client.listLabels("missing")).resolves.toEqual([]);
    });
  });
});
