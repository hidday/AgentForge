import { describe, it, expect, beforeEach } from "vitest";
import { MockLinearClient, type LinearIssue } from "../../src/linear/linearClient.js";

function makeIssue(overrides: Partial<LinearIssue> & { id: string }): LinearIssue {
  return {
    title: "Issue title",
    description: "Description",
    branchName: `ai/${overrides.id}`,
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

  describe("getIssue", () => {
    it("returns a clone of a seeded issue", async () => {
      client.seedIssue(makeIssue({ id: "issue-1", title: "Original" }));

      const issue = await client.getIssue("issue-1");
      issue.title = "Mutated";

      expect((await client.getIssue("issue-1")).title).toBe("Original");
    });

    it("throws synchronously when the issue was never seeded", () => {
      expect(() => client.getIssue("missing")).toThrow(/not found/);
    });
  });

  describe("searchIssues", () => {
    it("matches only issues in the requested state", async () => {
      client.seedIssue(makeIssue({ id: "a", state: "Todo" }));
      client.seedIssue(makeIssue({ id: "b", state: "Done" }));

      const results = await client.searchIssues({ state: "Todo" });

      expect(results.map((r) => r.id)).toEqual(["a"]);
    });

    it("further filters by projectName when provided", async () => {
      client.seedIssue(makeIssue({ id: "a", state: "Todo", project: "alpha" }));
      client.seedIssue(makeIssue({ id: "b", state: "Todo", project: "beta" }));

      const results = await client.searchIssues({ state: "Todo", projectName: "alpha" });

      expect(results.map((r) => r.id)).toEqual(["a"]);
    });

    it("excludes an issue with no project when projectName is required", async () => {
      client.seedIssue(makeIssue({ id: "a", state: "Todo" }));

      const results = await client.searchIssues({ state: "Todo", projectName: "alpha" });

      expect(results).toEqual([]);
    });

    it("returns independent copies, not references to internal state", async () => {
      client.seedIssue(makeIssue({ id: "a", state: "Todo" }));

      const [result] = await client.searchIssues({ state: "Todo" });
      result.title = "Mutated";

      const [second] = await client.searchIssues({ state: "Todo" });
      expect(second.title).toBe("Issue title");
    });
  });

  describe("postComment", () => {
    it("records posted comments in order", async () => {
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
      client.seedIssue(makeIssue({ id: "issue-1", state: "Todo" }));

      await client.updateIssueState("issue-1", "In Progress");

      expect((await client.getIssue("issue-1")).state).toBe("In Progress");
    });

    it("is a no-op for an issue that was never seeded", async () => {
      await expect(client.updateIssueState("missing", "Done")).resolves.toBeUndefined();
    });
  });

  describe("addLabel", () => {
    it("adds a label that is not already present", async () => {
      client.seedIssue(makeIssue({ id: "issue-1", labels: ["existing"] }));

      await client.addLabel("issue-1", "new-label");

      expect((await client.getIssue("issue-1")).labels).toEqual(["existing", "new-label"]);
    });

    it("does not duplicate a label that is already present", async () => {
      client.seedIssue(makeIssue({ id: "issue-1", labels: ["dup"] }));

      await client.addLabel("issue-1", "dup");

      expect((await client.getIssue("issue-1")).labels).toEqual(["dup"]);
    });

    it("is a no-op for an issue that was never seeded", async () => {
      await expect(client.addLabel("missing", "label")).resolves.toBeUndefined();
    });
  });

  describe("removeLabel", () => {
    it("removes a label from a seeded issue", async () => {
      client.seedIssue(makeIssue({ id: "issue-1", labels: ["a", "b"] }));

      await client.removeLabel("issue-1", "a");

      expect((await client.getIssue("issue-1")).labels).toEqual(["b"]);
    });

    it("is a no-op for an issue that was never seeded", async () => {
      await expect(client.removeLabel("missing", "a")).resolves.toBeUndefined();
    });

    it("is a no-op when the label isn't present on the issue", async () => {
      client.seedIssue(makeIssue({ id: "issue-1", labels: ["b"] }));

      await client.removeLabel("issue-1", "a");

      expect((await client.getIssue("issue-1")).labels).toEqual(["b"]);
    });
  });

  describe("listLabels", () => {
    it("returns a copy of the issue's labels", async () => {
      client.seedIssue(makeIssue({ id: "issue-1", labels: ["x", "y"] }));

      const labels = await client.listLabels("issue-1");
      labels.push("z");

      expect(await client.listLabels("issue-1")).toEqual(["x", "y"]);
    });

    it("returns an empty array for an issue that was never seeded", async () => {
      await expect(client.listLabels("missing")).resolves.toEqual([]);
    });
  });
});
