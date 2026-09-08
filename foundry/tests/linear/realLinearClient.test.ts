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
    project: Promise.resolve(null),
    cycle: Promise.resolve(null),
    team: Promise.resolve({ id: "team-1", key: "PRY" }),
    labels: () => Promise.resolve({ nodes: [] }),
    ...overrides,
  };
}

interface FakeSdk {
  issue: (id: string) => Promise<FakeIssue>;
  issues: (opts: unknown) => Promise<{ nodes: FakeIssue[] }>;
  createComment: (args: { issueId: string; body: string }) => Promise<void>;
  updateIssue: (id: string, patch: Record<string, unknown>) => Promise<void>;
  team: (id: string) => Promise<{ states: () => Promise<{ nodes: Array<{ id: string; name: string }> }> }>;
  issueLabels: (opts: unknown) => Promise<{ nodes: Array<{ id: string; name: string }> }>;
  createIssueLabel: (opts: unknown) => Promise<{ issueLabel: Promise<{ id: string } | undefined> }>;
}

function makeClient(): {
  client: RealLinearClient;
  sdk: FakeSdk;
  logger: ReturnType<typeof makeLogger>;
  issuesById: Map<string, FakeIssue>;
} {
  const logger = makeLogger();
  const client = new RealLinearClient("test-key", logger as never);
  const issuesById = new Map<string, FakeIssue>();

  const sdk: FakeSdk = {
    issue: vi.fn((id: string) => {
      const found = issuesById.get(id);
      if (!found) throw new Error(`Fake SDK: issue ${id} not seeded`);
      return Promise.resolve(found);
    }),
    issues: vi.fn(() => Promise.resolve({ nodes: [] })),
    createComment: vi.fn(() => Promise.resolve()),
    updateIssue: vi.fn(() => Promise.resolve()),
    team: vi.fn(() =>
      Promise.resolve({ states: () => Promise.resolve({ nodes: [] }) }),
    ),
    issueLabels: vi.fn(() => Promise.resolve({ nodes: [] })),
    createIssueLabel: vi.fn(() => Promise.resolve({ issueLabel: Promise.resolve(undefined) })),
  };

  (client as unknown as { sdk: FakeSdk }).sdk = sdk;
  return { client, sdk, logger, issuesById };
}

describe("RealLinearClient", () => {
  let client: RealLinearClient;
  let sdk: FakeSdk;
  let logger: ReturnType<typeof makeLogger>;
  let issuesById: Map<string, FakeIssue>;

  beforeEach(() => {
    const built = makeClient();
    client = built.client;
    sdk = built.sdk;
    logger = built.logger;
    issuesById = built.issuesById;
  });

  describe("getIssue", () => {
    it("maps all fields including labels, state, project, cycle, and team", async () => {
      const issue = makeFakeIssue({
        id: "issue-1",
        labels: () => Promise.resolve({ nodes: [{ id: "l1", name: "bug" }] }),
        state: Promise.resolve({ id: "s1", name: "In Progress" }),
        project: Promise.resolve({ name: "Project X" }),
        cycle: Promise.resolve({ name: "Cycle 4" }),
        team: Promise.resolve({ id: "team-1", key: "PRY" }),
      });
      issuesById.set("issue-1", issue);

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
        cycle: "Cycle 4",
      });
    });

    it("defaults null description, missing labels/state/project/cycle/team", async () => {
      const issue = makeFakeIssue({
        id: "issue-2",
        description: null,
        labels: () => Promise.resolve({ nodes: [] }),
        state: Promise.resolve(null),
        project: Promise.resolve(null),
        cycle: Promise.resolve(null),
        team: Promise.resolve(null),
      });
      issuesById.set("issue-2", issue);

      const result = await client.getIssue("issue-2");

      expect(result.description).toBe("");
      expect(result.state).toBe("Unknown");
      expect(result.project).toBeUndefined();
      expect(result.team).toBeUndefined();
      expect(result.cycle).toBeUndefined();
      expect(result.labels).toEqual([]);
    });

    it("treats a missing labelsConn (null-ish) as an empty label list", async () => {
      const issue = makeFakeIssue({
        id: "issue-3",
        labels: () => Promise.resolve({ nodes: undefined as never }),
      });
      issuesById.set("issue-3", issue);

      const result = await client.getIssue("issue-3");
      expect(result.labels).toEqual([]);
    });
  });

  describe("searchIssues", () => {
    it("builds a base filter from state only and maps results", async () => {
      const node = makeFakeIssue({
        id: "issue-1",
        labels: () => Promise.resolve({ nodes: [{ id: "l1", name: "bug" }] }),
        project: Promise.resolve({ name: "Proj" }),
        cycle: Promise.resolve({ name: "Cycle 1" }),
        team: Promise.resolve({ id: "t1", key: "ENG" }),
      });
      sdk.issues = vi.fn().mockResolvedValue({ nodes: [node] });

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
          project: "Proj",
          team: "ENG",
          cycle: "Cycle 1",
        },
      ]);
      expect(logger.info).toHaveBeenCalled();
    });

    it("adds project, assigneeMe, and team clauses to the graphql filter when provided", async () => {
      sdk.issues = vi.fn().mockResolvedValue({ nodes: [] });

      await client.searchIssues({
        state: "Todo",
        projectName: "Proj",
        assigneeMe: true,
        team: "ENG",
      });

      expect(sdk.issues).toHaveBeenCalledWith({
        filter: {
          state: { name: { eq: "Todo" } },
          project: { name: { eq: "Proj" } },
          assignee: { isMe: { eq: true } },
          team: { or: [{ name: { eq: "ENG" } }, { key: { eq: "ENG" } }] },
        },
      });
    });

    it("returns an empty array when the connection has no nodes", async () => {
      sdk.issues = vi.fn().mockResolvedValue({ nodes: undefined });

      const results = await client.searchIssues({ state: "Todo" });
      expect(results).toEqual([]);
    });

    it("defaults null description and missing project/team/cycle in results", async () => {
      const node = makeFakeIssue({
        id: "issue-2",
        description: null,
        project: Promise.resolve(null),
        cycle: Promise.resolve(null),
        team: Promise.resolve(null),
      });
      sdk.issues = vi.fn().mockResolvedValue({ nodes: [node] });

      const [result] = await client.searchIssues({ state: "Todo" });
      expect(result.description).toBe("");
      expect(result.project).toBeUndefined();
      expect(result.team).toBeUndefined();
      expect(result.cycle).toBeUndefined();
    });
  });

  describe("getRelatedContext blocker hydration failure", () => {
    it("skips a blocker relation whose issue lookup rejects, logging a warning", async () => {
      const okBlocker = makeFakeIssue({ id: "ok-blocker" });
      const focus = {
        ...makeFakeIssue({ id: "focus-id" }),
        parent: Promise.resolve(null),
        inverseRelations: () =>
          Promise.resolve({
            nodes: [
              { id: "rel-bad", type: "blocks", issue: Promise.reject(new Error("hydrate failed")) },
              { id: "rel-ok", type: "blocks", issue: Promise.resolve(okBlocker) },
            ],
          }),
      };
      issuesById.set("focus-id", focus as unknown as FakeIssue);
      issuesById.set("ok-blocker", okBlocker);

      const ctx = await client.getRelatedContext("focus-id");

      expect(ctx.blockers).toHaveLength(1);
      expect(ctx.blockers[0].id).toBe("ok-blocker");
      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ relationId: "rel-bad", focusIssueId: "focus-id" }),
        "Failed to hydrate blocker issue from relation",
      );
    });
  });

  describe("postComment", () => {
    it("delegates to sdk.createComment", async () => {
      await client.postComment("issue-1", "hello");
      expect(sdk.createComment).toHaveBeenCalledWith({ issueId: "issue-1", body: "hello" });
    });
  });

  describe("updateIssueState", () => {
    it("warns and returns when the issue has no team", async () => {
      issuesById.set("issue-1", makeFakeIssue({ id: "issue-1", team: Promise.resolve(null) }));

      await client.updateIssueState("issue-1", "Done");

      expect(logger.warn).toHaveBeenCalled();
      expect(sdk.updateIssue).not.toHaveBeenCalled();
    });

    it("warns and returns when the state name cannot be resolved", async () => {
      issuesById.set("issue-1", makeFakeIssue({ id: "issue-1" }));
      sdk.team = vi.fn().mockResolvedValue({
        states: () => Promise.resolve({ nodes: [{ id: "s1", name: "Todo" }] }),
      });

      await client.updateIssueState("issue-1", "Nonexistent State");

      expect(logger.warn).toHaveBeenCalled();
      expect(sdk.updateIssue).not.toHaveBeenCalled();
    });

    it("resolves the state id and updates the issue", async () => {
      issuesById.set("issue-1", makeFakeIssue({ id: "issue-1" }));
      sdk.team = vi.fn().mockResolvedValue({
        states: () => Promise.resolve({ nodes: [{ id: "s-done", name: "Done" }] }),
      });

      await client.updateIssueState("issue-1", "Done");

      expect(sdk.updateIssue).toHaveBeenCalledWith("issue-1", { stateId: "s-done" });
    });

    it("caches the resolved state map per team across calls", async () => {
      issuesById.set("issue-1", makeFakeIssue({ id: "issue-1" }));
      issuesById.set(
        "issue-2",
        makeFakeIssue({ id: "issue-2", team: Promise.resolve({ id: "team-1", key: "PRY" }) }),
      );
      sdk.team = vi.fn().mockResolvedValue({
        states: () => Promise.resolve({ nodes: [{ id: "s-done", name: "Done" }] }),
      });

      await client.updateIssueState("issue-1", "Done");
      await client.updateIssueState("issue-2", "Done");

      expect(sdk.team).toHaveBeenCalledTimes(1);
    });
  });

  describe("addLabel", () => {
    it("creates the label via resolveOrCreateLabel and adds it to labelIds", async () => {
      issuesById.set(
        "issue-1",
        makeFakeIssue({ id: "issue-1", labelIds: ["existing-id"] }),
      );
      sdk.issueLabels = vi.fn().mockResolvedValue({ nodes: [] });
      sdk.createIssueLabel = vi
        .fn()
        .mockResolvedValue({ issueLabel: Promise.resolve({ id: "new-label-id" }) });

      await client.addLabel("issue-1", "new-label");

      expect(sdk.updateIssue).toHaveBeenCalledWith("issue-1", {
        labelIds: ["existing-id", "new-label-id"],
      });
    });

    it("reuses an existing label found via issueLabels search", async () => {
      issuesById.set("issue-1", makeFakeIssue({ id: "issue-1", labelIds: [] }));
      sdk.issueLabels = vi.fn().mockResolvedValue({ nodes: [{ id: "found-id", name: "bug" }] });

      await client.addLabel("issue-1", "bug");

      expect(sdk.createIssueLabel).not.toHaveBeenCalled();
      expect(sdk.updateIssue).toHaveBeenCalledWith("issue-1", { labelIds: ["found-id"] });
    });

    it("does not call updateIssue again when the label id is already present", async () => {
      issuesById.set("issue-1", makeFakeIssue({ id: "issue-1", labelIds: ["dup-id"] }));
      sdk.issueLabels = vi.fn().mockResolvedValue({ nodes: [{ id: "dup-id", name: "dup" }] });

      await client.addLabel("issue-1", "dup");

      expect(sdk.updateIssue).not.toHaveBeenCalled();
    });

    it("uses the cached label id on a second call without re-querying", async () => {
      issuesById.set("issue-1", makeFakeIssue({ id: "issue-1", labelIds: [] }));
      sdk.issueLabels = vi.fn().mockResolvedValue({ nodes: [{ id: "cached-id", name: "bug" }] });

      await client.addLabel("issue-1", "bug");
      await client.addLabel("issue-1", "bug");

      expect(sdk.issueLabels).toHaveBeenCalledTimes(1);
    });

    it("throws when label creation returns no issueLabel", async () => {
      issuesById.set("issue-1", makeFakeIssue({ id: "issue-1", labelIds: [] }));
      sdk.issueLabels = vi.fn().mockResolvedValue({ nodes: [] });
      sdk.createIssueLabel = vi.fn().mockResolvedValue({ issueLabel: Promise.resolve(undefined) });

      await expect(client.addLabel("issue-1", "broken")).rejects.toThrow(
        "Failed to create label: broken",
      );
    });

    it("passes the team id through to createIssueLabel when the issue has a team", async () => {
      issuesById.set(
        "issue-1",
        makeFakeIssue({
          id: "issue-1",
          labelIds: [],
          team: Promise.resolve({ id: "team-9", key: "T9" }),
        }),
      );
      sdk.issueLabels = vi.fn().mockResolvedValue({ nodes: [] });
      sdk.createIssueLabel = vi
        .fn()
        .mockResolvedValue({ issueLabel: Promise.resolve({ id: "nid" }) });

      await client.addLabel("issue-1", "team-scoped");

      expect(sdk.createIssueLabel).toHaveBeenCalledWith({
        name: "team-scoped",
        teamId: "team-9",
      });
    });

    it("omits teamId from createIssueLabel when the issue has no team", async () => {
      issuesById.set(
        "issue-1",
        makeFakeIssue({ id: "issue-1", labelIds: [], team: Promise.resolve(null) }),
      );
      sdk.issueLabels = vi.fn().mockResolvedValue({ nodes: [] });
      sdk.createIssueLabel = vi
        .fn()
        .mockResolvedValue({ issueLabel: Promise.resolve({ id: "nid" }) });

      await client.addLabel("issue-1", "no-team");

      expect(sdk.createIssueLabel).toHaveBeenCalledWith({ name: "no-team" });
    });
  });

  describe("removeLabel", () => {
    it("resolves the label id via issue.labels() when not cached, then updates", async () => {
      issuesById.set(
        "issue-1",
        makeFakeIssue({
          id: "issue-1",
          labelIds: ["l1", "l2"],
          labels: () => Promise.resolve({ nodes: [{ id: "l1", name: "bug" }] }),
        }),
      );

      await client.removeLabel("issue-1", "bug");

      expect(sdk.updateIssue).toHaveBeenCalledWith("issue-1", { labelIds: ["l2"] });
    });

    it("is a no-op when the label name cannot be found on the issue", async () => {
      issuesById.set(
        "issue-1",
        makeFakeIssue({
          id: "issue-1",
          labelIds: ["l1"],
          labels: () => Promise.resolve({ nodes: [] }),
        }),
      );

      await client.removeLabel("issue-1", "missing-label");

      expect(sdk.updateIssue).not.toHaveBeenCalled();
    });

    it("uses the cached label id on a subsequent call without calling issue.labels() again", async () => {
      const labelsFn = vi.fn().mockResolvedValue({ nodes: [{ id: "l1", name: "bug" }] });
      issuesById.set(
        "issue-1",
        makeFakeIssue({ id: "issue-1", labelIds: ["l1", "l2"], labels: labelsFn }),
      );

      await client.removeLabel("issue-1", "bug");
      await client.removeLabel("issue-1", "bug");

      expect(labelsFn).toHaveBeenCalledTimes(1);
      expect(sdk.updateIssue).toHaveBeenCalledTimes(2);
    });
  });

  describe("listLabels", () => {
    it("returns label names and populates the label cache for later addLabel/removeLabel calls", async () => {
      issuesById.set(
        "issue-1",
        makeFakeIssue({
          id: "issue-1",
          labelIds: ["l1"],
          labels: () => Promise.resolve({ nodes: [{ id: "l1", name: "bug" }] }),
        }),
      );

      const names = await client.listLabels("issue-1");
      expect(names).toEqual(["bug"]);

      // removeLabel should now use the cache rather than calling issue.labels() again.
      const labelsSpy = vi.fn().mockResolvedValue({ nodes: [{ id: "l1", name: "bug" }] });
      issuesById.set("issue-1", {
        ...issuesById.get("issue-1")!,
        labels: labelsSpy,
      });
      await client.removeLabel("issue-1", "bug");
      expect(labelsSpy).not.toHaveBeenCalled();
    });

    it("returns an empty array when the connection has no nodes", async () => {
      issuesById.set(
        "issue-1",
        makeFakeIssue({ id: "issue-1", labels: () => Promise.resolve({ nodes: undefined as never }) }),
      );

      await expect(client.listLabels("issue-1")).resolves.toEqual([]);
    });
  });
});
