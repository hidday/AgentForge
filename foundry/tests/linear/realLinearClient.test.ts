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
  state: Promise<{ id: string; name: string } | null>;
  project: Promise<{ id: string; name: string } | null>;
  cycle: Promise<{ id: string; name: string } | null>;
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
    project: Promise.resolve({ id: "proj-1", name: "Project X" }),
    cycle: Promise.resolve({ id: "cycle-1", name: "Cycle 1" }),
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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type FakeSdk = Record<string, any>;

function injectSdk(client: RealLinearClient, sdk: FakeSdk): void {
  (client as unknown as { sdk: FakeSdk }).sdk = sdk;
}

describe("RealLinearClient", () => {
  let logger: ReturnType<typeof makeLogger>;
  let client: RealLinearClient;

  beforeEach(() => {
    logger = makeLogger();
    client = new RealLinearClient("test-key", logger as never);
  });

  describe("getIssue", () => {
    it("maps a fully-populated SDK issue to a LinearIssue", async () => {
      const issue = makeFakeIssue({
        id: "issue-1",
        identifier: "PRY-42",
        title: "Fix the bug",
        description: "Some description",
        labels: () => Promise.resolve({ nodes: [{ id: "l1", name: "bug" }] }),
      });
      injectSdk(client, { issue: () => Promise.resolve(issue) });

      const result = await client.getIssue("issue-1");

      expect(result).toEqual({
        id: "issue-1",
        identifier: "PRY-42",
        title: "Fix the bug",
        description: "Some description",
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

    it("falls back to defaults when description, state, project, cycle, team, and labels are absent", async () => {
      const issue = makeFakeIssue({
        id: "issue-2",
        description: null,
        state: Promise.resolve(null),
        project: Promise.resolve(null),
        cycle: Promise.resolve(null),
        team: Promise.resolve(null),
        labels: () => Promise.resolve(null),
      });
      injectSdk(client, { issue: () => Promise.resolve(issue) });

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
    it("builds a base filter with only state when no optional filters are given", async () => {
      const issuesSpy = vi.fn().mockResolvedValue({ nodes: [] });
      injectSdk(client, { issues: issuesSpy });

      await client.searchIssues({ state: "Todo" });

      expect(issuesSpy).toHaveBeenCalledWith({
        filter: { state: { name: { eq: "Todo" } } },
      });
    });

    it("adds project, assignee, and team clauses when provided", async () => {
      const issuesSpy = vi.fn().mockResolvedValue({ nodes: [] });
      injectSdk(client, { issues: issuesSpy });

      await client.searchIssues({
        state: "In Progress",
        projectName: "Project X",
        assigneeMe: true,
        team: "PRY",
      });

      expect(issuesSpy).toHaveBeenCalledWith({
        filter: {
          state: { name: { eq: "In Progress" } },
          project: { name: { eq: "Project X" } },
          assignee: { isMe: { eq: true } },
          team: { or: [{ name: { eq: "PRY" } }, { key: { eq: "PRY" } }] },
        },
      });
    });

    it("maps matching issues, applying the requested state and defaults for missing fields", async () => {
      const issue = makeFakeIssue({
        id: "issue-1",
        identifier: "PRY-1",
        description: null,
        project: Promise.resolve(null),
        cycle: Promise.resolve(null),
        team: Promise.resolve(null),
        labels: () => Promise.resolve({ nodes: [{ id: "l1", name: "urgent" }] }),
      });
      injectSdk(client, { issues: () => Promise.resolve({ nodes: [issue] }) });

      const results = await client.searchIssues({ state: "Todo" });

      expect(results).toEqual([
        {
          id: "issue-1",
          identifier: "PRY-1",
          title: "Issue title",
          description: "",
          branchName: "ai/issue-1",
          state: "Todo",
          labels: ["urgent"],
          priority: 0,
          url: "https://linear.app/team/issue/PRY-1",
          project: undefined,
          team: undefined,
          cycle: undefined,
        },
      ]);
      expect(logger.info).toHaveBeenCalledWith(
        expect.objectContaining({ count: 1 }),
        "Searched Linear issues",
      );
    });

    it("returns an empty array when the SDK returns no nodes at all", async () => {
      injectSdk(client, { issues: () => Promise.resolve(null) });

      const results = await client.searchIssues({ state: "Todo" });

      expect(results).toEqual([]);
    });
  });

  describe("postComment", () => {
    it("creates a comment via the SDK", async () => {
      const createComment = vi.fn().mockResolvedValue(undefined);
      injectSdk(client, { createComment });

      await client.postComment("issue-1", "Hello world");

      expect(createComment).toHaveBeenCalledWith({ issueId: "issue-1", body: "Hello world" });
      expect(logger.debug).toHaveBeenCalledWith({ issueId: "issue-1" }, "Posted comment to Linear issue");
    });
  });

  describe("updateIssueState", () => {
    it("warns and does nothing when the issue has no team", async () => {
      const issue = makeFakeIssue({ id: "issue-1", team: Promise.resolve(null) });
      const updateIssue = vi.fn();
      injectSdk(client, { issue: () => Promise.resolve(issue), updateIssue });

      await client.updateIssueState("issue-1", "Done");

      expect(updateIssue).not.toHaveBeenCalled();
      expect(logger.warn).toHaveBeenCalledWith(
        { issueId: "issue-1" },
        "Cannot update state: issue has no team",
      );
    });

    it("warns and does nothing when the requested state name cannot be resolved", async () => {
      const issue = makeFakeIssue({ id: "issue-1" });
      const updateIssue = vi.fn();
      const team = vi.fn().mockResolvedValue({
        states: () => Promise.resolve({ nodes: [{ id: "s1", name: "Todo" }] }),
      });
      injectSdk(client, { issue: () => Promise.resolve(issue), team, updateIssue });

      await client.updateIssueState("issue-1", "Nonexistent State");

      expect(updateIssue).not.toHaveBeenCalled();
      expect(logger.warn).toHaveBeenCalledWith(
        { issueId: "issue-1", stateName: "Nonexistent State", teamId: "team-1" },
        "Could not find workflow state by name",
      );
    });

    it("updates the issue state when the state name resolves to an id", async () => {
      const issue = makeFakeIssue({ id: "issue-1" });
      const updateIssue = vi.fn().mockResolvedValue(undefined);
      const teamStates = vi.fn().mockResolvedValue({ nodes: [{ id: "s-done", name: "Done" }] });
      const team = vi.fn().mockResolvedValue({ states: teamStates });
      injectSdk(client, { issue: () => Promise.resolve(issue), team, updateIssue });

      await client.updateIssueState("issue-1", "Done");

      expect(updateIssue).toHaveBeenCalledWith("issue-1", { stateId: "s-done" });
    });

    it("caches resolved workflow states per team across calls", async () => {
      const issue1 = makeFakeIssue({ id: "issue-1" });
      const issue2 = makeFakeIssue({ id: "issue-2" });
      const updateIssue = vi.fn().mockResolvedValue(undefined);
      const teamStates = vi.fn().mockResolvedValue({
        nodes: [
          { id: "s-todo", name: "Todo" },
          { id: "s-done", name: "Done" },
        ],
      });
      const team = vi.fn().mockResolvedValue({ states: teamStates });
      const issueFn = vi.fn((id: string) =>
        Promise.resolve(id === "issue-1" ? issue1 : issue2),
      );
      injectSdk(client, { issue: issueFn, team, updateIssue });

      await client.updateIssueState("issue-1", "Done");
      await client.updateIssueState("issue-2", "Todo");

      expect(team).toHaveBeenCalledTimes(1);
      expect(updateIssue).toHaveBeenNthCalledWith(1, "issue-1", { stateId: "s-done" });
      expect(updateIssue).toHaveBeenNthCalledWith(2, "issue-2", { stateId: "s-todo" });
    });
  });

  describe("addLabel", () => {
    it("creates and adds a new label id when it is not already on the issue", async () => {
      const issue = makeFakeIssue({ id: "issue-1", labelIds: ["existing-id"] });
      const updateIssue = vi.fn().mockResolvedValue(undefined);
      const issueLabels = vi.fn().mockResolvedValue({ nodes: [] });
      const payload = { issueLabel: Promise.resolve({ id: "new-label-id" }) };
      const createIssueLabel = vi.fn().mockResolvedValue(payload);
      injectSdk(client, {
        issue: () => Promise.resolve(issue),
        updateIssue,
        issueLabels,
        createIssueLabel,
      });

      await client.addLabel("issue-1", "urgent");

      expect(createIssueLabel).toHaveBeenCalledWith({ name: "urgent", teamId: "team-1" });
      expect(updateIssue).toHaveBeenCalledWith("issue-1", {
        labelIds: ["existing-id", "new-label-id"],
      });
    });

    it("does not call updateIssue when the label id is already present", async () => {
      const issue = makeFakeIssue({ id: "issue-1", labelIds: ["label-1"] });
      const updateIssue = vi.fn();
      const issueLabels = vi.fn().mockResolvedValue({ nodes: [{ id: "label-1", name: "urgent" }] });
      injectSdk(client, {
        issue: () => Promise.resolve(issue),
        updateIssue,
        issueLabels,
      });

      await client.addLabel("issue-1", "urgent");

      expect(updateIssue).not.toHaveBeenCalled();
    });

    it("reuses an existing label found via issueLabels lookup instead of creating one", async () => {
      const issue = makeFakeIssue({ id: "issue-1", labelIds: [] });
      const updateIssue = vi.fn().mockResolvedValue(undefined);
      const issueLabels = vi.fn().mockResolvedValue({ nodes: [{ id: "found-id", name: "urgent" }] });
      const createIssueLabel = vi.fn();
      injectSdk(client, {
        issue: () => Promise.resolve(issue),
        updateIssue,
        issueLabels,
        createIssueLabel,
      });

      await client.addLabel("issue-1", "urgent");

      expect(createIssueLabel).not.toHaveBeenCalled();
      expect(updateIssue).toHaveBeenCalledWith("issue-1", { labelIds: ["found-id"] });
    });

    it("creates a label without a teamId when the issue has no team", async () => {
      const issue = makeFakeIssue({ id: "issue-1", labelIds: [], team: Promise.resolve(null) });
      const updateIssue = vi.fn().mockResolvedValue(undefined);
      const issueLabels = vi.fn().mockResolvedValue({ nodes: [] });
      const payload = { issueLabel: Promise.resolve({ id: "new-id" }) };
      const createIssueLabel = vi.fn().mockResolvedValue(payload);
      injectSdk(client, {
        issue: () => Promise.resolve(issue),
        updateIssue,
        issueLabels,
        createIssueLabel,
      });

      await client.addLabel("issue-1", "urgent");

      expect(createIssueLabel).toHaveBeenCalledWith({ name: "urgent" });
    });

    it("throws when label creation does not yield a created label", async () => {
      const issue = makeFakeIssue({ id: "issue-1", labelIds: [] });
      const issueLabels = vi.fn().mockResolvedValue({ nodes: [] });
      const createIssueLabel = vi.fn().mockResolvedValue({ issueLabel: Promise.resolve(undefined) });
      injectSdk(client, {
        issue: () => Promise.resolve(issue),
        issueLabels,
        createIssueLabel,
        updateIssue: vi.fn(),
      });

      await expect(client.addLabel("issue-1", "urgent")).rejects.toThrow(
        "Failed to create label: urgent",
      );
    });

    it("caches a resolved label id across repeated addLabel calls", async () => {
      const issue1 = makeFakeIssue({ id: "issue-1", labelIds: [] });
      const issue2 = makeFakeIssue({ id: "issue-2", labelIds: [] });
      const issueLabels = vi.fn().mockResolvedValue({ nodes: [{ id: "cached-id", name: "urgent" }] });
      const updateIssue = vi.fn().mockResolvedValue(undefined);
      const issueFn = vi.fn((id: string) => Promise.resolve(id === "issue-1" ? issue1 : issue2));
      injectSdk(client, { issue: issueFn, issueLabels, updateIssue });

      await client.addLabel("issue-1", "urgent");
      await client.addLabel("issue-2", "urgent");

      expect(issueLabels).toHaveBeenCalledTimes(1);
    });
  });

  describe("removeLabel", () => {
    it("removes a label using a cached label id without re-fetching labels", async () => {
      const issue = makeFakeIssue({ id: "issue-1", labelIds: ["label-1", "label-2"] });
      const labelsFetch = vi.fn().mockResolvedValue({ nodes: [{ id: "label-1", name: "urgent" }] });
      const updateIssue = vi.fn().mockResolvedValue(undefined);
      injectSdk(client, {
        issue: () => Promise.resolve({ ...issue, labels: labelsFetch }),
        updateIssue,
      });

      // Prime the cache via listLabels first.
      await client.listLabels("issue-1");
      labelsFetch.mockClear();

      await client.removeLabel("issue-1", "urgent");

      expect(labelsFetch).not.toHaveBeenCalled();
      expect(updateIssue).toHaveBeenCalledWith("issue-1", { labelIds: ["label-2"] });
    });

    it("resolves the label id via the issue's labels when not cached, then removes it", async () => {
      const issue = makeFakeIssue({
        id: "issue-1",
        labelIds: ["label-1", "label-2"],
        labels: () => Promise.resolve({ nodes: [{ id: "label-1", name: "urgent" }] }),
      });
      const updateIssue = vi.fn().mockResolvedValue(undefined);
      injectSdk(client, { issue: () => Promise.resolve(issue), updateIssue });

      await client.removeLabel("issue-1", "urgent");

      expect(updateIssue).toHaveBeenCalledWith("issue-1", { labelIds: ["label-2"] });
    });

    it("does nothing when the named label is not found on the issue", async () => {
      const issue = makeFakeIssue({
        id: "issue-1",
        labelIds: ["label-1"],
        labels: () => Promise.resolve({ nodes: [{ id: "label-1", name: "other" }] }),
      });
      const updateIssue = vi.fn();
      injectSdk(client, { issue: () => Promise.resolve(issue), updateIssue });

      await client.removeLabel("issue-1", "urgent");

      expect(updateIssue).not.toHaveBeenCalled();
    });
  });

  describe("listLabels", () => {
    it("returns label names and populates the label cache", async () => {
      const issue = makeFakeIssue({
        id: "issue-1",
        labels: () =>
          Promise.resolve({
            nodes: [
              { id: "l1", name: "bug" },
              { id: "l2", name: "urgent" },
            ],
          }),
      });
      injectSdk(client, { issue: () => Promise.resolve(issue) });

      const names = await client.listLabels("issue-1");

      expect(names).toEqual(["bug", "urgent"]);
    });

    it("returns an empty array when the issue has no labels", async () => {
      const issue = makeFakeIssue({ id: "issue-1", labels: () => Promise.resolve(null) });
      injectSdk(client, { issue: () => Promise.resolve(issue) });

      const names = await client.listLabels("issue-1");

      expect(names).toEqual([]);
    });
  });
});
