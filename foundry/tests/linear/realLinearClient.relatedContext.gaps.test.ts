import { describe, it, expect, vi } from "vitest";
import { RealLinearClient } from "../../src/linear/realLinearClient.js";

// Covers RealLinearClient.fetchBlockers()'s catch branch: when hydrating a
// blocker relation's `.issue` promise throws, it should be logged and
// dropped (not propagated), while other valid blockers still come through.

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
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
}

describe("RealLinearClient.getRelatedContext — blocker hydration failure", () => {
  it("drops a blocker whose relation.issue rejects, logs a warning, and still returns the other blockers", async () => {
    const logger = makeLogger();
    const client = new RealLinearClient("test-key", logger as never);

    const issuesById = new Map<string, FakeIssue>();
    (client as unknown as { sdk: { issue: (id: string) => Promise<FakeIssue> } }).sdk = {
      issue: (id: string) => {
        const found = issuesById.get(id);
        if (!found) throw new Error(`Fake SDK: issue ${id} not seeded`);
        return Promise.resolve(found);
      },
    };

    const goodBlocker = makeFakeIssue({ id: "good-blocker", identifier: "PRY-101" });
    const focus = makeFakeIssue({
      id: "focus-id",
      parent: Promise.resolve(null),
      inverseRelations: () =>
        Promise.resolve({
          nodes: [
            {
              id: "rel-broken",
              type: "blocks",
              issue: Promise.reject(new Error("blocker issue fetch failed")),
            },
            { id: "rel-good", type: "blocks", issue: Promise.resolve(goodBlocker) },
          ],
        }),
    });

    issuesById.set("focus-id", focus);
    issuesById.set("good-blocker", goodBlocker);

    const ctx = await client.getRelatedContext("focus-id");

    expect(ctx.blockers).toHaveLength(1);
    expect(ctx.blockers[0].id).toBe("good-blocker");
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ relationId: "rel-broken", focusIssueId: "focus-id" }),
      "Failed to hydrate blocker issue from relation",
    );
  });
});
