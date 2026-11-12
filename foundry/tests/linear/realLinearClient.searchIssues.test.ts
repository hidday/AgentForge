import { describe, it, expect, vi } from "vitest";
import { RealLinearClient } from "../../src/linear/realLinearClient.js";
import type { IssueSearchFilter } from "../../src/linear/linearClient.js";

interface FakeIssue {
  id: string;
  identifier: string;
  title: string;
  description: string | null;
  branchName: string;
  priority: number;
  url: string;
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
    project: Promise.resolve(null),
    cycle: Promise.resolve(null),
    team: Promise.resolve(null),
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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeClient(issuesFn: (opts: { filter: Record<string, any> }) => Promise<{
  nodes: FakeIssue[];
} | null>) {
  const logger = makeLogger();
  const client = new RealLinearClient("test-key", logger as never);
  (
    client as unknown as {
      sdk: {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        issues: (opts: { filter: Record<string, any> }) => Promise<{ nodes: FakeIssue[] } | null>;
      };
    }
  ).sdk = { issues: issuesFn };
  return { client, logger };
}

describe("RealLinearClient.searchIssues", () => {
  it("builds a base filter with only state when no optional filters are set", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let capturedFilter: Record<string, any> | undefined;
    const { client } = makeClient((opts) => {
      capturedFilter = opts.filter;
      return Promise.resolve({ nodes: [] });
    });

    const filter: IssueSearchFilter = { state: "Todo" };
    const results = await client.searchIssues(filter);

    expect(results).toEqual([]);
    expect(capturedFilter).toEqual({ state: { name: { eq: "Todo" } } });
  });

  it("adds a project filter when projectName is set", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let capturedFilter: Record<string, any> | undefined;
    const { client } = makeClient((opts) => {
      capturedFilter = opts.filter;
      return Promise.resolve({ nodes: [] });
    });

    await client.searchIssues({ state: "Todo", projectName: "Backend Platform" });

    expect(capturedFilter?.project).toEqual({ name: { eq: "Backend Platform" } });
  });

  it("adds an assignee filter when assigneeMe is true", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let capturedFilter: Record<string, any> | undefined;
    const { client } = makeClient((opts) => {
      capturedFilter = opts.filter;
      return Promise.resolve({ nodes: [] });
    });

    await client.searchIssues({ state: "Todo", assigneeMe: true });

    expect(capturedFilter?.assignee).toEqual({ isMe: { eq: true } });
  });

  it("does not add an assignee filter when assigneeMe is false", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let capturedFilter: Record<string, any> | undefined;
    const { client } = makeClient((opts) => {
      capturedFilter = opts.filter;
      return Promise.resolve({ nodes: [] });
    });

    await client.searchIssues({ state: "Todo", assigneeMe: false });

    expect(capturedFilter?.assignee).toBeUndefined();
  });

  it("adds a team filter matching either name or key when team is set", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let capturedFilter: Record<string, any> | undefined;
    const { client } = makeClient((opts) => {
      capturedFilter = opts.filter;
      return Promise.resolve({ nodes: [] });
    });

    await client.searchIssues({ state: "Todo", team: "PRY" });

    expect(capturedFilter?.team).toEqual({
      or: [{ name: { eq: "PRY" } }, { key: { eq: "PRY" } }],
    });
  });

  it("maps every matching issue, using the requested state name rather than a per-issue fetch", async () => {
    const issueA = makeFakeIssue({
      id: "a",
      identifier: "PRY-1",
      title: "Issue A",
      project: Promise.resolve({ id: "p1", name: "Backend" }),
      cycle: Promise.resolve({ id: "c1", name: "Sprint 1" }),
      team: Promise.resolve({ id: "t1", key: "PRY" }),
      labels: () => Promise.resolve({ nodes: [{ id: "l1", name: "bug" }] }),
    });
    const issueB = makeFakeIssue({
      id: "b",
      identifier: "PRY-2",
      title: "Issue B",
      description: null,
      labels: () => Promise.resolve(null),
    });
    const { client, logger } = makeClient(() =>
      Promise.resolve({ nodes: [issueA, issueB] }),
    );

    const results = await client.searchIssues({ state: "Todo" });

    expect(results).toHaveLength(2);
    expect(results[0]).toEqual({
      id: "a",
      identifier: "PRY-1",
      title: "Issue A",
      description: "Issue description",
      branchName: "ai/issue-1",
      state: "Todo",
      labels: ["bug"],
      priority: 0,
      url: "https://linear.app/team/issue/PRY-1",
      project: "Backend",
      team: "PRY",
      cycle: "Sprint 1",
    });
    expect(results[1]).toEqual({
      id: "b",
      identifier: "PRY-2",
      title: "Issue B",
      description: "",
      branchName: "ai/issue-1",
      state: "Todo",
      labels: [],
      priority: 0,
      url: "https://linear.app/team/issue/PRY-1",
      project: undefined,
      team: undefined,
      cycle: undefined,
    });
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ count: 2, stateName: "Todo" }),
      "Searched Linear issues",
    );
  });

  it("returns an empty array when the connection has no nodes", async () => {
    const { client } = makeClient(() => Promise.resolve(null));

    const results = await client.searchIssues({ state: "Todo" });

    expect(results).toEqual([]);
  });
});
