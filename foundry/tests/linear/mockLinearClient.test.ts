import { describe, it, expect } from "vitest";
import { MockLinearClient, type LinearIssue, type RelatedLinearIssue } from "../../src/linear/linearClient.js";

function makeIssue(overrides: Partial<LinearIssue> = {}): LinearIssue {
  return {
    id: "issue-1",
    identifier: "PRY-1",
    title: "Focus issue",
    description: "Some description",
    branchName: "ai/issue-1",
    state: "Todo",
    labels: [],
    priority: 1,
    url: "https://linear.app/team/issue/PRY-1",
    project: "Alpha",
    team: "PRY",
    cycle: "Cycle 1",
    ...overrides,
  };
}

function makeRelated(overrides: Partial<RelatedLinearIssue> = {}): RelatedLinearIssue {
  return {
    id: "rel-1",
    identifier: "PRY-200",
    title: "Related issue",
    description: "Description",
    state: "Todo",
    labels: ["foo"],
    priority: 3,
    url: "https://linear.app/team/issue/PRY-200",
    ...overrides,
  };
}

describe("MockLinearClient.getRelatedContext", () => {
  it("returns an empty blockers array when no relations have been seeded", async () => {
    const client = new MockLinearClient();
    client.seedIssue({
      id: "issue-1",
      title: "Focus",
      description: "",
      branchName: "ai/issue-1",
      state: "Todo",
      labels: [],
      priority: 0,
    });

    const ctx = await client.getRelatedContext("issue-1");

    expect(ctx).toEqual({ blockers: [] });
  });

  it("returns seeded parent and blockers via getRelatedContext", async () => {
    const client = new MockLinearClient();
    const parent = makeRelated({ id: "p1", identifier: "PRY-100", title: "Parent" });
    const blocker1 = makeRelated({ id: "b1", identifier: "PRY-101", title: "Blocker 1" });
    const blocker2 = makeRelated({ id: "b2", identifier: "PRY-102", title: "Blocker 2" });

    client.seedRelations("issue-1", { parent, blockers: [blocker1, blocker2] });

    const ctx = await client.getRelatedContext("issue-1");

    expect(ctx.parent).toEqual(parent);
    expect(ctx.blockers).toEqual([blocker1, blocker2]);
  });

  it("returns deep-cloned data so mutating the result does not affect future calls", async () => {
    const client = new MockLinearClient();
    const parent = makeRelated({ id: "p1", identifier: "PRY-100", title: "Original" });
    client.seedRelations("issue-1", { parent, blockers: [] });

    const first = await client.getRelatedContext("issue-1");
    if (first.parent) first.parent.title = "Mutated";

    const second = await client.getRelatedContext("issue-1");
    expect(second.parent?.title).toBe("Original");
  });

  it("supports overwriting previously seeded relations", async () => {
    const client = new MockLinearClient();
    client.seedRelations("issue-1", { blockers: [makeRelated({ id: "old" })] });
    client.seedRelations("issue-1", { blockers: [makeRelated({ id: "new" })] });

    const ctx = await client.getRelatedContext("issue-1");

    expect(ctx.blockers).toHaveLength(1);
    expect(ctx.blockers[0].id).toBe("new");
  });
});

describe("MockLinearClient.getIssue", () => {
  it("returns a deep-cloned copy of the seeded issue", async () => {
    const client = new MockLinearClient();
    const seeded = makeIssue();
    client.seedIssue(seeded);

    const issue = await client.getIssue("issue-1");
    expect(issue).toEqual(seeded);

    issue.title = "Mutated";
    const second = await client.getIssue("issue-1");
    expect(second.title).toBe("Focus issue");
  });

  it("throws when the issue was never seeded", () => {
    const client = new MockLinearClient();
    expect(() => client.getIssue("missing")).toThrow("Mock: Issue missing not found");
  });
});

describe("MockLinearClient.searchIssues", () => {
  it("matches only issues with the given state", async () => {
    const client = new MockLinearClient();
    client.seedIssue(makeIssue({ id: "a", state: "Todo" }));
    client.seedIssue(makeIssue({ id: "b", state: "Done" }));

    const results = await client.searchIssues({ state: "Todo" });
    expect(results.map((i) => i.id)).toEqual(["a"]);
  });

  it("further narrows by projectName when provided", async () => {
    const client = new MockLinearClient();
    client.seedIssue(makeIssue({ id: "a", state: "Todo", project: "Alpha" }));
    client.seedIssue(makeIssue({ id: "b", state: "Todo", project: "Beta" }));

    const results = await client.searchIssues({ state: "Todo", projectName: "Beta" });
    expect(results.map((i) => i.id)).toEqual(["b"]);
  });

  it("returns an empty array when nothing matches", async () => {
    const client = new MockLinearClient();
    client.seedIssue(makeIssue({ id: "a", state: "Done" }));

    const results = await client.searchIssues({ state: "Todo" });
    expect(results).toEqual([]);
  });
});

describe("MockLinearClient.postComment / getPostedComments", () => {
  it("records posted comments and returns a copy of the log", async () => {
    const client = new MockLinearClient();
    await client.postComment("issue-1", "hello");
    await client.postComment("issue-2", "world");

    const posted = client.getPostedComments();
    expect(posted).toEqual([
      { issueId: "issue-1", body: "hello" },
      { issueId: "issue-2", body: "world" },
    ]);

    posted.push({ issueId: "issue-3", body: "should not persist" });
    expect(client.getPostedComments()).toHaveLength(2);
  });
});

describe("MockLinearClient.updateIssueState", () => {
  it("updates the state of a seeded issue", async () => {
    const client = new MockLinearClient();
    client.seedIssue(makeIssue({ id: "issue-1", state: "Todo" }));

    await client.updateIssueState("issue-1", "In Progress");

    const issue = await client.getIssue("issue-1");
    expect(issue.state).toBe("In Progress");
  });

  it("is a no-op when the issue does not exist", async () => {
    const client = new MockLinearClient();
    await expect(client.updateIssueState("missing", "Done")).resolves.toBeUndefined();
  });
});

describe("MockLinearClient.addLabel / removeLabel / listLabels", () => {
  it("adds a label to a seeded issue without duplicating it", async () => {
    const client = new MockLinearClient();
    client.seedIssue(makeIssue({ id: "issue-1", labels: ["existing"] }));

    await client.addLabel("issue-1", "new-label");
    await client.addLabel("issue-1", "new-label"); // duplicate add should be a no-op

    expect(await client.listLabels("issue-1")).toEqual(["existing", "new-label"]);
  });

  it("is a no-op adding a label when the issue does not exist", async () => {
    const client = new MockLinearClient();
    await expect(client.addLabel("missing", "x")).resolves.toBeUndefined();
  });

  it("removes a label from a seeded issue", async () => {
    const client = new MockLinearClient();
    client.seedIssue(makeIssue({ id: "issue-1", labels: ["a", "b"] }));

    await client.removeLabel("issue-1", "a");

    expect(await client.listLabels("issue-1")).toEqual(["b"]);
  });

  it("is a no-op removing a label when the issue does not exist", async () => {
    const client = new MockLinearClient();
    await expect(client.removeLabel("missing", "x")).resolves.toBeUndefined();
  });

  it("listLabels returns an empty array for an unseeded issue", async () => {
    const client = new MockLinearClient();
    expect(await client.listLabels("missing")).toEqual([]);
  });

  it("listLabels returns a copy that does not affect internal state when mutated", async () => {
    const client = new MockLinearClient();
    client.seedIssue(makeIssue({ id: "issue-1", labels: ["a"] }));

    const labels = await client.listLabels("issue-1");
    labels.push("mutated");

    expect(await client.listLabels("issue-1")).toEqual(["a"]);
  });
});
