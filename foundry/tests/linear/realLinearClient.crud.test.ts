import { describe, it, expect, vi, beforeEach } from "vitest";
import { RealLinearClient } from "../../src/linear/realLinearClient.js";

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
  labels: () => Promise<{ nodes: Array<{ id: string; name: string }> } | null>;
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

function makeLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };
}

type FakeSdk = {
  issue: ReturnType<typeof vi.fn>;
  issues: ReturnType<typeof vi.fn>;
  team: ReturnType<typeof vi.fn>;
  issueLabels: ReturnType<typeof vi.fn>;
  createIssueLabel: ReturnType<typeof vi.fn>;
  createComment: ReturnType<typeof vi.fn>;
  updateIssue: ReturnType<typeof vi.fn>;
};

function installFakeSdk(client: RealLinearClient, overrides: Partial<FakeSdk> = {}): FakeSdk {
  const fakeSdk: FakeSdk = {
    issue: vi.fn(),
    issues: vi.fn(),
    team: vi.fn(),
    issueLabels: vi.fn(),
    createIssueLabel: vi.fn(),
    createComment: vi.fn(),
    updateIssue: vi.fn(),
    ...overrides,
  };
  (client as unknown as { sdk: FakeSdk }).sdk = fakeSdk;
  return fakeSdk;
}

describe("RealLinearClient", () => {
  let client: RealLinearClient;
  let logger: ReturnType<typeof makeLogger>;

  beforeEach(() => {
    logger = makeLogger();
    client = new RealLinearClient("test-key", logger as never);
  });

  describe("getIssue", () => {
    it("maps a fully-populated SDK issue to a LinearIssue", async () => {
      const fakeIssue = makeFakeIssue({
        id: "issue-1",
        project: Promise.resolve({ name: "Project X" }),
        cycle: Promise.resolve({ name: "Cycle 4" }),
        labels: () => Promise.resolve({ nodes: [{ id: "l1", name: "bug" }] }),
      });
      installFakeSdk(client, { issue: vi.fn().mockResolvedValue(fakeIssue) });

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
        project: "Project X",
        team: "PRY",
        cycle: "Cycle 4",
      });
    });

    it("falls back to defaults when state/labels/description are missing", async () => {
      const fakeIssue = makeFakeIssue({
        id: "issue-2",
        description: null,
        state: Promise.resolve(null),
        labels: () => Promise.resolve(null),
        team: Promise.resolve(null),
      });
      installFakeSdk(client, { issue: vi.fn().mockResolvedValue(fakeIssue) });

      const result = await client.getIssue("issue-2");

      expect(result.description).toBe("");
      expect(result.state).toBe("Unknown");
      expect(result.labels).toEqual([]);
      expect(result.team).toBeUndefined();
      expect(result.project).toBeUndefined();
      expect(result.cycle).toBeUndefined();
    });
  });

  describe("searchIssues", () => {
    it("builds a filter with all optional fields and maps results", async () => {
      const fakeIssue = makeFakeIssue({
        id: "issue-3",
        labels: () => Promise.resolve({ nodes: [{ id: "l1", name: "urgent" }] }),
        project: Promise.resolve({ name: "Proj" }),
        cycle: Promise.resolve({ name: "Cyc" }),
      });
      const issuesFn = vi.fn().mockResolvedValue({ nodes: [fakeIssue] });
      installFakeSdk(client, { issues: issuesFn });

      const result = await client.searchIssues({
        projectName: "Proj",
        assigneeMe: true,
        team: "PRY",
        state: "Todo",
      });

      expect(issuesFn).toHaveBeenCalledWith({
        filter: {
          state: { name: { eq: "Todo" } },
          project: { name: { eq: "Proj" } },
          assignee: { isMe: { eq: true } },
          team: { or: [{ name: { eq: "PRY" } }, { key: { eq: "PRY" } }] },
        },
      });
      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        id: "issue-3",
        state: "Todo",
        labels: ["urgent"],
        project: "Proj",
        cycle: "Cyc",
      });
      expect(logger.info).toHaveBeenCalledWith(
        expect.objectContaining({ count: 1 }),
        "Searched Linear issues",
      );
    });

    it("omits optional filter fields when not provided and handles an empty result set", async () => {
      const issuesFn = vi.fn().mockResolvedValue({ nodes: [] });
      installFakeSdk(client, { issues: issuesFn });

      const result = await client.searchIssues({ state: "Done" });

      expect(issuesFn).toHaveBeenCalledWith({
        filter: { state: { name: { eq: "Done" } } },
      });
      expect(result).toEqual([]);
    });

    it("handles a null issues connection gracefully", async () => {
      const issuesFn = vi.fn().mockResolvedValue(null);
      installFakeSdk(client, { issues: issuesFn });

      const result = await client.searchIssues({ state: "Done" });

      expect(result).toEqual([]);
    });

    it("falls back to defaults when a matched issue has null description/labels/project/cycle/team", async () => {
      const fakeIssue = makeFakeIssue({
        id: "issue-4",
        description: null,
        labels: () => Promise.resolve(null),
        project: Promise.resolve(null),
        cycle: Promise.resolve(null),
        team: Promise.resolve(null),
      });
      const issuesFn = vi.fn().mockResolvedValue({ nodes: [fakeIssue] });
      installFakeSdk(client, { issues: issuesFn });

      const result = await client.searchIssues({ state: "Todo" });

      expect(result).toEqual([
        expect.objectContaining({
          id: "issue-4",
          description: "",
          labels: [],
          project: undefined,
          cycle: undefined,
          team: undefined,
        }),
      ]);
    });
  });

  describe("postComment", () => {
    it("creates a comment via the SDK and logs", async () => {
      const createComment = vi.fn().mockResolvedValue({});
      installFakeSdk(client, { createComment });

      await client.postComment("issue-1", "hello world");

      expect(createComment).toHaveBeenCalledWith({ issueId: "issue-1", body: "hello world" });
      expect(logger.debug).toHaveBeenCalled();
    });
  });

  describe("updateIssueState", () => {
    it("warns and returns early when the issue has no team", async () => {
      const fakeIssue = makeFakeIssue({ id: "issue-1", team: Promise.resolve(null) });
      const updateIssue = vi.fn();
      installFakeSdk(client, { issue: vi.fn().mockResolvedValue(fakeIssue), updateIssue });

      await client.updateIssueState("issue-1", "Done");

      expect(logger.warn).toHaveBeenCalledWith(
        { issueId: "issue-1" },
        "Cannot update state: issue has no team",
      );
      expect(updateIssue).not.toHaveBeenCalled();
    });

    it("warns and returns early when the state name cannot be resolved", async () => {
      const fakeIssue = makeFakeIssue({ id: "issue-1" });
      const team = { id: "team-1", key: "PRY", states: () => Promise.resolve({ nodes: [] }) };
      const updateIssue = vi.fn();
      installFakeSdk(client, {
        issue: vi.fn().mockResolvedValue(fakeIssue),
        team: vi.fn().mockResolvedValue(team),
        updateIssue,
      });

      await client.updateIssueState("issue-1", "Nonexistent");

      expect(logger.warn).toHaveBeenCalledWith(
        { issueId: "issue-1", stateName: "Nonexistent", teamId: "team-1" },
        "Could not find workflow state by name",
      );
      expect(updateIssue).not.toHaveBeenCalled();
    });

    it("resolves the state id and updates the issue, caching the team's states", async () => {
      const fakeIssue = makeFakeIssue({ id: "issue-1" });
      const statesFn = vi
        .fn()
        .mockResolvedValue({ nodes: [{ id: "state-done", name: "Done" }] });
      const teamFn = vi.fn().mockResolvedValue({ id: "team-1", key: "PRY", states: statesFn });
      const updateIssue = vi.fn().mockResolvedValue({});
      installFakeSdk(client, {
        issue: vi.fn().mockResolvedValue(fakeIssue),
        team: teamFn,
        updateIssue,
      });

      await client.updateIssueState("issue-1", "Done");
      // Second call for the same team should hit the cache, not call sdk.team again.
      await client.updateIssueState("issue-1", "Done");

      expect(updateIssue).toHaveBeenCalledWith("issue-1", { stateId: "state-done" });
      expect(updateIssue).toHaveBeenCalledTimes(2);
      expect(teamFn).toHaveBeenCalledTimes(1);
    });

    it("treats a null states connection as an empty list and still warns about the unresolved state", async () => {
      const fakeIssue = makeFakeIssue({ id: "issue-1" });
      const statesFn = vi.fn().mockResolvedValue(null);
      const teamFn = vi.fn().mockResolvedValue({ id: "team-1", key: "PRY", states: statesFn });
      const updateIssue = vi.fn();
      installFakeSdk(client, {
        issue: vi.fn().mockResolvedValue(fakeIssue),
        team: teamFn,
        updateIssue,
      });

      await client.updateIssueState("issue-1", "Done");

      expect(updateIssue).not.toHaveBeenCalled();
      expect(logger.warn).toHaveBeenCalledWith(
        { issueId: "issue-1", stateName: "Done", teamId: "team-1" },
        "Could not find workflow state by name",
      );
    });
  });

  describe("addLabel", () => {
    it("adds a new label id to an issue lacking it", async () => {
      const fakeIssue = makeFakeIssue({ id: "issue-1", labelIds: ["existing-id"] });
      const issueLabels = vi.fn().mockResolvedValue({ nodes: [{ id: "label-id", name: "bug" }] });
      const updateIssue = vi.fn().mockResolvedValue({});
      installFakeSdk(client, {
        issue: vi.fn().mockResolvedValue(fakeIssue),
        issueLabels,
        updateIssue,
      });

      await client.addLabel("issue-1", "bug");

      expect(updateIssue).toHaveBeenCalledWith("issue-1", {
        labelIds: ["existing-id", "label-id"],
      });
    });

    it("does not duplicate a label id already present on the issue", async () => {
      const fakeIssue = makeFakeIssue({ id: "issue-1", labelIds: ["label-id"] });
      const issueLabels = vi.fn().mockResolvedValue({ nodes: [{ id: "label-id", name: "bug" }] });
      const updateIssue = vi.fn();
      installFakeSdk(client, {
        issue: vi.fn().mockResolvedValue(fakeIssue),
        issueLabels,
        updateIssue,
      });

      await client.addLabel("issue-1", "bug");

      expect(updateIssue).not.toHaveBeenCalled();
    });

    it("creates a new label when none exists, scoped to the issue's team", async () => {
      const fakeIssue = makeFakeIssue({ id: "issue-1", labelIds: [] });
      const issueLabels = vi.fn().mockResolvedValue({ nodes: [] });
      const createIssueLabel = vi.fn().mockResolvedValue({
        issueLabel: Promise.resolve({ id: "new-label-id" }),
      });
      const updateIssue = vi.fn().mockResolvedValue({});
      installFakeSdk(client, {
        issue: vi.fn().mockResolvedValue(fakeIssue),
        issueLabels,
        createIssueLabel,
        updateIssue,
      });

      await client.addLabel("issue-1", "new-label");

      expect(createIssueLabel).toHaveBeenCalledWith({ name: "new-label", teamId: "team-1" });
      expect(updateIssue).toHaveBeenCalledWith("issue-1", { labelIds: ["new-label-id"] });
      expect(logger.info).toHaveBeenCalledWith(
        { labelName: "new-label", labelId: "new-label-id" },
        "Created new Linear label",
      );
    });

    it("creates a label without a teamId when the issue has no team", async () => {
      const fakeIssue = makeFakeIssue({ id: "issue-1", labelIds: [], team: Promise.resolve(null) });
      const issueLabels = vi.fn().mockResolvedValue({ nodes: [] });
      const createIssueLabel = vi.fn().mockResolvedValue({
        issueLabel: Promise.resolve({ id: "new-label-id" }),
      });
      const updateIssue = vi.fn().mockResolvedValue({});
      installFakeSdk(client, {
        issue: vi.fn().mockResolvedValue(fakeIssue),
        issueLabels,
        createIssueLabel,
        updateIssue,
      });

      await client.addLabel("issue-1", "new-label");

      expect(createIssueLabel).toHaveBeenCalledWith({ name: "new-label" });
    });

    it("throws when label creation does not return a created label", async () => {
      const fakeIssue = makeFakeIssue({ id: "issue-1", labelIds: [] });
      const issueLabels = vi.fn().mockResolvedValue({ nodes: [] });
      const createIssueLabel = vi.fn().mockResolvedValue({ issueLabel: Promise.resolve(null) });
      installFakeSdk(client, {
        issue: vi.fn().mockResolvedValue(fakeIssue),
        issueLabels,
        createIssueLabel,
      });

      await expect(client.addLabel("issue-1", "broken-label")).rejects.toThrow(
        "Failed to create label: broken-label",
      );
    });

    it("reuses the label cache across calls instead of re-querying issueLabels", async () => {
      const fakeIssue = makeFakeIssue({ id: "issue-1", labelIds: [] });
      const issueLabels = vi.fn().mockResolvedValue({ nodes: [{ id: "label-id", name: "bug" }] });
      const updateIssue = vi.fn().mockResolvedValue({});
      installFakeSdk(client, {
        issue: vi.fn().mockResolvedValue(fakeIssue),
        issueLabels,
        updateIssue,
      });

      await client.addLabel("issue-1", "bug");
      await client.addLabel("issue-1", "bug");

      expect(issueLabels).toHaveBeenCalledTimes(1);
    });
  });

  describe("removeLabel", () => {
    it("looks up the label id via the issue's labels when not cached, and removes it", async () => {
      const fakeIssue = makeFakeIssue({
        id: "issue-1",
        labelIds: ["label-id", "other-id"],
        labels: () => Promise.resolve({ nodes: [{ id: "label-id", name: "bug" }] }),
      });
      const updateIssue = vi.fn().mockResolvedValue({});
      installFakeSdk(client, { issue: vi.fn().mockResolvedValue(fakeIssue), updateIssue });

      await client.removeLabel("issue-1", "bug");

      expect(updateIssue).toHaveBeenCalledWith("issue-1", { labelIds: ["other-id"] });
    });

    it("returns early without updating when the named label is not found on the issue", async () => {
      const fakeIssue = makeFakeIssue({
        id: "issue-1",
        labelIds: ["other-id"],
        labels: () => Promise.resolve({ nodes: [] }),
      });
      const updateIssue = vi.fn();
      installFakeSdk(client, { issue: vi.fn().mockResolvedValue(fakeIssue), updateIssue });

      await client.removeLabel("issue-1", "missing-label");

      expect(updateIssue).not.toHaveBeenCalled();
    });

    it("uses the cached label id on a subsequent call instead of re-fetching labels", async () => {
      const fakeIssue = makeFakeIssue({
        id: "issue-1",
        labelIds: ["label-id"],
        labels: () => Promise.resolve({ nodes: [{ id: "label-id", name: "bug" }] }),
      });
      const updateIssue = vi.fn().mockResolvedValue({});
      installFakeSdk(client, { issue: vi.fn().mockResolvedValue(fakeIssue), updateIssue });

      // First call populates the cache via listLabels.
      await client.listLabels("issue-1");
      await client.removeLabel("issue-1", "bug");

      expect(updateIssue).toHaveBeenCalledWith("issue-1", { labelIds: [] });
    });
  });

  describe("getRelatedContext blocker hydration failure", () => {
    it("logs a warning and drops a blocker whose relation.issue rejects, keeping the rest", async () => {
      const goodBlocker = makeFakeIssue({ id: "blocker-good", identifier: "PRY-2" });
      const focusIssue = {
        id: "focus-id",
        parent: Promise.resolve(null),
        inverseRelations: () =>
          Promise.resolve({
            nodes: [
              { id: "rel-broken", type: "blocks", issue: Promise.reject(new Error("gql error")) },
              { id: "rel-good", type: "blocks", issue: Promise.resolve(goodBlocker) },
            ],
          }),
      };
      const issueFn = vi.fn().mockImplementation((id: string) => {
        if (id === "focus-id") return Promise.resolve(focusIssue);
        throw new Error(`unexpected issue lookup: ${id}`);
      });
      installFakeSdk(client, { issue: issueFn });

      const ctx = await client.getRelatedContext("focus-id");

      expect(ctx.blockers).toHaveLength(1);
      expect(ctx.blockers[0].id).toBe("blocker-good");
      expect(logger.warn).toHaveBeenCalledWith(
        {
          err: expect.any(Error),
          relationId: "rel-broken",
          focusIssueId: "focus-id",
        },
        "Failed to hydrate blocker issue from relation",
      );
    });
  });

  describe("getRelatedContext related-issue state fallback", () => {
    it("falls back to 'Unknown' state for a related blocker whose state resolves to null", async () => {
      const blocker = makeFakeIssue({
        id: "blocker-id",
        identifier: "PRY-9",
        state: Promise.resolve(null),
      });
      const focusIssue = {
        id: "focus-id",
        parent: Promise.resolve(null),
        inverseRelations: () =>
          Promise.resolve({
            nodes: [{ id: "rel-1", type: "blocks", issue: Promise.resolve(blocker) }],
          }),
      };
      installFakeSdk(client, { issue: vi.fn().mockResolvedValue(focusIssue) });

      const ctx = await client.getRelatedContext("focus-id");

      expect(ctx.blockers[0].state).toBe("Unknown");
    });

    it("falls back to an empty labels array for a related parent with a null labels connection", async () => {
      const parent = makeFakeIssue({
        id: "parent-id",
        identifier: "PRY-8",
        labels: () => Promise.resolve(null),
      });
      const focusIssue = {
        id: "focus-id",
        parent: Promise.resolve(parent),
        inverseRelations: () => Promise.resolve({ nodes: [] }),
      };
      installFakeSdk(client, { issue: vi.fn().mockResolvedValue(focusIssue) });

      const ctx = await client.getRelatedContext("focus-id");

      expect(ctx.parent?.labels).toEqual([]);
    });

    it("treats a null inverseRelations connection as no blockers", async () => {
      const focusIssue = {
        id: "focus-id",
        parent: Promise.resolve(null),
        inverseRelations: () => Promise.resolve(null),
      };
      installFakeSdk(client, { issue: vi.fn().mockResolvedValue(focusIssue) });

      const ctx = await client.getRelatedContext("focus-id");

      expect(ctx.blockers).toEqual([]);
    });
  });

  describe("listLabels", () => {
    it("returns label names and populates the label cache", async () => {
      const fakeIssue = makeFakeIssue({
        id: "issue-1",
        labels: () =>
          Promise.resolve({
            nodes: [
              { id: "l1", name: "bug" },
              { id: "l2", name: "urgent" },
            ],
          }),
      });
      installFakeSdk(client, { issue: vi.fn().mockResolvedValue(fakeIssue) });

      const result = await client.listLabels("issue-1");

      expect(result).toEqual(["bug", "urgent"]);
    });

    it("returns an empty array when the issue has no labels connection", async () => {
      const fakeIssue = makeFakeIssue({ id: "issue-1", labels: () => Promise.resolve(null) });
      installFakeSdk(client, { issue: vi.fn().mockResolvedValue(fakeIssue) });

      const result = await client.listLabels("issue-1");

      expect(result).toEqual([]);
    });
  });
});
