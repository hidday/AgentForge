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
  inverseRelations: () => Promise<{
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
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };
}

describe("RealLinearClient", () => {
  let client: RealLinearClient;
  let logger: ReturnType<typeof makeLogger>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let fakeSdk: any;

  beforeEach(() => {
    logger = makeLogger();
    client = new RealLinearClient("test-key", logger as never);
    fakeSdk = {};
    (client as unknown as { sdk: unknown }).sdk = fakeSdk;
  });

  describe("getIssue", () => {
    it("maps every field when all optional fields are present", async () => {
      const issue = makeFakeIssue({
        id: "issue-1",
        identifier: "PRY-42",
        title: "Do the thing",
        description: "A description",
        branchName: "ai/issue-42",
        priority: 2,
        url: "https://linear.app/team/issue/PRY-42",
        state: Promise.resolve({ id: "s1", name: "In Progress" }),
        project: Promise.resolve({ name: "Project X" }),
        cycle: Promise.resolve({ name: "Cycle 5" }),
        team: Promise.resolve({ id: "team-1", key: "PRY" }),
        labels: () => Promise.resolve({ nodes: [{ id: "l1", name: "bug" }] }),
      });
      fakeSdk.issue = vi.fn().mockResolvedValue(issue);

      const result = await client.getIssue("issue-1");

      expect(result).toEqual({
        id: "issue-1",
        identifier: "PRY-42",
        title: "Do the thing",
        description: "A description",
        branchName: "ai/issue-42",
        state: "In Progress",
        labels: ["bug"],
        priority: 2,
        url: "https://linear.app/team/issue/PRY-42",
        project: "Project X",
        team: "PRY",
        cycle: "Cycle 5",
      });
      expect(fakeSdk.issue).toHaveBeenCalledWith("issue-1");
    });

    it("defaults optional fields when null (state/description/project/team/cycle/labels)", async () => {
      const issue = makeFakeIssue({
        id: "issue-2",
        description: null,
        state: Promise.resolve(null),
        project: Promise.resolve(null),
        cycle: Promise.resolve(null),
        team: Promise.resolve(null),
        labels: () => Promise.resolve({ nodes: [] }),
      });
      fakeSdk.issue = vi.fn().mockResolvedValue(issue);

      const result = await client.getIssue("issue-2");

      expect(result.description).toBe("");
      expect(result.state).toBe("Unknown");
      expect(result.project).toBeUndefined();
      expect(result.team).toBeUndefined();
      expect(result.cycle).toBeUndefined();
      expect(result.labels).toEqual([]);
    });

    it("defaults labels to [] when the labels connection has no nodes property", async () => {
      const issue = makeFakeIssue({
        id: "issue-3",
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        labels: () => Promise.resolve({} as any),
      });
      fakeSdk.issue = vi.fn().mockResolvedValue(issue);

      const result = await client.getIssue("issue-3");

      expect(result.labels).toEqual([]);
    });
  });

  describe("searchIssues", () => {
    function makeSearchable() {
      const results: Array<{ id: string }> = [];
      const issue1 = makeFakeIssue({
        id: "found-1",
        identifier: "PRY-1",
        labels: () => Promise.resolve({ nodes: [{ id: "l1", name: "urgent" }] }),
        project: Promise.resolve({ name: "Proj" }),
        cycle: Promise.resolve({ name: "Cyc" }),
        team: Promise.resolve({ id: "t1", key: "PRY" }),
      });
      fakeSdk.issues = vi.fn().mockResolvedValue({ nodes: [issue1] });
      return { issue1, results };
    }

    it("builds gqlFilter with only state when no optional filters set", async () => {
      makeSearchable();

      await client.searchIssues({ state: "Todo" });

      expect(fakeSdk.issues).toHaveBeenCalledWith({
        filter: { state: { name: { eq: "Todo" } } },
      });
    });

    it("builds gqlFilter with projectName only", async () => {
      makeSearchable();

      await client.searchIssues({ state: "Todo", projectName: "Foundry" });

      expect(fakeSdk.issues).toHaveBeenCalledWith({
        filter: {
          state: { name: { eq: "Todo" } },
          project: { name: { eq: "Foundry" } },
        },
      });
    });

    it("builds gqlFilter with assigneeMe only", async () => {
      makeSearchable();

      await client.searchIssues({ state: "Todo", assigneeMe: true });

      expect(fakeSdk.issues).toHaveBeenCalledWith({
        filter: {
          state: { name: { eq: "Todo" } },
          assignee: { isMe: { eq: true } },
        },
      });
    });

    it("builds gqlFilter with team only", async () => {
      makeSearchable();

      await client.searchIssues({ state: "Todo", team: "PRY" });

      expect(fakeSdk.issues).toHaveBeenCalledWith({
        filter: {
          state: { name: { eq: "Todo" } },
          team: { or: [{ name: { eq: "PRY" } }, { key: { eq: "PRY" } }] },
        },
      });
    });

    it("builds gqlFilter with all optional filters combined", async () => {
      makeSearchable();

      await client.searchIssues({
        state: "Todo",
        projectName: "Foundry",
        assigneeMe: true,
        team: "PRY",
      });

      expect(fakeSdk.issues).toHaveBeenCalledWith({
        filter: {
          state: { name: { eq: "Todo" } },
          project: { name: { eq: "Foundry" } },
          assignee: { isMe: { eq: true } },
          team: { or: [{ name: { eq: "PRY" } }, { key: { eq: "PRY" } }] },
        },
      });
    });

    it("maps returned SDK issues, using the filter's stateName rather than the issue's own state", async () => {
      const { issue1 } = makeSearchable();

      const results = await client.searchIssues({ state: "Todo" });

      expect(results).toEqual([
        {
          id: issue1.id,
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
    });

    it("returns an empty array when the connection has no nodes", async () => {
      fakeSdk.issues = vi.fn().mockResolvedValue({ nodes: [] });

      const results = await client.searchIssues({ state: "Todo" });

      expect(results).toEqual([]);
    });

    it("returns an empty array when the connection itself has no nodes property", async () => {
      fakeSdk.issues = vi.fn().mockResolvedValue({});

      const results = await client.searchIssues({ state: "Todo" });

      expect(results).toEqual([]);
    });

    it("defaults description/project/team/cycle when null and labels when nodes is absent", async () => {
      const issue = makeFakeIssue({
        id: "found-2",
        description: null,
        project: Promise.resolve(null),
        cycle: Promise.resolve(null),
        team: Promise.resolve(null),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        labels: () => Promise.resolve({} as any),
      });
      fakeSdk.issues = vi.fn().mockResolvedValue({ nodes: [issue] });

      const [result] = await client.searchIssues({ state: "Todo" });

      expect(result.description).toBe("");
      expect(result.project).toBeUndefined();
      expect(result.team).toBeUndefined();
      expect(result.cycle).toBeUndefined();
      expect(result.labels).toEqual([]);
    });
  });

  describe("postComment", () => {
    it("calls sdk.createComment with issueId and body", async () => {
      fakeSdk.createComment = vi.fn().mockResolvedValue({});

      await client.postComment("issue-1", "hello world");

      expect(fakeSdk.createComment).toHaveBeenCalledWith({
        issueId: "issue-1",
        body: "hello world",
      });
    });
  });

  describe("updateIssueState", () => {
    it("warns and returns without calling updateIssue when issue has no team", async () => {
      const issue = makeFakeIssue({ id: "issue-1", team: Promise.resolve(null) });
      fakeSdk.issue = vi.fn().mockResolvedValue(issue);
      fakeSdk.updateIssue = vi.fn();

      await client.updateIssueState("issue-1", "Done");

      expect(fakeSdk.updateIssue).not.toHaveBeenCalled();
      expect(logger.warn).toHaveBeenCalledWith(
        { issueId: "issue-1" },
        "Cannot update state: issue has no team",
      );
    });

    it("warns and returns without calling updateIssue when state name is not found", async () => {
      const issue = makeFakeIssue({
        id: "issue-1",
        team: Promise.resolve({ id: "team-1", key: "PRY" }),
      });
      fakeSdk.issue = vi.fn().mockResolvedValue(issue);
      fakeSdk.team = vi.fn().mockResolvedValue({
        states: () => Promise.resolve({ nodes: [{ id: "s1", name: "Todo" }] }),
      });
      fakeSdk.updateIssue = vi.fn();

      await client.updateIssueState("issue-1", "Nonexistent State");

      expect(fakeSdk.updateIssue).not.toHaveBeenCalled();
      expect(logger.warn).toHaveBeenCalledWith(
        { issueId: "issue-1", stateName: "Nonexistent State", teamId: "team-1" },
        "Could not find workflow state by name",
      );
    });

    it("resolves the state id and calls updateIssue on the happy path", async () => {
      const issue = makeFakeIssue({
        id: "issue-1",
        team: Promise.resolve({ id: "team-1", key: "PRY" }),
      });
      fakeSdk.issue = vi.fn().mockResolvedValue(issue);
      fakeSdk.team = vi.fn().mockResolvedValue({
        states: () =>
          Promise.resolve({
            nodes: [
              { id: "s1", name: "Todo" },
              { id: "s2", name: "Done" },
            ],
          }),
      });
      fakeSdk.updateIssue = vi.fn().mockResolvedValue({});

      await client.updateIssueState("issue-1", "Done");

      expect(fakeSdk.team).toHaveBeenCalledWith("team-1");
      expect(fakeSdk.updateIssue).toHaveBeenCalledWith("issue-1", { stateId: "s2" });
    });

    it("caches resolved states per team: sdk.team is called only once across two calls for the same team", async () => {
      const issue = makeFakeIssue({
        id: "issue-1",
        team: Promise.resolve({ id: "team-1", key: "PRY" }),
      });
      fakeSdk.issue = vi.fn().mockResolvedValue(issue);
      const statesConn = {
        nodes: [
          { id: "s1", name: "Todo" },
          { id: "s2", name: "Done" },
        ],
      };
      fakeSdk.team = vi.fn().mockResolvedValue({ states: () => Promise.resolve(statesConn) });
      fakeSdk.updateIssue = vi.fn().mockResolvedValue({});

      await client.updateIssueState("issue-1", "Todo");
      await client.updateIssueState("issue-1", "Done");

      expect(fakeSdk.team).toHaveBeenCalledTimes(1);
      expect(fakeSdk.updateIssue).toHaveBeenNthCalledWith(1, "issue-1", { stateId: "s1" });
      expect(fakeSdk.updateIssue).toHaveBeenNthCalledWith(2, "issue-1", { stateId: "s2" });
    });
  });

  describe("addLabel", () => {
    it("does not call updateIssue when the resolved label is already present", async () => {
      const issue = makeFakeIssue({
        id: "issue-1",
        labelIds: ["label-1"],
        team: Promise.resolve({ id: "team-1", key: "PRY" }),
      });
      fakeSdk.issue = vi.fn().mockResolvedValue(issue);
      fakeSdk.issueLabels = vi
        .fn()
        .mockResolvedValue({ nodes: [{ id: "label-1", name: "bug" }] });
      fakeSdk.updateIssue = vi.fn();

      await client.addLabel("issue-1", "bug");

      expect(fakeSdk.updateIssue).not.toHaveBeenCalled();
    });

    it("appends the resolved label id and calls updateIssue when not present", async () => {
      const issue = makeFakeIssue({
        id: "issue-1",
        labelIds: ["other-label"],
        team: Promise.resolve({ id: "team-1", key: "PRY" }),
      });
      fakeSdk.issue = vi.fn().mockResolvedValue(issue);
      fakeSdk.issueLabels = vi
        .fn()
        .mockResolvedValue({ nodes: [{ id: "label-1", name: "bug" }] });
      fakeSdk.updateIssue = vi.fn().mockResolvedValue({});

      await client.addLabel("issue-1", "bug");

      expect(fakeSdk.updateIssue).toHaveBeenCalledWith("issue-1", {
        labelIds: ["other-label", "label-1"],
      });
    });

    describe("resolveOrCreateLabel via addLabel", () => {
      it("reuses labelCache across two addLabel calls: sdk.issueLabels called only once", async () => {
        const issue = makeFakeIssue({
          id: "issue-1",
          labelIds: [],
          team: Promise.resolve({ id: "team-1", key: "PRY" }),
        });
        fakeSdk.issue = vi.fn().mockResolvedValue(issue);
        fakeSdk.issueLabels = vi
          .fn()
          .mockResolvedValue({ nodes: [{ id: "label-1", name: "bug" }] });
        fakeSdk.updateIssue = vi.fn().mockResolvedValue({});

        await client.addLabel("issue-1", "bug");
        await client.addLabel("issue-1", "bug");

        expect(fakeSdk.issueLabels).toHaveBeenCalledTimes(1);
      });

      it("finds an existing label via sdk.issueLabels when not cached", async () => {
        const issue = makeFakeIssue({
          id: "issue-1",
          labelIds: [],
          team: Promise.resolve({ id: "team-1", key: "PRY" }),
        });
        fakeSdk.issue = vi.fn().mockResolvedValue(issue);
        fakeSdk.issueLabels = vi
          .fn()
          .mockResolvedValue({ nodes: [{ id: "existing-id", name: "chore" }] });
        fakeSdk.createIssueLabel = vi.fn();
        fakeSdk.updateIssue = vi.fn().mockResolvedValue({});

        await client.addLabel("issue-1", "chore");

        expect(fakeSdk.issueLabels).toHaveBeenCalledWith({
          filter: { name: { eq: "chore" } },
        });
        expect(fakeSdk.createIssueLabel).not.toHaveBeenCalled();
        expect(fakeSdk.updateIssue).toHaveBeenCalledWith("issue-1", {
          labelIds: ["existing-id"],
        });
      });

      it("creates a new label via sdk.createIssueLabel when not cached and not found", async () => {
        const issue = makeFakeIssue({
          id: "issue-1",
          labelIds: [],
          team: Promise.resolve({ id: "team-1", key: "PRY" }),
        });
        fakeSdk.issue = vi.fn().mockResolvedValue(issue);
        fakeSdk.issueLabels = vi.fn().mockResolvedValue({ nodes: [] });
        fakeSdk.createIssueLabel = vi.fn().mockResolvedValue({
          issueLabel: Promise.resolve({ id: "new-label-id" }),
        });
        fakeSdk.updateIssue = vi.fn().mockResolvedValue({});

        await client.addLabel("issue-1", "brand-new");

        expect(fakeSdk.createIssueLabel).toHaveBeenCalledWith({
          name: "brand-new",
          teamId: "team-1",
        });
        expect(fakeSdk.updateIssue).toHaveBeenCalledWith("issue-1", {
          labelIds: ["new-label-id"],
        });
      });

      it("creates a label without teamId when the issue has no team", async () => {
        const issue = makeFakeIssue({
          id: "issue-1",
          labelIds: [],
          team: Promise.resolve(null),
        });
        fakeSdk.issue = vi.fn().mockResolvedValue(issue);
        fakeSdk.issueLabels = vi.fn().mockResolvedValue({ nodes: [] });
        fakeSdk.createIssueLabel = vi.fn().mockResolvedValue({
          issueLabel: Promise.resolve({ id: "new-label-id" }),
        });
        fakeSdk.updateIssue = vi.fn().mockResolvedValue({});

        await client.addLabel("issue-1", "no-team-label");

        expect(fakeSdk.createIssueLabel).toHaveBeenCalledWith({ name: "no-team-label" });
      });

      it("throws when the created label resolves to nothing", async () => {
        const issue = makeFakeIssue({
          id: "issue-1",
          labelIds: [],
          team: Promise.resolve({ id: "team-1", key: "PRY" }),
        });
        fakeSdk.issue = vi.fn().mockResolvedValue(issue);
        fakeSdk.issueLabels = vi.fn().mockResolvedValue({ nodes: [] });
        fakeSdk.createIssueLabel = vi.fn().mockResolvedValue({
          issueLabel: Promise.resolve(undefined),
        });
        fakeSdk.updateIssue = vi.fn();

        await expect(client.addLabel("issue-1", "doomed")).rejects.toThrow(
          "Failed to create label: doomed",
        );
        expect(fakeSdk.updateIssue).not.toHaveBeenCalled();
      });
    });
  });

  describe("removeLabel", () => {
    it("uses labelCache when already populated, skipping the issue.labels() lookup", async () => {
      const labelsFn = vi
        .fn()
        .mockResolvedValue({ nodes: [{ id: "label-1", name: "bug" }] });
      const issue = makeFakeIssue({
        id: "issue-1",
        labelIds: ["label-1", "other"],
        labels: labelsFn,
      });
      fakeSdk.issue = vi.fn().mockResolvedValue(issue);
      fakeSdk.updateIssue = vi.fn().mockResolvedValue({});

      // First call: populates the cache via the issue.labels() lookup.
      await client.removeLabel("issue-1", "bug");
      // Second call: should reuse the cache, not calling issue.labels() again.
      await client.removeLabel("issue-1", "bug");

      expect(labelsFn).toHaveBeenCalledTimes(1);
      expect(fakeSdk.updateIssue).toHaveBeenCalledTimes(2);
      expect(fakeSdk.updateIssue).toHaveBeenNthCalledWith(1, "issue-1", {
        labelIds: ["other"],
      });
    });

    it("finds the label by name via issue.labels() when not cached, filters and updates", async () => {
      const issue = makeFakeIssue({
        id: "issue-1",
        labelIds: ["label-1", "other"],
        labels: () => Promise.resolve({ nodes: [{ id: "label-1", name: "bug" }] }),
      });
      fakeSdk.issue = vi.fn().mockResolvedValue(issue);
      fakeSdk.updateIssue = vi.fn().mockResolvedValue({});

      await client.removeLabel("issue-1", "bug");

      expect(fakeSdk.updateIssue).toHaveBeenCalledWith("issue-1", { labelIds: ["other"] });
    });

    it("returns early without calling updateIssue when the label is not found by name", async () => {
      const issue = makeFakeIssue({
        id: "issue-1",
        labelIds: ["other"],
        labels: () => Promise.resolve({ nodes: [{ id: "label-1", name: "bug" }] }),
      });
      fakeSdk.issue = vi.fn().mockResolvedValue(issue);
      fakeSdk.updateIssue = vi.fn();

      await client.removeLabel("issue-1", "nonexistent");

      expect(fakeSdk.updateIssue).not.toHaveBeenCalled();
    });
  });

  describe("listLabels", () => {
    it("returns label names and populates labelCache for subsequent removeLabel calls", async () => {
      const labelsFn = vi
        .fn()
        .mockResolvedValue({ nodes: [{ id: "label-1", name: "bug" }, { id: "label-2", name: "chore" }] });
      const issue = makeFakeIssue({ id: "issue-1", labelIds: ["label-1", "label-2"], labels: labelsFn });
      fakeSdk.issue = vi.fn().mockResolvedValue(issue);
      fakeSdk.updateIssue = vi.fn().mockResolvedValue({});

      const names = await client.listLabels("issue-1");
      expect(names).toEqual(["bug", "chore"]);

      // removeLabel should now reuse the cache populated by listLabels, not
      // calling issue.labels() again.
      await client.removeLabel("issue-1", "bug");

      expect(labelsFn).toHaveBeenCalledTimes(1);
      expect(fakeSdk.updateIssue).toHaveBeenCalledWith("issue-1", { labelIds: ["label-2"] });
    });

    it("returns [] and populates no cache entries when the labels connection has no nodes property", async () => {
      const issue = makeFakeIssue({
        id: "issue-1",
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        labels: () => Promise.resolve({} as any),
      });
      fakeSdk.issue = vi.fn().mockResolvedValue(issue);

      const names = await client.listLabels("issue-1");

      expect(names).toEqual([]);
    });
  });

  describe("resolveStateId via updateIssueState", () => {
    it("treats a states connection with no nodes property as no states found", async () => {
      const issue = makeFakeIssue({
        id: "issue-1",
        team: Promise.resolve({ id: "team-1", key: "PRY" }),
      });
      fakeSdk.issue = vi.fn().mockResolvedValue(issue);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      fakeSdk.team = vi.fn().mockResolvedValue({ states: () => Promise.resolve({} as any) });
      fakeSdk.updateIssue = vi.fn();

      await client.updateIssueState("issue-1", "Done");

      expect(fakeSdk.updateIssue).not.toHaveBeenCalled();
      expect(logger.warn).toHaveBeenCalledWith(
        { issueId: "issue-1", stateName: "Done", teamId: "team-1" },
        "Could not find workflow state by name",
      );
    });
  });
});
