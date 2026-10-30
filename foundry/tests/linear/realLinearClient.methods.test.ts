import { describe, it, expect, vi, beforeEach } from "vitest";
import { RealLinearClient } from "../../src/linear/realLinearClient.js";

function makeLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
}

describe("RealLinearClient (methods beyond getRelatedContext)", () => {
  let client: RealLinearClient;
  let sdk: Record<string, ReturnType<typeof vi.fn>>;

  beforeEach(() => {
    sdk = {
      issue: vi.fn(),
      issues: vi.fn(),
      createComment: vi.fn(),
      updateIssue: vi.fn(),
      team: vi.fn(),
      issueLabels: vi.fn(),
      createIssueLabel: vi.fn(),
    };
    client = new RealLinearClient("key", makeLogger() as never);
    (client as unknown as { sdk: typeof sdk }).sdk = sdk;
  });

  describe("getIssue", () => {
    it("maps an SDK issue to the LinearIssue shape", async () => {
      sdk.issue.mockResolvedValue({
        id: "i1",
        identifier: "PRY-1",
        title: "Title",
        description: "Desc",
        branchName: "ai/i1",
        priority: 2,
        url: "https://linear.app/i1",
        labels: () => Promise.resolve({ nodes: [{ name: "bug" }] }),
        state: Promise.resolve({ name: "Todo" }),
        project: Promise.resolve({ name: "Core" }),
        cycle: Promise.resolve({ name: "Cycle 1" }),
        team: Promise.resolve({ key: "PRY" }),
      });

      const issue = await client.getIssue("i1");

      expect(issue).toEqual({
        id: "i1",
        identifier: "PRY-1",
        title: "Title",
        description: "Desc",
        branchName: "ai/i1",
        state: "Todo",
        labels: ["bug"],
        priority: 2,
        url: "https://linear.app/i1",
        project: "Core",
        team: "PRY",
        cycle: "Cycle 1",
      });
    });

    it("falls back when description/state/project/cycle/team are missing", async () => {
      sdk.issue.mockResolvedValue({
        id: "i1",
        identifier: "PRY-1",
        title: "Title",
        description: null,
        branchName: "ai/i1",
        priority: 0,
        url: "https://linear.app/i1",
        labels: () => Promise.resolve({ nodes: [] }),
        state: Promise.resolve(null),
        project: Promise.resolve(null),
        cycle: Promise.resolve(null),
        team: Promise.resolve(null),
      });

      const issue = await client.getIssue("i1");

      expect(issue.description).toBe("");
      expect(issue.state).toBe("Unknown");
      expect(issue.project).toBeUndefined();
      expect(issue.team).toBeUndefined();
      expect(issue.cycle).toBeUndefined();
    });
  });

  describe("searchIssues", () => {
    function makeSearchIssue(overrides: Record<string, unknown> = {}) {
      return {
        id: "i1",
        identifier: "PRY-1",
        title: "Title",
        description: "Desc",
        branchName: "ai/i1",
        priority: 1,
        url: "https://linear.app/i1",
        labels: () => Promise.resolve({ nodes: [{ name: "bug" }] }),
        project: Promise.resolve(null),
        cycle: Promise.resolve(null),
        team: Promise.resolve(null),
        ...overrides,
      };
    }

    it("builds a base filter by state and maps results", async () => {
      sdk.issues.mockResolvedValue({ nodes: [makeSearchIssue()] });

      const results = await client.searchIssues({ state: "Todo" });

      expect(sdk.issues).toHaveBeenCalledWith({
        filter: { state: { name: { eq: "Todo" } } },
      });
      expect(results).toHaveLength(1);
      expect(results[0]).toMatchObject({ id: "i1", state: "Todo", labels: ["bug"] });
    });

    it("adds projectName, assigneeMe, and team clauses when provided", async () => {
      sdk.issues.mockResolvedValue({ nodes: [] });

      await client.searchIssues({
        state: "Todo",
        projectName: "Core",
        assigneeMe: true,
        team: "PRY",
      });

      expect(sdk.issues).toHaveBeenCalledWith({
        filter: {
          state: { name: { eq: "Todo" } },
          project: { name: { eq: "Core" } },
          assignee: { isMe: { eq: true } },
          team: { or: [{ name: { eq: "PRY" } }, { key: { eq: "PRY" } }] },
        },
      });
    });

    it("returns an empty array when the connection has no nodes", async () => {
      sdk.issues.mockResolvedValue({ nodes: undefined });
      const results = await client.searchIssues({ state: "Todo" });
      expect(results).toEqual([]);
    });
  });

  it("postComment creates a comment via the SDK", async () => {
    sdk.createComment.mockResolvedValue({});
    await client.postComment("i1", "hello");
    expect(sdk.createComment).toHaveBeenCalledWith({ issueId: "i1", body: "hello" });
  });

  describe("updateIssueState", () => {
    it("warns and returns when the issue has no team", async () => {
      sdk.issue.mockResolvedValue({ team: Promise.resolve(null) });
      await client.updateIssueState("i1", "Done");
      expect(sdk.updateIssue).not.toHaveBeenCalled();
    });

    it("warns and returns when the state name can't be resolved", async () => {
      sdk.issue.mockResolvedValue({ team: Promise.resolve({ id: "team-1" }) });
      sdk.team.mockResolvedValue({ states: () => Promise.resolve({ nodes: [] }) });

      await client.updateIssueState("i1", "Nonexistent");

      expect(sdk.updateIssue).not.toHaveBeenCalled();
    });

    it("resolves the state id and updates the issue", async () => {
      sdk.issue.mockResolvedValue({ team: Promise.resolve({ id: "team-1" }) });
      sdk.team.mockResolvedValue({
        states: () => Promise.resolve({ nodes: [{ id: "state-1", name: "Done" }] }),
      });
      sdk.updateIssue.mockResolvedValue({});

      await client.updateIssueState("i1", "Done");

      expect(sdk.updateIssue).toHaveBeenCalledWith("i1", { stateId: "state-1" });
    });

    it("caches the resolved state map across calls for the same team", async () => {
      sdk.issue.mockResolvedValue({ team: Promise.resolve({ id: "team-1" }) });
      sdk.team.mockResolvedValue({
        states: () => Promise.resolve({ nodes: [{ id: "state-1", name: "Done" }] }),
      });
      sdk.updateIssue.mockResolvedValue({});

      await client.updateIssueState("i1", "Done");
      await client.updateIssueState("i1", "Done");

      expect(sdk.team).toHaveBeenCalledTimes(1);
    });
  });

  describe("addLabel", () => {
    it("resolves an existing label and adds it if not already present", async () => {
      sdk.issue.mockResolvedValue({ team: Promise.resolve(null), labelIds: ["existing"] });
      sdk.issueLabels.mockResolvedValue({ nodes: [{ id: "label-1", name: "bug" }] });
      sdk.updateIssue.mockResolvedValue({});

      await client.addLabel("i1", "bug");

      expect(sdk.updateIssue).toHaveBeenCalledWith("i1", { labelIds: ["existing", "label-1"] });
    });

    it("creates a new label when none matches, scoping it to the team when present", async () => {
      sdk.issue.mockResolvedValue({ team: Promise.resolve({ id: "team-1" }), labelIds: [] });
      sdk.issueLabels.mockResolvedValue({ nodes: [] });
      sdk.createIssueLabel.mockResolvedValue({
        issueLabel: Promise.resolve({ id: "new-label" }),
      });
      sdk.updateIssue.mockResolvedValue({});

      await client.addLabel("i1", "new-tag");

      expect(sdk.createIssueLabel).toHaveBeenCalledWith({ name: "new-tag", teamId: "team-1" });
      expect(sdk.updateIssue).toHaveBeenCalledWith("i1", { labelIds: ["new-label"] });
    });

    it("throws when label creation does not return a created label", async () => {
      sdk.issue.mockResolvedValue({ team: Promise.resolve(null), labelIds: [] });
      sdk.issueLabels.mockResolvedValue({ nodes: [] });
      sdk.createIssueLabel.mockResolvedValue({ issueLabel: Promise.resolve(null) });

      await expect(client.addLabel("i1", "new-tag")).rejects.toThrow(
        /Failed to create label: new-tag/,
      );
    });

    it("does not add a duplicate label id already on the issue", async () => {
      sdk.issue.mockResolvedValue({ team: Promise.resolve(null), labelIds: ["label-1"] });
      sdk.issueLabels.mockResolvedValue({ nodes: [{ id: "label-1", name: "bug" }] });

      await client.addLabel("i1", "bug");

      expect(sdk.updateIssue).not.toHaveBeenCalled();
    });

    it("reuses the label cache on a second call for the same label name", async () => {
      sdk.issue.mockResolvedValue({ team: Promise.resolve(null), labelIds: [] });
      sdk.issueLabels.mockResolvedValue({ nodes: [{ id: "label-1", name: "bug" }] });
      sdk.updateIssue.mockResolvedValue({});

      await client.addLabel("i1", "bug");
      await client.addLabel("i1", "bug");

      expect(sdk.issueLabels).toHaveBeenCalledTimes(1);
    });
  });

  describe("removeLabel", () => {
    it("looks up the label by name via the issue's labels when not cached", async () => {
      sdk.issue.mockResolvedValue({
        labelIds: ["label-1", "label-2"],
        labels: () => Promise.resolve({ nodes: [{ id: "label-1", name: "bug" }] }),
      });
      sdk.updateIssue.mockResolvedValue({});

      await client.removeLabel("i1", "bug");

      expect(sdk.updateIssue).toHaveBeenCalledWith("i1", { labelIds: ["label-2"] });
    });

    it("does nothing when the named label isn't found on the issue", async () => {
      sdk.issue.mockResolvedValue({
        labelIds: ["label-2"],
        labels: () => Promise.resolve({ nodes: [] }),
      });

      await client.removeLabel("i1", "bug");

      expect(sdk.updateIssue).not.toHaveBeenCalled();
    });

    it("uses the cached label id on a subsequent call, skipping the lookup", async () => {
      sdk.issue.mockResolvedValue({
        labelIds: ["label-1", "label-2"],
        labels: () => Promise.resolve({ nodes: [{ id: "label-1", name: "bug" }] }),
      });
      sdk.updateIssue.mockResolvedValue({});

      await client.removeLabel("i1", "bug");
      sdk.issue.mockResolvedValue({ labelIds: ["label-1", "label-2"] });
      await client.removeLabel("i1", "bug");

      expect(sdk.updateIssue).toHaveBeenCalledTimes(2);
      expect(sdk.updateIssue).toHaveBeenLastCalledWith("i1", { labelIds: ["label-2"] });
    });
  });

  it("listLabels returns names and populates the label cache", async () => {
    sdk.issue.mockResolvedValue({
      labels: () =>
        Promise.resolve({
          nodes: [
            { id: "label-1", name: "bug" },
            { id: "label-2", name: "urgent" },
          ],
        }),
    });

    const names = await client.listLabels("i1");

    expect(names).toEqual(["bug", "urgent"]);
  });
});
