import { describe, it, expect, beforeEach } from "vitest";
import { MockLinearClient, type LinearIssue } from "../../src/linear/linearClient.js";

function makeIssue(overrides: Partial<LinearIssue> = {}): LinearIssue {
  return {
    id: "issue-1",
    identifier: "ENG-1",
    title: "Issue title",
    description: "Description",
    branchName: "ai/issue-1",
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
    it("returns a clone of the seeded issue", async () => {
      const issue = makeIssue();
      client.seedIssue(issue);
      const result = await client.getIssue("issue-1");
      expect(result).toEqual(issue);
      result.title = "Mutated";
      expect((await client.getIssue("issue-1")).title).toBe("Issue title");
    });

    it("throws for an unseeded issue id", () => {
      expect(() => client.getIssue("missing")).toThrow(/Mock: Issue missing not found/);
    });
  });

  describe("searchIssues", () => {
    it("filters by state", async () => {
      client.seedIssue(makeIssue({ id: "a", state: "Todo" }));
      client.seedIssue(makeIssue({ id: "b", state: "Done" }));
      const results = await client.searchIssues({ state: "Todo" });
      expect(results.map((i) => i.id)).toEqual(["a"]);
    });

    it("additionally filters by projectName when given", async () => {
      client.seedIssue(makeIssue({ id: "a", state: "Todo", project: "Alpha" }));
      client.seedIssue(makeIssue({ id: "b", state: "Todo", project: "Beta" }));
      const results = await client.searchIssues({ state: "Todo", projectName: "Alpha" });
      expect(results.map((i) => i.id)).toEqual(["a"]);
    });

    it("returns an empty array when nothing matches", async () => {
      client.seedIssue(makeIssue({ id: "a", state: "Done" }));
      await expect(client.searchIssues({ state: "Todo" })).resolves.toEqual([]);
    });
  });

  describe("postComment", () => {
    it("records posted comments retrievable via getPostedComments", async () => {
      await client.postComment("issue-1", "First");
      await client.postComment("issue-1", "Second");
      expect(client.getPostedComments()).toEqual([
        { issueId: "issue-1", body: "First" },
        { issueId: "issue-1", body: "Second" },
      ]);
    });
  });

  describe("updateIssueState", () => {
    it("updates the state of a seeded issue", async () => {
      client.seedIssue(makeIssue({ id: "a", state: "Todo" }));
      await client.updateIssueState("a", "Done");
      expect((await client.getIssue("a")).state).toBe("Done");
    });

    it("is a no-op when the issue does not exist", async () => {
      await expect(client.updateIssueState("missing", "Done")).resolves.toBeUndefined();
    });
  });

  describe("addLabel", () => {
    it("adds a new label to a seeded issue", async () => {
      client.seedIssue(makeIssue({ id: "a", labels: ["existing"] }));
      await client.addLabel("a", "new-label");
      expect((await client.getIssue("a")).labels).toEqual(["existing", "new-label"]);
    });

    it("does not duplicate an already-present label", async () => {
      client.seedIssue(makeIssue({ id: "a", labels: ["dup"] }));
      await client.addLabel("a", "dup");
      expect((await client.getIssue("a")).labels).toEqual(["dup"]);
    });

    it("is a no-op when the issue does not exist", async () => {
      await expect(client.addLabel("missing", "x")).resolves.toBeUndefined();
    });
  });

  describe("removeLabel", () => {
    it("removes a label from a seeded issue", async () => {
      client.seedIssue(makeIssue({ id: "a", labels: ["keep", "remove"] }));
      await client.removeLabel("a", "remove");
      expect((await client.getIssue("a")).labels).toEqual(["keep"]);
    });

    it("is a no-op when the label is not present", async () => {
      client.seedIssue(makeIssue({ id: "a", labels: ["keep"] }));
      await client.removeLabel("a", "absent");
      expect((await client.getIssue("a")).labels).toEqual(["keep"]);
    });

    it("is a no-op when the issue does not exist", async () => {
      await expect(client.removeLabel("missing", "x")).resolves.toBeUndefined();
    });
  });

  describe("listLabels", () => {
    it("returns a clone of the issue's labels", async () => {
      client.seedIssue(makeIssue({ id: "a", labels: ["x", "y"] }));
      const labels = await client.listLabels("a");
      expect(labels).toEqual(["x", "y"]);
      labels.push("z");
      expect(await client.listLabels("a")).toEqual(["x", "y"]);
    });

    it("returns an empty array for an unseeded issue", async () => {
      await expect(client.listLabels("missing")).resolves.toEqual([]);
    });
  });
});
