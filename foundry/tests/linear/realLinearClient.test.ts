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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function injectSdk(client: RealLinearClient, sdk: Record<string, any>): void {
  (client as unknown as { sdk: unknown }).sdk = sdk;
}

function makeFakeIssue(overrides: Record<string, unknown> = {}) {
  return {
    id: "issue-1",
    identifier: "PRY-1",
    title: "Issue title",
    description: "Issue description",
    branchName: "ai/issue-1",
    priority: 1,
    url: "https://linear.app/team/issue/PRY-1",
    labelIds: [],
    state: Promise.resolve({ id: "state-1", name: "Todo" }),
    project: Promise.resolve(null),
    cycle: Promise.resolve(null),
    team: Promise.resolve({ id: "team-1", key: "PRY" }),
    labels: () => Promise.resolve({ nodes: [] }),
    ...overrides,
  };
}

describe("RealLinearClient.getRelatedContext - nullish label/state defaults", () => {
  it("defaults a related issue's labels to [] and state to 'Unknown' when nullish", async () => {
    const logger = makeLogger();
    const client = new RealLinearClient("test-key", logger as never);
    const parent = makeFakeIssue({
      id: "parent-id",
      identifier: "PRY-100",
      labels: () => Promise.resolve(undefined),
      state: Promise.resolve(null),
    });
    const focus = makeFakeIssue({
      id: "focus-id",
      parent: Promise.resolve(parent),
      inverseRelations: () => Promise.resolve({ nodes: [] }),
    });
    injectSdk(client, {
      issue: vi.fn((id: string) =>
        Promise.resolve(id === "parent-id" ? parent : focus),
      ),
    });

    const ctx = await client.getRelatedContext("focus-id");

    expect(ctx.parent?.labels).toEqual([]);
    expect(ctx.parent?.state).toBe("Unknown");
  });
});

describe("RealLinearClient.getRelatedContext - blocker hydration failure", () => {
  it("treats a nullish inverseRelations connection as having no blockers", async () => {
    const logger = makeLogger();
    const client = new RealLinearClient("test-key", logger as never);
    const focus = makeFakeIssue({
      id: "focus-id",
      inverseRelations: () => Promise.resolve(undefined),
    });
    injectSdk(client, { issue: vi.fn().mockResolvedValue(focus) });

    const ctx = await client.getRelatedContext("focus-id");

    expect(ctx.blockers).toEqual([]);
  });

  it("logs a warning and omits a blocker whose relation.issue rejects", async () => {
    const logger = makeLogger();
    const client = new RealLinearClient("test-key", logger as never);
    const goodBlocker = makeFakeIssue({ id: "blocker-ok", identifier: "PRY-500" });
    const focus = makeFakeIssue({
      id: "focus-id",
      inverseRelations: () =>
        Promise.resolve({
          nodes: [
            { id: "rel-bad", type: "blocks", issue: Promise.reject(new Error("hydrate failed")) },
            { id: "rel-good", type: "blocks", issue: Promise.resolve(goodBlocker) },
          ],
        }),
    });
    injectSdk(client, { issue: vi.fn().mockResolvedValue(focus) });

    const ctx = await client.getRelatedContext("focus-id");

    expect(ctx.blockers).toHaveLength(1);
    expect(ctx.blockers[0].id).toBe("blocker-ok");
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ relationId: "rel-bad", focusIssueId: "focus-id" }),
      "Failed to hydrate blocker issue from relation",
    );
  });
});

describe("RealLinearClient", () => {
  let client: RealLinearClient;
  let logger: ReturnType<typeof makeLogger>;

  beforeEach(() => {
    logger = makeLogger();
    client = new RealLinearClient("test-key", logger as never);
  });

  describe("getIssue", () => {
    it("maps SDK issue fields into a LinearIssue, resolving nested project/team/cycle", async () => {
      const fakeIssue = makeFakeIssue({
        project: Promise.resolve({ name: "Foundry" }),
        cycle: Promise.resolve({ name: "Cycle 3" }),
        team: Promise.resolve({ id: "team-1", key: "PRY" }),
        labels: () => Promise.resolve({ nodes: [{ id: "l1", name: "bug" }] }),
      });
      injectSdk(client, { issue: vi.fn().mockResolvedValue(fakeIssue) });

      const result = await client.getIssue("issue-1");

      expect(result).toEqual({
        id: "issue-1",
        identifier: "PRY-1",
        title: "Issue title",
        description: "Issue description",
        branchName: "ai/issue-1",
        state: "Todo",
        labels: ["bug"],
        priority: 1,
        url: "https://linear.app/team/issue/PRY-1",
        project: "Foundry",
        team: "PRY",
        cycle: "Cycle 3",
      });
    });

    it("defaults description to empty string and missing state/project/team/cycle to undefined", async () => {
      const fakeIssue = makeFakeIssue({
        description: null,
        state: Promise.resolve(null),
        project: Promise.resolve(null),
        cycle: Promise.resolve(null),
        team: Promise.resolve(null),
        labels: () => Promise.resolve(undefined),
      });
      injectSdk(client, { issue: vi.fn().mockResolvedValue(fakeIssue) });

      const result = await client.getIssue("issue-1");

      expect(result.description).toBe("");
      expect(result.state).toBe("Unknown");
      expect(result.project).toBeUndefined();
      expect(result.team).toBeUndefined();
      expect(result.cycle).toBeUndefined();
      expect(result.labels).toEqual([]);
    });
  });

  describe("searchIssues", () => {
    it("builds a GraphQL filter from state/project/assigneeMe/team and maps results", async () => {
      const fakeIssue = makeFakeIssue({
        id: "issue-2",
        labels: () => Promise.resolve({ nodes: [{ id: "l1", name: "infra" }] }),
        project: Promise.resolve({ name: "Foundry" }),
        cycle: Promise.resolve({ name: "Cycle 1" }),
        team: Promise.resolve({ id: "team-1", key: "PRY" }),
      });
      const issuesFn = vi.fn().mockResolvedValue({ nodes: [fakeIssue] });
      injectSdk(client, { issues: issuesFn });

      const results = await client.searchIssues({
        state: "Todo",
        projectName: "Foundry",
        assigneeMe: true,
        team: "PRY",
      });

      expect(issuesFn).toHaveBeenCalledWith({
        filter: {
          state: { name: { eq: "Todo" } },
          project: { name: { eq: "Foundry" } },
          assignee: { isMe: { eq: true } },
          team: { or: [{ name: { eq: "PRY" } }, { key: { eq: "PRY" } }] },
        },
      });
      expect(results).toEqual([
        {
          id: "issue-2",
          identifier: "PRY-1",
          title: "Issue title",
          description: "Issue description",
          branchName: "ai/issue-1",
          state: "Todo",
          labels: ["infra"],
          priority: 1,
          url: "https://linear.app/team/issue/PRY-1",
          project: "Foundry",
          team: "PRY",
          cycle: "Cycle 1",
        },
      ]);
    });

    it("omits optional filter keys when projectName/assigneeMe/team are not provided", async () => {
      const issuesFn = vi.fn().mockResolvedValue({ nodes: [] });
      injectSdk(client, { issues: issuesFn });

      await client.searchIssues({ state: "Todo" });

      expect(issuesFn).toHaveBeenCalledWith({ filter: { state: { name: { eq: "Todo" } } } });
    });

    it("returns an empty array when the SDK returns no nodes", async () => {
      injectSdk(client, { issues: vi.fn().mockResolvedValue(undefined) });

      const results = await client.searchIssues({ state: "Todo" });

      expect(results).toEqual([]);
    });

    it("defaults labels/project/team/cycle/description to empty/undefined when nullish", async () => {
      const fakeIssue = makeFakeIssue({
        id: "issue-3",
        description: null,
        labels: () => Promise.resolve(undefined),
        project: Promise.resolve(null),
        cycle: Promise.resolve(null),
        team: Promise.resolve(null),
      });
      injectSdk(client, { issues: vi.fn().mockResolvedValue({ nodes: [fakeIssue] }) });

      const [result] = await client.searchIssues({ state: "Todo" });

      expect(result.labels).toEqual([]);
      expect(result.project).toBeUndefined();
      expect(result.team).toBeUndefined();
      expect(result.cycle).toBeUndefined();
      expect(result.description).toBe("");
    });
  });

  describe("postComment", () => {
    it("delegates to sdk.createComment with issueId and body", async () => {
      const createComment = vi.fn().mockResolvedValue({});
      injectSdk(client, { createComment });

      await client.postComment("issue-1", "hello there");

      expect(createComment).toHaveBeenCalledWith({ issueId: "issue-1", body: "hello there" });
    });
  });

  describe("updateIssueState", () => {
    it("resolves the state id from the issue's team and updates the issue", async () => {
      const team = { id: "team-1", states: vi.fn() };
      team.states = vi
        .fn()
        .mockResolvedValue({ nodes: [{ id: "state-done", name: "Done" }] });
      const fakeIssue = makeFakeIssue({ team: Promise.resolve(team) });
      const updateIssue = vi.fn().mockResolvedValue({});
      injectSdk(client, {
        issue: vi.fn().mockResolvedValue(fakeIssue),
        team: vi.fn().mockResolvedValue(team),
        updateIssue,
      });

      await client.updateIssueState("issue-1", "Done");

      expect(updateIssue).toHaveBeenCalledWith("issue-1", { stateId: "state-done" });
    });

    it("logs a warning and does not update when the issue has no team", async () => {
      const fakeIssue = makeFakeIssue({ team: Promise.resolve(null) });
      const updateIssue = vi.fn();
      injectSdk(client, { issue: vi.fn().mockResolvedValue(fakeIssue), updateIssue });

      await client.updateIssueState("issue-1", "Done");

      expect(updateIssue).not.toHaveBeenCalled();
      expect(logger.warn).toHaveBeenCalledWith(
        { issueId: "issue-1" },
        "Cannot update state: issue has no team",
      );
    });

    it("logs a warning and does not update when the workflow state name cannot be found", async () => {
      const team = { id: "team-1", states: vi.fn().mockResolvedValue({ nodes: [] }) };
      const fakeIssue = makeFakeIssue({ team: Promise.resolve(team) });
      const updateIssue = vi.fn();
      injectSdk(client, {
        issue: vi.fn().mockResolvedValue(fakeIssue),
        team: vi.fn().mockResolvedValue(team),
        updateIssue,
      });

      await client.updateIssueState("issue-1", "Nonexistent");

      expect(updateIssue).not.toHaveBeenCalled();
      expect(logger.warn).toHaveBeenCalledWith(
        { issueId: "issue-1", stateName: "Nonexistent", teamId: "team-1" },
        "Could not find workflow state by name",
      );
    });

    it("caches the resolved state map across calls for the same team", async () => {
      const statesFn = vi.fn().mockResolvedValue({ nodes: [{ id: "state-done", name: "Done" }] });
      const team = { id: "team-1", states: statesFn };
      const fakeIssue = makeFakeIssue({ team: Promise.resolve(team) });
      const teamFn = vi.fn().mockResolvedValue(team);
      injectSdk(client, {
        issue: vi.fn().mockResolvedValue(fakeIssue),
        team: teamFn,
        updateIssue: vi.fn().mockResolvedValue({}),
      });

      await client.updateIssueState("issue-1", "Done");
      await client.updateIssueState("issue-1", "Done");

      expect(statesFn).toHaveBeenCalledTimes(1);
    });
  });

  describe("addLabel", () => {
    it("adds a newly created label when none exists and the issue has no labels yet", async () => {
      const fakeIssue = makeFakeIssue({ labelIds: [], team: Promise.resolve({ id: "team-1" }) });
      const updateIssue = vi.fn().mockResolvedValue({});
      const createIssueLabel = vi.fn().mockResolvedValue({
        issueLabel: Promise.resolve({ id: "label-new", name: "bug" }),
      });
      injectSdk(client, {
        issue: vi.fn().mockResolvedValue(fakeIssue),
        issueLabels: vi.fn().mockResolvedValue({ nodes: [] }),
        createIssueLabel,
        updateIssue,
      });

      await client.addLabel("issue-1", "bug");

      expect(createIssueLabel).toHaveBeenCalledWith({ name: "bug", teamId: "team-1" });
      expect(updateIssue).toHaveBeenCalledWith("issue-1", { labelIds: ["label-new"] });
    });

    it("reuses an existing label found via issueLabels and does not create a new one", async () => {
      const fakeIssue = makeFakeIssue({ labelIds: [], team: Promise.resolve(undefined) });
      const createIssueLabel = vi.fn();
      const updateIssue = vi.fn().mockResolvedValue({});
      injectSdk(client, {
        issue: vi.fn().mockResolvedValue(fakeIssue),
        issueLabels: vi.fn().mockResolvedValue({ nodes: [{ id: "label-existing", name: "bug" }] }),
        createIssueLabel,
        updateIssue,
      });

      await client.addLabel("issue-1", "bug");

      expect(createIssueLabel).not.toHaveBeenCalled();
      expect(updateIssue).toHaveBeenCalledWith("issue-1", { labelIds: ["label-existing"] });
    });

    it("does not call updateIssue when the label is already on the issue", async () => {
      const fakeIssue = makeFakeIssue({
        labelIds: ["label-existing"],
        team: Promise.resolve({ id: "team-1" }),
      });
      const updateIssue = vi.fn();
      injectSdk(client, {
        issue: vi.fn().mockResolvedValue(fakeIssue),
        issueLabels: vi.fn().mockResolvedValue({ nodes: [{ id: "label-existing", name: "bug" }] }),
        updateIssue,
      });

      await client.addLabel("issue-1", "bug");

      expect(updateIssue).not.toHaveBeenCalled();
    });

    it("throws when label creation succeeds but returns no issueLabel", async () => {
      const fakeIssue = makeFakeIssue({ labelIds: [], team: Promise.resolve({ id: "team-1" }) });
      injectSdk(client, {
        issue: vi.fn().mockResolvedValue(fakeIssue),
        issueLabels: vi.fn().mockResolvedValue({ nodes: [] }),
        createIssueLabel: vi.fn().mockResolvedValue({ issueLabel: Promise.resolve(undefined) }),
        updateIssue: vi.fn(),
      });

      await expect(client.addLabel("issue-1", "bug")).rejects.toThrow(
        "Failed to create label: bug",
      );
    });

    it("caches a resolved label id across repeated addLabel calls, skipping issueLabels lookup", async () => {
      const fakeIssue1 = makeFakeIssue({ id: "issue-1", labelIds: [], team: Promise.resolve({ id: "team-1" }) });
      const fakeIssue2 = makeFakeIssue({ id: "issue-2", labelIds: [], team: Promise.resolve({ id: "team-1" }) });
      const issueLabels = vi.fn().mockResolvedValue({ nodes: [{ id: "label-1", name: "bug" }] });
      const issueFn = vi
        .fn()
        .mockResolvedValueOnce(fakeIssue1)
        .mockResolvedValueOnce(fakeIssue2);
      injectSdk(client, {
        issue: issueFn,
        issueLabels,
        updateIssue: vi.fn().mockResolvedValue({}),
      });

      await client.addLabel("issue-1", "bug");
      await client.addLabel("issue-2", "bug");

      expect(issueLabels).toHaveBeenCalledTimes(1);
    });
  });

  describe("removeLabel", () => {
    it("looks up the label via issue.labels() when not cached, and removes it", async () => {
      const fakeIssue = makeFakeIssue({
        labelIds: ["label-1", "label-2"],
        labels: () => Promise.resolve({ nodes: [{ id: "label-1", name: "bug" }] }),
      });
      const updateIssue = vi.fn().mockResolvedValue({});
      injectSdk(client, { issue: vi.fn().mockResolvedValue(fakeIssue), updateIssue });

      await client.removeLabel("issue-1", "bug");

      expect(updateIssue).toHaveBeenCalledWith("issue-1", { labelIds: ["label-2"] });
    });

    it("is a no-op when the label name is not found on the issue", async () => {
      const fakeIssue = makeFakeIssue({
        labelIds: ["label-2"],
        labels: () => Promise.resolve({ nodes: [{ id: "label-2", name: "other" }] }),
      });
      const updateIssue = vi.fn();
      injectSdk(client, { issue: vi.fn().mockResolvedValue(fakeIssue), updateIssue });

      await client.removeLabel("issue-1", "bug");

      expect(updateIssue).not.toHaveBeenCalled();
    });

    it("uses the cached label id (populated by a prior listLabels call) without calling issue.labels() again", async () => {
      const labelsFn = vi.fn().mockResolvedValue({ nodes: [{ id: "label-1", name: "bug" }] });
      const fakeIssue = makeFakeIssue({ labelIds: ["label-1"], labels: labelsFn });
      const updateIssue = vi.fn().mockResolvedValue({});
      injectSdk(client, { issue: vi.fn().mockResolvedValue(fakeIssue), updateIssue });

      await client.listLabels("issue-1");
      labelsFn.mockClear();

      await client.removeLabel("issue-1", "bug");

      expect(labelsFn).not.toHaveBeenCalled();
      expect(updateIssue).toHaveBeenCalledWith("issue-1", { labelIds: [] });
    });
  });

  describe("listLabels", () => {
    it("returns label names and populates the label cache", async () => {
      const fakeIssue = makeFakeIssue({
        labels: () =>
          Promise.resolve({
            nodes: [
              { id: "l1", name: "bug" },
              { id: "l2", name: "urgent" },
            ],
          }),
      });
      injectSdk(client, { issue: vi.fn().mockResolvedValue(fakeIssue) });

      const names = await client.listLabels("issue-1");

      expect(names).toEqual(["bug", "urgent"]);
    });

    it("returns an empty array when the issue has no labels", async () => {
      const fakeIssue = makeFakeIssue({ labels: () => Promise.resolve({ nodes: [] }) });
      injectSdk(client, { issue: vi.fn().mockResolvedValue(fakeIssue) });

      expect(await client.listLabels("issue-1")).toEqual([]);
    });

    it("returns an empty array when the labels connection itself is nullish", async () => {
      const fakeIssue = makeFakeIssue({
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        labels: () => Promise.resolve(undefined as any),
      });
      injectSdk(client, { issue: vi.fn().mockResolvedValue(fakeIssue) });

      expect(await client.listLabels("issue-1")).toEqual([]);
    });
  });

  describe("resolveStateId", () => {
    it("treats a nullish states connection as having no states", async () => {
      const team = { id: "team-1", states: vi.fn().mockResolvedValue(undefined) };
      const fakeIssue = makeFakeIssue({ team: Promise.resolve(team) });
      const updateIssue = vi.fn();
      injectSdk(client, {
        issue: vi.fn().mockResolvedValue(fakeIssue),
        team: vi.fn().mockResolvedValue(team),
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

  describe("resolveOrCreateLabel", () => {
    it("creates a label without a teamId when the issue has no team", async () => {
      const fakeIssue = makeFakeIssue({ labelIds: [], team: Promise.resolve(undefined) });
      const createIssueLabel = vi.fn().mockResolvedValue({
        issueLabel: Promise.resolve({ id: "label-new", name: "bug" }),
      });
      injectSdk(client, {
        issue: vi.fn().mockResolvedValue(fakeIssue),
        issueLabels: vi.fn().mockResolvedValue({ nodes: [] }),
        createIssueLabel,
        updateIssue: vi.fn().mockResolvedValue({}),
      });

      await client.addLabel("issue-1", "bug");

      expect(createIssueLabel).toHaveBeenCalledWith({ name: "bug" });
    });
  });
});
