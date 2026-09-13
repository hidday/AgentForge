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
  team: Promise<{ id: string; key: string } | null>;
  state: Promise<{ id: string; name: string } | null>;
  project: Promise<{ name: string } | null>;
  cycle: Promise<{ name: string } | null>;
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
    team: Promise.resolve({ id: "team-1", key: "PRY" }),
    state: Promise.resolve({ id: "state-1", name: "Todo" }),
    project: Promise.resolve(null),
    cycle: Promise.resolve(null),
    labels: () => Promise.resolve({ nodes: [] }),
    ...overrides,
  };
}

type FakeSdk = {
  issue: ReturnType<typeof vi.fn>;
  issues: ReturnType<typeof vi.fn>;
  createComment: ReturnType<typeof vi.fn>;
  updateIssue: ReturnType<typeof vi.fn>;
  team: ReturnType<typeof vi.fn>;
  issueLabels: ReturnType<typeof vi.fn>;
  createIssueLabel: ReturnType<typeof vi.fn>;
};

function installFakeSdk(client: RealLinearClient): FakeSdk {
  const fakeSdk: FakeSdk = {
    issue: vi.fn(),
    issues: vi.fn(),
    createComment: vi.fn(),
    updateIssue: vi.fn(),
    team: vi.fn(),
    issueLabels: vi.fn(),
    createIssueLabel: vi.fn(),
  };
  (client as unknown as { sdk: FakeSdk }).sdk = fakeSdk;
  return fakeSdk;
}

describe("RealLinearClient", () => {
  let client: RealLinearClient;
  let logger: ReturnType<typeof makeLogger>;
  let sdk: FakeSdk;

  beforeEach(() => {
    logger = makeLogger();
    client = new RealLinearClient("test-key", logger as never);
    sdk = installFakeSdk(client);
  });

  describe("getIssue", () => {
    it("maps a full SDK issue, including project/team/cycle", async () => {
      const issue = makeFakeIssue({
        id: "issue-1",
        identifier: "PRY-5",
        project: Promise.resolve({ name: "Payments" }),
        cycle: Promise.resolve({ name: "Cycle 3" }),
        labels: () => Promise.resolve({ nodes: [{ id: "l1", name: "bug" }] }),
      });
      sdk.issue.mockResolvedValue(issue);

      const result = await client.getIssue("issue-1");

      expect(result).toEqual({
        id: "issue-1",
        identifier: "PRY-5",
        title: "Issue title",
        description: "Issue description",
        branchName: "ai/issue-1",
        state: "Todo",
        labels: ["bug"],
        priority: 0,
        url: "https://linear.app/team/issue/PRY-1",
        project: "Payments",
        team: "PRY",
        cycle: "Cycle 3",
      });
    });

    it("defaults state to Unknown and omits project/team/cycle when absent", async () => {
      const issue = makeFakeIssue({
        id: "issue-2",
        state: Promise.resolve(null),
        team: Promise.resolve(null),
        description: null,
      });
      sdk.issue.mockResolvedValue(issue);

      const result = await client.getIssue("issue-2");

      expect(result.state).toBe("Unknown");
      expect(result.description).toBe("");
      expect(result.project).toBeUndefined();
      expect(result.team).toBeUndefined();
      expect(result.cycle).toBeUndefined();
    });
  });

  describe("searchIssues", () => {
    it("builds a base filter from just state and maps results", async () => {
      const issue = makeFakeIssue({
        id: "issue-1",
        labels: () => Promise.resolve({ nodes: [{ id: "l1", name: "bug" }] }),
        project: Promise.resolve({ name: "Payments" }),
        cycle: Promise.resolve({ name: "Cycle 1" }),
        team: Promise.resolve({ id: "team-1", key: "PRY" }),
      });
      sdk.issues.mockResolvedValue({ nodes: [issue] });

      const results = await client.searchIssues({ state: "Todo" });

      expect(sdk.issues).toHaveBeenCalledWith({ filter: { state: { name: { eq: "Todo" } } } });
      expect(results).toEqual([
        {
          id: "issue-1",
          identifier: "PRY-1",
          title: "Issue title",
          description: "Issue description",
          branchName: "ai/issue-1",
          state: "Todo",
          labels: ["bug"],
          priority: 0,
          url: "https://linear.app/team/issue/PRY-1",
          project: "Payments",
          team: "PRY",
          cycle: "Cycle 1",
        },
      ]);
    });

    it("adds project, assignee, and team clauses when provided", async () => {
      sdk.issues.mockResolvedValue({ nodes: [] });

      await client.searchIssues({
        state: "In Progress",
        projectName: "Payments",
        assigneeMe: true,
        team: "PRY",
      });

      expect(sdk.issues).toHaveBeenCalledWith({
        filter: {
          state: { name: { eq: "In Progress" } },
          project: { name: { eq: "Payments" } },
          assignee: { isMe: { eq: true } },
          team: { or: [{ name: { eq: "PRY" } }, { key: { eq: "PRY" } }] },
        },
      });
    });

    it("returns an empty array when the connection has no nodes", async () => {
      sdk.issues.mockResolvedValue({ nodes: undefined });

      const results = await client.searchIssues({ state: "Done" });

      expect(results).toEqual([]);
      expect(logger.info).toHaveBeenCalledWith(
        expect.objectContaining({ stateName: "Done", count: 0 }),
        "Searched Linear issues",
      );
    });

    it("returns an empty array when issuesConn itself is nullish", async () => {
      sdk.issues.mockResolvedValue(null);

      const results = await client.searchIssues({ state: "Done" });

      expect(results).toEqual([]);
    });
  });

  describe("postComment", () => {
    it("creates a comment via the SDK", async () => {
      sdk.createComment.mockResolvedValue({});

      await client.postComment("issue-1", "hello world");

      expect(sdk.createComment).toHaveBeenCalledWith({ issueId: "issue-1", body: "hello world" });
      expect(logger.debug).toHaveBeenCalledWith(
        { issueId: "issue-1" },
        "Posted comment to Linear issue",
      );
    });
  });

  describe("updateIssueState", () => {
    it("resolves the state id for the issue's team and updates the issue", async () => {
      const issue = makeFakeIssue({ id: "issue-1", team: Promise.resolve({ id: "team-1", key: "PRY" }) });
      sdk.issue.mockResolvedValue(issue);
      sdk.team.mockResolvedValue({
        states: () =>
          Promise.resolve({
            nodes: [
              { id: "state-todo", name: "Todo" },
              { id: "state-done", name: "Done" },
            ],
          }),
      });
      sdk.updateIssue.mockResolvedValue({});

      await client.updateIssueState("issue-1", "Done");

      expect(sdk.team).toHaveBeenCalledWith("team-1");
      expect(sdk.updateIssue).toHaveBeenCalledWith("issue-1", { stateId: "state-done" });
    });

    it("caches the resolved state map across calls for the same team", async () => {
      const issue = makeFakeIssue({ id: "issue-1", team: Promise.resolve({ id: "team-1", key: "PRY" }) });
      sdk.issue.mockResolvedValue(issue);
      const statesFn = vi.fn().mockResolvedValue({ nodes: [{ id: "state-done", name: "Done" }] });
      sdk.team.mockResolvedValue({ states: statesFn });
      sdk.updateIssue.mockResolvedValue({});

      await client.updateIssueState("issue-1", "Done");
      await client.updateIssueState("issue-1", "Done");

      expect(sdk.team).toHaveBeenCalledTimes(1);
      expect(statesFn).toHaveBeenCalledTimes(1);
    });

    it("warns and does nothing when the issue has no team", async () => {
      const issue = makeFakeIssue({ id: "issue-1", team: Promise.resolve(null) });
      sdk.issue.mockResolvedValue(issue);

      await client.updateIssueState("issue-1", "Done");

      expect(logger.warn).toHaveBeenCalledWith(
        { issueId: "issue-1" },
        "Cannot update state: issue has no team",
      );
      expect(sdk.updateIssue).not.toHaveBeenCalled();
    });

    it("warns and does nothing when the named state cannot be found", async () => {
      const issue = makeFakeIssue({ id: "issue-1", team: Promise.resolve({ id: "team-1", key: "PRY" }) });
      sdk.issue.mockResolvedValue(issue);
      sdk.team.mockResolvedValue({ states: () => Promise.resolve({ nodes: [] }) });

      await client.updateIssueState("issue-1", "Nonexistent");

      expect(logger.warn).toHaveBeenCalledWith(
        { issueId: "issue-1", stateName: "Nonexistent", teamId: "team-1" },
        "Could not find workflow state by name",
      );
      expect(sdk.updateIssue).not.toHaveBeenCalled();
    });
  });

  describe("addLabel", () => {
    it("resolves an existing label by name and appends it to the issue's labels", async () => {
      const issue = makeFakeIssue({
        id: "issue-1",
        team: Promise.resolve({ id: "team-1", key: "PRY" }),
        labelIds: ["existing-id"],
      });
      sdk.issue.mockResolvedValue(issue);
      sdk.issueLabels.mockResolvedValue({ nodes: [{ id: "label-1", name: "bug" }] });
      sdk.updateIssue.mockResolvedValue({});

      await client.addLabel("issue-1", "bug");

      expect(sdk.issueLabels).toHaveBeenCalledWith({ filter: { name: { eq: "bug" } } });
      expect(sdk.updateIssue).toHaveBeenCalledWith("issue-1", {
        labelIds: ["existing-id", "label-1"],
      });
    });

    it("creates the label when it does not already exist, scoped to the issue's team", async () => {
      const issue = makeFakeIssue({
        id: "issue-1",
        team: Promise.resolve({ id: "team-1", key: "PRY" }),
        labelIds: [],
      });
      sdk.issue.mockResolvedValue(issue);
      sdk.issueLabels.mockResolvedValue({ nodes: [] });
      sdk.createIssueLabel.mockResolvedValue({
        issueLabel: Promise.resolve({ id: "new-label-id" }),
      });
      sdk.updateIssue.mockResolvedValue({});

      await client.addLabel("issue-1", "new-label");

      expect(sdk.createIssueLabel).toHaveBeenCalledWith({
        name: "new-label",
        teamId: "team-1",
      });
      expect(sdk.updateIssue).toHaveBeenCalledWith("issue-1", { labelIds: ["new-label-id"] });
      expect(logger.info).toHaveBeenCalledWith(
        { labelName: "new-label", labelId: "new-label-id" },
        "Created new Linear label",
      );
    });

    it("creates a workspace-level label (no teamId) when the issue has no team", async () => {
      const issue = makeFakeIssue({ id: "issue-1", team: Promise.resolve(null), labelIds: [] });
      sdk.issue.mockResolvedValue(issue);
      sdk.issueLabels.mockResolvedValue({ nodes: [] });
      sdk.createIssueLabel.mockResolvedValue({
        issueLabel: Promise.resolve({ id: "wl-1" }),
      });
      sdk.updateIssue.mockResolvedValue({});

      await client.addLabel("issue-1", "global-label");

      expect(sdk.createIssueLabel).toHaveBeenCalledWith({ name: "global-label" });
    });

    it("throws when label creation reports no created label", async () => {
      const issue = makeFakeIssue({ id: "issue-1", team: Promise.resolve(null), labelIds: [] });
      sdk.issue.mockResolvedValue(issue);
      sdk.issueLabels.mockResolvedValue({ nodes: [] });
      sdk.createIssueLabel.mockResolvedValue({ issueLabel: Promise.resolve(null) });

      await expect(client.addLabel("issue-1", "broken-label")).rejects.toThrow(
        "Failed to create label: broken-label",
      );
    });

    it("does not duplicate a label the issue already has", async () => {
      const issue = makeFakeIssue({
        id: "issue-1",
        team: Promise.resolve({ id: "team-1", key: "PRY" }),
        labelIds: ["label-1"],
      });
      sdk.issue.mockResolvedValue(issue);
      sdk.issueLabels.mockResolvedValue({ nodes: [{ id: "label-1", name: "bug" }] });

      await client.addLabel("issue-1", "bug");

      expect(sdk.updateIssue).not.toHaveBeenCalled();
    });

    it("uses the label cache on a second call instead of re-querying", async () => {
      const issue = makeFakeIssue({
        id: "issue-1",
        team: Promise.resolve({ id: "team-1", key: "PRY" }),
        labelIds: [],
      });
      sdk.issue.mockResolvedValue(issue);
      sdk.issueLabels.mockResolvedValue({ nodes: [{ id: "label-1", name: "bug" }] });
      sdk.updateIssue.mockResolvedValue({});

      await client.addLabel("issue-1", "bug");
      await client.addLabel("issue-1", "bug");

      expect(sdk.issueLabels).toHaveBeenCalledTimes(1);
    });
  });

  describe("removeLabel", () => {
    it("removes a label found via listLabels lookup when not cached", async () => {
      const issue = makeFakeIssue({ id: "issue-1", labelIds: ["label-1", "label-2"] });
      sdk.issue.mockResolvedValue(issue);
      issue.labels = () =>
        Promise.resolve({
          nodes: [
            { id: "label-1", name: "bug" },
            { id: "label-2", name: "keep-me" },
          ],
        });
      sdk.updateIssue.mockResolvedValue({});

      await client.removeLabel("issue-1", "bug");

      expect(sdk.updateIssue).toHaveBeenCalledWith("issue-1", { labelIds: ["label-2"] });
    });

    it("does nothing when the named label is not found on the issue", async () => {
      const issue = makeFakeIssue({ id: "issue-1", labelIds: ["label-2"] });
      issue.labels = () => Promise.resolve({ nodes: [{ id: "label-2", name: "keep-me" }] });
      sdk.issue.mockResolvedValue(issue);

      await client.removeLabel("issue-1", "missing-label");

      expect(sdk.updateIssue).not.toHaveBeenCalled();
    });

    it("uses the cached label id on a subsequent removal without calling labels() again", async () => {
      const issue = makeFakeIssue({ id: "issue-1", labelIds: ["label-1"] });
      const labelsFn = vi.fn().mockResolvedValue({ nodes: [{ id: "label-1", name: "bug" }] });
      issue.labels = labelsFn;
      sdk.issue.mockResolvedValue(issue);
      sdk.updateIssue.mockResolvedValue({});

      // First call populates the label cache via listLabels-equivalent path (removeLabel itself).
      await client.removeLabel("issue-1", "bug");
      expect(labelsFn).toHaveBeenCalledTimes(1);

      // Second removal of the same label name should hit the cache branch.
      const issueAgain = makeFakeIssue({ id: "issue-1", labelIds: ["label-1"] });
      issueAgain.labels = labelsFn;
      sdk.issue.mockResolvedValue(issueAgain);

      await client.removeLabel("issue-1", "bug");

      expect(labelsFn).toHaveBeenCalledTimes(1);
      expect(sdk.updateIssue).toHaveBeenLastCalledWith("issue-1", { labelIds: [] });
    });
  });

  describe("listLabels", () => {
    it("returns label names and populates the label cache", async () => {
      const issue = makeFakeIssue({ id: "issue-1" });
      issue.labels = () =>
        Promise.resolve({
          nodes: [
            { id: "l1", name: "bug" },
            { id: "l2", name: "urgent" },
          ],
        });
      sdk.issue.mockResolvedValue(issue);

      const names = await client.listLabels("issue-1");

      expect(names).toEqual(["bug", "urgent"]);
    });

    it("returns an empty array when the issue has no labels", async () => {
      const issue = makeFakeIssue({ id: "issue-1" });
      issue.labels = () => Promise.resolve({ nodes: [] });
      sdk.issue.mockResolvedValue(issue);

      await expect(client.listLabels("issue-1")).resolves.toEqual([]);
    });

    it("handles a nullish labels connection gracefully", async () => {
      const issue = makeFakeIssue({ id: "issue-1" });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      issue.labels = () => Promise.resolve(null as any);
      sdk.issue.mockResolvedValue(issue);

      await expect(client.listLabels("issue-1")).resolves.toEqual([]);
    });
  });
});
