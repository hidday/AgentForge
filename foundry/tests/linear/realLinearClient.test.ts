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
    project: Promise.resolve({ name: "Project A" }),
    cycle: Promise.resolve({ name: "Cycle 1" }),
    team: Promise.resolve({ id: "team-1", key: "PRY" }),
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

function installFakeSdk(client: RealLinearClient, sdk: Partial<FakeSdk>): FakeSdk {
  const fullSdk: FakeSdk = {
    issue: vi.fn(),
    issues: vi.fn(),
    createComment: vi.fn().mockResolvedValue(undefined),
    updateIssue: vi.fn().mockResolvedValue(undefined),
    team: vi.fn(),
    issueLabels: vi.fn(),
    createIssueLabel: vi.fn(),
    ...sdk,
  };
  (client as unknown as { sdk: FakeSdk }).sdk = fullSdk;
  return fullSdk;
}

describe("RealLinearClient", () => {
  let client: RealLinearClient;
  let logger: ReturnType<typeof makeLogger>;

  beforeEach(() => {
    logger = makeLogger();
    client = new RealLinearClient("test-key", logger as never);
  });

  describe("getIssue", () => {
    it("maps a full SDK issue into a LinearIssue", async () => {
      const fakeIssue = makeFakeIssue({
        id: "issue-1",
        labels: () => Promise.resolve({ nodes: [{ id: "l1", name: "bug" }] }),
      });
      installFakeSdk(client, { issue: vi.fn().mockResolvedValue(fakeIssue) });

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
        project: "Project A",
        team: "PRY",
        cycle: "Cycle 1",
      });
    });

    it("falls back to defaults when labels/state/project/cycle/team/description are missing", async () => {
      const fakeIssue = makeFakeIssue({
        id: "issue-2",
        description: null,
        state: Promise.resolve(null),
        project: Promise.resolve(null),
        cycle: Promise.resolve(null),
        team: Promise.resolve(null),
        labels: () => Promise.resolve(null),
      });
      installFakeSdk(client, { issue: vi.fn().mockResolvedValue(fakeIssue) });

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
    it("builds a minimal filter and maps results when only state is given", async () => {
      const issuesFn = vi.fn().mockResolvedValue({
        nodes: [
          makeFakeIssue({
            id: "i1",
            labels: () => Promise.resolve({ nodes: [{ id: "l1", name: "bug" }] }),
          }),
        ],
      });
      installFakeSdk(client, { issues: issuesFn });

      const results = await client.searchIssues({ state: "Todo" });

      expect(issuesFn).toHaveBeenCalledWith({ filter: { state: { name: { eq: "Todo" } } } });
      expect(results).toEqual([
        {
          id: "i1",
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
      expect(logger.info).toHaveBeenCalledWith(
        expect.objectContaining({ stateName: "Todo", count: 1 }),
        "Searched Linear issues",
      );
    });

    it("adds project, assignee and team clauses when provided", async () => {
      const issuesFn = vi.fn().mockResolvedValue({ nodes: [] });
      installFakeSdk(client, { issues: issuesFn });

      await client.searchIssues({
        state: "Todo",
        projectName: "Alpha",
        assigneeMe: true,
        team: "PRY",
      });

      expect(issuesFn).toHaveBeenCalledWith({
        filter: {
          state: { name: { eq: "Todo" } },
          project: { name: { eq: "Alpha" } },
          assignee: { isMe: { eq: true } },
          team: { or: [{ name: { eq: "PRY" } }, { key: { eq: "PRY" } }] },
        },
      });
    });

    it("returns an empty array when the connection has no nodes", async () => {
      installFakeSdk(client, { issues: vi.fn().mockResolvedValue({ nodes: undefined }) });

      const results = await client.searchIssues({ state: "Todo" });

      expect(results).toEqual([]);
    });

    it("returns an empty array when the connection itself is nullish", async () => {
      installFakeSdk(client, { issues: vi.fn().mockResolvedValue(undefined) });

      const results = await client.searchIssues({ state: "Todo" });

      expect(results).toEqual([]);
    });
  });

  describe("postComment", () => {
    it("posts a comment via the SDK and logs", async () => {
      const createComment = vi.fn().mockResolvedValue(undefined);
      installFakeSdk(client, { createComment });

      await client.postComment("issue-1", "hello");

      expect(createComment).toHaveBeenCalledWith({ issueId: "issue-1", body: "hello" });
      expect(logger.debug).toHaveBeenCalledWith({ issueId: "issue-1" }, "Posted comment to Linear issue");
    });
  });

  describe("updateIssueState", () => {
    it("warns and returns without updating when the issue has no team", async () => {
      const fakeIssue = makeFakeIssue({ id: "issue-1", team: Promise.resolve(null) });
      const updateIssue = vi.fn();
      installFakeSdk(client, { issue: vi.fn().mockResolvedValue(fakeIssue), updateIssue });

      await client.updateIssueState("issue-1", "Done");

      expect(updateIssue).not.toHaveBeenCalled();
      expect(logger.warn).toHaveBeenCalledWith(
        { issueId: "issue-1" },
        "Cannot update state: issue has no team",
      );
    });

    it("warns and returns without updating when the state name cannot be resolved", async () => {
      const fakeIssue = makeFakeIssue({ id: "issue-1" });
      const team = vi.fn().mockResolvedValue({ states: () => Promise.resolve({ nodes: [] }) });
      const updateIssue = vi.fn();
      installFakeSdk(client, { issue: vi.fn().mockResolvedValue(fakeIssue), team, updateIssue });

      await client.updateIssueState("issue-1", "Nonexistent");

      expect(updateIssue).not.toHaveBeenCalled();
      expect(logger.warn).toHaveBeenCalledWith(
        { issueId: "issue-1", stateName: "Nonexistent", teamId: "team-1" },
        "Could not find workflow state by name",
      );
    });

    it("resolves the state id and updates the issue", async () => {
      const fakeIssue = makeFakeIssue({ id: "issue-1" });
      const team = vi.fn().mockResolvedValue({
        states: () => Promise.resolve({ nodes: [{ id: "state-done", name: "Done" }] }),
      });
      const updateIssue = vi.fn().mockResolvedValue(undefined);
      installFakeSdk(client, { issue: vi.fn().mockResolvedValue(fakeIssue), team, updateIssue });

      await client.updateIssueState("issue-1", "Done");

      expect(updateIssue).toHaveBeenCalledWith("issue-1", { stateId: "state-done" });
    });

    it("caches the resolved state map per team across calls", async () => {
      const issueFn = vi
        .fn()
        .mockResolvedValueOnce(makeFakeIssue({ id: "issue-1" }))
        .mockResolvedValueOnce(makeFakeIssue({ id: "issue-1" }));
      const team = vi.fn().mockResolvedValue({
        states: () =>
          Promise.resolve({
            nodes: [
              { id: "state-todo", name: "Todo" },
              { id: "state-done", name: "Done" },
            ],
          }),
      });
      const updateIssue = vi.fn().mockResolvedValue(undefined);
      installFakeSdk(client, { issue: issueFn, team, updateIssue });

      await client.updateIssueState("issue-1", "Todo");
      await client.updateIssueState("issue-1", "Done");

      expect(team).toHaveBeenCalledTimes(1);
      expect(updateIssue).toHaveBeenNthCalledWith(1, "issue-1", { stateId: "state-todo" });
      expect(updateIssue).toHaveBeenNthCalledWith(2, "issue-1", { stateId: "state-done" });
    });
  });

  describe("addLabel", () => {
    it("adds a newly created label id when not already present", async () => {
      const fakeIssue = makeFakeIssue({ id: "issue-1", labelIds: ["existing-id"] });
      const issueLabels = vi.fn().mockResolvedValue({ nodes: [] });
      const createIssueLabel = vi.fn().mockResolvedValue({
        issueLabel: Promise.resolve({ id: "new-label-id" }),
      });
      const updateIssue = vi.fn().mockResolvedValue(undefined);
      installFakeSdk(client, {
        issue: vi.fn().mockResolvedValue(fakeIssue),
        issueLabels,
        createIssueLabel,
        updateIssue,
      });

      await client.addLabel("issue-1", "new-label");

      expect(updateIssue).toHaveBeenCalledWith("issue-1", {
        labelIds: ["existing-id", "new-label-id"],
      });
      expect(logger.info).toHaveBeenCalledWith(
        { labelName: "new-label", labelId: "new-label-id" },
        "Created new Linear label",
      );
    });

    it("reuses an existing label found via issueLabels without creating a new one", async () => {
      const fakeIssue = makeFakeIssue({ id: "issue-1", labelIds: [] });
      const issueLabels = vi.fn().mockResolvedValue({ nodes: [{ id: "existing-label-id" }] });
      const createIssueLabel = vi.fn();
      const updateIssue = vi.fn().mockResolvedValue(undefined);
      installFakeSdk(client, {
        issue: vi.fn().mockResolvedValue(fakeIssue),
        issueLabels,
        createIssueLabel,
        updateIssue,
      });

      await client.addLabel("issue-1", "existing-label");

      expect(createIssueLabel).not.toHaveBeenCalled();
      expect(updateIssue).toHaveBeenCalledWith("issue-1", { labelIds: ["existing-label-id"] });
    });

    it("does not call updateIssue when the label is already on the issue", async () => {
      // Prime the label cache via listLabels so resolveOrCreateLabel finds it
      // without hitting issueLabels/createIssueLabel.
      const labelledIssue = makeFakeIssue({
        id: "issue-1",
        labels: () => Promise.resolve({ nodes: [{ id: "l1", name: "dup-label" }] }),
      });
      const issueLabels = vi.fn();
      const createIssueLabel = vi.fn();
      const updateIssue = vi.fn();
      const issueFn = vi.fn().mockResolvedValue(labelledIssue);
      installFakeSdk(client, { issue: issueFn, issueLabels, createIssueLabel, updateIssue });

      await client.listLabels("issue-1");

      // The issue already has the (now-cached) label id in its labelIds.
      issueFn.mockResolvedValue(
        makeFakeIssue({
          id: "issue-1",
          labelIds: ["l1"],
          labels: () => Promise.resolve({ nodes: [{ id: "l1", name: "dup-label" }] }),
        }),
      );

      await client.addLabel("issue-1", "dup-label");

      expect(issueLabels).not.toHaveBeenCalled();
      expect(createIssueLabel).not.toHaveBeenCalled();
      expect(updateIssue).not.toHaveBeenCalled();
    });

    it("creates a label without a teamId when the issue has no team", async () => {
      const fakeIssue = makeFakeIssue({ id: "issue-1", team: Promise.resolve(null), labelIds: [] });
      const createIssueLabel = vi.fn().mockResolvedValue({
        issueLabel: Promise.resolve({ id: "label-id" }),
      });
      installFakeSdk(client, {
        issue: vi.fn().mockResolvedValue(fakeIssue),
        issueLabels: vi.fn().mockResolvedValue({ nodes: [] }),
        createIssueLabel,
        updateIssue: vi.fn().mockResolvedValue(undefined),
      });

      await client.addLabel("issue-1", "no-team-label");

      expect(createIssueLabel).toHaveBeenCalledWith({ name: "no-team-label" });
    });

    it("throws when label creation does not resolve an issueLabel", async () => {
      const fakeIssue = makeFakeIssue({ id: "issue-1", labelIds: [] });
      const createIssueLabel = vi.fn().mockResolvedValue({ issueLabel: Promise.resolve(undefined) });
      installFakeSdk(client, {
        issue: vi.fn().mockResolvedValue(fakeIssue),
        issueLabels: vi.fn().mockResolvedValue({ nodes: [] }),
        createIssueLabel,
      });

      await expect(client.addLabel("issue-1", "broken-label")).rejects.toThrow(
        "Failed to create label: broken-label",
      );
    });
  });

  describe("removeLabel", () => {
    it("removes a label by looking it up via issue.labels() when not cached", async () => {
      const fakeIssue = makeFakeIssue({
        id: "issue-1",
        labelIds: ["l1", "l2"],
        labels: () => Promise.resolve({ nodes: [{ id: "l1", name: "bug" }] }),
      });
      const updateIssue = vi.fn().mockResolvedValue(undefined);
      installFakeSdk(client, { issue: vi.fn().mockResolvedValue(fakeIssue), updateIssue });

      await client.removeLabel("issue-1", "bug");

      expect(updateIssue).toHaveBeenCalledWith("issue-1", { labelIds: ["l2"] });
    });

    it("does nothing when the label is not found on the issue", async () => {
      const fakeIssue = makeFakeIssue({
        id: "issue-1",
        labelIds: ["l1"],
        labels: () => Promise.resolve({ nodes: [{ id: "l1", name: "bug" }] }),
      });
      const updateIssue = vi.fn();
      installFakeSdk(client, { issue: vi.fn().mockResolvedValue(fakeIssue), updateIssue });

      await client.removeLabel("issue-1", "missing-label");

      expect(updateIssue).not.toHaveBeenCalled();
    });

    it("uses the cached label id on a second call without calling issue.labels() again", async () => {
      const labelsFn = vi.fn().mockResolvedValue({ nodes: [{ id: "l1", name: "bug" }] });
      const fakeIssue = makeFakeIssue({ id: "issue-1", labelIds: ["l1"], labels: labelsFn });
      const updateIssue = vi.fn().mockResolvedValue(undefined);
      installFakeSdk(client, { issue: vi.fn().mockResolvedValue(fakeIssue), updateIssue });

      await client.removeLabel("issue-1", "bug");
      await client.removeLabel("issue-1", "bug");

      expect(labelsFn).toHaveBeenCalledTimes(1);
      expect(updateIssue).toHaveBeenCalledTimes(2);
    });
  });

  describe("listLabels", () => {
    it("returns label names and populates the label cache", async () => {
      const fakeIssue = makeFakeIssue({
        id: "issue-1",
        labels: () =>
          Promise.resolve({
            nodes: [
              { id: "l1", name: "bug" },
              { id: "l2", name: "urgent" },
            ],
          }),
      });
      installFakeSdk(client, { issue: vi.fn().mockResolvedValue(fakeIssue) });

      const names = await client.listLabels("issue-1");

      expect(names).toEqual(["bug", "urgent"]);
    });

    it("returns an empty array when there are no label nodes", async () => {
      const fakeIssue = makeFakeIssue({ id: "issue-1", labels: () => Promise.resolve(null) });
      installFakeSdk(client, { issue: vi.fn().mockResolvedValue(fakeIssue) });

      const names = await client.listLabels("issue-1");

      expect(names).toEqual([]);
    });
  });
});
