import { describe, it, expect } from "vitest";
import { MockLinearClient } from "../../src/linear/linearClient.js";
import type { LinearIssue } from "../../src/linear/linearClient.js";

function makeIssue(overrides: Partial<LinearIssue> = {}): LinearIssue {
  return {
    id: "issue-1",
    title: "Fix bug",
    description: "desc",
    branchName: "ai/issue-1",
    state: "Todo",
    labels: [],
    priority: 0,
    ...overrides,
  };
}

describe("MockLinearClient core operations", () => {
  it("getIssue() returns a cloned copy of a seeded issue", async () => {
    const client = new MockLinearClient();
    client.seedIssue(makeIssue());

    const issue = await client.getIssue("issue-1");
    issue.title = "Mutated";

    const again = await client.getIssue("issue-1");
    expect(again.title).toBe("Fix bug");
  });

  it("getIssue() throws synchronously for an unseeded issue id", () => {
    const client = new MockLinearClient();
    expect(() => client.getIssue("missing")).toThrow("Mock: Issue missing not found");
  });

  describe("searchIssues()", () => {
    it("matches issues by workflow state", async () => {
      const client = new MockLinearClient();
      client.seedIssue(makeIssue({ id: "t1", state: "Todo" }));
      client.seedIssue(makeIssue({ id: "d1", state: "Done" }));

      const results = await client.searchIssues({ state: "Todo" });

      expect(results.map((i) => i.id)).toEqual(["t1"]);
    });

    it("further filters by projectName when given", async () => {
      const client = new MockLinearClient();
      client.seedIssue(makeIssue({ id: "a", state: "Todo", project: "Project A" }));
      client.seedIssue(makeIssue({ id: "b", state: "Todo", project: "Project B" }));

      const results = await client.searchIssues({ state: "Todo", projectName: "Project A" });

      expect(results.map((i) => i.id)).toEqual(["a"]);
    });

    it("returns cloned issues (mutating a result does not affect the store)", async () => {
      const client = new MockLinearClient();
      client.seedIssue(makeIssue({ id: "a", state: "Todo" }));

      const [result] = await client.searchIssues({ state: "Todo" });
      result.title = "Mutated";

      const [again] = await client.searchIssues({ state: "Todo" });
      expect(again.title).toBe("Fix bug");
    });
  });

  it("postComment() records the comment and getPostedComments() lists it", async () => {
    const client = new MockLinearClient();
    await client.postComment("issue-1", "hello");
    await client.postComment("issue-1", "world");

    expect(client.getPostedComments()).toEqual([
      { issueId: "issue-1", body: "hello" },
      { issueId: "issue-1", body: "world" },
    ]);
  });

  it("updateIssueState() updates the state of a seeded issue", async () => {
    const client = new MockLinearClient();
    client.seedIssue(makeIssue({ state: "Todo" }));

    await client.updateIssueState("issue-1", "Done");

    const issue = await client.getIssue("issue-1");
    expect(issue.state).toBe("Done");
  });

  it("updateIssueState() on an unseeded issue is a safe no-op", async () => {
    const client = new MockLinearClient();
    await expect(client.updateIssueState("missing", "Done")).resolves.toBeUndefined();
  });

  describe("labels", () => {
    it("addLabel() appends a new label", async () => {
      const client = new MockLinearClient();
      client.seedIssue(makeIssue({ labels: [] }));

      await client.addLabel("issue-1", "ai:planning");

      expect(await client.listLabels("issue-1")).toEqual(["ai:planning"]);
    });

    it("addLabel() does not duplicate a label that is already present", async () => {
      const client = new MockLinearClient();
      client.seedIssue(makeIssue({ labels: ["ai:planning"] }));

      await client.addLabel("issue-1", "ai:planning");

      expect(await client.listLabels("issue-1")).toEqual(["ai:planning"]);
    });

    it("addLabel() on an unseeded issue is a safe no-op", async () => {
      const client = new MockLinearClient();
      await expect(client.addLabel("missing", "x")).resolves.toBeUndefined();
    });

    it("removeLabel() removes a matching label", async () => {
      const client = new MockLinearClient();
      client.seedIssue(makeIssue({ labels: ["ai:planning", "other"] }));

      await client.removeLabel("issue-1", "ai:planning");

      expect(await client.listLabels("issue-1")).toEqual(["other"]);
    });

    it("removeLabel() on an unseeded issue is a safe no-op", async () => {
      const client = new MockLinearClient();
      await expect(client.removeLabel("missing", "x")).resolves.toBeUndefined();
    });

    it("listLabels() returns an empty array for an unseeded issue", async () => {
      const client = new MockLinearClient();
      expect(await client.listLabels("missing")).toEqual([]);
    });
  });
});
