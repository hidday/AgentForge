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
  project: Promise<{ name: string } | null>;
  cycle: Promise<{ name: string } | null>;
  team: Promise<{ id: string; key: string } | null>;
  labels: () => Promise<{ nodes: Array<{ id: string; name: string }> }>;
  parent?: Promise<FakeIssue | null>;
  inverseRelations?: () => Promise<{
    nodes: Array<{ id: string; type: string; issue: Promise<FakeIssue> }>;
  }>;
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

function makeLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
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
  const sdk: FakeSdk = {
    issue: vi.fn(),
    issues: vi.fn(),
    createComment: vi.fn(),
    updateIssue: vi.fn(),
    team: vi.fn(),
    issueLabels: vi.fn(),
    createIssueLabel: vi.fn(),
  };
  (client as unknown as { sdk: FakeSdk }).sdk = sdk;
  return sdk;
}

describe("RealLinearClient", () => {
  let client: RealLinearClient;
  let sdk: FakeSdk;
  let logger: ReturnType<typeof makeLogger>;

  beforeEach(() => {
    logger = makeLogger();
    client = new RealLinearClient("test-key", logger as never);
    sdk = installFakeSdk(client);
  });

  describe("getIssue", () => {
    it("maps all fields, including optional project/team/cycle, into a LinearIssue", async () => {
      const fake = makeFakeIssue({
        id: "issue-1",
        identifier: "PRY-1",
        labels: () => Promise.resolve({ nodes: [{ id: "l1", name: "bug" }] }),
        project: Promise.resolve({ name: "Backend" }),
        cycle: Promise.resolve({ name: "Sprint 1" }),
        team: Promise.resolve({ id: "team-1", key: "PRY" }),
        state: Promise.resolve({ id: "s1", name: "Todo" }),
      });
      sdk.issue.mockResolvedValue(fake);

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
        project: "Backend",
        team: "PRY",
        cycle: "Sprint 1",
      });
    });

    it("defaults description to empty string, state to Unknown, and optional fields to undefined when missing", async () => {
      const fake = makeFakeIssue({
        id: "issue-2",
        description: null,
        state: Promise.resolve(null),
        project: Promise.resolve(null),
        cycle: Promise.resolve(null),
        team: Promise.resolve(null),
      });
      sdk.issue.mockResolvedValue(fake);

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
    it("builds a GraphQL filter from projectName, assigneeMe, and team and maps results", async () => {
      const issue1 = makeFakeIssue({
        id: "i1",
        labels: () => Promise.resolve({ nodes: [{ id: "l1", name: "bug" }] }),
        project: Promise.resolve({ name: "Backend" }),
        cycle: Promise.resolve({ name: "Sprint 1" }),
        team: Promise.resolve({ id: "team-1", key: "PRY" }),
      });
      sdk.issues.mockResolvedValue({ nodes: [issue1] });

      const results = await client.searchIssues({
        state: "Todo",
        projectName: "Backend",
        assigneeMe: true,
        team: "PRY",
      });

      expect(sdk.issues).toHaveBeenCalledWith({
        filter: {
          state: { name: { eq: "Todo" } },
          project: { name: { eq: "Backend" } },
          assignee: { isMe: { eq: true } },
          team: { or: [{ name: { eq: "PRY" } }, { key: { eq: "PRY" } }] },
        },
      });
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
          project: "Backend",
          team: "PRY",
          cycle: "Sprint 1",
        },
      ]);
      expect(logger.info).toHaveBeenCalled();
    });

    it("omits optional filter keys when not provided and returns an empty array for no matches", async () => {
      sdk.issues.mockResolvedValue({ nodes: [] });

      const results = await client.searchIssues({ state: "Done" });

      expect(sdk.issues).toHaveBeenCalledWith({
        filter: { state: { name: { eq: "Done" } } },
      });
      expect(results).toEqual([]);
    });

    it("tolerates a connection with no nodes field", async () => {
      sdk.issues.mockResolvedValue({});

      const results = await client.searchIssues({ state: "Done" });

      expect(results).toEqual([]);
    });
  });

  describe("postComment", () => {
    it("delegates to sdk.createComment and logs debug", async () => {
      sdk.createComment.mockResolvedValue({});

      await client.postComment("issue-1", "hello");

      expect(sdk.createComment).toHaveBeenCalledWith({ issueId: "issue-1", body: "hello" });
      expect(logger.debug).toHaveBeenCalled();
    });
  });

  describe("updateIssueState", () => {
    it("warns and does not call updateIssue when the issue has no team", async () => {
      const fake = makeFakeIssue({ id: "issue-1", team: Promise.resolve(null) });
      sdk.issue.mockResolvedValue(fake);

      await client.updateIssueState("issue-1", "Done");

      expect(logger.warn).toHaveBeenCalled();
      expect(sdk.updateIssue).not.toHaveBeenCalled();
    });

    it("warns and does not call updateIssue when the state name cannot be resolved", async () => {
      const fake = makeFakeIssue({ id: "issue-1", team: Promise.resolve({ id: "team-1", key: "PRY" }) });
      sdk.issue.mockResolvedValue(fake);
      sdk.team.mockResolvedValue({ states: () => Promise.resolve({ nodes: [] }) });

      await client.updateIssueState("issue-1", "Nonexistent");

      expect(logger.warn).toHaveBeenCalled();
      expect(sdk.updateIssue).not.toHaveBeenCalled();
    });

    it("resolves the state id and updates the issue, caching the team's states", async () => {
      const fake = makeFakeIssue({ id: "issue-1", team: Promise.resolve({ id: "team-1", key: "PRY" }) });
      sdk.issue.mockResolvedValue(fake);
      const statesFn = vi.fn().mockResolvedValue({
        nodes: [
          { id: "state-todo", name: "Todo" },
          { id: "state-done", name: "Done" },
        ],
      });
      sdk.team.mockResolvedValue({ states: statesFn });

      await client.updateIssueState("issue-1", "Done");
      await client.updateIssueState("issue-1", "Todo");

      expect(sdk.updateIssue).toHaveBeenNthCalledWith(1, "issue-1", { stateId: "state-done" });
      expect(sdk.updateIssue).toHaveBeenNthCalledWith(2, "issue-1", { stateId: "state-todo" });
      // The team's states should only be fetched once; the second call reuses the cache.
      expect(sdk.team).toHaveBeenCalledTimes(1);
      expect(statesFn).toHaveBeenCalledTimes(1);
    });
  });

  describe("addLabel", () => {
    it("creates a new label when none exists and appends it to the issue", async () => {
      const fake = makeFakeIssue({
        id: "issue-1",
        labelIds: ["existing-id"],
        team: Promise.resolve({ id: "team-1", key: "PRY" }),
      });
      sdk.issue.mockResolvedValue(fake);
      sdk.issueLabels.mockResolvedValue({ nodes: [] });
      sdk.createIssueLabel.mockResolvedValue({
        issueLabel: Promise.resolve({ id: "new-label-id", name: "urgent" }),
      });

      await client.addLabel("issue-1", "urgent");

      expect(sdk.createIssueLabel).toHaveBeenCalledWith({ name: "urgent", teamId: "team-1" });
      expect(sdk.updateIssue).toHaveBeenCalledWith("issue-1", {
        labelIds: ["existing-id", "new-label-id"],
      });
      expect(logger.debug).toHaveBeenCalled();
    });

    it("reuses an existing label found via issueLabels instead of creating a new one", async () => {
      const fake = makeFakeIssue({ id: "issue-1", labelIds: [] });
      sdk.issue.mockResolvedValue(fake);
      sdk.issueLabels.mockResolvedValue({ nodes: [{ id: "label-id", name: "bug" }] });

      await client.addLabel("issue-1", "bug");

      expect(sdk.createIssueLabel).not.toHaveBeenCalled();
      expect(sdk.updateIssue).toHaveBeenCalledWith("issue-1", { labelIds: ["label-id"] });
    });

    it("does not call updateIssue when the label id is already present", async () => {
      const fake = makeFakeIssue({ id: "issue-1", labelIds: ["label-id"] });
      sdk.issue.mockResolvedValue(fake);
      sdk.issueLabels.mockResolvedValue({ nodes: [{ id: "label-id", name: "bug" }] });

      await client.addLabel("issue-1", "bug");

      expect(sdk.updateIssue).not.toHaveBeenCalled();
    });

    it("uses the cached label id on a second call instead of querying issueLabels again", async () => {
      const fake = makeFakeIssue({ id: "issue-1", labelIds: [] });
      sdk.issue.mockResolvedValue(fake);
      sdk.issueLabels.mockResolvedValue({ nodes: [{ id: "label-id", name: "bug" }] });

      await client.addLabel("issue-1", "bug");
      sdk.issue.mockResolvedValue(makeFakeIssue({ id: "issue-1", labelIds: [] }));
      await client.addLabel("issue-1", "bug");

      expect(sdk.issueLabels).toHaveBeenCalledTimes(1);
    });

    it("throws when createIssueLabel does not resolve an issueLabel", async () => {
      const fake = makeFakeIssue({ id: "issue-1", labelIds: [], team: Promise.resolve(null) });
      sdk.issue.mockResolvedValue(fake);
      sdk.issueLabels.mockResolvedValue({ nodes: [] });
      sdk.createIssueLabel.mockResolvedValue({ issueLabel: Promise.resolve(undefined) });

      await expect(client.addLabel("issue-1", "urgent")).rejects.toThrow(
        /Failed to create label: urgent/,
      );
    });

    it("omits teamId from createIssueLabel when the issue has no team", async () => {
      const fake = makeFakeIssue({ id: "issue-1", labelIds: [], team: Promise.resolve(null) });
      sdk.issue.mockResolvedValue(fake);
      sdk.issueLabels.mockResolvedValue({ nodes: [] });
      sdk.createIssueLabel.mockResolvedValue({
        issueLabel: Promise.resolve({ id: "new-id", name: "urgent" }),
      });

      await client.addLabel("issue-1", "urgent");

      expect(sdk.createIssueLabel).toHaveBeenCalledWith({ name: "urgent" });
    });
  });

  describe("removeLabel", () => {
    it("looks up the label via issue.labels() when not cached and removes it", async () => {
      const fake = makeFakeIssue({
        id: "issue-1",
        labelIds: ["label-id", "other-id"],
        labels: () => Promise.resolve({ nodes: [{ id: "label-id", name: "bug" }] }),
      });
      sdk.issue.mockResolvedValue(fake);

      await client.removeLabel("issue-1", "bug");

      expect(sdk.updateIssue).toHaveBeenCalledWith("issue-1", { labelIds: ["other-id"] });
    });

    it("is a no-op when the label cannot be found on the issue", async () => {
      const fake = makeFakeIssue({
        id: "issue-1",
        labelIds: ["other-id"],
        labels: () => Promise.resolve({ nodes: [] }),
      });
      sdk.issue.mockResolvedValue(fake);

      await client.removeLabel("issue-1", "nonexistent");

      expect(sdk.updateIssue).not.toHaveBeenCalled();
    });

    it("uses the cached label id (populated by a prior addLabel) without calling issue.labels() again", async () => {
      const fakeForAdd = makeFakeIssue({ id: "issue-1", labelIds: [] });
      sdk.issue.mockResolvedValue(fakeForAdd);
      sdk.issueLabels.mockResolvedValue({ nodes: [{ id: "label-id", name: "bug" }] });
      await client.addLabel("issue-1", "bug");

      const labelsSpy = vi.fn().mockResolvedValue({ nodes: [] });
      const fakeForRemove = makeFakeIssue({
        id: "issue-1",
        labelIds: ["label-id", "other-id"],
        labels: labelsSpy,
      });
      sdk.issue.mockResolvedValue(fakeForRemove);

      await client.removeLabel("issue-1", "bug");

      expect(labelsSpy).not.toHaveBeenCalled();
      expect(sdk.updateIssue).toHaveBeenCalledWith("issue-1", { labelIds: ["other-id"] });
    });
  });

  describe("getRelatedContext blocker hydration failure", () => {
    it("logs a warning and drops a blocker whose relation.issue rejects, without failing the call", async () => {
      const focus = makeFakeIssue({
        id: "focus-id",
        parent: Promise.resolve(null),
        inverseRelations: () =>
          Promise.resolve({
            nodes: [
              { id: "rel-1", type: "blocks", issue: Promise.reject(new Error("deleted issue")) },
            ],
          }),
      });
      sdk.issue.mockResolvedValue(focus);

      const ctx = await client.getRelatedContext("focus-id");

      expect(ctx.blockers).toEqual([]);
      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ relationId: "rel-1", focusIssueId: "focus-id" }),
        "Failed to hydrate blocker issue from relation",
      );
    });
  });

  describe("listLabels", () => {
    it("returns label names and populates the label cache for later removeLabel calls", async () => {
      const fake = makeFakeIssue({
        id: "issue-1",
        labelIds: ["label-id", "other-id"],
        labels: () =>
          Promise.resolve({
            nodes: [
              { id: "label-id", name: "bug" },
              { id: "other-id", name: "urgent" },
            ],
          }),
      });
      sdk.issue.mockResolvedValue(fake);

      const names = await client.listLabels("issue-1");
      expect(names).toEqual(["bug", "urgent"]);

      // The cache populated by listLabels should let removeLabel skip issue.labels().
      const labelsSpy = vi.fn().mockResolvedValue({ nodes: [] });
      sdk.issue.mockResolvedValue(
        makeFakeIssue({ id: "issue-1", labelIds: ["label-id", "other-id"], labels: labelsSpy }),
      );
      await client.removeLabel("issue-1", "bug");
      expect(labelsSpy).not.toHaveBeenCalled();
    });

    it("returns an empty array when the issue has no labels", async () => {
      const fake = makeFakeIssue({ id: "issue-1", labels: () => Promise.resolve({ nodes: [] }) });
      sdk.issue.mockResolvedValue(fake);

      await expect(client.listLabels("issue-1")).resolves.toEqual([]);
    });
  });
});
