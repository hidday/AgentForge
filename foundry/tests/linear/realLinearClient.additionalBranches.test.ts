import { describe, it, expect, vi, beforeEach } from "vitest";
import { RealLinearClient } from "../../src/linear/realLinearClient.js";

function makeLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
}

function makeFakeIssue(overrides: Record<string, unknown> = {}) {
  return {
    id: "issue-1",
    identifier: "PRY-1",
    title: "Issue title",
    description: "Issue description",
    branchName: "ai/issue-1",
    priority: 0,
    url: "https://linear.app/team/issue/PRY-1",
    labelIds: [],
    state: Promise.resolve({ id: "state-1", name: "Todo" }),
    project: Promise.resolve(null),
    cycle: Promise.resolve(null),
    team: Promise.resolve({ id: "team-1", key: "PRY" }),
    labels: () => Promise.resolve({ nodes: [] }),
    parent: Promise.resolve(null),
    inverseRelations: () => Promise.resolve({ nodes: [] }),
    ...overrides,
  };
}

describe("RealLinearClient — getRelatedContext", () => {
  let client: RealLinearClient;
  let sdk: Record<string, ReturnType<typeof vi.fn>>;
  let logger: ReturnType<typeof makeLogger>;

  beforeEach(() => {
    logger = makeLogger();
    client = new RealLinearClient("test-key", logger as never);
    sdk = {
      issue: vi.fn(),
      issues: vi.fn(),
      createComment: vi.fn().mockResolvedValue(undefined),
      updateIssue: vi.fn().mockResolvedValue(undefined),
      team: vi.fn(),
      issueLabels: vi.fn(),
      createIssueLabel: vi.fn(),
    };
    (client as unknown as { sdk: typeof sdk }).sdk = sdk;
  });

  it("returns no parent and no blockers when the issue has neither", async () => {
    const focusIssue = makeFakeIssue({
      parent: Promise.resolve(null),
      inverseRelations: () => Promise.resolve({ nodes: [] }),
    });
    sdk.issue.mockResolvedValue(focusIssue);

    const result = await client.getRelatedContext("issue-1");

    expect(result.parent).toBeUndefined();
    expect(result.blockers).toEqual([]);
    expect(logger.debug).toHaveBeenCalledWith(
      expect.objectContaining({ issueId: "issue-1", hasParent: false, blockerCount: 0 }),
      "Fetched related Linear context",
    );
  });

  it("maps the parent issue and 'blocks' relations into the related context", async () => {
    const parentIssue = makeFakeIssue({
      id: "parent-1",
      identifier: "PRY-0",
      title: "Parent",
      state: Promise.resolve({ name: "Done" }),
      labels: () => Promise.resolve({ nodes: [{ id: "l1", name: "epic" }] }),
    });
    const blockerIssue = makeFakeIssue({
      id: "blocker-1",
      identifier: "PRY-2",
      title: "Blocker",
      state: Promise.resolve({ name: "In Progress" }),
    });

    const focusIssue = makeFakeIssue({
      parent: Promise.resolve(parentIssue),
      inverseRelations: () =>
        Promise.resolve({
          nodes: [
            { id: "rel-1", type: "blocks", issue: blockerIssue },
            { id: "rel-2", type: "related", issue: makeFakeIssue({ id: "unrelated" }) },
          ],
        }),
    });
    sdk.issue.mockResolvedValue(focusIssue);

    const result = await client.getRelatedContext("issue-1");

    expect(result.parent).toMatchObject({ id: "parent-1", identifier: "PRY-0", state: "Done" });
    expect(result.blockers).toHaveLength(1);
    expect(result.blockers[0]).toMatchObject({ id: "blocker-1", state: "In Progress" });
  });

  it("filters out a blocker relation whose issue getter rejects, and logs a warning", async () => {
    const goodBlocker = makeFakeIssue({ id: "good-blocker" });

    const focusIssue = makeFakeIssue({
      id: "focus-1",
      parent: Promise.resolve(null),
      inverseRelations: () =>
        Promise.resolve({
          nodes: [
            {
              id: "rel-bad",
              type: "blocks",
              get issue() {
                return Promise.reject(new Error("issue was deleted"));
              },
            },
            { id: "rel-good", type: "blocks", issue: goodBlocker },
          ],
        }),
    });
    sdk.issue.mockResolvedValue(focusIssue);

    const result = await client.getRelatedContext("issue-1");

    expect(result.blockers).toHaveLength(1);
    expect(result.blockers[0]).toMatchObject({ id: "good-blocker" });
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ relationId: "rel-bad", focusIssueId: "focus-1" }),
      "Failed to hydrate blocker issue from relation",
    );
  });

  it("falls back to empty labels when the parent's labels() resolves without nodes", async () => {
    const parentIssue = makeFakeIssue({
      id: "parent-2",
      labels: () => Promise.resolve({ nodes: undefined }),
    });
    const focusIssue = makeFakeIssue({ parent: Promise.resolve(parentIssue) });
    sdk.issue.mockResolvedValue(focusIssue);

    const result = await client.getRelatedContext("issue-1");

    expect(result.parent?.labels).toEqual([]);
  });

  it("treats inverseRelations() resolving without nodes as having no blockers", async () => {
    const focusIssue = makeFakeIssue({
      parent: Promise.resolve(null),
      inverseRelations: () => Promise.resolve({ nodes: undefined }),
    });
    sdk.issue.mockResolvedValue(focusIssue);

    const result = await client.getRelatedContext("issue-1");

    expect(result.blockers).toEqual([]);
  });

  it("falls back to '' and 'Unknown' for a parent/blocker with a null description/state", async () => {
    const parentIssue = makeFakeIssue({
      id: "parent-3",
      description: null,
      state: Promise.resolve(null),
    });
    const focusIssue = makeFakeIssue({ parent: Promise.resolve(parentIssue) });
    sdk.issue.mockResolvedValue(focusIssue);

    const result = await client.getRelatedContext("issue-1");

    expect(result.parent?.description).toBe("");
    expect(result.parent?.state).toBe("Unknown");
  });
});

describe("RealLinearClient.searchIssues — optional-chaining fallback branches", () => {
  let client: RealLinearClient;
  let sdk: Record<string, ReturnType<typeof vi.fn>>;

  beforeEach(() => {
    client = new RealLinearClient("test-key", makeLogger() as never);
    sdk = { issues: vi.fn() };
    (client as unknown as { sdk: typeof sdk }).sdk = sdk;
  });

  it("falls back to [] for labels and undefined for project/team/cycle when all are missing", async () => {
    sdk.issues.mockResolvedValue({
      nodes: [
        makeFakeIssue({
          id: "x1",
          labels: () => Promise.resolve({ nodes: undefined }),
          project: Promise.resolve(null),
          team: Promise.resolve(null),
          cycle: Promise.resolve(null),
        }),
      ],
    });

    const results = await client.searchIssues({ state: "Todo" });

    expect(results[0]).toMatchObject({
      id: "x1",
      labels: [],
      project: undefined,
      team: undefined,
      cycle: undefined,
    });
  });

  it("falls back to '' for a null description", async () => {
    sdk.issues.mockResolvedValue({ nodes: [makeFakeIssue({ id: "x2", description: null })] });

    const results = await client.searchIssues({ state: "Todo" });

    expect(results[0]?.description).toBe("");
  });

  it("uses the cycle's name when a cycle is present", async () => {
    sdk.issues.mockResolvedValue({
      nodes: [makeFakeIssue({ id: "x3", cycle: Promise.resolve({ name: "Cycle 7" }) })],
    });

    const results = await client.searchIssues({ state: "Todo" });

    expect(results[0]?.cycle).toBe("Cycle 7");
  });
});

describe("RealLinearClient.resolveStateId — states()?.nodes fallback", () => {
  it("treats a states() response without nodes as having no matching state", async () => {
    const logger = makeLogger();
    const client = new RealLinearClient("test-key", logger as never);
    const sdk = {
      issue: vi.fn().mockResolvedValue({
        team: Promise.resolve({ id: "team-1", key: "PRY" }),
      }),
      team: vi.fn().mockResolvedValue({ states: () => Promise.resolve({ nodes: undefined }) }),
      updateIssue: vi.fn(),
    };
    (client as unknown as { sdk: typeof sdk }).sdk = sdk;

    await client.updateIssueState("issue-1", "Done");

    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ issueId: "issue-1", stateName: "Done" }),
      "Could not find workflow state by name",
    );
    expect(sdk.updateIssue).not.toHaveBeenCalled();
  });
});

describe("RealLinearClient.resolveOrCreateLabel — cache-hit branch", () => {
  it("reuses the cached label id on a second addLabel call without re-querying issueLabels", async () => {
    const client = new RealLinearClient("test-key", makeLogger() as never);
    const sdk = {
      issue: vi.fn().mockResolvedValue(
        makeFakeIssue({ team: Promise.resolve({ id: "team-1", key: "PRY" }), labelIds: [] }),
      ),
      issueLabels: vi.fn().mockResolvedValue({ nodes: [] }),
      createIssueLabel: vi.fn().mockResolvedValue({
        issueLabel: Promise.resolve({ id: "label-new", name: "bug" }),
      }),
      updateIssue: vi.fn().mockResolvedValue(undefined),
    };
    (client as unknown as { sdk: typeof sdk }).sdk = sdk;

    await client.addLabel("issue-1", "bug");
    await client.addLabel("issue-1", "bug");

    expect(sdk.issueLabels).toHaveBeenCalledTimes(1);
    expect(sdk.createIssueLabel).toHaveBeenCalledTimes(1);
  });
});
