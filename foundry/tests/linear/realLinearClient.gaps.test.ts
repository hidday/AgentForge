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
type FakeSdk = Record<string, any>;

describe("RealLinearClient (gaps beyond getRelatedContext)", () => {
  let client: RealLinearClient;
  let sdk: FakeSdk;

  beforeEach(() => {
    client = new RealLinearClient("test-key", makeLogger() as never);
    sdk = {};
    (client as unknown as { sdk: FakeSdk }).sdk = sdk;
  });

  describe("getRelatedContext blocker hydration failure", () => {
    it("warns and drops a blocker whose relation.issue rejects", async () => {
      const okBlocker = {
        id: "blocker-ok",
        identifier: "PRY-101",
        title: "OK blocker",
        description: "d",
        labels: () => Promise.resolve({ nodes: [] }),
        state: Promise.resolve({ name: "Todo" }),
        priority: 0,
        url: "https://linear.app/ok",
      };
      const focusIssue = {
        id: "focus-id",
        parent: Promise.resolve(null),
        inverseRelations: () =>
          Promise.resolve({
            nodes: [
              {
                id: "rel-bad",
                type: "blocks",
                issue: Promise.reject(new Error("hydration failed")),
              },
              { id: "rel-ok", type: "blocks", issue: Promise.resolve(okBlocker) },
            ],
          }),
      };
      sdk.issue = vi.fn().mockResolvedValue(focusIssue);

      const ctx = await client.getRelatedContext("focus-id");

      expect(ctx.blockers).toHaveLength(1);
      expect(ctx.blockers[0].id).toBe("blocker-ok");
    });
  });

  describe("getRelatedContext edge branches", () => {
    it("treats an inverseRelations connection with no nodes as empty", async () => {
      const focusIssue = {
        id: "focus-id",
        parent: Promise.resolve(null),
        inverseRelations: () => Promise.resolve({ nodes: undefined }),
      };
      sdk.issue = vi.fn().mockResolvedValue(focusIssue);

      const ctx = await client.getRelatedContext("focus-id");

      expect(ctx.blockers).toEqual([]);
    });

    it("defaults labels to [] and state to 'Unknown' for a related issue missing both", async () => {
      const parent = {
        id: "parent-id",
        identifier: "PRY-100",
        title: "Parent",
        description: "d",
        labels: () => Promise.resolve(undefined),
        state: Promise.resolve(undefined),
      };
      const focusIssue = {
        id: "focus-id",
        parent: Promise.resolve(parent),
        inverseRelations: () => Promise.resolve({ nodes: [] }),
      };
      sdk.issue = vi.fn().mockResolvedValue(focusIssue);

      const ctx = await client.getRelatedContext("focus-id");

      expect(ctx.parent?.labels).toEqual([]);
      expect(ctx.parent?.state).toBe("Unknown");
    });
  });

  describe("getIssue", () => {
    it("maps sdk issue fields, defaulting null description and missing optional fields", async () => {
      sdk.issue = vi.fn().mockResolvedValue({
        id: "i1",
        identifier: "PRY-1",
        title: "T1",
        description: null,
        branchName: "ai/i1",
        priority: 1,
        url: "https://linear.app/i1",
        labels: () => Promise.resolve({ nodes: [{ name: "l1" }] }),
        state: Promise.resolve({ name: "Todo" }),
        project: Promise.resolve(null),
        cycle: Promise.resolve(null),
        team: Promise.resolve(null),
      });

      const result = await client.getIssue("i1");

      expect(result).toEqual({
        id: "i1",
        identifier: "PRY-1",
        title: "T1",
        description: "",
        branchName: "ai/i1",
        state: "Todo",
        labels: ["l1"],
        priority: 1,
        url: "https://linear.app/i1",
        project: undefined,
        team: undefined,
        cycle: undefined,
      });
    });

    it("falls back to 'Unknown' state and empty labels when connections are absent", async () => {
      sdk.issue = vi.fn().mockResolvedValue({
        id: "i2",
        identifier: "PRY-2",
        title: "T2",
        description: "d2",
        branchName: "ai/i2",
        priority: 2,
        url: "https://linear.app/i2",
        labels: () => Promise.resolve(undefined),
        state: Promise.resolve(undefined),
        project: Promise.resolve({ name: "Proj" }),
        cycle: Promise.resolve({ name: "Cycle1" }),
        team: Promise.resolve({ key: "PRY" }),
      });

      const result = await client.getIssue("i2");

      expect(result.state).toBe("Unknown");
      expect(result.labels).toEqual([]);
      expect(result.project).toBe("Proj");
      expect(result.cycle).toBe("Cycle1");
      expect(result.team).toBe("PRY");
    });
  });

  describe("searchIssues", () => {
    function makeSdkIssueNode(overrides: Record<string, unknown> = {}) {
      return {
        id: "node-1",
        identifier: "PRY-10",
        title: "Node title",
        description: "Node desc",
        branchName: "ai/node",
        priority: 0,
        url: "https://linear.app/node",
        labels: () => Promise.resolve({ nodes: [{ name: "bug" }] }),
        project: Promise.resolve({ name: "Proj" }),
        cycle: Promise.resolve({ name: "Cycle" }),
        team: Promise.resolve({ key: "PRY" }),
        ...overrides,
      };
    }

    it("filters by state only when no other filters are provided", async () => {
      sdk.issues = vi.fn().mockResolvedValue({ nodes: [makeSdkIssueNode()] });

      const results = await client.searchIssues({ state: "Todo" });

      expect(sdk.issues).toHaveBeenCalledWith({
        filter: { state: { name: { eq: "Todo" } } },
      });
      expect(results).toEqual([
        {
          id: "node-1",
          identifier: "PRY-10",
          title: "Node title",
          description: "Node desc",
          branchName: "ai/node",
          state: "Todo",
          labels: ["bug"],
          priority: 0,
          url: "https://linear.app/node",
          project: "Proj",
          team: "PRY",
          cycle: "Cycle",
        },
      ]);
    });

    it("adds a project filter when projectName is set", async () => {
      sdk.issues = vi.fn().mockResolvedValue({ nodes: [] });

      await client.searchIssues({ state: "Todo", projectName: "Alpha" });

      expect(sdk.issues).toHaveBeenCalledWith({
        filter: {
          state: { name: { eq: "Todo" } },
          project: { name: { eq: "Alpha" } },
        },
      });
    });

    it("adds an assignee filter when assigneeMe is true", async () => {
      sdk.issues = vi.fn().mockResolvedValue({ nodes: [] });

      await client.searchIssues({ state: "Todo", assigneeMe: true });

      expect(sdk.issues).toHaveBeenCalledWith({
        filter: {
          state: { name: { eq: "Todo" } },
          assignee: { isMe: { eq: true } },
        },
      });
    });

    it("does not add an assignee filter when assigneeMe is false", async () => {
      sdk.issues = vi.fn().mockResolvedValue({ nodes: [] });

      await client.searchIssues({ state: "Todo", assigneeMe: false });

      expect(sdk.issues).toHaveBeenCalledWith({
        filter: { state: { name: { eq: "Todo" } } },
      });
    });

    it("adds a team filter (matching name or key) when team is set", async () => {
      sdk.issues = vi.fn().mockResolvedValue({ nodes: [] });

      await client.searchIssues({ state: "Todo", team: "PRY" });

      expect(sdk.issues).toHaveBeenCalledWith({
        filter: {
          state: { name: { eq: "Todo" } },
          team: { or: [{ name: { eq: "PRY" } }, { key: { eq: "PRY" } }] },
        },
      });
    });

    it("combines projectName, assigneeMe, and team filters together", async () => {
      sdk.issues = vi.fn().mockResolvedValue({ nodes: [] });

      await client.searchIssues({
        state: "In Progress",
        projectName: "Alpha",
        assigneeMe: true,
        team: "PRY",
      });

      expect(sdk.issues).toHaveBeenCalledWith({
        filter: {
          state: { name: { eq: "In Progress" } },
          project: { name: { eq: "Alpha" } },
          assignee: { isMe: { eq: true } },
          team: { or: [{ name: { eq: "PRY" } }, { key: { eq: "PRY" } }] },
        },
      });
    });

    it("returns an empty array when the connection has no nodes", async () => {
      sdk.issues = vi.fn().mockResolvedValue({ nodes: undefined });

      const results = await client.searchIssues({ state: "Todo" });

      expect(results).toEqual([]);
    });

    it("defaults labels/description/project/team/cycle when a result node lacks them", async () => {
      sdk.issues = vi.fn().mockResolvedValue({
        nodes: [
          {
            id: "node-2",
            identifier: "PRY-11",
            title: "Bare node",
            description: null,
            branchName: "ai/bare",
            priority: 0,
            url: "https://linear.app/bare",
            labels: () => Promise.resolve(undefined),
            project: Promise.resolve(null),
            cycle: Promise.resolve(null),
            team: Promise.resolve(null),
          },
        ],
      });

      const [result] = await client.searchIssues({ state: "Todo" });

      expect(result.labels).toEqual([]);
      expect(result.description).toBe("");
      expect(result.project).toBeUndefined();
      expect(result.team).toBeUndefined();
      expect(result.cycle).toBeUndefined();
    });
  });

  describe("postComment", () => {
    it("calls sdk.createComment with issueId and body", async () => {
      sdk.createComment = vi.fn().mockResolvedValue(undefined);

      await client.postComment("issue-1", "a comment");

      expect(sdk.createComment).toHaveBeenCalledWith({ issueId: "issue-1", body: "a comment" });
    });
  });

  describe("updateIssueState", () => {
    it("warns and returns without updating when the issue has no team", async () => {
      sdk.issue = vi.fn().mockResolvedValue({ team: Promise.resolve(null) });
      sdk.updateIssue = vi.fn();

      await client.updateIssueState("issue-1", "Done");

      expect(sdk.updateIssue).not.toHaveBeenCalled();
    });

    it("warns and returns without updating when the state name is not found for the team", async () => {
      sdk.issue = vi.fn().mockResolvedValue({ team: Promise.resolve({ id: "team-1" }) });
      sdk.team = vi.fn().mockResolvedValue({
        states: () => Promise.resolve({ nodes: [{ id: "s1", name: "Todo" }] }),
      });
      sdk.updateIssue = vi.fn();

      await client.updateIssueState("issue-1", "Nonexistent State");

      expect(sdk.updateIssue).not.toHaveBeenCalled();
    });

    it("resolves the state id and updates the issue on success", async () => {
      sdk.issue = vi.fn().mockResolvedValue({ team: Promise.resolve({ id: "team-1" }) });
      sdk.team = vi.fn().mockResolvedValue({
        states: () => Promise.resolve({ nodes: [{ id: "s1", name: "Done" }] }),
      });
      sdk.updateIssue = vi.fn().mockResolvedValue(undefined);

      await client.updateIssueState("issue-1", "Done");

      expect(sdk.updateIssue).toHaveBeenCalledWith("issue-1", { stateId: "s1" });
    });

    it("treats a states connection with no nodes as empty (state stays unresolved)", async () => {
      sdk.issue = vi.fn().mockResolvedValue({ team: Promise.resolve({ id: "team-1" }) });
      sdk.team = vi.fn().mockResolvedValue({
        states: () => Promise.resolve({ nodes: undefined }),
      });
      sdk.updateIssue = vi.fn();

      await client.updateIssueState("issue-1", "Done");

      expect(sdk.updateIssue).not.toHaveBeenCalled();
    });

    it("caches the team's state map so a second call does not refetch via sdk.team", async () => {
      sdk.issue = vi.fn().mockResolvedValue({ team: Promise.resolve({ id: "team-1" }) });
      sdk.team = vi.fn().mockResolvedValue({
        states: () => Promise.resolve({ nodes: [{ id: "s1", name: "Done" }] }),
      });
      sdk.updateIssue = vi.fn().mockResolvedValue(undefined);

      await client.updateIssueState("issue-1", "Done");
      await client.updateIssueState("issue-1", "Done");

      expect(sdk.team).toHaveBeenCalledTimes(1);
      expect(sdk.updateIssue).toHaveBeenCalledTimes(2);
    });
  });

  describe("addLabel", () => {
    it("adds a newly created label id to the issue's labelIds when not already present", async () => {
      sdk.issue = vi.fn().mockResolvedValue({
        team: Promise.resolve({ id: "team-1" }),
        labelIds: ["existing-id"],
      });
      sdk.issueLabels = vi.fn().mockResolvedValue({ nodes: [] });
      sdk.createIssueLabel = vi.fn().mockResolvedValue({
        issueLabel: Promise.resolve({ id: "new-label-id" }),
      });
      sdk.updateIssue = vi.fn().mockResolvedValue(undefined);

      await client.addLabel("issue-1", "bug");

      expect(sdk.updateIssue).toHaveBeenCalledWith("issue-1", {
        labelIds: ["existing-id", "new-label-id"],
      });
    });

    it("does not call updateIssue when the resolved label id is already present", async () => {
      sdk.issue = vi.fn().mockResolvedValue({
        team: Promise.resolve({ id: "team-1" }),
        labelIds: ["label-id"],
      });
      sdk.issueLabels = vi.fn().mockResolvedValue({ nodes: [{ id: "label-id", name: "bug" }] });
      sdk.updateIssue = vi.fn();

      await client.addLabel("issue-1", "bug");

      expect(sdk.updateIssue).not.toHaveBeenCalled();
    });

    it("works when the issue has no team (passes no teamId to createIssueLabel)", async () => {
      sdk.issue = vi.fn().mockResolvedValue({
        team: Promise.resolve(null),
        labelIds: [],
      });
      sdk.issueLabels = vi.fn().mockResolvedValue({ nodes: [] });
      sdk.createIssueLabel = vi.fn().mockResolvedValue({
        issueLabel: Promise.resolve({ id: "new-label-id" }),
      });
      sdk.updateIssue = vi.fn().mockResolvedValue(undefined);

      await client.addLabel("issue-1", "bug");

      expect(sdk.createIssueLabel).toHaveBeenCalledWith({ name: "bug" });
    });
  });

  describe("removeLabel", () => {
    it("looks up the label via issue.labels(), removes it, and caches the id", async () => {
      const labelsFn = vi.fn().mockResolvedValue({ nodes: [{ id: "l1", name: "bug" }] });
      sdk.issue = vi.fn().mockResolvedValue({
        labelIds: ["l1", "l2"],
        labels: labelsFn,
      });
      sdk.updateIssue = vi.fn().mockResolvedValue(undefined);

      await client.removeLabel("issue-1", "bug");

      expect(sdk.updateIssue).toHaveBeenCalledWith("issue-1", { labelIds: ["l2"] });
      expect(labelsFn).toHaveBeenCalledTimes(1);
    });

    it("returns early without updating when the label is not found on the issue", async () => {
      sdk.issue = vi.fn().mockResolvedValue({
        labelIds: ["l1"],
        labels: () => Promise.resolve({ nodes: [{ id: "l1", name: "other" }] }),
      });
      sdk.updateIssue = vi.fn();

      await client.removeLabel("issue-1", "bug");

      expect(sdk.updateIssue).not.toHaveBeenCalled();
    });

    it("uses the cached label id on a subsequent call, skipping issue.labels()", async () => {
      const labelsFn = vi.fn().mockResolvedValue({ nodes: [{ id: "l1", name: "bug" }] });
      sdk.issue = vi.fn().mockResolvedValue({
        labelIds: ["l1", "l2"],
        labels: labelsFn,
      });
      sdk.updateIssue = vi.fn().mockResolvedValue(undefined);

      await client.removeLabel("issue-1", "bug");
      await client.removeLabel("issue-1", "bug");

      expect(labelsFn).toHaveBeenCalledTimes(1);
      expect(sdk.updateIssue).toHaveBeenCalledTimes(2);
    });
  });

  describe("listLabels", () => {
    it("returns label names and populates the label cache", async () => {
      const labelsFn = vi
        .fn()
        .mockResolvedValue({ nodes: [{ id: "l1", name: "bug" }, { id: "l2", name: "urgent" }] });
      sdk.issue = vi.fn().mockResolvedValue({ labels: labelsFn });

      const names = await client.listLabels("issue-1");

      expect(names).toEqual(["bug", "urgent"]);

      // The cache populated by listLabels should let removeLabel skip calling
      // issue.labels() again for a cached label name.
      sdk.updateIssue = vi.fn().mockResolvedValue(undefined);
      sdk.issue = vi.fn().mockResolvedValue({ labelIds: ["l1", "l2"], labels: labelsFn });
      await client.removeLabel("issue-1", "bug");

      expect(labelsFn).toHaveBeenCalledTimes(1);
      expect(sdk.updateIssue).toHaveBeenCalledWith("issue-1", { labelIds: ["l2"] });
    });

    it("returns an empty array when the labels connection has no nodes", async () => {
      sdk.issue = vi.fn().mockResolvedValue({ labels: () => Promise.resolve(undefined) });

      const names = await client.listLabels("issue-1");

      expect(names).toEqual([]);
    });
  });

  describe("resolveOrCreateLabel (via addLabel)", () => {
    it("finds an existing label via search and reuses it without creating a new one", async () => {
      sdk.issue = vi.fn().mockResolvedValue({
        team: Promise.resolve({ id: "team-1" }),
        labelIds: [],
      });
      sdk.issueLabels = vi.fn().mockResolvedValue({ nodes: [{ id: "existing-id", name: "bug" }] });
      sdk.createIssueLabel = vi.fn();
      sdk.updateIssue = vi.fn().mockResolvedValue(undefined);

      await client.addLabel("issue-1", "bug");

      expect(sdk.issueLabels).toHaveBeenCalledWith({ filter: { name: { eq: "bug" } } });
      expect(sdk.createIssueLabel).not.toHaveBeenCalled();
      expect(sdk.updateIssue).toHaveBeenCalledWith("issue-1", { labelIds: ["existing-id"] });
    });

    it("creates a fresh label with the team id when none exists", async () => {
      sdk.issue = vi.fn().mockResolvedValue({
        team: Promise.resolve({ id: "team-1" }),
        labelIds: [],
      });
      sdk.issueLabels = vi.fn().mockResolvedValue({ nodes: [] });
      sdk.createIssueLabel = vi.fn().mockResolvedValue({
        issueLabel: Promise.resolve({ id: "created-id" }),
      });
      sdk.updateIssue = vi.fn().mockResolvedValue(undefined);

      await client.addLabel("issue-1", "new-label");

      expect(sdk.createIssueLabel).toHaveBeenCalledWith({ name: "new-label", teamId: "team-1" });
      expect(sdk.updateIssue).toHaveBeenCalledWith("issue-1", { labelIds: ["created-id"] });
    });

    it("throws when label creation does not return an issueLabel", async () => {
      sdk.issue = vi.fn().mockResolvedValue({
        team: Promise.resolve({ id: "team-1" }),
        labelIds: [],
      });
      sdk.issueLabels = vi.fn().mockResolvedValue({ nodes: [] });
      sdk.createIssueLabel = vi.fn().mockResolvedValue({
        issueLabel: Promise.resolve(null),
      });

      await expect(client.addLabel("issue-1", "broken-label")).rejects.toThrow(
        "Failed to create label: broken-label",
      );
    });

    it("uses the label cache on a second call for the same label name, skipping search/create", async () => {
      sdk.issue = vi.fn().mockResolvedValue({
        team: Promise.resolve({ id: "team-1" }),
        labelIds: [],
      });
      sdk.issueLabels = vi.fn().mockResolvedValue({ nodes: [{ id: "existing-id", name: "bug" }] });
      sdk.createIssueLabel = vi.fn();
      sdk.updateIssue = vi.fn().mockResolvedValue(undefined);

      await client.addLabel("issue-1", "bug");
      // Second issue has the label id already, so updateIssue should be skipped,
      // but resolveOrCreateLabel's cache path should avoid calling issueLabels again.
      sdk.issue = vi.fn().mockResolvedValue({
        team: Promise.resolve({ id: "team-1" }),
        labelIds: ["existing-id"],
      });
      await client.addLabel("issue-1", "bug");

      expect(sdk.issueLabels).toHaveBeenCalledTimes(1);
    });
  });
});
