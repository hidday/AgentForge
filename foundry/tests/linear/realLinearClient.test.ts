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

function makeFakeIssue(overrides: Record<string, unknown> = {}) {
  return {
    id: "issue-1",
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
    team: Promise.resolve({ id: "team-1", key: "PRY" }),
    labels: () => Promise.resolve({ nodes: [] }),
    ...overrides,
  };
}

describe("RealLinearClient", () => {
  let client: RealLinearClient;
  let sdk: Record<string, ReturnType<typeof vi.fn>>;
  let logger: ReturnType<typeof makeLogger>;

  beforeEach(() => {
    logger = makeLogger();
    client = new RealLinearClient("test-key", logger as never);
    sdk = {
      issue: vi.fn(),
      issues: vi.fn(),
      createComment: vi.fn().mockResolvedValue(undefined),
      updateIssue: vi.fn().mockResolvedValue(undefined),
      team: vi.fn(),
      issueLabels: vi.fn(),
      createIssueLabel: vi.fn(),
    };
    (client as unknown as { sdk: typeof sdk }).sdk = sdk;
  });

  describe("getIssue", () => {
    it("maps an SDK issue including project/team/cycle names", async () => {
      const fake = makeFakeIssue({
        labels: () => Promise.resolve({ nodes: [{ id: "l1", name: "bug" }] }),
        state: Promise.resolve({ id: "s1", name: "In Progress" }),
        project: Promise.resolve({ name: "Project X" }),
        cycle: Promise.resolve({ name: "Cycle 3" }),
        team: Promise.resolve({ id: "t1", key: "PRY" }),
      });
      sdk.issue.mockResolvedValue(fake);

      const result = await client.getIssue("issue-1");

      expect(result).toEqual({
        id: "issue-1",
        identifier: "PRY-1",
        title: "Issue title",
        description: "Issue description",
        branchName: "ai/issue-1",
        state: "In Progress",
        labels: ["bug"],
        priority: 0,
        url: "https://linear.app/team/issue/PRY-1",
        project: "Project X",
        team: "PRY",
        cycle: "Cycle 3",
      });
    });

    it("falls back to defaults when description/state/project/cycle/team are missing", async () => {
      const fake = makeFakeIssue({
        description: null,
        state: Promise.resolve(null),
        project: Promise.resolve(null),
        cycle: Promise.resolve(null),
        team: Promise.resolve(null),
      });
      sdk.issue.mockResolvedValue(fake);

      const result = await client.getIssue("issue-1");

      expect(result.description).toBe("");
      expect(result.state).toBe("Unknown");
      expect(result.project).toBeUndefined();
      expect(result.team).toBeUndefined();
      expect(result.cycle).toBeUndefined();
    });

    it("returns empty labels when labels() resolves without nodes", async () => {
      const fake = makeFakeIssue({ labels: () => Promise.resolve({ nodes: undefined }) });
      sdk.issue.mockResolvedValue(fake);

      const result = await client.getIssue("issue-1");

      expect(result.labels).toEqual([]);
    });
  });

  describe("searchIssues", () => {
    it("builds a GraphQL filter from state only and maps results", async () => {
      sdk.issues.mockResolvedValue({
        nodes: [
          makeFakeIssue({
            id: "a",
            project: Promise.resolve({ name: "Proj" }),
            team: Promise.resolve({ id: "t1", key: "PRY" }),
          }),
        ],
      });

      const results = await client.searchIssues({ state: "Todo" });

      expect(sdk.issues).toHaveBeenCalledWith({ filter: { state: { name: { eq: "Todo" } } } });
      expect(results).toEqual([
        expect.objectContaining({ id: "a", state: "Todo", project: "Proj", team: "PRY" }),
      ]);
    });

    it("adds project, assignee, and team clauses when provided", async () => {
      sdk.issues.mockResolvedValue({ nodes: [] });

      await client.searchIssues({
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
    });

    it("returns an empty array when issues() resolves without nodes", async () => {
      sdk.issues.mockResolvedValue({ nodes: undefined });

      const results = await client.searchIssues({ state: "Todo" });

      expect(results).toEqual([]);
    });

    it("logs the search with counts", async () => {
      sdk.issues.mockResolvedValue({ nodes: [] });

      await client.searchIssues({ state: "Todo", team: "PRY" });

      expect(logger.info).toHaveBeenCalledWith(
        expect.objectContaining({ stateName: "Todo", team: "PRY", count: 0 }),
        "Searched Linear issues",
      );
    });
  });

  describe("postComment", () => {
    it("calls sdk.createComment with issueId and body", async () => {
      await client.postComment("issue-1", "hello");

      expect(sdk.createComment).toHaveBeenCalledWith({ issueId: "issue-1", body: "hello" });
      expect(logger.debug).toHaveBeenCalled();
    });
  });

  describe("updateIssueState", () => {
    it("resolves the state id for the issue's team and calls updateIssue", async () => {
      sdk.issue.mockResolvedValue(
        makeFakeIssue({ team: Promise.resolve({ id: "team-1", key: "PRY" }) }),
      );
      sdk.team.mockResolvedValue({
        states: () =>
          Promise.resolve({ nodes: [{ id: "state-done", name: "Done" }] }),
      });

      await client.updateIssueState("issue-1", "Done");

      expect(sdk.updateIssue).toHaveBeenCalledWith("issue-1", { stateId: "state-done" });
    });

    it("warns and skips the update when the issue has no team", async () => {
      sdk.issue.mockResolvedValue(makeFakeIssue({ team: Promise.resolve(null) }));

      await client.updateIssueState("issue-1", "Done");

      expect(logger.warn).toHaveBeenCalledWith(
        { issueId: "issue-1" },
        "Cannot update state: issue has no team",
      );
      expect(sdk.updateIssue).not.toHaveBeenCalled();
    });

    it("warns and skips the update when the state name cannot be resolved", async () => {
      sdk.issue.mockResolvedValue(
        makeFakeIssue({ team: Promise.resolve({ id: "team-1", key: "PRY" }) }),
      );
      sdk.team.mockResolvedValue({ states: () => Promise.resolve({ nodes: [] }) });

      await client.updateIssueState("issue-1", "Nonexistent");

      expect(logger.warn).toHaveBeenCalledWith(
        { issueId: "issue-1", stateName: "Nonexistent", teamId: "team-1" },
        "Could not find workflow state by name",
      );
      expect(sdk.updateIssue).not.toHaveBeenCalled();
    });

    it("caches the resolved state map per team across calls", async () => {
      sdk.issue.mockResolvedValue(
        makeFakeIssue({ team: Promise.resolve({ id: "team-1", key: "PRY" }) }),
      );
      sdk.team.mockResolvedValue({
        states: () => Promise.resolve({ nodes: [{ id: "state-done", name: "Done" }] }),
      });

      await client.updateIssueState("issue-1", "Done");
      await client.updateIssueState("issue-1", "Done");

      expect(sdk.team).toHaveBeenCalledTimes(1);
    });
  });

  describe("addLabel", () => {
    it("adds a newly created label id to the issue's labelIds", async () => {
      sdk.issue.mockResolvedValue(
        makeFakeIssue({ team: Promise.resolve({ id: "team-1", key: "PRY" }), labelIds: [] }),
      );
      sdk.issueLabels.mockResolvedValue({ nodes: [] });
      sdk.createIssueLabel.mockResolvedValue({
        issueLabel: Promise.resolve({ id: "label-new", name: "bug" }),
      });

      await client.addLabel("issue-1", "bug");

      expect(sdk.createIssueLabel).toHaveBeenCalledWith({ name: "bug", teamId: "team-1" });
      expect(sdk.updateIssue).toHaveBeenCalledWith("issue-1", { labelIds: ["label-new"] });
    });

    it("reuses an existing label by name instead of creating a new one", async () => {
      sdk.issue.mockResolvedValue(
        makeFakeIssue({ team: Promise.resolve({ id: "team-1", key: "PRY" }), labelIds: [] }),
      );
      sdk.issueLabels.mockResolvedValue({ nodes: [{ id: "label-existing", name: "bug" }] });

      await client.addLabel("issue-1", "bug");

      expect(sdk.createIssueLabel).not.toHaveBeenCalled();
      expect(sdk.updateIssue).toHaveBeenCalledWith("issue-1", { labelIds: ["label-existing"] });
    });

    it("does not call updateIssue when the label id is already present", async () => {
      sdk.issue.mockResolvedValue(
        makeFakeIssue({
          team: Promise.resolve({ id: "team-1", key: "PRY" }),
          labelIds: ["label-existing"],
        }),
      );
      sdk.issueLabels.mockResolvedValue({ nodes: [{ id: "label-existing", name: "bug" }] });

      await client.addLabel("issue-1", "bug");

      expect(sdk.updateIssue).not.toHaveBeenCalled();
    });

    it("throws when label creation returns no issueLabel", async () => {
      sdk.issue.mockResolvedValue(
        makeFakeIssue({ team: Promise.resolve(null), labelIds: [] }),
      );
      sdk.issueLabels.mockResolvedValue({ nodes: [] });
      sdk.createIssueLabel.mockResolvedValue({ issueLabel: Promise.resolve(null) });

      await expect(client.addLabel("issue-1", "bug")).rejects.toThrow(
        "Failed to create label: bug",
      );
    });

    it("creates a label without a teamId when the issue has no team", async () => {
      sdk.issue.mockResolvedValue(makeFakeIssue({ team: Promise.resolve(null), labelIds: [] }));
      sdk.issueLabels.mockResolvedValue({ nodes: [] });
      sdk.createIssueLabel.mockResolvedValue({
        issueLabel: Promise.resolve({ id: "label-new", name: "bug" }),
      });

      await client.addLabel("issue-1", "bug");

      expect(sdk.createIssueLabel).toHaveBeenCalledWith({ name: "bug" });
    });
  });

  describe("removeLabel", () => {
    it("removes a label found via the issue's current labels when not cached", async () => {
      sdk.issue.mockResolvedValue(
        makeFakeIssue({
          labelIds: ["label-1", "label-2"],
          labels: () => Promise.resolve({ nodes: [{ id: "label-1", name: "bug" }] }),
        }),
      );

      await client.removeLabel("issue-1", "bug");

      expect(sdk.updateIssue).toHaveBeenCalledWith("issue-1", { labelIds: ["label-2"] });
    });

    it("is a no-op when the label name cannot be found on the issue", async () => {
      sdk.issue.mockResolvedValue(
        makeFakeIssue({
          labelIds: ["label-1"],
          labels: () => Promise.resolve({ nodes: [] }),
        }),
      );

      await client.removeLabel("issue-1", "missing-label");

      expect(sdk.updateIssue).not.toHaveBeenCalled();
    });

    it("uses the cached label id on a subsequent call instead of re-fetching labels", async () => {
      const labelsFn = vi.fn().mockResolvedValue({ nodes: [{ id: "label-1", name: "bug" }] });
      sdk.issue.mockResolvedValue(
        makeFakeIssue({ labelIds: ["label-1", "label-2"], labels: labelsFn }),
      );

      // First call populates the cache via listLabels.
      await client.listLabels("issue-1");
      await client.removeLabel("issue-1", "bug");

      expect(labelsFn).toHaveBeenCalledTimes(1);
      expect(sdk.updateIssue).toHaveBeenCalledWith("issue-1", { labelIds: ["label-2"] });
    });
  });

  describe("listLabels", () => {
    it("returns label names and populates the label cache", async () => {
      sdk.issue.mockResolvedValue(
        makeFakeIssue({
          labels: () =>
            Promise.resolve({
              nodes: [
                { id: "l1", name: "bug" },
                { id: "l2", name: "urgent" },
              ],
            }),
        }),
      );

      const names = await client.listLabels("issue-1");

      expect(names).toEqual(["bug", "urgent"]);
    });

    it("returns an empty array when there are no label nodes", async () => {
      sdk.issue.mockResolvedValue(makeFakeIssue({ labels: () => Promise.resolve({ nodes: undefined }) }));

      const names = await client.listLabels("issue-1");

      expect(names).toEqual([]);
    });
  });
});
