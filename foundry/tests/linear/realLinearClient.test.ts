import { describe, it, expect, vi, beforeEach } from "vitest";
import { RealLinearClient } from "../../src/linear/realLinearClient.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

function makeLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };
}

function makeFakeIssue(overrides: Any = {}): Any {
  return {
    id: "issue-1",
    identifier: "PRY-1",
    title: "Issue title",
    description: "Issue description",
    branchName: "ai/issue-1",
    priority: 1,
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

function makeFakeSdk(overrides: Any = {}): Any {
  return {
    issue: vi.fn(),
    issues: vi.fn(),
    team: vi.fn(),
    updateIssue: vi.fn().mockResolvedValue(undefined),
    createComment: vi.fn().mockResolvedValue(undefined),
    issueLabels: vi.fn(),
    createIssueLabel: vi.fn(),
    ...overrides,
  };
}

function install(client: RealLinearClient, sdk: Any): void {
  (client as unknown as { sdk: Any }).sdk = sdk;
}

describe("RealLinearClient", () => {
  let logger: ReturnType<typeof makeLogger>;
  let client: RealLinearClient;

  beforeEach(() => {
    logger = makeLogger();
    client = new RealLinearClient("test-key", logger as Any);
  });

  describe("getIssue", () => {
    it("maps a fully-populated SDK issue to a LinearIssue, calling sdk.issue with the id", async () => {
      const sdk = makeFakeSdk({
        issue: vi.fn().mockResolvedValue(
          makeFakeIssue({
            labels: () => Promise.resolve({ nodes: [{ id: "l1", name: "bug" }] }),
            state: Promise.resolve({ id: "s1", name: "In Progress" }),
            project: Promise.resolve({ id: "p1", name: "Project A" }),
            cycle: Promise.resolve({ id: "c1", name: "Cycle 3" }),
            team: Promise.resolve({ id: "team-1", key: "PRY" }),
          }),
        ),
      });
      install(client, sdk);

      const result = await client.getIssue("issue-1");

      expect(sdk.issue).toHaveBeenCalledWith("issue-1");
      expect(result).toEqual({
        id: "issue-1",
        identifier: "PRY-1",
        title: "Issue title",
        description: "Issue description",
        branchName: "ai/issue-1",
        state: "In Progress",
        labels: ["bug"],
        priority: 1,
        url: "https://linear.app/team/issue/PRY-1",
        project: "Project A",
        team: "PRY",
        cycle: "Cycle 3",
      });
    });

    it("falls back to defaults when state/project/cycle/team/description/labels are absent", async () => {
      const sdk = makeFakeSdk({
        issue: vi.fn().mockResolvedValue(
          makeFakeIssue({
            description: null,
            state: Promise.resolve(null),
            project: Promise.resolve(null),
            cycle: Promise.resolve(null),
            team: Promise.resolve(null),
            labels: () => Promise.resolve(undefined),
          }),
        ),
      });
      install(client, sdk);

      const result = await client.getIssue("issue-1");

      expect(result.description).toBe("");
      expect(result.state).toBe("Unknown");
      expect(result.project).toBeUndefined();
      expect(result.team).toBeUndefined();
      expect(result.cycle).toBeUndefined();
      expect(result.labels).toEqual([]);
    });
  });

  describe("searchIssues", () => {
    it("builds a minimal GraphQL filter when only state is given, and maps results", async () => {
      const node1 = makeFakeIssue({
        id: "a",
        identifier: "PRY-10",
        labels: () => Promise.resolve({ nodes: [{ id: "l1", name: "bug" }] }),
        project: Promise.resolve({ id: "p1", name: "Project A" }),
        cycle: Promise.resolve({ id: "c1", name: "Cycle 1" }),
        team: Promise.resolve({ id: "t1", key: "PRY" }),
      });
      const sdk = makeFakeSdk({
        issues: vi.fn().mockResolvedValue({ nodes: [node1] }),
      });
      install(client, sdk);

      const results = await client.searchIssues({ state: "Todo" });

      expect(sdk.issues).toHaveBeenCalledWith({ filter: { state: { name: { eq: "Todo" } } } });
      expect(results).toEqual([
        {
          id: "a",
          identifier: "PRY-10",
          title: "Issue title",
          description: "Issue description",
          branchName: "ai/issue-1",
          state: "Todo",
          labels: ["bug"],
          priority: 1,
          url: "https://linear.app/team/issue/PRY-1",
          project: "Project A",
          team: "PRY",
          cycle: "Cycle 1",
        },
      ]);
      expect(logger.info).toHaveBeenCalledWith(
        {
          projectName: undefined,
          assigneeMe: undefined,
          team: undefined,
          stateName: "Todo",
          count: 1,
        },
        "Searched Linear issues",
      );
    });

    it("includes project, assignee and team(or-key) filters when provided", async () => {
      const sdk = makeFakeSdk({ issues: vi.fn().mockResolvedValue({ nodes: [] }) });
      install(client, sdk);

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

    it("returns an empty array and logs a zero count when the connection has no nodes", async () => {
      const sdk = makeFakeSdk({ issues: vi.fn().mockResolvedValue(undefined) });
      install(client, sdk);

      const results = await client.searchIssues({ state: "Todo" });

      expect(results).toEqual([]);
      expect(logger.info).toHaveBeenCalledWith(expect.objectContaining({ count: 0 }), expect.any(String));
    });

    it("defaults labels/project/cycle/team to empty/undefined when absent on a result node", async () => {
      const node = makeFakeIssue({
        id: "a",
        labels: () => Promise.resolve({ nodes: undefined }),
        project: Promise.resolve(null),
        cycle: Promise.resolve(null),
        team: Promise.resolve(null),
      });
      const sdk = makeFakeSdk({ issues: vi.fn().mockResolvedValue({ nodes: [node] }) });
      install(client, sdk);

      const results = await client.searchIssues({ state: "Todo" });

      expect(results[0].labels).toEqual([]);
      expect(results[0].project).toBeUndefined();
      expect(results[0].cycle).toBeUndefined();
      expect(results[0].team).toBeUndefined();
    });

    it("treats a null description on a result node as an empty string", async () => {
      const node = makeFakeIssue({ id: "a", description: null });
      const sdk = makeFakeSdk({ issues: vi.fn().mockResolvedValue({ nodes: [node] }) });
      install(client, sdk);

      const results = await client.searchIssues({ state: "Todo" });

      expect(results[0].description).toBe("");
    });
  });

  describe("postComment", () => {
    it("creates a comment via the SDK and logs it", async () => {
      const sdk = makeFakeSdk();
      install(client, sdk);

      await client.postComment("issue-1", "Hello world");

      expect(sdk.createComment).toHaveBeenCalledWith({ issueId: "issue-1", body: "Hello world" });
      expect(logger.debug).toHaveBeenCalledWith(
        { issueId: "issue-1" },
        "Posted comment to Linear issue",
      );
    });

    it("propagates an error thrown by the SDK", async () => {
      const sdk = makeFakeSdk({
        createComment: vi.fn().mockRejectedValue(new Error("network down")),
      });
      install(client, sdk);

      await expect(client.postComment("issue-1", "Hello")).rejects.toThrow("network down");
    });
  });

  describe("updateIssueState", () => {
    it("warns and does nothing when the issue has no team", async () => {
      const sdk = makeFakeSdk({
        issue: vi.fn().mockResolvedValue(makeFakeIssue({ team: Promise.resolve(null) })),
      });
      install(client, sdk);

      await client.updateIssueState("issue-1", "Done");

      expect(logger.warn).toHaveBeenCalledWith(
        { issueId: "issue-1" },
        "Cannot update state: issue has no team",
      );
      expect(sdk.updateIssue).not.toHaveBeenCalled();
      expect(sdk.team).not.toHaveBeenCalled();
    });

    it("warns and does nothing when the workflow state name cannot be resolved", async () => {
      const sdk = makeFakeSdk({
        issue: vi.fn().mockResolvedValue(makeFakeIssue({ team: Promise.resolve({ id: "team-1", key: "PRY" }) })),
        team: vi.fn().mockResolvedValue({
          states: () => Promise.resolve({ nodes: [{ id: "s-todo", name: "Todo" }] }),
        }),
      });
      install(client, sdk);

      await client.updateIssueState("issue-1", "Nonexistent");

      expect(logger.warn).toHaveBeenCalledWith(
        { issueId: "issue-1", stateName: "Nonexistent", teamId: "team-1" },
        "Could not find workflow state by name",
      );
      expect(sdk.updateIssue).not.toHaveBeenCalled();
    });

    it("resolves the state id and updates the issue", async () => {
      const sdk = makeFakeSdk({
        issue: vi.fn().mockResolvedValue(makeFakeIssue({ team: Promise.resolve({ id: "team-1", key: "PRY" }) })),
        team: vi.fn().mockResolvedValue({
          states: () =>
            Promise.resolve({
              nodes: [
                { id: "s-todo", name: "Todo" },
                { id: "s-done", name: "Done" },
              ],
            }),
        }),
      });
      install(client, sdk);

      await client.updateIssueState("issue-1", "Done");

      expect(sdk.updateIssue).toHaveBeenCalledWith("issue-1", { stateId: "s-done" });
      expect(logger.debug).toHaveBeenCalledWith(
        { issueId: "issue-1", stateName: "Done", stateId: "s-done" },
        "Updated Linear issue state",
      );
    });

    it("treats an undefined states nodes list as empty and fails to resolve the state", async () => {
      const sdk = makeFakeSdk({
        issue: vi.fn().mockResolvedValue(makeFakeIssue({ team: Promise.resolve({ id: "team-1", key: "PRY" }) })),
        team: vi.fn().mockResolvedValue({ states: () => Promise.resolve({ nodes: undefined }) }),
      });
      install(client, sdk);

      await client.updateIssueState("issue-1", "Done");

      expect(logger.warn).toHaveBeenCalledWith(
        { issueId: "issue-1", stateName: "Done", teamId: "team-1" },
        "Could not find workflow state by name",
      );
      expect(sdk.updateIssue).not.toHaveBeenCalled();
    });

    it("caches resolved team states so a second update for the same team does not refetch", async () => {
      const statesFn = vi.fn().mockResolvedValue({
        nodes: [
          { id: "s-todo", name: "Todo" },
          { id: "s-done", name: "Done" },
        ],
      });
      const sdk = makeFakeSdk({
        issue: vi.fn().mockResolvedValue(makeFakeIssue({ team: Promise.resolve({ id: "team-1", key: "PRY" }) })),
        team: vi.fn().mockResolvedValue({ states: statesFn }),
      });
      install(client, sdk);

      await client.updateIssueState("issue-1", "Todo");
      await client.updateIssueState("issue-1", "Done");

      expect(sdk.team).toHaveBeenCalledTimes(1);
      expect(statesFn).toHaveBeenCalledTimes(1);
    });
  });

  describe("addLabel", () => {
    it("creates a new label via the SDK when none exists and adds it to the issue", async () => {
      const issue = makeFakeIssue({ labelIds: [] });
      const sdk = makeFakeSdk({
        issue: vi.fn().mockResolvedValue(issue),
        issueLabels: vi.fn().mockResolvedValue({ nodes: [] }),
        createIssueLabel: vi.fn().mockResolvedValue({
          issueLabel: Promise.resolve({ id: "label-new", name: "bug" }),
        }),
      });
      install(client, sdk);

      await client.addLabel("issue-1", "bug");

      expect(sdk.issueLabels).toHaveBeenCalledWith({ filter: { name: { eq: "bug" } } });
      expect(sdk.createIssueLabel).toHaveBeenCalledWith({ name: "bug", teamId: "team-1" });
      expect(sdk.updateIssue).toHaveBeenCalledWith("issue-1", { labelIds: ["label-new"] });
      expect(logger.info).toHaveBeenCalledWith(
        { labelName: "bug", labelId: "label-new" },
        "Created new Linear label",
      );
    });

    it("omits teamId when the issue has no team", async () => {
      const issue = makeFakeIssue({ labelIds: [], team: Promise.resolve(null) });
      const sdk = makeFakeSdk({
        issue: vi.fn().mockResolvedValue(issue),
        issueLabels: vi.fn().mockResolvedValue({ nodes: [] }),
        createIssueLabel: vi.fn().mockResolvedValue({
          issueLabel: Promise.resolve({ id: "label-new", name: "bug" }),
        }),
      });
      install(client, sdk);

      await client.addLabel("issue-1", "bug");

      expect(sdk.createIssueLabel).toHaveBeenCalledWith({ name: "bug" });
    });

    it("reuses an existing label found via issueLabels without creating a new one", async () => {
      const issue = makeFakeIssue({ labelIds: [] });
      const sdk = makeFakeSdk({
        issue: vi.fn().mockResolvedValue(issue),
        issueLabels: vi.fn().mockResolvedValue({ nodes: [{ id: "label-existing", name: "bug" }] }),
      });
      install(client, sdk);

      await client.addLabel("issue-1", "bug");

      expect(sdk.createIssueLabel).not.toHaveBeenCalled();
      expect(sdk.updateIssue).toHaveBeenCalledWith("issue-1", { labelIds: ["label-existing"] });
    });

    it("does not call updateIssue when the label is already on the issue", async () => {
      const issue = makeFakeIssue({ labelIds: ["label-existing"] });
      const sdk = makeFakeSdk({
        issue: vi.fn().mockResolvedValue(issue),
        issueLabels: vi.fn().mockResolvedValue({ nodes: [{ id: "label-existing", name: "bug" }] }),
      });
      install(client, sdk);

      await client.addLabel("issue-1", "bug");

      expect(sdk.updateIssue).not.toHaveBeenCalled();
      expect(logger.debug).toHaveBeenCalledWith(
        { issueId: "issue-1", labelName: "bug", labelId: "label-existing" },
        "Added label to Linear issue",
      );
    });

    it("caches a resolved label id across calls so issueLabels is not re-queried", async () => {
      const issueA = makeFakeIssue({ id: "issue-a", labelIds: [] });
      const issueB = makeFakeIssue({ id: "issue-b", labelIds: [] });
      const sdk = makeFakeSdk({
        issue: vi
          .fn()
          .mockResolvedValueOnce(issueA)
          .mockResolvedValueOnce(issueB),
        issueLabels: vi.fn().mockResolvedValue({ nodes: [{ id: "label-cached", name: "bug" }] }),
      });
      install(client, sdk);

      await client.addLabel("issue-a", "bug");
      await client.addLabel("issue-b", "bug");

      expect(sdk.issueLabels).toHaveBeenCalledTimes(1);
      expect(sdk.updateIssue).toHaveBeenNthCalledWith(2, "issue-b", { labelIds: ["label-cached"] });
    });

    it("throws when label creation succeeds but returns no issueLabel payload", async () => {
      const issue = makeFakeIssue({ labelIds: [] });
      const sdk = makeFakeSdk({
        issue: vi.fn().mockResolvedValue(issue),
        issueLabels: vi.fn().mockResolvedValue({ nodes: [] }),
        createIssueLabel: vi.fn().mockResolvedValue({ issueLabel: Promise.resolve(undefined) }),
      });
      install(client, sdk);

      await expect(client.addLabel("issue-1", "ghost")).rejects.toThrow(
        "Failed to create label: ghost",
      );
    });
  });

  describe("removeLabel", () => {
    it("removes a label found via issue.labels() and caches its id", async () => {
      const labelsFn = vi.fn().mockResolvedValue({ nodes: [{ id: "label-1", name: "bug" }] });
      const issue = makeFakeIssue({ labelIds: ["label-1", "label-2"], labels: labelsFn });
      const sdk = makeFakeSdk({ issue: vi.fn().mockResolvedValue(issue) });
      install(client, sdk);

      await client.removeLabel("issue-1", "bug");

      expect(sdk.updateIssue).toHaveBeenCalledWith("issue-1", { labelIds: ["label-2"] });
      expect(logger.debug).toHaveBeenCalledWith(
        { issueId: "issue-1", labelName: "bug" },
        "Removed label from Linear issue",
      );
    });

    it("is a no-op when the label is not found among the issue's labels", async () => {
      const labelsFn = vi.fn().mockResolvedValue({ nodes: [{ id: "label-1", name: "other" }] });
      const issue = makeFakeIssue({ labelIds: ["label-1"], labels: labelsFn });
      const sdk = makeFakeSdk({ issue: vi.fn().mockResolvedValue(issue) });
      install(client, sdk);

      await client.removeLabel("issue-1", "bug");

      expect(sdk.updateIssue).not.toHaveBeenCalled();
    });

    it("uses the cached label id on a later call instead of calling issue.labels() again", async () => {
      const labelsFn = vi.fn().mockResolvedValue({ nodes: [{ id: "label-1", name: "bug" }] });
      const issueA = makeFakeIssue({ id: "issue-a", labelIds: ["label-1"], labels: labelsFn });
      const issueB = makeFakeIssue({ id: "issue-b", labelIds: ["label-1", "label-3"], labels: labelsFn });
      const sdk = makeFakeSdk({
        issue: vi
          .fn()
          .mockResolvedValueOnce(issueA)
          .mockResolvedValueOnce(issueB),
      });
      install(client, sdk);

      await client.removeLabel("issue-a", "bug");
      await client.removeLabel("issue-b", "bug");

      expect(labelsFn).toHaveBeenCalledTimes(1);
      expect(sdk.updateIssue).toHaveBeenNthCalledWith(2, "issue-b", { labelIds: ["label-3"] });
    });
  });

  describe("listLabels", () => {
    it("returns label names and populates the label cache for reuse by removeLabel", async () => {
      const labelsFn = vi.fn().mockResolvedValue({ nodes: [{ id: "label-1", name: "bug" }] });
      const listIssue = makeFakeIssue({ id: "issue-1", labels: labelsFn });
      const removeIssue = makeFakeIssue({ id: "issue-1", labelIds: ["label-1"], labels: labelsFn });
      const sdk = makeFakeSdk({
        issue: vi
          .fn()
          .mockResolvedValueOnce(listIssue)
          .mockResolvedValueOnce(removeIssue),
      });
      install(client, sdk);

      const names = await client.listLabels("issue-1");
      expect(names).toEqual(["bug"]);

      await client.removeLabel("issue-1", "bug");

      expect(labelsFn).toHaveBeenCalledTimes(1);
      expect(sdk.updateIssue).toHaveBeenCalledWith("issue-1", { labelIds: [] });
    });

    it("returns an empty array when the labels connection has no nodes", async () => {
      const issue = makeFakeIssue({ labels: () => Promise.resolve(undefined) });
      const sdk = makeFakeSdk({ issue: vi.fn().mockResolvedValue(issue) });
      install(client, sdk);

      const names = await client.listLabels("issue-1");

      expect(names).toEqual([]);
    });
  });
});
