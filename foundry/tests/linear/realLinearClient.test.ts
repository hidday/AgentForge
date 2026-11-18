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
  project: Promise<{ id: string; name: string } | null>;
  cycle: Promise<{ id: string; name: string } | null>;
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
    project: Promise.resolve({ id: "project-1", name: "Backend" }),
    cycle: Promise.resolve({ id: "cycle-1", name: "Sprint 1" }),
    team: Promise.resolve({ id: "team-1", key: "PRY" }),
    labels: () => Promise.resolve({ nodes: [{ id: "l1", name: "bug" }] }),
    ...overrides,
  };
}

type SdkStub = {
  issue: ReturnType<typeof vi.fn>;
  issues: ReturnType<typeof vi.fn>;
  createComment: ReturnType<typeof vi.fn>;
  updateIssue: ReturnType<typeof vi.fn>;
  team: ReturnType<typeof vi.fn>;
  issueLabels: ReturnType<typeof vi.fn>;
  createIssueLabel: ReturnType<typeof vi.fn>;
};

function installFakeSdk(client: RealLinearClient): SdkStub {
  const sdk: SdkStub = {
    issue: vi.fn(),
    issues: vi.fn(),
    createComment: vi.fn(),
    updateIssue: vi.fn(),
    team: vi.fn(),
    issueLabels: vi.fn(),
    createIssueLabel: vi.fn(),
  };
  (client as unknown as { sdk: SdkStub }).sdk = sdk;
  return sdk;
}

describe("RealLinearClient", () => {
  let client: RealLinearClient;
  let sdk: SdkStub;
  let logger: ReturnType<typeof makeLogger>;

  beforeEach(() => {
    logger = makeLogger();
    client = new RealLinearClient("test-key", logger as never);
    sdk = installFakeSdk(client);
  });

  describe("getIssue", () => {
    it("maps an SDK issue into a LinearIssue, resolving state/project/cycle/team", async () => {
      const fake = makeFakeIssue({ id: "issue-1" });
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

    it("falls back to defaults when description/state/project/cycle/team are missing", async () => {
      const fake = makeFakeIssue({
        id: "issue-2",
        description: null,
        state: Promise.resolve(null),
        project: Promise.resolve(null),
        cycle: Promise.resolve(null),
        team: Promise.resolve(null),
        labels: () => Promise.resolve({ nodes: [] }),
      });
      sdk.issue.mockResolvedValue(fake);

      const result = await client.getIssue("issue-2");

      expect(result.description).toBe("");
      expect(result.state).toBe("Unknown");
      expect(result.project).toBeUndefined();
      expect(result.cycle).toBeUndefined();
      expect(result.team).toBeUndefined();
      expect(result.labels).toEqual([]);
    });

    it("treats a nullish labels connection as an empty labels array", async () => {
      const fake = makeFakeIssue({
        id: "issue-3",
        labels: () => Promise.resolve(null as unknown as { nodes: never[] }),
      });
      sdk.issue.mockResolvedValue(fake);

      const result = await client.getIssue("issue-3");

      expect(result.labels).toEqual([]);
    });
  });

  describe("searchIssues", () => {
    it("builds a GraphQL filter from projectName/assigneeMe/team and maps results", async () => {
      const issueA = makeFakeIssue({ id: "a" });
      const issueB = makeFakeIssue({ id: "b" });
      sdk.issues.mockResolvedValue({ nodes: [issueA, issueB] });

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
      expect(results).toHaveLength(2);
      expect(results[0]).toMatchObject({ id: "a", state: "Todo" });
      expect(logger.info).toHaveBeenCalled();
    });

    it("omits optional filter fields when not provided and handles an empty result", async () => {
      sdk.issues.mockResolvedValue({ nodes: [] });

      const results = await client.searchIssues({ state: "Done" });

      expect(sdk.issues).toHaveBeenCalledWith({
        filter: { state: { name: { eq: "Done" } } },
      });
      expect(results).toEqual([]);
    });

    it("handles a nullish issues connection", async () => {
      sdk.issues.mockResolvedValue(null);

      const results = await client.searchIssues({ state: "Done" });

      expect(results).toEqual([]);
    });

    it("falls back to defaults when an issue has no description/project/team/cycle/labels", async () => {
      const issue = makeFakeIssue({
        id: "a",
        description: null,
        project: Promise.resolve(null),
        cycle: Promise.resolve(null),
        team: Promise.resolve(null),
        labels: () => Promise.resolve(null as unknown as { nodes: never[] }),
      });
      sdk.issues.mockResolvedValue({ nodes: [issue] });

      const [result] = await client.searchIssues({ state: "Todo" });

      expect(result.description).toBe("");
      expect(result.project).toBeUndefined();
      expect(result.team).toBeUndefined();
      expect(result.cycle).toBeUndefined();
      expect(result.labels).toEqual([]);
    });
  });

  describe("postComment", () => {
    it("creates a comment via the SDK", async () => {
      sdk.createComment.mockResolvedValue({});

      await client.postComment("issue-1", "Hello");

      expect(sdk.createComment).toHaveBeenCalledWith({ issueId: "issue-1", body: "Hello" });
      expect(logger.debug).toHaveBeenCalled();
    });
  });

  describe("updateIssueState", () => {
    it("logs a warning and returns early when the issue has no team", async () => {
      sdk.issue.mockResolvedValue(makeFakeIssue({ id: "issue-1", team: Promise.resolve(null) }));

      await client.updateIssueState("issue-1", "Done");

      expect(logger.warn).toHaveBeenCalledWith(
        { issueId: "issue-1" },
        "Cannot update state: issue has no team",
      );
      expect(sdk.updateIssue).not.toHaveBeenCalled();
    });

    it("logs a warning and returns early when the state name cannot be resolved", async () => {
      sdk.issue.mockResolvedValue(makeFakeIssue({ id: "issue-1" }));
      sdk.team.mockResolvedValue({ states: () => Promise.resolve({ nodes: [] }) });

      await client.updateIssueState("issue-1", "Nonexistent");

      expect(logger.warn).toHaveBeenCalledWith(
        { issueId: "issue-1", stateName: "Nonexistent", teamId: "team-1" },
        "Could not find workflow state by name",
      );
      expect(sdk.updateIssue).not.toHaveBeenCalled();
    });

    it("resolves the state id and updates the issue", async () => {
      sdk.issue.mockResolvedValue(makeFakeIssue({ id: "issue-1" }));
      sdk.team.mockResolvedValue({
        states: () =>
          Promise.resolve({ nodes: [{ id: "state-done", name: "Done" }] }),
      });
      sdk.updateIssue.mockResolvedValue({});

      await client.updateIssueState("issue-1", "Done");

      expect(sdk.updateIssue).toHaveBeenCalledWith("issue-1", { stateId: "state-done" });
      expect(logger.debug).toHaveBeenCalled();
    });

    it("caches the team's state map across calls (only calls sdk.team once)", async () => {
      sdk.issue.mockResolvedValue(makeFakeIssue({ id: "issue-1" }));
      sdk.team.mockResolvedValue({
        states: () => Promise.resolve({ nodes: [{ id: "state-done", name: "Done" }] }),
      });
      sdk.updateIssue.mockResolvedValue({});

      await client.updateIssueState("issue-1", "Done");
      await client.updateIssueState("issue-1", "Done");

      expect(sdk.team).toHaveBeenCalledTimes(1);
    });
  });

  describe("addLabel", () => {
    it("creates a new label (via resolveOrCreateLabel) and appends it to labelIds", async () => {
      const fake = makeFakeIssue({ id: "issue-1", labelIds: ["existing-id"] });
      sdk.issue.mockResolvedValue(fake);
      sdk.issueLabels.mockResolvedValue({ nodes: [] });
      sdk.createIssueLabel.mockResolvedValue({
        issueLabel: Promise.resolve({ id: "new-label-id" }),
      });
      sdk.updateIssue.mockResolvedValue({});

      await client.addLabel("issue-1", "urgent");

      expect(sdk.createIssueLabel).toHaveBeenCalledWith({ name: "urgent", teamId: "team-1" });
      expect(sdk.updateIssue).toHaveBeenCalledWith("issue-1", {
        labelIds: ["existing-id", "new-label-id"],
      });
      expect(logger.info).toHaveBeenCalled();
    });

    it("reuses an existing label found via issueLabels instead of creating one", async () => {
      const fake = makeFakeIssue({ id: "issue-1", labelIds: [] });
      sdk.issue.mockResolvedValue(fake);
      sdk.issueLabels.mockResolvedValue({ nodes: [{ id: "found-id" }] });
      sdk.updateIssue.mockResolvedValue({});

      await client.addLabel("issue-1", "urgent");

      expect(sdk.createIssueLabel).not.toHaveBeenCalled();
      expect(sdk.updateIssue).toHaveBeenCalledWith("issue-1", { labelIds: ["found-id"] });
    });

    it("does not call updateIssue again when the label is already present", async () => {
      const fake = makeFakeIssue({ id: "issue-1", labelIds: ["found-id"] });
      sdk.issue.mockResolvedValue(fake);
      sdk.issueLabels.mockResolvedValue({ nodes: [{ id: "found-id" }] });

      await client.addLabel("issue-1", "urgent");

      expect(sdk.updateIssue).not.toHaveBeenCalled();
    });

    it("caches resolved label ids across calls", async () => {
      const fake = makeFakeIssue({ id: "issue-1", labelIds: [] });
      sdk.issue.mockResolvedValue(fake);
      sdk.issueLabels.mockResolvedValue({ nodes: [{ id: "found-id" }] });
      sdk.updateIssue.mockResolvedValue({});

      await client.addLabel("issue-1", "urgent");
      await client.addLabel("issue-1", "urgent");

      expect(sdk.issueLabels).toHaveBeenCalledTimes(1);
    });

    it("throws when label creation does not return an issueLabel", async () => {
      const fake = makeFakeIssue({ id: "issue-1", labelIds: [], team: Promise.resolve(null) });
      sdk.issue.mockResolvedValue(fake);
      sdk.issueLabels.mockResolvedValue({ nodes: [] });
      sdk.createIssueLabel.mockResolvedValue({ issueLabel: Promise.resolve(undefined) });

      await expect(client.addLabel("issue-1", "urgent")).rejects.toThrow(
        "Failed to create label: urgent",
      );
      expect(sdk.createIssueLabel).toHaveBeenCalledWith({ name: "urgent" });
    });
  });

  describe("removeLabel", () => {
    it("looks up the label id via issue.labels() when not cached, and updates the issue", async () => {
      const fake = makeFakeIssue({
        id: "issue-1",
        labelIds: ["l1", "l2"],
        labels: () => Promise.resolve({ nodes: [{ id: "l1", name: "urgent" }] }),
      });
      sdk.issue.mockResolvedValue(fake);
      sdk.updateIssue.mockResolvedValue({});

      await client.removeLabel("issue-1", "urgent");

      expect(sdk.updateIssue).toHaveBeenCalledWith("issue-1", { labelIds: ["l2"] });
    });

    it("returns early without updating when the label name is not found", async () => {
      const fake = makeFakeIssue({
        id: "issue-1",
        labelIds: ["l1"],
        labels: () => Promise.resolve({ nodes: [] }),
      });
      sdk.issue.mockResolvedValue(fake);

      await client.removeLabel("issue-1", "missing");

      expect(sdk.updateIssue).not.toHaveBeenCalled();
    });

    it("uses the cached label id on a subsequent call instead of calling issue.labels() again", async () => {
      const labelsFn = vi.fn().mockResolvedValue({ nodes: [{ id: "l1", name: "urgent" }] });
      const fake = makeFakeIssue({ id: "issue-1", labelIds: ["l1", "l2"], labels: labelsFn });
      sdk.issue.mockResolvedValue(fake);
      sdk.updateIssue.mockResolvedValue({});

      await client.removeLabel("issue-1", "urgent");
      await client.removeLabel("issue-1", "urgent");

      expect(labelsFn).toHaveBeenCalledTimes(1);
      expect(sdk.updateIssue).toHaveBeenCalledTimes(2);
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
      sdk.issue.mockResolvedValue(fake);

      const names = await client.listLabels("issue-1");

      expect(names).toEqual(["bug", "urgent"]);

      // Cached as a side effect: removeLabel for "urgent" should not need
      // to call issue.labels() again.
      const labelsFn = vi.fn();
      const fakeForRemove = makeFakeIssue({ id: "issue-1", labelIds: ["l2"], labels: labelsFn });
      sdk.issue.mockResolvedValue(fakeForRemove);
      sdk.updateIssue.mockResolvedValue({});

      await client.removeLabel("issue-1", "urgent");
      expect(labelsFn).not.toHaveBeenCalled();
    });

    it("returns an empty array when there are no labels", async () => {
      sdk.issue.mockResolvedValue(
        makeFakeIssue({ id: "issue-1", labels: () => Promise.resolve({ nodes: [] }) }),
      );

      const names = await client.listLabels("issue-1");

      expect(names).toEqual([]);
    });

    it("returns an empty array and skips caching when the labels connection is nullish", async () => {
      sdk.issue.mockResolvedValue(
        makeFakeIssue({
          id: "issue-1",
          labels: () => Promise.resolve(null as unknown as { nodes: never[] }),
        }),
      );

      const names = await client.listLabels("issue-1");

      expect(names).toEqual([]);
    });
  });

  describe("resolveStateId (via updateIssueState)", () => {
    it("treats a nullish states connection as having no states", async () => {
      sdk.issue.mockResolvedValue(makeFakeIssue({ id: "issue-1" }));
      sdk.team.mockResolvedValue({ states: () => Promise.resolve(null) });

      await client.updateIssueState("issue-1", "Done");

      expect(logger.warn).toHaveBeenCalledWith(
        { issueId: "issue-1", stateName: "Done", teamId: "team-1" },
        "Could not find workflow state by name",
      );
      expect(sdk.updateIssue).not.toHaveBeenCalled();
    });
  });
});
