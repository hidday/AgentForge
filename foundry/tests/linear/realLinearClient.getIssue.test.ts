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
  state: Promise<{ id: string; name: string } | null>;
  project: Promise<{ id: string; name: string } | null>;
  cycle: Promise<{ id: string; name: string } | null>;
  team: Promise<{ id: string; key: string } | null>;
  labels: () => Promise<{ nodes: Array<{ id: string; name: string }> } | null>;
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
    state: Promise.resolve({ id: "state-1", name: "Todo" }),
    project: Promise.resolve({ id: "proj-1", name: "Backend" }),
    cycle: Promise.resolve({ id: "cycle-1", name: "Sprint 1" }),
    team: Promise.resolve({ id: "team-1", key: "PRY" }),
    labels: () => Promise.resolve({ nodes: [] }),
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

describe("RealLinearClient.getIssue", () => {
  let issuesById: Map<string, FakeIssue>;

  beforeEach(() => {
    issuesById = new Map();
  });

  it("maps a fully-populated issue to a LinearIssue", async () => {
    const issue = makeFakeIssue({
      id: "issue-1",
      identifier: "PRY-42",
      title: "Do the thing",
      description: "Full description",
      branchName: "ai/pry-42-do-the-thing",
      priority: 3,
      url: "https://linear.app/team/issue/PRY-42",
      state: Promise.resolve({ id: "state-1", name: "In Progress" }),
      project: Promise.resolve({ id: "proj-1", name: "Backend Platform" }),
      cycle: Promise.resolve({ id: "cycle-1", name: "Sprint 23" }),
      team: Promise.resolve({ id: "team-1", key: "PRY" }),
      labels: () =>
        Promise.resolve({
          nodes: [
            { id: "l1", name: "bug" },
            { id: "l2", name: "urgent" },
          ],
        }),
    });
    issuesById.set("issue-1", issue);
    const client = makeClient(issuesById);

    const result = await client.getIssue("issue-1");

    expect(result).toEqual({
      id: "issue-1",
      identifier: "PRY-42",
      title: "Do the thing",
      description: "Full description",
      branchName: "ai/pry-42-do-the-thing",
      state: "In Progress",
      labels: ["bug", "urgent"],
      priority: 3,
      url: "https://linear.app/team/issue/PRY-42",
      project: "Backend Platform",
      team: "PRY",
      cycle: "Sprint 23",
    });
  });

  it("falls back to defaults when description, state, project, cycle, team and labels are absent", async () => {
    const issue = makeFakeIssue({
      id: "issue-2",
      description: null,
      state: Promise.resolve(null),
      project: Promise.resolve(null),
      cycle: Promise.resolve(null),
      team: Promise.resolve(null),
      labels: () => Promise.resolve(null),
    });
    issuesById.set("issue-2", issue);
    const client = makeClient(issuesById);

    const result = await client.getIssue("issue-2");

    expect(result.description).toBe("");
    expect(result.state).toBe("Unknown");
    expect(result.project).toBeUndefined();
    expect(result.cycle).toBeUndefined();
    expect(result.team).toBeUndefined();
    expect(result.labels).toEqual([]);
  });

  it("defaults labels to an empty array when the labels connection has no nodes", async () => {
    const issue = makeFakeIssue({
      id: "issue-3",
      labels: () => Promise.resolve({ nodes: [] }),
    });
    issuesById.set("issue-3", issue);
    const client = makeClient(issuesById);

    const result = await client.getIssue("issue-3");

    expect(result.labels).toEqual([]);
  });
});
