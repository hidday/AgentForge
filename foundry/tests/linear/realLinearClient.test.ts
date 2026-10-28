import { describe, it, expect, vi, beforeEach } from "vitest";

const sdkMock = {
  issue: vi.fn(),
  issues: vi.fn(),
  createComment: vi.fn(),
  updateIssue: vi.fn(),
  issueLabels: vi.fn(),
  createIssueLabel: vi.fn(),
  team: vi.fn(),
};

vi.mock("@linear/sdk", () => ({
  LinearClient: vi.fn().mockImplementation(() => sdkMock),
  IssueRelationType: { Blocks: "blocks" },
}));

const noopLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  fatal: vi.fn(),
  child: () => noopLogger,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} as any;

function sdkIssue(overrides: Record<string, unknown> = {}) {
  return {
    id: "issue-1",
    identifier: "ENG-1",
    title: "Title",
    description: "desc",
    branchName: "ai/eng-1",
    priority: 2,
    url: "https://linear.app/x",
    labelIds: [],
    labels: vi.fn().mockResolvedValue({ nodes: [] }),
    state: Promise.resolve({ name: "Todo" }),
    project: Promise.resolve(undefined),
    cycle: Promise.resolve(undefined),
    team: Promise.resolve(undefined),
    parent: Promise.resolve(undefined),
    inverseRelations: vi.fn().mockResolvedValue({ nodes: [] }),
    ...overrides,
  };
}

describe("RealLinearClient", () => {
  let client: InstanceType<
    typeof import("../../src/linear/realLinearClient.js").RealLinearClient
  >;

  beforeEach(async () => {
    vi.clearAllMocks();
    const { RealLinearClient } = await import("../../src/linear/realLinearClient.js");
    client = new RealLinearClient("api-key", noopLogger);
  });

  describe("getIssue", () => {
    it("maps an SDK issue to the LinearIssue shape, including labels/state/project/cycle/team", async () => {
      sdkMock.issue.mockResolvedValue(
        sdkIssue({
          labels: vi.fn().mockResolvedValue({ nodes: [{ name: "bug" }, { name: "urgent" }] }),
          state: Promise.resolve({ name: "In Progress" }),
          project: Promise.resolve({ name: "Project A" }),
          cycle: Promise.resolve({ name: "Cycle 3" }),
          team: Promise.resolve({ key: "ENG" }),
        }),
      );

      const result = await client.getIssue("issue-1");

      expect(result).toEqual({
        id: "issue-1",
        identifier: "ENG-1",
        title: "Title",
        description: "desc",
        branchName: "ai/eng-1",
        state: "In Progress",
        labels: ["bug", "urgent"],
        priority: 2,
        url: "https://linear.app/x",
        project: "Project A",
        team: "ENG",
        cycle: "Cycle 3",
      });
    });

    it("defaults missing description/state/project/cycle/team", async () => {
      sdkMock.issue.mockResolvedValue(sdkIssue({ description: null, state: Promise.resolve(undefined) }));

      const result = await client.getIssue("issue-1");

      expect(result.description).toBe("");
      expect(result.state).toBe("Unknown");
      expect(result.project).toBeUndefined();
      expect(result.team).toBeUndefined();
      expect(result.cycle).toBeUndefined();
    });
  });

  describe("getRelatedContext", () => {
    it("returns an empty blockers array and no parent when there are none", async () => {
      sdkMock.issue.mockResolvedValue(sdkIssue());

      const result = await client.getRelatedContext("issue-1");

      expect(result).toEqual({ parent: undefined, blockers: [] });
    });

    it("includes the parent issue mapped to a RelatedLinearIssue", async () => {
      const parent = sdkIssue({ id: "parent-1", identifier: "ENG-0" });
      sdkMock.issue.mockResolvedValue(sdkIssue({ parent: Promise.resolve(parent) }));

      const result = await client.getRelatedContext("issue-1");

      expect(result.parent?.id).toBe("parent-1");
    });

    it("includes blockers from inverseRelations filtered by Blocks type", async () => {
      const blocker = sdkIssue({ id: "blocker-1" });
      sdkMock.issue.mockResolvedValue(
        sdkIssue({
          inverseRelations: vi.fn().mockResolvedValue({
            nodes: [
              { type: "blocks", issue: Promise.resolve(blocker) },
              { type: "duplicate", issue: Promise.resolve(sdkIssue({ id: "not-a-blocker" })) },
            ],
          }),
        }),
      );

      const result = await client.getRelatedContext("issue-1");

      expect(result.blockers).toHaveLength(1);
      expect(result.blockers[0].id).toBe("blocker-1");
    });

    it("skips a blocker relation whose issue fails to hydrate", async () => {
      sdkMock.issue.mockResolvedValue(
        sdkIssue({
          inverseRelations: vi.fn().mockResolvedValue({
            nodes: [{ type: "blocks", id: "rel-1", issue: Promise.reject(new Error("gone")) }],
          }),
        }),
      );

      const result = await client.getRelatedContext("issue-1");

      expect(result.blockers).toEqual([]);
      expect(noopLogger.warn).toHaveBeenCalled();
    });
  });

  describe("searchIssues", () => {
    it("builds a GraphQL filter from state only", async () => {
      sdkMock.issues.mockResolvedValue({ nodes: [] });

      await client.searchIssues({ state: "Todo" });

      expect(sdkMock.issues).toHaveBeenCalledWith({ filter: { state: { name: { eq: "Todo" } } } });
    });

    it("adds project, assignee, and team clauses when provided", async () => {
      sdkMock.issues.mockResolvedValue({ nodes: [] });

      await client.searchIssues({ state: "Todo", projectName: "Alpha", assigneeMe: true, team: "ENG" });

      expect(sdkMock.issues).toHaveBeenCalledWith({
        filter: {
          state: { name: { eq: "Todo" } },
          project: { name: { eq: "Alpha" } },
          assignee: { isMe: { eq: true } },
          team: { or: [{ name: { eq: "ENG" } }, { key: { eq: "ENG" } }] },
        },
      });
    });

    it("maps each result issue, forcing state to the requested filter state", async () => {
      sdkMock.issues.mockResolvedValue({
        nodes: [
          sdkIssue({
            id: "a",
            team: Promise.resolve({ key: "ENG" }),
            project: Promise.resolve({ name: "Alpha" }),
          }),
        ],
      });

      const results = await client.searchIssues({ state: "Todo" });

      expect(results).toHaveLength(1);
      expect(results[0]).toMatchObject({ id: "a", state: "Todo", team: "ENG", project: "Alpha" });
    });
  });

  describe("postComment", () => {
    it("creates a comment via the SDK", async () => {
      sdkMock.createComment.mockResolvedValue({});
      await client.postComment("issue-1", "hello");
      expect(sdkMock.createComment).toHaveBeenCalledWith({ issueId: "issue-1", body: "hello" });
    });
  });

  describe("updateIssueState", () => {
    it("warns and skips when the issue has no team", async () => {
      sdkMock.issue.mockResolvedValue(sdkIssue({ team: Promise.resolve(undefined) }));

      await client.updateIssueState("issue-1", "Done");

      expect(sdkMock.updateIssue).not.toHaveBeenCalled();
      expect(noopLogger.warn).toHaveBeenCalled();
    });

    it("warns and skips when the named state cannot be resolved", async () => {
      sdkMock.issue.mockResolvedValue(sdkIssue({ team: Promise.resolve({ id: "team-1" }) }));
      sdkMock.team.mockResolvedValue({
        states: vi.fn().mockResolvedValue({ nodes: [{ name: "Todo", id: "s1" }] }),
      });

      await client.updateIssueState("issue-1", "NonexistentState");

      expect(sdkMock.updateIssue).not.toHaveBeenCalled();
      expect(noopLogger.warn).toHaveBeenCalled();
    });

    it("resolves the state id and updates the issue, caching the team's states", async () => {
      sdkMock.issue.mockResolvedValue(sdkIssue({ team: Promise.resolve({ id: "team-1" }) }));
      const statesFn = vi.fn().mockResolvedValue({ nodes: [{ name: "Done", id: "s-done" }] });
      sdkMock.team.mockResolvedValue({ states: statesFn });
      sdkMock.updateIssue.mockResolvedValue({});

      await client.updateIssueState("issue-1", "Done");
      await client.updateIssueState("issue-1", "Done");

      expect(sdkMock.updateIssue).toHaveBeenCalledWith("issue-1", { stateId: "s-done" });
      // team() + states() should only be called once due to caching
      expect(sdkMock.team).toHaveBeenCalledTimes(1);
    });
  });

  describe("addLabel", () => {
    it("adds a label by reusing an existing matching label", async () => {
      sdkMock.issue.mockResolvedValue(sdkIssue({ labelIds: [], team: Promise.resolve({ id: "team-1" }) }));
      sdkMock.issueLabels.mockResolvedValue({ nodes: [{ id: "label-1", name: "bug" }] });
      sdkMock.updateIssue.mockResolvedValue({});

      await client.addLabel("issue-1", "bug");

      expect(sdkMock.updateIssue).toHaveBeenCalledWith("issue-1", { labelIds: ["label-1"] });
      expect(sdkMock.createIssueLabel).not.toHaveBeenCalled();
    });

    it("creates a new label when none exists", async () => {
      sdkMock.issue.mockResolvedValue(sdkIssue({ labelIds: [], team: Promise.resolve({ id: "team-1" }) }));
      sdkMock.issueLabels.mockResolvedValue({ nodes: [] });
      sdkMock.createIssueLabel.mockResolvedValue({
        issueLabel: Promise.resolve({ id: "new-label-1" }),
      });
      sdkMock.updateIssue.mockResolvedValue({});

      await client.addLabel("issue-1", "new-label");

      expect(sdkMock.createIssueLabel).toHaveBeenCalledWith({ name: "new-label", teamId: "team-1" });
      expect(sdkMock.updateIssue).toHaveBeenCalledWith("issue-1", { labelIds: ["new-label-1"] });
    });

    it("throws when label creation does not return an issueLabel", async () => {
      sdkMock.issue.mockResolvedValue(sdkIssue({ labelIds: [], team: Promise.resolve(undefined) }));
      sdkMock.issueLabels.mockResolvedValue({ nodes: [] });
      sdkMock.createIssueLabel.mockResolvedValue({ issueLabel: Promise.resolve(undefined) });

      await expect(client.addLabel("issue-1", "new-label")).rejects.toThrow(
        "Failed to create label: new-label",
      );
    });

    it("does not duplicate a label id already present on the issue", async () => {
      sdkMock.issue.mockResolvedValue(
        sdkIssue({ labelIds: ["label-1"], team: Promise.resolve({ id: "team-1" }) }),
      );
      sdkMock.issueLabels.mockResolvedValue({ nodes: [{ id: "label-1", name: "bug" }] });

      await client.addLabel("issue-1", "bug");

      expect(sdkMock.updateIssue).not.toHaveBeenCalled();
    });
  });

  describe("removeLabel", () => {
    it("removes a label found via the issue's current labels (cache miss)", async () => {
      sdkMock.issue.mockResolvedValue(
        sdkIssue({
          labelIds: ["label-1", "label-2"],
          labels: vi.fn().mockResolvedValue({ nodes: [{ id: "label-1", name: "bug" }] }),
        }),
      );
      sdkMock.updateIssue.mockResolvedValue({});

      await client.removeLabel("issue-1", "bug");

      expect(sdkMock.updateIssue).toHaveBeenCalledWith("issue-1", { labelIds: ["label-2"] });
    });

    it("is a no-op when the label name is not found on the issue", async () => {
      sdkMock.issue.mockResolvedValue(
        sdkIssue({ labelIds: ["label-1"], labels: vi.fn().mockResolvedValue({ nodes: [] }) }),
      );

      await client.removeLabel("issue-1", "missing-label");

      expect(sdkMock.updateIssue).not.toHaveBeenCalled();
    });

    it("uses the cached label id on a second removal without re-fetching labels", async () => {
      const labelsFn = vi.fn().mockResolvedValue({ nodes: [{ id: "label-1", name: "bug" }] });
      sdkMock.issue.mockResolvedValue(sdkIssue({ labelIds: ["label-1"], labels: labelsFn }));
      sdkMock.updateIssue.mockResolvedValue({});

      await client.removeLabel("issue-1", "bug");
      sdkMock.issue.mockResolvedValue(sdkIssue({ labelIds: ["label-1"], labels: labelsFn }));
      await client.removeLabel("issue-1", "bug");

      expect(labelsFn).toHaveBeenCalledTimes(1);
    });
  });

  describe("listLabels", () => {
    it("returns the issue's label names and warms the label cache", async () => {
      sdkMock.issue.mockResolvedValue(
        sdkIssue({ labels: vi.fn().mockResolvedValue({ nodes: [{ id: "l1", name: "bug" }] }) }),
      );

      const names = await client.listLabels("issue-1");

      expect(names).toEqual(["bug"]);
    });
  });
});
