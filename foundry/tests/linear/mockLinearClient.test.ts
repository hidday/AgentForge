import { describe, it, expect } from "vitest";
import { MockLinearClient, type RelatedLinearIssue } from "../../src/linear/linearClient.js";

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
