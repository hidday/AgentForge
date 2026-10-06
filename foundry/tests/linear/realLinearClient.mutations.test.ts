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
  project: Promise<{ name: string } | null>;
  cycle: Promise<{ name: string } | null>;
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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type FakeSdk = Record<string, any>;

function buildClient(sdk: FakeSdk) {
  const logger = makeLogger();
  const client = new RealLinearClient("test-key", logger as never);
  (client as unknown as { sdk: FakeSdk }).sdk = sdk;
  return { client, logger };
}

describe("RealLinearClient.getIssue", () => {
  it("maps a fully-populated SDK issue into a LinearIssue", async () => {
    const issue = {
      id: "issue-1",
      identifier: "PRY-1",
      title: "Fix bug",
      description: "Full description",
      branchName: "ai/issue-1",
      priority: 2,
      url: "https://linear.app/team/issue/PRY-1",
      labels: () => Promise.resolve({ nodes: [{ id: "l1", name: "bug" }] }),
      state: Promise.resolve({ id: "s1", name: "In Progress" }),
      project: Promise.resolve({ name: "Core" }),
      cycle: Promise.resolve({ name: "Cycle 4" }),
      team: Promise.resolve({ id: "team-1", key: "PRY" }),
    };
    const { client } = buildClient({ issue: vi.fn().mockResolvedValue(issue) });

    const result = await client.getIssue("issue-1");

    expect(result).toEqual({
      id: "issue-1",
      identifier: "PRY-1",
      title: "Fix bug",
      description: "Full description",
      branchName: "ai/issue-1",
      state: "In Progress",
      labels: ["bug"],
      priority: 2,
      url: "https://linear.app/team/issue/PRY-1",
      project: "Core",
      team: "PRY",
      cycle: "Cycle 4",
    });
  });

  it("defaults missing description, state, project, cycle, team and labels", async () => {
    const issue = {
      id: "issue-1",
      identifier: "PRY-1",
      title: "Fix bug",
      description: null,
      branchName: "ai/issue-1",
      priority: 0,
      url: "https://linear.app/team/issue/PRY-1",
      labels: () => Promise.resolve({ nodes: [] }),
      state: Promise.resolve(null),
      project: Promise.resolve(null),
      cycle: Promise.resolve(null),
      team: Promise.resolve(null),
    };
    const { client } = buildClient({ issue: vi.fn().mockResolvedValue(issue) });

    const result = await client.getIssue("issue-1");

    expect(result.description).toBe("");
    expect(result.state).toBe("Unknown");
    expect(result.project).toBeUndefined();
    expect(result.cycle).toBeUndefined();
    expect(result.team).toBeUndefined();
    expect(result.labels).toEqual([]);
  });

  it("defaults labels to an empty array when the labels connection has no nodes field", async () => {
    const issue = {
      id: "issue-1",
      identifier: "PRY-1",
      title: "Fix bug",
      description: "desc",
      branchName: "ai/issue-1",
      priority: 0,
      url: "https://linear.app/team/issue/PRY-1",
      labels: () => Promise.resolve(undefined),
      state: Promise.resolve({ id: "s1", name: "Todo" }),
      project: Promise.resolve(null),
      cycle: Promise.resolve(null),
      team: Promise.resolve(null),
    };
    const { client } = buildClient({ issue: vi.fn().mockResolvedValue(issue) });

    const result = await client.getIssue("issue-1");

    expect(result.labels).toEqual([]);
  });
});

describe("RealLinearClient.searchIssues", () => {
  it("builds a state-only filter and maps results when no optional filters are given", async () => {
    const issue = makeFakeIssue({
      id: "i1",
      identifier: "PRY-10",
      project: Promise.resolve({ name: "Core" }),
      cycle: Promise.resolve({ name: "Cycle 3" }),
      labels: () => Promise.resolve({ nodes: [{ id: "l1", name: "bug" }] }),
    });
    const issuesFn = vi.fn().mockResolvedValue({ nodes: [issue] });
    const { client, logger } = buildClient({ issues: issuesFn });

    const results = await client.searchIssues({ state: "Todo" });

    expect(issuesFn).toHaveBeenCalledWith({ filter: { state: { name: { eq: "Todo" } } } });
    expect(results).toEqual([
      {
        id: "i1",
        identifier: "PRY-10",
        title: "Issue title",
        description: "Issue description",
        branchName: "ai/issue-1",
        state: "Todo",
        labels: ["bug"],
        priority: 0,
        url: "https://linear.app/team/issue/PRY-1",
        project: "Core",
        team: "PRY",
        cycle: "Cycle 3",
      },
    ]);
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ stateName: "Todo", count: 1 }),
      "Searched Linear issues",
    );
  });

  it("adds project, assignee and team clauses when those filters are provided", async () => {
    const issuesFn = vi.fn().mockResolvedValue({ nodes: [] });
    const { client } = buildClient({ issues: issuesFn });

    await client.searchIssues({
      state: "Todo",
      projectName: "Core",
      assigneeMe: true,
      team: "PRY",
    });

    expect(issuesFn).toHaveBeenCalledWith({
      filter: {
        state: { name: { eq: "Todo" } },
        project: { name: { eq: "Core" } },
        assignee: { isMe: { eq: true } },
        team: { or: [{ name: { eq: "PRY" } }, { key: { eq: "PRY" } }] },
      },
    });
  });

  it("treats a missing issues connection as an empty result set", async () => {
    const issuesFn = vi.fn().mockResolvedValue(undefined);
    const { client } = buildClient({ issues: issuesFn });

    const results = await client.searchIssues({ state: "Todo" });

    expect(results).toEqual([]);
  });

  it("defaults missing project/cycle/team/labels to undefined/empty", async () => {
    const issue = makeFakeIssue({ id: "i1", team: Promise.resolve(null) });
    const issuesFn = vi.fn().mockResolvedValue({ nodes: [issue] });
    const { client } = buildClient({ issues: issuesFn });

    const [result] = await client.searchIssues({ state: "Todo" });

    expect(result.project).toBeUndefined();
    expect(result.cycle).toBeUndefined();
    expect(result.team).toBeUndefined();
    expect(result.labels).toEqual([]);
  });

  it("treats a missing labels connection and null description as empty defaults", async () => {
    const issue = makeFakeIssue({
      id: "i1",
      description: null,
      labels: (() => Promise.resolve({})) as unknown as FakeIssue["labels"],
    });
    const issuesFn = vi.fn().mockResolvedValue({ nodes: [issue] });
    const { client } = buildClient({ issues: issuesFn });

    const [result] = await client.searchIssues({ state: "Todo" });

    expect(result.labels).toEqual([]);
    expect(result.description).toBe("");
  });
});

describe("RealLinearClient.postComment", () => {
  it("creates a comment via the SDK with the given issueId and body", async () => {
    const createComment = vi.fn().mockResolvedValue(undefined);
    const { client, logger } = buildClient({ createComment });

    await client.postComment("issue-1", "Hello world");

    expect(createComment).toHaveBeenCalledWith({ issueId: "issue-1", body: "Hello world" });
    expect(logger.debug).toHaveBeenCalledWith(
      { issueId: "issue-1" },
      "Posted comment to Linear issue",
    );
  });
});

describe("RealLinearClient.updateIssueState", () => {
  it("warns and does not call updateIssue when the issue has no team", async () => {
    const issue = makeFakeIssue({ id: "issue-1", team: Promise.resolve(null) });
    const updateIssue = vi.fn();
    const { client, logger } = buildClient({
      issue: vi.fn().mockResolvedValue(issue),
      updateIssue,
    });

    await client.updateIssueState("issue-1", "Done");

    expect(updateIssue).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(
      { issueId: "issue-1" },
      "Cannot update state: issue has no team",
    );
  });

  it("warns and does not call updateIssue when the state name is not found", async () => {
    const issue = makeFakeIssue({ id: "issue-1" });
    const team = vi.fn().mockResolvedValue({
      id: "team-1",
      states: () => Promise.resolve({ nodes: [{ id: "s1", name: "Todo" }] }),
    });
    const updateIssue = vi.fn();
    const { client, logger } = buildClient({
      issue: vi.fn().mockResolvedValue(issue),
      team,
      updateIssue,
    });

    await client.updateIssueState("issue-1", "NonexistentState");

    expect(updateIssue).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(
      { issueId: "issue-1", stateName: "NonexistentState", teamId: "team-1" },
      "Could not find workflow state by name",
    );
  });

  it("resolves the state id and calls updateIssue on success", async () => {
    const issue = makeFakeIssue({ id: "issue-1" });
    const team = vi.fn().mockResolvedValue({
      id: "team-1",
      states: () => Promise.resolve({ nodes: [{ id: "s-done", name: "Done" }] }),
    });
    const updateIssue = vi.fn().mockResolvedValue(undefined);
    const { client, logger } = buildClient({
      issue: vi.fn().mockResolvedValue(issue),
      team,
      updateIssue,
    });

    await client.updateIssueState("issue-1", "Done");

    expect(updateIssue).toHaveBeenCalledWith("issue-1", { stateId: "s-done" });
    expect(logger.debug).toHaveBeenCalledWith(
      { issueId: "issue-1", stateName: "Done", stateId: "s-done" },
      "Updated Linear issue state",
    );
  });

  it("caches the resolved state map across calls for the same team", async () => {
    const issue1 = makeFakeIssue({ id: "issue-1" });
    const issue2 = makeFakeIssue({ id: "issue-2" });
    const statesFn = vi.fn().mockResolvedValue({ nodes: [{ id: "s-done", name: "Done" }] });
    const teamFn = vi.fn().mockResolvedValue({ id: "team-1", states: statesFn });
    const issueFn = vi.fn((id: string) =>
      Promise.resolve(id === "issue-1" ? issue1 : issue2),
    );
    const updateIssue = vi.fn().mockResolvedValue(undefined);
    const { client } = buildClient({ issue: issueFn, team: teamFn, updateIssue });

    await client.updateIssueState("issue-1", "Done");
    await client.updateIssueState("issue-2", "Done");

    expect(teamFn).toHaveBeenCalledTimes(1);
    expect(statesFn).toHaveBeenCalledTimes(1);
    expect(updateIssue).toHaveBeenCalledTimes(2);
  });
});

describe("RealLinearClient.addLabel", () => {
  it("creates a new label via the SDK when none exists and adds it to the issue", async () => {
    const issue = makeFakeIssue({ id: "issue-1", labelIds: ["existing-id"] });
    const issueLabels = vi.fn().mockResolvedValue({ nodes: [] });
    const createIssueLabel = vi.fn().mockResolvedValue({
      issueLabel: Promise.resolve({ id: "new-label-id" }),
    });
    const updateIssue = vi.fn().mockResolvedValue(undefined);
    const { client, logger } = buildClient({
      issue: vi.fn().mockResolvedValue(issue),
      issueLabels,
      createIssueLabel,
      updateIssue,
    });

    await client.addLabel("issue-1", "urgent");

    expect(issueLabels).toHaveBeenCalledWith({ filter: { name: { eq: "urgent" } } });
    expect(createIssueLabel).toHaveBeenCalledWith({ name: "urgent", teamId: "team-1" });
    expect(updateIssue).toHaveBeenCalledWith("issue-1", {
      labelIds: ["existing-id", "new-label-id"],
    });
    expect(logger.info).toHaveBeenCalledWith(
      { labelName: "urgent", labelId: "new-label-id" },
      "Created new Linear label",
    );
  });

  it("creates a label without a teamId when the issue has no team", async () => {
    const issue = makeFakeIssue({ id: "issue-1", team: Promise.resolve(null) });
    const issueLabels = vi.fn().mockResolvedValue({ nodes: [] });
    const createIssueLabel = vi.fn().mockResolvedValue({
      issueLabel: Promise.resolve({ id: "new-label-id" }),
    });
    const { client } = buildClient({
      issue: vi.fn().mockResolvedValue(issue),
      issueLabels,
      createIssueLabel,
      updateIssue: vi.fn().mockResolvedValue(undefined),
    });

    await client.addLabel("issue-1", "urgent");

    expect(createIssueLabel).toHaveBeenCalledWith({ name: "urgent" });
  });

  it("reuses an existing label found via issueLabels instead of creating one", async () => {
    const issue = makeFakeIssue({ id: "issue-1", labelIds: [] });
    const issueLabels = vi.fn().mockResolvedValue({ nodes: [{ id: "existing-label", name: "urgent" }] });
    const createIssueLabel = vi.fn();
    const updateIssue = vi.fn().mockResolvedValue(undefined);
    const { client } = buildClient({
      issue: vi.fn().mockResolvedValue(issue),
      issueLabels,
      createIssueLabel,
      updateIssue,
    });

    await client.addLabel("issue-1", "urgent");

    expect(createIssueLabel).not.toHaveBeenCalled();
    expect(updateIssue).toHaveBeenCalledWith("issue-1", { labelIds: ["existing-label"] });
  });

  it("does not call updateIssue when the issue already has the label", async () => {
    const issue = makeFakeIssue({ id: "issue-1", labelIds: ["existing-label"] });
    const issueLabels = vi.fn().mockResolvedValue({ nodes: [{ id: "existing-label", name: "urgent" }] });
    const updateIssue = vi.fn();
    const { client } = buildClient({
      issue: vi.fn().mockResolvedValue(issue),
      issueLabels,
      updateIssue,
    });

    await client.addLabel("issue-1", "urgent");

    expect(updateIssue).not.toHaveBeenCalled();
  });

  it("uses the label cache on a second call instead of querying issueLabels again", async () => {
    const issue1 = makeFakeIssue({ id: "issue-1", labelIds: [] });
    const issue2 = makeFakeIssue({ id: "issue-2", labelIds: [] });
    const issueLabels = vi.fn().mockResolvedValue({ nodes: [{ id: "label-id", name: "urgent" }] });
    const issueFn = vi.fn((id: string) =>
      Promise.resolve(id === "issue-1" ? issue1 : issue2),
    );
    const updateIssue = vi.fn().mockResolvedValue(undefined);
    const { client } = buildClient({ issue: issueFn, issueLabels, updateIssue });

    await client.addLabel("issue-1", "urgent");
    await client.addLabel("issue-2", "urgent");

    expect(issueLabels).toHaveBeenCalledTimes(1);
    expect(updateIssue).toHaveBeenCalledTimes(2);
  });

  it("throws when label creation does not return an issueLabel", async () => {
    const issue = makeFakeIssue({ id: "issue-1" });
    const issueLabels = vi.fn().mockResolvedValue({ nodes: [] });
    const createIssueLabel = vi.fn().mockResolvedValue({ issueLabel: Promise.resolve(undefined) });
    const { client } = buildClient({
      issue: vi.fn().mockResolvedValue(issue),
      issueLabels,
      createIssueLabel,
    });

    await expect(client.addLabel("issue-1", "urgent")).rejects.toThrow(
      "Failed to create label: urgent",
    );
  });
});

describe("RealLinearClient.removeLabel", () => {
  it("removes a label looked up via issue.labels() when not cached, and caches it", async () => {
    const issue = makeFakeIssue({
      id: "issue-1",
      labelIds: ["label-id", "other-id"],
      labels: () => Promise.resolve({ nodes: [{ id: "label-id", name: "urgent" }] }),
    });
    const updateIssue = vi.fn().mockResolvedValue(undefined);
    const { client, logger } = buildClient({
      issue: vi.fn().mockResolvedValue(issue),
      updateIssue,
    });

    await client.removeLabel("issue-1", "urgent");

    expect(updateIssue).toHaveBeenCalledWith("issue-1", { labelIds: ["other-id"] });
    expect(logger.debug).toHaveBeenCalledWith(
      { issueId: "issue-1", labelName: "urgent" },
      "Removed label from Linear issue",
    );
  });

  it("returns without updating when the label is not found on the issue", async () => {
    const issue = makeFakeIssue({
      id: "issue-1",
      labels: () => Promise.resolve({ nodes: [{ id: "other-id", name: "other" }] }),
    });
    const updateIssue = vi.fn();
    const { client } = buildClient({
      issue: vi.fn().mockResolvedValue(issue),
      updateIssue,
    });

    await client.removeLabel("issue-1", "urgent");

    expect(updateIssue).not.toHaveBeenCalled();
  });

  it("uses the cached labelId on a subsequent call instead of calling issue.labels() again", async () => {
    const labelsFn = vi
      .fn()
      .mockResolvedValue({ nodes: [{ id: "label-id", name: "urgent" }] });
    const issue1 = makeFakeIssue({
      id: "issue-1",
      labelIds: ["label-id"],
      labels: labelsFn,
    });
    const issue2 = makeFakeIssue({
      id: "issue-2",
      labelIds: ["label-id", "keep-id"],
      labels: labelsFn,
    });
    const issueFn = vi.fn((id: string) =>
      Promise.resolve(id === "issue-1" ? issue1 : issue2),
    );
    const updateIssue = vi.fn().mockResolvedValue(undefined);
    const { client } = buildClient({ issue: issueFn, updateIssue });

    await client.removeLabel("issue-1", "urgent");
    await client.removeLabel("issue-2", "urgent");

    expect(labelsFn).toHaveBeenCalledTimes(1);
    expect(updateIssue).toHaveBeenNthCalledWith(2, "issue-2", { labelIds: ["keep-id"] });
  });
});

describe("RealLinearClient.listLabels", () => {
  it("returns label names and populates the label cache for later removeLabel calls", async () => {
    const issue1 = makeFakeIssue({
      id: "issue-1",
      labels: () =>
        Promise.resolve({
          nodes: [
            { id: "l1", name: "urgent" },
            { id: "l2", name: "bug" },
          ],
        }),
    });
    const issue2 = makeFakeIssue({ id: "issue-2", labelIds: ["l1"] });
    const labelsFnIssue2 = vi.fn();
    issue2.labels = labelsFnIssue2;
    const issueFn = vi.fn((id: string) =>
      Promise.resolve(id === "issue-1" ? issue1 : issue2),
    );
    const updateIssue = vi.fn().mockResolvedValue(undefined);
    const { client } = buildClient({ issue: issueFn, updateIssue });

    const names = await client.listLabels("issue-1");
    expect(names).toEqual(["urgent", "bug"]);

    // removeLabel on a different issue should now hit the label cache
    // populated by listLabels, rather than calling issue.labels() again.
    await client.removeLabel("issue-2", "urgent");

    expect(labelsFnIssue2).not.toHaveBeenCalled();
    expect(updateIssue).toHaveBeenCalledWith("issue-2", { labelIds: [] });
  });

  it("returns an empty array when the labels connection has no nodes", async () => {
    const issue = makeFakeIssue({ id: "issue-1", labels: () => Promise.resolve({ nodes: [] }) });
    const { client } = buildClient({ issue: vi.fn().mockResolvedValue(issue) });

    const names = await client.listLabels("issue-1");

    expect(names).toEqual([]);
  });

  it("returns an empty array and caches nothing when the labels connection itself is missing nodes", async () => {
    const issue = makeFakeIssue({
      id: "issue-1",
      labels: (() => Promise.resolve({})) as unknown as FakeIssue["labels"],
    });
    const { client } = buildClient({ issue: vi.fn().mockResolvedValue(issue) });

    const names = await client.listLabels("issue-1");

    expect(names).toEqual([]);
  });
});

describe("RealLinearClient resolveStateId via updateIssueState", () => {
  it("treats a missing states connection nodes field as no known states", async () => {
    const issue = makeFakeIssue({ id: "issue-1" });
    const team = vi.fn().mockResolvedValue({
      id: "team-1",
      states: () => Promise.resolve({}),
    });
    const updateIssue = vi.fn();
    const { client, logger } = buildClient({
      issue: vi.fn().mockResolvedValue(issue),
      team,
      updateIssue,
    });

    await client.updateIssueState("issue-1", "Done");

    expect(updateIssue).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(
      { issueId: "issue-1", stateName: "Done", teamId: "team-1" },
      "Could not find workflow state by name",
    );
  });
});
