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

// Minimal fake SDK issue shape covering every field realLinearClient reads.
function makeFakeIssue(overrides: Record<string, unknown> = {}) {
  return {
    id: "issue-1",
    identifier: "PRY-1",
    title: "Issue title",
    description: "Issue description",
    branchName: "ai/issue-1",
    priority: 1,
    url: "https://linear.app/team/issue/PRY-1",
    labelIds: [] as string[],
    team: Promise.resolve({ id: "team-1", key: "PRY" }),
    state: Promise.resolve({ id: "state-1", name: "Todo" }),
    project: Promise.resolve(null),
    cycle: Promise.resolve(null),
    labels: () => Promise.resolve({ nodes: [] as { id: string; name: string }[] }),
    ...overrides,
  };
}

function makeClient() {
  const client = new RealLinearClient("key", makeLogger() as never);
  return client as unknown as RealLinearClient & {
    sdk: {
      issue: ReturnType<typeof vi.fn>;
      issues: ReturnType<typeof vi.fn>;
      createComment: ReturnType<typeof vi.fn>;
      updateIssue: ReturnType<typeof vi.fn>;
      team: ReturnType<typeof vi.fn>;
      issueLabels: ReturnType<typeof vi.fn>;
      createIssueLabel: ReturnType<typeof vi.fn>;
    };
  };
}

describe("RealLinearClient", () => {
  let client: ReturnType<typeof makeClient>;

  beforeEach(() => {
    client = makeClient();
    client.sdk = {
      issue: vi.fn(),
      issues: vi.fn(),
      createComment: vi.fn(),
      updateIssue: vi.fn(),
      team: vi.fn(),
      issueLabels: vi.fn(),
      createIssueLabel: vi.fn(),
    };
  });

  describe("getIssue", () => {
    it("maps a full SDK issue to a LinearIssue", async () => {
      client.sdk.issue.mockResolvedValue(
        makeFakeIssue({
          labels: () => Promise.resolve({ nodes: [{ id: "l1", name: "bug" }] }),
          project: Promise.resolve({ name: "Project X" }),
          cycle: Promise.resolve({ name: "Cycle 1" }),
        }),
      );

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
        project: "Project X",
        team: "PRY",
        cycle: "Cycle 1",
      });
    });

    it("defaults missing description, state, project, team, and cycle", async () => {
      client.sdk.issue.mockResolvedValue(
        makeFakeIssue({
          description: null,
          state: Promise.resolve(null),
          team: Promise.resolve(null),
        }),
      );

      const issue = await client.getIssue("issue-1");

      expect(issue.description).toBe("");
      expect(issue.state).toBe("Unknown");
      expect(issue.team).toBeUndefined();
      expect(issue.project).toBeUndefined();
      expect(issue.cycle).toBeUndefined();
    });
  });

  describe("searchIssues", () => {
    it("builds a filter with only state when no optional fields are set", async () => {
      client.sdk.issues.mockResolvedValue({ nodes: [] });

      await client.searchIssues({ state: "Todo" });

      expect(client.sdk.issues).toHaveBeenCalledWith({
        filter: { state: { name: { eq: "Todo" } } },
      });
    });

    it("adds project, assignee, and team clauses when provided", async () => {
      client.sdk.issues.mockResolvedValue({ nodes: [] });

      await client.searchIssues({
        state: "Todo",
        projectName: "Alpha",
        assigneeMe: true,
        team: "PRY",
      });

      expect(client.sdk.issues).toHaveBeenCalledWith({
        filter: {
          state: { name: { eq: "Todo" } },
          project: { name: { eq: "Alpha" } },
          assignee: { isMe: { eq: true } },
          team: { or: [{ name: { eq: "PRY" } }, { key: { eq: "PRY" } }] },
        },
      });
    });

    it("maps results and defaults missing project/team/cycle", async () => {
      client.sdk.issues.mockResolvedValue({
        nodes: [
          makeFakeIssue({ id: "a", identifier: "PRY-10", team: Promise.resolve(null) }),
          makeFakeIssue({
            id: "b",
            identifier: "PRY-11",
            project: Promise.resolve({ name: "Proj" }),
            team: Promise.resolve({ key: "PRY" }),
            cycle: Promise.resolve({ name: "Cyc" }),
          }),
        ],
      });

      const results = await client.searchIssues({ state: "Todo" });

      expect(results).toHaveLength(2);
      expect(results[0]).toMatchObject({ id: "a", project: undefined, team: undefined });
      expect(results[1]).toMatchObject({ id: "b", project: "Proj", team: "PRY", cycle: "Cyc" });
    });

    it("returns an empty array when the connection has no nodes", async () => {
      client.sdk.issues.mockResolvedValue(null);

      const results = await client.searchIssues({ state: "Todo" });

      expect(results).toEqual([]);
    });
  });

  describe("postComment", () => {
    it("creates a comment via the SDK", async () => {
      client.sdk.createComment.mockResolvedValue({});

      await client.postComment("issue-1", "hello");

      expect(client.sdk.createComment).toHaveBeenCalledWith({
        issueId: "issue-1",
        body: "hello",
      });
    });
  });

  describe("updateIssueState", () => {
    it("warns and returns early when the issue has no team", async () => {
      client.sdk.issue.mockResolvedValue(makeFakeIssue({ team: Promise.resolve(null) }));

      await client.updateIssueState("issue-1", "Done");

      expect(client.sdk.updateIssue).not.toHaveBeenCalled();
    });

    it("warns and returns early when the state name cannot be resolved", async () => {
      client.sdk.issue.mockResolvedValue(makeFakeIssue());
      client.sdk.team.mockResolvedValue({
        states: () => Promise.resolve({ nodes: [{ id: "s1", name: "Todo" }] }),
      });

      await client.updateIssueState("issue-1", "NonexistentState");

      expect(client.sdk.updateIssue).not.toHaveBeenCalled();
    });

    it("resolves the state id and updates the issue", async () => {
      client.sdk.issue.mockResolvedValue(makeFakeIssue());
      client.sdk.team.mockResolvedValue({
        states: () =>
          Promise.resolve({
            nodes: [
              { id: "s1", name: "Todo" },
              { id: "s2", name: "Done" },
            ],
          }),
      });
      client.sdk.updateIssue.mockResolvedValue({});

      await client.updateIssueState("issue-1", "Done");

      expect(client.sdk.updateIssue).toHaveBeenCalledWith("issue-1", { stateId: "s2" });
    });

    it("caches team states so a second call for the same team does not re-fetch", async () => {
      client.sdk.issue.mockResolvedValue(makeFakeIssue());
      client.sdk.team.mockResolvedValue({
        states: () => Promise.resolve({ nodes: [{ id: "s1", name: "Todo" }] }),
      });
      client.sdk.updateIssue.mockResolvedValue({});

      await client.updateIssueState("issue-1", "Todo");
      await client.updateIssueState("issue-1", "Todo");

      expect(client.sdk.team).toHaveBeenCalledTimes(1);
      expect(client.sdk.updateIssue).toHaveBeenCalledTimes(2);
    });

    it("treats a connection with no state nodes as empty", async () => {
      client.sdk.issue.mockResolvedValue(makeFakeIssue());
      client.sdk.team.mockResolvedValue({ states: () => Promise.resolve(null) });

      await client.updateIssueState("issue-1", "Todo");

      expect(client.sdk.updateIssue).not.toHaveBeenCalled();
    });
  });

  describe("addLabel", () => {
    it("creates a new label (no existing match) and adds it to the issue", async () => {
      const issue = makeFakeIssue({ labelIds: [] });
      client.sdk.issue.mockResolvedValue(issue);
      client.sdk.issueLabels.mockResolvedValue({ nodes: [] });
      client.sdk.createIssueLabel.mockResolvedValue({
        issueLabel: Promise.resolve({ id: "new-label-id" }),
      });
      client.sdk.updateIssue.mockResolvedValue({});

      await client.addLabel("issue-1", "urgent");

      expect(client.sdk.createIssueLabel).toHaveBeenCalledWith({
        name: "urgent",
        teamId: "team-1",
      });
      expect(client.sdk.updateIssue).toHaveBeenCalledWith("issue-1", {
        labelIds: ["new-label-id"],
      });
    });

    it("reuses an existing label match instead of creating one", async () => {
      const issue = makeFakeIssue({ labelIds: [] });
      client.sdk.issue.mockResolvedValue(issue);
      client.sdk.issueLabels.mockResolvedValue({ nodes: [{ id: "existing-id", name: "urgent" }] });
      client.sdk.updateIssue.mockResolvedValue({});

      await client.addLabel("issue-1", "urgent");

      expect(client.sdk.createIssueLabel).not.toHaveBeenCalled();
      expect(client.sdk.updateIssue).toHaveBeenCalledWith("issue-1", {
        labelIds: ["existing-id"],
      });
    });

    it("does not call updateIssue when the label is already on the issue", async () => {
      const issue = makeFakeIssue({ labelIds: ["existing-id"] });
      client.sdk.issue.mockResolvedValue(issue);
      client.sdk.issueLabels.mockResolvedValue({ nodes: [{ id: "existing-id", name: "urgent" }] });

      await client.addLabel("issue-1", "urgent");

      expect(client.sdk.updateIssue).not.toHaveBeenCalled();
    });

    it("creates the label without a teamId when the issue has no team", async () => {
      const issue = makeFakeIssue({ labelIds: [], team: Promise.resolve(null) });
      client.sdk.issue.mockResolvedValue(issue);
      client.sdk.issueLabels.mockResolvedValue({ nodes: [] });
      client.sdk.createIssueLabel.mockResolvedValue({
        issueLabel: Promise.resolve({ id: "new-label-id" }),
      });
      client.sdk.updateIssue.mockResolvedValue({});

      await client.addLabel("issue-1", "urgent");

      expect(client.sdk.createIssueLabel).toHaveBeenCalledWith({ name: "urgent" });
    });

    it("throws when label creation does not return an issueLabel", async () => {
      const issue = makeFakeIssue({ labelIds: [] });
      client.sdk.issue.mockResolvedValue(issue);
      client.sdk.issueLabels.mockResolvedValue({ nodes: [] });
      client.sdk.createIssueLabel.mockResolvedValue({ issueLabel: Promise.resolve(null) });

      await expect(client.addLabel("issue-1", "urgent")).rejects.toThrow(
        "Failed to create label: urgent",
      );
    });

    it("caches a resolved label id across calls, skipping issueLabels lookup", async () => {
      const issue = makeFakeIssue({ labelIds: [] });
      client.sdk.issue.mockResolvedValue(issue);
      client.sdk.issueLabels.mockResolvedValue({ nodes: [{ id: "existing-id", name: "urgent" }] });
      client.sdk.updateIssue.mockResolvedValue({});

      await client.addLabel("issue-1", "urgent");
      await client.addLabel("issue-1", "urgent");

      expect(client.sdk.issueLabels).toHaveBeenCalledTimes(1);
    });
  });

  describe("removeLabel", () => {
    it("removes a label by looking it up when not cached", async () => {
      const issue = makeFakeIssue({
        labelIds: ["l1", "l2"],
        labels: () => Promise.resolve({ nodes: [{ id: "l1", name: "urgent" }] }),
      });
      client.sdk.issue.mockResolvedValue(issue);
      client.sdk.updateIssue.mockResolvedValue({});

      await client.removeLabel("issue-1", "urgent");

      expect(client.sdk.updateIssue).toHaveBeenCalledWith("issue-1", { labelIds: ["l2"] });
    });

    it("is a no-op when the label name has no match on the issue", async () => {
      const issue = makeFakeIssue({
        labelIds: ["l1"],
        labels: () => Promise.resolve({ nodes: [{ id: "l1", name: "other" }] }),
      });
      client.sdk.issue.mockResolvedValue(issue);

      await client.removeLabel("issue-1", "urgent");

      expect(client.sdk.updateIssue).not.toHaveBeenCalled();
    });

    it("uses the cached label id on a second call instead of re-fetching labels", async () => {
      const labelsFn = vi
        .fn()
        .mockResolvedValue({ nodes: [{ id: "l1", name: "urgent" }] });
      const issue = makeFakeIssue({ labelIds: ["l1"], labels: labelsFn });
      client.sdk.issue.mockResolvedValue(issue);
      client.sdk.updateIssue.mockResolvedValue({});

      await client.removeLabel("issue-1", "urgent");
      await client.removeLabel("issue-1", "urgent");

      expect(labelsFn).toHaveBeenCalledTimes(1);
      expect(client.sdk.updateIssue).toHaveBeenCalledTimes(2);
    });
  });

  describe("listLabels", () => {
    it("returns label names and populates the label cache", async () => {
      const issue = makeFakeIssue({
        labels: () =>
          Promise.resolve({
            nodes: [
              { id: "l1", name: "urgent" },
              { id: "l2", name: "bug" },
            ],
          }),
      });
      client.sdk.issue.mockResolvedValue(issue);

      const labels = await client.listLabels("issue-1");

      expect(labels).toEqual(["urgent", "bug"]);
    });

    it("returns an empty array when the connection has no nodes", async () => {
      client.sdk.issue.mockResolvedValue(makeFakeIssue({ labels: () => Promise.resolve(null) }));

      const labels = await client.listLabels("issue-1");

      expect(labels).toEqual([]);
    });
  });
});
