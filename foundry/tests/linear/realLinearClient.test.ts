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
function makeClient(): { client: RealLinearClient; sdk: any; logger: ReturnType<typeof makeLogger> } {
  const logger = makeLogger();
  const client = new RealLinearClient("test-key", logger as never);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sdk: any = {};
  (client as unknown as { sdk: unknown }).sdk = sdk;
  return { client, sdk, logger };
}

describe("RealLinearClient", () => {
  describe("getRelatedContext blocker hydration failures", () => {
    it("logs a warning and omits a blocker whose relation.issue rejects", async () => {
      const { client, sdk, logger } = makeClient();
      const goodBlocker = {
        id: "blocker-ok",
        identifier: "PRY-2",
        title: "Blocker",
        description: "d",
        priority: 0,
        url: "https://linear.app/blocker-ok",
        labels: () => Promise.resolve({ nodes: [] }),
        state: Promise.resolve({ name: "Todo" }),
      };
      const focus = {
        id: "focus-id",
        parent: Promise.resolve(null),
        inverseRelations: () =>
          Promise.resolve({
            nodes: [
              {
                id: "rel-bad",
                type: "blocks",
                issue: Promise.reject(new Error("hydrate failed")),
              },
              { id: "rel-good", type: "blocks", issue: Promise.resolve(goodBlocker) },
            ],
          }),
      };
      sdk.issue = vi.fn().mockResolvedValue(focus);

      const ctx = await client.getRelatedContext("focus-id");

      expect(ctx.blockers).toHaveLength(1);
      expect(ctx.blockers[0].id).toBe("blocker-ok");
      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ relationId: "rel-bad", focusIssueId: "focus-id" }),
        "Failed to hydrate blocker issue from relation",
      );
    });

    it("treats a null inverseRelations connection as no blockers", async () => {
      const { client, sdk } = makeClient();
      const focus = {
        id: "focus-id",
        parent: Promise.resolve(null),
        inverseRelations: () => Promise.resolve(null),
      };
      sdk.issue = vi.fn().mockResolvedValue(focus);

      const ctx = await client.getRelatedContext("focus-id");

      expect(ctx.blockers).toEqual([]);
    });

    it("defaults labels to [] and state to Unknown for a related issue missing both", async () => {
      const { client, sdk } = makeClient();
      const parent = {
        id: "parent-id",
        identifier: "PRY-100",
        title: "Parent",
        description: "d",
        priority: 0,
        url: "https://linear.app/parent",
        labels: () => Promise.resolve(null),
        state: Promise.resolve(null),
      };
      const focus = {
        id: "focus-id",
        parent: Promise.resolve(parent),
        inverseRelations: () => Promise.resolve({ nodes: [] }),
      };
      sdk.issue = vi.fn().mockResolvedValue(focus);

      const ctx = await client.getRelatedContext("focus-id");

      expect(ctx.parent?.labels).toEqual([]);
      expect(ctx.parent?.state).toBe("Unknown");
    });
  });

  describe("getIssue", () => {
    it("maps an SDK issue to a LinearIssue, resolving related fields", async () => {
      const { client, sdk } = makeClient();
      sdk.issue = vi.fn().mockResolvedValue({
        id: "issue-1",
        identifier: "PRY-1",
        title: "Title",
        description: "Desc",
        branchName: "ai/issue-1",
        priority: 2,
        url: "https://linear.app/team/issue/PRY-1",
        labels: () => Promise.resolve({ nodes: [{ name: "bug" }, { name: "urgent" }] }),
        state: Promise.resolve({ name: "Todo" }),
        project: Promise.resolve({ name: "Project X" }),
        cycle: Promise.resolve({ name: "Cycle 3" }),
        team: Promise.resolve({ key: "PRY" }),
      });

      const issue = await client.getIssue("issue-1");

      expect(sdk.issue).toHaveBeenCalledWith("issue-1");
      expect(issue).toEqual({
        id: "issue-1",
        identifier: "PRY-1",
        title: "Title",
        description: "Desc",
        branchName: "ai/issue-1",
        state: "Todo",
        labels: ["bug", "urgent"],
        priority: 2,
        url: "https://linear.app/team/issue/PRY-1",
        project: "Project X",
        team: "PRY",
        cycle: "Cycle 3",
      });
    });

    it("defaults missing description, state, project, cycle, team and labels", async () => {
      const { client, sdk } = makeClient();
      sdk.issue = vi.fn().mockResolvedValue({
        id: "issue-2",
        identifier: "PRY-2",
        title: "Title",
        description: null,
        branchName: "ai/issue-2",
        priority: 0,
        url: "https://linear.app/team/issue/PRY-2",
        labels: () => Promise.resolve({ nodes: undefined }),
        state: Promise.resolve(null),
        project: Promise.resolve(null),
        cycle: Promise.resolve(null),
        team: Promise.resolve(null),
      });

      const issue = await client.getIssue("issue-2");

      expect(issue.description).toBe("");
      expect(issue.state).toBe("Unknown");
      expect(issue.labels).toEqual([]);
      expect(issue.project).toBeUndefined();
      expect(issue.cycle).toBeUndefined();
      expect(issue.team).toBeUndefined();
    });
  });

  describe("searchIssues", () => {
    it("builds a GraphQL filter from projectName, assigneeMe and team, and maps results", async () => {
      const { client, sdk, logger } = makeClient();
      sdk.issues = vi.fn().mockResolvedValue({
        nodes: [
          {
            id: "i1",
            identifier: "PRY-1",
            title: "Issue 1",
            description: "d1",
            branchName: "ai/i1",
            priority: 1,
            url: "https://linear.app/i1",
            labels: () => Promise.resolve({ nodes: [{ name: "l1" }] }),
            project: Promise.resolve({ name: "Proj" }),
            cycle: Promise.resolve({ name: "Cyc" }),
            team: Promise.resolve({ key: "PRY" }),
          },
        ],
      });

      const results = await client.searchIssues({
        state: "Todo",
        projectName: "Proj",
        assigneeMe: true,
        team: "PRY",
      });

      expect(sdk.issues).toHaveBeenCalledWith({
        filter: {
          state: { name: { eq: "Todo" } },
          project: { name: { eq: "Proj" } },
          assignee: { isMe: { eq: true } },
          team: { or: [{ name: { eq: "PRY" } }, { key: { eq: "PRY" } }] },
        },
      });
      expect(results).toEqual([
        {
          id: "i1",
          identifier: "PRY-1",
          title: "Issue 1",
          description: "d1",
          branchName: "ai/i1",
          state: "Todo",
          labels: ["l1"],
          priority: 1,
          url: "https://linear.app/i1",
          project: "Proj",
          team: "PRY",
          cycle: "Cyc",
        },
      ]);
      expect(logger.info).toHaveBeenCalledWith(
        { projectName: "Proj", assigneeMe: true, team: "PRY", stateName: "Todo", count: 1 },
        "Searched Linear issues",
      );
    });

    it("omits optional filter keys when not provided, and returns an empty array for no matches", async () => {
      const { client, sdk } = makeClient();
      sdk.issues = vi.fn().mockResolvedValue({ nodes: [] });

      const results = await client.searchIssues({ state: "Done" });

      expect(sdk.issues).toHaveBeenCalledWith({
        filter: { state: { name: { eq: "Done" } } },
      });
      expect(results).toEqual([]);
    });

    it("handles a null/undefined issues connection", async () => {
      const { client, sdk } = makeClient();
      sdk.issues = vi.fn().mockResolvedValue(null);

      const results = await client.searchIssues({ state: "Todo" });

      expect(results).toEqual([]);
    });

    it("defaults labels, description, project, team and cycle when the SDK returns null for them", async () => {
      const { client, sdk } = makeClient();
      sdk.issues = vi.fn().mockResolvedValue({
        nodes: [
          {
            id: "i2",
            identifier: "PRY-2",
            title: "Issue 2",
            description: null,
            branchName: "ai/i2",
            priority: 0,
            url: "https://linear.app/i2",
            labels: () => Promise.resolve(null),
            project: Promise.resolve(null),
            cycle: Promise.resolve(null),
            team: Promise.resolve(null),
          },
        ],
      });

      const results = await client.searchIssues({ state: "Todo" });

      expect(results).toEqual([
        {
          id: "i2",
          identifier: "PRY-2",
          title: "Issue 2",
          description: "",
          branchName: "ai/i2",
          state: "Todo",
          labels: [],
          priority: 0,
          url: "https://linear.app/i2",
          project: undefined,
          team: undefined,
          cycle: undefined,
        },
      ]);
    });
  });

  describe("postComment", () => {
    it("creates a comment via the SDK", async () => {
      const { client, sdk, logger } = makeClient();
      sdk.createComment = vi.fn().mockResolvedValue({});

      await client.postComment("issue-1", "hello");

      expect(sdk.createComment).toHaveBeenCalledWith({ issueId: "issue-1", body: "hello" });
      expect(logger.debug).toHaveBeenCalledWith(
        { issueId: "issue-1" },
        "Posted comment to Linear issue",
      );
    });
  });

  describe("updateIssueState", () => {
    it("resolves the state id by name and updates the issue", async () => {
      const { client, sdk, logger } = makeClient();
      sdk.issue = vi.fn().mockResolvedValue({ team: Promise.resolve({ id: "team-1" }) });
      sdk.team = vi.fn().mockResolvedValue({
        states: () =>
          Promise.resolve({
            nodes: [
              { id: "s-todo", name: "Todo" },
              { id: "s-done", name: "Done" },
            ],
          }),
      });
      sdk.updateIssue = vi.fn().mockResolvedValue({});

      await client.updateIssueState("issue-1", "Done");

      expect(sdk.updateIssue).toHaveBeenCalledWith("issue-1", { stateId: "s-done" });
      expect(logger.debug).toHaveBeenCalledWith(
        { issueId: "issue-1", stateName: "Done", stateId: "s-done" },
        "Updated Linear issue state",
      );
    });

    it("caches the state map per team across calls (fetches team states only once)", async () => {
      const { client, sdk } = makeClient();
      sdk.issue = vi.fn().mockResolvedValue({ team: Promise.resolve({ id: "team-1" }) });
      sdk.team = vi.fn().mockResolvedValue({
        states: () => Promise.resolve({ nodes: [{ id: "s-todo", name: "Todo" }] }),
      });
      sdk.updateIssue = vi.fn().mockResolvedValue({});

      await client.updateIssueState("issue-1", "Todo");
      await client.updateIssueState("issue-2", "Todo");

      expect(sdk.team).toHaveBeenCalledTimes(1);
    });

    it("warns and skips when the issue has no team", async () => {
      const { client, sdk, logger } = makeClient();
      sdk.issue = vi.fn().mockResolvedValue({ team: Promise.resolve(null) });
      sdk.updateIssue = vi.fn();

      await client.updateIssueState("issue-1", "Done");

      expect(sdk.updateIssue).not.toHaveBeenCalled();
      expect(logger.warn).toHaveBeenCalledWith(
        { issueId: "issue-1" },
        "Cannot update state: issue has no team",
      );
    });

    it("warns and skips when the state name cannot be found", async () => {
      const { client, sdk, logger } = makeClient();
      sdk.issue = vi.fn().mockResolvedValue({ team: Promise.resolve({ id: "team-1" }) });
      sdk.team = vi.fn().mockResolvedValue({
        states: () => Promise.resolve({ nodes: [{ id: "s-todo", name: "Todo" }] }),
      });
      sdk.updateIssue = vi.fn();

      await client.updateIssueState("issue-1", "Nonexistent");

      expect(sdk.updateIssue).not.toHaveBeenCalled();
      expect(logger.warn).toHaveBeenCalledWith(
        { issueId: "issue-1", stateName: "Nonexistent", teamId: "team-1" },
        "Could not find workflow state by name",
      );
    });

    it("handles a null states connection", async () => {
      const { client, sdk } = makeClient();
      sdk.issue = vi.fn().mockResolvedValue({ team: Promise.resolve({ id: "team-1" }) });
      sdk.team = vi.fn().mockResolvedValue({ states: () => Promise.resolve(null) });
      sdk.updateIssue = vi.fn();

      await client.updateIssueState("issue-1", "Todo");

      expect(sdk.updateIssue).not.toHaveBeenCalled();
    });
  });

  describe("addLabel", () => {
    it("resolves an existing label and adds it to the issue's labelIds", async () => {
      const { client, sdk, logger } = makeClient();
      sdk.issue = vi.fn().mockResolvedValue({
        team: Promise.resolve({ id: "team-1" }),
        labelIds: ["existing-id"],
      });
      sdk.issueLabels = vi.fn().mockResolvedValue({ nodes: [{ id: "label-1", name: "bug" }] });
      sdk.updateIssue = vi.fn().mockResolvedValue({});

      await client.addLabel("issue-1", "bug");

      expect(sdk.issueLabels).toHaveBeenCalledWith({ filter: { name: { eq: "bug" } } });
      expect(sdk.updateIssue).toHaveBeenCalledWith("issue-1", {
        labelIds: ["existing-id", "label-1"],
      });
      expect(logger.debug).toHaveBeenCalledWith(
        { issueId: "issue-1", labelName: "bug", labelId: "label-1" },
        "Added label to Linear issue",
      );
    });

    it("creates a new label (scoped to the issue's team) when none exists", async () => {
      const { client, sdk, logger } = makeClient();
      sdk.issue = vi.fn().mockResolvedValue({
        team: Promise.resolve({ id: "team-1" }),
        labelIds: [],
      });
      sdk.issueLabels = vi.fn().mockResolvedValue({ nodes: [] });
      sdk.createIssueLabel = vi.fn().mockResolvedValue({
        issueLabel: Promise.resolve({ id: "new-label-id" }),
      });
      sdk.updateIssue = vi.fn().mockResolvedValue({});

      await client.addLabel("issue-1", "brand-new");

      expect(sdk.createIssueLabel).toHaveBeenCalledWith({
        name: "brand-new",
        teamId: "team-1",
      });
      expect(sdk.updateIssue).toHaveBeenCalledWith("issue-1", { labelIds: ["new-label-id"] });
      expect(logger.info).toHaveBeenCalledWith(
        { labelName: "brand-new", labelId: "new-label-id" },
        "Created new Linear label",
      );
    });

    it("creates a workspace-level label (no teamId) when the issue has no team", async () => {
      const { client, sdk } = makeClient();
      sdk.issue = vi.fn().mockResolvedValue({ team: Promise.resolve(null), labelIds: [] });
      sdk.issueLabels = vi.fn().mockResolvedValue({ nodes: [] });
      sdk.createIssueLabel = vi.fn().mockResolvedValue({
        issueLabel: Promise.resolve({ id: "new-label-id" }),
      });
      sdk.updateIssue = vi.fn().mockResolvedValue({});

      await client.addLabel("issue-1", "brand-new");

      expect(sdk.createIssueLabel).toHaveBeenCalledWith({ name: "brand-new" });
    });

    it("throws if label creation returns no issueLabel", async () => {
      const { client, sdk } = makeClient();
      sdk.issue = vi.fn().mockResolvedValue({ team: Promise.resolve(null), labelIds: [] });
      sdk.issueLabels = vi.fn().mockResolvedValue({ nodes: [] });
      sdk.createIssueLabel = vi.fn().mockResolvedValue({ issueLabel: Promise.resolve(null) });

      await expect(client.addLabel("issue-1", "brand-new")).rejects.toThrow(
        "Failed to create label: brand-new",
      );
    });

    it("does not duplicate a label already present on the issue", async () => {
      const { client, sdk } = makeClient();
      sdk.issue = vi.fn().mockResolvedValue({
        team: Promise.resolve({ id: "team-1" }),
        labelIds: ["label-1"],
      });
      sdk.issueLabels = vi.fn().mockResolvedValue({ nodes: [{ id: "label-1", name: "bug" }] });
      sdk.updateIssue = vi.fn().mockResolvedValue({});

      await client.addLabel("issue-1", "bug");

      expect(sdk.updateIssue).not.toHaveBeenCalled();
    });

    it("uses the label cache on a second call instead of re-querying issueLabels", async () => {
      const { client, sdk } = makeClient();
      sdk.issue = vi.fn().mockResolvedValue({
        team: Promise.resolve({ id: "team-1" }),
        labelIds: [],
      });
      sdk.issueLabels = vi.fn().mockResolvedValue({ nodes: [{ id: "label-1", name: "bug" }] });
      sdk.updateIssue = vi.fn().mockResolvedValue({});

      await client.addLabel("issue-1", "bug");
      await client.addLabel("issue-2", "bug");

      expect(sdk.issueLabels).toHaveBeenCalledTimes(1);
    });
  });

  describe("removeLabel", () => {
    it("removes a label found via listLabels (populating the cache) on the first call", async () => {
      const { client, sdk, logger } = makeClient();
      sdk.issue = vi.fn().mockResolvedValue({
        labelIds: ["label-1", "label-2"],
        labels: () =>
          Promise.resolve({
            nodes: [
              { id: "label-1", name: "bug" },
              { id: "label-2", name: "urgent" },
            ],
          }),
      });
      sdk.updateIssue = vi.fn().mockResolvedValue({});

      await client.removeLabel("issue-1", "bug");

      expect(sdk.updateIssue).toHaveBeenCalledWith("issue-1", { labelIds: ["label-2"] });
      expect(logger.debug).toHaveBeenCalledWith(
        { issueId: "issue-1", labelName: "bug" },
        "Removed label from Linear issue",
      );
    });

    it("does nothing when the named label isn't present on the issue", async () => {
      const { client, sdk } = makeClient();
      sdk.issue = vi.fn().mockResolvedValue({
        labelIds: ["label-2"],
        labels: () => Promise.resolve({ nodes: [{ id: "label-2", name: "urgent" }] }),
      });
      sdk.updateIssue = vi.fn();

      await client.removeLabel("issue-1", "missing-label");

      expect(sdk.updateIssue).not.toHaveBeenCalled();
    });

    it("uses the cached label id on a subsequent call instead of re-listing labels", async () => {
      const { client, sdk } = makeClient();
      sdk.issue = vi.fn().mockResolvedValue({
        labelIds: ["label-1"],
        labels: () => Promise.resolve({ nodes: [{ id: "label-1", name: "bug" }] }),
      });
      sdk.updateIssue = vi.fn().mockResolvedValue({});

      // First call populates the cache via listLabels-equivalent lookup path.
      await client.removeLabel("issue-1", "bug");

      const labelsSpy = vi.fn().mockResolvedValue({ nodes: [{ id: "label-1", name: "bug" }] });
      sdk.issue = vi.fn().mockResolvedValue({ labelIds: ["label-1"], labels: labelsSpy });

      await client.removeLabel("issue-2", "bug");

      expect(labelsSpy).not.toHaveBeenCalled();
      expect(sdk.updateIssue).toHaveBeenLastCalledWith("issue-2", { labelIds: [] });
    });
  });

  describe("listLabels", () => {
    it("returns label names and populates the label cache", async () => {
      const { client, sdk } = makeClient();
      sdk.issue = vi.fn().mockResolvedValue({
        labels: () =>
          Promise.resolve({
            nodes: [
              { id: "label-1", name: "bug" },
              { id: "label-2", name: "urgent" },
            ],
          }),
      });

      const names = await client.listLabels("issue-1");

      expect(names).toEqual(["bug", "urgent"]);

      // Cache populated: removeLabel for "bug" should not need to call labels() again.
      sdk.updateIssue = vi.fn().mockResolvedValue({});
      const labelsSpy = vi.fn();
      sdk.issue = vi.fn().mockResolvedValue({ labelIds: ["label-1"], labels: labelsSpy });
      await client.removeLabel("issue-1", "bug");
      expect(labelsSpy).not.toHaveBeenCalled();
    });

    it("handles a null labels connection", async () => {
      const { client, sdk } = makeClient();
      sdk.issue = vi.fn().mockResolvedValue({ labels: () => Promise.resolve(null) });

      const names = await client.listLabels("issue-1");

      expect(names).toEqual([]);
    });
  });
});
