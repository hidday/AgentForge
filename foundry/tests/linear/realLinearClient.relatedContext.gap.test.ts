import { describe, it, expect, vi } from "vitest";
import { RealLinearClient } from "../../src/linear/realLinearClient.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

function makeLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };
}

function makeFakeIssue(overrides: Any = {}): Any {
  return {
    id: "issue-1",
    identifier: "PRY-1",
    title: "Issue title",
    description: "Issue description",
    branchName: "ai/issue-1",
    priority: 1,
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

// Covers the gap left by realLinearClient.relatedContext.test.ts: the catch
// branch in fetchBlockers, exercised when hydrating a blocker relation's
// `issue` rejects. That file is not edited here, per the testing policy.
describe("RealLinearClient.getRelatedContext (gap: blocker hydration failure)", () => {
  it("logs a warning and omits a blocker whose relation.issue promise rejects", async () => {
    const logger = makeLogger();
    const client = new RealLinearClient("test-key", logger as Any);

    const hydrationError = new Error("blocker fetch failed");
    const okBlocker = makeFakeIssue({ id: "blocker-ok", identifier: "PRY-101" });

    const focus = makeFakeIssue({
      id: "focus-id",
      inverseRelations: () =>
        Promise.resolve({
          nodes: [
            { id: "rel-bad", type: "blocks", issue: Promise.reject(hydrationError) },
            { id: "rel-ok", type: "blocks", issue: Promise.resolve(okBlocker) },
          ],
        }),
    });

    (client as unknown as { sdk: Any }).sdk = {
      issue: vi.fn().mockResolvedValue(focus),
    };

    const ctx = await client.getRelatedContext("focus-id");

    expect(ctx.blockers).toHaveLength(1);
    expect(ctx.blockers[0].id).toBe("blocker-ok");
    expect(logger.warn).toHaveBeenCalledWith(
      { err: hydrationError, relationId: "rel-bad", focusIssueId: "focus-id" },
      "Failed to hydrate blocker issue from relation",
    );
  });

  it("defaults a related issue's state to 'Unknown' and labels to [] when absent", async () => {
    const logger = makeLogger();
    const client = new RealLinearClient("test-key", logger as Any);

    const parent = makeFakeIssue({
      id: "parent-id",
      identifier: "PRY-100",
      state: Promise.resolve(null),
      labels: () => Promise.resolve({ nodes: undefined }),
    });
    const focus = makeFakeIssue({
      id: "focus-id",
      parent: Promise.resolve(parent),
    });

    (client as unknown as { sdk: Any }).sdk = {
      issue: vi.fn((id: string) =>
        Promise.resolve(id === "parent-id" ? parent : focus),
      ),
    };

    const ctx = await client.getRelatedContext("focus-id");

    expect(ctx.parent?.state).toBe("Unknown");
    expect(ctx.parent?.labels).toEqual([]);
  });

  it("treats an undefined inverseRelations connection as having no blockers", async () => {
    const logger = makeLogger();
    const client = new RealLinearClient("test-key", logger as Any);

    const focus = makeFakeIssue({
      id: "focus-id",
      inverseRelations: () => Promise.resolve(undefined),
    });

    (client as unknown as { sdk: Any }).sdk = {
      issue: vi.fn().mockResolvedValue(focus),
    };

    const ctx = await client.getRelatedContext("focus-id");

    expect(ctx.blockers).toEqual([]);
  });
});
