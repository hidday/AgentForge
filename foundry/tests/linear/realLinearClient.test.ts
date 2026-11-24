import { describe, it, expect, vi, beforeEach } from "vitest";
import { RealLinearClient } from "../../src/linear/realLinearClient.js";

function makeLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
}

function makeFakeIssue(overrides: Record<string, unknown> = {}) {
  return {
    id: "issue-1",
    identifier: "PRY-1",
    title: "Issue title",
    description: "Issue description",
    branchName: "ai/issue-1",
    priority: 1,
    url: "https://linear.app/team/issue/PRY-1",
    labelIds: [],
    parent: Promise.resolve(null),
    state: Promise.resolve({ id: "state-1", name: "Todo" }),
    project: Promise.resolve(null),
    cycle: Promise.resolve(null),
    team: Promise.resolve({ id: "team-1", key: "PRY" }),
    labels: () => Promise.resolve({ nodes: [] }),
    inverseRelations: () => Promise.resolve({ nodes: [] }),
    ...overrides,
  };
}

function injectSdk(client: RealLinearClient, sdk: Record<string, unknown>) {
  (client as unknown as { sdk: Record<string, unknown> }).sdk = sdk;
}

describe("RealLinearClient", () => {
  let client: RealLinearClient;

  beforeEach(() => {
    client = new RealLinearClient("test-key", makeLogger() as never);
  });

  describe("getIssue", () => {
    it("maps an SDK issue to the domain LinearIssue shape", async () => {
      const issue = makeFakeIssue({
        project: Promise.resolve({ name: "Backend" }),
        cycle: Promise.resolve({ name: "Sprint 1" }),
        labels: () => Promise.resolve({ nodes: [{ id: "l1", name: "bug" }] }),
      });
      injectSdk(client, { issue: vi.fn().mockResolvedValue(issue) });

      const result = await client.getIssue("issue-1");

      expect(result).toEqual({
        id: "issue-1",
        identifier: "PRY-1",
        title: "Issue title",
        description: "Issue description",
        branchName: "ai/issue-1",
        state: "Todo",
        labels: ["bug"],
        priority: 1,
        url: "https://linear.app/team/issue/PRY-1",
        project: "Backend",
        team: "PRY",
        cycle: "Sprint 1",
      });
    });

    it("defaults missing description, state, project, cycle, and team", async () => {
      const issue = makeFakeIssue({
        description: null,
        state: Promise.resolve(null),
        project: Promise.resolve(null),
        cycle: Promise.resolve(null),
        team: Promise.resolve(null),
        labels: () => Promise.resolve(null),
      });
      injectSdk(client, { issue: vi.fn().mockResolvedValue(issue) });

      const result = await client.getIssue("issue-1");

      expect(result.description).toBe("");
      expect(result.state).toBe("Unknown");
      expect(result.project).toBeUndefined();
      expect(result.cycle).toBeUndefined();
      expect(result.team).toBeUndefined();
      expect(result.labels).toEqual([]);
    });
  });

  describe("fetchBlockers error handling", () => {
    it("skips a blocker relation whose issue fails to hydrate, logging a warning", async () => {
      const goodBlocker = makeFakeIssue({ id: "blocker-good" });
      const logger = makeLogger();
      client = new RealLinearClient("test-key", logger as never);
      const focus = makeFakeIssue({
        id: "focus-id",
        parent: Promise.resolve(null),
        inverseRelations: () =>
          Promise.resolve({
            nodes: [
              {
                id: "rel-bad",
                type: "blocks",
                issue: Promise.reject(new Error("hydrate failed")),
              },
              { id: "rel-good", type: "blocks", issue: Promise.resolve(goodBlocker) },
            ],
          }),
      });
      injectSdk(client, { issue: vi.fn().mockResolvedValue(focus) });

      const ctx = await client.getRelatedContext("focus-id");

      expect(ctx.blockers).toHaveLength(1);
      expect(ctx.blockers[0].id).toBe("blocker-good");
      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ relationId: "rel-bad" }),
        "Failed to hydrate blocker issue from relation",
      );
    });
  });

  describe("searchIssues", () => {
    it("builds a GraphQL filter from the given criteria and maps results", async () => {
      const issue = makeFakeIssue({
        project: Promise.resolve({ name: "Backend" }),
        cycle: Promise.resolve(null),
        team: Promise.resolve({ key: "PRY" }),
        labels: () => Promise.resolve({ nodes: [{ id: "l1", name: "bug" }] }),
      });
      const issuesMock = vi.fn().mockResolvedValue({ nodes: [issue] });
      injectSdk(client, { issues: issuesMock });

      const results = await client.searchIssues({
        state: "Todo",
        projectName: "Backend",
        assigneeMe: true,
        team: "PRY",
      });

      expect(results).toHaveLength(1);
      expect(results[0]).toMatchObject({ id: "issue-1", state: "Todo", project: "Backend" });

      const filterArg = issuesMock.mock.calls[0]![0] as { filter: Record<string, unknown> };
      expect(filterArg.filter).toMatchObject({
        state: { name: { eq: "Todo" } },
        project: { name: { eq: "Backend" } },
        assignee: { isMe: { eq: true } },
        team: { or: [{ name: { eq: "PRY" } }, { key: { eq: "PRY" } }] },
      });
    });

    it("omits optional filter fields when not provided", async () => {
      const issuesMock = vi.fn().mockResolvedValue({ nodes: [] });
      injectSdk(client, { issues: issuesMock });

      await client.searchIssues({ state: "Done" });

      const filterArg = issuesMock.mock.calls[0]![0] as { filter: Record<string, unknown> };
      expect(filterArg.filter).toEqual({ state: { name: { eq: "Done" } } });
    });

    it("returns an empty array when the connection has no nodes", async () => {
      injectSdk(client, { issues: vi.fn().mockResolvedValue(null) });

      const results = await client.searchIssues({ state: "Todo" });

      expect(results).toEqual([]);
    });
  });

  it("postComment delegates to sdk.createComment", async () => {
    const createComment = vi.fn().mockResolvedValue({});
    injectSdk(client, { createComment });

    await client.postComment("issue-1", "hello");

    expect(createComment).toHaveBeenCalledWith({ issueId: "issue-1", body: "hello" });
  });

  describe("updateIssueState", () => {
    it("resolves the state id for the issue's team and updates the issue", async () => {
      const issue = makeFakeIssue({ team: Promise.resolve({ id: "team-1", key: "PRY" }) });
      const statesConn = { nodes: [{ id: "state-done", name: "Done" }] };
      const team = { states: vi.fn().mockResolvedValue(statesConn) };
      const updateIssue = vi.fn().mockResolvedValue({});
      injectSdk(client, {
        issue: vi.fn().mockResolvedValue(issue),
        team: vi.fn().mockResolvedValue(team),
        updateIssue,
      });

      await client.updateIssueState("issue-1", "Done");

      expect(updateIssue).toHaveBeenCalledWith("issue-1", { stateId: "state-done" });
    });

    it("caches the team's state map across calls", async () => {
      const issue = makeFakeIssue({ team: Promise.resolve({ id: "team-1", key: "PRY" }) });
      const teamFn = vi.fn().mockResolvedValue({
        states: vi.fn().mockResolvedValue({ nodes: [{ id: "state-done", name: "Done" }] }),
      });
      injectSdk(client, {
        issue: vi.fn().mockResolvedValue(issue),
        team: teamFn,
        updateIssue: vi.fn().mockResolvedValue({}),
      });

      await client.updateIssueState("issue-1", "Done");
      await client.updateIssueState("issue-1", "Done");

      expect(teamFn).toHaveBeenCalledTimes(1);
    });

    it("warns and returns without updating when the issue has no team", async () => {
      const issue = makeFakeIssue({ team: Promise.resolve(null) });
      const logger = makeLogger();
      client = new RealLinearClient("test-key", logger as never);
      const updateIssue = vi.fn();
      injectSdk(client, { issue: vi.fn().mockResolvedValue(issue), updateIssue });

      await client.updateIssueState("issue-1", "Done");

      expect(updateIssue).not.toHaveBeenCalled();
      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ issueId: "issue-1" }),
        "Cannot update state: issue has no team",
      );
    });

    it("warns and returns without updating when the state name is not found", async () => {
      const issue = makeFakeIssue({ team: Promise.resolve({ id: "team-1", key: "PRY" }) });
      const team = { states: vi.fn().mockResolvedValue({ nodes: [] }) };
      const logger = makeLogger();
      client = new RealLinearClient("test-key", logger as never);
      const updateIssue = vi.fn();
      injectSdk(client, {
        issue: vi.fn().mockResolvedValue(issue),
        team: vi.fn().mockResolvedValue(team),
        updateIssue,
      });

      await client.updateIssueState("issue-1", "Nonexistent");

      expect(updateIssue).not.toHaveBeenCalled();
      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ stateName: "Nonexistent" }),
        "Could not find workflow state by name",
      );
    });
  });

  describe("addLabel", () => {
    it("creates a new label and appends it when not already present", async () => {
      const issue = makeFakeIssue({
        labelIds: ["existing-id"],
        team: Promise.resolve({ id: "team-1", key: "PRY" }),
      });
      const updateIssue = vi.fn().mockResolvedValue({});
      injectSdk(client, {
        issue: vi.fn().mockResolvedValue(issue),
        issueLabels: vi.fn().mockResolvedValue({ nodes: [] }),
        createIssueLabel: vi.fn().mockResolvedValue({
          issueLabel: Promise.resolve({ id: "new-label-id" }),
        }),
        updateIssue,
      });

      await client.addLabel("issue-1", "urgent");

      expect(updateIssue).toHaveBeenCalledWith("issue-1", {
        labelIds: ["existing-id", "new-label-id"],
      });
    });

    it("reuses an existing label by name instead of creating a duplicate", async () => {
      const issue = makeFakeIssue({ labelIds: [], team: Promise.resolve(null) });
      const createIssueLabel = vi.fn();
      const updateIssue = vi.fn().mockResolvedValue({});
      injectSdk(client, {
        issue: vi.fn().mockResolvedValue(issue),
        issueLabels: vi.fn().mockResolvedValue({ nodes: [{ id: "existing-label-id" }] }),
        createIssueLabel,
        updateIssue,
      });

      await client.addLabel("issue-1", "urgent");

      expect(createIssueLabel).not.toHaveBeenCalled();
      expect(updateIssue).toHaveBeenCalledWith("issue-1", { labelIds: ["existing-label-id"] });
    });

    it("does not call updateIssue again when the label is already on the issue", async () => {
      const issue = makeFakeIssue({ labelIds: ["label-1"], team: Promise.resolve(null) });
      const updateIssue = vi.fn();
      injectSdk(client, {
        issue: vi.fn().mockResolvedValue(issue),
        issueLabels: vi.fn().mockResolvedValue({ nodes: [{ id: "label-1" }] }),
        createIssueLabel: vi.fn(),
        updateIssue,
      });

      await client.addLabel("issue-1", "urgent");

      expect(updateIssue).not.toHaveBeenCalled();
    });

    it("throws when label creation does not return a created label", async () => {
      const issue = makeFakeIssue({ labelIds: [], team: Promise.resolve(null) });
      injectSdk(client, {
        issue: vi.fn().mockResolvedValue(issue),
        issueLabels: vi.fn().mockResolvedValue({ nodes: [] }),
        createIssueLabel: vi.fn().mockResolvedValue({ issueLabel: Promise.resolve(null) }),
        updateIssue: vi.fn(),
      });

      await expect(client.addLabel("issue-1", "urgent")).rejects.toThrow(
        /Failed to create label: urgent/,
      );
    });
  });

  describe("removeLabel", () => {
    it("removes a label resolved via a live lookup when not cached", async () => {
      const issue = makeFakeIssue({
        labelIds: ["label-1", "label-2"],
        labels: () =>
          Promise.resolve({ nodes: [{ id: "label-1", name: "urgent" }, { id: "label-2", name: "bug" }] }),
      });
      const updateIssue = vi.fn().mockResolvedValue({});
      injectSdk(client, { issue: vi.fn().mockResolvedValue(issue), updateIssue });

      await client.removeLabel("issue-1", "urgent");

      expect(updateIssue).toHaveBeenCalledWith("issue-1", { labelIds: ["label-2"] });
    });

    it("is a no-op when the label name doesn't match any label on the issue", async () => {
      const issue = makeFakeIssue({
        labelIds: ["label-1"],
        labels: () => Promise.resolve({ nodes: [{ id: "label-1", name: "bug" }] }),
      });
      const updateIssue = vi.fn();
      injectSdk(client, { issue: vi.fn().mockResolvedValue(issue), updateIssue });

      await client.removeLabel("issue-1", "nonexistent");

      expect(updateIssue).not.toHaveBeenCalled();
    });

    it("uses the cached label id on a subsequent call instead of looking it up again", async () => {
      const issue = makeFakeIssue({
        labelIds: ["label-1"],
        labels: vi.fn().mockResolvedValue({ nodes: [{ id: "label-1", name: "urgent" }] }),
      });
      const updateIssue = vi.fn().mockResolvedValue({});
      injectSdk(client, { issue: vi.fn().mockResolvedValue(issue), updateIssue });

      await client.removeLabel("issue-1", "urgent");
      await client.removeLabel("issue-1", "urgent");

      expect(issue.labels).toHaveBeenCalledTimes(1);
      expect(updateIssue).toHaveBeenCalledTimes(2);
    });
  });

  describe("listLabels", () => {
    it("returns label names and populates the label cache", async () => {
      const issue = makeFakeIssue({
        labels: () =>
          Promise.resolve({ nodes: [{ id: "label-1", name: "urgent" }, { id: "label-2", name: "bug" }] }),
      });
      injectSdk(client, { issue: vi.fn().mockResolvedValue(issue) });

      const names = await client.listLabels("issue-1");

      expect(names).toEqual(["urgent", "bug"]);

      // The populated cache means a subsequent removeLabel skips the live lookup.
      const updateIssue = vi.fn().mockResolvedValue({});
      injectSdk(client, {
        issue: vi.fn().mockResolvedValue({ ...issue, labelIds: ["label-1", "label-2"] }),
        updateIssue,
      });
      await client.removeLabel("issue-1", "urgent");
      expect(updateIssue).toHaveBeenCalledWith("issue-1", { labelIds: ["label-2"] });
    });

    it("returns an empty array when the issue has no labels connection", async () => {
      const issue = makeFakeIssue({ labels: () => Promise.resolve(null) });
      injectSdk(client, { issue: vi.fn().mockResolvedValue(issue) });

      const names = await client.listLabels("issue-1");

      expect(names).toEqual([]);
    });
  });
});
