import { describe, it, expect, vi } from "vitest";
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
  state: Promise<{ id: string; name: string } | null>;
  project: Promise<{ name: string } | null>;
  cycle: Promise<{ name: string } | null>;
  team: Promise<{ id: string; key: string } | null>;
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

function makeClient(sdk: Record<string, unknown>) {
  const logger = makeLogger();
  const client = new RealLinearClient("test-key", logger as never);
  (client as unknown as { sdk: unknown }).sdk = sdk;
  return { client, logger };
}

describe("RealLinearClient.getRelatedContext - null fallback branches", () => {
  it("treats a null inverseRelations() result as having no blockers", async () => {
    const focus = makeFakeIssue({
      id: "focus-id",
      parent: Promise.resolve(null),
      inverseRelations: () => Promise.resolve(null),
    });
    const { client } = makeClient({
      issue: (id: string) => (id === "focus-id" ? Promise.resolve(focus) : Promise.reject(new Error("not seeded"))),
    });

    const ctx = await client.getRelatedContext("focus-id");

    expect(ctx.blockers).toEqual([]);
  });

  it("falls back to an empty labels array when a related issue's labels() resolves null", async () => {
    const parent = makeFakeIssue({
      id: "parent-id",
      labels: () => Promise.resolve(null),
    });
    const focus = makeFakeIssue({
      id: "focus-id",
      parent: Promise.resolve(parent),
    });
    const { client } = makeClient({
      issue: (id: string) =>
        id === "focus-id"
          ? Promise.resolve(focus)
          : id === "parent-id"
            ? Promise.resolve(parent)
            : Promise.reject(new Error("not seeded")),
    });

    const ctx = await client.getRelatedContext("focus-id");

    expect(ctx.parent?.labels).toEqual([]);
  });

  it("falls back to 'Unknown' when a related issue's state resolves null", async () => {
    const parent = makeFakeIssue({
      id: "parent-id",
      state: Promise.resolve(null),
    });
    const focus = makeFakeIssue({
      id: "focus-id",
      parent: Promise.resolve(parent),
    });
    const { client } = makeClient({
      issue: (id: string) =>
        id === "focus-id"
          ? Promise.resolve(focus)
          : id === "parent-id"
            ? Promise.resolve(parent)
            : Promise.reject(new Error("not seeded")),
    });

    const ctx = await client.getRelatedContext("focus-id");

    expect(ctx.parent?.state).toBe("Unknown");
  });
});

describe("RealLinearClient.searchIssues - all-optional-fields-null branch", () => {
  it("maps an issue with null project/team/cycle and null labels() to undefined/empty defaults", async () => {
    const issue = makeFakeIssue({
      id: "i1",
      project: Promise.resolve(null),
      team: Promise.resolve(null),
      cycle: Promise.resolve(null),
      labels: () => Promise.resolve(null),
    });
    const { client } = makeClient({
      issues: vi.fn().mockResolvedValue({ nodes: [issue] }),
    });

    const results = await client.searchIssues({ state: "Todo" });

    expect(results).toHaveLength(1);
    expect(results[0].project).toBeUndefined();
    expect(results[0].team).toBeUndefined();
    expect(results[0].cycle).toBeUndefined();
    expect(results[0].labels).toEqual([]);
  });
});

describe("RealLinearClient.searchIssues - description null and cycle defined branches", () => {
  it("maps a null description to an empty string and a defined cycle to its name", async () => {
    const issue = makeFakeIssue({
      id: "i1",
      description: null,
      cycle: Promise.resolve({ name: "Cycle 7" }),
    });
    const { client } = makeClient({
      issues: vi.fn().mockResolvedValue({ nodes: [issue] }),
    });

    const results = await client.searchIssues({ state: "Todo" });

    expect(results).toHaveLength(1);
    expect(results[0].description).toBe("");
    expect(results[0].cycle).toBe("Cycle 7");
  });
});

describe("RealLinearClient.updateIssueState - resolveStateId with null states()", () => {
  it("treats a null team.states() result as no matching state and warns", async () => {
    const issue = makeFakeIssue({ id: "i1", team: Promise.resolve({ id: "t1", key: "PRY" }) });
    const teamStates = vi.fn().mockResolvedValue(null);
    const updateIssue = vi.fn();
    const { client, logger } = makeClient({
      issue: () => Promise.resolve(issue),
      updateIssue,
      team: () => Promise.resolve({ states: teamStates }),
    });

    await client.updateIssueState("i1", "Done");

    expect(updateIssue).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(
      { issueId: "i1", stateName: "Done", teamId: "t1" },
      "Could not find workflow state by name",
    );
  });
});
