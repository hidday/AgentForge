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

function makeSdkIssue(overrides: Record<string, unknown> = {}) {
  return {
    id: "issue-1",
    identifier: "PRY-1",
    title: "Issue title",
    description: "Issue description",
    branchName: "ai/issue-1",
    priority: 0,
    url: "https://linear.app/team/issue/PRY-1",
    labelIds: ["label-a"],
    labels: () => Promise.resolve({ nodes: [{ id: "label-a", name: "foo" }] }),
    state: Promise.resolve({ id: "state-1", name: "Todo" }),
    project: Promise.resolve(null),
    cycle: Promise.resolve(null),
    team: Promise.resolve({ id: "team-1", key: "PRY" }),
    ...overrides,
  };
}

function makeClient() {
  const client = new RealLinearClient("test-key", makeLogger() as never);
  const sdk: Record<string, unknown> = {};
  (client as unknown as { sdk: unknown }).sdk = sdk;
  return { client, sdk };
}

describe("RealLinearClient", () => {
  describe("getRelatedContext blocker hydration failure", () => {
    it("drops a blocker whose relation.issue rejects and logs a warning", async () => {
      const { client, sdk } = makeClient();
      const logger = (client as unknown as { logger: ReturnType<typeof makeLogger> }).logger;
      const goodBlocker = makeSdkIssue({ id: "blocker-ok" });
      const focus = makeSdkIssue({
        id: "focus-id",
        parent: Promise.resolve(null),
        inverseRelations: () =>
          Promise.resolve({
            nodes: [
              { id: "rel-1", type: "blocks", issue: Promise.reject(new Error("fetch failed")) },
              { id: "rel-2", type: "blocks", issue: Promise.resolve(goodBlocker) },
            ],
          }),
      });
      sdk.issue = vi.fn().mockResolvedValue(focus);

      const ctx = await client.getRelatedContext("focus-id");

      expect(ctx.blockers).toHaveLength(1);
      expect(ctx.blockers[0].id).toBe("blocker-ok");
      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ relationId: "rel-1", focusIssueId: "focus-id" }),
        expect.any(String),
      );
    });
  });

  describe("getIssue", () => {
    it("maps an SDK issue to a LinearIssue, defaulting missing relations", async () => {
      const { client, sdk } = makeClient();
      sdk.issue = vi.fn().mockResolvedValue(
        makeSdkIssue({
          state: Promise.resolve(null),
          project: Promise.resolve(null),
          cycle: Promise.resolve(null),
          team: Promise.resolve(null),
          labels: () => Promise.resolve({ nodes: [] }),
        }),
      );

      const issue = await client.getIssue("issue-1");

      expect(issue).toEqual({
        id: "issue-1",
        identifier: "PRY-1",
        title: "Issue title",
        description: "Issue description",
        branchName: "ai/issue-1",
        state: "Unknown",
        labels: [],
        priority: 0,
        url: "https://linear.app/team/issue/PRY-1",
        project: undefined,
        team: undefined,
        cycle: undefined,
      });
    });

    it("maps project/team/cycle when present", async () => {
      const { client, sdk } = makeClient();
      sdk.issue = vi.fn().mockResolvedValue(
        makeSdkIssue({
          project: Promise.resolve({ name: "Core" }),
          cycle: Promise.resolve({ name: "Cycle 4" }),
        }),
      );

      const issue = await client.getIssue("issue-1");

      expect(issue.project).toBe("Core");
      expect(issue.team).toBe("PRY");
      expect(issue.cycle).toBe("Cycle 4");
      expect(issue.labels).toEqual(["foo"]);
    });
  });

  describe("searchIssues", () => {
    it("builds a filter scoped by project, assignee, and team (name or key)", async () => {
      const { client, sdk } = makeClient();
      const issuesFn = vi.fn().mockResolvedValue({ nodes: [] });
      sdk.issues = issuesFn;

      await client.searchIssues({
        state: "Todo",
        projectName: "Core",
        assigneeMe: true,
        team: "PRY",
      });

      expect(issuesFn).toHaveBeenCalledWith({
        filter: {
          state: { name: { eq: "Todo" } },
          project: { name: { eq: "Core" } },
          assignee: { isMe: { eq: true } },
          team: { or: [{ name: { eq: "PRY" } }, { key: { eq: "PRY" } }] },
        },
      });
    });

    it("maps result issues and defaults an undefined nodes list to empty", async () => {
      const { client, sdk } = makeClient();
      sdk.issues = vi.fn().mockResolvedValue({ nodes: [makeSdkIssue({ id: "found-1" })] });

      const results = await client.searchIssues({ state: "Todo" });

      expect(results).toHaveLength(1);
      expect(results[0]).toMatchObject({ id: "found-1", state: "Todo" });
    });

    it("returns an empty array when the SDK response has no issues connection", async () => {
      const { client, sdk } = makeClient();
      sdk.issues = vi.fn().mockResolvedValue(undefined);

      const results = await client.searchIssues({ state: "Todo" });

      expect(results).toEqual([]);
    });
  });

  describe("postComment", () => {
    it("creates a comment via the SDK", async () => {
      const { client, sdk } = makeClient();
      const createComment = vi.fn().mockResolvedValue({});
      sdk.createComment = createComment;

      await client.postComment("issue-1", "hello");

      expect(createComment).toHaveBeenCalledWith({ issueId: "issue-1", body: "hello" });
    });
  });

  describe("updateIssueState", () => {
    it("warns and returns early when the issue has no team", async () => {
      const { client, sdk } = makeClient();
      sdk.issue = vi.fn().mockResolvedValue(makeSdkIssue({ team: Promise.resolve(null) }));
      const updateIssue = vi.fn();
      sdk.updateIssue = updateIssue;

      await client.updateIssueState("issue-1", "Done");

      expect(updateIssue).not.toHaveBeenCalled();
    });

    it("warns and returns early when the named state cannot be resolved", async () => {
      const { client, sdk } = makeClient();
      sdk.issue = vi.fn().mockResolvedValue(makeSdkIssue());
      sdk.team = vi.fn().mockResolvedValue({ states: () => Promise.resolve({ nodes: [] }) });
      const updateIssue = vi.fn();
      sdk.updateIssue = updateIssue;

      await client.updateIssueState("issue-1", "Nonexistent");

      expect(updateIssue).not.toHaveBeenCalled();
    });

    it("resolves the state id and updates the issue, caching the team's states", async () => {
      const { client, sdk } = makeClient();
      sdk.issue = vi.fn().mockResolvedValue(makeSdkIssue());
      const statesFn = vi.fn().mockResolvedValue({ nodes: [{ id: "state-done", name: "Done" }] });
      const teamFn = vi.fn().mockResolvedValue({ states: statesFn });
      sdk.team = teamFn;
      const updateIssue = vi.fn().mockResolvedValue({});
      sdk.updateIssue = updateIssue;

      await client.updateIssueState("issue-1", "Done");
      await client.updateIssueState("issue-1", "Done");

      expect(updateIssue).toHaveBeenCalledWith("issue-1", { stateId: "state-done" });
      // The team's workflow states are cached per team id, so `team()` is only fetched once
      // even though updateIssueState was called twice for the same team.
      expect(teamFn).toHaveBeenCalledTimes(1);
    });
  });

  describe("addLabel", () => {
    it("adds a newly created label id when the issue does not already have it", async () => {
      const { client, sdk } = makeClient();
      sdk.issue = vi.fn().mockResolvedValue(makeSdkIssue({ labelIds: [] }));
      sdk.issueLabels = vi.fn().mockResolvedValue({ nodes: [] });
      const createdLabel = { id: "new-label-id" };
      sdk.createIssueLabel = vi.fn().mockResolvedValue({ issueLabel: Promise.resolve(createdLabel) });
      const updateIssue = vi.fn().mockResolvedValue({});
      sdk.updateIssue = updateIssue;

      await client.addLabel("issue-1", "urgent");

      expect(updateIssue).toHaveBeenCalledWith("issue-1", { labelIds: ["new-label-id"] });
    });

    it("reuses an existing label by name and does not duplicate an already-applied id", async () => {
      const { client, sdk } = makeClient();
      sdk.issue = vi.fn().mockResolvedValue(makeSdkIssue({ labelIds: ["existing-id"] }));
      sdk.issueLabels = vi.fn().mockResolvedValue({ nodes: [{ id: "existing-id" }] });
      const updateIssue = vi.fn();
      sdk.updateIssue = updateIssue;

      await client.addLabel("issue-1", "urgent");

      expect(updateIssue).not.toHaveBeenCalled();
    });

    it("throws when label creation does not return a created label", async () => {
      const { client, sdk } = makeClient();
      sdk.issue = vi.fn().mockResolvedValue(makeSdkIssue({ labelIds: [] }));
      sdk.issueLabels = vi.fn().mockResolvedValue({ nodes: [] });
      sdk.createIssueLabel = vi.fn().mockResolvedValue({ issueLabel: Promise.resolve(null) });

      await expect(client.addLabel("issue-1", "urgent")).rejects.toThrow(
        /Failed to create label: urgent/,
      );
    });
  });

  describe("removeLabel", () => {
    it("removes a label resolved by name when not yet cached", async () => {
      const { client, sdk } = makeClient();
      sdk.issue = vi.fn().mockResolvedValue(
        makeSdkIssue({
          labelIds: ["label-a", "label-b"],
          labels: () =>
            Promise.resolve({ nodes: [{ id: "label-a", name: "foo" }, { id: "label-b", name: "bar" }] }),
        }),
      );
      const updateIssue = vi.fn().mockResolvedValue({});
      sdk.updateIssue = updateIssue;

      await client.removeLabel("issue-1", "foo");

      expect(updateIssue).toHaveBeenCalledWith("issue-1", { labelIds: ["label-b"] });
    });

    it("is a no-op when the named label is not found on the issue", async () => {
      const { client, sdk } = makeClient();
      sdk.issue = vi.fn().mockResolvedValue(
        makeSdkIssue({ labelIds: ["label-b"], labels: () => Promise.resolve({ nodes: [{ id: "label-b", name: "bar" }] }) }),
      );
      const updateIssue = vi.fn();
      sdk.updateIssue = updateIssue;

      await client.removeLabel("issue-1", "missing-label");

      expect(updateIssue).not.toHaveBeenCalled();
    });

    it("uses the cached label id on a subsequent call without re-fetching labels", async () => {
      const { client, sdk } = makeClient();
      const labelsFn = vi.fn().mockResolvedValue({
        nodes: [{ id: "label-a", name: "foo" }],
      });
      sdk.issue = vi.fn().mockResolvedValue(
        makeSdkIssue({ labelIds: ["label-a"], labels: labelsFn }),
      );
      sdk.updateIssue = vi.fn().mockResolvedValue({});

      await client.removeLabel("issue-1", "foo");
      await client.removeLabel("issue-1", "foo");

      expect(labelsFn).toHaveBeenCalledTimes(1);
    });
  });

  describe("listLabels", () => {
    it("returns label names and populates the label cache", async () => {
      const { client, sdk } = makeClient();
      sdk.issue = vi.fn().mockResolvedValue(
        makeSdkIssue({
          labels: () => Promise.resolve({ nodes: [{ id: "label-a", name: "foo" }] }),
        }),
      );

      const labels = await client.listLabels("issue-1");

      expect(labels).toEqual(["foo"]);
    });

    it("returns an empty array when the issue has no labels connection", async () => {
      const { client, sdk } = makeClient();
      sdk.issue = vi.fn().mockResolvedValue(makeSdkIssue({ labels: () => Promise.resolve(undefined) }));

      await expect(client.listLabels("issue-1")).resolves.toEqual([]);
    });
  });
});
