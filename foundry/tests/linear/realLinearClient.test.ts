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
  state: Promise<{ id: string; name: string } | null>;
  project: Promise<{ name: string } | null>;
  cycle: Promise<{ name: string } | null>;
  team: Promise<{ id: string; key: string } | null>;
  labels: () => Promise<{ nodes: Array<{ id: string; name: string }> } | null>;
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
    team: Promise.resolve({ id: "team-1", key: "PRY" }),
    labels: () => Promise.resolve({ nodes: [] }),
    ...overrides,
  };
}

function makeClient() {
  const logger = makeLogger();
  const client = new RealLinearClient("test-key", logger as never);
  const sdk = {
    issue: vi.fn(),
    issues: vi.fn(),
    createComment: vi.fn(),
    updateIssue: vi.fn(),
    team: vi.fn(),
    issueLabels: vi.fn(),
    createIssueLabel: vi.fn(),
  };
  (client as unknown as { sdk: typeof sdk }).sdk = sdk;
  return { client, sdk, logger };
}

describe("RealLinearClient", () => {
  let client: RealLinearClient;
  let sdk: ReturnType<typeof makeClient>["sdk"];
  let logger: ReturnType<typeof makeLogger>;

  beforeEach(() => {
    const ctx = makeClient();
    client = ctx.client;
    sdk = ctx.sdk;
    logger = ctx.logger;
  });

  describe("getIssue", () => {
    it("maps all fields, including labels, state, project, cycle, and team", async () => {
      const issue = makeFakeIssue({
        id: "issue-1",
        identifier: "PRY-1",
        title: "Fix bug",
        description: "desc",
        branchName: "ai/fix-bug",
        priority: 2,
        url: "https://linear.app/x",
        state: Promise.resolve({ id: "s1", name: "In Progress" }),
        project: Promise.resolve({ name: "Project A" }),
        cycle: Promise.resolve({ name: "Cycle 3" }),
        team: Promise.resolve({ id: "t1", key: "PRY" }),
        labels: () => Promise.resolve({ nodes: [{ id: "l1", name: "bug" }] }),
      });
      sdk.issue.mockResolvedValue(issue);

      const result = await client.getIssue("issue-1");

      expect(result).toEqual({
        id: "issue-1",
        identifier: "PRY-1",
        title: "Fix bug",
        description: "desc",
        branchName: "ai/fix-bug",
        state: "In Progress",
        labels: ["bug"],
        priority: 2,
        url: "https://linear.app/x",
        project: "Project A",
        team: "PRY",
        cycle: "Cycle 3",
      });
    });

    it("defaults missing description, state, labels, and relations", async () => {
      const issue = makeFakeIssue({
        id: "issue-2",
        description: null,
        state: Promise.resolve(null),
        project: Promise.resolve(null),
        cycle: Promise.resolve(null),
        team: Promise.resolve(null),
        labels: () => Promise.resolve(null),
      });
      sdk.issue.mockResolvedValue(issue);

      const result = await client.getIssue("issue-2");

      expect(result.description).toBe("");
      expect(result.state).toBe("Unknown");
      expect(result.labels).toEqual([]);
      expect(result.project).toBeUndefined();
      expect(result.team).toBeUndefined();
      expect(result.cycle).toBeUndefined();
    });
  });

  describe("searchIssues", () => {
    it("builds a filter with only the base state when no optional filters are set", async () => {
      sdk.issues.mockResolvedValue({ nodes: [] });

      await client.searchIssues({ state: "Todo" });

      expect(sdk.issues).toHaveBeenCalledWith({ filter: { state: { name: { eq: "Todo" } } } });
    });

    it("adds project, assignee, and team clauses when provided", async () => {
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

    it("maps results using the requested state name, not each issue's live state", async () => {
      const issue1 = makeFakeIssue({
        id: "a",
        project: Promise.resolve({ name: "Project A" }),
        cycle: Promise.resolve({ name: "Cycle 1" }),
        team: Promise.resolve({ id: "t1", key: "PRY" }),
        labels: () => Promise.resolve({ nodes: [{ id: "l1", name: "bug" }] }),
      });
      sdk.issues.mockResolvedValue({ nodes: [issue1] });

      const results = await client.searchIssues({ state: "Todo" });

      expect(results).toEqual([
        {
          id: "a",
          identifier: "PRY-1",
          title: "Issue title",
          description: "Issue description",
          branchName: "ai/issue-1",
          state: "Todo",
          labels: ["bug"],
          priority: 0,
          url: "https://linear.app/team/issue/PRY-1",
          project: "Project A",
          team: "PRY",
          cycle: "Cycle 1",
        },
      ]);
    });

    it("returns an empty array when the SDK returns no connection", async () => {
      sdk.issues.mockResolvedValue(null);

      const results = await client.searchIssues({ state: "Todo" });

      expect(results).toEqual([]);
    });
  });

  describe("postComment", () => {
    it("calls sdk.createComment with the issue id and body", async () => {
      sdk.createComment.mockResolvedValue({});

      await client.postComment("issue-1", "hello");

      expect(sdk.createComment).toHaveBeenCalledWith({ issueId: "issue-1", body: "hello" });
      expect(logger.debug).toHaveBeenCalled();
    });
  });

  describe("updateIssueState", () => {
    it("warns and does nothing when the issue has no team", async () => {
      const issue = makeFakeIssue({ id: "issue-1", team: Promise.resolve(null) });
      sdk.issue.mockResolvedValue(issue);

      await client.updateIssueState("issue-1", "Done");

      expect(logger.warn).toHaveBeenCalledWith({ issueId: "issue-1" }, "Cannot update state: issue has no team");
      expect(sdk.updateIssue).not.toHaveBeenCalled();
    });

    it("warns and does nothing when no matching workflow state is found", async () => {
      const issue = makeFakeIssue({ id: "issue-1", team: Promise.resolve({ id: "team-1", key: "PRY" }) });
      sdk.issue.mockResolvedValue(issue);
      sdk.team.mockResolvedValue({ states: () => Promise.resolve({ nodes: [] }) });

      await client.updateIssueState("issue-1", "Nonexistent State");

      expect(sdk.updateIssue).not.toHaveBeenCalled();
      expect(logger.warn).toHaveBeenCalled();
    });

    it("resolves the state id and calls updateIssue", async () => {
      const issue = makeFakeIssue({ id: "issue-1", team: Promise.resolve({ id: "team-1", key: "PRY" }) });
      sdk.issue.mockResolvedValue(issue);
      sdk.team.mockResolvedValue({
        states: () =>
          Promise.resolve({ nodes: [{ id: "state-done", name: "Done" }, { id: "state-todo", name: "Todo" }] }),
      });

      await client.updateIssueState("issue-1", "Done");

      expect(sdk.updateIssue).toHaveBeenCalledWith("issue-1", { stateId: "state-done" });
    });

    it("caches the team's state map so a second call for the same team does not refetch states", async () => {
      const issue1 = makeFakeIssue({ id: "issue-1", team: Promise.resolve({ id: "team-1", key: "PRY" }) });
      const issue2 = makeFakeIssue({ id: "issue-2", team: Promise.resolve({ id: "team-1", key: "PRY" }) });
      sdk.issue.mockImplementation((id: string) =>
        Promise.resolve(id === "issue-1" ? issue1 : issue2),
      );
      const statesFn = vi.fn().mockResolvedValue({ nodes: [{ id: "state-done", name: "Done" }] });
      sdk.team.mockResolvedValue({ states: statesFn });

      await client.updateIssueState("issue-1", "Done");
      await client.updateIssueState("issue-2", "Done");

      expect(sdk.team).toHaveBeenCalledTimes(1);
      expect(statesFn).toHaveBeenCalledTimes(1);
      expect(sdk.updateIssue).toHaveBeenCalledTimes(2);
    });
  });

  describe("addLabel", () => {
    it("resolves an existing label by name and adds it when not already present", async () => {
      const issue = makeFakeIssue({
        id: "issue-1",
        labelIds: ["other-id"],
        team: Promise.resolve({ id: "team-1", key: "PRY" }),
      });
      sdk.issue.mockResolvedValue(issue);
      sdk.issueLabels.mockResolvedValue({ nodes: [{ id: "label-bug", name: "bug" }] });

      await client.addLabel("issue-1", "bug");

      expect(sdk.issueLabels).toHaveBeenCalledWith({ filter: { name: { eq: "bug" } } });
      expect(sdk.updateIssue).toHaveBeenCalledWith("issue-1", { labelIds: ["other-id", "label-bug"] });
    });

    it("creates a new label (scoped to the issue's team) when none exists", async () => {
      const issue = makeFakeIssue({
        id: "issue-1",
        labelIds: [],
        team: Promise.resolve({ id: "team-1", key: "PRY" }),
      });
      sdk.issue.mockResolvedValue(issue);
      sdk.issueLabels.mockResolvedValue({ nodes: [] });
      sdk.createIssueLabel.mockResolvedValue({
        issueLabel: Promise.resolve({ id: "new-label-id", name: "urgent" }),
      });

      await client.addLabel("issue-1", "urgent");

      expect(sdk.createIssueLabel).toHaveBeenCalledWith({ name: "urgent", teamId: "team-1" });
      expect(sdk.updateIssue).toHaveBeenCalledWith("issue-1", { labelIds: ["new-label-id"] });
      expect(logger.info).toHaveBeenCalled();
    });

    it("creates a label without a teamId when the issue has no team", async () => {
      const issue = makeFakeIssue({ id: "issue-1", labelIds: [], team: Promise.resolve(null) });
      sdk.issue.mockResolvedValue(issue);
      sdk.issueLabels.mockResolvedValue({ nodes: [] });
      sdk.createIssueLabel.mockResolvedValue({
        issueLabel: Promise.resolve({ id: "new-label-id", name: "urgent" }),
      });

      await client.addLabel("issue-1", "urgent");

      expect(sdk.createIssueLabel).toHaveBeenCalledWith({ name: "urgent" });
    });

    it("throws when label creation does not yield an issueLabel", async () => {
      const issue = makeFakeIssue({ id: "issue-1", labelIds: [], team: Promise.resolve(null) });
      sdk.issue.mockResolvedValue(issue);
      sdk.issueLabels.mockResolvedValue({ nodes: [] });
      sdk.createIssueLabel.mockResolvedValue({ issueLabel: Promise.resolve(null) });

      await expect(client.addLabel("issue-1", "urgent")).rejects.toThrow(
        "Failed to create label: urgent",
      );
    });

    it("does not call updateIssue when the label is already present on the issue", async () => {
      const issue = makeFakeIssue({
        id: "issue-1",
        labelIds: ["label-bug"],
        team: Promise.resolve({ id: "team-1", key: "PRY" }),
      });
      sdk.issue.mockResolvedValue(issue);
      sdk.issueLabels.mockResolvedValue({ nodes: [{ id: "label-bug", name: "bug" }] });

      await client.addLabel("issue-1", "bug");

      expect(sdk.updateIssue).not.toHaveBeenCalled();
    });

    it("uses the cached label id on a second call instead of re-querying issueLabels", async () => {
      const issue1 = makeFakeIssue({
        id: "issue-1",
        labelIds: [],
        team: Promise.resolve({ id: "team-1", key: "PRY" }),
      });
      const issue2 = makeFakeIssue({
        id: "issue-2",
        labelIds: [],
        team: Promise.resolve({ id: "team-1", key: "PRY" }),
      });
      sdk.issue.mockImplementation((id: string) =>
        Promise.resolve(id === "issue-1" ? issue1 : issue2),
      );
      sdk.issueLabels.mockResolvedValue({ nodes: [{ id: "label-bug", name: "bug" }] });

      await client.addLabel("issue-1", "bug");
      await client.addLabel("issue-2", "bug");

      expect(sdk.issueLabels).toHaveBeenCalledTimes(1);
    });
  });

  describe("removeLabel", () => {
    it("removes a label found via the issue's live labels when not cached", async () => {
      const issue = makeFakeIssue({
        id: "issue-1",
        labelIds: ["label-bug", "label-other"],
        labels: () => Promise.resolve({ nodes: [{ id: "label-bug", name: "bug" }] }),
      });
      sdk.issue.mockResolvedValue(issue);

      await client.removeLabel("issue-1", "bug");

      expect(sdk.updateIssue).toHaveBeenCalledWith("issue-1", { labelIds: ["label-other"] });
    });

    it("does nothing when the label name cannot be found on the issue", async () => {
      const issue = makeFakeIssue({
        id: "issue-1",
        labelIds: ["label-other"],
        labels: () => Promise.resolve({ nodes: [] }),
      });
      sdk.issue.mockResolvedValue(issue);

      await client.removeLabel("issue-1", "missing-label");

      expect(sdk.updateIssue).not.toHaveBeenCalled();
    });

    it("uses the cached label id on a subsequent removal instead of calling labels() again", async () => {
      const issue1 = makeFakeIssue({
        id: "issue-1",
        labelIds: ["label-bug"],
        labels: () => Promise.resolve({ nodes: [{ id: "label-bug", name: "bug" }] }),
      });
      const issue2 = makeFakeIssue({
        id: "issue-2",
        labelIds: ["label-bug"],
      });
      const labelsFn = vi.fn().mockResolvedValue({ nodes: [{ id: "label-bug", name: "bug" }] });
      issue1.labels = labelsFn;
      sdk.issue.mockImplementation((id: string) =>
        Promise.resolve(id === "issue-1" ? issue1 : issue2),
      );

      await client.removeLabel("issue-1", "bug");
      await client.removeLabel("issue-2", "bug");

      expect(labelsFn).toHaveBeenCalledTimes(1);
      expect(sdk.updateIssue).toHaveBeenNthCalledWith(2, "issue-2", { labelIds: [] });
    });
  });

  describe("listLabels", () => {
    it("returns label names and populates the label cache for later use", async () => {
      const issue1 = makeFakeIssue({
        id: "issue-1",
        labels: () => Promise.resolve({ nodes: [{ id: "label-bug", name: "bug" }] }),
      });
      sdk.issue.mockResolvedValue(issue1);

      const names = await client.listLabels("issue-1");

      expect(names).toEqual(["bug"]);

      // Second call for removeLabel on a different issue should hit the cache
      // populated by listLabels rather than calling labels() again.
      const issue2 = makeFakeIssue({ id: "issue-2", labelIds: ["label-bug"] });
      sdk.issue.mockResolvedValue(issue2);

      await client.removeLabel("issue-2", "bug");

      expect(sdk.updateIssue).toHaveBeenCalledWith("issue-2", { labelIds: [] });
    });

    it("returns an empty array when there is no labels connection", async () => {
      const issue = makeFakeIssue({ id: "issue-1", labels: () => Promise.resolve(null) });
      sdk.issue.mockResolvedValue(issue);

      await expect(client.listLabels("issue-1")).resolves.toEqual([]);
    });
  });
});
