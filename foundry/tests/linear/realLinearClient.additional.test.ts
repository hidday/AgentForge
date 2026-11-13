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
  team: ReturnType<typeof vi.fn>;
  createComment: ReturnType<typeof vi.fn>;
  updateIssue: ReturnType<typeof vi.fn>;
  issueLabels: ReturnType<typeof vi.fn>;
  createIssueLabel: ReturnType<typeof vi.fn>;
}

function makeFakeSdk(): FakeSdk {
  return {
    issue: vi.fn(),
    issues: vi.fn(),
    team: vi.fn(),
    createComment: vi.fn(),
    updateIssue: vi.fn(),
    issueLabels: vi.fn(),
    createIssueLabel: vi.fn(),
  };
}

function withFakeSdk(client: RealLinearClient, sdk: FakeSdk): void {
  (client as unknown as { sdk: FakeSdk }).sdk = sdk;
}

describe("RealLinearClient", () => {
  let sdk: FakeSdk;
  let logger: ReturnType<typeof makeLogger>;
  let client: RealLinearClient;

  beforeEach(() => {
    sdk = makeFakeSdk();
    logger = makeLogger();
    client = new RealLinearClient("test-key", logger as never);
    withFakeSdk(client, sdk);
  });

  describe("getIssue", () => {
    it("maps a full SDK issue into a LinearIssue", async () => {
      sdk.issue.mockResolvedValue({
        id: "issue-1",
        identifier: "PRY-1",
        title: "Fix the bug",
        description: "Some description",
        branchName: "ai/pry-1",
        priority: 2,
        url: "https://linear.app/team/issue/PRY-1",
        labels: () => Promise.resolve({ nodes: [{ name: "bug" }, { name: "urgent" }] }),
        state: Promise.resolve({ name: "In Progress" }),
        project: Promise.resolve({ name: "Project A" }),
        cycle: Promise.resolve({ name: "Cycle 3" }),
        team: Promise.resolve({ key: "PRY" }),
      });

      const issue = await client.getIssue("issue-1");

      expect(issue).toEqual({
        id: "issue-1",
        identifier: "PRY-1",
        title: "Fix the bug",
        description: "Some description",
        branchName: "ai/pry-1",
        state: "In Progress",
        labels: ["bug", "urgent"],
        priority: 2,
        url: "https://linear.app/team/issue/PRY-1",
        project: "Project A",
        team: "PRY",
        cycle: "Cycle 3",
      });
    });

    it("defaults missing fields when optional relations resolve to null/undefined", async () => {
      sdk.issue.mockResolvedValue({
        id: "issue-2",
        identifier: "PRY-2",
        title: "No extras",
        description: null,
        branchName: "ai/pry-2",
        priority: 0,
        url: "https://linear.app/team/issue/PRY-2",
        labels: () => Promise.resolve({ nodes: [] }),
        state: Promise.resolve(undefined),
        project: Promise.resolve(null),
        cycle: Promise.resolve(null),
        team: Promise.resolve(null),
      });

      const issue = await client.getIssue("issue-2");

      expect(issue).toEqual({
        id: "issue-2",
        identifier: "PRY-2",
        title: "No extras",
        description: "",
        branchName: "ai/pry-2",
        state: "Unknown",
        labels: [],
        priority: 0,
        url: "https://linear.app/team/issue/PRY-2",
        project: undefined,
        team: undefined,
        cycle: undefined,
      });
    });

    it("defaults labels to an empty array when labels() resolves with no nodes field", async () => {
      sdk.issue.mockResolvedValue({
        id: "issue-3",
        identifier: "PRY-3",
        title: "No labels conn",
        description: "desc",
        branchName: "ai/pry-3",
        priority: 0,
        url: "https://linear.app/team/issue/PRY-3",
        labels: () => Promise.resolve(undefined),
        state: Promise.resolve({ name: "Todo" }),
        project: Promise.resolve(null),
        cycle: Promise.resolve(null),
        team: Promise.resolve(null),
      });

      const issue = await client.getIssue("issue-3");
      expect(issue.labels).toEqual([]);
    });
  });

  describe("getRelatedContext blocker hydration failures", () => {
    it("logs a warning and drops a blocker whose relation.issue rejects", async () => {
      const goodBlocker = {
        id: "good-blocker",
        identifier: "PRY-101",
        title: "Good blocker",
        description: "desc",
        priority: 1,
        url: "https://linear.app/team/issue/PRY-101",
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
                id: "rel-broken",
                type: "blocks",
                issue: Promise.reject(new Error("deleted issue")),
              },
              { id: "rel-good", type: "blocks", issue: Promise.resolve(goodBlocker) },
            ],
          }),
      };
      sdk.issue.mockImplementation((id: string) => {
        if (id === "focus-id") return Promise.resolve(focus);
        throw new Error(`unexpected issue id ${id}`);
      });

      const ctx = await client.getRelatedContext("focus-id");

      expect(ctx.blockers).toHaveLength(1);
      expect(ctx.blockers[0].id).toBe("good-blocker");
      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ relationId: "rel-broken", focusIssueId: "focus-id" }),
        "Failed to hydrate blocker issue from relation",
      );
    });
  });

  describe("searchIssues", () => {
    function makeResultIssue(overrides: Record<string, unknown> = {}) {
      return {
        id: "issue-1",
        identifier: "PRY-1",
        title: "Result issue",
        description: "desc",
        branchName: "ai/pry-1",
        priority: 1,
        url: "https://linear.app/team/issue/PRY-1",
        labels: () => Promise.resolve({ nodes: [{ name: "bug" }] }),
        project: Promise.resolve(null),
        cycle: Promise.resolve(null),
        team: Promise.resolve({ key: "PRY" }),
        ...overrides,
      };
    }

    it("builds a filter with only state when no optional filters are given", async () => {
      sdk.issues.mockResolvedValue({ nodes: [] });

      await client.searchIssues({ state: "Todo" });

      expect(sdk.issues).toHaveBeenCalledWith({
        filter: { state: { name: { eq: "Todo" } } },
      });
    });

    it("adds projectName, assigneeMe and team filters when provided", async () => {
      sdk.issues.mockResolvedValue({ nodes: [] });

      await client.searchIssues({
        state: "Todo",
        projectName: "Project A",
        assigneeMe: true,
        team: "PRY",
      });

      expect(sdk.issues).toHaveBeenCalledWith({
        filter: {
          state: { name: { eq: "Todo" } },
          project: { name: { eq: "Project A" } },
          assignee: { isMe: { eq: true } },
          team: { or: [{ name: { eq: "PRY" } }, { key: { eq: "PRY" } }] },
        },
      });
    });

    it("maps each result issue, stamping the queried state name", async () => {
      sdk.issues.mockResolvedValue({ nodes: [makeResultIssue()] });

      const results = await client.searchIssues({ state: "Todo" });

      expect(results).toEqual([
        {
          id: "issue-1",
          identifier: "PRY-1",
          title: "Result issue",
          description: "desc",
          branchName: "ai/pry-1",
          state: "Todo",
          labels: ["bug"],
          priority: 1,
          url: "https://linear.app/team/issue/PRY-1",
          project: undefined,
          team: "PRY",
          cycle: undefined,
        },
      ]);
      expect(logger.info).toHaveBeenCalled();
    });

    it("returns an empty array when the SDK returns no nodes field", async () => {
      sdk.issues.mockResolvedValue(undefined);

      const results = await client.searchIssues({ state: "Todo" });

      expect(results).toEqual([]);
    });
  });

  describe("postComment", () => {
    it("creates a comment via the SDK", async () => {
      sdk.createComment.mockResolvedValue({});

      await client.postComment("issue-1", "hello");

      expect(sdk.createComment).toHaveBeenCalledWith({ issueId: "issue-1", body: "hello" });
      expect(logger.debug).toHaveBeenCalled();
    });
  });

  describe("updateIssueState", () => {
    it("warns and does nothing when the issue has no team", async () => {
      sdk.issue.mockResolvedValue({ id: "issue-1", team: Promise.resolve(null) });

      await client.updateIssueState("issue-1", "Done");

      expect(logger.warn).toHaveBeenCalled();
      expect(sdk.updateIssue).not.toHaveBeenCalled();
    });

    it("warns and does nothing when the state name cannot be resolved", async () => {
      sdk.issue.mockResolvedValue({ id: "issue-1", team: Promise.resolve({ id: "team-1" }) });
      sdk.team.mockResolvedValue({
        states: () => Promise.resolve({ nodes: [{ id: "s1", name: "Todo" }] }),
      });

      await client.updateIssueState("issue-1", "Nonexistent State");

      expect(logger.warn).toHaveBeenCalled();
      expect(sdk.updateIssue).not.toHaveBeenCalled();
    });

    it("resolves the state id by name and updates the issue", async () => {
      sdk.issue.mockResolvedValue({ id: "issue-1", team: Promise.resolve({ id: "team-1" }) });
      sdk.team.mockResolvedValue({
        states: () =>
          Promise.resolve({
            nodes: [
              { id: "s1", name: "Todo" },
              { id: "s2", name: "Done" },
            ],
          }),
      });
      sdk.updateIssue.mockResolvedValue({});

      await client.updateIssueState("issue-1", "Done");

      expect(sdk.updateIssue).toHaveBeenCalledWith("issue-1", { stateId: "s2" });
      expect(logger.debug).toHaveBeenCalled();
    });

    it("caches resolved states per team and only fetches them once", async () => {
      sdk.issue
        .mockResolvedValueOnce({ id: "issue-1", team: Promise.resolve({ id: "team-1" }) })
        .mockResolvedValueOnce({ id: "issue-2", team: Promise.resolve({ id: "team-1" }) });
      const statesFn = vi.fn().mockResolvedValue({ nodes: [{ id: "s2", name: "Done" }] });
      sdk.team.mockResolvedValue({ states: statesFn });
      sdk.updateIssue.mockResolvedValue({});

      await client.updateIssueState("issue-1", "Done");
      await client.updateIssueState("issue-2", "Done");

      expect(sdk.team).toHaveBeenCalledTimes(1);
      expect(statesFn).toHaveBeenCalledTimes(1);
    });

    it("defaults to an empty state list when states() resolves with no nodes field", async () => {
      sdk.issue.mockResolvedValue({ id: "issue-1", team: Promise.resolve({ id: "team-1" }) });
      sdk.team.mockResolvedValue({ states: () => Promise.resolve(undefined) });

      await client.updateIssueState("issue-1", "Done");

      expect(logger.warn).toHaveBeenCalled();
      expect(sdk.updateIssue).not.toHaveBeenCalled();
    });
  });

  describe("addLabel", () => {
    it("adds a newly created label id to the issue's labelIds when not already cached", async () => {
      sdk.issue.mockResolvedValue({
        id: "issue-1",
        labelIds: ["existing-id"],
        team: Promise.resolve({ id: "team-1" }),
      });
      sdk.issueLabels.mockResolvedValue({ nodes: [] });
      sdk.createIssueLabel.mockResolvedValue({
        issueLabel: Promise.resolve({ id: "new-label-id" }),
      });
      sdk.updateIssue.mockResolvedValue({});

      await client.addLabel("issue-1", "shiny-new-label");

      expect(sdk.createIssueLabel).toHaveBeenCalledWith({
        name: "shiny-new-label",
        teamId: "team-1",
      });
      expect(sdk.updateIssue).toHaveBeenCalledWith("issue-1", {
        labelIds: ["existing-id", "new-label-id"],
      });
      expect(logger.info).toHaveBeenCalled();
    });

    it("reuses an existing label found via issueLabels without creating a new one", async () => {
      sdk.issue.mockResolvedValue({
        id: "issue-1",
        labelIds: [],
        team: Promise.resolve({ id: "team-1" }),
      });
      sdk.issueLabels.mockResolvedValue({ nodes: [{ id: "existing-label-id" }] });
      sdk.updateIssue.mockResolvedValue({});

      await client.addLabel("issue-1", "existing-label");

      expect(sdk.createIssueLabel).not.toHaveBeenCalled();
      expect(sdk.updateIssue).toHaveBeenCalledWith("issue-1", { labelIds: ["existing-label-id"] });
    });

    it("does not call updateIssue when the label is already on the issue", async () => {
      sdk.issue.mockResolvedValue({
        id: "issue-1",
        labelIds: ["label-id"],
        team: Promise.resolve({ id: "team-1" }),
      });
      sdk.issueLabels.mockResolvedValue({ nodes: [{ id: "label-id" }] });

      await client.addLabel("issue-1", "already-there");

      expect(sdk.updateIssue).not.toHaveBeenCalled();
    });

    it("creates a label without a teamId when the issue has no team", async () => {
      sdk.issue.mockResolvedValue({
        id: "issue-1",
        labelIds: [],
        team: Promise.resolve(undefined),
      });
      sdk.issueLabels.mockResolvedValue({ nodes: [] });
      sdk.createIssueLabel.mockResolvedValue({
        issueLabel: Promise.resolve({ id: "new-label-id" }),
      });
      sdk.updateIssue.mockResolvedValue({});

      await client.addLabel("issue-1", "no-team-label");

      expect(sdk.createIssueLabel).toHaveBeenCalledWith({ name: "no-team-label" });
    });

    it("throws when label creation does not return an issueLabel", async () => {
      sdk.issue.mockResolvedValue({
        id: "issue-1",
        labelIds: [],
        team: Promise.resolve({ id: "team-1" }),
      });
      sdk.issueLabels.mockResolvedValue({ nodes: [] });
      sdk.createIssueLabel.mockResolvedValue({ issueLabel: Promise.resolve(undefined) });

      await expect(client.addLabel("issue-1", "doomed-label")).rejects.toThrow(
        "Failed to create label: doomed-label",
      );
    });

    it("reuses a cached label id across calls without re-querying issueLabels", async () => {
      sdk.issue
        .mockResolvedValueOnce({
          id: "issue-1",
          labelIds: [],
          team: Promise.resolve({ id: "team-1" }),
        })
        .mockResolvedValueOnce({
          id: "issue-2",
          labelIds: [],
          team: Promise.resolve({ id: "team-1" }),
        });
      sdk.issueLabels.mockResolvedValue({ nodes: [{ id: "cached-id" }] });
      sdk.updateIssue.mockResolvedValue({});

      await client.addLabel("issue-1", "cacheable-label");
      await client.addLabel("issue-2", "cacheable-label");

      expect(sdk.issueLabels).toHaveBeenCalledTimes(1);
    });
  });

  describe("removeLabel", () => {
    it("looks up the label id via labels() when not cached, and removes it", async () => {
      sdk.issue.mockResolvedValue({
        id: "issue-1",
        labelIds: ["label-id", "other-id"],
        labels: () => Promise.resolve({ nodes: [{ id: "label-id", name: "to-remove" }] }),
      });
      sdk.updateIssue.mockResolvedValue({});

      await client.removeLabel("issue-1", "to-remove");

      expect(sdk.updateIssue).toHaveBeenCalledWith("issue-1", { labelIds: ["other-id"] });
      expect(logger.debug).toHaveBeenCalled();
    });

    it("does nothing when the label is not found on the issue", async () => {
      sdk.issue.mockResolvedValue({
        id: "issue-1",
        labelIds: ["other-id"],
        labels: () => Promise.resolve({ nodes: [] }),
      });

      await client.removeLabel("issue-1", "not-present");

      expect(sdk.updateIssue).not.toHaveBeenCalled();
    });

    it("uses a cached label id without calling labels() again", async () => {
      const labelsFn = vi.fn().mockResolvedValue({ nodes: [{ id: "label-id", name: "cached" }] });
      sdk.issue
        .mockResolvedValueOnce({
          id: "issue-1",
          labelIds: ["label-id"],
          labels: labelsFn,
        })
        .mockResolvedValueOnce({
          id: "issue-2",
          labelIds: ["label-id", "keep-id"],
          labels: labelsFn,
        });
      sdk.updateIssue.mockResolvedValue({});

      await client.removeLabel("issue-1", "cached");
      expect(labelsFn).toHaveBeenCalledTimes(1);

      await client.removeLabel("issue-2", "cached");
      expect(labelsFn).toHaveBeenCalledTimes(1);
      expect(sdk.updateIssue).toHaveBeenNthCalledWith(2, "issue-2", { labelIds: ["keep-id"] });
    });
  });

  describe("listLabels", () => {
    it("returns label names and populates the label cache", async () => {
      sdk.issue.mockResolvedValue({
        id: "issue-1",
        labelIds: ["l1", "l2"],
        labels: () =>
          Promise.resolve({
            nodes: [
              { id: "l1", name: "bug" },
              { id: "l2", name: "urgent" },
            ],
          }),
      });

      const names = await client.listLabels("issue-1");

      expect(names).toEqual(["bug", "urgent"]);
    });

    it("populating the cache lets a later removeLabel skip calling labels() again", async () => {
      const labelsFn = vi
        .fn()
        .mockResolvedValue({ nodes: [{ id: "l1", name: "bug" }] });
      sdk.issue.mockResolvedValue({ id: "issue-1", labelIds: ["l1"], labels: labelsFn });

      await client.listLabels("issue-1");
      sdk.updateIssue.mockResolvedValue({});
      await client.removeLabel("issue-1", "bug");

      expect(labelsFn).toHaveBeenCalledTimes(1);
      expect(sdk.updateIssue).toHaveBeenCalledWith("issue-1", { labelIds: [] });
    });

    it("returns an empty array when labels() resolves with no nodes field", async () => {
      sdk.issue.mockResolvedValue({ id: "issue-1", labelIds: [], labels: () => Promise.resolve(undefined) });

      const names = await client.listLabels("issue-1");

      expect(names).toEqual([]);
    });
  });
});
