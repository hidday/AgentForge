import { describe, it, expect, vi, beforeEach } from "vitest";
import { RealLinearClient } from "../../src/linear/realLinearClient.js";

function makeLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
}

interface FakeSdk {
  issue: ReturnType<typeof vi.fn>;
  team: ReturnType<typeof vi.fn>;
  issues: ReturnType<typeof vi.fn>;
  createComment: ReturnType<typeof vi.fn>;
  updateIssue: ReturnType<typeof vi.fn>;
  issueLabels: ReturnType<typeof vi.fn>;
  createIssueLabel: ReturnType<typeof vi.fn>;
}

function makeClient(): { client: RealLinearClient; sdk: FakeSdk; logger: ReturnType<typeof makeLogger> } {
  const logger = makeLogger();
  const client = new RealLinearClient("api-key", logger as never);
  const sdk: FakeSdk = {
    issue: vi.fn(),
    team: vi.fn(),
    issues: vi.fn(),
    createComment: vi.fn(),
    updateIssue: vi.fn(),
    issueLabels: vi.fn(),
    createIssueLabel: vi.fn(),
  };
  (client as unknown as { sdk: FakeSdk }).sdk = sdk;
  return { client, sdk, logger };
}

function fakeIssue(overrides: Record<string, unknown> = {}) {
  return {
    id: "issue-1",
    identifier: "ENG-1",
    title: "Title",
    description: "Description",
    branchName: "ai/eng-1",
    priority: 1,
    url: "https://linear.app/team/issue/ENG-1",
    labelIds: ["label-a"],
    labels: vi.fn().mockResolvedValue({ nodes: [{ id: "label-a", name: "bug" }] }),
    state: Promise.resolve({ id: "state-1", name: "Todo" }),
    project: Promise.resolve({ name: "Platform" }),
    cycle: Promise.resolve({ name: "Sprint 1" }),
    team: Promise.resolve({ id: "team-1", key: "ENG" }),
    ...overrides,
  };
}

describe("RealLinearClient", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("getIssue", () => {
    it("maps an SDK issue into the LinearIssue shape, resolving labels/state/project/cycle/team", async () => {
      const { client, sdk } = makeClient();
      sdk.issue.mockResolvedValue(fakeIssue());

      const issue = await client.getIssue("issue-1");

      expect(issue).toEqual({
        id: "issue-1",
        identifier: "ENG-1",
        title: "Title",
        description: "Description",
        branchName: "ai/eng-1",
        state: "Todo",
        labels: ["bug"],
        priority: 1,
        url: "https://linear.app/team/issue/ENG-1",
        project: "Platform",
        team: "ENG",
        cycle: "Sprint 1",
      });
    });

    it("defaults missing description to empty string and absent relations to undefined/Unknown", async () => {
      const { client, sdk } = makeClient();
      sdk.issue.mockResolvedValue(
        fakeIssue({
          description: null,
          labels: vi.fn().mockResolvedValue({ nodes: [] }),
          state: Promise.resolve(undefined),
          project: Promise.resolve(null),
          cycle: Promise.resolve(null),
          team: Promise.resolve(null),
        }),
      );

      const issue = await client.getIssue("issue-1");

      expect(issue.description).toBe("");
      expect(issue.state).toBe("Unknown");
      expect(issue.project).toBeUndefined();
      expect(issue.team).toBeUndefined();
      expect(issue.cycle).toBeUndefined();
      expect(issue.labels).toEqual([]);
    });
  });

  describe("searchIssues", () => {
    it("builds a GraphQL filter from projectName/assigneeMe/team and maps results", async () => {
      const { client, sdk } = makeClient();
      sdk.issues.mockResolvedValue({ nodes: [fakeIssue({ id: "issue-2" })] });

      const results = await client.searchIssues({
        projectName: "Platform",
        assigneeMe: true,
        team: "ENG",
        state: "Todo",
      });

      expect(sdk.issues).toHaveBeenCalledWith({
        filter: {
          state: { name: { eq: "Todo" } },
          project: { name: { eq: "Platform" } },
          assignee: { isMe: { eq: true } },
          team: { or: [{ name: { eq: "ENG" } }, { key: { eq: "ENG" } }] },
        },
      });
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe("issue-2");
      expect(results[0].state).toBe("Todo");
    });

    it("omits optional filter keys when not provided and returns an empty array for no results", async () => {
      const { client, sdk } = makeClient();
      sdk.issues.mockResolvedValue({ nodes: [] });

      const results = await client.searchIssues({ state: "Done" });

      expect(sdk.issues).toHaveBeenCalledWith({ filter: { state: { name: { eq: "Done" } } } });
      expect(results).toEqual([]);
    });

    it("tolerates a null issues connection", async () => {
      const { client, sdk } = makeClient();
      sdk.issues.mockResolvedValue(null);

      const results = await client.searchIssues({ state: "Done" });

      expect(results).toEqual([]);
    });
  });

  describe("postComment", () => {
    it("creates a comment via the SDK", async () => {
      const { client, sdk } = makeClient();
      sdk.createComment.mockResolvedValue({});

      await client.postComment("issue-1", "hello");

      expect(sdk.createComment).toHaveBeenCalledWith({ issueId: "issue-1", body: "hello" });
    });
  });

  describe("updateIssueState", () => {
    it("resolves the workflow state id by name and updates the issue", async () => {
      const { client, sdk } = makeClient();
      sdk.issue.mockResolvedValue(fakeIssue());
      sdk.team.mockResolvedValue({
        states: vi.fn().mockResolvedValue({ nodes: [{ id: "state-id-1", name: "In Progress" }] }),
      });
      sdk.updateIssue.mockResolvedValue({});

      await client.updateIssueState("issue-1", "In Progress");

      expect(sdk.updateIssue).toHaveBeenCalledWith("issue-1", { stateId: "state-id-1" });
    });

    it("caches the resolved state map across calls for the same team (team() fetched once)", async () => {
      const { client, sdk } = makeClient();
      sdk.issue.mockResolvedValue(fakeIssue());
      sdk.team.mockResolvedValue({
        states: vi.fn().mockResolvedValue({
          nodes: [
            { id: "state-id-1", name: "In Progress" },
            { id: "state-id-2", name: "Done" },
          ],
        }),
      });
      sdk.updateIssue.mockResolvedValue({});

      await client.updateIssueState("issue-1", "In Progress");
      await client.updateIssueState("issue-1", "Done");

      expect(sdk.team).toHaveBeenCalledTimes(1);
      expect(sdk.updateIssue).toHaveBeenNthCalledWith(2, "issue-1", { stateId: "state-id-2" });
    });

    it("logs a warning and skips the update when the issue has no team", async () => {
      const { client, sdk, logger } = makeClient();
      sdk.issue.mockResolvedValue(fakeIssue({ team: Promise.resolve(null) }));

      await client.updateIssueState("issue-1", "In Progress");

      expect(logger.warn).toHaveBeenCalled();
      expect(sdk.updateIssue).not.toHaveBeenCalled();
    });

    it("logs a warning and skips the update when the state name cannot be resolved", async () => {
      const { client, sdk, logger } = makeClient();
      sdk.issue.mockResolvedValue(fakeIssue());
      sdk.team.mockResolvedValue({ states: vi.fn().mockResolvedValue({ nodes: [] }) });

      await client.updateIssueState("issue-1", "Nonexistent State");

      expect(logger.warn).toHaveBeenCalled();
      expect(sdk.updateIssue).not.toHaveBeenCalled();
    });
  });

  describe("addLabel", () => {
    it("resolves an existing label id and appends it when not already present", async () => {
      const { client, sdk } = makeClient();
      sdk.issue.mockResolvedValue(fakeIssue({ labelIds: ["label-a"] }));
      sdk.issueLabels.mockResolvedValue({ nodes: [{ id: "label-b", name: "urgent" }] });
      sdk.updateIssue.mockResolvedValue({});

      await client.addLabel("issue-1", "urgent");

      expect(sdk.updateIssue).toHaveBeenCalledWith("issue-1", { labelIds: ["label-a", "label-b"] });
    });

    it("creates a new label when none exists and adds it to the issue", async () => {
      const { client, sdk } = makeClient();
      sdk.issue.mockResolvedValue(fakeIssue({ labelIds: [] }));
      sdk.issueLabels.mockResolvedValue({ nodes: [] });
      sdk.createIssueLabel.mockResolvedValue({
        issueLabel: Promise.resolve({ id: "label-new" }),
      });
      sdk.updateIssue.mockResolvedValue({});

      await client.addLabel("issue-1", "brand-new");

      expect(sdk.createIssueLabel).toHaveBeenCalledWith({
        name: "brand-new",
        teamId: "team-1",
      });
      expect(sdk.updateIssue).toHaveBeenCalledWith("issue-1", { labelIds: ["label-new"] });
    });

    it("does not duplicate a label id already present on the issue", async () => {
      const { client, sdk } = makeClient();
      sdk.issue.mockResolvedValue(fakeIssue({ labelIds: ["label-a"] }));
      sdk.issueLabels.mockResolvedValue({ nodes: [{ id: "label-a", name: "bug" }] });

      await client.addLabel("issue-1", "bug");

      expect(sdk.updateIssue).not.toHaveBeenCalled();
    });

    it("throws when label creation does not return an issueLabel", async () => {
      const { client, sdk } = makeClient();
      sdk.issue.mockResolvedValue(fakeIssue({ labelIds: [] }));
      sdk.issueLabels.mockResolvedValue({ nodes: [] });
      sdk.createIssueLabel.mockResolvedValue({ issueLabel: Promise.resolve(null) });

      await expect(client.addLabel("issue-1", "brand-new")).rejects.toThrow(
        /Failed to create label: brand-new/,
      );
    });
  });

  describe("removeLabel", () => {
    it("looks up the label id by name and removes it when not cached", async () => {
      const { client, sdk } = makeClient();
      sdk.issue.mockResolvedValue(
        fakeIssue({
          labelIds: ["label-a", "label-b"],
          labels: vi.fn().mockResolvedValue({
            nodes: [
              { id: "label-a", name: "bug" },
              { id: "label-b", name: "urgent" },
            ],
          }),
        }),
      );
      sdk.updateIssue.mockResolvedValue({});

      await client.removeLabel("issue-1", "urgent");

      expect(sdk.updateIssue).toHaveBeenCalledWith("issue-1", { labelIds: ["label-a"] });
    });

    it("does nothing when the named label is not found on the issue", async () => {
      const { client, sdk } = makeClient();
      sdk.issue.mockResolvedValue(
        fakeIssue({ labels: vi.fn().mockResolvedValue({ nodes: [] }) }),
      );

      await client.removeLabel("issue-1", "missing");

      expect(sdk.updateIssue).not.toHaveBeenCalled();
    });

    it("uses the label cache on a subsequent removal instead of calling labels() again", async () => {
      const { client, sdk } = makeClient();
      const labelsFn = vi
        .fn()
        .mockResolvedValue({ nodes: [{ id: "label-a", name: "bug" }] });
      sdk.issue.mockResolvedValue(fakeIssue({ labelIds: ["label-a"], labels: labelsFn }));
      sdk.updateIssue.mockResolvedValue({});

      // First call populates the cache via listLabels.
      await client.listLabels("issue-1");
      await client.removeLabel("issue-1", "bug");

      expect(labelsFn).toHaveBeenCalledTimes(1);
      expect(sdk.updateIssue).toHaveBeenCalledWith("issue-1", { labelIds: [] });
    });
  });

  describe("listLabels", () => {
    it("returns label names and populates the label cache", async () => {
      const { client, sdk } = makeClient();
      sdk.issue.mockResolvedValue(
        fakeIssue({
          labels: vi.fn().mockResolvedValue({ nodes: [{ id: "label-a", name: "bug" }] }),
        }),
      );

      const names = await client.listLabels("issue-1");

      expect(names).toEqual(["bug"]);
    });

    it("returns an empty array when the issue has no labels connection", async () => {
      const { client, sdk } = makeClient();
      sdk.issue.mockResolvedValue(fakeIssue({ labels: vi.fn().mockResolvedValue(null) }));

      const names = await client.listLabels("issue-1");

      expect(names).toEqual([]);
    });
  });
});
