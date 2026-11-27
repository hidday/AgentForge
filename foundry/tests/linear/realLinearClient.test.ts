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
  state: Promise<{ id: string; name: string } | null>;
  project: Promise<{ name: string } | null>;
  cycle: Promise<{ name: string } | null>;
  team: Promise<{ id: string; key: string } | null>;
  labels: () => Promise<{ nodes: Array<{ id: string; name: string }> }>;
}

function makeFakeIssue(overrides: Partial<FakeIssue> & { id: string }): FakeIssue {
  return {
    identifier: "ENG-1",
    title: "Issue title",
    description: "Issue description",
    branchName: "ai/issue-1",
    priority: 1,
    url: "https://linear.app/team/issue/ENG-1",
    labelIds: [],
    state: Promise.resolve({ id: "state-1", name: "Todo" }),
    project: Promise.resolve(null),
    cycle: Promise.resolve(null),
    team: Promise.resolve({ id: "team-1", key: "ENG" }),
    labels: () => Promise.resolve({ nodes: [] }),
    ...overrides,
  };
}

function installFakeSdk(client: RealLinearClient, sdk: Record<string, unknown>) {
  (client as unknown as { sdk: Record<string, unknown> }).sdk = sdk;
}

describe("RealLinearClient.getIssue", () => {
  it("maps all fields, including project/cycle/team, when present", async () => {
    const logger = makeLogger();
    const client = new RealLinearClient("key", logger as never);
    const issue = makeFakeIssue({
      id: "issue-1",
      project: Promise.resolve({ name: "Project X" }),
      cycle: Promise.resolve({ name: "Cycle 3" }),
      team: Promise.resolve({ id: "team-1", key: "ENG" }),
      labels: () => Promise.resolve({ nodes: [{ id: "l1", name: "bug" }] }),
    });
    installFakeSdk(client, { issue: vi.fn().mockResolvedValue(issue) });

    const result = await client.getIssue("issue-1");

    expect(result).toEqual({
      id: "issue-1",
      identifier: "ENG-1",
      title: "Issue title",
      description: "Issue description",
      branchName: "ai/issue-1",
      state: "Todo",
      labels: ["bug"],
      priority: 1,
      url: "https://linear.app/team/issue/ENG-1",
      project: "Project X",
      team: "ENG",
      cycle: "Cycle 3",
    });
  });

  it("falls back to defaults when description/state/project/cycle/team/labels are absent", async () => {
    const logger = makeLogger();
    const client = new RealLinearClient("key", logger as never);
    const issue = makeFakeIssue({
      id: "issue-2",
      description: null,
      state: Promise.resolve(null),
      project: Promise.resolve(null),
      cycle: Promise.resolve(null),
      team: Promise.resolve(null),
      labels: () => Promise.resolve({ nodes: [] }),
    });
    installFakeSdk(client, { issue: vi.fn().mockResolvedValue(issue) });

    const result = await client.getIssue("issue-2");

    expect(result.description).toBe("");
    expect(result.state).toBe("Unknown");
    expect(result.project).toBeUndefined();
    expect(result.cycle).toBeUndefined();
    expect(result.team).toBeUndefined();
    expect(result.labels).toEqual([]);
  });

  it("falls back to an empty labels array when the labels connection has no nodes field", async () => {
    const logger = makeLogger();
    const client = new RealLinearClient("key", logger as never);
    const issue = makeFakeIssue({
      id: "issue-3",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      labels: () => Promise.resolve({} as any),
    });
    installFakeSdk(client, { issue: vi.fn().mockResolvedValue(issue) });

    const result = await client.getIssue("issue-3");

    expect(result.labels).toEqual([]);
  });
});

describe("RealLinearClient.getRelatedContext error handling", () => {
  it("logs a warning and drops a blocker relation whose issue fails to hydrate", async () => {
    const logger = makeLogger();
    const client = new RealLinearClient("key", logger as never);
    const goodBlocker = makeFakeIssue({ id: "good-blocker", identifier: "ENG-2" }) as never;
    const hydrateError = new Error("Linear API error");
    const focus = {
      ...makeFakeIssue({ id: "focus-id" }),
      parent: Promise.resolve(null),
      inverseRelations: () =>
        Promise.resolve({
          nodes: [
            { id: "rel-bad", type: "blocks", issue: Promise.reject(hydrateError) },
            { id: "rel-good", type: "blocks", issue: Promise.resolve(goodBlocker) },
          ],
        }),
    };
    installFakeSdk(client, { issue: vi.fn().mockResolvedValue(focus) });

    const ctx = await client.getRelatedContext("focus-id");

    expect(ctx.blockers).toHaveLength(1);
    expect(ctx.blockers[0].id).toBe("good-blocker");
    expect(logger.warn).toHaveBeenCalledWith(
      { err: hydrateError, relationId: "rel-bad", focusIssueId: "focus-id" },
      "Failed to hydrate blocker issue from relation",
    );
  });

  it("treats a missing nodes field on inverseRelations as no blockers", async () => {
    const logger = makeLogger();
    const client = new RealLinearClient("key", logger as never);
    const focus = {
      ...makeFakeIssue({ id: "focus-id" }),
      parent: Promise.resolve(null),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      inverseRelations: () => Promise.resolve({} as any),
    };
    installFakeSdk(client, { issue: vi.fn().mockResolvedValue(focus) });

    const ctx = await client.getRelatedContext("focus-id");

    expect(ctx.blockers).toEqual([]);
  });

  it("falls back to an empty labels array and 'Unknown' state for a related issue missing both", async () => {
    const logger = makeLogger();
    const client = new RealLinearClient("key", logger as never);
    const parent = makeFakeIssue({
      id: "parent-id",
      state: Promise.resolve(null),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      labels: () => Promise.resolve({} as any),
    });
    const focus = {
      ...makeFakeIssue({ id: "focus-id" }),
      parent: Promise.resolve(parent),
      inverseRelations: () => Promise.resolve({ nodes: [] }),
    };
    installFakeSdk(client, {
      issue: vi.fn().mockImplementation((id: string) =>
        Promise.resolve(id === "focus-id" ? focus : parent),
      ),
    });

    const ctx = await client.getRelatedContext("focus-id");

    expect(ctx.parent?.labels).toEqual([]);
    expect(ctx.parent?.state).toBe("Unknown");
  });
});

describe("RealLinearClient.searchIssues", () => {
  it("builds a GraphQL filter from projectName/assigneeMe/team and maps results", async () => {
    const logger = makeLogger();
    const client = new RealLinearClient("key", logger as never);
    const node = makeFakeIssue({
      id: "issue-1",
      project: Promise.resolve({ name: "Project X" }),
      cycle: Promise.resolve({ name: "Cycle 1" }),
      team: Promise.resolve({ id: "team-1", key: "ENG" }),
      labels: () => Promise.resolve({ nodes: [{ id: "l1", name: "bug" }] }),
    });
    const issuesFn = vi.fn().mockResolvedValue({ nodes: [node] });
    installFakeSdk(client, { issues: issuesFn });

    const results = await client.searchIssues({
      state: "Todo",
      projectName: "Project X",
      assigneeMe: true,
      team: "ENG",
    });

    expect(issuesFn).toHaveBeenCalledWith({
      filter: {
        state: { name: { eq: "Todo" } },
        project: { name: { eq: "Project X" } },
        assignee: { isMe: { eq: true } },
        team: { or: [{ name: { eq: "ENG" } }, { key: { eq: "ENG" } }] },
      },
    });
    expect(results).toEqual([
      {
        id: "issue-1",
        identifier: "ENG-1",
        title: "Issue title",
        description: "Issue description",
        branchName: "ai/issue-1",
        state: "Todo",
        labels: ["bug"],
        priority: 1,
        url: "https://linear.app/team/issue/ENG-1",
        project: "Project X",
        team: "ENG",
        cycle: "Cycle 1",
      },
    ]);
    expect(logger.info).toHaveBeenCalledWith(
      { projectName: "Project X", assigneeMe: true, team: "ENG", stateName: "Todo", count: 1 },
      "Searched Linear issues",
    );
  });

  it("builds a minimal filter when only state is provided and handles no results", async () => {
    const logger = makeLogger();
    const client = new RealLinearClient("key", logger as never);
    const issuesFn = vi.fn().mockResolvedValue({ nodes: [] });
    installFakeSdk(client, { issues: issuesFn });

    const results = await client.searchIssues({ state: "Done" });

    expect(issuesFn).toHaveBeenCalledWith({ filter: { state: { name: { eq: "Done" } } } });
    expect(results).toEqual([]);
  });

  it("handles an undefined nodes array from the SDK", async () => {
    const logger = makeLogger();
    const client = new RealLinearClient("key", logger as never);
    const issuesFn = vi.fn().mockResolvedValue({});
    installFakeSdk(client, { issues: issuesFn });

    const results = await client.searchIssues({ state: "Done" });

    expect(results).toEqual([]);
  });

  it("falls back to defaults when description/project/cycle/team/labels are absent on a result node", async () => {
    const logger = makeLogger();
    const client = new RealLinearClient("key", logger as never);
    const node = makeFakeIssue({
      id: "issue-1",
      description: null,
      project: Promise.resolve(null),
      cycle: Promise.resolve(null),
      team: Promise.resolve(null),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      labels: () => Promise.resolve({} as any),
    });
    installFakeSdk(client, { issues: vi.fn().mockResolvedValue({ nodes: [node] }) });

    const [result] = await client.searchIssues({ state: "Todo" });

    expect(result.description).toBe("");
    expect(result.labels).toEqual([]);
    expect(result.project).toBeUndefined();
    expect(result.cycle).toBeUndefined();
    expect(result.team).toBeUndefined();
  });
});

describe("RealLinearClient.postComment", () => {
  it("creates a comment via the SDK", async () => {
    const logger = makeLogger();
    const client = new RealLinearClient("key", logger as never);
    const createComment = vi.fn().mockResolvedValue(undefined);
    installFakeSdk(client, { createComment });

    await client.postComment("issue-1", "Nice work");

    expect(createComment).toHaveBeenCalledWith({ issueId: "issue-1", body: "Nice work" });
    expect(logger.debug).toHaveBeenCalledWith({ issueId: "issue-1" }, "Posted comment to Linear issue");
  });
});

describe("RealLinearClient.updateIssueState", () => {
  it("logs a warning and returns early when the issue has no team", async () => {
    const logger = makeLogger();
    const client = new RealLinearClient("key", logger as never);
    const issue = makeFakeIssue({ id: "issue-1", team: Promise.resolve(null) });
    const updateIssue = vi.fn();
    installFakeSdk(client, { issue: vi.fn().mockResolvedValue(issue), updateIssue });

    await client.updateIssueState("issue-1", "Done");

    expect(updateIssue).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(
      { issueId: "issue-1" },
      "Cannot update state: issue has no team",
    );
  });

  it("logs a warning and returns early when the state name cannot be resolved", async () => {
    const logger = makeLogger();
    const client = new RealLinearClient("key", logger as never);
    const issue = makeFakeIssue({ id: "issue-1", team: Promise.resolve({ id: "team-1", key: "ENG" }) });
    const team = { states: vi.fn().mockResolvedValue({ nodes: [{ id: "s1", name: "Todo" }] }) };
    const updateIssue = vi.fn();
    installFakeSdk(client, {
      issue: vi.fn().mockResolvedValue(issue),
      team: vi.fn().mockResolvedValue(team),
      updateIssue,
    });

    await client.updateIssueState("issue-1", "Nonexistent State");

    expect(updateIssue).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(
      { issueId: "issue-1", stateName: "Nonexistent State", teamId: "team-1" },
      "Could not find workflow state by name",
    );
  });

  it("updates the issue's state when the state name resolves", async () => {
    const logger = makeLogger();
    const client = new RealLinearClient("key", logger as never);
    const issue = makeFakeIssue({ id: "issue-1", team: Promise.resolve({ id: "team-1", key: "ENG" }) });
    const statesFn = vi.fn().mockResolvedValue({ nodes: [{ id: "s1", name: "Done" }] });
    const team = { states: statesFn };
    const updateIssue = vi.fn().mockResolvedValue(undefined);
    const teamFn = vi.fn().mockResolvedValue(team);
    installFakeSdk(client, {
      issue: vi.fn().mockResolvedValue(issue),
      team: teamFn,
      updateIssue,
    });

    await client.updateIssueState("issue-1", "Done");

    expect(updateIssue).toHaveBeenCalledWith("issue-1", { stateId: "s1" });
  });

  it("caches resolved states per team so a second call does not re-fetch", async () => {
    const logger = makeLogger();
    const client = new RealLinearClient("key", logger as never);
    const issue = makeFakeIssue({ id: "issue-1", team: Promise.resolve({ id: "team-1", key: "ENG" }) });
    const statesFn = vi.fn().mockResolvedValue({ nodes: [{ id: "s1", name: "Done" }] });
    const teamFn = vi.fn().mockResolvedValue({ states: statesFn });
    const updateIssue = vi.fn().mockResolvedValue(undefined);
    installFakeSdk(client, {
      issue: vi.fn().mockResolvedValue(issue),
      team: teamFn,
      updateIssue,
    });

    await client.updateIssueState("issue-1", "Done");
    await client.updateIssueState("issue-1", "Done");

    expect(teamFn).toHaveBeenCalledTimes(1);
  });

  it("handles an undefined states nodes array from the SDK", async () => {
    const logger = makeLogger();
    const client = new RealLinearClient("key", logger as never);
    const issue = makeFakeIssue({ id: "issue-1", team: Promise.resolve({ id: "team-1", key: "ENG" }) });
    const teamFn = vi.fn().mockResolvedValue({ states: vi.fn().mockResolvedValue({}) });
    const updateIssue = vi.fn();
    installFakeSdk(client, {
      issue: vi.fn().mockResolvedValue(issue),
      team: teamFn,
      updateIssue,
    });

    await client.updateIssueState("issue-1", "Done");

    expect(updateIssue).not.toHaveBeenCalled();
  });
});

describe("RealLinearClient.addLabel", () => {
  it("creates a new label when none exists and adds it to the issue", async () => {
    const logger = makeLogger();
    const client = new RealLinearClient("key", logger as never);
    const issue = makeFakeIssue({
      id: "issue-1",
      labelIds: [],
      team: Promise.resolve({ id: "team-1", key: "ENG" }),
    });
    const issueLabels = vi.fn().mockResolvedValue({ nodes: [] });
    const createIssueLabel = vi.fn().mockResolvedValue({
      issueLabel: Promise.resolve({ id: "new-label-id" }),
    });
    const updateIssue = vi.fn().mockResolvedValue(undefined);
    installFakeSdk(client, {
      issue: vi.fn().mockResolvedValue(issue),
      issueLabels,
      createIssueLabel,
      updateIssue,
    });

    await client.addLabel("issue-1", "bug");

    expect(createIssueLabel).toHaveBeenCalledWith({ name: "bug", teamId: "team-1" });
    expect(updateIssue).toHaveBeenCalledWith("issue-1", { labelIds: ["new-label-id"] });
  });

  it("reuses an existing label found via issueLabels instead of creating one", async () => {
    const logger = makeLogger();
    const client = new RealLinearClient("key", logger as never);
    const issue = makeFakeIssue({ id: "issue-1", labelIds: [], team: Promise.resolve(null) });
    const issueLabels = vi.fn().mockResolvedValue({ nodes: [{ id: "existing-id", name: "bug" }] });
    const createIssueLabel = vi.fn();
    const updateIssue = vi.fn().mockResolvedValue(undefined);
    installFakeSdk(client, {
      issue: vi.fn().mockResolvedValue(issue),
      issueLabels,
      createIssueLabel,
      updateIssue,
    });

    await client.addLabel("issue-1", "bug");

    expect(createIssueLabel).not.toHaveBeenCalled();
    expect(updateIssue).toHaveBeenCalledWith("issue-1", { labelIds: ["existing-id"] });
  });

  it("does not call updateIssue when the issue already has the label", async () => {
    const logger = makeLogger();
    const client = new RealLinearClient("key", logger as never);
    const issue = makeFakeIssue({
      id: "issue-1",
      labelIds: ["existing-id"],
      team: Promise.resolve(null),
    });
    const issueLabels = vi.fn().mockResolvedValue({ nodes: [{ id: "existing-id", name: "bug" }] });
    const updateIssue = vi.fn();
    installFakeSdk(client, {
      issue: vi.fn().mockResolvedValue(issue),
      issueLabels,
      updateIssue,
    });

    await client.addLabel("issue-1", "bug");

    expect(updateIssue).not.toHaveBeenCalled();
  });

  it("throws when label creation returns no issueLabel", async () => {
    const logger = makeLogger();
    const client = new RealLinearClient("key", logger as never);
    const issue = makeFakeIssue({ id: "issue-1", labelIds: [], team: Promise.resolve(null) });
    const issueLabels = vi.fn().mockResolvedValue({ nodes: [] });
    const createIssueLabel = vi.fn().mockResolvedValue({ issueLabel: Promise.resolve(undefined) });
    installFakeSdk(client, {
      issue: vi.fn().mockResolvedValue(issue),
      issueLabels,
      createIssueLabel,
    });

    await expect(client.addLabel("issue-1", "bug")).rejects.toThrow(
      "Failed to create label: bug",
    );
  });

  it("uses the cached label id on a second call without re-querying issueLabels", async () => {
    const logger = makeLogger();
    const client = new RealLinearClient("key", logger as never);
    const issue1 = makeFakeIssue({ id: "issue-1", labelIds: [], team: Promise.resolve(null) });
    const issue2 = makeFakeIssue({ id: "issue-2", labelIds: [], team: Promise.resolve(null) });
    const issueLabels = vi.fn().mockResolvedValue({ nodes: [{ id: "existing-id", name: "bug" }] });
    const updateIssue = vi.fn().mockResolvedValue(undefined);
    const issueFn = vi.fn().mockImplementation((id: string) =>
      Promise.resolve(id === "issue-1" ? issue1 : issue2),
    );
    installFakeSdk(client, { issue: issueFn, issueLabels, updateIssue });

    await client.addLabel("issue-1", "bug");
    await client.addLabel("issue-2", "bug");

    expect(issueLabels).toHaveBeenCalledTimes(1);
  });
});

describe("RealLinearClient.removeLabel", () => {
  it("looks up the label id via issue.labels() when not cached, then removes it", async () => {
    const logger = makeLogger();
    const client = new RealLinearClient("key", logger as never);
    const issue = makeFakeIssue({
      id: "issue-1",
      labelIds: ["label-id", "other-id"],
      labels: () => Promise.resolve({ nodes: [{ id: "label-id", name: "bug" }] }),
    });
    const updateIssue = vi.fn().mockResolvedValue(undefined);
    installFakeSdk(client, { issue: vi.fn().mockResolvedValue(issue), updateIssue });

    await client.removeLabel("issue-1", "bug");

    expect(updateIssue).toHaveBeenCalledWith("issue-1", { labelIds: ["other-id"] });
  });

  it("does nothing when the label is not found on the issue", async () => {
    const logger = makeLogger();
    const client = new RealLinearClient("key", logger as never);
    const issue = makeFakeIssue({
      id: "issue-1",
      labelIds: ["other-id"],
      labels: () => Promise.resolve({ nodes: [{ id: "other-id", name: "infra" }] }),
    });
    const updateIssue = vi.fn();
    installFakeSdk(client, { issue: vi.fn().mockResolvedValue(issue), updateIssue });

    await client.removeLabel("issue-1", "bug");

    expect(updateIssue).not.toHaveBeenCalled();
  });

  it("uses the cached label id on a subsequent call without calling issue.labels() again", async () => {
    const logger = makeLogger();
    const client = new RealLinearClient("key", logger as never);
    const labelsFn = vi.fn().mockResolvedValue({ nodes: [{ id: "label-id", name: "bug" }] });
    const issue1 = makeFakeIssue({ id: "issue-1", labelIds: ["label-id"], labels: labelsFn });
    const issue2 = makeFakeIssue({ id: "issue-2", labelIds: ["label-id"], labels: labelsFn });
    const updateIssue = vi.fn().mockResolvedValue(undefined);
    const issueFn = vi.fn().mockImplementation((id: string) =>
      Promise.resolve(id === "issue-1" ? issue1 : issue2),
    );
    installFakeSdk(client, { issue: issueFn, updateIssue });

    await client.removeLabel("issue-1", "bug");
    await client.removeLabel("issue-2", "bug");

    expect(labelsFn).toHaveBeenCalledTimes(1);
    expect(updateIssue).toHaveBeenNthCalledWith(2, "issue-2", { labelIds: [] });
  });
});

describe("RealLinearClient.listLabels", () => {
  it("returns label names and populates the label cache", async () => {
    const logger = makeLogger();
    const client = new RealLinearClient("key", logger as never);
    const issue = makeFakeIssue({
      id: "issue-1",
      labels: () =>
        Promise.resolve({
          nodes: [
            { id: "l1", name: "bug" },
            { id: "l2", name: "infra" },
          ],
        }),
    });
    installFakeSdk(client, { issue: vi.fn().mockResolvedValue(issue) });

    const labels = await client.listLabels("issue-1");

    expect(labels).toEqual(["bug", "infra"]);

    // The cache populated by listLabels should let removeLabel skip issue.labels().
    const updateIssue = vi.fn().mockResolvedValue(undefined);
    (client as unknown as { sdk: Record<string, unknown> }).sdk = {
      issue: vi.fn().mockResolvedValue({ ...issue, labelIds: ["l1"] }),
      updateIssue,
    };
    await client.removeLabel("issue-1", "bug");
    expect(updateIssue).toHaveBeenCalledWith("issue-1", { labelIds: [] });
  });

  it("returns an empty array when the SDK returns no label nodes", async () => {
    const logger = makeLogger();
    const client = new RealLinearClient("key", logger as never);
    const issue = makeFakeIssue({ id: "issue-1", labels: () => Promise.resolve({}) });
    installFakeSdk(client, { issue: vi.fn().mockResolvedValue(issue) });

    const labels = await client.listLabels("issue-1");

    expect(labels).toEqual([]);
  });
});
