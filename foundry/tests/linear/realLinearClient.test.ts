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
    project: Promise.resolve({ name: "Project A" }),
    cycle: Promise.resolve({ name: "Cycle 1" }),
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

function makeFakeSdk() {
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

type FakeSdk = ReturnType<typeof makeFakeSdk>;

function injectSdk(client: RealLinearClient, sdk: FakeSdk): void {
  (client as unknown as { sdk: FakeSdk }).sdk = sdk;
}

describe("RealLinearClient", () => {
  let sdk: FakeSdk;
  let logger: ReturnType<typeof makeLogger>;
  let client: RealLinearClient;

  beforeEach(() => {
    sdk = makeFakeSdk();
    logger = makeLogger();
    client = new RealLinearClient("api-key", logger as never);
    injectSdk(client, sdk);
  });

  describe("getIssue", () => {
    it("maps a fully populated SDK issue", async () => {
      const issue = makeFakeIssue({
        id: "issue-1",
        labels: () => Promise.resolve({ nodes: [{ id: "l1", name: "bug" }] }),
      });
      sdk.issue.mockResolvedValue(issue);

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
        project: "Project A",
        team: "PRY",
        cycle: "Cycle 1",
      });
    });

    it("falls back to defaults when optional fields are null/absent", async () => {
      const issue = makeFakeIssue({
        id: "issue-2",
        description: null,
        state: Promise.resolve(null),
        project: Promise.resolve(null),
        cycle: Promise.resolve(null),
        team: Promise.resolve(null),
        // Simulate the labels connection itself being absent (not just empty)
        // to exercise the `labelsConn?.nodes?.map(...) ?? []` fallback branch.
        labels: () => Promise.resolve(undefined as unknown as { nodes: never[] }),
      });
      sdk.issue.mockResolvedValue(issue);

      const result = await client.getIssue("issue-2");

      expect(result.description).toBe("");
      expect(result.state).toBe("Unknown");
      expect(result.project).toBeUndefined();
      expect(result.team).toBeUndefined();
      expect(result.cycle).toBeUndefined();
      expect(result.labels).toEqual([]);
    });
  });

  describe("getRelatedContext blocker hydration failure", () => {
    it("skips a blocker relation whose issue fails to hydrate, logging a warning", async () => {
      const okBlocker = makeFakeIssue({ id: "blocker-ok" });
      const focus = makeFakeIssue({
        id: "focus-id",
        team: Promise.resolve(null),
      });
      // RealLinearClient.getRelatedContext relies on `issue.parent` and
      // `issue.inverseRelations`, neither of which are part of FakeIssue by
      // default here, so extend the focus issue inline.
      (focus as unknown as { parent: Promise<null> }).parent = Promise.resolve(null);
      (
        focus as unknown as {
          inverseRelations: () => Promise<{
            nodes: Array<{ id: string; type: string; issue: Promise<unknown> }>;
          }>;
        }
      ).inverseRelations = () =>
        Promise.resolve({
          nodes: [
            { id: "rel-broken", type: "blocks", issue: Promise.reject(new Error("fetch failed")) },
            { id: "rel-ok", type: "blocks", issue: Promise.resolve(okBlocker) },
          ],
        });

      sdk.issue.mockResolvedValue(focus);

      const ctx = await client.getRelatedContext("focus-id");

      expect(ctx.blockers).toHaveLength(1);
      expect(ctx.blockers[0].id).toBe("blocker-ok");
      expect(logger.warn).toHaveBeenCalled();
    });

    it("treats a missing inverseRelations connection as having no blockers", async () => {
      const focus = makeFakeIssue({ id: "focus-id" });
      (focus as unknown as { parent: Promise<null> }).parent = Promise.resolve(null);
      (
        focus as unknown as { inverseRelations: () => Promise<undefined> }
      ).inverseRelations = () => Promise.resolve(undefined);

      sdk.issue.mockResolvedValue(focus);

      const ctx = await client.getRelatedContext("focus-id");

      expect(ctx.blockers).toEqual([]);
    });

    it("falls back to 'Unknown' state and empty labels for a related issue missing both", async () => {
      const parent = makeFakeIssue({
        id: "parent-id",
        state: Promise.resolve(null),
        labels: () => Promise.resolve(undefined as unknown as { nodes: never[] }),
      });
      const focus = makeFakeIssue({ id: "focus-id" });
      (focus as unknown as { parent: Promise<FakeIssue> }).parent = Promise.resolve(parent);
      (
        focus as unknown as { inverseRelations: () => Promise<{ nodes: never[] }> }
      ).inverseRelations = () => Promise.resolve({ nodes: [] });

      sdk.issue.mockResolvedValue(focus);

      const ctx = await client.getRelatedContext("focus-id");

      expect(ctx.parent?.state).toBe("Unknown");
      expect(ctx.parent?.labels).toEqual([]);
    });
  });

  describe("searchIssues", () => {
    it("builds a filter with projectName, assigneeMe and team and maps results", async () => {
      const issue1 = makeFakeIssue({
        id: "issue-1",
        labels: () => Promise.resolve({ nodes: [{ id: "l1", name: "bug" }] }),
      });
      const issue2 = makeFakeIssue({ id: "issue-2" });
      sdk.issues.mockResolvedValue({ nodes: [issue1, issue2] });

      const results = await client.searchIssues({
        state: "Todo",
        projectName: "Project A",
        assigneeMe: true,
        team: "PRY",
      });

      expect(sdk.issues).toHaveBeenCalledWith({
        filter: {
          state: { name: { eq: "Todo" } },
          project: { name: { eq: "Project A" } },
          assignee: { isMe: { eq: true } },
          team: { or: [{ name: { eq: "PRY" } }, { key: { eq: "PRY" } }] },
        },
      });
      expect(results).toHaveLength(2);
      expect(results[0].labels).toEqual(["bug"]);
      expect(results[0].state).toBe("Todo");
      expect(logger.info).toHaveBeenCalled();
    });

    it("builds a minimal filter when projectName, assigneeMe and team are absent", async () => {
      sdk.issues.mockResolvedValue({ nodes: [] });

      const results = await client.searchIssues({ state: "Done" });

      expect(sdk.issues).toHaveBeenCalledWith({
        filter: { state: { name: { eq: "Done" } } },
      });
      expect(results).toEqual([]);
    });

    it("treats a missing issues connection as empty", async () => {
      sdk.issues.mockResolvedValue(undefined);
      const results = await client.searchIssues({ state: "Done" });
      expect(results).toEqual([]);
    });

    it("falls back to defaults for an issue with null description/project/team/cycle and no labels connection", async () => {
      const issue = makeFakeIssue({
        id: "issue-1",
        description: null,
        project: Promise.resolve(null),
        cycle: Promise.resolve(null),
        team: Promise.resolve(null),
        labels: () => Promise.resolve(undefined as unknown as { nodes: never[] }),
      });
      sdk.issues.mockResolvedValue({ nodes: [issue] });

      const [result] = await client.searchIssues({ state: "Todo" });

      expect(result.description).toBe("");
      expect(result.project).toBeUndefined();
      expect(result.team).toBeUndefined();
      expect(result.cycle).toBeUndefined();
      expect(result.labels).toEqual([]);
    });
  });

  describe("postComment", () => {
    it("creates a comment via the SDK", async () => {
      sdk.createComment.mockResolvedValue({});
      await client.postComment("issue-1", "hello world");
      expect(sdk.createComment).toHaveBeenCalledWith({ issueId: "issue-1", body: "hello world" });
      expect(logger.debug).toHaveBeenCalled();
    });
  });

  describe("updateIssueState", () => {
    it("warns and returns early when the issue has no team", async () => {
      const issue = makeFakeIssue({ id: "issue-1", team: Promise.resolve(null) });
      sdk.issue.mockResolvedValue(issue);

      await client.updateIssueState("issue-1", "Done");

      expect(logger.warn).toHaveBeenCalled();
      expect(sdk.updateIssue).not.toHaveBeenCalled();
    });

    it("warns and returns early when no workflow state matches the name", async () => {
      const issue = makeFakeIssue({ id: "issue-1" });
      sdk.issue.mockResolvedValue(issue);
      sdk.team.mockResolvedValue({
        id: "team-1",
        states: () => Promise.resolve({ nodes: [{ id: "s1", name: "Todo" }] }),
      });

      await client.updateIssueState("issue-1", "Nonexistent State");

      expect(logger.warn).toHaveBeenCalled();
      expect(sdk.updateIssue).not.toHaveBeenCalled();
    });

    it("updates the issue state when a matching workflow state is found", async () => {
      const issue = makeFakeIssue({ id: "issue-1" });
      sdk.issue.mockResolvedValue(issue);
      sdk.team.mockResolvedValue({
        id: "team-1",
        states: () =>
          Promise.resolve({
            nodes: [
              { id: "s1", name: "Todo" },
              { id: "s2", name: "Done" },
            ],
          }),
      });

      await client.updateIssueState("issue-1", "Done");

      expect(sdk.updateIssue).toHaveBeenCalledWith("issue-1", { stateId: "s2" });
    });

    it("caches the team's workflow states across calls", async () => {
      const issue = makeFakeIssue({ id: "issue-1" });
      sdk.issue.mockResolvedValue(issue);
      sdk.team.mockResolvedValue({
        id: "team-1",
        states: () => Promise.resolve({ nodes: [{ id: "s2", name: "Done" }] }),
      });

      await client.updateIssueState("issue-1", "Done");
      await client.updateIssueState("issue-1", "Done");

      expect(sdk.team).toHaveBeenCalledTimes(1);
      expect(sdk.updateIssue).toHaveBeenCalledTimes(2);
    });
  });

  describe("addLabel", () => {
    it("creates a brand-new label (no cache, no existing match) and adds it", async () => {
      const issue = makeFakeIssue({ id: "issue-1", labelIds: [] });
      sdk.issue.mockResolvedValue(issue);
      sdk.issueLabels.mockResolvedValue({ nodes: [] });
      sdk.createIssueLabel.mockResolvedValue({
        issueLabel: Promise.resolve({ id: "new-label-id" }),
      });

      await client.addLabel("issue-1", "feature");

      expect(sdk.createIssueLabel).toHaveBeenCalledWith({ name: "feature", teamId: "team-1" });
      expect(sdk.updateIssue).toHaveBeenCalledWith("issue-1", { labelIds: ["new-label-id"] });
      expect(logger.info).toHaveBeenCalled();
    });

    it("creates a label without a teamId when the issue has no team", async () => {
      const issue = makeFakeIssue({ id: "issue-1", labelIds: [], team: Promise.resolve(null) });
      sdk.issue.mockResolvedValue(issue);
      sdk.issueLabels.mockResolvedValue({ nodes: [] });
      sdk.createIssueLabel.mockResolvedValue({
        issueLabel: Promise.resolve({ id: "new-label-id" }),
      });

      await client.addLabel("issue-1", "feature");

      expect(sdk.createIssueLabel).toHaveBeenCalledWith({ name: "feature" });
    });

    it("throws when label creation does not return an issueLabel", async () => {
      const issue = makeFakeIssue({ id: "issue-1", labelIds: [] });
      sdk.issue.mockResolvedValue(issue);
      sdk.issueLabels.mockResolvedValue({ nodes: [] });
      sdk.createIssueLabel.mockResolvedValue({ issueLabel: Promise.resolve(undefined) });

      await expect(client.addLabel("issue-1", "feature")).rejects.toThrow(
        "Failed to create label: feature",
      );
    });

    it("reuses an existing label found via issueLabels instead of creating one", async () => {
      const issue = makeFakeIssue({ id: "issue-1", labelIds: [] });
      sdk.issue.mockResolvedValue(issue);
      sdk.issueLabels.mockResolvedValue({ nodes: [{ id: "existing-label-id" }] });

      await client.addLabel("issue-1", "bug");

      expect(sdk.createIssueLabel).not.toHaveBeenCalled();
      expect(sdk.updateIssue).toHaveBeenCalledWith("issue-1", { labelIds: ["existing-label-id"] });
    });

    it("skips updateIssue when the label is already attached to the issue", async () => {
      const issue = makeFakeIssue({ id: "issue-1", labelIds: ["existing-label-id"] });
      sdk.issue.mockResolvedValue(issue);
      sdk.issueLabels.mockResolvedValue({ nodes: [{ id: "existing-label-id" }] });

      await client.addLabel("issue-1", "bug");

      expect(sdk.updateIssue).not.toHaveBeenCalled();
    });

    it("uses the label cache on a second call for the same label name", async () => {
      const issue1 = makeFakeIssue({ id: "issue-1", labelIds: [] });
      const issue2 = makeFakeIssue({ id: "issue-2", labelIds: [] });
      sdk.issue.mockResolvedValueOnce(issue1).mockResolvedValueOnce(issue2);
      sdk.issueLabels.mockResolvedValue({ nodes: [{ id: "cached-label-id" }] });

      await client.addLabel("issue-1", "bug");
      await client.addLabel("issue-2", "bug");

      expect(sdk.issueLabels).toHaveBeenCalledTimes(1);
      expect(sdk.updateIssue).toHaveBeenNthCalledWith(2, "issue-2", {
        labelIds: ["cached-label-id"],
      });
    });
  });

  describe("removeLabel", () => {
    it("looks up the label via issue.labels() and removes it when found", async () => {
      const issue = makeFakeIssue({
        id: "issue-1",
        labelIds: ["label-a", "label-b"],
        labels: () =>
          Promise.resolve({
            nodes: [
              { id: "label-a", name: "bug" },
              { id: "label-b", name: "feature" },
            ],
          }),
      });
      sdk.issue.mockResolvedValue(issue);

      await client.removeLabel("issue-1", "bug");

      expect(sdk.updateIssue).toHaveBeenCalledWith("issue-1", { labelIds: ["label-b"] });
      expect(logger.debug).toHaveBeenCalled();
    });

    it("is a no-op when the label name is not found on the issue", async () => {
      const issue = makeFakeIssue({
        id: "issue-1",
        labelIds: ["label-b"],
        labels: () => Promise.resolve({ nodes: [{ id: "label-b", name: "feature" }] }),
      });
      sdk.issue.mockResolvedValue(issue);

      await client.removeLabel("issue-1", "nonexistent");

      expect(sdk.updateIssue).not.toHaveBeenCalled();
    });

    it("uses the cached label id on a subsequent call instead of calling labels() again", async () => {
      const labelsSpy = vi
        .fn()
        .mockResolvedValue({ nodes: [{ id: "label-a", name: "bug" }] });
      const issue1 = makeFakeIssue({
        id: "issue-1",
        labelIds: ["label-a"],
        labels: labelsSpy,
      });
      const issue2 = makeFakeIssue({ id: "issue-2", labelIds: ["label-a"], labels: labelsSpy });
      sdk.issue.mockResolvedValueOnce(issue1).mockResolvedValueOnce(issue2);

      await client.removeLabel("issue-1", "bug");
      expect(labelsSpy).toHaveBeenCalledTimes(1);

      await client.removeLabel("issue-2", "bug");
      expect(labelsSpy).toHaveBeenCalledTimes(1);
      expect(sdk.updateIssue).toHaveBeenNthCalledWith(2, "issue-2", { labelIds: [] });
    });
  });

  describe("listLabels", () => {
    it("returns label names and populates the label cache for later removeLabel calls", async () => {
      const labelsSpy = vi
        .fn()
        .mockResolvedValue({ nodes: [{ id: "label-a", name: "bug" }] });
      const issue = makeFakeIssue({ id: "issue-1", labelIds: ["label-a"], labels: labelsSpy });
      sdk.issue.mockResolvedValue(issue);

      const names = await client.listLabels("issue-1");
      expect(names).toEqual(["bug"]);

      // The cache populated by listLabels should let removeLabel skip calling
      // issue.labels() again.
      await client.removeLabel("issue-1", "bug");
      expect(labelsSpy).toHaveBeenCalledTimes(1);
      expect(sdk.updateIssue).toHaveBeenCalledWith("issue-1", { labelIds: [] });
    });

    it("returns an empty array when the issue has no labels", async () => {
      const issue = makeFakeIssue({ id: "issue-1", labels: () => Promise.resolve({ nodes: [] }) });
      sdk.issue.mockResolvedValue(issue);

      await expect(client.listLabels("issue-1")).resolves.toEqual([]);
    });

    it("returns an empty array when the labels connection itself is missing", async () => {
      const issue = makeFakeIssue({
        id: "issue-1",
        labels: () => Promise.resolve(undefined as unknown as { nodes: never[] }),
      });
      sdk.issue.mockResolvedValue(issue);

      await expect(client.listLabels("issue-1")).resolves.toEqual([]);
    });
  });

  describe("resolveStateId via updateIssueState", () => {
    it("treats a missing workflow states connection as having no states", async () => {
      const issue = makeFakeIssue({ id: "issue-1" });
      sdk.issue.mockResolvedValue(issue);
      sdk.team.mockResolvedValue({
        id: "team-1",
        states: () => Promise.resolve(undefined),
      });

      await client.updateIssueState("issue-1", "Done");

      expect(logger.warn).toHaveBeenCalled();
      expect(sdk.updateIssue).not.toHaveBeenCalled();
    });
  });
});
