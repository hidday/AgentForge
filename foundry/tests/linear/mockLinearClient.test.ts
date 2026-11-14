import { describe, it, expect } from "vitest";
import {
  MockLinearClient,
  type LinearIssue,
  type RelatedLinearIssue,
} from "../../src/linear/linearClient.js";

function makeIssue(overrides: Partial<LinearIssue> = {}): LinearIssue {
  return {
    id: "issue-1",
    identifier: "ENG-1",
    title: "Focus issue",
    description: "",
    branchName: "ai/issue-1",
    state: "Todo",
    labels: [],
    priority: 0,
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

describe("MockLinearClient CRUD operations", () => {
  it("getIssue returns a cloned copy of the seeded issue", async () => {
    const client = new MockLinearClient();
    client.seedIssue(makeIssue());

    const issue = await client.getIssue("issue-1");
    issue.title = "mutated";

    expect((await client.getIssue("issue-1")).title).toBe("Focus issue");
  });

  it("getIssue throws synchronously when the issue was not seeded", () => {
    const client = new MockLinearClient();
    expect(() => client.getIssue("missing")).toThrow(/Issue missing not found/);
  });

  it("searchIssues filters by state and optional project name", async () => {
    const client = new MockLinearClient();
    client.seedIssue(makeIssue({ id: "a", state: "Todo", project: "Alpha" }));
    client.seedIssue(makeIssue({ id: "b", state: "Todo", project: "Beta" }));
    client.seedIssue(makeIssue({ id: "c", state: "Done", project: "Alpha" }));

    const allTodo = await client.searchIssues({ state: "Todo" });
    expect(allTodo.map((i) => i.id).sort()).toEqual(["a", "b"]);

    const alphaTodo = await client.searchIssues({ state: "Todo", projectName: "Alpha" });
    expect(alphaTodo.map((i) => i.id)).toEqual(["a"]);
  });

  it("postComment records the comment and getPostedComments returns a snapshot", async () => {
    const client = new MockLinearClient();
    await client.postComment("issue-1", "/approve");

    expect(client.getPostedComments()).toEqual([{ issueId: "issue-1", body: "/approve" }]);
  });

  it("updateIssueState updates an existing issue and is a no-op for a missing one", async () => {
    const client = new MockLinearClient();
    client.seedIssue(makeIssue());

    await client.updateIssueState("issue-1", "Planning");
    expect((await client.getIssue("issue-1")).state).toBe("Planning");

    await expect(client.updateIssueState("missing", "Planning")).resolves.toBeUndefined();
  });

  it("addLabel adds a new label without duplicating an existing one", async () => {
    const client = new MockLinearClient();
    client.seedIssue(makeIssue({ labels: ["bug"] }));

    await client.addLabel("issue-1", "bug");
    await client.addLabel("issue-1", "urgent");

    expect(await client.listLabels("issue-1")).toEqual(["bug", "urgent"]);
  });

  it("addLabel is a no-op for a missing issue", async () => {
    const client = new MockLinearClient();
    await expect(client.addLabel("missing", "bug")).resolves.toBeUndefined();
  });

  it("removeLabel removes a label and is a no-op for a missing issue", async () => {
    const client = new MockLinearClient();
    client.seedIssue(makeIssue({ labels: ["bug", "urgent"] }));

    await client.removeLabel("issue-1", "bug");
    expect(await client.listLabels("issue-1")).toEqual(["urgent"]);

    await expect(client.removeLabel("missing", "bug")).resolves.toBeUndefined();
  });

  it("listLabels returns an empty array for a missing issue", async () => {
    const client = new MockLinearClient();
    expect(await client.listLabels("missing")).toEqual([]);
  });
});
