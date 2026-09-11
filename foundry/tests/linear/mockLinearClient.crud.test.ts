import { describe, it, expect } from "vitest";
import { MockLinearClient, type LinearIssue } from "../../src/linear/linearClient.js";

function makeIssue(overrides: Partial<LinearIssue> = {}): LinearIssue {
  return {
    id: "issue-1",
    title: "Sample issue",
    description: "",
    branchName: "ai/issue-1",
    state: "Todo",
    labels: [],
    priority: 0,
    ...overrides,
  };
}

describe("MockLinearClient CRUD operations", () => {
  it("getIssue throws synchronously for an unseeded issue id", () => {
    const client = new MockLinearClient();
    expect(() => client.getIssue("missing")).toThrow("Mock: Issue missing not found");
  });

  it("getIssue returns a shallow copy: scalar field edits don't persist, but nested arrays are shared", async () => {
    const client = new MockLinearClient();
    const seeded = makeIssue({ labels: ["bug"] });
    client.seedIssue(seeded);

    const result = await client.getIssue("issue-1");
    result.title = "mutated title";
    result.labels.push("mutated-label");

    const second = await client.getIssue("issue-1");
    expect(second.title).toBe("Sample issue");
    // The labels array itself is not deep-cloned by getIssue, so array
    // mutations on a previously returned issue leak into later reads.
    expect(second.labels).toEqual(["bug", "mutated-label"]);
  });

  describe("addLabel", () => {
    it("adds a label to an existing issue that does not already have it", async () => {
      const client = new MockLinearClient();
      client.seedIssue(makeIssue({ labels: [] }));

      await client.addLabel("issue-1", "bug");

      expect(await client.listLabels("issue-1")).toEqual(["bug"]);
    });

    it("does not duplicate a label already present", async () => {
      const client = new MockLinearClient();
      client.seedIssue(makeIssue({ labels: ["bug"] }));

      await client.addLabel("issue-1", "bug");

      expect(await client.listLabels("issue-1")).toEqual(["bug"]);
    });

    it("is a no-op for an issue that was never seeded", async () => {
      const client = new MockLinearClient();
      await expect(client.addLabel("missing", "bug")).resolves.toBeUndefined();
    });
  });

  describe("removeLabel", () => {
    it("removes an existing label from an issue", async () => {
      const client = new MockLinearClient();
      client.seedIssue(makeIssue({ labels: ["bug", "urgent"] }));

      await client.removeLabel("issue-1", "bug");

      expect(await client.listLabels("issue-1")).toEqual(["urgent"]);
    });

    it("is a no-op when the label is not present on the issue", async () => {
      const client = new MockLinearClient();
      client.seedIssue(makeIssue({ labels: ["urgent"] }));

      await client.removeLabel("issue-1", "bug");

      expect(await client.listLabels("issue-1")).toEqual(["urgent"]);
    });

    it("is a no-op for an issue that was never seeded", async () => {
      const client = new MockLinearClient();
      await expect(client.removeLabel("missing", "bug")).resolves.toBeUndefined();
    });
  });

  describe("listLabels", () => {
    it("returns an empty array for an issue that was never seeded", async () => {
      const client = new MockLinearClient();
      expect(await client.listLabels("missing")).toEqual([]);
    });

    it("returns a defensive copy of the issue's labels", async () => {
      const client = new MockLinearClient();
      client.seedIssue(makeIssue({ labels: ["bug"] }));

      const labels = await client.listLabels("issue-1");
      labels.push("mutated");

      expect(await client.listLabels("issue-1")).toEqual(["bug"]);
    });
  });

  describe("updateIssueState", () => {
    it("updates the state of an existing issue", async () => {
      const client = new MockLinearClient();
      client.seedIssue(makeIssue({ state: "Todo" }));

      await client.updateIssueState("issue-1", "Done");

      const issue = await client.getIssue("issue-1");
      expect(issue.state).toBe("Done");
    });

    it("is a no-op for an issue that was never seeded", async () => {
      const client = new MockLinearClient();
      await expect(client.updateIssueState("missing", "Done")).resolves.toBeUndefined();
    });
  });

  describe("postComment", () => {
    it("records posted comments and returns them via getPostedComments", async () => {
      const client = new MockLinearClient();

      await client.postComment("issue-1", "first");
      await client.postComment("issue-1", "second");

      expect(client.getPostedComments()).toEqual([
        { issueId: "issue-1", body: "first" },
        { issueId: "issue-1", body: "second" },
      ]);
    });

    it("returns a defensive copy from getPostedComments", async () => {
      const client = new MockLinearClient();
      await client.postComment("issue-1", "first");

      const comments = client.getPostedComments();
      comments.push({ issueId: "issue-2", body: "injected" });

      expect(client.getPostedComments()).toEqual([{ issueId: "issue-1", body: "first" }]);
    });
  });

  describe("searchIssues", () => {
    it("filters by state and matches every seeded issue with that state", async () => {
      const client = new MockLinearClient();
      client.seedIssue(makeIssue({ id: "a", state: "Todo" }));
      client.seedIssue(makeIssue({ id: "b", state: "Done" }));

      const result = await client.searchIssues({ state: "Todo" });

      expect(result.map((i) => i.id)).toEqual(["a"]);
    });

    it("filters by projectName in addition to state", async () => {
      const client = new MockLinearClient();
      client.seedIssue(makeIssue({ id: "a", state: "Todo", project: "Alpha" }));
      client.seedIssue(makeIssue({ id: "b", state: "Todo", project: "Beta" }));

      const result = await client.searchIssues({ state: "Todo", projectName: "Alpha" });

      expect(result.map((i) => i.id)).toEqual(["a"]);
    });

    it("returns an empty array when nothing matches", async () => {
      const client = new MockLinearClient();
      client.seedIssue(makeIssue({ id: "a", state: "Todo" }));

      const result = await client.searchIssues({ state: "Done" });

      expect(result).toEqual([]);
    });
  });
});
