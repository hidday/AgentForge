import { describe, it, expect, vi, beforeEach } from "vitest";
import { RealLinearClient } from "../../src/linear/realLinearClient.js";

// This file extends coverage of RealLinearClient beyond getRelatedContext (covered by
// tests/linear/realLinearClient.relatedContext.test.ts): getIssue, searchIssues,
// postComment, updateIssueState, addLabel, removeLabel, listLabels, and their private
// helpers (resolveStateId, resolveOrCreateLabel), plus assorted error/edge paths. It
// follows the same fake-SDK-injection pattern as that file: a fake SDK object is
// assigned directly onto `(client as unknown as { sdk }).sdk`.

function makeLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
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
    it("maps a fully populated SDK issue to a LinearIssue", async () => {
      injectSdk(client, {
        issue: (id: string) => {
          expect(id).toBe("issue-1");
          return Promise.resolve({
            id: "issue-1",
            identifier: "PRY-1",
            title: "Fix the thing",
            description: "Full description",
            branchName: "ai/issue-1",
            priority: 2,
            url: "https://linear.app/team/issue/PRY-1",
            labelIds: ["l1"],
            labels: () => Promise.resolve({ nodes: [{ id: "l1", name: "bug" }] }),
            state: Promise.resolve({ id: "s1", name: "In Progress" }),
            project: Promise.resolve({ id: "p1", name: "Backend" }),
            cycle: Promise.resolve({ id: "c1", name: "Sprint 1" }),
            team: Promise.resolve({ id: "t1", key: "PRY" }),
          });
        },
      });

      const result = await client.getIssue("issue-1");

      expect(result).toEqual({
        id: "issue-1",
        identifier: "PRY-1",
        title: "Fix the thing",
        description: "Full description",
        branchName: "ai/issue-1",
        state: "In Progress",
        labels: ["bug"],
        priority: 2,
        url: "https://linear.app/team/issue/PRY-1",
        project: "Backend",
        team: "PRY",
        cycle: "Sprint 1",
      });
    });

    it("falls back to defaults when optional SDK fields are null/undefined", async () => {
      injectSdk(client, {
        issue: () =>
          Promise.resolve({
            id: "issue-2",
            identifier: "PRY-2",
            title: "Minimal issue",
            description: null,
            branchName: "ai/issue-2",
            priority: 0,
            url: "https://linear.app/team/issue/PRY-2",
            labelIds: [],
            labels: () => Promise.resolve(null),
            state: Promise.resolve(null),
            project: Promise.resolve(null),
            cycle: Promise.resolve(null),
            team: Promise.resolve(null),
          }),
      });

      const result = await client.getIssue("issue-2");

      expect(result).toEqual({
        id: "issue-2",
        identifier: "PRY-2",
        title: "Minimal issue",
        description: "",
        branchName: "ai/issue-2",
        state: "Unknown",
        labels: [],
        priority: 0,
        url: "https://linear.app/team/issue/PRY-2",
        project: undefined,
        team: undefined,
        cycle: undefined,
      });
    });

    it("treats a labels connection with no nodes field as an empty label list", async () => {
      injectSdk(client, {
        issue: () =>
          Promise.resolve({
            id: "issue-3",
            identifier: "PRY-3",
            title: "No nodes",
            description: "",
            branchName: "ai/issue-3",
            priority: 0,
            url: "https://linear.app/team/issue/PRY-3",
            labelIds: [],
            labels: () => Promise.resolve({}),
            state: Promise.resolve({ name: "Todo" }),
            project: Promise.resolve(null),
            cycle: Promise.resolve(null),
            team: Promise.resolve(null),
          }),
      });

      const result = await client.getIssue("issue-3");
      expect(result.labels).toEqual([]);
    });
  });

  describe("searchIssues", () => {
    function makeSdkIssue(overrides: Record<string, unknown> = {}) {
      return {
        id: "issue-1",
        identifier: "PRY-1",
        title: "Title",
        description: "Desc",
        branchName: "ai/issue-1",
        priority: 1,
        url: "https://linear.app/team/issue/PRY-1",
        labels: () => Promise.resolve({ nodes: [] }),
        project: Promise.resolve(null),
        cycle: Promise.resolve(null),
        team: Promise.resolve(null),
        ...overrides,
      };
    }

    it("builds a base filter from state alone and maps results", async () => {
      const issuesSpy = vi.fn().mockResolvedValue({ nodes: [makeSdkIssue()] });
      injectSdk(client, { issues: issuesSpy });

      const results = await client.searchIssues({ state: "Todo" });

      expect(issuesSpy).toHaveBeenCalledWith({
        filter: { state: { name: { eq: "Todo" } } },
      });
      expect(results).toEqual([
        {
          id: "issue-1",
          identifier: "PRY-1",
          title: "Title",
          description: "Desc",
          branchName: "ai/issue-1",
          state: "Todo",
          labels: [],
          priority: 1,
          url: "https://linear.app/team/issue/PRY-1",
          project: undefined,
          team: undefined,
          cycle: undefined,
        },
      ]);
      expect(logger.info).toHaveBeenCalledWith(
        expect.objectContaining({ stateName: "Todo", count: 1 }),
        "Searched Linear issues",
      );
    });

    it("adds project, assignee, and team clauses to the filter when provided", async () => {
      const issuesSpy = vi.fn().mockResolvedValue({ nodes: [] });
      injectSdk(client, { issues: issuesSpy });

      await client.searchIssues({
        state: "Todo",
        projectName: "Backend Platform",
        assigneeMe: true,
        team: "PRY",
      });

      expect(issuesSpy).toHaveBeenCalledWith({
        filter: {
          state: { name: { eq: "Todo" } },
          project: { name: { eq: "Backend Platform" } },
          assignee: { isMe: { eq: true } },
          team: { or: [{ name: { eq: "PRY" } }, { key: { eq: "PRY" } }] },
        },
      });
    });

    it("maps labels, project, cycle and team on each matched issue", async () => {
      const issue = makeSdkIssue({
        labels: () => Promise.resolve({ nodes: [{ id: "l1", name: "bug" }] }),
        project: Promise.resolve({ name: "Backend" }),
        cycle: Promise.resolve({ name: "Sprint 1" }),
        team: Promise.resolve({ key: "PRY" }),
      });
      injectSdk(client, { issues: vi.fn().mockResolvedValue({ nodes: [issue] }) });

      const [result] = await client.searchIssues({ state: "Todo" });

      expect(result.labels).toEqual(["bug"]);
      expect(result.project).toBe("Backend");
      expect(result.cycle).toBe("Sprint 1");
      expect(result.team).toBe("PRY");
    });

    it("returns an empty array when the issues connection has no nodes", async () => {
      injectSdk(client, { issues: vi.fn().mockResolvedValue({}) });

      const results = await client.searchIssues({ state: "Todo" });

      expect(results).toEqual([]);
    });

    it("returns an empty array when the issues connection itself is nullish", async () => {
      injectSdk(client, { issues: vi.fn().mockResolvedValue(null) });

      const results = await client.searchIssues({ state: "Todo" });

      expect(results).toEqual([]);
    });
  });

  describe("postComment", () => {
    it("creates a comment via the SDK and logs", async () => {
      const createCommentSpy = vi.fn().mockResolvedValue({ success: true });
      injectSdk(client, { createComment: createCommentSpy });

      await client.postComment("issue-1", "Hello");

      expect(createCommentSpy).toHaveBeenCalledWith({ issueId: "issue-1", body: "Hello" });
      expect(logger.debug).toHaveBeenCalledWith(
        { issueId: "issue-1" },
        "Posted comment to Linear issue",
      );
    });
  });

  describe("updateIssueState", () => {
    it("resolves the state id and updates the issue when the team and state are found", async () => {
      const updateIssueSpy = vi.fn().mockResolvedValue({ success: true });
      injectSdk(client, {
        issue: () =>
          Promise.resolve({
            team: Promise.resolve({ id: "team-1", key: "PRY" }),
          }),
        team: () =>
          Promise.resolve({
            states: () =>
              Promise.resolve({
                nodes: [
                  { id: "state-todo", name: "Todo" },
                  { id: "state-done", name: "Done" },
                ],
              }),
          }),
        updateIssue: updateIssueSpy,
      });

      await client.updateIssueState("issue-1", "Done");

      expect(updateIssueSpy).toHaveBeenCalledWith("issue-1", { stateId: "state-done" });
      expect(logger.debug).toHaveBeenCalledWith(
        { issueId: "issue-1", stateName: "Done", stateId: "state-done" },
        "Updated Linear issue state",
      );
    });

    it("warns and does not update when the issue has no team", async () => {
      const updateIssueSpy = vi.fn();
      injectSdk(client, {
        issue: () => Promise.resolve({ team: Promise.resolve(null) }),
        updateIssue: updateIssueSpy,
      });

      await client.updateIssueState("issue-1", "Done");

      expect(updateIssueSpy).not.toHaveBeenCalled();
      expect(logger.warn).toHaveBeenCalledWith(
        { issueId: "issue-1" },
        "Cannot update state: issue has no team",
      );
    });

    it("warns and does not update when the state name cannot be resolved", async () => {
      const updateIssueSpy = vi.fn();
      injectSdk(client, {
        issue: () =>
          Promise.resolve({
            team: Promise.resolve({ id: "team-1", key: "PRY" }),
          }),
        team: () => Promise.resolve({ states: () => Promise.resolve({ nodes: [] }) }),
        updateIssue: updateIssueSpy,
      });

      await client.updateIssueState("issue-1", "Nonexistent");

      expect(updateIssueSpy).not.toHaveBeenCalled();
      expect(logger.warn).toHaveBeenCalledWith(
        { issueId: "issue-1", stateName: "Nonexistent", teamId: "team-1" },
        "Could not find workflow state by name",
      );
    });

    it("treats a states connection with no nodes field as empty", async () => {
      const updateIssueSpy = vi.fn();
      injectSdk(client, {
        issue: () => Promise.resolve({ team: Promise.resolve({ id: "team-1" }) }),
        team: () => Promise.resolve({ states: () => Promise.resolve({}) }),
        updateIssue: updateIssueSpy,
      });

      await client.updateIssueState("issue-1", "Done");

      expect(updateIssueSpy).not.toHaveBeenCalled();
    });

    it("caches resolved states per team and only queries states() once", async () => {
      const statesSpy = vi.fn().mockResolvedValue({ nodes: [{ id: "state-done", name: "Done" }] });
      const teamSpy = vi.fn().mockResolvedValue({ states: statesSpy });
      const updateIssueSpy = vi.fn().mockResolvedValue({ success: true });
      injectSdk(client, {
        issue: () => Promise.resolve({ team: Promise.resolve({ id: "team-1" }) }),
        team: teamSpy,
        updateIssue: updateIssueSpy,
      });

      await client.updateIssueState("issue-1", "Done");
      await client.updateIssueState("issue-2", "Done");

      expect(teamSpy).toHaveBeenCalledTimes(1);
      expect(statesSpy).toHaveBeenCalledTimes(1);
      expect(updateIssueSpy).toHaveBeenCalledTimes(2);
    });
  });

  describe("addLabel", () => {
    it("creates (via lookup) and appends a new label id when not already present", async () => {
      const updateIssueSpy = vi.fn().mockResolvedValue({ success: true });
      injectSdk(client, {
        issue: () =>
          Promise.resolve({
            labelIds: ["existing-id"],
            team: Promise.resolve({ id: "team-1" }),
          }),
        issueLabels: vi.fn().mockResolvedValue({ nodes: [{ id: "label-urgent", name: "urgent" }] }),
        updateIssue: updateIssueSpy,
      });

      await client.addLabel("issue-1", "urgent");

      expect(updateIssueSpy).toHaveBeenCalledWith("issue-1", {
        labelIds: ["existing-id", "label-urgent"],
      });
      expect(logger.debug).toHaveBeenCalledWith(
        { issueId: "issue-1", labelName: "urgent", labelId: "label-urgent" },
        "Added label to Linear issue",
      );
    });

    it("does not call updateIssue when the label id is already on the issue", async () => {
      const updateIssueSpy = vi.fn();
      injectSdk(client, {
        issue: () =>
          Promise.resolve({
            labelIds: ["label-urgent"],
            team: Promise.resolve({ id: "team-1" }),
          }),
        issueLabels: vi.fn().mockResolvedValue({ nodes: [{ id: "label-urgent", name: "urgent" }] }),
        updateIssue: updateIssueSpy,
      });

      await client.addLabel("issue-1", "urgent");

      expect(updateIssueSpy).not.toHaveBeenCalled();
    });

    it("creates a brand-new label via createIssueLabel when none exists, scoped to the issue's team", async () => {
      const createIssueLabelSpy = vi.fn().mockResolvedValue({
        issueLabel: Promise.resolve({ id: "label-new", name: "shiny" }),
      });
      const updateIssueSpy = vi.fn().mockResolvedValue({ success: true });
      injectSdk(client, {
        issue: () =>
          Promise.resolve({
            labelIds: [],
            team: Promise.resolve({ id: "team-1" }),
          }),
        issueLabels: vi.fn().mockResolvedValue({ nodes: [] }),
        createIssueLabel: createIssueLabelSpy,
        updateIssue: updateIssueSpy,
      });

      await client.addLabel("issue-1", "shiny");

      expect(createIssueLabelSpy).toHaveBeenCalledWith({ name: "shiny", teamId: "team-1" });
      expect(updateIssueSpy).toHaveBeenCalledWith("issue-1", { labelIds: ["label-new"] });
      expect(logger.info).toHaveBeenCalledWith(
        { labelName: "shiny", labelId: "label-new" },
        "Created new Linear label",
      );
    });

    it("creates a label without a teamId when the issue has no team", async () => {
      const createIssueLabelSpy = vi.fn().mockResolvedValue({
        issueLabel: Promise.resolve({ id: "label-new", name: "shiny" }),
      });
      injectSdk(client, {
        issue: () => Promise.resolve({ labelIds: [], team: Promise.resolve(null) }),
        issueLabels: vi.fn().mockResolvedValue({ nodes: [] }),
        createIssueLabel: createIssueLabelSpy,
        updateIssue: vi.fn().mockResolvedValue({ success: true }),
      });

      await client.addLabel("issue-1", "shiny");

      expect(createIssueLabelSpy).toHaveBeenCalledWith({ name: "shiny" });
    });

    it("throws when label creation succeeds but returns no issueLabel payload", async () => {
      injectSdk(client, {
        issue: () =>
          Promise.resolve({
            labelIds: [],
            team: Promise.resolve({ id: "team-1" }),
          }),
        issueLabels: vi.fn().mockResolvedValue({ nodes: [] }),
        createIssueLabel: vi.fn().mockResolvedValue({ issueLabel: Promise.resolve(null) }),
      });

      await expect(client.addLabel("issue-1", "ghost")).rejects.toThrow(
        "Failed to create label: ghost",
      );
    });

    it("reuses the label cache on a second call instead of querying issueLabels again", async () => {
      const issueLabelsSpy = vi.fn().mockResolvedValue({ nodes: [{ id: "label-x", name: "x" }] });
      injectSdk(client, {
        issue: () => Promise.resolve({ labelIds: [], team: Promise.resolve({ id: "team-1" }) }),
        issueLabels: issueLabelsSpy,
        updateIssue: vi.fn().mockResolvedValue({ success: true }),
      });

      await client.addLabel("issue-1", "x");
      await client.addLabel("issue-1", "x");

      expect(issueLabelsSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe("removeLabel", () => {
    it("looks up the label id from the issue's labels when not cached, then removes it", async () => {
      const updateIssueSpy = vi.fn().mockResolvedValue({ success: true });
      injectSdk(client, {
        issue: () =>
          Promise.resolve({
            labelIds: ["label-bug", "label-urgent"],
            labels: () =>
              Promise.resolve({
                nodes: [
                  { id: "label-bug", name: "bug" },
                  { id: "label-urgent", name: "urgent" },
                ],
              }),
          }),
        updateIssue: updateIssueSpy,
      });

      await client.removeLabel("issue-1", "bug");

      expect(updateIssueSpy).toHaveBeenCalledWith("issue-1", { labelIds: ["label-urgent"] });
      expect(logger.debug).toHaveBeenCalledWith(
        { issueId: "issue-1", labelName: "bug" },
        "Removed label from Linear issue",
      );
    });

    it("is a no-op when the label name is not found on the issue", async () => {
      const updateIssueSpy = vi.fn();
      injectSdk(client, {
        issue: () =>
          Promise.resolve({
            labelIds: ["label-urgent"],
            labels: () => Promise.resolve({ nodes: [{ id: "label-urgent", name: "urgent" }] }),
          }),
        updateIssue: updateIssueSpy,
      });

      await client.removeLabel("issue-1", "missing-label");

      expect(updateIssueSpy).not.toHaveBeenCalled();
    });

    it("uses the cached label id on a second removal without re-querying labels()", async () => {
      const labelsSpy = vi
        .fn()
        .mockResolvedValue({ nodes: [{ id: "label-bug", name: "bug" }] });
      const updateIssueSpy = vi.fn().mockResolvedValue({ success: true });
      injectSdk(client, {
        issue: () =>
          Promise.resolve({
            labelIds: ["label-bug"],
            labels: labelsSpy,
          }),
        updateIssue: updateIssueSpy,
      });

      await client.removeLabel("issue-1", "bug");
      expect(labelsSpy).toHaveBeenCalledTimes(1);

      await client.removeLabel("issue-1", "bug");
      expect(labelsSpy).toHaveBeenCalledTimes(1);
      expect(updateIssueSpy).toHaveBeenCalledTimes(2);
    });
  });

  describe("listLabels", () => {
    it("returns label names and populates the label cache for later use", async () => {
      injectSdk(client, {
        issue: () =>
          Promise.resolve({
            labels: () =>
              Promise.resolve({
                nodes: [
                  { id: "label-bug", name: "bug" },
                  { id: "label-urgent", name: "urgent" },
                ],
              }),
          }),
      });

      const names = await client.listLabels("issue-1");

      expect(names).toEqual(["bug", "urgent"]);
    });

    it("returns an empty array when the labels connection has no nodes", async () => {
      injectSdk(client, {
        issue: () => Promise.resolve({ labels: () => Promise.resolve({}) }),
      });

      const names = await client.listLabels("issue-1");

      expect(names).toEqual([]);
    });

    it("primes the label cache so a later removeLabel skips the labels() lookup", async () => {
      const labelsSpy = vi
        .fn()
        .mockResolvedValue({ nodes: [{ id: "label-bug", name: "bug" }] });
      const updateIssueSpy = vi.fn().mockResolvedValue({ success: true });
      injectSdk(client, {
        issue: () => Promise.resolve({ labelIds: ["label-bug"], labels: labelsSpy }),
        updateIssue: updateIssueSpy,
      });

      await client.listLabels("issue-1");
      expect(labelsSpy).toHaveBeenCalledTimes(1);

      await client.removeLabel("issue-1", "bug");

      // removeLabel finds "bug" already cached from listLabels, so it must not
      // call labels() again.
      expect(labelsSpy).toHaveBeenCalledTimes(1);
      expect(updateIssueSpy).toHaveBeenCalledWith("issue-1", { labelIds: [] });
    });
  });
});
