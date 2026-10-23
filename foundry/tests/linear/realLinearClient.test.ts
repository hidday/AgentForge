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

function makeFakeIssue(overrides: Record<string, unknown> = {}) {
  return {
    id: "issue-1",
    identifier: "ENG-1",
    title: "Issue title",
    description: "Issue description",
    branchName: "ai/issue-1",
    priority: 1,
    url: "https://linear.app/team/issue/ENG-1",
    labelIds: ["label-bug"],
    state: Promise.resolve({ id: "state-1", name: "Todo" }),
    project: Promise.resolve({ id: "proj-1", name: "Backend Platform" }),
    cycle: Promise.resolve({ id: "cycle-1", name: "Sprint 1" }),
    team: Promise.resolve({ id: "team-1", key: "ENG" }),
    labels: () => Promise.resolve({ nodes: [{ id: "label-bug", name: "bug" }] }),
    ...overrides,
  };
}

function makeSdk() {
  return {
    issue: vi.fn(),
    issues: vi.fn(),
    createComment: vi.fn(),
    updateIssue: vi.fn(),
    team: vi.fn(),
    issueLabels: vi.fn(),
    createIssueLabel: vi.fn(),
  };
}

type FakeSdk = ReturnType<typeof makeSdk>;

function injectSdk(client: RealLinearClient, sdk: FakeSdk): void {
  (client as unknown as { sdk: FakeSdk }).sdk = sdk;
}

describe("RealLinearClient", () => {
  let sdk: FakeSdk;
  let logger: ReturnType<typeof makeLogger>;
  let client: RealLinearClient;

  beforeEach(() => {
    sdk = makeSdk();
    logger = makeLogger();
    client = new RealLinearClient("test-key", logger as never);
    injectSdk(client, sdk);
  });

  describe("getIssue", () => {
    it("maps an SDK issue into a LinearIssue, resolving nested fields", async () => {
      sdk.issue.mockResolvedValue(makeFakeIssue());

      const issue = await client.getIssue("issue-1");

      expect(issue).toEqual({
        id: "issue-1",
        identifier: "ENG-1",
        title: "Issue title",
        description: "Issue description",
        branchName: "ai/issue-1",
        state: "Todo",
        labels: ["bug"],
        priority: 1,
        url: "https://linear.app/team/issue/ENG-1",
        project: "Backend Platform",
        team: "ENG",
        cycle: "Sprint 1",
      });
    });

    it("defaults description to empty string when null", async () => {
      sdk.issue.mockResolvedValue(makeFakeIssue({ description: null }));

      const issue = await client.getIssue("issue-1");

      expect(issue.description).toBe("");
    });

    it("defaults state to 'Unknown' and omits project/team/cycle when absent", async () => {
      sdk.issue.mockResolvedValue(
        makeFakeIssue({
          state: Promise.resolve(null),
          project: Promise.resolve(null),
          cycle: Promise.resolve(null),
          team: Promise.resolve(null),
          labels: () => Promise.resolve({ nodes: [] }),
        }),
      );

      const issue = await client.getIssue("issue-1");

      expect(issue.state).toBe("Unknown");
      expect(issue.project).toBeUndefined();
      expect(issue.team).toBeUndefined();
      expect(issue.cycle).toBeUndefined();
      expect(issue.labels).toEqual([]);
    });

    it("propagates a rejection when the issue cannot be fetched (e.g. not found)", async () => {
      sdk.issue.mockRejectedValue(new Error("Entity not found"));

      await expect(client.getIssue("missing")).rejects.toThrow("Entity not found");
    });
  });

  describe("searchIssues", () => {
    it("builds a GraphQL filter from state only and maps results", async () => {
      const fakeIssue = makeFakeIssue({ id: "issue-2", identifier: "ENG-2" });
      sdk.issues.mockResolvedValue({ nodes: [fakeIssue] });

      const results = await client.searchIssues({ state: "Todo" });

      expect(sdk.issues).toHaveBeenCalledWith({ filter: { state: { name: { eq: "Todo" } } } });
      expect(results).toEqual([
        {
          id: "issue-2",
          identifier: "ENG-2",
          title: "Issue title",
          description: "Issue description",
          branchName: "ai/issue-1",
          state: "Todo",
          labels: ["bug"],
          priority: 1,
          url: "https://linear.app/team/issue/ENG-1",
          project: "Backend Platform",
          team: "ENG",
          cycle: "Sprint 1",
        },
      ]);
    });

    it("adds projectName, assigneeMe, and team filters when provided", async () => {
      sdk.issues.mockResolvedValue({ nodes: [] });

      await client.searchIssues({
        state: "Todo",
        projectName: "Backend Platform",
        assigneeMe: true,
        team: "ENG",
      });

      expect(sdk.issues).toHaveBeenCalledWith({
        filter: {
          state: { name: { eq: "Todo" } },
          project: { name: { eq: "Backend Platform" } },
          assignee: { isMe: { eq: true } },
          team: { or: [{ name: { eq: "ENG" } }, { key: { eq: "ENG" } }] },
        },
      });
    });

    it("returns an empty array when there are no matching nodes", async () => {
      sdk.issues.mockResolvedValue({ nodes: [] });

      const results = await client.searchIssues({ state: "Done" });

      expect(results).toEqual([]);
    });

    it("tolerates an undefined issues connection", async () => {
      sdk.issues.mockResolvedValue(undefined);

      const results = await client.searchIssues({ state: "Done" });

      expect(results).toEqual([]);
    });

    it("propagates a rejection from the SDK", async () => {
      sdk.issues.mockRejectedValue(new Error("rate limited"));

      await expect(client.searchIssues({ state: "Todo" })).rejects.toThrow("rate limited");
    });
  });

  describe("postComment", () => {
    it("creates a comment via the SDK", async () => {
      sdk.createComment.mockResolvedValue({});

      await client.postComment("issue-1", "Nice work");

      expect(sdk.createComment).toHaveBeenCalledWith({ issueId: "issue-1", body: "Nice work" });
    });

    it("propagates a rejection from the SDK", async () => {
      sdk.createComment.mockRejectedValue(new Error("network error"));

      await expect(client.postComment("issue-1", "Nice work")).rejects.toThrow("network error");
    });
  });

  describe("updateIssueState", () => {
    it("resolves the state id for the issue's team and updates the issue", async () => {
      sdk.issue.mockResolvedValue(makeFakeIssue({ team: Promise.resolve({ id: "team-1", key: "ENG" }) }));
      sdk.team.mockResolvedValue({
        states: () =>
          Promise.resolve({ nodes: [{ id: "state-done", name: "Done" }] }),
      });
      sdk.updateIssue.mockResolvedValue({});

      await client.updateIssueState("issue-1", "Done");

      expect(sdk.updateIssue).toHaveBeenCalledWith("issue-1", { stateId: "state-done" });
    });

    it("caches the resolved state map across calls for the same team", async () => {
      sdk.issue.mockResolvedValue(makeFakeIssue());
      const statesFn = vi.fn().mockResolvedValue({ nodes: [{ id: "state-done", name: "Done" }] });
      sdk.team.mockResolvedValue({ states: statesFn });
      sdk.updateIssue.mockResolvedValue({});

      await client.updateIssueState("issue-1", "Done");
      await client.updateIssueState("issue-1", "Done");

      expect(sdk.team).toHaveBeenCalledTimes(1);
    });

    it("warns and does nothing when the issue has no team", async () => {
      sdk.issue.mockResolvedValue(makeFakeIssue({ team: Promise.resolve(null) }));

      await client.updateIssueState("issue-1", "Done");

      expect(logger.warn).toHaveBeenCalledWith(
        { issueId: "issue-1" },
        "Cannot update state: issue has no team",
      );
      expect(sdk.updateIssue).not.toHaveBeenCalled();
    });

    it("warns and does nothing when the state name cannot be resolved", async () => {
      sdk.issue.mockResolvedValue(makeFakeIssue());
      sdk.team.mockResolvedValue({ states: () => Promise.resolve({ nodes: [] }) });

      await client.updateIssueState("issue-1", "Nonexistent");

      expect(logger.warn).toHaveBeenCalledWith(
        { issueId: "issue-1", stateName: "Nonexistent", teamId: "team-1" },
        "Could not find workflow state by name",
      );
      expect(sdk.updateIssue).not.toHaveBeenCalled();
    });
  });

  describe("addLabel", () => {
    it("creates and adds a new label when none exists yet", async () => {
      sdk.issue.mockResolvedValue(makeFakeIssue({ labelIds: [] }));
      sdk.issueLabels.mockResolvedValue({ nodes: [] });
      sdk.createIssueLabel.mockResolvedValue({
        issueLabel: Promise.resolve({ id: "label-urgent", name: "urgent" }),
      });
      sdk.updateIssue.mockResolvedValue({});

      await client.addLabel("issue-1", "urgent");

      expect(sdk.createIssueLabel).toHaveBeenCalledWith({ name: "urgent", teamId: "team-1" });
      expect(sdk.updateIssue).toHaveBeenCalledWith("issue-1", { labelIds: ["label-urgent"] });
    });

    it("reuses an existing label by name instead of creating a duplicate", async () => {
      sdk.issue.mockResolvedValue(makeFakeIssue({ labelIds: [] }));
      sdk.issueLabels.mockResolvedValue({ nodes: [{ id: "label-existing", name: "urgent" }] });
      sdk.updateIssue.mockResolvedValue({});

      await client.addLabel("issue-1", "urgent");

      expect(sdk.createIssueLabel).not.toHaveBeenCalled();
      expect(sdk.updateIssue).toHaveBeenCalledWith("issue-1", { labelIds: ["label-existing"] });
    });

    it("does not add a label id already present on the issue", async () => {
      sdk.issue.mockResolvedValue(makeFakeIssue({ labelIds: ["label-bug"] }));
      sdk.issueLabels.mockResolvedValue({ nodes: [{ id: "label-bug", name: "bug" }] });

      await client.addLabel("issue-1", "bug");

      expect(sdk.updateIssue).not.toHaveBeenCalled();
    });

    it("throws when label creation fails to return a label", async () => {
      sdk.issue.mockResolvedValue(makeFakeIssue({ labelIds: [] }));
      sdk.issueLabels.mockResolvedValue({ nodes: [] });
      sdk.createIssueLabel.mockResolvedValue({ issueLabel: Promise.resolve(null) });

      await expect(client.addLabel("issue-1", "urgent")).rejects.toThrow(
        "Failed to create label: urgent",
      );
    });

    it("creates a label without a teamId when the issue has no team", async () => {
      sdk.issue.mockResolvedValue(makeFakeIssue({ labelIds: [], team: Promise.resolve(null) }));
      sdk.issueLabels.mockResolvedValue({ nodes: [] });
      sdk.createIssueLabel.mockResolvedValue({
        issueLabel: Promise.resolve({ id: "label-new", name: "urgent" }),
      });
      sdk.updateIssue.mockResolvedValue({});

      await client.addLabel("issue-1", "urgent");

      expect(sdk.createIssueLabel).toHaveBeenCalledWith({ name: "urgent" });
    });
  });

  describe("removeLabel", () => {
    it("removes a label already in the cache without re-fetching labels", async () => {
      sdk.issue.mockResolvedValue(makeFakeIssue({ labelIds: ["label-bug", "label-urgent"] }));
      sdk.issueLabels.mockResolvedValue({ nodes: [{ id: "label-bug", name: "bug" }] });
      sdk.updateIssue.mockResolvedValue({});

      // First call populates the label cache via addLabel's resolveOrCreateLabel path.
      await client.addLabel("issue-1", "bug");
      sdk.issue.mockResolvedValue(makeFakeIssue({ labelIds: ["label-bug", "label-urgent"] }));

      await client.removeLabel("issue-1", "bug");

      expect(sdk.updateIssue).toHaveBeenLastCalledWith("issue-1", { labelIds: ["label-urgent"] });
    });

    it("looks up the label by name on the issue when not cached, and removes it", async () => {
      sdk.issue.mockResolvedValue(
        makeFakeIssue({
          labelIds: ["label-bug"],
          labels: () => Promise.resolve({ nodes: [{ id: "label-bug", name: "bug" }] }),
        }),
      );
      sdk.updateIssue.mockResolvedValue({});

      await client.removeLabel("issue-1", "bug");

      expect(sdk.updateIssue).toHaveBeenCalledWith("issue-1", { labelIds: [] });
    });

    it("is a no-op when the label name is not found on the issue", async () => {
      sdk.issue.mockResolvedValue(
        makeFakeIssue({
          labelIds: ["label-bug"],
          labels: () => Promise.resolve({ nodes: [{ id: "label-bug", name: "bug" }] }),
        }),
      );

      await client.removeLabel("issue-1", "nonexistent");

      expect(sdk.updateIssue).not.toHaveBeenCalled();
    });
  });

  describe("listLabels", () => {
    it("returns label names and populates the label cache", async () => {
      sdk.issue.mockResolvedValue(
        makeFakeIssue({
          labels: () =>
            Promise.resolve({
              nodes: [
                { id: "label-bug", name: "bug" },
                { id: "label-urgent", name: "urgent" },
              ],
            }),
        }),
      );

      const labels = await client.listLabels("issue-1");

      expect(labels).toEqual(["bug", "urgent"]);
    });

    it("returns an empty array when the issue has no labels", async () => {
      sdk.issue.mockResolvedValue(makeFakeIssue({ labels: () => Promise.resolve({ nodes: [] }) }));

      const labels = await client.listLabels("issue-1");

      expect(labels).toEqual([]);
    });

    it("tolerates an undefined labels connection", async () => {
      sdk.issue.mockResolvedValue(makeFakeIssue({ labels: () => Promise.resolve(undefined) }));

      const labels = await client.listLabels("issue-1");

      expect(labels).toEqual([]);
    });
  });
});
