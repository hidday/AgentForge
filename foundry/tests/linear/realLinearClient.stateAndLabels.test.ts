import { describe, it, expect, vi, beforeEach } from "vitest";
import { RealLinearClient } from "../../src/linear/realLinearClient.js";

interface FakeTeam {
  id: string;
  key: string;
  states: () => Promise<{ nodes: Array<{ id: string; name: string }> }>;
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
  team: Promise<FakeTeam | null>;
  labels: () => Promise<{ nodes: Array<{ id: string; name: string }> }>;
}

function makeTeam(overrides: Partial<FakeTeam> & { id: string }): FakeTeam {
  return {
    key: "PRY",
    states: () => Promise.resolve({ nodes: [] }),
    ...overrides,
  };
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
    team: Promise.resolve(null),
    labels: () => Promise.resolve({ nodes: [] }),
    ...overrides,
  };
}

function makeLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
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
    it("maps a fully populated SDK issue to the LinearIssue shape", async () => {
      const issue = makeFakeIssue({
        id: "issue-1",
        labels: () => Promise.resolve({ nodes: [{ id: "l1", name: "bug" }] }),
        state: Promise.resolve({ id: "s1", name: "In Review" }),
        project: Promise.resolve({ name: "Alpha" }),
        cycle: Promise.resolve({ name: "Cycle 4" }),
        team: Promise.resolve(makeTeam({ id: "team-1", key: "PRY" })),
      });
      sdk.issue.mockResolvedValue(issue);

      const result = await client.getIssue("issue-1");

      expect(result).toEqual({
        id: "issue-1",
        identifier: "PRY-1",
        title: "Issue title",
        description: "Issue description",
        branchName: "ai/issue-1",
        state: "In Review",
        labels: ["bug"],
        priority: 0,
        url: "https://linear.app/team/issue/PRY-1",
        project: "Alpha",
        team: "PRY",
        cycle: "Cycle 4",
      });
    });

    it("defaults missing state/project/cycle/team/description/labels", async () => {
      const issue = makeFakeIssue({ id: "issue-1", description: null, state: Promise.resolve(null) });
      sdk.issue.mockResolvedValue(issue);

      const result = await client.getIssue("issue-1");

      expect(result.state).toBe("Unknown");
      expect(result.description).toBe("");
      expect(result.project).toBeUndefined();
      expect(result.team).toBeUndefined();
      expect(result.cycle).toBeUndefined();
      expect(result.labels).toEqual([]);
    });
  });

  describe("searchIssues", () => {
    it("builds a filter from state only when no optional filters are given", async () => {
      sdk.issues.mockResolvedValue({ nodes: [] });

      await client.searchIssues({ state: "Todo" });

      expect(sdk.issues).toHaveBeenCalledWith({ filter: { state: { name: { eq: "Todo" } } } });
    });

    it("adds project/assignee/team clauses when provided", async () => {
      sdk.issues.mockResolvedValue({ nodes: [] });

      await client.searchIssues({
        state: "Todo",
        projectName: "Alpha",
        assigneeMe: true,
        team: "PRY",
      });

      expect(sdk.issues).toHaveBeenCalledWith({
        filter: {
          state: { name: { eq: "Todo" } },
          project: { name: { eq: "Alpha" } },
          assignee: { isMe: { eq: true } },
          team: { or: [{ name: { eq: "PRY" } }, { key: { eq: "PRY" } }] },
        },
      });
    });

    it("maps each result issue, defaulting missing project/cycle/team", async () => {
      const issue = makeFakeIssue({
        id: "issue-1",
        labels: () => Promise.resolve({ nodes: [{ id: "l1", name: "bug" }] }),
      });
      sdk.issues.mockResolvedValue({ nodes: [issue] });

      const results = await client.searchIssues({ state: "Todo" });

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
          project: undefined,
          team: undefined,
          cycle: undefined,
        },
      ]);
    });

    it("returns an empty array when the SDK reports no nodes", async () => {
      sdk.issues.mockResolvedValue({ nodes: undefined });

      await expect(client.searchIssues({ state: "Todo" })).resolves.toEqual([]);
    });
  });

  describe("postComment", () => {
    it("creates a comment via the SDK", async () => {
      sdk.createComment.mockResolvedValue({});

      await client.postComment("issue-1", "hello");

      expect(sdk.createComment).toHaveBeenCalledWith({ issueId: "issue-1", body: "hello" });
    });
  });

  describe("updateIssueState", () => {
    it("resolves the target state by name and updates the issue", async () => {
      const team = makeTeam({
        id: "team-1",
        states: () =>
          Promise.resolve({ nodes: [{ id: "state-done", name: "Done" }] }),
      });
      const issue = makeFakeIssue({ id: "issue-1", team: Promise.resolve(team) });
      sdk.issue.mockResolvedValue(issue);
      sdk.team.mockResolvedValue(team);

      await client.updateIssueState("issue-1", "Done");

      expect(sdk.updateIssue).toHaveBeenCalledWith("issue-1", { stateId: "state-done" });
      expect(sdk.team).toHaveBeenCalledWith("team-1");
    });

    it("caches the team's workflow states across calls (does not re-fetch states)", async () => {
      const statesFn = vi.fn().mockResolvedValue({ nodes: [{ id: "state-done", name: "Done" }] });
      const team = makeTeam({ id: "team-1", states: statesFn });
      sdk.issue.mockResolvedValue(makeFakeIssue({ id: "issue-1", team: Promise.resolve(team) }));
      sdk.team.mockResolvedValue(team);

      await client.updateIssueState("issue-1", "Done");
      await client.updateIssueState("issue-1", "Done");

      expect(statesFn).toHaveBeenCalledTimes(1);
      expect(sdk.team).toHaveBeenCalledTimes(1);
    });

    it("warns and skips when the issue has no team", async () => {
      sdk.issue.mockResolvedValue(makeFakeIssue({ id: "issue-1", team: Promise.resolve(null) }));

      await client.updateIssueState("issue-1", "Done");

      expect(sdk.updateIssue).not.toHaveBeenCalled();
      expect(logger.warn).toHaveBeenCalled();
    });

    it("warns and skips when no workflow state matches the given name", async () => {
      const team = makeTeam({ id: "team-1", states: () => Promise.resolve({ nodes: [] }) });
      sdk.issue.mockResolvedValue(makeFakeIssue({ id: "issue-1", team: Promise.resolve(team) }));
      sdk.team.mockResolvedValue(team);

      await client.updateIssueState("issue-1", "Nonexistent");

      expect(sdk.updateIssue).not.toHaveBeenCalled();
      expect(logger.warn).toHaveBeenCalled();
    });
  });

  describe("addLabel", () => {
    it("reuses a cached label id across calls without calling issueLabels again", async () => {
      sdk.issueLabels.mockResolvedValue({ nodes: [{ id: "label-1", name: "bug" }] });
      sdk.issue
        .mockResolvedValueOnce(makeFakeIssue({ id: "issue-1", labelIds: [] }))
        .mockResolvedValueOnce(makeFakeIssue({ id: "issue-2", labelIds: [] }));

      await client.addLabel("issue-1", "bug");
      await client.addLabel("issue-2", "bug");

      expect(sdk.issueLabels).toHaveBeenCalledTimes(1);
      expect(sdk.updateIssue).toHaveBeenNthCalledWith(1, "issue-1", { labelIds: ["label-1"] });
      expect(sdk.updateIssue).toHaveBeenNthCalledWith(2, "issue-2", { labelIds: ["label-1"] });
    });

    it("creates a new label when none exists, scoping it to the issue's team", async () => {
      sdk.issueLabels.mockResolvedValue({ nodes: [] });
      sdk.createIssueLabel.mockResolvedValue({
        issueLabel: Promise.resolve({ id: "label-new" }),
      });
      const team = makeTeam({ id: "team-1" });
      sdk.issue.mockResolvedValue(
        makeFakeIssue({ id: "issue-1", labelIds: [], team: Promise.resolve(team) }),
      );

      await client.addLabel("issue-1", "new-label");

      expect(sdk.createIssueLabel).toHaveBeenCalledWith({ name: "new-label", teamId: "team-1" });
      expect(sdk.updateIssue).toHaveBeenCalledWith("issue-1", { labelIds: ["label-new"] });
    });

    it("creates a new label without a teamId when the issue has no team", async () => {
      sdk.issueLabels.mockResolvedValue({ nodes: [] });
      sdk.createIssueLabel.mockResolvedValue({
        issueLabel: Promise.resolve({ id: "label-new" }),
      });
      sdk.issue.mockResolvedValue(
        makeFakeIssue({ id: "issue-1", labelIds: [], team: Promise.resolve(null) }),
      );

      await client.addLabel("issue-1", "new-label");

      expect(sdk.createIssueLabel).toHaveBeenCalledWith({ name: "new-label" });
    });

    it("throws when label creation does not return a created label", async () => {
      sdk.issueLabels.mockResolvedValue({ nodes: [] });
      sdk.createIssueLabel.mockResolvedValue({ issueLabel: Promise.resolve(undefined) });
      sdk.issue.mockResolvedValue(makeFakeIssue({ id: "issue-1", labelIds: [] }));

      await expect(client.addLabel("issue-1", "bad-label")).rejects.toThrow(
        /Failed to create label: bad-label/,
      );
    });

    it("does not call updateIssue again when the label is already on the issue", async () => {
      sdk.issueLabels.mockResolvedValue({ nodes: [{ id: "label-1", name: "bug" }] });
      sdk.issue.mockResolvedValue(makeFakeIssue({ id: "issue-1", labelIds: ["label-1"] }));

      await client.addLabel("issue-1", "bug");

      expect(sdk.updateIssue).not.toHaveBeenCalled();
    });
  });

  describe("removeLabel", () => {
    it("looks up the label id by name when not cached, then removes it", async () => {
      sdk.issue.mockResolvedValue(
        makeFakeIssue({
          id: "issue-1",
          labelIds: ["label-1", "label-2"],
          labels: () => Promise.resolve({ nodes: [{ id: "label-1", name: "bug" }] }),
        }),
      );

      await client.removeLabel("issue-1", "bug");

      expect(sdk.updateIssue).toHaveBeenCalledWith("issue-1", { labelIds: ["label-2"] });
    });

    it("is a no-op when the named label isn't found on the issue (uncached path)", async () => {
      sdk.issue.mockResolvedValue(
        makeFakeIssue({ id: "issue-1", labelIds: ["label-2"], labels: () => Promise.resolve({ nodes: [] }) }),
      );

      await client.removeLabel("issue-1", "missing-label");

      expect(sdk.updateIssue).not.toHaveBeenCalled();
    });

    it("uses a cached label id on a subsequent call, skipping the labels() lookup", async () => {
      const labelsFn = vi.fn().mockResolvedValue({ nodes: [{ id: "label-1", name: "bug" }] });
      sdk.issue
        .mockResolvedValueOnce(
          makeFakeIssue({ id: "issue-1", labelIds: ["label-1"], labels: labelsFn }),
        )
        .mockResolvedValueOnce(
          makeFakeIssue({ id: "issue-2", labelIds: ["label-1"], labels: labelsFn }),
        );

      await client.removeLabel("issue-1", "bug");
      await client.removeLabel("issue-2", "bug");

      expect(labelsFn).toHaveBeenCalledTimes(1);
      expect(sdk.updateIssue).toHaveBeenNthCalledWith(2, "issue-2", { labelIds: [] });
    });
  });

  describe("listLabels", () => {
    it("returns label names and warms the label cache for later removeLabel calls", async () => {
      const labelsFn = vi.fn().mockResolvedValue({ nodes: [{ id: "label-1", name: "bug" }] });
      sdk.issue
        .mockResolvedValueOnce(makeFakeIssue({ id: "issue-1", labels: labelsFn }))
        .mockResolvedValueOnce(
          makeFakeIssue({ id: "issue-1", labelIds: ["label-1"], labels: labelsFn }),
        );

      const names = await client.listLabels("issue-1");
      expect(names).toEqual(["bug"]);

      // removeLabel should now hit the warmed cache instead of calling labels() again.
      await client.removeLabel("issue-1", "bug");
      expect(labelsFn).toHaveBeenCalledTimes(1);
    });

    it("returns an empty array when the issue has no labels", async () => {
      sdk.issue.mockResolvedValue(
        makeFakeIssue({ id: "issue-1", labels: () => Promise.resolve({ nodes: [] }) }),
      );

      await expect(client.listLabels("issue-1")).resolves.toEqual([]);
    });
  });
});
