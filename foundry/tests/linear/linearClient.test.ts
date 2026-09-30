import { describe, it, expect } from "vitest";
import { MockLinearClient, type LinearIssue } from "../../src/linear/linearClient.js";

function makeIssue(overrides: Partial<LinearIssue> = {}): LinearIssue {
  return {
    id: "issue-1",
    identifier: "PRY-1",
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
  describe("getIssue", () => {
    it("returns a shallow clone of a seeded issue", async () => {
      const client = new MockLinearClient();
      const issue = makeIssue({ labels: ["bug"] });
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
    it("matches issues by state only", async () => {
      const client = new MockLinearClient();
      client.seedIssue(makeIssue({ id: "a", state: "Todo" }));
      client.seedIssue(makeIssue({ id: "b", state: "Done" }));

      const results = await client.searchIssues({ state: "Todo" });

      expect(results.map((i) => i.id)).toEqual(["a"]);
    });

    it("filters by projectName when provided", async () => {
      const client = new MockLinearClient();
      client.seedIssue(makeIssue({ id: "a", state: "Todo", project: "Alpha" }));
      client.seedIssue(makeIssue({ id: "b", state: "Todo", project: "Beta" }));

      const results = await client.searchIssues({ state: "Todo", projectName: "Alpha" });

      expect(results.map((i) => i.id)).toEqual(["a"]);
    });

    it("excludes issues missing the requested projectName", async () => {
      const client = new MockLinearClient();
      client.seedIssue(makeIssue({ id: "a", state: "Todo" }));

      const results = await client.searchIssues({ state: "Todo", projectName: "Alpha" });

      expect(results).toEqual([]);
    });

    it("returns an empty array when nothing matches", async () => {
      const client = new MockLinearClient();
      client.seedIssue(makeIssue({ id: "a", state: "Done" }));

      const results = await client.searchIssues({ state: "Todo" });

      expect(results).toEqual([]);
    });

    it("returns clones so mutating results does not affect stored issues", async () => {
      const client = new MockLinearClient();
      client.seedIssue(makeIssue({ id: "a", state: "Todo" }));

      const [result] = await client.searchIssues({ state: "Todo" });
      result.title = "mutated";

      const [again] = await client.searchIssues({ state: "Todo" });
      expect(again.title).toBe("Issue title");
    });
  });

  describe("postComment", () => {
    it("records posted comments and returns them via getPostedComments", async () => {
      const client = new MockLinearClient();

      await client.postComment("issue-1", "First comment");
      await client.postComment("issue-2", "Second comment");

      expect(client.getPostedComments()).toEqual([
        { issueId: "issue-1", body: "First comment" },
        { issueId: "issue-2", body: "Second comment" },
      ]);
    });

    it("returns a copy so external mutation does not affect internal state", async () => {
      const client = new MockLinearClient();
      await client.postComment("issue-1", "Comment");

      const comments = client.getPostedComments();
      comments.push({ issueId: "issue-2", body: "Injected" });

      expect(client.getPostedComments()).toHaveLength(1);
    });
  });

  describe("updateIssueState", () => {
    it("updates the state of an existing issue", async () => {
      const client = new MockLinearClient();
      client.seedIssue(makeIssue({ id: "issue-1", state: "Todo" }));

      await client.updateIssueState("issue-1", "Done");

      expect((await client.getIssue("issue-1")).state).toBe("Done");
    });

    it("is a no-op when the issue does not exist", async () => {
      const client = new MockLinearClient();
      await expect(client.updateIssueState("missing", "Done")).resolves.toBeUndefined();
    });
  });

  describe("addLabel", () => {
    it("adds a new label to an existing issue", async () => {
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

    it("is a no-op when the issue does not exist", async () => {
      const client = new MockLinearClient();
      await expect(client.addLabel("missing", "label")).resolves.toBeUndefined();
    });
  });

  describe("removeLabel", () => {
    it("removes an existing label", async () => {
      const client = new MockLinearClient();
      client.seedIssue(makeIssue({ id: "issue-1", labels: ["a", "b"] }));

      await client.removeLabel("issue-1", "a");

      expect(await client.listLabels("issue-1")).toEqual(["b"]);
    });

    it("is a no-op when the label is not present", async () => {
      const client = new MockLinearClient();
      client.seedIssue(makeIssue({ id: "issue-1", labels: ["a"] }));

      await client.removeLabel("issue-1", "does-not-exist");

      expect(await client.listLabels("issue-1")).toEqual(["a"]);
    });

    it("is a no-op when the issue does not exist", async () => {
      const client = new MockLinearClient();
      await expect(client.removeLabel("missing", "a")).resolves.toBeUndefined();
    });
  });

  describe("listLabels", () => {
    it("returns a copy of the issue's labels", async () => {
      const client = new MockLinearClient();
      client.seedIssue(makeIssue({ id: "issue-1", labels: ["a", "b"] }));

      const labels = await client.listLabels("issue-1");
      labels.push("mutated");

      expect(await client.listLabels("issue-1")).toEqual(["a", "b"]);
    });

    it("returns an empty array when the issue does not exist", async () => {
      const client = new MockLinearClient();
      expect(await client.listLabels("missing")).toEqual([]);
    });
  });
});
