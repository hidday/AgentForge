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
    state: Promise.resolve({ id: "state-1", name: "Todo" }),
    project: Promise.resolve({ name: "Alpha" }),
    cycle: Promise.resolve({ name: "Cycle 1" }),
    team: Promise.resolve({ id: "team-1", key: "PRY" }),
    labels: () => Promise.resolve({ nodes: [] }),
    ...overrides,
  };
}

type FakeSdk = {
  issue: ReturnType<typeof vi.fn>;
  issues: ReturnType<typeof vi.fn>;
  team: ReturnType<typeof vi.fn>;
  createComment: ReturnType<typeof vi.fn>;
  updateIssue: ReturnType<typeof vi.fn>;
  issueLabels: ReturnType<typeof vi.fn>;
  createIssueLabel: ReturnType<typeof vi.fn>;
};

function installFakeSdk(client: RealLinearClient, sdk: Partial<FakeSdk>): void {
  (client as unknown as { sdk: FakeSdk }).sdk = sdk as FakeSdk;
}

describe("RealLinearClient", () => {
  let client: RealLinearClient;
  let logger: ReturnType<typeof makeLogger>;

  beforeEach(() => {
    logger = makeLogger();
    client = new RealLinearClient("test-key", logger as never);
  });

  describe("getIssue", () => {
    it("maps a full SDK issue to a LinearIssue", async () => {
      const fake = makeFakeIssue({
        id: "issue-1",
        labels: () => Promise.resolve({ nodes: [{ id: "l1", name: "bug" }] }),
      });
      installFakeSdk(client, { issue: vi.fn().mockResolvedValue(fake) });

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
        project: "Alpha",
        team: "PRY",
        cycle: "Cycle 1",
      });
    });

    it("defaults missing optional fields", async () => {
      const fake = makeFakeIssue({
        id: "issue-1",
        description: null,
        state: Promise.resolve(null),
        project: Promise.resolve(null),
        cycle: Promise.resolve(null),
        team: Promise.resolve(null),
      });
      installFakeSdk(client, { issue: vi.fn().mockResolvedValue(fake) });

      const result = await client.getIssue("issue-1");

      expect(result.description).toBe("");
      expect(result.state).toBe("Unknown");
      expect(result.project).toBeUndefined();
      expect(result.team).toBeUndefined();
      expect(result.cycle).toBeUndefined();
    });

    it("propagates errors from the SDK", async () => {
      installFakeSdk(client, {
        issue: vi.fn().mockRejectedValue(new Error("not found")),
      });

      await expect(client.getIssue("missing")).rejects.toThrow("not found");
    });

    it("defaults labels to an empty array when the labels connection has no nodes", async () => {
      const fake = makeFakeIssue({
        id: "issue-1",
        labels: () => Promise.resolve({ nodes: undefined } as never),
      });
      installFakeSdk(client, { issue: vi.fn().mockResolvedValue(fake) });

      const result = await client.getIssue("issue-1");

      expect(result.labels).toEqual([]);
    });
  });

  describe("searchIssues", () => {
    it("builds a base filter from state only", async () => {
      const issuesMock = vi.fn().mockResolvedValue({ nodes: [] });
      installFakeSdk(client, { issues: issuesMock });

      await client.searchIssues({ state: "Todo" });

      expect(issuesMock).toHaveBeenCalledWith({
        filter: { state: { name: { eq: "Todo" } } },
      });
    });

    it("adds project, assignee and team clauses when provided", async () => {
      const issuesMock = vi.fn().mockResolvedValue({ nodes: [] });
      installFakeSdk(client, { issues: issuesMock });

      await client.searchIssues({
        state: "Todo",
        projectName: "Alpha",
        assigneeMe: true,
        team: "PRY",
      });

      expect(issuesMock).toHaveBeenCalledWith({
        filter: {
          state: { name: { eq: "Todo" } },
          project: { name: { eq: "Alpha" } },
          assignee: { isMe: { eq: true } },
          team: { or: [{ name: { eq: "PRY" } }, { key: { eq: "PRY" } }] },
        },
      });
    });

    it("maps each returned issue and forces state to the queried state name", async () => {
      const fake = makeFakeIssue({ id: "issue-1" });
      installFakeSdk(client, {
        issues: vi.fn().mockResolvedValue({ nodes: [fake] }),
      });

      const results = await client.searchIssues({ state: "Todo" });

      expect(results).toEqual([
        {
          id: "issue-1",
          identifier: "PRY-1",
          title: "Issue title",
          description: "Issue description",
          branchName: "ai/issue-1",
          state: "Todo",
          labels: [],
          priority: 0,
          url: "https://linear.app/team/issue/PRY-1",
          project: "Alpha",
          team: "PRY",
          cycle: "Cycle 1",
        },
      ]);
      expect(logger.info).toHaveBeenCalled();
    });

    it("returns an empty array when the SDK returns no nodes", async () => {
      installFakeSdk(client, { issues: vi.fn().mockResolvedValue({ nodes: undefined }) });

      const results = await client.searchIssues({ state: "Todo" });

      expect(results).toEqual([]);
    });

    it("defaults labels, description, project, team and cycle when absent", async () => {
      const fake = makeFakeIssue({
        id: "issue-1",
        description: null,
        project: Promise.resolve(null),
        cycle: Promise.resolve(null),
        team: Promise.resolve(null),
        labels: () => Promise.resolve({ nodes: undefined } as never),
      });
      installFakeSdk(client, { issues: vi.fn().mockResolvedValue({ nodes: [fake] }) });

      const [result] = await client.searchIssues({ state: "Todo" });

      expect(result.labels).toEqual([]);
      expect(result.description).toBe("");
      expect(result.project).toBeUndefined();
      expect(result.team).toBeUndefined();
      expect(result.cycle).toBeUndefined();
    });
  });

  describe("postComment", () => {
    it("creates a comment via the SDK and logs", async () => {
      const createComment = vi.fn().mockResolvedValue(undefined);
      installFakeSdk(client, { createComment });

      await client.postComment("issue-1", "hello");

      expect(createComment).toHaveBeenCalledWith({ issueId: "issue-1", body: "hello" });
      expect(logger.debug).toHaveBeenCalled();
    });

    it("propagates SDK errors", async () => {
      installFakeSdk(client, {
        createComment: vi.fn().mockRejectedValue(new Error("boom")),
      });

      await expect(client.postComment("issue-1", "hello")).rejects.toThrow("boom");
    });
  });

  describe("updateIssueState", () => {
    it("resolves the state id and updates the issue", async () => {
      const fake = makeFakeIssue({ id: "issue-1" });
      const team = vi.fn().mockResolvedValue({
        id: "team-1",
        states: () =>
          Promise.resolve({ nodes: [{ id: "state-done", name: "Done" }] }),
      });
      const updateIssue = vi.fn().mockResolvedValue(undefined);
      installFakeSdk(client, { issue: vi.fn().mockResolvedValue(fake), team, updateIssue });

      await client.updateIssueState("issue-1", "Done");

      expect(updateIssue).toHaveBeenCalledWith("issue-1", { stateId: "state-done" });
      expect(logger.debug).toHaveBeenCalled();
    });

    it("caches workflow states per team across calls", async () => {
      const fake = makeFakeIssue({ id: "issue-1" });
      const statesFn = vi
        .fn()
        .mockResolvedValue({ nodes: [{ id: "state-done", name: "Done" }] });
      const team = vi.fn().mockResolvedValue({ id: "team-1", states: statesFn });
      const updateIssue = vi.fn().mockResolvedValue(undefined);
      installFakeSdk(client, { issue: vi.fn().mockResolvedValue(fake), team, updateIssue });

      await client.updateIssueState("issue-1", "Done");
      await client.updateIssueState("issue-1", "Done");

      expect(team).toHaveBeenCalledTimes(1);
      expect(statesFn).toHaveBeenCalledTimes(1);
      expect(updateIssue).toHaveBeenCalledTimes(2);
    });

    it("warns and returns without updating when the issue has no team", async () => {
      const fake = makeFakeIssue({ id: "issue-1", team: Promise.resolve(null) });
      const updateIssue = vi.fn();
      installFakeSdk(client, { issue: vi.fn().mockResolvedValue(fake), updateIssue });

      await client.updateIssueState("issue-1", "Done");

      expect(updateIssue).not.toHaveBeenCalled();
      expect(logger.warn).toHaveBeenCalledWith(
        { issueId: "issue-1" },
        "Cannot update state: issue has no team",
      );
    });

    it("warns and returns without updating when the state name is not found", async () => {
      const fake = makeFakeIssue({ id: "issue-1" });
      const team = vi.fn().mockResolvedValue({
        id: "team-1",
        states: () => Promise.resolve({ nodes: [] }),
      });
      const updateIssue = vi.fn();
      installFakeSdk(client, { issue: vi.fn().mockResolvedValue(fake), team, updateIssue });

      await client.updateIssueState("issue-1", "Nonexistent");

      expect(updateIssue).not.toHaveBeenCalled();
      expect(logger.warn).toHaveBeenCalledWith(
        { issueId: "issue-1", stateName: "Nonexistent", teamId: "team-1" },
        "Could not find workflow state by name",
      );
    });
  });

  describe("addLabel", () => {
    it("adds a new label id when not already present", async () => {
      const fake = makeFakeIssue({ id: "issue-1", labelIds: ["existing-id"] });
      const updateIssue = vi.fn().mockResolvedValue(undefined);
      installFakeSdk(client, {
        issue: vi.fn().mockResolvedValue(fake),
        issueLabels: vi.fn().mockResolvedValue({ nodes: [{ id: "new-id", name: "bug" }] }),
        updateIssue,
      });

      await client.addLabel("issue-1", "bug");

      expect(updateIssue).toHaveBeenCalledWith("issue-1", {
        labelIds: ["existing-id", "new-id"],
      });
    });

    it("does not call updateIssue when the label id is already present", async () => {
      const fake = makeFakeIssue({ id: "issue-1", labelIds: ["label-id"] });
      const updateIssue = vi.fn();
      installFakeSdk(client, {
        issue: vi.fn().mockResolvedValue(fake),
        issueLabels: vi.fn().mockResolvedValue({ nodes: [{ id: "label-id", name: "bug" }] }),
        updateIssue,
      });

      await client.addLabel("issue-1", "bug");

      expect(updateIssue).not.toHaveBeenCalled();
    });

    it("creates a new label when none exists, then caches it", async () => {
      const fake = makeFakeIssue({ id: "issue-1", labelIds: [] });
      const createIssueLabel = vi.fn().mockResolvedValue({
        issueLabel: Promise.resolve({ id: "created-id", name: "new-label" }),
      });
      const updateIssue = vi.fn().mockResolvedValue(undefined);
      installFakeSdk(client, {
        issue: vi.fn().mockResolvedValue(fake),
        issueLabels: vi.fn().mockResolvedValue({ nodes: [] }),
        createIssueLabel,
        updateIssue,
      });

      await client.addLabel("issue-1", "new-label");

      expect(createIssueLabel).toHaveBeenCalledWith({
        name: "new-label",
        teamId: "team-1",
      });
      expect(updateIssue).toHaveBeenCalledWith("issue-1", { labelIds: ["created-id"] });
      expect(logger.info).toHaveBeenCalled();
    });

    it("omits teamId when the issue has no team", async () => {
      const fake = makeFakeIssue({ id: "issue-1", labelIds: [], team: Promise.resolve(null) });
      const createIssueLabel = vi.fn().mockResolvedValue({
        issueLabel: Promise.resolve({ id: "created-id", name: "new-label" }),
      });
      installFakeSdk(client, {
        issue: vi.fn().mockResolvedValue(fake),
        issueLabels: vi.fn().mockResolvedValue({ nodes: [] }),
        createIssueLabel,
        updateIssue: vi.fn().mockResolvedValue(undefined),
      });

      await client.addLabel("issue-1", "new-label");

      expect(createIssueLabel).toHaveBeenCalledWith({ name: "new-label" });
    });

    it("throws when label creation does not return a label", async () => {
      const fake = makeFakeIssue({ id: "issue-1", labelIds: [] });
      installFakeSdk(client, {
        issue: vi.fn().mockResolvedValue(fake),
        issueLabels: vi.fn().mockResolvedValue({ nodes: [] }),
        createIssueLabel: vi.fn().mockResolvedValue({ issueLabel: Promise.resolve(null) }),
      });

      await expect(client.addLabel("issue-1", "ghost-label")).rejects.toThrow(
        "Failed to create label: ghost-label",
      );
    });

    it("reuses a cached label id across calls without re-querying", async () => {
      const fake = makeFakeIssue({ id: "issue-1", labelIds: [] });
      const issueLabels = vi.fn().mockResolvedValue({ nodes: [{ id: "cached-id", name: "bug" }] });
      installFakeSdk(client, {
        issue: vi.fn().mockResolvedValue(fake),
        issueLabels,
        updateIssue: vi.fn().mockResolvedValue(undefined),
      });

      await client.addLabel("issue-1", "bug");
      await client.addLabel("issue-1", "bug");

      expect(issueLabels).toHaveBeenCalledTimes(1);
    });
  });

  describe("removeLabel", () => {
    it("removes a label found via the labels connection and caches its id", async () => {
      const fake = makeFakeIssue({
        id: "issue-1",
        labelIds: ["label-id", "other-id"],
        labels: () => Promise.resolve({ nodes: [{ id: "label-id", name: "bug" }] }),
      });
      const updateIssue = vi.fn().mockResolvedValue(undefined);
      installFakeSdk(client, { issue: vi.fn().mockResolvedValue(fake), updateIssue });

      await client.removeLabel("issue-1", "bug");

      expect(updateIssue).toHaveBeenCalledWith("issue-1", { labelIds: ["other-id"] });
    });

    it("is a no-op when the label cannot be found", async () => {
      const fake = makeFakeIssue({
        id: "issue-1",
        labels: () => Promise.resolve({ nodes: [] }),
      });
      const updateIssue = vi.fn();
      installFakeSdk(client, { issue: vi.fn().mockResolvedValue(fake), updateIssue });

      await client.removeLabel("issue-1", "missing-label");

      expect(updateIssue).not.toHaveBeenCalled();
    });

    it("uses the cached label id on a subsequent call instead of re-fetching labels", async () => {
      const fake = makeFakeIssue({
        id: "issue-1",
        labelIds: ["label-id"],
      });
      const labels = vi.fn().mockResolvedValue({ nodes: [{ id: "label-id", name: "bug" }] });
      const updateIssue = vi.fn().mockResolvedValue(undefined);
      installFakeSdk(client, {
        issue: vi.fn().mockResolvedValue({ ...fake, labels }),
        updateIssue,
      });

      // First call populates the cache via listLabels.
      await client.listLabels("issue-1");
      await client.removeLabel("issue-1", "bug");

      expect(labels).toHaveBeenCalledTimes(1);
      expect(updateIssue).toHaveBeenCalledWith("issue-1", { labelIds: [] });
    });
  });

  describe("getRelatedContext error handling", () => {
    it("logs a warning and drops a blocker whose relation.issue rejects", async () => {
      const failingRelation = {
        id: "rel-1",
        type: "blocks",
        get issue(): Promise<never> {
          return Promise.reject(new Error("hydrate failed"));
        },
      };
      const okBlocker = makeFakeIssue({ id: "blocker-ok" });
      const okRelation = { id: "rel-2", type: "blocks", issue: Promise.resolve(okBlocker) };
      const focus = {
        id: "focus-id",
        parent: Promise.resolve(null),
        inverseRelations: () =>
          Promise.resolve({ nodes: [failingRelation, okRelation] }),
      };
      installFakeSdk(client, {
        issue: vi.fn().mockResolvedValue(focus),
      });

      const ctx = await client.getRelatedContext("focus-id");

      expect(ctx.blockers).toHaveLength(1);
      expect(ctx.blockers[0].id).toBe("blocker-ok");
      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ relationId: "rel-1", focusIssueId: "focus-id" }),
        "Failed to hydrate blocker issue from relation",
      );
    });
  });

  describe("listLabels", () => {
    it("returns label names and populates the label cache", async () => {
      const fake = makeFakeIssue({
        id: "issue-1",
        labels: () =>
          Promise.resolve({
            nodes: [
              { id: "l1", name: "bug" },
              { id: "l2", name: "urgent" },
            ],
          }),
      });
      installFakeSdk(client, { issue: vi.fn().mockResolvedValue(fake) });

      const names = await client.listLabels("issue-1");

      expect(names).toEqual(["bug", "urgent"]);
    });

    it("returns an empty array when there are no label nodes", async () => {
      const fake = makeFakeIssue({ id: "issue-1", labels: () => Promise.resolve({ nodes: [] }) });
      installFakeSdk(client, { issue: vi.fn().mockResolvedValue(fake) });

      expect(await client.listLabels("issue-1")).toEqual([]);
    });
  });
});
