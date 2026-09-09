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

function buildClient() {
  const logger = makeLogger();
  const client = new RealLinearClient("test-key", logger as never);
  const sdk = {
    issue: vi.fn(),
    issues: vi.fn(),
    createComment: vi.fn(),
    updateIssue: vi.fn(),
    team: vi.fn(),
    issueLabels: vi.fn(),
    createIssueLabel: vi.fn(),
  };
  (client as unknown as { sdk: typeof sdk }).sdk = sdk;
  return { client, sdk, logger };
}

describe("RealLinearClient", () => {
  describe("getIssue", () => {
    it("maps SDK fields to LinearIssue, defaulting missing state/description", async () => {
      const { client, sdk } = buildClient();
      const issue = makeFakeIssue({
        id: "issue-1",
        description: null,
        state: Promise.resolve(null),
        project: Promise.resolve({ name: "Backend" }),
        cycle: Promise.resolve({ name: "Sprint 1" }),
      });
      sdk.issue.mockResolvedValue(issue);

      const result = await client.getIssue("issue-1");

      expect(result).toEqual({
        id: "issue-1",
        identifier: "PRY-1",
        title: "Issue title",
        description: "",
        branchName: "ai/issue-1",
        state: "Unknown",
        labels: [],
        priority: 0,
        url: "https://linear.app/team/issue/PRY-1",
        project: "Backend",
        team: "PRY",
        cycle: "Sprint 1",
      });
    });

    it("includes labels from the labels connection", async () => {
      const { client, sdk } = buildClient();
      const issue = makeFakeIssue({
        id: "issue-1",
        labels: () => Promise.resolve({ nodes: [{ id: "l1", name: "bug" }] }),
      });
      sdk.issue.mockResolvedValue(issue);

      const result = await client.getIssue("issue-1");
      expect(result.labels).toEqual(["bug"]);
    });
  });

  describe("searchIssues", () => {
    it("builds a GraphQL filter and maps results", async () => {
      const { client, sdk, logger } = buildClient();
      const issue = makeFakeIssue({ id: "issue-1", project: Promise.resolve({ name: "Backend" }) });
      sdk.issues.mockResolvedValue({ nodes: [issue] });

      const results = await client.searchIssues({
        state: "Todo",
        projectName: "Backend",
        assigneeMe: true,
        team: "PRY",
      });

      expect(sdk.issues).toHaveBeenCalledWith({
        filter: {
          state: { name: { eq: "Todo" } },
          project: { name: { eq: "Backend" } },
          assignee: { isMe: { eq: true } },
          team: { or: [{ name: { eq: "PRY" } }, { key: { eq: "PRY" } }] },
        },
      });
      expect(results).toHaveLength(1);
      expect(results[0]).toMatchObject({ id: "issue-1", state: "Todo", project: "Backend" });
      expect(logger.info).toHaveBeenCalled();
    });

    it("includes the cycle name on a result row when the issue has a cycle", async () => {
      const { client, sdk } = buildClient();
      const issue = makeFakeIssue({ id: "issue-1", cycle: Promise.resolve({ name: "Sprint 5" }) });
      sdk.issues.mockResolvedValue({ nodes: [issue] });

      const [result] = await client.searchIssues({ state: "Todo" });

      expect(result.cycle).toBe("Sprint 5");
    });

    it("omits optional filter fields and defaults to an empty result set", async () => {
      const { client, sdk } = buildClient();
      sdk.issues.mockResolvedValue({ nodes: [] });

      const results = await client.searchIssues({ state: "Done" });

      expect(sdk.issues).toHaveBeenCalledWith({ filter: { state: { name: { eq: "Done" } } } });
      expect(results).toEqual([]);
    });

    it("handles a null issues connection", async () => {
      const { client, sdk } = buildClient();
      sdk.issues.mockResolvedValue(null);

      const results = await client.searchIssues({ state: "Done" });
      expect(results).toEqual([]);
    });
  });

  describe("postComment", () => {
    it("creates a comment via the SDK", async () => {
      const { client, sdk, logger } = buildClient();
      sdk.createComment.mockResolvedValue({});

      await client.postComment("issue-1", "Great work");

      expect(sdk.createComment).toHaveBeenCalledWith({ issueId: "issue-1", body: "Great work" });
      expect(logger.debug).toHaveBeenCalled();
    });
  });

  describe("updateIssueState", () => {
    it("resolves the state id for the issue's team and updates the issue", async () => {
      const { client, sdk, logger } = buildClient();
      const issue = makeFakeIssue({ id: "issue-1" });
      sdk.issue.mockResolvedValue(issue);
      sdk.team.mockResolvedValue({
        states: () => Promise.resolve({ nodes: [{ id: "state-todo", name: "Todo" }] }),
      });
      sdk.updateIssue.mockResolvedValue({});

      await client.updateIssueState("issue-1", "Todo");

      expect(sdk.updateIssue).toHaveBeenCalledWith("issue-1", { stateId: "state-todo" });
      expect(logger.debug).toHaveBeenCalled();
    });

    it("caches the team's state map across calls (team() called only once)", async () => {
      const { client, sdk } = buildClient();
      const issue = makeFakeIssue({ id: "issue-1" });
      sdk.issue.mockResolvedValue(issue);
      sdk.team.mockResolvedValue({
        states: () =>
          Promise.resolve({ nodes: [{ id: "state-todo", name: "Todo" }, { id: "state-doing", name: "In Progress" }] }),
      });
      sdk.updateIssue.mockResolvedValue({});

      await client.updateIssueState("issue-1", "Todo");
      await client.updateIssueState("issue-1", "In Progress");

      expect(sdk.team).toHaveBeenCalledTimes(1);
      expect(sdk.updateIssue).toHaveBeenNthCalledWith(2, "issue-1", { stateId: "state-doing" });
    });

    it("logs and returns early when the issue has no team", async () => {
      const { client, sdk, logger } = buildClient();
      const issue = makeFakeIssue({ id: "issue-1", team: Promise.resolve(null) });
      sdk.issue.mockResolvedValue(issue);

      await client.updateIssueState("issue-1", "Todo");

      expect(sdk.updateIssue).not.toHaveBeenCalled();
      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ issueId: "issue-1" }),
        expect.stringContaining("no team"),
      );
    });

    it("logs and returns early when the workflow state name cannot be found", async () => {
      const { client, sdk, logger } = buildClient();
      const issue = makeFakeIssue({ id: "issue-1" });
      sdk.issue.mockResolvedValue(issue);
      sdk.team.mockResolvedValue({ states: () => Promise.resolve({ nodes: [] }) });

      await client.updateIssueState("issue-1", "Nonexistent");

      expect(sdk.updateIssue).not.toHaveBeenCalled();
      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ stateName: "Nonexistent" }),
        expect.stringContaining("Could not find workflow state"),
      );
    });
  });

  describe("addLabel", () => {
    it("creates and caches a brand-new label, then adds it to the issue", async () => {
      const { client, sdk, logger } = buildClient();
      const issue = makeFakeIssue({ id: "issue-1", labelIds: [] });
      sdk.issue.mockResolvedValue(issue);
      sdk.issueLabels.mockResolvedValue({ nodes: [] });
      sdk.createIssueLabel.mockResolvedValue({ issueLabel: Promise.resolve({ id: "label-new" }) });
      sdk.updateIssue.mockResolvedValue({});

      await client.addLabel("issue-1", "urgent");

      expect(sdk.createIssueLabel).toHaveBeenCalledWith({ name: "urgent", teamId: "team-1" });
      expect(sdk.updateIssue).toHaveBeenCalledWith("issue-1", { labelIds: ["label-new"] });
      expect(logger.info).toHaveBeenCalled();
    });

    it("reuses an existing label found by name instead of creating one", async () => {
      const { client, sdk } = buildClient();
      const issue = makeFakeIssue({ id: "issue-1", labelIds: [] });
      sdk.issue.mockResolvedValue(issue);
      sdk.issueLabels.mockResolvedValue({ nodes: [{ id: "label-existing" }] });
      sdk.updateIssue.mockResolvedValue({});

      await client.addLabel("issue-1", "urgent");

      expect(sdk.createIssueLabel).not.toHaveBeenCalled();
      expect(sdk.updateIssue).toHaveBeenCalledWith("issue-1", { labelIds: ["label-existing"] });
    });

    it("does not call updateIssue when the label is already present on the issue", async () => {
      const { client, sdk } = buildClient();
      const issue = makeFakeIssue({ id: "issue-1", labelIds: ["label-existing"] });
      sdk.issue.mockResolvedValue(issue);
      sdk.issueLabels.mockResolvedValue({ nodes: [{ id: "label-existing" }] });

      await client.addLabel("issue-1", "urgent");

      expect(sdk.updateIssue).not.toHaveBeenCalled();
    });

    it("reuses a cached label id on a second call without re-querying issueLabels", async () => {
      const { client, sdk } = buildClient();
      const issue1 = makeFakeIssue({ id: "issue-1", labelIds: [] });
      const issue2 = makeFakeIssue({ id: "issue-2", labelIds: [] });
      sdk.issue.mockResolvedValueOnce(issue1).mockResolvedValueOnce(issue2);
      sdk.issueLabels.mockResolvedValue({ nodes: [{ id: "label-existing" }] });
      sdk.updateIssue.mockResolvedValue({});

      await client.addLabel("issue-1", "urgent");
      await client.addLabel("issue-2", "urgent");

      expect(sdk.issueLabels).toHaveBeenCalledTimes(1);
    });

    it("creates a label without a teamId when the issue has no team", async () => {
      const { client, sdk } = buildClient();
      const issue = makeFakeIssue({ id: "issue-1", labelIds: [], team: Promise.resolve(null) });
      sdk.issue.mockResolvedValue(issue);
      sdk.issueLabels.mockResolvedValue({ nodes: [] });
      sdk.createIssueLabel.mockResolvedValue({ issueLabel: Promise.resolve({ id: "label-new" }) });
      sdk.updateIssue.mockResolvedValue({});

      await client.addLabel("issue-1", "urgent");

      expect(sdk.createIssueLabel).toHaveBeenCalledWith({ name: "urgent" });
    });

    it("throws when label creation does not return an issueLabel", async () => {
      const { client, sdk } = buildClient();
      const issue = makeFakeIssue({ id: "issue-1", labelIds: [] });
      sdk.issue.mockResolvedValue(issue);
      sdk.issueLabels.mockResolvedValue({ nodes: [] });
      sdk.createIssueLabel.mockResolvedValue({ issueLabel: Promise.resolve(null) });

      await expect(client.addLabel("issue-1", "urgent")).rejects.toThrow(
        /Failed to create label: urgent/,
      );
    });
  });

  describe("removeLabel", () => {
    it("resolves the label id from the issue's labels when not cached, then removes it", async () => {
      const { client, sdk, logger } = buildClient();
      const issue = makeFakeIssue({
        id: "issue-1",
        labelIds: ["label-1", "label-2"],
        labels: () => Promise.resolve({ nodes: [{ id: "label-1", name: "urgent" }] }),
      });
      sdk.issue.mockResolvedValue(issue);
      sdk.updateIssue.mockResolvedValue({});

      await client.removeLabel("issue-1", "urgent");

      expect(sdk.updateIssue).toHaveBeenCalledWith("issue-1", { labelIds: ["label-2"] });
      expect(logger.debug).toHaveBeenCalled();
    });

    it("is a no-op when the named label is not found on the issue", async () => {
      const { client, sdk } = buildClient();
      const issue = makeFakeIssue({
        id: "issue-1",
        labelIds: ["label-1"],
        labels: () => Promise.resolve({ nodes: [] }),
      });
      sdk.issue.mockResolvedValue(issue);

      await client.removeLabel("issue-1", "missing-label");

      expect(sdk.updateIssue).not.toHaveBeenCalled();
    });

    it("uses the cached label id on a subsequent call without re-fetching labels", async () => {
      const { client, sdk } = buildClient();
      const issue1 = makeFakeIssue({
        id: "issue-1",
        labelIds: ["label-1"],
        labels: () => Promise.resolve({ nodes: [{ id: "label-1", name: "urgent" }] }),
      });
      const issue2 = makeFakeIssue({ id: "issue-2", labelIds: ["label-1", "label-3"] });
      sdk.issue.mockResolvedValueOnce(issue1).mockResolvedValueOnce(issue2);
      sdk.updateIssue.mockResolvedValue({});

      await client.removeLabel("issue-1", "urgent");
      await client.removeLabel("issue-2", "urgent");

      expect(sdk.updateIssue).toHaveBeenNthCalledWith(2, "issue-2", { labelIds: ["label-3"] });
    });
  });

  describe("listLabels", () => {
    it("returns label names and populates the label cache", async () => {
      const { client, sdk } = buildClient();
      const issue = makeFakeIssue({
        id: "issue-1",
        labels: () =>
          Promise.resolve({
            nodes: [
              { id: "label-1", name: "urgent" },
              { id: "label-2", name: "bug" },
            ],
          }),
      });
      sdk.issue.mockResolvedValue(issue);

      const names = await client.listLabels("issue-1");
      expect(names).toEqual(["urgent", "bug"]);

      // The cache populated by listLabels should be reused by removeLabel.
      const issue2 = makeFakeIssue({ id: "issue-1", labelIds: ["label-1", "label-2"] });
      sdk.issue.mockResolvedValue(issue2);
      sdk.updateIssue.mockResolvedValue({});
      await client.removeLabel("issue-1", "urgent");
      expect(sdk.updateIssue).toHaveBeenCalledWith("issue-1", { labelIds: ["label-2"] });
    });

    it("returns an empty array when the issue has no labels connection", async () => {
      const { client, sdk } = buildClient();
      const issue = makeFakeIssue({ id: "issue-1", labels: () => Promise.resolve(null) });
      sdk.issue.mockResolvedValue(issue);

      await expect(client.listLabels("issue-1")).resolves.toEqual([]);
    });
  });

  describe("getRelatedContext - blocker hydration failure", () => {
    it("logs a warning and drops a blocker relation whose issue promise rejects", async () => {
      const { client, sdk, logger } = buildClient();
      const workingBlocker = makeFakeIssue({ id: "blocker-ok", identifier: "PRY-101" });
      const focus = {
        ...makeFakeIssue({ id: "focus-id" }),
        parent: Promise.resolve(null),
        inverseRelations: () =>
          Promise.resolve({
            nodes: [
              {
                id: "rel-broken",
                type: "blocks",
                issue: Promise.reject(new Error("issue deleted")),
              },
              { id: "rel-ok", type: "blocks", issue: Promise.resolve(workingBlocker) },
            ],
          }),
      };
      sdk.issue.mockImplementation((id: string) =>
        Promise.resolve(id === "focus-id" ? focus : workingBlocker),
      );

      const ctx = await client.getRelatedContext("focus-id");

      expect(ctx.blockers).toHaveLength(1);
      expect(ctx.blockers[0].id).toBe("blocker-ok");
      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ relationId: "rel-broken", focusIssueId: "focus-id" }),
        "Failed to hydrate blocker issue from relation",
      );
    });
  });
});
