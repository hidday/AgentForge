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
  parent: Promise<FakeIssue | null>;
  state: Promise<{ id: string; name: string } | null>;
  project: Promise<{ name: string } | null>;
  cycle: Promise<{ name: string } | null>;
  team: Promise<{ id: string; key: string } | null>;
  labels: () => Promise<{ nodes: Array<{ id: string; name: string }> }>;
  inverseRelations: () => Promise<{
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

type FakeSdk = {
  issue?: (id: string) => Promise<FakeIssue>;
  issues?: (args: unknown) => Promise<{ nodes: FakeIssue[] }>;
  createComment?: (args: { issueId: string; body: string }) => Promise<void>;
  updateIssue?: (id: string, args: unknown) => Promise<void>;
  team?: (id: string) => Promise<{ states: () => Promise<{ nodes: Array<{ id: string; name: string }> }> }>;
  issueLabels?: (args: unknown) => Promise<{ nodes: Array<{ id: string; name: string }> }>;
  createIssueLabel?: (args: unknown) => Promise<{ issueLabel: Promise<{ id: string } | undefined> }>;
};

function injectSdk(client: RealLinearClient, sdk: FakeSdk) {
  (client as unknown as { sdk: FakeSdk }).sdk = sdk;
}

describe("RealLinearClient", () => {
  let client: RealLinearClient;
  let logger: ReturnType<typeof makeLogger>;

  beforeEach(() => {
    logger = makeLogger();
    client = new RealLinearClient("test-key", logger as never);
  });

  describe("getIssue", () => {
    it("maps an SDK issue into a LinearIssue, resolving state/project/cycle/team", async () => {
      const fake = makeFakeIssue({
        id: "issue-1",
        description: null,
        project: Promise.resolve({ name: "Core" }),
        cycle: Promise.resolve({ name: "Cycle 4" }),
        team: Promise.resolve({ id: "team-1", key: "PRY" }),
        labels: () => Promise.resolve({ nodes: [{ id: "l1", name: "bug" }] }),
      });
      injectSdk(client, { issue: async () => fake });

      const result = await client.getIssue("issue-1");

      expect(result).toEqual({
        id: "issue-1",
        identifier: "PRY-1",
        title: "Issue title",
        description: "",
        branchName: "ai/issue-1",
        state: "Todo",
        labels: ["bug"],
        priority: 0,
        url: "https://linear.app/team/issue/PRY-1",
        project: "Core",
        team: "PRY",
        cycle: "Cycle 4",
      });
    });

    it("falls back to 'Unknown' state and undefined project/team/cycle when absent", async () => {
      const fake = makeFakeIssue({
        id: "issue-2",
        state: Promise.resolve(null),
        project: Promise.resolve(null),
        cycle: Promise.resolve(null),
        team: Promise.resolve(null),
      });
      injectSdk(client, { issue: async () => fake });

      const result = await client.getIssue("issue-2");

      expect(result.state).toBe("Unknown");
      expect(result.project).toBeUndefined();
      expect(result.team).toBeUndefined();
      expect(result.cycle).toBeUndefined();
    });

    it("returns an empty labels array when the labels connection has no nodes", async () => {
      const fake = makeFakeIssue({
        id: "issue-3",
        labels: () => Promise.resolve({ nodes: [] }),
      });
      injectSdk(client, { issue: async () => fake });

      const result = await client.getIssue("issue-3");
      expect(result.labels).toEqual([]);
    });
  });

  describe("getRelatedContext — fetchBlockers error handling", () => {
    it("logs a warning and skips a blocker relation whose issue hydration rejects", async () => {
      const focus = makeFakeIssue({
        id: "focus-1",
        inverseRelations: () =>
          Promise.resolve({
            nodes: [
              {
                id: "rel-1",
                type: "blocks",
                issue: Promise.reject(new Error("hydration failed")),
              },
              {
                id: "rel-2",
                type: "blocks",
                issue: Promise.resolve(makeFakeIssue({ id: "blocker-1", title: "Blocker" })),
              },
            ],
          }),
      });
      injectSdk(client, { issue: async () => focus });

      const result = await client.getRelatedContext("focus-1");

      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ relationId: "rel-1", focusIssueId: "focus-1" }),
        "Failed to hydrate blocker issue from relation",
      );
      expect(result.blockers).toHaveLength(1);
      expect(result.blockers[0].id).toBe("blocker-1");
    });
  });

  describe("searchIssues", () => {
    it("builds a GraphQL filter from projectName/assigneeMe/team and maps each result", async () => {
      const resultIssue = makeFakeIssue({
        id: "found-1",
        project: Promise.resolve({ name: "Core" }),
        cycle: Promise.resolve({ name: "Cycle 1" }),
        team: Promise.resolve({ id: "team-1", key: "PRY" }),
      });
      let capturedFilter: unknown;
      injectSdk(client, {
        issues: async (args: unknown) => {
          capturedFilter = (args as { filter: unknown }).filter;
          return { nodes: [resultIssue] };
        },
      });

      const results = await client.searchIssues({
        state: "Todo",
        projectName: "Core",
        assigneeMe: true,
        team: "PRY",
      });

      expect(capturedFilter).toEqual({
        state: { name: { eq: "Todo" } },
        project: { name: { eq: "Core" } },
        assignee: { isMe: { eq: true } },
        team: { or: [{ name: { eq: "PRY" } }, { key: { eq: "PRY" } }] },
      });
      expect(results).toHaveLength(1);
      expect(results[0]).toEqual(
        expect.objectContaining({ id: "found-1", state: "Todo", project: "Core", team: "PRY" }),
      );
      expect(logger.info).toHaveBeenCalledWith(
        expect.objectContaining({ count: 1 }),
        "Searched Linear issues",
      );
    });

    it("omits optional filter fields when projectName/assigneeMe/team are not set", async () => {
      let capturedFilter: unknown;
      injectSdk(client, {
        issues: async (args: unknown) => {
          capturedFilter = (args as { filter: unknown }).filter;
          return { nodes: [] };
        },
      });

      await client.searchIssues({ state: "Todo" });

      expect(capturedFilter).toEqual({ state: { name: { eq: "Todo" } } });
    });

    it("returns an empty array when the issues connection has no nodes", async () => {
      injectSdk(client, { issues: async () => ({ nodes: [] }) });
      const results = await client.searchIssues({ state: "Todo" });
      expect(results).toEqual([]);
    });
  });

  describe("postComment", () => {
    it("calls sdk.createComment with the issue id and body", async () => {
      const createComment = vi.fn().mockResolvedValue(undefined);
      injectSdk(client, { createComment });

      await client.postComment("issue-1", "hello world");

      expect(createComment).toHaveBeenCalledWith({ issueId: "issue-1", body: "hello world" });
      expect(logger.debug).toHaveBeenCalledWith({ issueId: "issue-1" }, "Posted comment to Linear issue");
    });
  });

  describe("updateIssueState", () => {
    it("warns and returns without updating when the issue has no team", async () => {
      const fake = makeFakeIssue({ id: "issue-1", team: Promise.resolve(null) });
      const updateIssue = vi.fn();
      injectSdk(client, { issue: async () => fake, updateIssue });

      await client.updateIssueState("issue-1", "Done");

      expect(updateIssue).not.toHaveBeenCalled();
      expect(logger.warn).toHaveBeenCalledWith({ issueId: "issue-1" }, "Cannot update state: issue has no team");
    });

    it("warns and returns without updating when the state name cannot be resolved", async () => {
      const fake = makeFakeIssue({ id: "issue-1", team: Promise.resolve({ id: "team-1", key: "PRY" }) });
      const updateIssue = vi.fn();
      injectSdk(client, {
        issue: async () => fake,
        updateIssue,
        team: async () => ({ states: async () => ({ nodes: [{ id: "s1", name: "Todo" }] }) }),
      });

      await client.updateIssueState("issue-1", "Nonexistent State");

      expect(updateIssue).not.toHaveBeenCalled();
      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ issueId: "issue-1", stateName: "Nonexistent State", teamId: "team-1" }),
        "Could not find workflow state by name",
      );
    });

    it("resolves the state id and calls updateIssue, caching the team's state map across calls", async () => {
      const fake = makeFakeIssue({ id: "issue-1", team: Promise.resolve({ id: "team-1", key: "PRY" }) });
      const updateIssue = vi.fn().mockResolvedValue(undefined);
      const team = vi.fn().mockResolvedValue({
        states: async () => ({ nodes: [{ id: "state-done", name: "Done" }] }),
      });
      injectSdk(client, { issue: async () => fake, updateIssue, team });

      await client.updateIssueState("issue-1", "Done");
      await client.updateIssueState("issue-1", "Done");

      expect(updateIssue).toHaveBeenCalledTimes(2);
      expect(updateIssue).toHaveBeenCalledWith("issue-1", { stateId: "state-done" });
      // team() (and thus states()) is only called once — the second call hits the cache.
      expect(team).toHaveBeenCalledTimes(1);
    });
  });

  describe("addLabel", () => {
    it("does nothing extra when the label is already present on the issue", async () => {
      const fake = makeFakeIssue({
        id: "issue-1",
        labelIds: ["label-abc"],
        team: Promise.resolve({ id: "team-1", key: "PRY" }),
      });
      const updateIssue = vi.fn();
      injectSdk(client, {
        issue: async () => fake,
        updateIssue,
        issueLabels: async () => ({ nodes: [{ id: "label-abc", name: "bug" }] }),
      });

      await client.addLabel("issue-1", "bug");

      expect(updateIssue).not.toHaveBeenCalled();
    });

    it("resolves an existing label by name and adds its id to the issue", async () => {
      const fake = makeFakeIssue({ id: "issue-1", labelIds: [] });
      const updateIssue = vi.fn().mockResolvedValue(undefined);
      injectSdk(client, {
        issue: async () => fake,
        updateIssue,
        issueLabels: async () => ({ nodes: [{ id: "label-xyz", name: "urgent" }] }),
      });

      await client.addLabel("issue-1", "urgent");

      expect(updateIssue).toHaveBeenCalledWith("issue-1", { labelIds: ["label-xyz"] });
    });

    it("creates a new label (scoped to the issue's team) when none exists by that name", async () => {
      const fake = makeFakeIssue({
        id: "issue-1",
        labelIds: [],
        team: Promise.resolve({ id: "team-1", key: "PRY" }),
      });
      const updateIssue = vi.fn().mockResolvedValue(undefined);
      const createIssueLabel = vi.fn().mockResolvedValue({
        issueLabel: Promise.resolve({ id: "label-new" }),
      });
      injectSdk(client, {
        issue: async () => fake,
        updateIssue,
        issueLabels: async () => ({ nodes: [] }),
        createIssueLabel,
      });

      await client.addLabel("issue-1", "brand-new");

      expect(createIssueLabel).toHaveBeenCalledWith({ name: "brand-new", teamId: "team-1" });
      expect(updateIssue).toHaveBeenCalledWith("issue-1", { labelIds: ["label-new"] });
    });

    it("creates a label without a teamId when the issue has no team", async () => {
      const fake = makeFakeIssue({ id: "issue-1", labelIds: [], team: Promise.resolve(null) });
      const createIssueLabel = vi.fn().mockResolvedValue({
        issueLabel: Promise.resolve({ id: "label-new" }),
      });
      injectSdk(client, {
        issue: async () => fake,
        updateIssue: vi.fn().mockResolvedValue(undefined),
        issueLabels: async () => ({ nodes: [] }),
        createIssueLabel,
      });

      await client.addLabel("issue-1", "brand-new");

      expect(createIssueLabel).toHaveBeenCalledWith({ name: "brand-new" });
    });

    it("throws when label creation does not return an issueLabel", async () => {
      const fake = makeFakeIssue({ id: "issue-1", labelIds: [] });
      injectSdk(client, {
        issue: async () => fake,
        issueLabels: async () => ({ nodes: [] }),
        createIssueLabel: async () => ({ issueLabel: Promise.resolve(undefined) }),
      });

      await expect(client.addLabel("issue-1", "brand-new")).rejects.toThrow(
        "Failed to create label: brand-new",
      );
    });

    it("reuses the label cache (from a prior resolveOrCreateLabel) without calling issueLabels again", async () => {
      const fake = makeFakeIssue({ id: "issue-1", labelIds: [] });
      const issueLabels = vi.fn().mockResolvedValue({ nodes: [{ id: "label-xyz", name: "urgent" }] });
      injectSdk(client, {
        issue: async () => fake,
        updateIssue: vi.fn().mockResolvedValue(undefined),
        issueLabels,
      });

      await client.addLabel("issue-1", "urgent");
      await client.addLabel("issue-1", "urgent");

      expect(issueLabels).toHaveBeenCalledTimes(1);
    });
  });

  describe("removeLabel", () => {
    it("does nothing when the label is not found on the issue at all", async () => {
      const fake = makeFakeIssue({ id: "issue-1", labelIds: ["other"] });
      const updateIssue = vi.fn();
      injectSdk(client, {
        issue: async () => fake,
        updateIssue,
      });
      fake.labels = () => Promise.resolve({ nodes: [{ id: "other", name: "keep-me" }] });

      await client.removeLabel("issue-1", "missing-label");

      expect(updateIssue).not.toHaveBeenCalled();
    });

    it("removes a label found via the issue's labels connection and caches its id", async () => {
      const fake = makeFakeIssue({ id: "issue-1", labelIds: ["label-a", "label-b"] });
      fake.labels = () =>
        Promise.resolve({ nodes: [{ id: "label-a", name: "bug" }, { id: "label-b", name: "urgent" }] });
      const updateIssue = vi.fn().mockResolvedValue(undefined);
      injectSdk(client, { issue: async () => fake, updateIssue });

      await client.removeLabel("issue-1", "urgent");

      expect(updateIssue).toHaveBeenCalledWith("issue-1", { labelIds: ["label-a"] });
    });

    it("removes a label using the cached id without re-fetching the labels connection", async () => {
      const fake = makeFakeIssue({ id: "issue-1", labelIds: ["label-a", "label-b"] });
      const labelsFn = vi
        .fn()
        .mockResolvedValue({ nodes: [{ id: "label-a", name: "bug" }, { id: "label-b", name: "urgent" }] });
      fake.labels = labelsFn;
      const updateIssue = vi.fn().mockResolvedValue(undefined);
      injectSdk(client, { issue: async () => fake, updateIssue });

      await client.removeLabel("issue-1", "urgent"); // populates the cache
      await client.removeLabel("issue-1", "urgent"); // should use the cache this time

      expect(labelsFn).toHaveBeenCalledTimes(1);
      expect(updateIssue).toHaveBeenCalledTimes(2);
    });
  });

  describe("listLabels", () => {
    it("returns label names and populates the label cache for later addLabel/removeLabel calls", async () => {
      const fake = makeFakeIssue({
        id: "issue-1",
        labels: () => Promise.resolve({ nodes: [{ id: "label-a", name: "bug" }] }),
      });
      injectSdk(client, { issue: async () => fake });

      const names = await client.listLabels("issue-1");
      expect(names).toEqual(["bug"]);

      // Now removeLabel for "bug" should use the cache populated by listLabels,
      // without calling issue.labels() again.
      const labelsSpy = vi.fn().mockResolvedValue({ nodes: [{ id: "label-a", name: "bug" }] });
      fake.labels = labelsSpy;
      const updateIssue = vi.fn().mockResolvedValue(undefined);
      injectSdk(client, { issue: async () => fake, updateIssue });
      await client.removeLabel("issue-1", "bug");

      expect(labelsSpy).not.toHaveBeenCalled();
      expect(updateIssue).toHaveBeenCalledWith("issue-1", { labelIds: [] });
    });

    it("returns an empty array when there are no labels", async () => {
      const fake = makeFakeIssue({ id: "issue-1", labels: () => Promise.resolve({ nodes: [] }) });
      injectSdk(client, { issue: async () => fake });

      const names = await client.listLabels("issue-1");
      expect(names).toEqual([]);
    });
  });
});
