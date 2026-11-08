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

// Minimal shape covering what RealLinearClient touches on an SDK issue object.
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
    project: Promise.resolve(null),
    cycle: Promise.resolve(null),
    team: Promise.resolve({ id: "team-1", key: "PRY" }),
    labels: () => Promise.resolve({ nodes: [] }),
    ...overrides,
  };
}

function injectSdk(client: RealLinearClient, sdk: Record<string, unknown>): void {
  (client as unknown as { sdk: Record<string, unknown> }).sdk = sdk;
}

describe("RealLinearClient", () => {
  let logger: ReturnType<typeof makeLogger>;
  let client: RealLinearClient;

  beforeEach(() => {
    logger = makeLogger();
    client = new RealLinearClient("test-key", logger as never);
  });

  describe("getIssue", () => {
    it("maps an SDK issue into a LinearIssue, resolving relations", async () => {
      const issue = makeFakeIssue({
        id: "issue-1",
        labels: () => Promise.resolve({ nodes: [{ id: "l1", name: "bug" }] }),
        project: Promise.resolve({ name: "Platform" }),
        cycle: Promise.resolve({ name: "Sprint 1" }),
      });
      injectSdk(client, { issue: () => Promise.resolve(issue) });

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
        project: "Platform",
        team: "PRY",
        cycle: "Sprint 1",
      });
    });

    it("falls back to defaults when description/state/project/cycle/team are absent", async () => {
      const issue = makeFakeIssue({
        id: "issue-1",
        description: null,
        state: Promise.resolve(null),
        project: Promise.resolve(null),
        cycle: Promise.resolve(null),
        team: Promise.resolve(null),
      });
      injectSdk(client, { issue: () => Promise.resolve(issue) });

      const result = await client.getIssue("issue-1");

      expect(result.description).toBe("");
      expect(result.state).toBe("Unknown");
      expect(result.project).toBeUndefined();
      expect(result.team).toBeUndefined();
      expect(result.cycle).toBeUndefined();
    });
  });

  describe("searchIssues", () => {
    it("builds a GraphQL filter from projectName, assigneeMe and team, and maps results", async () => {
      const issue = makeFakeIssue({
        id: "issue-1",
        labels: () => Promise.resolve({ nodes: [{ id: "l1", name: "bug" }] }),
        project: Promise.resolve({ name: "Platform" }),
      });
      const sdkIssues = vi.fn().mockResolvedValue({ nodes: [issue] });
      injectSdk(client, { issues: sdkIssues });

      const results = await client.searchIssues({
        state: "Todo",
        projectName: "Platform",
        assigneeMe: true,
        team: "PRY",
      });

      expect(sdkIssues).toHaveBeenCalledWith({
        filter: {
          state: { name: { eq: "Todo" } },
          project: { name: { eq: "Platform" } },
          assignee: { isMe: { eq: true } },
          team: { or: [{ name: { eq: "PRY" } }, { key: { eq: "PRY" } }] },
        },
      });
      expect(results).toHaveLength(1);
      expect(results[0]).toMatchObject({ id: "issue-1", labels: ["bug"], project: "Platform" });
    });

    it("builds a minimal filter and leaves project/team/cycle undefined when absent", async () => {
      const issue = makeFakeIssue({
        id: "issue-1",
        project: Promise.resolve(null),
        cycle: Promise.resolve(null),
        team: Promise.resolve(null),
      });
      const sdkIssues = vi.fn().mockResolvedValue({ nodes: [issue] });
      injectSdk(client, { issues: sdkIssues });

      const results = await client.searchIssues({ state: "Todo" });

      expect(sdkIssues).toHaveBeenCalledWith({ filter: { state: { name: { eq: "Todo" } } } });
      expect(results[0]).toMatchObject({ project: undefined, team: undefined, cycle: undefined });
    });

    it("returns an empty array when the SDK yields no nodes", async () => {
      injectSdk(client, { issues: vi.fn().mockResolvedValue({ nodes: [] }) });

      const results = await client.searchIssues({ state: "Todo" });
      expect(results).toEqual([]);
    });

    it("handles an undefined issues connection", async () => {
      injectSdk(client, { issues: vi.fn().mockResolvedValue(undefined) });

      const results = await client.searchIssues({ state: "Todo" });
      expect(results).toEqual([]);
    });
  });

  describe("postComment", () => {
    it("delegates to sdk.createComment", async () => {
      const createComment = vi.fn().mockResolvedValue({});
      injectSdk(client, { createComment });

      await client.postComment("issue-1", "a comment");

      expect(createComment).toHaveBeenCalledWith({ issueId: "issue-1", body: "a comment" });
    });
  });

  describe("updateIssueState", () => {
    it("warns and returns when the issue has no team", async () => {
      const issue = makeFakeIssue({ id: "issue-1", team: Promise.resolve(null) });
      const updateIssue = vi.fn();
      injectSdk(client, { issue: () => Promise.resolve(issue), updateIssue });

      await client.updateIssueState("issue-1", "Done");

      expect(updateIssue).not.toHaveBeenCalled();
      expect(logger.warn).toHaveBeenCalled();
    });

    it("warns and returns when the named state cannot be resolved", async () => {
      const issue = makeFakeIssue({ id: "issue-1" });
      const team = { id: "team-1", states: () => Promise.resolve({ nodes: [] }) };
      const updateIssue = vi.fn();
      injectSdk(client, {
        issue: () => Promise.resolve(issue),
        team: () => Promise.resolve(team),
        updateIssue,
      });

      await client.updateIssueState("issue-1", "NoSuchState");

      expect(updateIssue).not.toHaveBeenCalled();
      expect(logger.warn).toHaveBeenCalled();
    });

    it("resolves the state id and calls updateIssue, caching the team's states", async () => {
      const issue1 = makeFakeIssue({ id: "issue-1" });
      const issue2 = makeFakeIssue({ id: "issue-2" });
      const teamStates = vi.fn().mockResolvedValue({
        nodes: [
          { id: "state-todo", name: "Todo" },
          { id: "state-done", name: "Done" },
        ],
      });
      const team = vi.fn().mockResolvedValue({ id: "team-1", states: teamStates });
      const updateIssue = vi.fn().mockResolvedValue({});
      injectSdk(client, {
        issue: (id: string) => Promise.resolve(id === "issue-1" ? issue1 : issue2),
        team,
        updateIssue,
      });

      await client.updateIssueState("issue-1", "Done");
      await client.updateIssueState("issue-2", "Done");

      expect(updateIssue).toHaveBeenNthCalledWith(1, "issue-1", { stateId: "state-done" });
      expect(updateIssue).toHaveBeenNthCalledWith(2, "issue-2", { stateId: "state-done" });
      // team() (and thus states()) is only called once because results are cached per team.
      expect(team).toHaveBeenCalledTimes(1);
    });
  });

  describe("addLabel", () => {
    it("creates a new label (no existing match) and attaches it", async () => {
      const issue = makeFakeIssue({ id: "issue-1", labelIds: [] });
      const issueLabels = vi.fn().mockResolvedValue({ nodes: [] });
      const createIssueLabel = vi.fn().mockResolvedValue({
        issueLabel: Promise.resolve({ id: "label-new" }),
      });
      const updateIssue = vi.fn().mockResolvedValue({});
      injectSdk(client, {
        issue: () => Promise.resolve(issue),
        issueLabels,
        createIssueLabel,
        updateIssue,
      });

      await client.addLabel("issue-1", "shiny");

      expect(createIssueLabel).toHaveBeenCalledWith({ name: "shiny", teamId: "team-1" });
      expect(updateIssue).toHaveBeenCalledWith("issue-1", { labelIds: ["label-new"] });
    });

    it("reuses an existing label by name instead of creating a new one", async () => {
      const issue = makeFakeIssue({ id: "issue-1", labelIds: [] });
      const issueLabels = vi.fn().mockResolvedValue({ nodes: [{ id: "label-existing" }] });
      const createIssueLabel = vi.fn();
      const updateIssue = vi.fn().mockResolvedValue({});
      injectSdk(client, {
        issue: () => Promise.resolve(issue),
        issueLabels,
        createIssueLabel,
        updateIssue,
      });

      await client.addLabel("issue-1", "existing-label");

      expect(createIssueLabel).not.toHaveBeenCalled();
      expect(updateIssue).toHaveBeenCalledWith("issue-1", { labelIds: ["label-existing"] });
    });

    it("does not call updateIssue when the issue already has the label", async () => {
      const issue = makeFakeIssue({ id: "issue-1", labelIds: ["label-existing"] });
      const issueLabels = vi.fn().mockResolvedValue({ nodes: [{ id: "label-existing" }] });
      const updateIssue = vi.fn();
      injectSdk(client, {
        issue: () => Promise.resolve(issue),
        issueLabels,
        updateIssue,
      });

      await client.addLabel("issue-1", "existing-label");

      expect(updateIssue).not.toHaveBeenCalled();
    });

    it("throws when label creation does not yield an issueLabel", async () => {
      const issue = makeFakeIssue({ id: "issue-1", labelIds: [] });
      const issueLabels = vi.fn().mockResolvedValue({ nodes: [] });
      const createIssueLabel = vi.fn().mockResolvedValue({ issueLabel: Promise.resolve(null) });
      injectSdk(client, {
        issue: () => Promise.resolve(issue),
        issueLabels,
        createIssueLabel,
      });

      await expect(client.addLabel("issue-1", "shiny")).rejects.toThrow(
        "Failed to create label: shiny",
      );
    });

    it("caches a resolved label id across calls for different issues", async () => {
      const issue1 = makeFakeIssue({ id: "issue-1", labelIds: [] });
      const issue2 = makeFakeIssue({ id: "issue-2", labelIds: [] });
      const issueLabels = vi.fn().mockResolvedValue({ nodes: [{ id: "label-cached" }] });
      const updateIssue = vi.fn().mockResolvedValue({});
      injectSdk(client, {
        issue: (id: string) => Promise.resolve(id === "issue-1" ? issue1 : issue2),
        issueLabels,
        updateIssue,
      });

      await client.addLabel("issue-1", "shared-label");
      await client.addLabel("issue-2", "shared-label");

      expect(issueLabels).toHaveBeenCalledTimes(1);
    });
  });

  describe("removeLabel", () => {
    it("removes a label found via the issue's labels connection and caches it", async () => {
      const issue = makeFakeIssue({
        id: "issue-1",
        labelIds: ["label-a", "label-b"],
        labels: () =>
          Promise.resolve({
            nodes: [
              { id: "label-a", name: "a" },
              { id: "label-b", name: "b" },
            ],
          }),
      });
      const updateIssue = vi.fn().mockResolvedValue({});
      injectSdk(client, { issue: () => Promise.resolve(issue), updateIssue });

      await client.removeLabel("issue-1", "a");

      expect(updateIssue).toHaveBeenCalledWith("issue-1", { labelIds: ["label-b"] });
    });

    it("is a no-op when the named label is not found on the issue", async () => {
      const issue = makeFakeIssue({
        id: "issue-1",
        labels: () => Promise.resolve({ nodes: [] }),
      });
      const updateIssue = vi.fn();
      injectSdk(client, { issue: () => Promise.resolve(issue), updateIssue });

      await client.removeLabel("issue-1", "missing");

      expect(updateIssue).not.toHaveBeenCalled();
    });

    it("uses the cached label id on a subsequent call instead of refetching labels()", async () => {
      const labelsFn = vi.fn().mockResolvedValue({ nodes: [{ id: "label-a", name: "a" }] });
      const issue = makeFakeIssue({ id: "issue-1", labelIds: ["label-a"], labels: labelsFn });
      const updateIssue = vi.fn().mockResolvedValue({});
      injectSdk(client, { issue: () => Promise.resolve(issue), updateIssue });

      await client.removeLabel("issue-1", "a");
      await client.removeLabel("issue-1", "a");

      expect(labelsFn).toHaveBeenCalledTimes(1);
      expect(updateIssue).toHaveBeenCalledTimes(2);
    });
  });

  describe("listLabels", () => {
    it("returns label names and populates the label cache", async () => {
      const issue = makeFakeIssue({
        id: "issue-1",
        labels: () =>
          Promise.resolve({ nodes: [{ id: "label-a", name: "a" }, { id: "label-b", name: "b" }] }),
      });
      injectSdk(client, { issue: () => Promise.resolve(issue) });

      const names = await client.listLabels("issue-1");
      expect(names).toEqual(["a", "b"]);
    });

    it("returns an empty array when there are no labels", async () => {
      const issue = makeFakeIssue({ id: "issue-1", labels: () => Promise.resolve({ nodes: [] }) });
      injectSdk(client, { issue: () => Promise.resolve(issue) });

      await expect(client.listLabels("issue-1")).resolves.toEqual([]);
    });
  });
});
