import { describe, it, expect, beforeEach } from "vitest";
import { MockLinearClient, type LinearIssue } from "../../src/linear/linearClient.js";

function makeIssue(overrides: Partial<LinearIssue> = {}): LinearIssue {
  return {
    id: "issue-1",
    identifier: "PRY-1",
    title: "Issue title",
    description: "desc",
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
      client.seedIssue(makeIssue());

      const result = await client.getIssue("issue-1");

      expect(result).toEqual(makeIssue());
    });

    it("throws when the issue was not seeded", () => {
      expect(() => client.getIssue("missing")).toThrow("Mock: Issue missing not found");
    });
  });

  describe("searchIssues", () => {
    it("filters by state and project name", async () => {
      client.seedIssue(makeIssue({ id: "a", state: "Todo", project: "Foo" }));
      client.seedIssue(makeIssue({ id: "b", state: "Todo", project: "Bar" }));
      client.seedIssue(makeIssue({ id: "c", state: "Done", project: "Foo" }));

      const result = await client.searchIssues({ state: "Todo", projectName: "Foo" });

      expect(result.map((i) => i.id)).toEqual(["a"]);
    });

    it("matches on state alone when no projectName filter is given", async () => {
      client.seedIssue(makeIssue({ id: "a", state: "Todo" }));
      client.seedIssue(makeIssue({ id: "b", state: "Done" }));

      const result = await client.searchIssues({ state: "Todo" });

      expect(result.map((i) => i.id)).toEqual(["a"]);
    });
  });

  describe("postComment", () => {
    it("records posted comments and exposes them via getPostedComments", async () => {
      await client.postComment("issue-1", "hello");
      await client.postComment("issue-2", "world");

      expect(client.getPostedComments()).toEqual([
        { issueId: "issue-1", body: "hello" },
        { issueId: "issue-2", body: "world" },
      ]);
    });
  });

  describe("updateIssueState", () => {
    it("updates the state of a seeded issue", async () => {
      client.seedIssue(makeIssue({ state: "Todo" }));

      await client.updateIssueState("issue-1", "In Progress");

      const result = await client.getIssue("issue-1");
      expect(result.state).toBe("In Progress");
    });

    it("is a no-op for an issue that was not seeded", async () => {
      await expect(client.updateIssueState("missing", "Done")).resolves.toBeUndefined();
    });
  });

  describe("addLabel", () => {
    it("adds a new label to a seeded issue", async () => {
      client.seedIssue(makeIssue({ labels: ["existing"] }));

      await client.addLabel("issue-1", "new-label");

      expect(await client.listLabels("issue-1")).toEqual(["existing", "new-label"]);
    });

    it("does not duplicate a label the issue already has", async () => {
      client.seedIssue(makeIssue({ labels: ["dup"] }));

      await client.addLabel("issue-1", "dup");

      expect(await client.listLabels("issue-1")).toEqual(["dup"]);
    });

    it("is a no-op for an issue that was not seeded", async () => {
      await expect(client.addLabel("missing", "label")).resolves.toBeUndefined();
    });
  });

  describe("removeLabel", () => {
    it("removes a label from a seeded issue", async () => {
      client.seedIssue(makeIssue({ labels: ["keep", "remove-me"] }));

      await client.removeLabel("issue-1", "remove-me");

      expect(await client.listLabels("issue-1")).toEqual(["keep"]);
    });

    it("is a no-op when removing a label the issue does not have", async () => {
      client.seedIssue(makeIssue({ labels: ["keep"] }));

      await client.removeLabel("issue-1", "absent");

      expect(await client.listLabels("issue-1")).toEqual(["keep"]);
    });

    it("is a no-op for an issue that was not seeded", async () => {
      await expect(client.removeLabel("missing", "label")).resolves.toBeUndefined();
    });
  });

  describe("listLabels", () => {
    it("returns a clone of the issue's labels", async () => {
      client.seedIssue(makeIssue({ labels: ["a", "b"] }));

      const labels = await client.listLabels("issue-1");
      labels.push("mutated");

      expect(await client.listLabels("issue-1")).toEqual(["a", "b"]);
    });

    it("returns an empty array for an issue that was not seeded", async () => {
      await expect(client.listLabels("missing")).resolves.toEqual([]);
    });
  });
});
