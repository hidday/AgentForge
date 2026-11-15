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
  parent: Promise<FakeIssue | null>;
  state: Promise<{ id: string; name: string } | null>;
  project: Promise<{ name: string } | null>;
  cycle: Promise<{ name: string } | null>;
  team: Promise<{ id: string; key: string } | null>;
  labels: () => Promise<{ nodes: Array<{ id: string; name: string }> }>;
  inverseRelations: () => Promise<{ nodes: [] }>;
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
    parent: Promise.resolve(null),
    state: Promise.resolve({ id: "state-1", name: "Todo" }),
    project: Promise.resolve(null),
    cycle: Promise.resolve(null),
    team: Promise.resolve({ id: "team-1", key: "PRY" }),
    labels: () => Promise.resolve({ nodes: [] }),
    inverseRelations: () => Promise.resolve({ nodes: [] }),
    ...overrides,
  };
}

function makeLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
}

function installFakeSdk(client: RealLinearClient, sdk: Record<string, unknown>) {
  (client as unknown as { sdk: unknown }).sdk = sdk;
}

describe("RealLinearClient core methods", () => {
  let client: RealLinearClient;
  let logger: ReturnType<typeof makeLogger>;

  beforeEach(() => {
    logger = makeLogger();
    client = new RealLinearClient("test-key", logger as never);
  });

  describe("getIssue", () => {
    it("maps an SDK issue including project, cycle and team", async () => {
      const issue = makeFakeIssue({
        id: "issue-1",
        description: null,
        project: Promise.resolve({ name: "Core" }),
        cycle: Promise.resolve({ name: "Cycle 3" }),
        team: Promise.resolve({ id: "team-1", key: "PRY" }),
        state: Promise.resolve({ id: "s1", name: "In Progress" }),
        labels: () => Promise.resolve({ nodes: [{ id: "l1", name: "bug" }] }),
      });
      installFakeSdk(client, { issue: () => Promise.resolve(issue) });

      const result = await client.getIssue("issue-1");

      expect(result).toEqual({
        id: "issue-1",
        identifier: "PRY-1",
        title: "Issue title",
        description: "",
        branchName: "ai/issue-1",
        state: "In Progress",
        labels: ["bug"],
        priority: 0,
        url: "https://linear.app/team/issue/PRY-1",
        project: "Core",
        team: "PRY",
        cycle: "Cycle 3",
      });
    });

    it("falls back to Unknown state and undefined project/cycle/team when absent", async () => {
      const issue = makeFakeIssue({
        id: "issue-2",
        state: Promise.resolve(null),
        project: Promise.resolve(null),
        cycle: Promise.resolve(null),
        team: Promise.resolve(null),
      });
      installFakeSdk(client, { issue: () => Promise.resolve(issue) });

      const result = await client.getIssue("issue-2");

      expect(result.state).toBe("Unknown");
      expect(result.project).toBeUndefined();
      expect(result.cycle).toBeUndefined();
      expect(result.team).toBeUndefined();
    });
  });

  describe("searchIssues", () => {
    it("builds a filter from state only and maps each result issue", async () => {
      const resultIssue = makeFakeIssue({
        id: "r1",
        labels: () => Promise.resolve({ nodes: [{ id: "l1", name: "feature" }] }),
        project: Promise.resolve({ name: "Core" }),
        cycle: Promise.resolve({ name: "C1" }),
        team: Promise.resolve({ id: "t1", key: "PRY" }),
      });
      const issuesFn = vi.fn().mockResolvedValue({ nodes: [resultIssue] });
      installFakeSdk(client, { issues: issuesFn });

      const results = await client.searchIssues({ state: "Todo" });

      expect(issuesFn).toHaveBeenCalledWith({ filter: { state: { name: { eq: "Todo" } } } });
      expect(results).toEqual([
        {
          id: "r1",
          identifier: "PRY-1",
          title: "Issue title",
          description: "Issue description",
          branchName: "ai/issue-1",
          state: "Todo",
          labels: ["feature"],
          priority: 0,
          url: "https://linear.app/team/issue/PRY-1",
          project: "Core",
          team: "PRY",
          cycle: "C1",
        },
      ]);
      expect(logger.info).toHaveBeenCalledWith(
        { projectName: undefined, assigneeMe: undefined, team: undefined, stateName: "Todo", count: 1 },
        "Searched Linear issues",
      );
    });

    it("adds project, assignee and team clauses to the filter when provided", async () => {
      const issuesFn = vi.fn().mockResolvedValue({ nodes: [] });
      installFakeSdk(client, { issues: issuesFn });

      await client.searchIssues({
        state: "Todo",
        projectName: "Core",
        assigneeMe: true,
        team: "PRY",
      });

      expect(issuesFn).toHaveBeenCalledWith({
        filter: {
          state: { name: { eq: "Todo" } },
          project: { name: { eq: "Core" } },
          assignee: { isMe: { eq: true } },
          team: { or: [{ name: { eq: "PRY" } }, { key: { eq: "PRY" } }] },
        },
      });
    });

    it("returns an empty array when the SDK returns no nodes", async () => {
      installFakeSdk(client, { issues: vi.fn().mockResolvedValue({ nodes: undefined }) });
      const results = await client.searchIssues({ state: "Done" });
      expect(results).toEqual([]);
    });
  });

  it("postComment delegates to sdk.createComment", async () => {
    const createComment = vi.fn().mockResolvedValue(undefined);
    installFakeSdk(client, { createComment });

    await client.postComment("issue-1", "hello world");

    expect(createComment).toHaveBeenCalledWith({ issueId: "issue-1", body: "hello world" });
    expect(logger.debug).toHaveBeenCalledWith({ issueId: "issue-1" }, "Posted comment to Linear issue");
  });

  describe("updateIssueState", () => {
    it("warns and returns early when the issue has no team", async () => {
      const issue = makeFakeIssue({ id: "issue-1", team: Promise.resolve(null) });
      const updateIssue = vi.fn();
      installFakeSdk(client, { issue: () => Promise.resolve(issue), updateIssue });

      await client.updateIssueState("issue-1", "Done");

      expect(updateIssue).not.toHaveBeenCalled();
      expect(logger.warn).toHaveBeenCalledWith(
        { issueId: "issue-1" },
        "Cannot update state: issue has no team",
      );
    });

    it("warns and returns early when the state name cannot be resolved", async () => {
      const issue = makeFakeIssue({ id: "issue-1", team: Promise.resolve({ id: "team-1", key: "PRY" }) });
      const updateIssue = vi.fn();
      const team = vi.fn().mockResolvedValue({ states: () => Promise.resolve({ nodes: [] }) });
      installFakeSdk(client, { issue: () => Promise.resolve(issue), updateIssue, team });

      await client.updateIssueState("issue-1", "Nonexistent");

      expect(updateIssue).not.toHaveBeenCalled();
      expect(logger.warn).toHaveBeenCalledWith(
        { issueId: "issue-1", stateName: "Nonexistent", teamId: "team-1" },
        "Could not find workflow state by name",
      );
    });

    it("resolves the state id and calls updateIssue, caching the team's states", async () => {
      const issue = makeFakeIssue({ id: "issue-1", team: Promise.resolve({ id: "team-1", key: "PRY" }) });
      const updateIssue = vi.fn().mockResolvedValue(undefined);
      const statesFn = vi
        .fn()
        .mockResolvedValue({ nodes: [{ id: "state-done", name: "Done" }] });
      const team = vi.fn().mockResolvedValue({ states: statesFn });
      installFakeSdk(client, { issue: () => Promise.resolve(issue), updateIssue, team });

      await client.updateIssueState("issue-1", "Done");
      // second call for the same team should use the cached state map, not refetch
      await client.updateIssueState("issue-1", "Done");

      expect(updateIssue).toHaveBeenCalledWith("issue-1", { stateId: "state-done" });
      expect(updateIssue).toHaveBeenCalledTimes(2);
      expect(team).toHaveBeenCalledTimes(1);
    });
  });

  describe("addLabel", () => {
    it("creates a new label and attaches it when not already present", async () => {
      const issue = makeFakeIssue({
        id: "issue-1",
        labelIds: ["existing-id"],
        team: Promise.resolve({ id: "team-1", key: "PRY" }),
      });
      const updateIssue = vi.fn().mockResolvedValue(undefined);
      const issueLabels = vi.fn().mockResolvedValue({ nodes: [] });
      const createIssueLabel = vi.fn().mockResolvedValue({
        issueLabel: Promise.resolve({ id: "new-label-id" }),
      });
      installFakeSdk(client, {
        issue: () => Promise.resolve(issue),
        updateIssue,
        issueLabels,
        createIssueLabel,
      });

      await client.addLabel("issue-1", "urgent");

      expect(createIssueLabel).toHaveBeenCalledWith({ name: "urgent", teamId: "team-1" });
      expect(updateIssue).toHaveBeenCalledWith("issue-1", { labelIds: ["existing-id", "new-label-id"] });
    });

    it("reuses an existing label id and does not call updateIssue if already attached", async () => {
      const issue = makeFakeIssue({
        id: "issue-1",
        labelIds: ["label-x"],
        team: Promise.resolve({ id: "team-1", key: "PRY" }),
      });
      const updateIssue = vi.fn();
      const issueLabels = vi.fn().mockResolvedValue({ nodes: [{ id: "label-x", name: "urgent" }] });
      installFakeSdk(client, { issue: () => Promise.resolve(issue), updateIssue, issueLabels });

      await client.addLabel("issue-1", "urgent");

      expect(updateIssue).not.toHaveBeenCalled();
    });

    it("throws when label creation does not return an issueLabel", async () => {
      const issue = makeFakeIssue({ id: "issue-1", team: Promise.resolve(null) });
      const issueLabels = vi.fn().mockResolvedValue({ nodes: [] });
      const createIssueLabel = vi.fn().mockResolvedValue({ issueLabel: Promise.resolve(undefined) });
      installFakeSdk(client, {
        issue: () => Promise.resolve(issue),
        updateIssue: vi.fn(),
        issueLabels,
        createIssueLabel,
      });

      await expect(client.addLabel("issue-1", "broken")).rejects.toThrow(
        "Failed to create label: broken",
      );
    });
  });

  describe("removeLabel", () => {
    it("resolves the label id via issue.labels() when not cached, then removes it", async () => {
      const issue = makeFakeIssue({
        id: "issue-1",
        labelIds: ["label-x", "label-y"],
        labels: () => Promise.resolve({ nodes: [{ id: "label-x", name: "urgent" }] }),
      });
      const updateIssue = vi.fn().mockResolvedValue(undefined);
      installFakeSdk(client, { issue: () => Promise.resolve(issue), updateIssue });

      await client.removeLabel("issue-1", "urgent");

      expect(updateIssue).toHaveBeenCalledWith("issue-1", { labelIds: ["label-y"] });
    });

    it("is a no-op when the label name is not found on the issue", async () => {
      const issue = makeFakeIssue({
        id: "issue-1",
        labelIds: ["label-y"],
        labels: () => Promise.resolve({ nodes: [] }),
      });
      const updateIssue = vi.fn();
      installFakeSdk(client, { issue: () => Promise.resolve(issue), updateIssue });

      await client.removeLabel("issue-1", "missing-label");

      expect(updateIssue).not.toHaveBeenCalled();
    });

    it("uses the cached label id on a subsequent call instead of calling issue.labels() again", async () => {
      const labelsFn = vi.fn().mockResolvedValue({ nodes: [{ id: "label-x", name: "urgent" }] });
      const issue = makeFakeIssue({ id: "issue-1", labelIds: ["label-x"], labels: labelsFn });
      const updateIssue = vi.fn().mockResolvedValue(undefined);
      installFakeSdk(client, { issue: () => Promise.resolve(issue), updateIssue });

      await client.removeLabel("issue-1", "urgent");
      await client.removeLabel("issue-1", "urgent");

      expect(labelsFn).toHaveBeenCalledTimes(1);
      expect(updateIssue).toHaveBeenCalledTimes(2);
    });
  });

  describe("listLabels", () => {
    it("returns label names and populates the label cache for later removeLabel calls", async () => {
      const labelsFn = vi
        .fn()
        .mockResolvedValue({ nodes: [{ id: "label-x", name: "urgent" }, { id: "label-y", name: "bug" }] });
      const issue = makeFakeIssue({ id: "issue-1", labelIds: ["label-x", "label-y"], labels: labelsFn });
      const updateIssue = vi.fn().mockResolvedValue(undefined);
      installFakeSdk(client, { issue: () => Promise.resolve(issue), updateIssue });

      const names = await client.listLabels("issue-1");
      expect(names).toEqual(["urgent", "bug"]);

      // removeLabel should now use the cache populated by listLabels, not call labels() again
      await client.removeLabel("issue-1", "urgent");
      expect(labelsFn).toHaveBeenCalledTimes(1);
      expect(updateIssue).toHaveBeenCalledWith("issue-1", { labelIds: ["label-y"] });
    });

    it("returns an empty array when the issue has no labels", async () => {
      const issue = makeFakeIssue({ id: "issue-1", labels: () => Promise.resolve({ nodes: [] }) });
      installFakeSdk(client, { issue: () => Promise.resolve(issue) });

      expect(await client.listLabels("issue-1")).toEqual([]);
    });
  });
});
