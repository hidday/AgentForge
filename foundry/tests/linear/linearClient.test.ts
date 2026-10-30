import { describe, it, expect, beforeEach } from "vitest";
import { MockLinearClient, type LinearIssue } from "../../src/linear/linearClient.js";

function makeIssue(overrides: Partial<LinearIssue> & { id: string }): LinearIssue {
  return {
    title: "Issue",
    description: "",
    branchName: "ai/issue",
    state: "Todo",
    labels: [],
    priority: 0,
    ...overrides,
  };
}

describe("MockLinearClient", () => {
  let client: MockLinearClient;

  beforeEach(() => {
    client = new MockLinearClient();
  });

  it("getIssue returns a deep copy of a seeded issue", async () => {
    const issue = makeIssue({ id: "i1", title: "Original" });
    client.seedIssue(issue);

    const got = await client.getIssue("i1");
    got.title = "Mutated";

    expect((await client.getIssue("i1")).title).toBe("Original");
  });

  it("getIssue throws for an unknown issue id", async () => {
    await expect(client.getIssue("missing")).rejects.toThrow(/not found/);
  });

  describe("searchIssues", () => {
    it("matches on state and filters out other states", async () => {
      client.seedIssue(makeIssue({ id: "i1", state: "Todo" }));
      client.seedIssue(makeIssue({ id: "i2", state: "Done" }));

      const results = await client.searchIssues({ state: "Todo" });

      expect(results.map((r) => r.id)).toEqual(["i1"]);
    });

    it("further filters by projectName when given", async () => {
      client.seedIssue(makeIssue({ id: "i1", state: "Todo", project: "Alpha" }));
      client.seedIssue(makeIssue({ id: "i2", state: "Todo", project: "Beta" }));

      const results = await client.searchIssues({ state: "Todo", projectName: "Alpha" });

      expect(results.map((r) => r.id)).toEqual(["i1"]);
    });
  });

  it("postComment records the comment and getPostedComments returns a copy", async () => {
    await client.postComment("i1", "hello");
    await client.postComment("i1", "world");

    const comments = client.getPostedComments();
    expect(comments).toEqual([
      { issueId: "i1", body: "hello" },
      { issueId: "i1", body: "world" },
    ]);

    comments.push({ issueId: "i2", body: "injected" });
    expect(client.getPostedComments()).toHaveLength(2);
  });

  describe("updateIssueState", () => {
    it("updates the state of a seeded issue", async () => {
      client.seedIssue(makeIssue({ id: "i1", state: "Todo" }));
      await client.updateIssueState("i1", "Done");
      expect((await client.getIssue("i1")).state).toBe("Done");
    });

    it("is a no-op for an unknown issue id", async () => {
      await expect(client.updateIssueState("missing", "Done")).resolves.toBeUndefined();
    });
  });

  describe("addLabel", () => {
    it("adds a new label to a seeded issue", async () => {
      client.seedIssue(makeIssue({ id: "i1", labels: ["a"] }));
      await client.addLabel("i1", "b");
      expect((await client.getIssue("i1")).labels).toEqual(["a", "b"]);
    });

    it("does not duplicate an already-present label", async () => {
      client.seedIssue(makeIssue({ id: "i1", labels: ["a"] }));
      await client.addLabel("i1", "a");
      expect((await client.getIssue("i1")).labels).toEqual(["a"]);
    });

    it("is a no-op for an unknown issue id", async () => {
      await expect(client.addLabel("missing", "a")).resolves.toBeUndefined();
    });
  });

  describe("removeLabel", () => {
    it("removes a label from a seeded issue", async () => {
      client.seedIssue(makeIssue({ id: "i1", labels: ["a", "b"] }));
      await client.removeLabel("i1", "a");
      expect((await client.getIssue("i1")).labels).toEqual(["b"]);
    });

    it("is a no-op for an unknown issue id", async () => {
      await expect(client.removeLabel("missing", "a")).resolves.toBeUndefined();
    });
  });

  describe("listLabels", () => {
    it("returns a copy of the seeded issue's labels", async () => {
      client.seedIssue(makeIssue({ id: "i1", labels: ["a", "b"] }));
      const labels = await client.listLabels("i1");
      expect(labels).toEqual(["a", "b"]);
    });

    it("returns an empty array for an unknown issue id", async () => {
      await expect(client.listLabels("missing")).resolves.toEqual([]);
    });
  });
});
