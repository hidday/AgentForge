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

interface FakeSdk {
  issue: ReturnType<typeof vi.fn>;
  issues: ReturnType<typeof vi.fn>;
  team: ReturnType<typeof vi.fn>;
  createComment: ReturnType<typeof vi.fn>;
  updateIssue: ReturnType<typeof vi.fn>;
  issueLabels: ReturnType<typeof vi.fn>;
  createIssueLabel: ReturnType<typeof vi.fn>;
}

function makeFakeSdk(): FakeSdk {
  return {
    issue: vi.fn(),
    issues: vi.fn(),
    team: vi.fn(),
    createComment: vi.fn(),
    updateIssue: vi.fn(),
    issueLabels: vi.fn(),
    createIssueLabel: vi.fn(),
  };
}

function buildClient(): { client: RealLinearClient; sdk: FakeSdk; logger: ReturnType<typeof makeLogger> } {
  const logger = makeLogger();
  const client = new RealLinearClient("test-key", logger as never);
  const sdk = makeFakeSdk();
  (client as unknown as { sdk: FakeSdk }).sdk = sdk;
  return { client, sdk, logger };
}

function makeFakeIssue(overrides: Record<string, unknown> = {}) {
  return {
    id: "issue-1",
    identifier: "PRY-1",
    title: "Issue title",
    description: "Issue description",
    branchName: "ai/issue-1",
    priority: 1,
    url: "https://linear.app/team/issue/PRY-1",
    labelIds: [],
    labels: () => Promise.resolve({ nodes: [] }),
    state: Promise.resolve({ id: "state-1", name: "Todo" }),
    project: Promise.resolve(null),
    cycle: Promise.resolve(null),
    team: Promise.resolve({ id: "team-1", key: "PRY" }),
    ...overrides,
  };
}

describe("RealLinearClient", () => {
  describe("getIssue", () => {
    it("maps an SDK issue (with project/cycle/team) into a LinearIssue", async () => {
      const { client, sdk } = buildClient();
      const fakeIssue = makeFakeIssue({
        labels: () => Promise.resolve({ nodes: [{ id: "l1", name: "bug" }] }),
        project: Promise.resolve({ name: "Project A" }),
        cycle: Promise.resolve({ name: "Cycle 3" }),
      });
      sdk.issue.mockResolvedValue(fakeIssue);

      const issue = await client.getIssue("issue-1");

      expect(issue).toEqual({
        id: "issue-1",
        identifier: "PRY-1",
        title: "Issue title",
        description: "Issue description",
        branchName: "ai/issue-1",
        state: "Todo",
        labels: ["bug"],
        priority: 1,
        url: "https://linear.app/team/issue/PRY-1",
        project: "Project A",
        team: "PRY",
        cycle: "Cycle 3",
      });
    });

    it("defaults missing description, state, project, team, and cycle", async () => {
      const { client, sdk } = buildClient();
      const fakeIssue = makeFakeIssue({
        description: null,
        state: Promise.resolve(null),
        project: Promise.resolve(null),
        cycle: Promise.resolve(null),
        team: Promise.resolve(null),
      });
      sdk.issue.mockResolvedValue(fakeIssue);

      const issue = await client.getIssue("issue-1");

      expect(issue.description).toBe("");
      expect(issue.state).toBe("Unknown");
      expect(issue.project).toBeUndefined();
      expect(issue.team).toBeUndefined();
      expect(issue.cycle).toBeUndefined();
    });

    it("defaults labels to an empty array when labelsConn.nodes is missing", async () => {
      const { client, sdk } = buildClient();
      const fakeIssue = makeFakeIssue({ labels: () => Promise.resolve({ nodes: undefined }) });
      sdk.issue.mockResolvedValue(fakeIssue);

      const issue = await client.getIssue("issue-1");

      expect(issue.labels).toEqual([]);
    });
  });

  describe("searchIssues", () => {
    it("builds a GraphQL filter from projectName, assigneeMe, and team, and maps results", async () => {
      const { client, sdk } = buildClient();
      const resultIssue = makeFakeIssue({
        id: "r1",
        labels: () => Promise.resolve({ nodes: [{ id: "l1", name: "infra" }] }),
        project: Promise.resolve({ name: "Project A" }),
        cycle: Promise.resolve({ name: "Cycle 1" }),
        team: Promise.resolve({ id: "team-1", key: "ENG" }),
      });
      sdk.issues.mockResolvedValue({ nodes: [resultIssue] });

      const results = await client.searchIssues({
        state: "Todo",
        projectName: "Project A",
        assigneeMe: true,
        team: "ENG",
      });

      expect(sdk.issues).toHaveBeenCalledWith({
        filter: {
          state: { name: { eq: "Todo" } },
          project: { name: { eq: "Project A" } },
          assignee: { isMe: { eq: true } },
          team: { or: [{ name: { eq: "ENG" } }, { key: { eq: "ENG" } }] },
        },
      });
      expect(results).toEqual([
        {
          id: "r1",
          identifier: "PRY-1",
          title: "Issue title",
          description: "Issue description",
          branchName: "ai/issue-1",
          state: "Todo",
          labels: ["infra"],
          priority: 1,
          url: "https://linear.app/team/issue/PRY-1",
          project: "Project A",
          team: "ENG",
          cycle: "Cycle 1",
        },
      ]);
    });

    it("uses only the state filter when no optional filters are given", async () => {
      const { client, sdk } = buildClient();
      sdk.issues.mockResolvedValue({ nodes: [] });

      const results = await client.searchIssues({ state: "Done" });

      expect(sdk.issues).toHaveBeenCalledWith({ filter: { state: { name: { eq: "Done" } } } });
      expect(results).toEqual([]);
    });

    it("returns an empty array when issuesConn is nullish", async () => {
      const { client, sdk } = buildClient();
      sdk.issues.mockResolvedValue(null);

      const results = await client.searchIssues({ state: "Done" });

      expect(results).toEqual([]);
    });
  });

  describe("postComment", () => {
    it("creates a comment via the SDK", async () => {
      const { client, sdk } = buildClient();
      sdk.createComment.mockResolvedValue({});

      await client.postComment("issue-1", "hello world");

      expect(sdk.createComment).toHaveBeenCalledWith({ issueId: "issue-1", body: "hello world" });
    });
  });

  describe("updateIssueState", () => {
    it("resolves the workflow state id and updates the issue", async () => {
      const { client, sdk } = buildClient();
      const fakeIssue = makeFakeIssue({ team: Promise.resolve({ id: "team-1", key: "PRY" }) });
      sdk.issue.mockResolvedValue(fakeIssue);
      sdk.team.mockResolvedValue({
        states: () =>
          Promise.resolve({ nodes: [{ id: "state-todo", name: "Todo" }, { id: "state-done", name: "Done" }] }),
      });
      sdk.updateIssue.mockResolvedValue({});

      await client.updateIssueState("issue-1", "Done");

      expect(sdk.updateIssue).toHaveBeenCalledWith("issue-1", { stateId: "state-done" });
    });

    it("caches the team's state map across repeated calls (team() fetched only once)", async () => {
      const { client, sdk } = buildClient();
      const fakeIssue = makeFakeIssue({ team: Promise.resolve({ id: "team-1", key: "PRY" }) });
      sdk.issue.mockResolvedValue(fakeIssue);
      const statesFn = vi.fn().mockResolvedValue({ nodes: [{ id: "state-todo", name: "Todo" }] });
      sdk.team.mockResolvedValue({ states: statesFn });
      sdk.updateIssue.mockResolvedValue({});

      await client.updateIssueState("issue-1", "Todo");
      await client.updateIssueState("issue-1", "Todo");

      expect(sdk.team).toHaveBeenCalledTimes(1);
    });

    it("warns and does nothing when the issue has no team", async () => {
      const { client, sdk, logger } = buildClient();
      const fakeIssue = makeFakeIssue({ team: Promise.resolve(null) });
      sdk.issue.mockResolvedValue(fakeIssue);

      await client.updateIssueState("issue-1", "Done");

      expect(sdk.updateIssue).not.toHaveBeenCalled();
      expect(logger.warn).toHaveBeenCalledWith(
        { issueId: "issue-1" },
        "Cannot update state: issue has no team",
      );
    });

    it("warns and does nothing when the state name cannot be resolved", async () => {
      const { client, sdk, logger } = buildClient();
      const fakeIssue = makeFakeIssue({ team: Promise.resolve({ id: "team-1", key: "PRY" }) });
      sdk.issue.mockResolvedValue(fakeIssue);
      sdk.team.mockResolvedValue({ states: () => Promise.resolve({ nodes: [] }) });

      await client.updateIssueState("issue-1", "Nonexistent");

      expect(sdk.updateIssue).not.toHaveBeenCalled();
      expect(logger.warn).toHaveBeenCalledWith(
        { issueId: "issue-1", stateName: "Nonexistent", teamId: "team-1" },
        "Could not find workflow state by name",
      );
    });

    it("treats a missing states().nodes as empty", async () => {
      const { client, sdk } = buildClient();
      const fakeIssue = makeFakeIssue({ team: Promise.resolve({ id: "team-1", key: "PRY" }) });
      sdk.issue.mockResolvedValue(fakeIssue);
      sdk.team.mockResolvedValue({ states: () => Promise.resolve({ nodes: undefined }) });

      await client.updateIssueState("issue-1", "Todo");

      expect(sdk.updateIssue).not.toHaveBeenCalled();
    });
  });

  describe("addLabel", () => {
    it("creates a new label via the team and adds it to the issue's labelIds", async () => {
      const { client, sdk } = buildClient();
      const fakeIssue = makeFakeIssue({
        labelIds: ["existing-id"],
        team: Promise.resolve({ id: "team-1", key: "PRY" }),
      });
      sdk.issue.mockResolvedValue(fakeIssue);
      sdk.issueLabels.mockResolvedValue({ nodes: [] });
      sdk.createIssueLabel.mockResolvedValue({ issueLabel: Promise.resolve({ id: "new-label-id" }) });
      sdk.updateIssue.mockResolvedValue({});

      await client.addLabel("issue-1", "urgent");

      expect(sdk.createIssueLabel).toHaveBeenCalledWith({ name: "urgent", teamId: "team-1" });
      expect(sdk.updateIssue).toHaveBeenCalledWith("issue-1", {
        labelIds: ["existing-id", "new-label-id"],
      });
    });

    it("creates a label without a teamId when the issue has no team", async () => {
      const { client, sdk } = buildClient();
      const fakeIssue = makeFakeIssue({ labelIds: [], team: Promise.resolve(null) });
      sdk.issue.mockResolvedValue(fakeIssue);
      sdk.issueLabels.mockResolvedValue({ nodes: [] });
      sdk.createIssueLabel.mockResolvedValue({ issueLabel: Promise.resolve({ id: "new-label-id" }) });
      sdk.updateIssue.mockResolvedValue({});

      await client.addLabel("issue-1", "urgent");

      expect(sdk.createIssueLabel).toHaveBeenCalledWith({ name: "urgent" });
    });

    it("reuses an existing label found via issueLabels instead of creating one", async () => {
      const { client, sdk } = buildClient();
      const fakeIssue = makeFakeIssue({ labelIds: [], team: Promise.resolve({ id: "team-1", key: "PRY" }) });
      sdk.issue.mockResolvedValue(fakeIssue);
      sdk.issueLabels.mockResolvedValue({ nodes: [{ id: "existing-label-id", name: "urgent" }] });
      sdk.updateIssue.mockResolvedValue({});

      await client.addLabel("issue-1", "urgent");

      expect(sdk.createIssueLabel).not.toHaveBeenCalled();
      expect(sdk.updateIssue).toHaveBeenCalledWith("issue-1", { labelIds: ["existing-label-id"] });
    });

    it("does not update the issue when it already has the resolved label id", async () => {
      const { client, sdk } = buildClient();
      const fakeIssue = makeFakeIssue({
        labelIds: ["existing-label-id"],
        team: Promise.resolve({ id: "team-1", key: "PRY" }),
      });
      sdk.issue.mockResolvedValue(fakeIssue);
      sdk.issueLabels.mockResolvedValue({ nodes: [{ id: "existing-label-id", name: "urgent" }] });

      await client.addLabel("issue-1", "urgent");

      expect(sdk.updateIssue).not.toHaveBeenCalled();
    });

    it("throws if label creation returns no issueLabel", async () => {
      const { client, sdk } = buildClient();
      const fakeIssue = makeFakeIssue({ labelIds: [], team: Promise.resolve({ id: "team-1", key: "PRY" }) });
      sdk.issue.mockResolvedValue(fakeIssue);
      sdk.issueLabels.mockResolvedValue({ nodes: [] });
      sdk.createIssueLabel.mockResolvedValue({ issueLabel: Promise.resolve(null) });

      await expect(client.addLabel("issue-1", "urgent")).rejects.toThrow(
        "Failed to create label: urgent",
      );
    });

    it("caches a resolved label id across repeated addLabel calls (issueLabels queried only once)", async () => {
      const { client, sdk } = buildClient();
      sdk.issue
        .mockResolvedValueOnce(
          makeFakeIssue({ labelIds: [], team: Promise.resolve({ id: "team-1", key: "PRY" }) }),
        )
        .mockResolvedValueOnce(
          makeFakeIssue({ labelIds: ["existing-label-id"], team: Promise.resolve({ id: "team-1", key: "PRY" }) }),
        );
      sdk.issueLabels.mockResolvedValue({ nodes: [{ id: "existing-label-id", name: "urgent" }] });
      sdk.updateIssue.mockResolvedValue({});

      await client.addLabel("issue-1", "urgent");
      await client.addLabel("issue-1", "urgent");

      expect(sdk.issueLabels).toHaveBeenCalledTimes(1);
    });
  });

  describe("removeLabel", () => {
    it("removes a label resolved via the issue's labels() when not cached", async () => {
      const { client, sdk } = buildClient();
      const fakeIssue = makeFakeIssue({
        labelIds: ["label-a", "label-b"],
        labels: () =>
          Promise.resolve({
            nodes: [
              { id: "label-a", name: "urgent" },
              { id: "label-b", name: "other" },
            ],
          }),
      });
      sdk.issue.mockResolvedValue(fakeIssue);
      sdk.updateIssue.mockResolvedValue({});

      await client.removeLabel("issue-1", "urgent");

      expect(sdk.updateIssue).toHaveBeenCalledWith("issue-1", { labelIds: ["label-b"] });
    });

    it("does nothing when the label name is not found on the issue", async () => {
      const { client, sdk } = buildClient();
      const fakeIssue = makeFakeIssue({
        labelIds: ["label-b"],
        labels: () => Promise.resolve({ nodes: [{ id: "label-b", name: "other" }] }),
      });
      sdk.issue.mockResolvedValue(fakeIssue);

      await client.removeLabel("issue-1", "missing-label");

      expect(sdk.updateIssue).not.toHaveBeenCalled();
    });

    it("uses the cached label id on a subsequent call instead of calling labels() again", async () => {
      const { client, sdk } = buildClient();
      const labelsFn = vi.fn().mockResolvedValue({
        nodes: [{ id: "label-a", name: "urgent" }],
      });
      sdk.issue.mockResolvedValue(
        makeFakeIssue({ labelIds: ["label-a"], labels: labelsFn }),
      );
      sdk.updateIssue.mockResolvedValue({});

      await client.removeLabel("issue-1", "urgent");
      await client.removeLabel("issue-1", "urgent");

      expect(labelsFn).toHaveBeenCalledTimes(1);
      expect(sdk.updateIssue).toHaveBeenCalledTimes(2);
    });
  });

  describe("listLabels", () => {
    it("returns label names and populates the label cache", async () => {
      const { client, sdk } = buildClient();
      const fakeIssue = makeFakeIssue({
        labels: () =>
          Promise.resolve({ nodes: [{ id: "l1", name: "bug" }, { id: "l2", name: "urgent" }] }),
      });
      sdk.issue.mockResolvedValue(fakeIssue);

      const names = await client.listLabels("issue-1");

      expect(names).toEqual(["bug", "urgent"]);

      // The cache populated by listLabels should let removeLabel skip re-fetching labels().
      sdk.updateIssue.mockResolvedValue({});
      const issueForRemove = makeFakeIssue({
        labelIds: ["l1", "l2"],
        labels: () => Promise.reject(new Error("should not be called again")),
      });
      sdk.issue.mockResolvedValue(issueForRemove);

      await client.removeLabel("issue-1", "bug");
      expect(sdk.updateIssue).toHaveBeenCalledWith("issue-1", { labelIds: ["l2"] });
    });

    it("returns an empty array when there are no labels", async () => {
      const { client, sdk } = buildClient();
      sdk.issue.mockResolvedValue(makeFakeIssue({ labels: () => Promise.resolve({ nodes: [] }) }));

      await expect(client.listLabels("issue-1")).resolves.toEqual([]);
    });
  });
});
