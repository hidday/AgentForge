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
    createComment: vi.fn(),
    updateIssue: vi.fn(),
    team: vi.fn(),
    issueLabels: vi.fn(),
    createIssueLabel: vi.fn(),
  };
}

function injectFakeSdk(client: RealLinearClient, sdk: FakeSdk): void {
  (client as unknown as { sdk: FakeSdk }).sdk = sdk;
}

describe("RealLinearClient (additional coverage)", () => {
  let client: RealLinearClient;
  let sdk: FakeSdk;
  let logger: ReturnType<typeof makeLogger>;

  beforeEach(() => {
    logger = makeLogger();
    client = new RealLinearClient("test-key", logger as never);
    sdk = makeFakeSdk();
    injectFakeSdk(client, sdk);
  });

  describe("getIssue", () => {
    it("maps a full SDK issue into a LinearIssue, resolving state/project/cycle/team", async () => {
      sdk.issue.mockResolvedValue({
        id: "issue-1",
        identifier: "PRY-1",
        title: "Title",
        description: "Desc",
        branchName: "ai/issue-1",
        priority: 2,
        url: "https://linear.app/team/issue/PRY-1",
        labels: () => Promise.resolve({ nodes: [{ id: "l1", name: "bug" }] }),
        state: Promise.resolve({ id: "s1", name: "In Progress" }),
        project: Promise.resolve({ id: "p1", name: "Core" }),
        cycle: Promise.resolve({ id: "c1", name: "Cycle 5" }),
        team: Promise.resolve({ id: "t1", key: "PRY" }),
      });

      const issue = await client.getIssue("issue-1");

      expect(issue).toEqual({
        id: "issue-1",
        identifier: "PRY-1",
        title: "Title",
        description: "Desc",
        branchName: "ai/issue-1",
        state: "In Progress",
        labels: ["bug"],
        priority: 2,
        url: "https://linear.app/team/issue/PRY-1",
        project: "Core",
        team: "PRY",
        cycle: "Cycle 5",
      });
    });

    it("defaults missing description/state/project/cycle/team to empty/undefined", async () => {
      sdk.issue.mockResolvedValue({
        id: "issue-2",
        identifier: "PRY-2",
        title: "Title",
        description: null,
        branchName: "ai/issue-2",
        priority: 0,
        url: "https://linear.app/team/issue/PRY-2",
        labels: () => Promise.resolve(null),
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
      expect(issue.team).toBeUndefined();
      expect(issue.cycle).toBeUndefined();
    });
  });

  describe("getRelatedContext - blocker hydration failure", () => {
    it("skips a blocker whose relation.issue rejects, logging a warning", async () => {
      sdk.issue.mockResolvedValue({
        id: "focus-id",
        parent: Promise.resolve(null),
        inverseRelations: () =>
          Promise.resolve({
            nodes: [
              {
                id: "rel-1",
                type: "blocks",
                issue: Promise.reject(new Error("blocker fetch failed")),
              },
            ],
          }),
      });

      const ctx = await client.getRelatedContext("focus-id");

      expect(ctx.blockers).toEqual([]);
      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ relationId: "rel-1", focusIssueId: "focus-id" }),
        "Failed to hydrate blocker issue from relation",
      );
    });
  });

  describe("searchIssues", () => {
    function makeSdkIssue(overrides: Record<string, unknown> = {}) {
      return {
        id: "issue-1",
        identifier: "PRY-1",
        title: "Title",
        description: "Desc",
        branchName: "ai/issue-1",
        priority: 1,
        url: "https://linear.app/team/issue/PRY-1",
        labels: () => Promise.resolve({ nodes: [] }),
        project: Promise.resolve(null),
        cycle: Promise.resolve(null),
        team: Promise.resolve(null),
        ...overrides,
      };
    }

    it("builds a basic state-only filter and maps results", async () => {
      sdk.issues.mockResolvedValue({ nodes: [makeSdkIssue()] });

      const results = await client.searchIssues({ state: "Todo" });

      expect(sdk.issues).toHaveBeenCalledWith({
        filter: { state: { name: { eq: "Todo" } } },
      });
      expect(results).toHaveLength(1);
      expect(results[0]).toEqual({
        id: "issue-1",
        identifier: "PRY-1",
        title: "Title",
        description: "Desc",
        branchName: "ai/issue-1",
        state: "Todo",
        labels: [],
        priority: 1,
        url: "https://linear.app/team/issue/PRY-1",
        project: undefined,
        team: undefined,
        cycle: undefined,
      });
      expect(logger.info).toHaveBeenCalled();
    });

    it("adds project, assignee, and team clauses when provided", async () => {
      sdk.issues.mockResolvedValue({ nodes: [] });

      await client.searchIssues({
        state: "Todo",
        projectName: "Core",
        assigneeMe: true,
        team: "PRY",
      });

      expect(sdk.issues).toHaveBeenCalledWith({
        filter: {
          state: { name: { eq: "Todo" } },
          project: { name: { eq: "Core" } },
          assignee: { isMe: { eq: true } },
          team: { or: [{ name: { eq: "PRY" } }, { key: { eq: "PRY" } }] },
        },
      });
    });

    it("returns an empty array when the connection has no nodes", async () => {
      sdk.issues.mockResolvedValue({ nodes: undefined });

      const results = await client.searchIssues({ state: "Done" });

      expect(results).toEqual([]);
    });

    it("returns an empty array when the connection itself is null", async () => {
      sdk.issues.mockResolvedValue(null);

      const results = await client.searchIssues({ state: "Done" });

      expect(results).toEqual([]);
    });
  });

  describe("postComment", () => {
    it("delegates to sdk.createComment", async () => {
      sdk.createComment.mockResolvedValue({});

      await client.postComment("issue-1", "a comment");

      expect(sdk.createComment).toHaveBeenCalledWith({ issueId: "issue-1", body: "a comment" });
      expect(logger.debug).toHaveBeenCalled();
    });
  });

  describe("updateIssueState", () => {
    it("updates the issue to the resolved state id", async () => {
      sdk.issue.mockResolvedValue({ team: Promise.resolve({ id: "team-1", key: "PRY" }) });
      sdk.team.mockResolvedValue({
        states: () =>
          Promise.resolve({ nodes: [{ id: "state-1", name: "Done" }] }),
      });
      sdk.updateIssue.mockResolvedValue({});

      await client.updateIssueState("issue-1", "Done");

      expect(sdk.updateIssue).toHaveBeenCalledWith("issue-1", { stateId: "state-1" });
      expect(logger.debug).toHaveBeenCalled();
    });

    it("caches workflow states per team across calls", async () => {
      sdk.issue.mockResolvedValue({ team: Promise.resolve({ id: "team-1", key: "PRY" }) });
      sdk.team.mockResolvedValue({
        states: () =>
          Promise.resolve({ nodes: [{ id: "state-1", name: "Done" }] }),
      });
      sdk.updateIssue.mockResolvedValue({});

      await client.updateIssueState("issue-1", "Done");
      await client.updateIssueState("issue-1", "Done");

      expect(sdk.team).toHaveBeenCalledTimes(1);
    });

    it("warns and returns early when the issue has no team", async () => {
      sdk.issue.mockResolvedValue({ team: Promise.resolve(null) });

      await client.updateIssueState("issue-1", "Done");

      expect(logger.warn).toHaveBeenCalledWith({ issueId: "issue-1" }, "Cannot update state: issue has no team");
      expect(sdk.updateIssue).not.toHaveBeenCalled();
    });

    it("warns and returns early when the state name cannot be resolved", async () => {
      sdk.issue.mockResolvedValue({ team: Promise.resolve({ id: "team-1", key: "PRY" }) });
      sdk.team.mockResolvedValue({ states: () => Promise.resolve({ nodes: [] }) });

      await client.updateIssueState("issue-1", "NoSuchState");

      expect(logger.warn).toHaveBeenCalledWith(
        { issueId: "issue-1", stateName: "NoSuchState", teamId: "team-1" },
        "Could not find workflow state by name",
      );
      expect(sdk.updateIssue).not.toHaveBeenCalled();
    });
  });

  describe("addLabel", () => {
    it("creates a new label and adds it when the issue has no labels yet", async () => {
      sdk.issue.mockResolvedValue({
        team: Promise.resolve({ id: "team-1", key: "PRY" }),
        labelIds: [],
      });
      sdk.issueLabels.mockResolvedValue({ nodes: [] });
      sdk.createIssueLabel.mockResolvedValue({
        issueLabel: Promise.resolve({ id: "label-new" }),
      });
      sdk.updateIssue.mockResolvedValue({});

      await client.addLabel("issue-1", "urgent");

      expect(sdk.createIssueLabel).toHaveBeenCalledWith({ name: "urgent", teamId: "team-1" });
      expect(sdk.updateIssue).toHaveBeenCalledWith("issue-1", { labelIds: ["label-new"] });
    });

    it("reuses an existing label id and does not call updateIssue when already applied", async () => {
      sdk.issue.mockResolvedValue({
        team: Promise.resolve({ id: "team-1", key: "PRY" }),
        labelIds: ["label-existing"],
      });
      sdk.issueLabels.mockResolvedValue({ nodes: [{ id: "label-existing", name: "urgent" }] });

      await client.addLabel("issue-1", "urgent");

      expect(sdk.updateIssue).not.toHaveBeenCalled();
    });

    it("throws when label creation does not return an issueLabel", async () => {
      sdk.issue.mockResolvedValue({
        team: Promise.resolve({ id: "team-1", key: "PRY" }),
        labelIds: [],
      });
      sdk.issueLabels.mockResolvedValue({ nodes: [] });
      sdk.createIssueLabel.mockResolvedValue({ issueLabel: Promise.resolve(null) });

      await expect(client.addLabel("issue-1", "urgent")).rejects.toThrow(
        "Failed to create label: urgent",
      );
    });

    it("creates a label without a teamId when the issue has no team", async () => {
      sdk.issue.mockResolvedValue({
        team: Promise.resolve(undefined),
        labelIds: [],
      });
      sdk.issueLabels.mockResolvedValue({ nodes: [] });
      sdk.createIssueLabel.mockResolvedValue({
        issueLabel: Promise.resolve({ id: "label-new" }),
      });
      sdk.updateIssue.mockResolvedValue({});

      await client.addLabel("issue-1", "urgent");

      expect(sdk.createIssueLabel).toHaveBeenCalledWith({ name: "urgent" });
    });
  });

  describe("removeLabel", () => {
    it("removes a label by looking it up on the issue when not cached", async () => {
      sdk.issue.mockResolvedValue({
        labelIds: ["label-1", "label-2"],
        labels: () =>
          Promise.resolve({ nodes: [{ id: "label-1", name: "urgent" }] }),
      });
      sdk.updateIssue.mockResolvedValue({});

      await client.removeLabel("issue-1", "urgent");

      expect(sdk.updateIssue).toHaveBeenCalledWith("issue-1", { labelIds: ["label-2"] });
    });

    it("does nothing when the label name is not found on the issue", async () => {
      sdk.issue.mockResolvedValue({
        labelIds: ["label-2"],
        labels: () => Promise.resolve({ nodes: [{ id: "label-2", name: "other" }] }),
      });

      await client.removeLabel("issue-1", "urgent");

      expect(sdk.updateIssue).not.toHaveBeenCalled();
    });

    it("uses the cached label id on a subsequent call without re-fetching labels", async () => {
      sdk.issue.mockResolvedValue({
        labelIds: ["label-1", "label-2"],
        labels: vi.fn().mockResolvedValue({ nodes: [{ id: "label-1", name: "urgent" }] }),
      });
      sdk.updateIssue.mockResolvedValue({});

      await client.removeLabel("issue-1", "urgent");

      const secondIssue = {
        labelIds: ["label-1", "label-2"],
        labels: vi.fn().mockResolvedValue({ nodes: [{ id: "label-1", name: "urgent" }] }),
      };
      sdk.issue.mockResolvedValue(secondIssue);

      await client.removeLabel("issue-1", "urgent");

      expect(secondIssue.labels).not.toHaveBeenCalled();
      expect(sdk.updateIssue).toHaveBeenLastCalledWith("issue-1", { labelIds: ["label-2"] });
    });
  });

  describe("listLabels", () => {
    it("returns label names and populates the label cache", async () => {
      sdk.issue.mockResolvedValue({
        labels: () =>
          Promise.resolve({
            nodes: [
              { id: "label-1", name: "urgent" },
              { id: "label-2", name: "bug" },
            ],
          }),
      });

      const names = await client.listLabels("issue-1");

      expect(names).toEqual(["urgent", "bug"]);

      // Now removeLabel for "urgent" should use the cache populated above
      // rather than calling issue.labels() again.
      const labelsFn = vi.fn().mockResolvedValue({ nodes: [] });
      sdk.issue.mockResolvedValue({ labelIds: ["label-1"], labels: labelsFn });
      sdk.updateIssue.mockResolvedValue({});

      await client.removeLabel("issue-1", "urgent");

      expect(labelsFn).not.toHaveBeenCalled();
      expect(sdk.updateIssue).toHaveBeenCalledWith("issue-1", { labelIds: [] });
    });

    it("returns an empty array when there are no labels", async () => {
      sdk.issue.mockResolvedValue({ labels: () => Promise.resolve({ nodes: [] }) });

      const names = await client.listLabels("issue-1");

      expect(names).toEqual([]);
    });
  });

  describe("resolveOrCreateLabel (via addLabel)", () => {
    it("reuses a cached label id across multiple addLabel calls without re-querying issueLabels", async () => {
      sdk.issue.mockResolvedValue({
        team: Promise.resolve({ id: "team-1", key: "PRY" }),
        labelIds: [],
      });
      sdk.issueLabels.mockResolvedValue({ nodes: [{ id: "label-existing", name: "urgent" }] });
      sdk.updateIssue.mockResolvedValue({});

      await client.addLabel("issue-1", "urgent");
      await client.addLabel("issue-1", "urgent");

      expect(sdk.issueLabels).toHaveBeenCalledTimes(1);
    });
  });
});
