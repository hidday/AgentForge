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
  state: Promise<{ id: string; name: string }>;
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

describe("RealLinearClient.getRelatedContext blocker hydration failures", () => {
  it("drops a blocker relation whose issue fails to hydrate, logging a warning", async () => {
    const goodBlocker = makeFakeIssue({ id: "good-blocker", identifier: "PRY-101" });
    const issuesById = new Map<string, FakeIssue>();
    const logger = makeLogger();
    const client = new RealLinearClient("test-key", logger as never);

    const focus = makeFakeIssue({
      id: "focus-id",
      inverseRelations: () =>
        Promise.resolve({
          nodes: [
            {
              id: "rel-broken",
              type: "blocks",
              issue: Promise.reject(new Error("GraphQL fetch failed")),
            },
            {
              id: "rel-good",
              type: "blocks",
              issue: Promise.resolve(goodBlocker),
            },
          ],
        }),
    });
    issuesById.set("focus-id", focus);
    issuesById.set("good-blocker", goodBlocker);

    (client as unknown as { sdk: { issue: (id: string) => Promise<FakeIssue> } }).sdk = {
      issue: (id: string) => {
        const found = issuesById.get(id);
        if (!found) throw new Error(`Fake SDK: issue ${id} not seeded`);
        return Promise.resolve(found);
      },
    };

    const ctx = await client.getRelatedContext("focus-id");

    expect(ctx.blockers).toHaveLength(1);
    expect(ctx.blockers[0].id).toBe("good-blocker");
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ relationId: "rel-broken", focusIssueId: "focus-id" }),
      "Failed to hydrate blocker issue from relation",
    );
  });

  it("returns no blockers when every blocker relation fails to hydrate", async () => {
    const issuesById = new Map<string, FakeIssue>();
    const logger = makeLogger();
    const client = new RealLinearClient("test-key", logger as never);

    const focus = makeFakeIssue({
      id: "focus-id",
      inverseRelations: () =>
        Promise.resolve({
          nodes: [
            {
              id: "rel-broken",
              type: "blocks",
              issue: Promise.reject(new Error("not found")),
            },
          ],
        }),
    });
    issuesById.set("focus-id", focus);

    (client as unknown as { sdk: { issue: (id: string) => Promise<FakeIssue> } }).sdk = {
      issue: (id: string) => {
        const found = issuesById.get(id);
        if (!found) throw new Error(`Fake SDK: issue ${id} not seeded`);
        return Promise.resolve(found);
      },
    };

    const ctx = await client.getRelatedContext("focus-id");

    expect(ctx.blockers).toEqual([]);
    expect(logger.warn).toHaveBeenCalledTimes(1);
  });
});
