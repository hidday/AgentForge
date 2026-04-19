import { describe, it, expect, vi, beforeEach } from "vitest";
import { RealLinearClient } from "../../src/linear/realLinearClient.js";

interface FakeIssue {
  id: string;
  identifier: string;
  title: string;
  description: string | null;
  branchName: string;
  priority: number;
  url: string;
  labelIds: string[];
  parent: Promise<FakeIssue | null>;
  state: Promise<{ id: string; name: string }>;
  project: Promise<null>;
  cycle: Promise<null>;
  team: Promise<{ id: string; key: string }>;
  labels: () => Promise<{ nodes: Array<{ id: string; name: string }> }>;
  inverseRelations: () => Promise<{
    nodes: Array<{ id: string; type: string; issue: Promise<FakeIssue> }>;
  }>;
}

function makeFakeIssue(overrides: Partial<FakeIssue> & { id: string }): FakeIssue {
  return {
    identifier: "PRY-1",
    title: "Issue title",
    description: "Issue description",
    branchName: "ai/issue-1",
    priority: 0,
    url: "https://linear.app/team/issue/PRY-1",
    labelIds: [],
    parent: Promise.resolve(null),
    state: Promise.resolve({ id: "state-1", name: "Todo" }),
    project: Promise.resolve(null),
    cycle: Promise.resolve(null),
    team: Promise.resolve({ id: "team-1", key: "PRY" }),
    labels: () => Promise.resolve({ nodes: [] }),
    inverseRelations: () => Promise.resolve({ nodes: [] }),
    ...overrides,
  };
}

function makeLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };
}

describe("RealLinearClient.getRelatedContext", () => {
  let client: RealLinearClient;
  let issuesById: Map<string, FakeIssue>;

  beforeEach(() => {
    issuesById = new Map();
    client = new RealLinearClient("test-key", makeLogger() as never);
    // Inject a fake SDK that resolves issues from the local map.
    (client as unknown as { sdk: { issue: (id: string) => Promise<FakeIssue> } }).sdk = {
      issue: (id: string) => {
        const found = issuesById.get(id);
        if (!found) throw new Error(`Fake SDK: issue ${id} not seeded`);
        return Promise.resolve(found);
      },
    };
  });

  it("returns parent and blockers when both are present", async () => {
    const parent = makeFakeIssue({
      id: "parent-id",
      identifier: "PRY-100",
      title: "Parent issue",
      description: "Parent description",
      labels: () => Promise.resolve({ nodes: [{ id: "l1", name: "epic" }] }),
      state: Promise.resolve({ id: "s1", name: "In Progress" }),
      priority: 2,
      url: "https://linear.app/team/issue/PRY-100",
    });
    const blocker = makeFakeIssue({
      id: "blocker-id",
      identifier: "PRY-101",
      title: "Blocker issue",
      description: "Blocker description",
      labels: () => Promise.resolve({ nodes: [{ id: "l2", name: "infra" }] }),
      state: Promise.resolve({ id: "s2", name: "Todo" }),
      priority: 1,
      url: "https://linear.app/team/issue/PRY-101",
    });
    const focus = makeFakeIssue({
      id: "focus-id",
      identifier: "PRY-200",
      parent: Promise.resolve(parent),
      inverseRelations: () =>
        Promise.resolve({
          nodes: [{ id: "rel-1", type: "blocks", issue: Promise.resolve(blocker) }],
        }),
    });

    issuesById.set("focus-id", focus);
    issuesById.set("parent-id", parent);
    issuesById.set("blocker-id", blocker);

    const ctx = await client.getRelatedContext("focus-id");

    expect(ctx.parent).toEqual({
      id: "parent-id",
      identifier: "PRY-100",
      title: "Parent issue",
      description: "Parent description",
      state: "In Progress",
      labels: ["epic"],
      priority: 2,
      url: "https://linear.app/team/issue/PRY-100",
    });
    expect(ctx.blockers).toEqual([
      {
        id: "blocker-id",
        identifier: "PRY-101",
        title: "Blocker issue",
        description: "Blocker description",
        state: "Todo",
        labels: ["infra"],
        priority: 1,
        url: "https://linear.app/team/issue/PRY-101",
      },
    ]);
  });

  it("returns parent only when there are no blockers", async () => {
    const parent = makeFakeIssue({ id: "parent-id", identifier: "PRY-100" });
    const focus = makeFakeIssue({
      id: "focus-id",
      parent: Promise.resolve(parent),
      inverseRelations: () => Promise.resolve({ nodes: [] }),
    });

    issuesById.set("focus-id", focus);
    issuesById.set("parent-id", parent);

    const ctx = await client.getRelatedContext("focus-id");

    expect(ctx.parent?.id).toBe("parent-id");
    expect(ctx.blockers).toEqual([]);
  });

  it("returns blockers only when there is no parent", async () => {
    const blocker = makeFakeIssue({ id: "blocker-id", identifier: "PRY-101" });
    const focus = makeFakeIssue({
      id: "focus-id",
      parent: Promise.resolve(null),
      inverseRelations: () =>
        Promise.resolve({
          nodes: [{ id: "rel-1", type: "blocks", issue: Promise.resolve(blocker) }],
        }),
    });

    issuesById.set("focus-id", focus);
    issuesById.set("blocker-id", blocker);

    const ctx = await client.getRelatedContext("focus-id");

    expect(ctx.parent).toBeUndefined();
    expect(ctx.blockers).toHaveLength(1);
    expect(ctx.blockers[0].id).toBe("blocker-id");
  });

  it("returns empty when there are no relations", async () => {
    const focus = makeFakeIssue({
      id: "focus-id",
      parent: Promise.resolve(null),
      inverseRelations: () => Promise.resolve({ nodes: [] }),
    });

    issuesById.set("focus-id", focus);

    const ctx = await client.getRelatedContext("focus-id");

    expect(ctx.parent).toBeUndefined();
    expect(ctx.blockers).toEqual([]);
  });

  it("ignores non-blocks inverse relations (e.g. duplicate, related)", async () => {
    const duplicate = makeFakeIssue({ id: "duplicate-id", identifier: "PRY-300" });
    const related = makeFakeIssue({ id: "related-id", identifier: "PRY-400" });
    const blocker = makeFakeIssue({ id: "blocker-id", identifier: "PRY-101" });
    const focus = makeFakeIssue({
      id: "focus-id",
      parent: Promise.resolve(null),
      inverseRelations: () =>
        Promise.resolve({
          nodes: [
            { id: "rel-1", type: "duplicate", issue: Promise.resolve(duplicate) },
            { id: "rel-2", type: "related", issue: Promise.resolve(related) },
            { id: "rel-3", type: "blocks", issue: Promise.resolve(blocker) },
          ],
        }),
    });

    issuesById.set("focus-id", focus);
    issuesById.set("blocker-id", blocker);
    issuesById.set("duplicate-id", duplicate);
    issuesById.set("related-id", related);

    const ctx = await client.getRelatedContext("focus-id");

    expect(ctx.blockers).toHaveLength(1);
    expect(ctx.blockers[0].id).toBe("blocker-id");
  });

  it("treats null description as empty string", async () => {
    const parent = makeFakeIssue({
      id: "parent-id",
      identifier: "PRY-100",
      description: null,
    });
    const focus = makeFakeIssue({
      id: "focus-id",
      parent: Promise.resolve(parent),
    });

    issuesById.set("focus-id", focus);
    issuesById.set("parent-id", parent);

    const ctx = await client.getRelatedContext("focus-id");

    expect(ctx.parent?.description).toBe("");
  });
});
