import { describe, it, expect, vi, beforeEach } from "vitest";
import { RealLinearClient } from "../../src/linear/realLinearClient.js";

function makeLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
}

function makeFakeIssue(overrides: Record<string, unknown> = {}) {
  return {
    id: "issue-1",
    identifier: "ENG-1",
    title: "Title",
    description: "Description",
    branchName: "ai/issue-1",
    priority: 1,
    url: "https://linear.app/team/issue/ENG-1",
    labelIds: [] as string[],
    state: Promise.resolve({ id: "state-1", name: "Todo" }),
    project: Promise.resolve(null),
    cycle: Promise.resolve(null),
    team: Promise.resolve({ id: "team-1", key: "ENG" }),
    labels: () => Promise.resolve({ nodes: [] as { id: string; name: string }[] }),
    ...overrides,
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

function makeClient(): { client: RealLinearClient; sdk: FakeSdk } {
  const client = new RealLinearClient("key", makeLogger() as never);
  const sdk: FakeSdk = {
    issue: vi.fn(),
    issues: vi.fn(),
    team: vi.fn(),
    createComment: vi.fn(),
    updateIssue: vi.fn(),
    issueLabels: vi.fn(),
    createIssueLabel: vi.fn(),
  };
  (client as unknown as { sdk: FakeSdk }).sdk = sdk;
  return { client, sdk };
}

describe("RealLinearClient", () => {
  let client: RealLinearClient;
  let sdk: FakeSdk;

  beforeEach(() => {
    ({ client, sdk } = makeClient());
  });

  describe("getIssue", () => {
    it("maps the SDK issue into a LinearIssue, resolving nested fields", async () => {
      sdk.issue.mockResolvedValue(
        makeFakeIssue({
          labels: () => Promise.resolve({ nodes: [{ id: "l1", name: "bug" }] }),
          project: Promise.resolve({ name: "Core" }),
          cycle: Promise.resolve({ name: "Cycle 3" }),
        }),
      );

      const issue = await client.getIssue("issue-1");

      expect(issue).toEqual({
        id: "issue-1",
        identifier: "ENG-1",
        title: "Title",
        description: "Description",
        branchName: "ai/issue-1",
        state: "Todo",
        labels: ["bug"],
        priority: 1,
        url: "https://linear.app/team/issue/ENG-1",
        project: "Core",
        team: "ENG",
        cycle: "Cycle 3",
      });
    });

    it("defaults missing description to '', missing state to 'Unknown', and absent project/team/cycle to undefined", async () => {
      sdk.issue.mockResolvedValue(
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
    it("builds a GraphQL filter from projectName, assigneeMe, and team, and maps results", async () => {
      sdk.issues.mockResolvedValue({
        nodes: [
          makeFakeIssue({
            id: "a",
            labels: () => Promise.resolve({ nodes: [{ id: "l1", name: "bug" }] }),
            project: Promise.resolve({ name: "Core" }),
            team: Promise.resolve({ id: "t1", key: "ENG" }),
          }),
        ],
      });

      const results = await client.searchIssues({
        state: "Todo",
        projectName: "Core",
        assigneeMe: true,
        team: "ENG",
      });

      expect(sdk.issues).toHaveBeenCalledWith({
        filter: {
          state: { name: { eq: "Todo" } },
          project: { name: { eq: "Core" } },
          assignee: { isMe: { eq: true } },
          team: { or: [{ name: { eq: "ENG" } }, { key: { eq: "ENG" } }] },
        },
      });
      expect(results).toHaveLength(1);
      expect(results[0]).toMatchObject({ id: "a", state: "Todo", project: "Core", team: "ENG" });
    });

    it("omits optional filter keys when not provided and returns an empty array for no matches", async () => {
      sdk.issues.mockResolvedValue({ nodes: [] });

      const results = await client.searchIssues({ state: "Done" });

      expect(sdk.issues).toHaveBeenCalledWith({ filter: { state: { name: { eq: "Done" } } } });
      expect(results).toEqual([]);
    });

    it("tolerates an undefined issues connection", async () => {
      sdk.issues.mockResolvedValue(undefined);
      await expect(client.searchIssues({ state: "Done" })).resolves.toEqual([]);
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
    it("warns and does not update when the issue has no team", async () => {
      sdk.issue.mockResolvedValue(makeFakeIssue({ team: Promise.resolve(null) }));
      await client.updateIssueState("issue-1", "Done");
      expect(sdk.updateIssue).not.toHaveBeenCalled();
    });

    it("warns and does not update when the named state cannot be resolved", async () => {
      sdk.issue.mockResolvedValue(makeFakeIssue());
      sdk.team.mockResolvedValue({ states: () => Promise.resolve({ nodes: [] }) });
      await client.updateIssueState("issue-1", "Nonexistent");
      expect(sdk.updateIssue).not.toHaveBeenCalled();
    });

    it("resolves the state id via the team's workflow states and updates the issue", async () => {
      sdk.issue.mockResolvedValue(makeFakeIssue());
      sdk.team.mockResolvedValue({
        states: () =>
          Promise.resolve({ nodes: [{ id: "s-done", name: "Done" }, { id: "s-todo", name: "Todo" }] }),
      });

      await client.updateIssueState("issue-1", "Done");

      expect(sdk.updateIssue).toHaveBeenCalledWith("issue-1", { stateId: "s-done" });
    });

    it("caches the resolved state map across calls for the same team", async () => {
      sdk.issue.mockResolvedValue(makeFakeIssue());
      sdk.team.mockResolvedValue({
        states: () => Promise.resolve({ nodes: [{ id: "s-done", name: "Done" }] }),
      });

      await client.updateIssueState("issue-1", "Done");
      await client.updateIssueState("issue-1", "Done");

      expect(sdk.team).toHaveBeenCalledTimes(1);
    });
  });

  describe("addLabel", () => {
    it("creates a new label when none exists and adds it to the issue", async () => {
      sdk.issue.mockResolvedValue(makeFakeIssue({ labelIds: [] }));
      sdk.issueLabels.mockResolvedValue({ nodes: [] });
      sdk.createIssueLabel.mockResolvedValue({
        issueLabel: Promise.resolve({ id: "label-new" }),
      });

      await client.addLabel("issue-1", "urgent");

      expect(sdk.createIssueLabel).toHaveBeenCalledWith({ name: "urgent", teamId: "team-1" });
      expect(sdk.updateIssue).toHaveBeenCalledWith("issue-1", { labelIds: ["label-new"] });
    });

    it("reuses an existing label found via issueLabels without creating one", async () => {
      sdk.issue.mockResolvedValue(makeFakeIssue({ labelIds: [] }));
      sdk.issueLabels.mockResolvedValue({ nodes: [{ id: "label-existing", name: "urgent" }] });

      await client.addLabel("issue-1", "urgent");

      expect(sdk.createIssueLabel).not.toHaveBeenCalled();
      expect(sdk.updateIssue).toHaveBeenCalledWith("issue-1", { labelIds: ["label-existing"] });
    });

    it("does not add a duplicate when the issue already has the label", async () => {
      sdk.issue.mockResolvedValue(makeFakeIssue({ labelIds: ["label-existing"] }));
      sdk.issueLabels.mockResolvedValue({ nodes: [{ id: "label-existing", name: "urgent" }] });

      await client.addLabel("issue-1", "urgent");

      expect(sdk.updateIssue).not.toHaveBeenCalled();
    });

    it("throws when label creation returns no issueLabel", async () => {
      sdk.issue.mockResolvedValue(makeFakeIssue({ labelIds: [] }));
      sdk.issueLabels.mockResolvedValue({ nodes: [] });
      sdk.createIssueLabel.mockResolvedValue({ issueLabel: Promise.resolve(null) });

      await expect(client.addLabel("issue-1", "urgent")).rejects.toThrow(
        /Failed to create label: urgent/,
      );
    });

    it("creates a team-less label when the issue has no team", async () => {
      sdk.issue.mockResolvedValue(makeFakeIssue({ labelIds: [], team: Promise.resolve(null) }));
      sdk.issueLabels.mockResolvedValue({ nodes: [] });
      sdk.createIssueLabel.mockResolvedValue({
        issueLabel: Promise.resolve({ id: "label-new" }),
      });

      await client.addLabel("issue-1", "urgent");

      expect(sdk.createIssueLabel).toHaveBeenCalledWith({ name: "urgent" });
    });

    it("reuses the in-memory label cache on a second call, skipping the lookup", async () => {
      sdk.issue.mockResolvedValue(makeFakeIssue({ labelIds: [] }));
      sdk.issueLabels.mockResolvedValue({ nodes: [{ id: "label-existing", name: "urgent" }] });

      await client.addLabel("issue-1", "urgent");
      await client.addLabel("issue-1", "urgent");

      expect(sdk.issueLabels).toHaveBeenCalledTimes(1);
    });
  });

  describe("removeLabel", () => {
    it("removes a label resolved by name via issue.labels()", async () => {
      sdk.issue.mockResolvedValue(
        makeFakeIssue({
          labelIds: ["label-1", "label-2"],
          labels: () => Promise.resolve({ nodes: [{ id: "label-1", name: "urgent" }] }),
        }),
      );

      await client.removeLabel("issue-1", "urgent");

      expect(sdk.updateIssue).toHaveBeenCalledWith("issue-1", { labelIds: ["label-2"] });
    });

    it("is a no-op when the named label is not found on the issue", async () => {
      sdk.issue.mockResolvedValue(
        makeFakeIssue({ labelIds: ["label-2"], labels: () => Promise.resolve({ nodes: [] }) }),
      );

      await client.removeLabel("issue-1", "missing");

      expect(sdk.updateIssue).not.toHaveBeenCalled();
    });

    it("uses the cached label id on a repeat call instead of calling labels() again", async () => {
      sdk.issue.mockResolvedValue(
        makeFakeIssue({
          labelIds: ["label-1", "label-2"],
          labels: () => Promise.resolve({ nodes: [{ id: "label-1", name: "urgent" }] }),
        }),
      );

      await client.removeLabel("issue-1", "urgent");
      sdk.issue.mockResolvedValue(
        makeFakeIssue({
          labelIds: ["label-1", "label-2"],
          labels: () => Promise.resolve({ nodes: [{ id: "label-1", name: "urgent" }] }),
        }),
      );
      await client.removeLabel("issue-1", "urgent");

      expect(sdk.updateIssue).toHaveBeenCalledTimes(2);
      expect(sdk.updateIssue).toHaveBeenLastCalledWith("issue-1", { labelIds: ["label-2"] });
    });
  });

  describe("listLabels", () => {
    it("returns the issue's label names and populates the label cache", async () => {
      sdk.issue.mockResolvedValue(
        makeFakeIssue({ labels: () => Promise.resolve({ nodes: [{ id: "l1", name: "bug" }] }) }),
      );
      const names = await client.listLabels("issue-1");
      expect(names).toEqual(["bug"]);
    });

    it("returns an empty array when the issue has no labels", async () => {
      sdk.issue.mockResolvedValue(makeFakeIssue({ labels: () => Promise.resolve({ nodes: [] }) }));
      await expect(client.listLabels("issue-1")).resolves.toEqual([]);
    });
  });
});
