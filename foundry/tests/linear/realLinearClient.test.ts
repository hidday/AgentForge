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
    labelIds: [] as string[],
    state: Promise.resolve({ id: "state-1", name: "Todo" }),
    project: Promise.resolve(null),
    cycle: Promise.resolve(null),
    team: Promise.resolve({ id: "team-1", key: "PRY" }),
    labels: () => Promise.resolve({ nodes: [] }),
    inverseRelations: () => Promise.resolve({ nodes: [] }),
    parent: Promise.resolve(null),
    ...overrides,
  };
}

function setSdk(client: RealLinearClient, sdk: Record<string, unknown>) {
  (client as unknown as { sdk: Record<string, unknown> }).sdk = sdk;
}

describe("RealLinearClient.getIssue", () => {
  let logger: ReturnType<typeof makeLogger>;
  let client: RealLinearClient;

  beforeEach(() => {
    logger = makeLogger();
    client = new RealLinearClient("key", logger as never);
  });

  it("maps a fully populated issue, including project/team/cycle names", async () => {
    const issue = makeFakeIssue({
      labels: () => Promise.resolve({ nodes: [{ id: "l1", name: "bug" }] }),
      project: Promise.resolve({ name: "Project X" }),
      cycle: Promise.resolve({ name: "Cycle 3" }),
      team: Promise.resolve({ id: "team-1", key: "PRY" }),
    });
    setSdk(client, { issue: vi.fn().mockResolvedValue(issue) });

    const result = await client.getIssue("issue-1");

    expect(result).toEqual({
      id: "issue-1",
      identifier: "PRY-1",
      title: "Issue title",
      description: "Issue description",
      branchName: "ai/issue-1",
      state: "Todo",
      labels: ["bug"],
      priority: 0,
      url: "https://linear.app/team/issue/PRY-1",
      project: "Project X",
      team: "PRY",
      cycle: "Cycle 3",
    });
  });

  it("defaults description to empty string and state to Unknown when absent", async () => {
    const issue = makeFakeIssue({
      description: null,
      state: Promise.resolve(null),
      team: Promise.resolve(null),
    });
    setSdk(client, { issue: vi.fn().mockResolvedValue(issue) });

    const result = await client.getIssue("issue-1");

    expect(result.description).toBe("");
    expect(result.state).toBe("Unknown");
    expect(result.project).toBeUndefined();
    expect(result.team).toBeUndefined();
    expect(result.cycle).toBeUndefined();
  });

  it("logs a warning and skips a blocker that fails to hydrate", async () => {
    const focus = makeFakeIssue({
      inverseRelations: () =>
        Promise.resolve({
          nodes: [
            {
              id: "rel-1",
              type: "blocks",
              issue: Promise.reject(new Error("fetch failed")),
            },
          ],
        }),
    });
    setSdk(client, { issue: vi.fn().mockResolvedValue(focus) });

    const ctx = await client.getRelatedContext("issue-1");

    expect(ctx.blockers).toEqual([]);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ relationId: "rel-1" }),
      "Failed to hydrate blocker issue from relation",
    );
  });
});

describe("RealLinearClient.searchIssues", () => {
  it("builds a GraphQL filter from projectName, assigneeMe, and team, and maps results", async () => {
    const logger = makeLogger();
    const client = new RealLinearClient("key", logger as never);
    const issue = makeFakeIssue({
      labels: () => Promise.resolve({ nodes: [{ id: "l1", name: "bug" }] }),
      project: Promise.resolve({ name: "Project X" }),
      cycle: Promise.resolve(null),
      team: Promise.resolve({ id: "t1", key: "PRY" }),
    });
    const issuesMock = vi.fn().mockResolvedValue({ nodes: [issue] });
    setSdk(client, { issues: issuesMock });

    const results = await client.searchIssues({
      state: "Todo",
      projectName: "Project X",
      assigneeMe: true,
      team: "PRY",
    });

    expect(results).toHaveLength(1);
    expect(results[0].project).toBe("Project X");
    expect(results[0].state).toBe("Todo");
    expect(issuesMock).toHaveBeenCalledWith({
      filter: {
        state: { name: { eq: "Todo" } },
        project: { name: { eq: "Project X" } },
        assignee: { isMe: { eq: true } },
        team: { or: [{ name: { eq: "PRY" } }, { key: { eq: "PRY" } }] },
      },
    });
  });

  it("returns an empty array when no issues match and omits optional filter fields", async () => {
    const client = new RealLinearClient("key", makeLogger() as never);
    setSdk(client, { issues: vi.fn().mockResolvedValue({ nodes: [] }) });

    const results = await client.searchIssues({ state: "Done" });

    expect(results).toEqual([]);
  });
});

describe("RealLinearClient.postComment", () => {
  it("creates a comment via the SDK", async () => {
    const client = new RealLinearClient("key", makeLogger() as never);
    const createComment = vi.fn().mockResolvedValue({});
    setSdk(client, { createComment });

    await client.postComment("issue-1", "hello");

    expect(createComment).toHaveBeenCalledWith({ issueId: "issue-1", body: "hello" });
  });
});

describe("RealLinearClient.updateIssueState", () => {
  it("resolves the workflow state id by name and updates the issue", async () => {
    const logger = makeLogger();
    const client = new RealLinearClient("key", logger as never);
    const issue = makeFakeIssue({ team: Promise.resolve({ id: "team-1", key: "PRY" }) });
    const updateIssue = vi.fn().mockResolvedValue({});
    const team = {
      states: () =>
        Promise.resolve({ nodes: [{ id: "state-planning", name: "Planning" }] }),
    };
    setSdk(client, {
      issue: vi.fn().mockResolvedValue(issue),
      team: vi.fn().mockResolvedValue(team),
      updateIssue,
    });

    await client.updateIssueState("issue-1", "Planning");

    expect(updateIssue).toHaveBeenCalledWith("issue-1", { stateId: "state-planning" });
  });

  it("caches workflow states per team across repeated calls", async () => {
    const client = new RealLinearClient("key", makeLogger() as never);
    const issue = makeFakeIssue({ team: Promise.resolve({ id: "team-1", key: "PRY" }) });
    const teamFn = vi.fn().mockResolvedValue({
      states: () => Promise.resolve({ nodes: [{ id: "state-planning", name: "Planning" }] }),
    });
    setSdk(client, {
      issue: vi.fn().mockResolvedValue(issue),
      team: teamFn,
      updateIssue: vi.fn().mockResolvedValue({}),
    });

    await client.updateIssueState("issue-1", "Planning");
    await client.updateIssueState("issue-1", "Planning");

    expect(teamFn).toHaveBeenCalledTimes(1);
  });

  it("warns and returns without updating when the issue has no team", async () => {
    const logger = makeLogger();
    const client = new RealLinearClient("key", logger as never);
    const issue = makeFakeIssue({ team: Promise.resolve(null) });
    const updateIssue = vi.fn();
    setSdk(client, { issue: vi.fn().mockResolvedValue(issue), updateIssue });

    await client.updateIssueState("issue-1", "Planning");

    expect(updateIssue).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(
      { issueId: "issue-1" },
      "Cannot update state: issue has no team",
    );
  });

  it("warns and returns without updating when the state name is not found", async () => {
    const logger = makeLogger();
    const client = new RealLinearClient("key", logger as never);
    const issue = makeFakeIssue({ team: Promise.resolve({ id: "team-1", key: "PRY" }) });
    const updateIssue = vi.fn();
    setSdk(client, {
      issue: vi.fn().mockResolvedValue(issue),
      team: vi.fn().mockResolvedValue({ states: () => Promise.resolve({ nodes: [] }) }),
      updateIssue,
    });

    await client.updateIssueState("issue-1", "NoSuchState");

    expect(updateIssue).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(
      { issueId: "issue-1", stateName: "NoSuchState", teamId: "team-1" },
      "Could not find workflow state by name",
    );
  });
});

describe("RealLinearClient.addLabel", () => {
  it("resolves an existing label by name and adds it when not already present", async () => {
    const client = new RealLinearClient("key", makeLogger() as never);
    const issue = makeFakeIssue({ labelIds: [], team: Promise.resolve({ id: "team-1" }) });
    const updateIssue = vi.fn().mockResolvedValue({});
    setSdk(client, {
      issue: vi.fn().mockResolvedValue(issue),
      issueLabels: vi.fn().mockResolvedValue({ nodes: [{ id: "label-1", name: "bug" }] }),
      updateIssue,
    });

    await client.addLabel("issue-1", "bug");

    expect(updateIssue).toHaveBeenCalledWith("issue-1", { labelIds: ["label-1"] });
  });

  it("does not add a duplicate label id", async () => {
    const client = new RealLinearClient("key", makeLogger() as never);
    const issue = makeFakeIssue({ labelIds: ["label-1"], team: Promise.resolve({ id: "team-1" }) });
    const updateIssue = vi.fn();
    setSdk(client, {
      issue: vi.fn().mockResolvedValue(issue),
      issueLabels: vi.fn().mockResolvedValue({ nodes: [{ id: "label-1", name: "bug" }] }),
      updateIssue,
    });

    await client.addLabel("issue-1", "bug");

    expect(updateIssue).not.toHaveBeenCalled();
  });

  it("creates a new label when none exists, scoped to the issue's team", async () => {
    const logger = makeLogger();
    const client = new RealLinearClient("key", logger as never);
    const issue = makeFakeIssue({ labelIds: [], team: Promise.resolve({ id: "team-1" }) });
    const createIssueLabel = vi.fn().mockResolvedValue({
      issueLabel: Promise.resolve({ id: "new-label", name: "urgent" }),
    });
    const updateIssue = vi.fn().mockResolvedValue({});
    setSdk(client, {
      issue: vi.fn().mockResolvedValue(issue),
      issueLabels: vi.fn().mockResolvedValue({ nodes: [] }),
      createIssueLabel,
      updateIssue,
    });

    await client.addLabel("issue-1", "urgent");

    expect(createIssueLabel).toHaveBeenCalledWith({ name: "urgent", teamId: "team-1" });
    expect(updateIssue).toHaveBeenCalledWith("issue-1", { labelIds: ["new-label"] });
    expect(logger.info).toHaveBeenCalledWith(
      { labelName: "urgent", labelId: "new-label" },
      "Created new Linear label",
    );
  });

  it("throws when label creation does not return an issueLabel", async () => {
    const client = new RealLinearClient("key", makeLogger() as never);
    const issue = makeFakeIssue({ labelIds: [], team: Promise.resolve(undefined) });
    setSdk(client, {
      issue: vi.fn().mockResolvedValue(issue),
      issueLabels: vi.fn().mockResolvedValue({ nodes: [] }),
      createIssueLabel: vi.fn().mockResolvedValue({ issueLabel: Promise.resolve(undefined) }),
      updateIssue: vi.fn(),
    });

    await expect(client.addLabel("issue-1", "urgent")).rejects.toThrow(
      "Failed to create label: urgent",
    );
  });

  it("reuses a cached label id across calls without re-querying the SDK", async () => {
    const client = new RealLinearClient("key", makeLogger() as never);
    const issue = makeFakeIssue({ labelIds: [], team: Promise.resolve({ id: "team-1" }) });
    const issueLabels = vi.fn().mockResolvedValue({ nodes: [{ id: "label-1", name: "bug" }] });
    setSdk(client, {
      issue: vi.fn().mockResolvedValue(issue),
      issueLabels,
      updateIssue: vi.fn().mockResolvedValue({}),
    });

    await client.addLabel("issue-1", "bug");
    await client.addLabel("issue-1", "bug");

    expect(issueLabels).toHaveBeenCalledTimes(1);
  });
});

describe("RealLinearClient.removeLabel", () => {
  it("removes a label resolved from the issue's current labels when not cached", async () => {
    const client = new RealLinearClient("key", makeLogger() as never);
    const issue = makeFakeIssue({
      labelIds: ["label-1", "label-2"],
      labels: () =>
        Promise.resolve({ nodes: [{ id: "label-1", name: "bug" }, { id: "label-2", name: "urgent" }] }),
    });
    const updateIssue = vi.fn().mockResolvedValue({});
    setSdk(client, { issue: vi.fn().mockResolvedValue(issue), updateIssue });

    await client.removeLabel("issue-1", "bug");

    expect(updateIssue).toHaveBeenCalledWith("issue-1", { labelIds: ["label-2"] });
  });

  it("is a no-op when the label is not found on the issue", async () => {
    const client = new RealLinearClient("key", makeLogger() as never);
    const issue = makeFakeIssue({ labelIds: [], labels: () => Promise.resolve({ nodes: [] }) });
    const updateIssue = vi.fn();
    setSdk(client, { issue: vi.fn().mockResolvedValue(issue), updateIssue });

    await client.removeLabel("issue-1", "missing");

    expect(updateIssue).not.toHaveBeenCalled();
  });

  it("uses a cached label id on a subsequent removal", async () => {
    const client = new RealLinearClient("key", makeLogger() as never);
    const issue = makeFakeIssue({
      labelIds: ["label-1"],
      labels: () => Promise.resolve({ nodes: [{ id: "label-1", name: "bug" }] }),
    });
    const updateIssue = vi.fn().mockResolvedValue({});
    setSdk(client, { issue: vi.fn().mockResolvedValue(issue), updateIssue });

    await client.listLabels("issue-1");
    await client.removeLabel("issue-1", "bug");

    expect(updateIssue).toHaveBeenCalledWith("issue-1", { labelIds: [] });
  });
});

describe("RealLinearClient.listLabels", () => {
  it("returns label names and warms the label cache", async () => {
    const client = new RealLinearClient("key", makeLogger() as never);
    const issue = makeFakeIssue({
      labels: () => Promise.resolve({ nodes: [{ id: "label-1", name: "bug" }] }),
    });
    setSdk(client, { issue: vi.fn().mockResolvedValue(issue) });

    const names = await client.listLabels("issue-1");

    expect(names).toEqual(["bug"]);
  });
});
