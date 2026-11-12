import { describe, it, expect, vi } from "vitest";
import { RealLinearClient } from "../../src/linear/realLinearClient.js";

interface FakeIssue {
  id: string;
  identifier: string;
  title: string;
  description: string | null;
  priority: number;
  url: string;
  parent: Promise<FakeIssue | null>;
  state: Promise<{ id: string; name: string } | null>;
  labels: () => Promise<{ nodes: Array<{ id: string; name: string }> } | null>;
  inverseRelations: () => Promise<{
    nodes: Array<{ id: string; type: string; issue: Promise<FakeIssue> }>;
  } | null>;
}

function makeFakeIssue(overrides: Partial<FakeIssue> & { id: string }): FakeIssue {
  return {
    identifier: "PRY-1",
    title: "Issue title",
    description: "Issue description",
    priority: 0,
    url: "https://linear.app/team/issue/PRY-1",
    parent: Promise.resolve(null),
    state: Promise.resolve({ id: "state-1", name: "Todo" }),
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

function makeClient(issuesById: Map<string, FakeIssue>) {
  const client = new RealLinearClient("test-key", makeLogger() as never);
  (client as unknown as { sdk: { issue: (id: string) => Promise<FakeIssue> } }).sdk = {
    issue: (id: string) => {
      const found = issuesById.get(id);
      if (!found) throw new Error(`Fake SDK: issue ${id} not seeded`);
      return Promise.resolve(found);
    },
  };
  return client;
}

describe("RealLinearClient.getRelatedContext edge cases", () => {
  it("treats a null inverseRelations connection as having no blockers", async () => {
    const issuesById = new Map<string, FakeIssue>();
    const focus = makeFakeIssue({
      id: "focus-id",
      inverseRelations: () => Promise.resolve(null),
    });
    issuesById.set("focus-id", focus);
    const client = makeClient(issuesById);

    const ctx = await client.getRelatedContext("focus-id");

    expect(ctx.blockers).toEqual([]);
  });

  it("defaults the parent's labels to an empty array when its labels connection is null", async () => {
    const issuesById = new Map<string, FakeIssue>();
    const parent = makeFakeIssue({
      id: "parent-id",
      identifier: "PRY-100",
      labels: () => Promise.resolve(null),
    });
    const focus = makeFakeIssue({
      id: "focus-id",
      parent: Promise.resolve(parent),
    });
    issuesById.set("focus-id", focus);
    issuesById.set("parent-id", parent);
    const client = makeClient(issuesById);

    const ctx = await client.getRelatedContext("focus-id");

    expect(ctx.parent?.labels).toEqual([]);
  });

  it("defaults the parent's state to 'Unknown' when it has no workflow state", async () => {
    const issuesById = new Map<string, FakeIssue>();
    const parent = makeFakeIssue({
      id: "parent-id",
      identifier: "PRY-100",
      state: Promise.resolve(null),
    });
    const focus = makeFakeIssue({
      id: "focus-id",
      parent: Promise.resolve(parent),
    });
    issuesById.set("focus-id", focus);
    issuesById.set("parent-id", parent);
    const client = makeClient(issuesById);

    const ctx = await client.getRelatedContext("focus-id");

    expect(ctx.parent?.state).toBe("Unknown");
  });
});
