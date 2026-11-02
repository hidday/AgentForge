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
    ...overrides,
  };
}

describe("MockLinearClient", () => {
  it("getIssue returns a clone of the seeded issue", async () => {
    const client = new MockLinearClient();
    client.seedIssue(makeIssue());

    const issue = await client.getIssue("issue-1");
    issue.title = "mutated";

    const again = await client.getIssue("issue-1");
    expect(again.title).toBe("Focus issue");
  });

  it("getIssue throws when the issue was never seeded", () => {
    const client = new MockLinearClient();
    expect(() => client.getIssue("missing")).toThrow("Mock: Issue missing not found");
  });

  describe("searchIssues", () => {
    it("filters by workflow state", async () => {
      const client = new MockLinearClient();
      client.seedIssue(makeIssue({ id: "a", state: "Todo" }));
      client.seedIssue(makeIssue({ id: "b", state: "Done" }));

      const results = await client.searchIssues({ state: "Todo" });
      expect(results.map((i) => i.id)).toEqual(["a"]);
    });

    it("further filters by project name when given", async () => {
      const client = new MockLinearClient();
      client.seedIssue(makeIssue({ id: "a", state: "Todo", project: "Backend" }));
      client.seedIssue(makeIssue({ id: "b", state: "Todo", project: "Frontend" }));

      const results = await client.searchIssues({ state: "Todo", projectName: "Backend" });
      expect(results.map((i) => i.id)).toEqual(["a"]);
    });

    it("returns an empty array when nothing matches", async () => {
      const client = new MockLinearClient();
      client.seedIssue(makeIssue({ state: "Todo" }));
      const results = await client.searchIssues({ state: "Done" });
      expect(results).toEqual([]);
    });
  });

  it("postComment records the comment and getPostedComments returns a snapshot", async () => {
    const client = new MockLinearClient();
    await client.postComment("issue-1", "hello");
    await client.postComment("issue-1", "world");

    expect(client.getPostedComments()).toEqual([
      { issueId: "issue-1", body: "hello" },
      { issueId: "issue-1", body: "world" },
    ]);
  });

  describe("updateIssueState", () => {
    it("updates the state of an existing issue", async () => {
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
    it("adds a new label", async () => {
      const client = new MockLinearClient();
      client.seedIssue(makeIssue({ labels: ["bug"] }));
      await client.addLabel("issue-1", "urgent");
      expect(await client.listLabels("issue-1")).toEqual(["bug", "urgent"]);
    });

    it("does not duplicate an already-present label", async () => {
      const client = new MockLinearClient();
      client.seedIssue(makeIssue({ labels: ["bug"] }));
      await client.addLabel("issue-1", "bug");
      expect(await client.listLabels("issue-1")).toEqual(["bug"]);
    });

    it("is a no-op when the issue does not exist", async () => {
      const client = new MockLinearClient();
      await expect(client.addLabel("missing", "bug")).resolves.toBeUndefined();
    });
  });

  describe("removeLabel", () => {
    it("removes an existing label", async () => {
      const client = new MockLinearClient();
      client.seedIssue(makeIssue({ labels: ["bug", "urgent"] }));
      await client.removeLabel("issue-1", "urgent");
      expect(await client.listLabels("issue-1")).toEqual(["bug"]);
    });

    it("is a no-op when the label is not present", async () => {
      const client = new MockLinearClient();
      client.seedIssue(makeIssue({ labels: ["bug"] }));
      await client.removeLabel("issue-1", "missing-label");
      expect(await client.listLabels("issue-1")).toEqual(["bug"]);
    });

    it("is a no-op when the issue does not exist", async () => {
      const client = new MockLinearClient();
      await expect(client.removeLabel("missing", "bug")).resolves.toBeUndefined();
    });
  });

  describe("listLabels", () => {
    it("returns an empty array for an unseeded issue", async () => {
      const client = new MockLinearClient();
      expect(await client.listLabels("missing")).toEqual([]);
    });

    it("returns a cloned labels array", async () => {
      const client = new MockLinearClient();
      client.seedIssue(makeIssue({ labels: ["bug"] }));
      const labels = await client.listLabels("issue-1");
      labels.push("mutated");
      expect(await client.listLabels("issue-1")).toEqual(["bug"]);
    });
  });
});
