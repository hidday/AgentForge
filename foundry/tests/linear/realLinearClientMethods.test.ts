import { describe, it, expect, vi, beforeEach } from "vitest";
import { RealLinearClient } from "../../src/linear/realLinearClient.js";

interface FakeTeam {
  id: string;
  key: string;
  states: () => Promise<{ nodes: Array<{ id: string; name: string }> }>;
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
  team: Promise<FakeTeam | undefined>;
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
    state: Promise.resolve({ id: "state-1", name: "Todo" }),
    project: Promise.resolve(null),
    cycle: Promise.resolve(null),
    team: Promise.resolve({
      id: "team-1",
      key: "PRY",
      states: () => Promise.resolve({ nodes: [] }),
    }),
    labels: () => Promise.resolve({ nodes: [] }),
    ...overrides,
  };
}

function makeLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
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

function injectSdk(client: RealLinearClient, sdk: FakeSdk): void {
  (client as unknown as { sdk: FakeSdk }).sdk = sdk;
}

function makeSdk(overrides: Partial<FakeSdk> = {}): FakeSdk {
  return {
    issue: vi.fn(),
    issues: vi.fn(),
    team: vi.fn(),
    createComment: vi.fn().mockResolvedValue({}),
    updateIssue: vi.fn().mockResolvedValue({}),
    issueLabels: vi.fn(),
    createIssueLabel: vi.fn(),
    ...overrides,
  };
}

describe("RealLinearClient.getRelatedContext error handling", () => {
  it("logs a warning and drops a blocker whose relation.issue rejects, keeping the rest", async () => {
    const logger = makeLogger();
    const client = new RealLinearClient("test-key", logger as never);

    const goodBlocker = makeFakeIssue({ id: "good-blocker", identifier: "PRY-5" });
    const focus = makeFakeIssue({
      id: "focus-id",
      state: Promise.resolve(null),
      // RealLinearClient.getRelatedContext awaits `issue.parent`; add it here
      // since makeFakeIssue (in this file) doesn't define it by default.
    });
    (focus as unknown as { parent: Promise<undefined> }).parent = Promise.resolve(undefined);
    (focus as unknown as {
      inverseRelations: () => Promise<{
        nodes: Array<{ id: string; type: string; issue: Promise<unknown> }>;
      }>;
    }).inverseRelations = () =>
      Promise.resolve({
        nodes: [
          { id: "rel-bad", type: "blocks", issue: Promise.reject(new Error("deleted issue")) },
          { id: "rel-good", type: "blocks", issue: Promise.resolve(goodBlocker) },
        ],
      });

    const sdk = makeSdk({ issue: vi.fn().mockResolvedValue(focus) });
    injectSdk(client, sdk);

    const ctx = await client.getRelatedContext("focus-id");

    expect(ctx.blockers).toHaveLength(1);
    expect(ctx.blockers[0].id).toBe("good-blocker");
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
    it("maps the SDK issue into a LinearIssue, resolving related fields", async () => {
      const fake = makeFakeIssue({
        id: "focus-id",
        project: Promise.resolve({ name: "Platform" }),
        cycle: Promise.resolve({ name: "Sprint 1" }),
        labels: () => Promise.resolve({ nodes: [{ id: "l1", name: "bug" }] }),
      });
      const sdk = makeSdk({ issue: vi.fn().mockResolvedValue(fake) });
      injectSdk(client, sdk);

      const issue = await client.getIssue("focus-id");

      expect(issue).toEqual({
        id: "focus-id",
        identifier: "PRY-1",
        title: "Issue title",
        description: "Issue description",
        branchName: "ai/issue-1",
        state: "Todo",
        labels: ["bug"],
        priority: 0,
        url: "https://linear.app/team/issue/PRY-1",
        project: "Platform",
        team: "PRY",
        cycle: "Sprint 1",
      });
    });

    it("defaults description to empty string and state to Unknown when absent", async () => {
      const fake = makeFakeIssue({
        id: "focus-id",
        description: null,
        state: Promise.resolve(null),
        team: Promise.resolve(undefined),
      });
      const sdk = makeSdk({ issue: vi.fn().mockResolvedValue(fake) });
      injectSdk(client, sdk);

      const issue = await client.getIssue("focus-id");

      expect(issue.description).toBe("");
      expect(issue.state).toBe("Unknown");
      expect(issue.team).toBeUndefined();
    });

    it("defaults labels to an empty array when the labels connection itself is nullish", async () => {
      const fake = makeFakeIssue({
        id: "focus-id",
        // The SDK can resolve the connection itself to undefined (not just an
        // empty `nodes` array), which only the `labelsConn?.nodes?.map(...) ?? []`
        // fallback (rather than mapping over an empty array) actually guards.
        labels: () => Promise.resolve(undefined as unknown as { nodes: never[] }),
      });
      const sdk = makeSdk({ issue: vi.fn().mockResolvedValue(fake) });
      injectSdk(client, sdk);

      const issue = await client.getIssue("focus-id");

      expect(issue.labels).toEqual([]);
    });
  });

  describe("searchIssues", () => {
    it("builds a GraphQL filter from state only when no optional filters are set", async () => {
      const sdk = makeSdk({ issues: vi.fn().mockResolvedValue({ nodes: [] }) });
      injectSdk(client, sdk);

      await client.searchIssues({ state: "Todo" });

      expect(sdk.issues).toHaveBeenCalledWith({
        filter: { state: { name: { eq: "Todo" } } },
      });
    });

    it("adds project, assignee and team clauses when provided", async () => {
      const sdk = makeSdk({ issues: vi.fn().mockResolvedValue({ nodes: [] }) });
      injectSdk(client, sdk);

      await client.searchIssues({
        state: "Todo",
        projectName: "Platform",
        assigneeMe: true,
        team: "PRY",
      });

      expect(sdk.issues).toHaveBeenCalledWith({
        filter: {
          state: { name: { eq: "Todo" } },
          project: { name: { eq: "Platform" } },
          assignee: { isMe: { eq: true } },
          team: { or: [{ name: { eq: "PRY" } }, { key: { eq: "PRY" } }] },
        },
      });
    });

    it("maps matching issues, forcing state to the requested filter state", async () => {
      const fake = makeFakeIssue({
        id: "a",
        state: Promise.resolve({ id: "s", name: "Some Other State" }),
        project: Promise.resolve({ name: "Platform" }),
      });
      const sdk = makeSdk({ issues: vi.fn().mockResolvedValue({ nodes: [fake] }) });
      injectSdk(client, sdk);

      const results = await client.searchIssues({ state: "Todo" });

      expect(results).toHaveLength(1);
      expect(results[0].id).toBe("a");
      expect(results[0].state).toBe("Todo");
      expect(results[0].project).toBe("Platform");
    });

    it("returns an empty array when the connection has no nodes", async () => {
      const sdk = makeSdk({ issues: vi.fn().mockResolvedValue(undefined) });
      injectSdk(client, sdk);
      const results = await client.searchIssues({ state: "Todo" });
      expect(results).toEqual([]);
    });

    it("maps a matched issue's cycle name through when present", async () => {
      const fake = makeFakeIssue({ id: "c", cycle: Promise.resolve({ name: "Sprint 7" }) });
      const sdk = makeSdk({ issues: vi.fn().mockResolvedValue({ nodes: [fake] }) });
      injectSdk(client, sdk);

      const results = await client.searchIssues({ state: "Todo" });

      expect(results[0].cycle).toBe("Sprint 7");
    });

    it("defaults labels/description/project/team/cycle when all are nullish on a matched issue", async () => {
      const fake = makeFakeIssue({
        id: "b",
        description: null,
        labels: () => Promise.resolve(undefined as unknown as { nodes: never[] }),
        project: Promise.resolve(null),
        team: Promise.resolve(undefined),
        cycle: Promise.resolve(null),
      });
      const sdk = makeSdk({ issues: vi.fn().mockResolvedValue({ nodes: [fake] }) });
      injectSdk(client, sdk);

      const results = await client.searchIssues({ state: "Todo" });

      expect(results).toEqual([
        expect.objectContaining({
          id: "b",
          description: "",
          labels: [],
          project: undefined,
          team: undefined,
          cycle: undefined,
        }),
      ]);
    });
  });

  describe("postComment", () => {
    it("delegates to sdk.createComment", async () => {
      const sdk = makeSdk();
      injectSdk(client, sdk);
      await client.postComment("issue-1", "hello");
      expect(sdk.createComment).toHaveBeenCalledWith({ issueId: "issue-1", body: "hello" });
    });
  });

  describe("updateIssueState", () => {
    it("warns and does not update when the issue has no team", async () => {
      const fake = makeFakeIssue({ id: "a", team: Promise.resolve(undefined) });
      const sdk = makeSdk({ issue: vi.fn().mockResolvedValue(fake) });
      injectSdk(client, sdk);

      await client.updateIssueState("a", "Done");

      expect(logger.warn).toHaveBeenCalledWith(
        { issueId: "a" },
        "Cannot update state: issue has no team",
      );
      expect(sdk.updateIssue).not.toHaveBeenCalled();
    });

    it("warns and does not update when the state name cannot be resolved", async () => {
      const team: FakeTeam = {
        id: "team-1",
        key: "PRY",
        states: () => Promise.resolve({ nodes: [{ id: "s1", name: "Todo" }] }),
      };
      const fake = makeFakeIssue({ id: "a", team: Promise.resolve(team) });
      const sdk = makeSdk({ issue: vi.fn().mockResolvedValue(fake), team: vi.fn().mockResolvedValue(team) });
      injectSdk(client, sdk);

      await client.updateIssueState("a", "Nonexistent State");

      expect(logger.warn).toHaveBeenCalledWith(
        { issueId: "a", stateName: "Nonexistent State", teamId: "team-1" },
        "Could not find workflow state by name",
      );
      expect(sdk.updateIssue).not.toHaveBeenCalled();
    });

    it("resolves the state id and calls updateIssue, caching the team's states", async () => {
      const team: FakeTeam = {
        id: "team-1",
        key: "PRY",
        states: vi.fn().mockResolvedValue({ nodes: [{ id: "s1", name: "Done" }] }),
      };
      const fake = makeFakeIssue({ id: "a", team: Promise.resolve(team) });
      const sdk = makeSdk({ issue: vi.fn().mockResolvedValue(fake), team: vi.fn().mockResolvedValue(team) });
      injectSdk(client, sdk);

      await client.updateIssueState("a", "Done");

      expect(sdk.updateIssue).toHaveBeenCalledWith("a", { stateId: "s1" });

      // Second call for the same team should use the cache, not call team.states() again.
      await client.updateIssueState("a", "Done");
      expect(team.states).toHaveBeenCalledTimes(1);
      expect(sdk.team).toHaveBeenCalledTimes(1);
    });
  });

  describe("addLabel", () => {
    it("creates a brand-new label and adds it to the issue", async () => {
      const team: FakeTeam = { id: "team-1", key: "PRY", states: () => Promise.resolve({ nodes: [] }) };
      const fake = makeFakeIssue({ id: "a", team: Promise.resolve(team), labelIds: [] });
      const sdk = makeSdk({
        issue: vi.fn().mockResolvedValue(fake),
        issueLabels: vi.fn().mockResolvedValue({ nodes: [] }),
        createIssueLabel: vi.fn().mockResolvedValue({ issueLabel: Promise.resolve({ id: "label-1" }) }),
      });
      injectSdk(client, sdk);

      await client.addLabel("a", "urgent");

      expect(sdk.createIssueLabel).toHaveBeenCalledWith({ name: "urgent", teamId: "team-1" });
      expect(sdk.updateIssue).toHaveBeenCalledWith("a", { labelIds: ["label-1"] });
    });

    it("reuses an existing label found via issueLabels without creating a new one", async () => {
      const fake = makeFakeIssue({ id: "a", team: Promise.resolve(undefined), labelIds: [] });
      const sdk = makeSdk({
        issue: vi.fn().mockResolvedValue(fake),
        issueLabels: vi.fn().mockResolvedValue({ nodes: [{ id: "label-2" }] }),
      });
      injectSdk(client, sdk);

      await client.addLabel("a", "bug");

      expect(sdk.createIssueLabel).not.toHaveBeenCalled();
      expect(sdk.updateIssue).toHaveBeenCalledWith("a", { labelIds: ["label-2"] });
    });

    it("does not call updateIssue when the label id is already on the issue", async () => {
      const fake = makeFakeIssue({ id: "a", team: Promise.resolve(undefined), labelIds: ["label-3"] });
      const sdk = makeSdk({
        issue: vi.fn().mockResolvedValue(fake),
        issueLabels: vi.fn().mockResolvedValue({ nodes: [{ id: "label-3" }] }),
      });
      injectSdk(client, sdk);

      await client.addLabel("a", "bug");

      expect(sdk.updateIssue).not.toHaveBeenCalled();
    });

    it("throws when label creation returns no issueLabel", async () => {
      const fake = makeFakeIssue({ id: "a", team: Promise.resolve(undefined), labelIds: [] });
      const sdk = makeSdk({
        issue: vi.fn().mockResolvedValue(fake),
        issueLabels: vi.fn().mockResolvedValue({ nodes: [] }),
        createIssueLabel: vi.fn().mockResolvedValue({ issueLabel: Promise.resolve(undefined) }),
      });
      injectSdk(client, sdk);

      await expect(client.addLabel("a", "ghost")).rejects.toThrow(
        "Failed to create label: ghost",
      );
    });

    it("caches a resolved label id across calls, skipping issueLabels on the second call", async () => {
      const fake = makeFakeIssue({ id: "a", team: Promise.resolve(undefined), labelIds: [] });
      const sdk = makeSdk({
        issue: vi.fn().mockResolvedValue(fake),
        issueLabels: vi.fn().mockResolvedValue({ nodes: [{ id: "label-4" }] }),
      });
      injectSdk(client, sdk);

      await client.addLabel("a", "bug");
      await client.addLabel("a", "bug");

      expect(sdk.issueLabels).toHaveBeenCalledTimes(1);
    });
  });

  describe("removeLabel", () => {
    it("removes a label found via labels() when not yet cached", async () => {
      const fake = makeFakeIssue({
        id: "a",
        labelIds: ["label-5", "label-6"],
        labels: () => Promise.resolve({ nodes: [{ id: "label-5", name: "bug" }] }),
      });
      const sdk = makeSdk({ issue: vi.fn().mockResolvedValue(fake) });
      injectSdk(client, sdk);

      await client.removeLabel("a", "bug");

      expect(sdk.updateIssue).toHaveBeenCalledWith("a", { labelIds: ["label-6"] });
    });

    it("is a no-op when the named label is not found on the issue", async () => {
      const fake = makeFakeIssue({
        id: "a",
        labelIds: ["label-6"],
        labels: () => Promise.resolve({ nodes: [] }),
      });
      const sdk = makeSdk({ issue: vi.fn().mockResolvedValue(fake) });
      injectSdk(client, sdk);

      await client.removeLabel("a", "missing-label");

      expect(sdk.updateIssue).not.toHaveBeenCalled();
    });

    it("uses the cached label id on a subsequent call without calling labels() again", async () => {
      const fake = makeFakeIssue({
        id: "a",
        labelIds: ["label-5", "label-6"],
        labels: vi.fn().mockResolvedValue({ nodes: [{ id: "label-5", name: "bug" }] }),
      });
      const sdk = makeSdk({ issue: vi.fn().mockResolvedValue(fake) });
      injectSdk(client, sdk);

      await client.removeLabel("a", "bug");
      await client.removeLabel("a", "bug");

      expect(fake.labels).toHaveBeenCalledTimes(1);
      expect(sdk.updateIssue).toHaveBeenCalledTimes(2);
    });
  });

  describe("listLabels", () => {
    it("returns label names and populates the label cache", async () => {
      const fake = makeFakeIssue({
        id: "a",
        labelIds: ["label-7"],
        labels: () => Promise.resolve({ nodes: [{ id: "label-7", name: "infra" }] }),
      });
      const sdk = makeSdk({ issue: vi.fn().mockResolvedValue(fake) });
      injectSdk(client, sdk);

      const names = await client.listLabels("a");
      expect(names).toEqual(["infra"]);

      // removeLabel should now use the cache populated by listLabels, so
      // labels() is not invoked a second time.
      const labelsSpy = vi.fn().mockResolvedValue({ nodes: [{ id: "label-7", name: "infra" }] });
      fake.labels = labelsSpy;
      await client.removeLabel("a", "infra");
      expect(labelsSpy).not.toHaveBeenCalled();
      expect(sdk.updateIssue).toHaveBeenCalledWith("a", { labelIds: [] });
    });

    it("returns an empty array when there are no labels", async () => {
      const fake = makeFakeIssue({ id: "a", labels: () => Promise.resolve({ nodes: [] }) });
      const sdk = makeSdk({ issue: vi.fn().mockResolvedValue(fake) });
      injectSdk(client, sdk);

      expect(await client.listLabels("a")).toEqual([]);
    });

    it("returns an empty array and populates no cache entries when the connection itself is nullish", async () => {
      const fake = makeFakeIssue({
        id: "a",
        labels: () => Promise.resolve(undefined as unknown as { nodes: never[] }),
      });
      const sdk = makeSdk({ issue: vi.fn().mockResolvedValue(fake) });
      injectSdk(client, sdk);

      expect(await client.listLabels("a")).toEqual([]);
    });
  });

  describe("updateIssueState additional branches", () => {
    it("treats a nullish states connection as having no workflow states", async () => {
      const team: FakeTeam = {
        id: "team-1",
        key: "PRY",
        states: () => Promise.resolve(undefined as unknown as { nodes: never[] }),
      };
      const fake = makeFakeIssue({ id: "a", team: Promise.resolve(team) });
      const sdk = makeSdk({ issue: vi.fn().mockResolvedValue(fake), team: vi.fn().mockResolvedValue(team) });
      injectSdk(client, sdk);

      await client.updateIssueState("a", "Done");

      expect(logger.warn).toHaveBeenCalledWith(
        { issueId: "a", stateName: "Done", teamId: "team-1" },
        "Could not find workflow state by name",
      );
      expect(sdk.updateIssue).not.toHaveBeenCalled();
    });
  });

  describe("getRelatedContext additional branches", () => {
    it("treats a nullish inverseRelations connection as having no blockers, and defaults a parent's nullish labels/state", async () => {
      const parent = makeFakeIssue({
        id: "parent-id",
        identifier: "PRY-0",
        state: Promise.resolve(null),
        labels: () => Promise.resolve(undefined as unknown as { nodes: never[] }),
      });
      const focus = makeFakeIssue({ id: "focus-id" });
      (focus as unknown as { parent: Promise<FakeIssue> }).parent = Promise.resolve(parent);
      (focus as unknown as {
        inverseRelations: () => Promise<undefined>;
      }).inverseRelations = () => Promise.resolve(undefined);

      const sdk = makeSdk({ issue: vi.fn().mockResolvedValue(focus) });
      injectSdk(client, sdk);

      const ctx = await client.getRelatedContext("focus-id");

      expect(ctx.blockers).toEqual([]);
      expect(ctx.parent).toEqual(
        expect.objectContaining({ id: "parent-id", state: "Unknown", labels: [] }),
      );
    });
  });
});
