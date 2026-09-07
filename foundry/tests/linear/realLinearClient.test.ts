import { describe, it, expect, vi, beforeEach } from "vitest";
import { RealLinearClient } from "../../src/linear/realLinearClient.js";

function makeLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };
}

interface FakeIssue {
  id: string;
  identifier: string;
  title: string;
  description: string | null;
  branchName: string;
  priority: number;
  url: string;
  labelIds: string[];
  parent?: Promise<FakeIssue | null>;
  state?: Promise<{ id: string; name: string } | null>;
  project?: Promise<{ name: string } | null>;
  cycle?: Promise<{ name: string } | null>;
  team?: Promise<{ id: string; key: string } | null>;
  labels?: () => Promise<{ nodes: Array<{ id: string; name: string }> }>;
  inverseRelations?: () => Promise<{
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

function injectSdk(client: RealLinearClient, sdk: Record<string, unknown>) {
  (client as unknown as { sdk: unknown }).sdk = sdk;
}

describe("RealLinearClient.getIssue", () => {
  it("maps an SDK issue to a LinearIssue, defaulting missing state/project/cycle/team", async () => {
    const logger = makeLogger();
    const client = new RealLinearClient("key", logger as never);
    const fake = makeFakeIssue({
      id: "i1",
      state: Promise.resolve(null),
      project: Promise.resolve(null),
      cycle: Promise.resolve(null),
      team: Promise.resolve(null),
      description: null,
    });
    injectSdk(client, { issue: vi.fn().mockResolvedValue(fake) });

    const result = await client.getIssue("i1");

    expect(result).toEqual({
      id: "i1",
      identifier: "PRY-1",
      title: "Issue title",
      description: "",
      branchName: "ai/issue-1",
      state: "Unknown",
      labels: [],
      priority: 0,
      url: "https://linear.app/team/issue/PRY-1",
      project: undefined,
      team: undefined,
      cycle: undefined,
    });
  });

  it("maps present state/project/cycle/team and labels", async () => {
    const logger = makeLogger();
    const client = new RealLinearClient("key", logger as never);
    const fake = makeFakeIssue({
      id: "i2",
      state: Promise.resolve({ id: "s1", name: "In Progress" }),
      project: Promise.resolve({ name: "Backend" }),
      cycle: Promise.resolve({ name: "Sprint 3" }),
      team: Promise.resolve({ id: "t1", key: "ENG" }),
      labels: () => Promise.resolve({ nodes: [{ id: "l1", name: "bug" }] }),
    });
    injectSdk(client, { issue: vi.fn().mockResolvedValue(fake) });

    const result = await client.getIssue("i2");

    expect(result.state).toBe("In Progress");
    expect(result.project).toBe("Backend");
    expect(result.cycle).toBe("Sprint 3");
    expect(result.team).toBe("ENG");
    expect(result.labels).toEqual(["bug"]);
  });
});

describe("RealLinearClient.getRelatedContext -- blocker hydration failure", () => {
  it("skips a blocker relation whose issue fails to hydrate and logs a warning", async () => {
    const logger = makeLogger();
    const client = new RealLinearClient("key", logger as never);
    const goodBlocker = makeFakeIssue({ id: "b1" });
    const focus = makeFakeIssue({
      id: "focus-id",
      inverseRelations: () =>
        Promise.resolve({
          nodes: [
            { id: "rel-1", type: "blocks", issue: Promise.reject(new Error("hydrate failed")) },
            { id: "rel-2", type: "blocks", issue: Promise.resolve(goodBlocker) },
          ],
        }),
    });
    injectSdk(client, {
      issue: vi.fn().mockImplementation((id: string) => {
        if (id === "focus-id") return Promise.resolve(focus);
        if (id === "b1") return Promise.resolve(goodBlocker);
        throw new Error("not seeded");
      }),
    });

    const ctx = await client.getRelatedContext("focus-id");

    expect(ctx.blockers).toHaveLength(1);
    expect(ctx.blockers[0].id).toBe("b1");
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ relationId: "rel-1", focusIssueId: "focus-id" }),
      "Failed to hydrate blocker issue from relation",
    );
  });
});

describe("RealLinearClient.searchIssues", () => {
  it("builds a GraphQL filter from state only and maps results", async () => {
    const logger = makeLogger();
    const client = new RealLinearClient("key", logger as never);
    const issuesFn = vi.fn().mockResolvedValue({
      nodes: [
        makeFakeIssue({ id: "i1", team: Promise.resolve({ id: "t1", key: "ENG" }) }),
      ],
    });
    injectSdk(client, { issues: issuesFn });

    const results = await client.searchIssues({ state: "Todo" });

    expect(issuesFn).toHaveBeenCalledWith({ filter: { state: { name: { eq: "Todo" } } } });
    expect(results).toHaveLength(1);
    expect(results[0].state).toBe("Todo");
    expect(results[0].team).toBe("ENG");
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ stateName: "Todo", count: 1 }),
      "Searched Linear issues",
    );
  });

  it("adds project, assigneeMe, and team clauses to the filter when provided", async () => {
    const logger = makeLogger();
    const client = new RealLinearClient("key", logger as never);
    const issuesFn = vi.fn().mockResolvedValue({ nodes: [] });
    injectSdk(client, { issues: issuesFn });

    await client.searchIssues({
      state: "Todo",
      projectName: "Backend",
      assigneeMe: true,
      team: "ENG",
    });

    expect(issuesFn).toHaveBeenCalledWith({
      filter: {
        state: { name: { eq: "Todo" } },
        project: { name: { eq: "Backend" } },
        assignee: { isMe: { eq: true } },
        team: { or: [{ name: { eq: "ENG" } }, { key: { eq: "ENG" } }] },
      },
    });
  });

  it("returns an empty array when the SDK returns no nodes", async () => {
    const logger = makeLogger();
    const client = new RealLinearClient("key", logger as never);
    injectSdk(client, { issues: vi.fn().mockResolvedValue(null) });

    const results = await client.searchIssues({ state: "Todo" });

    expect(results).toEqual([]);
  });
});

describe("RealLinearClient.postComment", () => {
  it("creates a comment via the SDK and logs it", async () => {
    const logger = makeLogger();
    const client = new RealLinearClient("key", logger as never);
    const createComment = vi.fn().mockResolvedValue({});
    injectSdk(client, { createComment });

    await client.postComment("issue-1", "hello");

    expect(createComment).toHaveBeenCalledWith({ issueId: "issue-1", body: "hello" });
    expect(logger.debug).toHaveBeenCalledWith({ issueId: "issue-1" }, "Posted comment to Linear issue");
  });
});

describe("RealLinearClient.updateIssueState", () => {
  it("warns and does nothing when the issue has no team", async () => {
    const logger = makeLogger();
    const client = new RealLinearClient("key", logger as never);
    const updateIssue = vi.fn();
    const fake = makeFakeIssue({ id: "i1", team: Promise.resolve(null) });
    injectSdk(client, { issue: vi.fn().mockResolvedValue(fake), updateIssue });

    await client.updateIssueState("i1", "Done");

    expect(updateIssue).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith({ issueId: "i1" }, "Cannot update state: issue has no team");
  });

  it("warns and does nothing when the state name cannot be resolved", async () => {
    const logger = makeLogger();
    const client = new RealLinearClient("key", logger as never);
    const updateIssue = vi.fn();
    const fake = makeFakeIssue({ id: "i1", team: Promise.resolve({ id: "t1", key: "ENG" }) });
    const team = { states: vi.fn().mockResolvedValue({ nodes: [{ id: "s1", name: "Todo" }] }) };
    injectSdk(client, {
      issue: vi.fn().mockResolvedValue(fake),
      team: vi.fn().mockResolvedValue(team),
      updateIssue,
    });

    await client.updateIssueState("i1", "NonexistentState");

    expect(updateIssue).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ issueId: "i1", stateName: "NonexistentState", teamId: "t1" }),
      "Could not find workflow state by name",
    );
  });

  it("resolves the state id and updates the issue, caching the team's state map", async () => {
    const logger = makeLogger();
    const client = new RealLinearClient("key", logger as never);
    const updateIssue = vi.fn().mockResolvedValue({});
    const fake1 = makeFakeIssue({ id: "i1", team: Promise.resolve({ id: "t1", key: "ENG" }) });
    const fake2 = makeFakeIssue({ id: "i2", team: Promise.resolve({ id: "t1", key: "ENG" }) });
    const statesFn = vi.fn().mockResolvedValue({ nodes: [{ id: "s1", name: "Done" }] });
    const team = { states: statesFn };
    const teamFn = vi.fn().mockResolvedValue(team);
    injectSdk(client, {
      issue: vi.fn().mockImplementation((id: string) => Promise.resolve(id === "i1" ? fake1 : fake2)),
      team: teamFn,
      updateIssue,
    });

    await client.updateIssueState("i1", "Done");
    await client.updateIssueState("i2", "Done");

    expect(updateIssue).toHaveBeenCalledWith("i1", { stateId: "s1" });
    expect(updateIssue).toHaveBeenCalledWith("i2", { stateId: "s1" });
    // Team lookup and states() call are cached per team, so only fetched once
    // even though two issues on the same team had their state updated.
    expect(teamFn).toHaveBeenCalledTimes(1);
    expect(statesFn).toHaveBeenCalledTimes(1);
  });
});

describe("RealLinearClient.addLabel", () => {
  it("reuses an existing label id and adds it to the issue's labelIds", async () => {
    const logger = makeLogger();
    const client = new RealLinearClient("key", logger as never);
    const updateIssue = vi.fn().mockResolvedValue({});
    const fake = makeFakeIssue({
      id: "i1",
      labelIds: ["existing-id"],
      team: Promise.resolve({ id: "t1", key: "ENG" }),
    });
    const issueLabels = vi.fn().mockResolvedValue({ nodes: [{ id: "label-id", name: "bug" }] });
    injectSdk(client, { issue: vi.fn().mockResolvedValue(fake), issueLabels, updateIssue });

    await client.addLabel("i1", "bug");

    expect(updateIssue).toHaveBeenCalledWith("i1", { labelIds: ["existing-id", "label-id"] });
  });

  it("creates a new label when none exists, scoped to the issue's team", async () => {
    const logger = makeLogger();
    const client = new RealLinearClient("key", logger as never);
    const updateIssue = vi.fn().mockResolvedValue({});
    const fake = makeFakeIssue({ id: "i1", labelIds: [], team: Promise.resolve({ id: "t1", key: "ENG" }) });
    const issueLabels = vi.fn().mockResolvedValue({ nodes: [] });
    const createIssueLabel = vi.fn().mockResolvedValue({
      issueLabel: Promise.resolve({ id: "new-label-id" }),
    });
    injectSdk(client, {
      issue: vi.fn().mockResolvedValue(fake),
      issueLabels,
      createIssueLabel,
      updateIssue,
    });

    await client.addLabel("i1", "new-label");

    expect(createIssueLabel).toHaveBeenCalledWith({ name: "new-label", teamId: "t1" });
    expect(updateIssue).toHaveBeenCalledWith("i1", { labelIds: ["new-label-id"] });
  });

  it("creates a team-less label when the issue has no team", async () => {
    const logger = makeLogger();
    const client = new RealLinearClient("key", logger as never);
    const fake = makeFakeIssue({ id: "i1", labelIds: [], team: Promise.resolve(null) });
    const issueLabels = vi.fn().mockResolvedValue({ nodes: [] });
    const createIssueLabel = vi.fn().mockResolvedValue({
      issueLabel: Promise.resolve({ id: "new-label-id" }),
    });
    injectSdk(client, {
      issue: vi.fn().mockResolvedValue(fake),
      issueLabels,
      createIssueLabel,
      updateIssue: vi.fn().mockResolvedValue({}),
    });

    await client.addLabel("i1", "new-label");

    expect(createIssueLabel).toHaveBeenCalledWith({ name: "new-label" });
  });

  it("throws when label creation returns no issueLabel", async () => {
    const logger = makeLogger();
    const client = new RealLinearClient("key", logger as never);
    const fake = makeFakeIssue({ id: "i1", labelIds: [], team: Promise.resolve(null) });
    injectSdk(client, {
      issue: vi.fn().mockResolvedValue(fake),
      issueLabels: vi.fn().mockResolvedValue({ nodes: [] }),
      createIssueLabel: vi.fn().mockResolvedValue({ issueLabel: Promise.resolve(null) }),
    });

    await expect(client.addLabel("i1", "broken-label")).rejects.toThrow(
      "Failed to create label: broken-label",
    );
  });

  it("does not add a duplicate label id already present on the issue", async () => {
    const logger = makeLogger();
    const client = new RealLinearClient("key", logger as never);
    const updateIssue = vi.fn();
    const fake = makeFakeIssue({
      id: "i1",
      labelIds: ["label-id"],
      team: Promise.resolve({ id: "t1", key: "ENG" }),
    });
    injectSdk(client, {
      issue: vi.fn().mockResolvedValue(fake),
      issueLabels: vi.fn().mockResolvedValue({ nodes: [{ id: "label-id", name: "bug" }] }),
      updateIssue,
    });

    await client.addLabel("i1", "bug");

    expect(updateIssue).not.toHaveBeenCalled();
  });
});

describe("RealLinearClient.removeLabel", () => {
  it("looks up and removes a label not yet cached", async () => {
    const logger = makeLogger();
    const client = new RealLinearClient("key", logger as never);
    const updateIssue = vi.fn().mockResolvedValue({});
    const fake = makeFakeIssue({
      id: "i1",
      labelIds: ["label-id", "other-id"],
      labels: () => Promise.resolve({ nodes: [{ id: "label-id", name: "bug" }] }),
    });
    injectSdk(client, { issue: vi.fn().mockResolvedValue(fake), updateIssue });

    await client.removeLabel("i1", "bug");

    expect(updateIssue).toHaveBeenCalledWith("i1", { labelIds: ["other-id"] });
  });

  it("is a no-op when the label is not found on the issue", async () => {
    const logger = makeLogger();
    const client = new RealLinearClient("key", logger as never);
    const updateIssue = vi.fn();
    const fake = makeFakeIssue({
      id: "i1",
      labelIds: ["other-id"],
      labels: () => Promise.resolve({ nodes: [] }),
    });
    injectSdk(client, { issue: vi.fn().mockResolvedValue(fake), updateIssue });

    await client.removeLabel("i1", "missing-label");

    expect(updateIssue).not.toHaveBeenCalled();
  });

  it("uses the cached label id on a subsequent removal without re-querying labels()", async () => {
    const logger = makeLogger();
    const client = new RealLinearClient("key", logger as never);
    const updateIssue = vi.fn().mockResolvedValue({});
    const labelsFn = vi.fn().mockResolvedValue({ nodes: [{ id: "label-id", name: "bug" }] });
    const fake1 = makeFakeIssue({ id: "i1", labelIds: ["label-id"], labels: labelsFn });
    const fake2 = makeFakeIssue({ id: "i2", labelIds: ["label-id"], labels: labelsFn });
    injectSdk(client, {
      issue: vi.fn().mockImplementation((id: string) => Promise.resolve(id === "i1" ? fake1 : fake2)),
      updateIssue,
    });

    await client.removeLabel("i1", "bug");
    await client.removeLabel("i2", "bug");

    expect(labelsFn).toHaveBeenCalledTimes(1);
    expect(updateIssue).toHaveBeenCalledTimes(2);
  });
});

describe("RealLinearClient.listLabels", () => {
  it("returns label names and populates the label cache", async () => {
    const logger = makeLogger();
    const client = new RealLinearClient("key", logger as never);
    const fake = makeFakeIssue({
      id: "i1",
      labels: () =>
        Promise.resolve({
          nodes: [
            { id: "l1", name: "bug" },
            { id: "l2", name: "urgent" },
          ],
        }),
    });
    injectSdk(client, { issue: vi.fn().mockResolvedValue(fake) });

    const names = await client.listLabels("i1");

    expect(names).toEqual(["bug", "urgent"]);
  });

  it("returns an empty array when the issue has no labels connection", async () => {
    const logger = makeLogger();
    const client = new RealLinearClient("key", logger as never);
    const fake = makeFakeIssue({ id: "i1", labels: () => Promise.resolve({ nodes: [] }) });
    injectSdk(client, { issue: vi.fn().mockResolvedValue(fake) });

    expect(await client.listLabels("i1")).toEqual([]);
  });
});
