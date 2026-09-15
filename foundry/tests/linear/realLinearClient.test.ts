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
  team: Promise<{ id: string; key: string } | null>;
  state?: Promise<{ id: string; name: string }>;
  project?: Promise<{ name: string } | null>;
  cycle?: Promise<{ name: string } | null>;
  labels: () => Promise<{ nodes: Array<{ id: string; name: string }> }>;
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
    team: Promise.resolve({ id: "team-1", key: "PRY" }),
    state: Promise.resolve({ id: "state-1", name: "Todo" }),
    project: Promise.resolve(null),
    cycle: Promise.resolve(null),
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

type FakeSdk = {
  issue: ReturnType<typeof vi.fn>;
  issues: ReturnType<typeof vi.fn>;
  team: ReturnType<typeof vi.fn>;
  createComment: ReturnType<typeof vi.fn>;
  updateIssue: ReturnType<typeof vi.fn>;
  issueLabels: ReturnType<typeof vi.fn>;
  createIssueLabel: ReturnType<typeof vi.fn>;
};

function injectSdk(client: RealLinearClient, sdk: Partial<FakeSdk>) {
  (client as unknown as { sdk: FakeSdk }).sdk = sdk as FakeSdk;
}

describe("RealLinearClient.getIssue", () => {
  it("maps an SDK issue to a LinearIssue, defaulting missing fields", async () => {
    const logger = makeLogger();
    const client = new RealLinearClient("key", logger as never);
    const fake = makeFakeIssue({
      id: "issue-1",
      description: null,
      state: Promise.resolve({ id: "s1", name: "In Progress" }),
      project: Promise.resolve({ name: "Foundry" }),
      cycle: Promise.resolve({ name: "Cycle 3" }),
      team: Promise.resolve({ id: "team-1", key: "PRY" }),
      labels: () => Promise.resolve({ nodes: [{ id: "l1", name: "bug" }] }),
    });
    injectSdk(client, { issue: vi.fn().mockResolvedValue(fake) });

    const result = await client.getIssue("issue-1");

    expect(result).toEqual({
      id: "issue-1",
      identifier: "PRY-1",
      title: "Issue title",
      description: "",
      branchName: "ai/issue-1",
      state: "In Progress",
      labels: ["bug"],
      priority: 0,
      url: "https://linear.app/team/issue/PRY-1",
      project: "Foundry",
      team: "PRY",
      cycle: "Cycle 3",
    });
  });

  it("defaults state to Unknown and omits project/team/cycle when absent", async () => {
    const client = new RealLinearClient("key", makeLogger() as never);
    const fake = makeFakeIssue({
      id: "issue-2",
      state: Promise.resolve(undefined as unknown as { id: string; name: string }),
      team: Promise.resolve(null),
      project: Promise.resolve(null),
      cycle: Promise.resolve(null),
      labels: () => Promise.resolve({ nodes: [] }),
    });
    injectSdk(client, { issue: vi.fn().mockResolvedValue(fake) });

    const result = await client.getIssue("issue-2");

    expect(result.state).toBe("Unknown");
    expect(result.project).toBeUndefined();
    expect(result.team).toBeUndefined();
    expect(result.cycle).toBeUndefined();
    expect(result.labels).toEqual([]);
  });
});

describe("RealLinearClient.searchIssues", () => {
  it("builds a filter with only state when no optional filters are given", async () => {
    const client = new RealLinearClient("key", makeLogger() as never);
    const issuesMock = vi.fn().mockResolvedValue({ nodes: [] });
    injectSdk(client, { issues: issuesMock });

    await client.searchIssues({ state: "Todo" });

    expect(issuesMock).toHaveBeenCalledWith({
      filter: { state: { name: { eq: "Todo" } } },
    });
  });

  it("adds project, assignee, and team clauses when provided", async () => {
    const client = new RealLinearClient("key", makeLogger() as never);
    const issuesMock = vi.fn().mockResolvedValue({ nodes: [] });
    injectSdk(client, { issues: issuesMock });

    await client.searchIssues({
      state: "Todo",
      projectName: "Foundry",
      assigneeMe: true,
      team: "PRY",
    });

    expect(issuesMock).toHaveBeenCalledWith({
      filter: {
        state: { name: { eq: "Todo" } },
        project: { name: { eq: "Foundry" } },
        assignee: { isMe: { eq: true } },
        team: { or: [{ name: { eq: "PRY" } }, { key: { eq: "PRY" } }] },
      },
    });
  });

  it("maps matching issue nodes into LinearIssue results and logs a summary", async () => {
    const logger = makeLogger();
    const client = new RealLinearClient("key", logger as never);
    const fake = makeFakeIssue({
      id: "issue-1",
      project: Promise.resolve({ name: "Foundry" }),
      cycle: Promise.resolve({ name: "Cycle 1" }),
      team: Promise.resolve({ id: "team-1", key: "PRY" }),
      labels: () => Promise.resolve({ nodes: [{ id: "l1", name: "urgent" }] }),
    });
    injectSdk(client, { issues: vi.fn().mockResolvedValue({ nodes: [fake] }) });

    const results = await client.searchIssues({ state: "Todo" });

    expect(results).toEqual([
      {
        id: "issue-1",
        identifier: "PRY-1",
        title: "Issue title",
        description: "Issue description",
        branchName: "ai/issue-1",
        state: "Todo",
        labels: ["urgent"],
        priority: 0,
        url: "https://linear.app/team/issue/PRY-1",
        project: "Foundry",
        team: "PRY",
        cycle: "Cycle 1",
      },
    ]);
    expect(logger.info).toHaveBeenCalledWith(
      { projectName: undefined, assigneeMe: undefined, team: undefined, stateName: "Todo", count: 1 },
      "Searched Linear issues",
    );
  });

  it("returns an empty array when the SDK returns no nodes", async () => {
    const client = new RealLinearClient("key", makeLogger() as never);
    injectSdk(client, { issues: vi.fn().mockResolvedValue({ nodes: undefined }) });

    const results = await client.searchIssues({ state: "Todo" });

    expect(results).toEqual([]);
  });
});

describe("RealLinearClient.postComment", () => {
  it("calls sdk.createComment with the issue id and body", async () => {
    const logger = makeLogger();
    const client = new RealLinearClient("key", logger as never);
    const createComment = vi.fn().mockResolvedValue(undefined);
    injectSdk(client, { createComment });

    await client.postComment("issue-1", "Hello world");

    expect(createComment).toHaveBeenCalledWith({ issueId: "issue-1", body: "Hello world" });
    expect(logger.debug).toHaveBeenCalledWith({ issueId: "issue-1" }, "Posted comment to Linear issue");
  });
});

describe("RealLinearClient.updateIssueState", () => {
  it("warns and returns without updating when the issue has no team", async () => {
    const logger = makeLogger();
    const client = new RealLinearClient("key", logger as never);
    const updateIssue = vi.fn();
    const fake = makeFakeIssue({ id: "issue-1", team: Promise.resolve(null) });
    injectSdk(client, { issue: vi.fn().mockResolvedValue(fake), updateIssue });

    await client.updateIssueState("issue-1", "Done");

    expect(logger.warn).toHaveBeenCalledWith({ issueId: "issue-1" }, "Cannot update state: issue has no team");
    expect(updateIssue).not.toHaveBeenCalled();
  });

  it("warns and returns without updating when the state name cannot be resolved", async () => {
    const logger = makeLogger();
    const client = new RealLinearClient("key", logger as never);
    const updateIssue = vi.fn();
    const fake = makeFakeIssue({ id: "issue-1", team: Promise.resolve({ id: "team-1", key: "PRY" }) });
    const team = { id: "team-1", states: vi.fn().mockResolvedValue({ nodes: [] }) };
    injectSdk(client, {
      issue: vi.fn().mockResolvedValue(fake),
      team: vi.fn().mockResolvedValue(team),
      updateIssue,
    });

    await client.updateIssueState("issue-1", "Nonexistent State");

    expect(logger.warn).toHaveBeenCalledWith(
      { issueId: "issue-1", stateName: "Nonexistent State", teamId: "team-1" },
      "Could not find workflow state by name",
    );
    expect(updateIssue).not.toHaveBeenCalled();
  });

  it("resolves the state id and calls sdk.updateIssue on success", async () => {
    const logger = makeLogger();
    const client = new RealLinearClient("key", logger as never);
    const updateIssue = vi.fn().mockResolvedValue(undefined);
    const fake = makeFakeIssue({ id: "issue-1", team: Promise.resolve({ id: "team-1", key: "PRY" }) });
    const team = {
      id: "team-1",
      states: vi.fn().mockResolvedValue({ nodes: [{ id: "state-done", name: "Done" }] }),
    };
    injectSdk(client, {
      issue: vi.fn().mockResolvedValue(fake),
      team: vi.fn().mockResolvedValue(team),
      updateIssue,
    });

    await client.updateIssueState("issue-1", "Done");

    expect(updateIssue).toHaveBeenCalledWith("issue-1", { stateId: "state-done" });
    expect(logger.debug).toHaveBeenCalledWith(
      { issueId: "issue-1", stateName: "Done", stateId: "state-done" },
      "Updated Linear issue state",
    );
  });
});

describe("RealLinearClient.resolveStateId (via updateIssueState)", () => {
  it("caches the team's states so a second call does not re-fetch them", async () => {
    const client = new RealLinearClient("key", makeLogger() as never);
    const updateIssue = vi.fn().mockResolvedValue(undefined);
    const fake = makeFakeIssue({ id: "issue-1", team: Promise.resolve({ id: "team-1", key: "PRY" }) });
    const statesMock = vi.fn().mockResolvedValue({
      nodes: [
        { id: "state-todo", name: "Todo" },
        { id: "state-done", name: "Done" },
      ],
    });
    const team = { id: "team-1", states: statesMock };
    injectSdk(client, {
      issue: vi.fn().mockResolvedValue(fake),
      team: vi.fn().mockResolvedValue(team),
      updateIssue,
    });

    await client.updateIssueState("issue-1", "Todo");
    await client.updateIssueState("issue-1", "Done");

    expect(statesMock).toHaveBeenCalledTimes(1);
    expect(updateIssue).toHaveBeenNthCalledWith(1, "issue-1", { stateId: "state-todo" });
    expect(updateIssue).toHaveBeenNthCalledWith(2, "issue-1", { stateId: "state-done" });
  });
});

describe("RealLinearClient.addLabel", () => {
  it("adds a newly resolved label when it is not already on the issue", async () => {
    const client = new RealLinearClient("key", makeLogger() as never);
    const updateIssue = vi.fn().mockResolvedValue(undefined);
    const fake = makeFakeIssue({
      id: "issue-1",
      labelIds: ["existing-id"],
      team: Promise.resolve({ id: "team-1", key: "PRY" }),
    });
    injectSdk(client, {
      issue: vi.fn().mockResolvedValue(fake),
      issueLabels: vi.fn().mockResolvedValue({ nodes: [{ id: "label-bar", name: "bar" }] }),
      updateIssue,
    });

    await client.addLabel("issue-1", "bar");

    expect(updateIssue).toHaveBeenCalledWith("issue-1", { labelIds: ["existing-id", "label-bar"] });
  });

  it("does not call updateIssue when the resolved label is already present", async () => {
    const client = new RealLinearClient("key", makeLogger() as never);
    const updateIssue = vi.fn();
    const fake = makeFakeIssue({
      id: "issue-1",
      labelIds: ["label-bar"],
      team: Promise.resolve({ id: "team-1", key: "PRY" }),
    });
    injectSdk(client, {
      issue: vi.fn().mockResolvedValue(fake),
      issueLabels: vi.fn().mockResolvedValue({ nodes: [{ id: "label-bar", name: "bar" }] }),
      updateIssue,
    });

    await client.addLabel("issue-1", "bar");

    expect(updateIssue).not.toHaveBeenCalled();
  });

  it("creates the label via the SDK when it does not already exist, without a team", async () => {
    const client = new RealLinearClient("key", makeLogger() as never);
    const updateIssue = vi.fn().mockResolvedValue(undefined);
    const createIssueLabel = vi.fn().mockResolvedValue({ issueLabel: Promise.resolve({ id: "label-new" }) });
    const fake = makeFakeIssue({ id: "issue-1", labelIds: [], team: Promise.resolve(null) });
    injectSdk(client, {
      issue: vi.fn().mockResolvedValue(fake),
      issueLabels: vi.fn().mockResolvedValue({ nodes: [] }),
      createIssueLabel,
      updateIssue,
    });

    await client.addLabel("issue-1", "new-label");

    expect(createIssueLabel).toHaveBeenCalledWith({ name: "new-label" });
    expect(updateIssue).toHaveBeenCalledWith("issue-1", { labelIds: ["label-new"] });
  });

  it("passes teamId when creating a label for an issue that has a team", async () => {
    const client = new RealLinearClient("key", makeLogger() as never);
    const createIssueLabel = vi.fn().mockResolvedValue({ issueLabel: Promise.resolve({ id: "label-new" }) });
    const fake = makeFakeIssue({ id: "issue-1", labelIds: [], team: Promise.resolve({ id: "team-1", key: "PRY" }) });
    injectSdk(client, {
      issue: vi.fn().mockResolvedValue(fake),
      issueLabels: vi.fn().mockResolvedValue({ nodes: [] }),
      createIssueLabel,
      updateIssue: vi.fn().mockResolvedValue(undefined),
    });

    await client.addLabel("issue-1", "new-label");

    expect(createIssueLabel).toHaveBeenCalledWith({ name: "new-label", teamId: "team-1" });
  });

  it("reuses the label cache on a second addLabel call instead of querying the SDK again", async () => {
    const client = new RealLinearClient("key", makeLogger() as never);
    const issueLabels = vi.fn().mockResolvedValue({ nodes: [{ id: "label-bar", name: "bar" }] });
    const fake1 = makeFakeIssue({ id: "issue-1", labelIds: [], team: Promise.resolve({ id: "team-1", key: "PRY" }) });
    const fake2 = makeFakeIssue({ id: "issue-2", labelIds: [], team: Promise.resolve({ id: "team-1", key: "PRY" }) });
    injectSdk(client, {
      issue: vi.fn().mockResolvedValueOnce(fake1).mockResolvedValueOnce(fake2),
      issueLabels,
      updateIssue: vi.fn().mockResolvedValue(undefined),
    });

    await client.addLabel("issue-1", "bar");
    await client.addLabel("issue-2", "bar");

    expect(issueLabels).toHaveBeenCalledTimes(1);
  });

  it("throws when the SDK creates a label but returns no issueLabel", async () => {
    const client = new RealLinearClient("key", makeLogger() as never);
    const fake = makeFakeIssue({ id: "issue-1", labelIds: [], team: Promise.resolve(null) });
    injectSdk(client, {
      issue: vi.fn().mockResolvedValue(fake),
      issueLabels: vi.fn().mockResolvedValue({ nodes: [] }),
      createIssueLabel: vi.fn().mockResolvedValue({ issueLabel: Promise.resolve(null) }),
    });

    await expect(client.addLabel("issue-1", "broken-label")).rejects.toThrow(
      "Failed to create label: broken-label",
    );
  });
});

describe("RealLinearClient.removeLabel", () => {
  it("looks up the label via the SDK and removes it when uncached", async () => {
    const client = new RealLinearClient("key", makeLogger() as never);
    const updateIssue = vi.fn().mockResolvedValue(undefined);
    const fake = makeFakeIssue({
      id: "issue-1",
      labelIds: ["label-foo", "label-bar"],
      labels: () =>
        Promise.resolve({
          nodes: [
            { id: "label-foo", name: "foo" },
            { id: "label-bar", name: "bar" },
          ],
        }),
    });
    injectSdk(client, { issue: vi.fn().mockResolvedValue(fake), updateIssue });

    await client.removeLabel("issue-1", "foo");

    expect(updateIssue).toHaveBeenCalledWith("issue-1", { labelIds: ["label-bar"] });
  });

  it("is a no-op when the label is not found among the issue's labels", async () => {
    const client = new RealLinearClient("key", makeLogger() as never);
    const updateIssue = vi.fn();
    const fake = makeFakeIssue({
      id: "issue-1",
      labelIds: ["label-bar"],
      labels: () => Promise.resolve({ nodes: [{ id: "label-bar", name: "bar" }] }),
    });
    injectSdk(client, { issue: vi.fn().mockResolvedValue(fake), updateIssue });

    await client.removeLabel("issue-1", "missing-label");

    expect(updateIssue).not.toHaveBeenCalled();
  });

  it("uses the cached label id on a subsequent call instead of re-querying labels()", async () => {
    const client = new RealLinearClient("key", makeLogger() as never);
    const updateIssue = vi.fn().mockResolvedValue(undefined);
    const labelsFn = vi
      .fn()
      .mockResolvedValue({ nodes: [{ id: "label-foo", name: "foo" }] });
    const fake1 = makeFakeIssue({ id: "issue-1", labelIds: ["label-foo"], labels: labelsFn });
    const fake2 = makeFakeIssue({ id: "issue-2", labelIds: ["label-foo"], labels: labelsFn });
    injectSdk(client, {
      issue: vi.fn().mockResolvedValueOnce(fake1).mockResolvedValueOnce(fake2),
      updateIssue,
    });

    await client.removeLabel("issue-1", "foo");
    await client.removeLabel("issue-2", "foo");

    expect(labelsFn).toHaveBeenCalledTimes(1);
    expect(updateIssue).toHaveBeenNthCalledWith(2, "issue-2", { labelIds: [] });
  });
});

describe("RealLinearClient.listLabels", () => {
  it("returns label names and populates the label cache", async () => {
    const client = new RealLinearClient("key", makeLogger() as never);
    const fake = makeFakeIssue({
      id: "issue-1",
      labels: () =>
        Promise.resolve({
          nodes: [
            { id: "label-foo", name: "foo" },
            { id: "label-bar", name: "bar" },
          ],
        }),
    });
    injectSdk(client, { issue: vi.fn().mockResolvedValue(fake) });

    const labels = await client.listLabels("issue-1");

    expect(labels).toEqual(["foo", "bar"]);

    // Prove the cache was populated: removeLabel now skips the labels() lookup entirely.
    const updateIssue = vi.fn().mockResolvedValue(undefined);
    const secondFake = makeFakeIssue({ id: "issue-1", labelIds: ["label-foo", "label-bar"] });
    injectSdk(client, { issue: vi.fn().mockResolvedValue(secondFake), updateIssue });

    await client.removeLabel("issue-1", "foo");
    expect(updateIssue).toHaveBeenCalledWith("issue-1", { labelIds: ["label-bar"] });
  });

  it("returns an empty array when the issue has no labels", async () => {
    const client = new RealLinearClient("key", makeLogger() as never);
    const fake = makeFakeIssue({ id: "issue-1", labels: () => Promise.resolve({ nodes: [] }) });
    injectSdk(client, { issue: vi.fn().mockResolvedValue(fake) });

    const labels = await client.listLabels("issue-1");

    expect(labels).toEqual([]);
  });
});

describe("RealLinearClient constructor", () => {
  it("stores the logger for later use", async () => {
    const logger = makeLogger();
    const client = new RealLinearClient("test-api-key", logger as never);
    const createComment = vi.fn().mockResolvedValue(undefined);
    injectSdk(client, { createComment });

    await client.postComment("issue-1", "hi");

    expect(logger.debug).toHaveBeenCalled();
  });
});
