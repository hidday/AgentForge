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
  state: Promise<{ id: string; name: string } | undefined>;
  project: Promise<{ name: string } | undefined>;
  cycle: Promise<{ name: string } | undefined>;
  team: Promise<{ id: string; key: string } | undefined>;
  labels: () => Promise<{ nodes: Array<{ id: string; name: string }> } | undefined>;
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
    project: Promise.resolve({ name: "Project X" }),
    cycle: Promise.resolve({ name: "Cycle 1" }),
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

interface FakeSdk {
  issue: ReturnType<typeof vi.fn>;
  issues: ReturnType<typeof vi.fn>;
  createComment: ReturnType<typeof vi.fn>;
  updateIssue: ReturnType<typeof vi.fn>;
  team: ReturnType<typeof vi.fn>;
  issueLabels: ReturnType<typeof vi.fn>;
  createIssueLabel: ReturnType<typeof vi.fn>;
}

function makeFakeSdk(): FakeSdk {
  return {
    issue: vi.fn(),
    issues: vi.fn(),
    createComment: vi.fn().mockResolvedValue(undefined),
    updateIssue: vi.fn().mockResolvedValue(undefined),
    team: vi.fn(),
    issueLabels: vi.fn(),
    createIssueLabel: vi.fn(),
  };
}

function install(client: RealLinearClient, sdk: FakeSdk): void {
  (client as unknown as { sdk: FakeSdk }).sdk = sdk;
}

describe("RealLinearClient", () => {
  let client: RealLinearClient;
  let sdk: FakeSdk;
  let logger: ReturnType<typeof makeLogger>;

  beforeEach(() => {
    logger = makeLogger();
    client = new RealLinearClient("test-key", logger as never);
    sdk = makeFakeSdk();
    install(client, sdk);
  });

  describe("getIssue", () => {
    it("maps all fields when project, cycle, team, and state are present", async () => {
      const fake = makeFakeIssue({
        id: "issue-1",
        identifier: "PRY-1",
        labels: () => Promise.resolve({ nodes: [{ id: "l1", name: "bug" }] }),
      });
      sdk.issue.mockResolvedValue(fake);

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
        cycle: "Cycle 1",
      });
    });

    it("falls back to defaults when description, state, project, cycle, team, and labels are missing", async () => {
      const fake = makeFakeIssue({
        id: "issue-2",
        description: null,
        state: Promise.resolve(undefined),
        project: Promise.resolve(undefined),
        cycle: Promise.resolve(undefined),
        team: Promise.resolve(undefined),
        labels: () => Promise.resolve(undefined),
      });
      sdk.issue.mockResolvedValue(fake);

      const result = await client.getIssue("issue-2");

      expect(result.description).toBe("");
      expect(result.state).toBe("Unknown");
      expect(result.project).toBeUndefined();
      expect(result.team).toBeUndefined();
      expect(result.cycle).toBeUndefined();
      expect(result.labels).toEqual([]);
    });
  });

  describe("searchIssues", () => {
    it("builds a base filter from state only and maps each result", async () => {
      const issue1 = makeFakeIssue({
        id: "i1",
        labels: () => Promise.resolve({ nodes: [{ id: "l1", name: "bug" }] }),
      });
      sdk.issues.mockResolvedValue({ nodes: [issue1] });

      const results = await client.searchIssues({ state: "Todo" });

      expect(sdk.issues).toHaveBeenCalledWith({ filter: { state: { name: { eq: "Todo" } } } });
      expect(results).toHaveLength(1);
      expect(results[0]).toEqual({
        id: "i1",
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
        cycle: "Cycle 1",
      });
      expect(logger.info).toHaveBeenCalledWith(
        expect.objectContaining({ count: 1 }),
        "Searched Linear issues",
      );
    });

    it("adds projectName, assigneeMe, and team clauses to the GraphQL filter when provided", async () => {
      sdk.issues.mockResolvedValue({ nodes: [] });

      await client.searchIssues({
        state: "In Progress",
        projectName: "Project X",
        assigneeMe: true,
        team: "PRY",
      });

      expect(sdk.issues).toHaveBeenCalledWith({
        filter: {
          state: { name: { eq: "In Progress" } },
          project: { name: { eq: "Project X" } },
          assignee: { isMe: { eq: true } },
          team: { or: [{ name: { eq: "PRY" } }, { key: { eq: "PRY" } }] },
        },
      });
    });

    it("returns an empty array and does not throw when the connection has no nodes", async () => {
      sdk.issues.mockResolvedValue(undefined);

      const results = await client.searchIssues({ state: "Todo" });

      expect(results).toEqual([]);
    });

    it("maps results with undefined project, team, cycle, labels, and null description when absent", async () => {
      const issue = makeFakeIssue({
        id: "i2",
        description: null,
        project: Promise.resolve(undefined),
        cycle: Promise.resolve(undefined),
        team: Promise.resolve(undefined),
        labels: () => Promise.resolve(undefined),
      });
      sdk.issues.mockResolvedValue({ nodes: [issue] });

      const results = await client.searchIssues({ state: "Todo" });

      expect(results[0].project).toBeUndefined();
      expect(results[0].team).toBeUndefined();
      expect(results[0].cycle).toBeUndefined();
      expect(results[0].labels).toEqual([]);
      expect(results[0].description).toBe("");
    });
  });

  describe("getRelatedContext edge cases", () => {
    it("treats a missing inverseRelations connection as having no blockers", async () => {
      const focus = makeFakeIssue({ id: "focus-id" });
      const focusWithRelations = focus as unknown as FakeIssue & {
        parent: Promise<undefined>;
        inverseRelations: () => Promise<undefined>;
      };
      focusWithRelations.parent = Promise.resolve(undefined);
      focusWithRelations.inverseRelations = () => Promise.resolve(undefined);
      sdk.issue.mockResolvedValue(focusWithRelations);

      const ctx = await client.getRelatedContext("focus-id");

      expect(ctx.blockers).toEqual([]);
    });

    it("defaults a related issue's labels to [] and state to 'Unknown' when both are missing", async () => {
      const parent = makeFakeIssue({
        id: "parent-id",
        identifier: "PRY-900",
        labels: () => Promise.resolve(undefined),
        state: Promise.resolve(undefined),
      });
      const focus = makeFakeIssue({ id: "focus-id" });
      const focusWithRelations = focus as unknown as FakeIssue & {
        parent: Promise<FakeIssue>;
        inverseRelations: () => Promise<{ nodes: never[] }>;
      };
      focusWithRelations.parent = Promise.resolve(parent);
      focusWithRelations.inverseRelations = () => Promise.resolve({ nodes: [] });
      sdk.issue.mockResolvedValue(focusWithRelations);

      const ctx = await client.getRelatedContext("focus-id");

      expect(ctx.parent?.labels).toEqual([]);
      expect(ctx.parent?.state).toBe("Unknown");
    });
  });

  describe("getRelatedContext error handling", () => {
    it("logs a warning and drops a blocker whose relation.issue promise rejects", async () => {
      const goodBlocker = makeFakeIssue({ id: "blocker-good", identifier: "PRY-500" });
      const focus = makeFakeIssue({
        id: "focus-id",
        state: Promise.resolve(undefined),
      });
      // Attach parent/inverseRelations directly since makeFakeIssue's shape for
      // getRelatedContext differs slightly (parent/inverseRelations aren't part
      // of the FakeIssue type used for getIssue/searchIssues tests above).
      const focusWithRelations = focus as unknown as FakeIssue & {
        parent: Promise<undefined>;
        inverseRelations: () => Promise<{
          nodes: Array<{ id: string; type: string; issue: Promise<unknown> }>;
        }>;
      };
      focusWithRelations.parent = Promise.resolve(undefined);
      focusWithRelations.inverseRelations = () =>
        Promise.resolve({
          nodes: [
            { id: "rel-bad", type: "blocks", issue: Promise.reject(new Error("hydrate failed")) },
            { id: "rel-good", type: "blocks", issue: Promise.resolve(goodBlocker) },
          ],
        });

      sdk.issue.mockResolvedValue(focusWithRelations);

      const ctx = await client.getRelatedContext("focus-id");

      expect(ctx.blockers).toHaveLength(1);
      expect(ctx.blockers[0].id).toBe("blocker-good");
      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ relationId: "rel-bad", focusIssueId: "focus-id" }),
        "Failed to hydrate blocker issue from relation",
      );
    });
  });

  describe("postComment", () => {
    it("calls sdk.createComment with issueId and body and logs debug", async () => {
      await client.postComment("issue-1", "Hello world");

      expect(sdk.createComment).toHaveBeenCalledWith({ issueId: "issue-1", body: "Hello world" });
      expect(logger.debug).toHaveBeenCalledWith(
        { issueId: "issue-1" },
        "Posted comment to Linear issue",
      );
    });
  });

  describe("updateIssueState", () => {
    it("warns and does not update when the issue has no team", async () => {
      const fake = makeFakeIssue({ id: "issue-1", team: Promise.resolve(undefined) });
      sdk.issue.mockResolvedValue(fake);

      await client.updateIssueState("issue-1", "Done");

      expect(logger.warn).toHaveBeenCalledWith(
        { issueId: "issue-1" },
        "Cannot update state: issue has no team",
      );
      expect(sdk.updateIssue).not.toHaveBeenCalled();
    });

    it("warns and does not update when the named state cannot be resolved", async () => {
      const fake = makeFakeIssue({ id: "issue-1" });
      sdk.issue.mockResolvedValue(fake);
      sdk.team.mockResolvedValue({
        states: () => Promise.resolve({ nodes: [{ id: "s1", name: "Todo" }] }),
      });

      await client.updateIssueState("issue-1", "NonexistentState");

      expect(logger.warn).toHaveBeenCalledWith(
        { issueId: "issue-1", stateName: "NonexistentState", teamId: "team-1" },
        "Could not find workflow state by name",
      );
      expect(sdk.updateIssue).not.toHaveBeenCalled();
    });

    it("resolves the state id and updates the issue when the state is found", async () => {
      const fake = makeFakeIssue({ id: "issue-1" });
      sdk.issue.mockResolvedValue(fake);
      sdk.team.mockResolvedValue({
        states: () => Promise.resolve({ nodes: [{ id: "s1", name: "Done" }] }),
      });

      await client.updateIssueState("issue-1", "Done");

      expect(sdk.updateIssue).toHaveBeenCalledWith("issue-1", { stateId: "s1" });
      expect(logger.debug).toHaveBeenCalledWith(
        { issueId: "issue-1", stateName: "Done", stateId: "s1" },
        "Updated Linear issue state",
      );
    });

    it("caches the team's state map across calls, calling sdk.team only once", async () => {
      const fake = makeFakeIssue({ id: "issue-1" });
      sdk.issue.mockResolvedValue(fake);
      sdk.team.mockResolvedValue({
        states: () => Promise.resolve({ nodes: [{ id: "s1", name: "Done" }] }),
      });

      await client.updateIssueState("issue-1", "Done");
      await client.updateIssueState("issue-1", "Done");

      expect(sdk.team).toHaveBeenCalledTimes(1);
      expect(sdk.updateIssue).toHaveBeenCalledTimes(2);
    });

    it("handles a team states connection with no nodes", async () => {
      const fake = makeFakeIssue({ id: "issue-1" });
      sdk.issue.mockResolvedValue(fake);
      sdk.team.mockResolvedValue({ states: () => Promise.resolve(undefined) });

      await client.updateIssueState("issue-1", "Done");

      expect(sdk.updateIssue).not.toHaveBeenCalled();
      expect(logger.warn).toHaveBeenCalled();
    });
  });

  describe("addLabel", () => {
    it("resolves an existing label via issueLabels and adds it to the issue", async () => {
      const fake = makeFakeIssue({ id: "issue-1", labelIds: ["existing-id"] });
      sdk.issue.mockResolvedValue(fake);
      sdk.issueLabels.mockResolvedValue({ nodes: [{ id: "label-1", name: "bug" }] });

      await client.addLabel("issue-1", "bug");

      expect(sdk.issueLabels).toHaveBeenCalledWith({ filter: { name: { eq: "bug" } } });
      expect(sdk.createIssueLabel).not.toHaveBeenCalled();
      expect(sdk.updateIssue).toHaveBeenCalledWith("issue-1", {
        labelIds: ["existing-id", "label-1"],
      });
    });

    it("creates a new label with the issue's team id when none exists yet", async () => {
      const fake = makeFakeIssue({ id: "issue-1", labelIds: [] });
      sdk.issue.mockResolvedValue(fake);
      sdk.issueLabels.mockResolvedValue({ nodes: [] });
      sdk.createIssueLabel.mockResolvedValue({
        issueLabel: Promise.resolve({ id: "new-label-id", name: "feature" }),
      });

      await client.addLabel("issue-1", "feature");

      expect(sdk.createIssueLabel).toHaveBeenCalledWith({ name: "feature", teamId: "team-1" });
      expect(sdk.updateIssue).toHaveBeenCalledWith("issue-1", { labelIds: ["new-label-id"] });
      expect(logger.info).toHaveBeenCalledWith(
        { labelName: "feature", labelId: "new-label-id" },
        "Created new Linear label",
      );
    });

    it("creates a new label without teamId when the issue has no team", async () => {
      const fake = makeFakeIssue({ id: "issue-1", labelIds: [], team: Promise.resolve(undefined) });
      sdk.issue.mockResolvedValue(fake);
      sdk.issueLabels.mockResolvedValue({ nodes: [] });
      sdk.createIssueLabel.mockResolvedValue({
        issueLabel: Promise.resolve({ id: "new-label-id", name: "feature" }),
      });

      await client.addLabel("issue-1", "feature");

      expect(sdk.createIssueLabel).toHaveBeenCalledWith({ name: "feature" });
    });

    it("throws when label creation succeeds but returns no issueLabel", async () => {
      const fake = makeFakeIssue({ id: "issue-1", labelIds: [] });
      sdk.issue.mockResolvedValue(fake);
      sdk.issueLabels.mockResolvedValue({ nodes: [] });
      sdk.createIssueLabel.mockResolvedValue({ issueLabel: Promise.resolve(undefined) });

      await expect(client.addLabel("issue-1", "broken")).rejects.toThrow(
        "Failed to create label: broken",
      );
    });

    it("does not duplicate a label id already present on the issue", async () => {
      const fake = makeFakeIssue({ id: "issue-1", labelIds: ["label-1"] });
      sdk.issue.mockResolvedValue(fake);
      sdk.issueLabels.mockResolvedValue({ nodes: [{ id: "label-1", name: "bug" }] });

      await client.addLabel("issue-1", "bug");

      expect(sdk.updateIssue).not.toHaveBeenCalled();
    });

    it("uses the label cache on a second call, skipping issueLabels lookup", async () => {
      const fake1 = makeFakeIssue({ id: "issue-1", labelIds: [] });
      const fake2 = makeFakeIssue({ id: "issue-2", labelIds: [] });
      sdk.issue.mockResolvedValueOnce(fake1).mockResolvedValueOnce(fake2);
      sdk.issueLabels.mockResolvedValue({ nodes: [{ id: "label-1", name: "bug" }] });

      await client.addLabel("issue-1", "bug");
      await client.addLabel("issue-2", "bug");

      expect(sdk.issueLabels).toHaveBeenCalledTimes(1);
      expect(sdk.updateIssue).toHaveBeenNthCalledWith(2, "issue-2", { labelIds: ["label-1"] });
    });
  });

  describe("removeLabel", () => {
    it("removes a label found via the issue's labels() connection and caches its id", async () => {
      const fake = makeFakeIssue({
        id: "issue-1",
        labelIds: ["label-1", "label-2"],
        labels: () =>
          Promise.resolve({
            nodes: [
              { id: "label-1", name: "bug" },
              { id: "label-2", name: "urgent" },
            ],
          }),
      });
      sdk.issue.mockResolvedValue(fake);

      await client.removeLabel("issue-1", "bug");

      expect(sdk.updateIssue).toHaveBeenCalledWith("issue-1", { labelIds: ["label-2"] });
    });

    it("is a no-op when the named label is not found on the issue", async () => {
      const fake = makeFakeIssue({
        id: "issue-1",
        labelIds: ["label-2"],
        labels: () => Promise.resolve({ nodes: [{ id: "label-2", name: "urgent" }] }),
      });
      sdk.issue.mockResolvedValue(fake);

      await client.removeLabel("issue-1", "missing-label");

      expect(sdk.updateIssue).not.toHaveBeenCalled();
    });

    it("uses the cached label id on a subsequent call without re-fetching labels()", async () => {
      const labelsSpy = vi.fn().mockResolvedValue({ nodes: [{ id: "label-1", name: "bug" }] });
      const fake1 = makeFakeIssue({
        id: "issue-1",
        labelIds: ["label-1"],
        labels: labelsSpy,
      });
      const fake2 = makeFakeIssue({
        id: "issue-2",
        labelIds: ["label-1", "label-3"],
        labels: labelsSpy,
      });
      sdk.issue.mockResolvedValueOnce(fake1).mockResolvedValueOnce(fake2);

      await client.removeLabel("issue-1", "bug");
      expect(labelsSpy).toHaveBeenCalledTimes(1);

      await client.removeLabel("issue-2", "bug");
      // Cached path does not call labels() again.
      expect(labelsSpy).toHaveBeenCalledTimes(1);
      expect(sdk.updateIssue).toHaveBeenNthCalledWith(2, "issue-2", { labelIds: ["label-3"] });
    });

    it("handles a missing labels() connection gracefully when uncached (no match)", async () => {
      const fake = makeFakeIssue({
        id: "issue-1",
        labelIds: [],
        labels: () => Promise.resolve(undefined),
      });
      sdk.issue.mockResolvedValue(fake);

      await client.removeLabel("issue-1", "bug");

      expect(sdk.updateIssue).not.toHaveBeenCalled();
    });
  });

  describe("listLabels", () => {
    it("returns label names and populates the label cache", async () => {
      const fake = makeFakeIssue({
        id: "issue-1",
        labels: () =>
          Promise.resolve({
            nodes: [
              { id: "label-1", name: "bug" },
              { id: "label-2", name: "urgent" },
            ],
          }),
      });
      sdk.issue.mockResolvedValue(fake);

      const names = await client.listLabels("issue-1");

      expect(names).toEqual(["bug", "urgent"]);

      // Now removeLabel for "bug" should use the cache populated by listLabels,
      // i.e. not call labels() again.
      const labelsSpy = vi.fn();
      const fake2 = makeFakeIssue({ id: "issue-1", labelIds: ["label-1"], labels: labelsSpy });
      sdk.issue.mockResolvedValue(fake2);
      await client.removeLabel("issue-1", "bug");
      expect(labelsSpy).not.toHaveBeenCalled();
    });

    it("returns an empty array when the issue has no labels connection", async () => {
      const fake = makeFakeIssue({ id: "issue-1", labels: () => Promise.resolve(undefined) });
      sdk.issue.mockResolvedValue(fake);

      const names = await client.listLabels("issue-1");

      expect(names).toEqual([]);
    });
  });
});
