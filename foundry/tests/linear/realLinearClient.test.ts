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

interface FakeLabel {
  id: string;
  name: string;
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
  labels: () => Promise<{ nodes: FakeLabel[] } | null>;
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
  return { client, logger };
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

function injectSdk(client: RealLinearClient, sdk: Partial<FakeSdk>): void {
  (client as unknown as { sdk: FakeSdk }).sdk = sdk as FakeSdk;
}

describe("RealLinearClient", () => {
  describe("getIssue", () => {
    it("maps a fully-populated issue", async () => {
      const { client } = makeClient();
      const issue = makeFakeIssue({
        id: "issue-1",
        labels: () => Promise.resolve({ nodes: [{ id: "l1", name: "bug" }] }),
        project: Promise.resolve({ name: "Project X" }),
        cycle: Promise.resolve({ name: "Cycle 4" }),
        team: Promise.resolve({ id: "team-1", key: "PRY" }),
      });
      injectSdk(client, { issue: vi.fn().mockResolvedValue(issue) });

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
        cycle: "Cycle 4",
      });
    });

    it("falls back to defaults when optional fields are null/missing", async () => {
      const { client } = makeClient();
      const issue = makeFakeIssue({
        id: "issue-2",
        description: null,
        state: Promise.resolve(null),
        project: Promise.resolve(null),
        cycle: Promise.resolve(null),
        team: Promise.resolve(null),
        labels: () => Promise.resolve(null),
      });
      injectSdk(client, { issue: vi.fn().mockResolvedValue(issue) });

      const result = await client.getIssue("issue-2");

      expect(result.description).toBe("");
      expect(result.state).toBe("Unknown");
      expect(result.project).toBeUndefined();
      expect(result.cycle).toBeUndefined();
      expect(result.team).toBeUndefined();
      expect(result.labels).toEqual([]);
    });
  });

  describe("searchIssues", () => {
    it("builds a filter from projectName, assigneeMe and team, and maps results", async () => {
      const { client, logger } = makeClient();
      const issue = makeFakeIssue({
        id: "issue-1",
        project: Promise.resolve({ name: "Proj" }),
        cycle: Promise.resolve({ name: "Cyc" }),
        team: Promise.resolve({ id: "team-1", key: "PRY" }),
        labels: () => Promise.resolve({ nodes: [{ id: "l1", name: "urgent" }] }),
      });
      const issuesFn = vi.fn().mockResolvedValue({ nodes: [issue] });
      injectSdk(client, { issues: issuesFn });

      const result = await client.searchIssues({
        state: "Todo",
        projectName: "Proj",
        assigneeMe: true,
        team: "PRY",
      });

      expect(issuesFn).toHaveBeenCalledWith({
        filter: {
          state: { name: { eq: "Todo" } },
          project: { name: { eq: "Proj" } },
          assignee: { isMe: { eq: true } },
          team: { or: [{ name: { eq: "PRY" } }, { key: { eq: "PRY" } }] },
        },
      });
      expect(result).toEqual([
        {
          id: "issue-1",
          identifier: "PRY-1",
          title: "Issue title",
          description: "Issue description",
          branchName: "ai/issue-1",
          state: "Todo",
          labels: ["urgent"],
          priority: 0,
          url: "https://linear.app/team/issue/PRY-1",
          project: "Proj",
          team: "PRY",
          cycle: "Cyc",
        },
      ]);
      expect(logger.info).toHaveBeenCalled();
    });

    it("omits optional filter keys and defaults missing fields when unset", async () => {
      const { client } = makeClient();
      const issue = makeFakeIssue({
        id: "issue-2",
        labels: () => Promise.resolve(null),
        project: Promise.resolve(null),
        cycle: Promise.resolve(null),
        team: Promise.resolve(null),
      });
      const issuesFn = vi.fn().mockResolvedValue({ nodes: [issue] });
      injectSdk(client, { issues: issuesFn });

      const result = await client.searchIssues({ state: "Todo" });

      expect(issuesFn).toHaveBeenCalledWith({ filter: { state: { name: { eq: "Todo" } } } });
      expect(result[0].labels).toEqual([]);
      expect(result[0].project).toBeUndefined();
      expect(result[0].team).toBeUndefined();
      expect(result[0].cycle).toBeUndefined();
    });

    it("returns an empty array when the connection has no nodes", async () => {
      const { client } = makeClient();
      injectSdk(client, { issues: vi.fn().mockResolvedValue({ nodes: undefined }) });

      const result = await client.searchIssues({ state: "Todo" });

      expect(result).toEqual([]);
    });

    it("defaults a null description to an empty string", async () => {
      const { client } = makeClient();
      const issue = makeFakeIssue({ id: "issue-3", description: null });
      injectSdk(client, { issues: vi.fn().mockResolvedValue({ nodes: [issue] }) });

      const result = await client.searchIssues({ state: "Todo" });

      expect(result[0].description).toBe("");
    });
  });

  describe("postComment", () => {
    it("creates a comment and logs", async () => {
      const { client, logger } = makeClient();
      const createComment = vi.fn().mockResolvedValue({});
      injectSdk(client, { createComment });

      await client.postComment("issue-1", "hello");

      expect(createComment).toHaveBeenCalledWith({ issueId: "issue-1", body: "hello" });
      expect(logger.debug).toHaveBeenCalled();
    });
  });

  describe("updateIssueState", () => {
    it("warns and returns without updating when the issue has no team", async () => {
      const { client, logger } = makeClient();
      const issue = makeFakeIssue({ id: "issue-1", team: Promise.resolve(null) });
      const updateIssue = vi.fn();
      injectSdk(client, { issue: vi.fn().mockResolvedValue(issue), updateIssue });

      await client.updateIssueState("issue-1", "Done");

      expect(updateIssue).not.toHaveBeenCalled();
      expect(logger.warn).toHaveBeenCalledWith({ issueId: "issue-1" }, "Cannot update state: issue has no team");
    });

    it("warns and returns when the workflow state name cannot be resolved", async () => {
      const { client, logger } = makeClient();
      const issue = makeFakeIssue({ id: "issue-1", team: Promise.resolve({ id: "team-1", key: "PRY" }) });
      const updateIssue = vi.fn();
      const team = vi.fn().mockResolvedValue({
        states: () => Promise.resolve({ nodes: [{ id: "s1", name: "Todo" }] }),
      });
      injectSdk(client, { issue: vi.fn().mockResolvedValue(issue), updateIssue, team });

      await client.updateIssueState("issue-1", "Nonexistent State");

      expect(updateIssue).not.toHaveBeenCalled();
      expect(logger.warn).toHaveBeenCalledWith(
        { issueId: "issue-1", stateName: "Nonexistent State", teamId: "team-1" },
        "Could not find workflow state by name",
      );
    });

    it("resolves the state id and updates the issue, caching the team's states", async () => {
      const { client, logger } = makeClient();
      const issue1 = makeFakeIssue({ id: "issue-1", team: Promise.resolve({ id: "team-1", key: "PRY" }) });
      const issue2 = makeFakeIssue({ id: "issue-2", team: Promise.resolve({ id: "team-1", key: "PRY" }) });
      const updateIssue = vi.fn().mockResolvedValue({});
      const team = vi.fn().mockResolvedValue({
        states: () =>
          Promise.resolve({ nodes: [{ id: "s-todo", name: "Todo" }, { id: "s-done", name: "Done" }] }),
      });
      const issueFn = vi.fn().mockResolvedValueOnce(issue1).mockResolvedValueOnce(issue2);
      injectSdk(client, { issue: issueFn, updateIssue, team });

      await client.updateIssueState("issue-1", "Done");
      await client.updateIssueState("issue-2", "Todo");

      expect(updateIssue).toHaveBeenNthCalledWith(1, "issue-1", { stateId: "s-done" });
      expect(updateIssue).toHaveBeenNthCalledWith(2, "issue-2", { stateId: "s-todo" });
      // Same teamId -> the state map is cached, so `team()` is only called once.
      expect(team).toHaveBeenCalledTimes(1);
      expect(logger.debug).toHaveBeenCalled();
    });

    it("treats a missing states connection (no nodes) as an empty workflow state list", async () => {
      const { client, logger } = makeClient();
      const issue = makeFakeIssue({ id: "issue-1", team: Promise.resolve({ id: "team-1", key: "PRY" }) });
      const updateIssue = vi.fn();
      const team = vi.fn().mockResolvedValue({ states: () => Promise.resolve({ nodes: undefined }) });
      injectSdk(client, { issue: vi.fn().mockResolvedValue(issue), updateIssue, team });

      await client.updateIssueState("issue-1", "Todo");

      expect(updateIssue).not.toHaveBeenCalled();
      expect(logger.warn).toHaveBeenCalledWith(
        { issueId: "issue-1", stateName: "Todo", teamId: "team-1" },
        "Could not find workflow state by name",
      );
    });
  });

  describe("addLabel", () => {
    it("creates a brand-new label and adds it to the issue", async () => {
      const { client, logger } = makeClient();
      const issue = makeFakeIssue({
        id: "issue-1",
        labelIds: ["existing-id"],
        team: Promise.resolve({ id: "team-1", key: "PRY" }),
      });
      const updateIssue = vi.fn().mockResolvedValue({});
      const issueLabels = vi.fn().mockResolvedValue({ nodes: [] });
      const createIssueLabel = vi.fn().mockResolvedValue({
        issueLabel: Promise.resolve({ id: "new-label-id", name: "urgent" }),
      });
      injectSdk(client, {
        issue: vi.fn().mockResolvedValue(issue),
        updateIssue,
        issueLabels,
        createIssueLabel,
      });

      await client.addLabel("issue-1", "urgent");

      expect(createIssueLabel).toHaveBeenCalledWith({ name: "urgent", teamId: "team-1" });
      expect(updateIssue).toHaveBeenCalledWith("issue-1", {
        labelIds: ["existing-id", "new-label-id"],
      });
      expect(logger.info).toHaveBeenCalledWith(
        { labelName: "urgent", labelId: "new-label-id" },
        "Created new Linear label",
      );
    });

    it("reuses an existing label found via issueLabels instead of creating one", async () => {
      const { client } = makeClient();
      const issue = makeFakeIssue({ id: "issue-1", labelIds: [] });
      const updateIssue = vi.fn().mockResolvedValue({});
      const issueLabels = vi.fn().mockResolvedValue({ nodes: [{ id: "existing-label", name: "bug" }] });
      const createIssueLabel = vi.fn();
      injectSdk(client, {
        issue: vi.fn().mockResolvedValue(issue),
        updateIssue,
        issueLabels,
        createIssueLabel,
      });

      await client.addLabel("issue-1", "bug");

      expect(createIssueLabel).not.toHaveBeenCalled();
      expect(updateIssue).toHaveBeenCalledWith("issue-1", { labelIds: ["existing-label"] });
    });

    it("does not call updateIssue when the issue already has the label", async () => {
      const { client } = makeClient();
      const issue = makeFakeIssue({ id: "issue-1", labelIds: ["existing-label"] });
      const updateIssue = vi.fn();
      const issueLabels = vi.fn().mockResolvedValue({ nodes: [{ id: "existing-label", name: "bug" }] });
      injectSdk(client, {
        issue: vi.fn().mockResolvedValue(issue),
        updateIssue,
        issueLabels,
        createIssueLabel: vi.fn(),
      });

      await client.addLabel("issue-1", "bug");

      expect(updateIssue).not.toHaveBeenCalled();
    });

    it("uses a cached label id on a second call without re-querying Linear", async () => {
      const { client } = makeClient();
      const issue1 = makeFakeIssue({ id: "issue-1", labelIds: [] });
      const issue2 = makeFakeIssue({ id: "issue-2", labelIds: [] });
      const updateIssue = vi.fn().mockResolvedValue({});
      const issueLabels = vi.fn().mockResolvedValue({ nodes: [{ id: "cached-id", name: "chore" }] });
      const issueFn = vi.fn().mockResolvedValueOnce(issue1).mockResolvedValueOnce(issue2);
      injectSdk(client, {
        issue: issueFn,
        updateIssue,
        issueLabels,
        createIssueLabel: vi.fn(),
      });

      await client.addLabel("issue-1", "chore");
      await client.addLabel("issue-2", "chore");

      expect(issueLabels).toHaveBeenCalledTimes(1);
      expect(updateIssue).toHaveBeenCalledTimes(2);
    });

    it("throws when label creation succeeds but returns no issueLabel", async () => {
      const { client } = makeClient();
      const issue = makeFakeIssue({ id: "issue-1", labelIds: [] });
      const issueLabels = vi.fn().mockResolvedValue({ nodes: [] });
      const createIssueLabel = vi.fn().mockResolvedValue({ issueLabel: Promise.resolve(null) });
      injectSdk(client, {
        issue: vi.fn().mockResolvedValue(issue),
        issueLabels,
        createIssueLabel,
        updateIssue: vi.fn(),
      });

      await expect(client.addLabel("issue-1", "ghost")).rejects.toThrow(
        "Failed to create label: ghost",
      );
    });

    it("creates the label without a teamId when the issue has no team", async () => {
      const { client } = makeClient();
      const issue = makeFakeIssue({ id: "issue-1", labelIds: [], team: Promise.resolve(null) });
      const createIssueLabel = vi.fn().mockResolvedValue({
        issueLabel: Promise.resolve({ id: "new-id", name: "no-team-label" }),
      });
      injectSdk(client, {
        issue: vi.fn().mockResolvedValue(issue),
        issueLabels: vi.fn().mockResolvedValue({ nodes: [] }),
        createIssueLabel,
        updateIssue: vi.fn().mockResolvedValue({}),
      });

      await client.addLabel("issue-1", "no-team-label");

      expect(createIssueLabel).toHaveBeenCalledWith({ name: "no-team-label" });
    });
  });

  describe("removeLabel", () => {
    it("removes a label by looking it up via issue.labels() when not cached", async () => {
      const { client, logger } = makeClient();
      const issue = makeFakeIssue({
        id: "issue-1",
        labelIds: ["l1", "l2"],
        labels: () => Promise.resolve({ nodes: [{ id: "l1", name: "bug" }, { id: "l2", name: "chore" }] }),
      });
      const updateIssue = vi.fn().mockResolvedValue({});
      injectSdk(client, { issue: vi.fn().mockResolvedValue(issue), updateIssue });

      await client.removeLabel("issue-1", "bug");

      expect(updateIssue).toHaveBeenCalledWith("issue-1", { labelIds: ["l2"] });
      expect(logger.debug).toHaveBeenCalled();
    });

    it("returns without updating when the named label is not found on the issue", async () => {
      const { client } = makeClient();
      const issue = makeFakeIssue({
        id: "issue-1",
        labelIds: ["l1"],
        labels: () => Promise.resolve({ nodes: [{ id: "l1", name: "bug" }] }),
      });
      const updateIssue = vi.fn();
      injectSdk(client, { issue: vi.fn().mockResolvedValue(issue), updateIssue });

      await client.removeLabel("issue-1", "not-there");

      expect(updateIssue).not.toHaveBeenCalled();
    });

    it("uses the cached label id on a subsequent call instead of calling issue.labels() again", async () => {
      const { client } = makeClient();
      const issue1 = makeFakeIssue({
        id: "issue-1",
        labelIds: ["l1"],
        labels: () => Promise.resolve({ nodes: [{ id: "l1", name: "bug" }] }),
      });
      const issue2 = makeFakeIssue({ id: "issue-2", labelIds: ["l1", "l3"] });
      const labelsFnSpy = vi.fn(() => Promise.resolve({ nodes: [{ id: "l1", name: "bug" }] }));
      issue1.labels = labelsFnSpy;
      const updateIssue = vi.fn().mockResolvedValue({});
      const issueFn = vi.fn().mockResolvedValueOnce(issue1).mockResolvedValueOnce(issue2);
      injectSdk(client, { issue: issueFn, updateIssue });

      await client.removeLabel("issue-1", "bug");
      await client.removeLabel("issue-2", "bug");

      expect(labelsFnSpy).toHaveBeenCalledTimes(1);
      expect(updateIssue).toHaveBeenNthCalledWith(2, "issue-2", { labelIds: ["l3"] });
    });
  });

  describe("listLabels", () => {
    it("returns label names and populates the label cache", async () => {
      const { client } = makeClient();
      const issue = makeFakeIssue({
        id: "issue-1",
        labels: () => Promise.resolve({ nodes: [{ id: "l1", name: "bug" }, { id: "l2", name: "chore" }] }),
      });
      injectSdk(client, { issue: vi.fn().mockResolvedValue(issue) });

      const result = await client.listLabels("issue-1");

      expect(result).toEqual(["bug", "chore"]);
    });

    it("returns an empty array when the issue has no labels connection", async () => {
      const { client } = makeClient();
      const issue = makeFakeIssue({ id: "issue-1", labels: () => Promise.resolve(null) });
      injectSdk(client, { issue: vi.fn().mockResolvedValue(issue) });

      await expect(client.listLabels("issue-1")).resolves.toEqual([]);
    });
  });
});
