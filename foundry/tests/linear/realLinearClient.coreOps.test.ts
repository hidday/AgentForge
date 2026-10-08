import { describe, it, expect, vi, beforeEach } from "vitest";
import { RealLinearClient } from "../../src/linear/realLinearClient.js";

function makeLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
}

function makeClient() {
  const client = new RealLinearClient("test-key", makeLogger() as never);
  const sdk = {
    issue: vi.fn(),
    issues: vi.fn(),
    createComment: vi.fn(),
    updateIssue: vi.fn().mockResolvedValue(undefined),
    team: vi.fn(),
    issueLabels: vi.fn(),
    createIssueLabel: vi.fn(),
  };
  (client as unknown as { sdk: typeof sdk }).sdk = sdk;
  const logger = (client as unknown as { logger: ReturnType<typeof makeLogger> }).logger;
  return { client, sdk, logger };
}

function makeSdkIssue(overrides: Record<string, unknown> = {}) {
  return {
    id: "issue-1",
    identifier: "LIN-1",
    title: "Fix bug",
    description: "desc",
    branchName: "ai/issue-1",
    priority: 2,
    url: "https://linear.app/x/LIN-1",
    labelIds: [],
    state: Promise.resolve({ name: "Todo" }),
    project: Promise.resolve(null),
    cycle: Promise.resolve(null),
    team: Promise.resolve({ id: "team-1", key: "LIN" }),
    labels: () => Promise.resolve({ nodes: [] }),
    ...overrides,
  };
}

describe("RealLinearClient.getIssue", () => {
  it("maps an SDK issue into a LinearIssue, defaulting missing fields", async () => {
    const { client, sdk } = makeClient();
    sdk.issue.mockResolvedValue(
      makeSdkIssue({
        labels: () => Promise.resolve({ nodes: [{ name: "bug" }, { name: "api" }] }),
        project: Promise.resolve({ name: "Backend" }),
        cycle: Promise.resolve({ name: "Sprint 1" }),
      }),
    );

    const issue = await client.getIssue("issue-1");

    expect(issue).toEqual({
      id: "issue-1",
      identifier: "LIN-1",
      title: "Fix bug",
      description: "desc",
      branchName: "ai/issue-1",
      state: "Todo",
      labels: ["bug", "api"],
      priority: 2,
      url: "https://linear.app/x/LIN-1",
      project: "Backend",
      team: "LIN",
      cycle: "Sprint 1",
    });
  });

  it("defaults description to empty string and state to 'Unknown' when absent", async () => {
    const { client, sdk } = makeClient();
    sdk.issue.mockResolvedValue(
      makeSdkIssue({ description: null, state: Promise.resolve(null) }),
    );

    const issue = await client.getIssue("issue-1");

    expect(issue.description).toBe("");
    expect(issue.state).toBe("Unknown");
  });
});

describe("RealLinearClient.searchIssues", () => {
  it("builds a GraphQL filter from state only when project/assignee/team are unset", async () => {
    const { client, sdk } = makeClient();
    sdk.issues.mockResolvedValue({ nodes: [] });

    await client.searchIssues({ state: "Todo" });

    expect(sdk.issues).toHaveBeenCalledWith({ filter: { state: { name: { eq: "Todo" } } } });
  });

  it("adds project, assigneeMe, and team clauses when provided", async () => {
    const { client, sdk } = makeClient();
    sdk.issues.mockResolvedValue({ nodes: [] });

    await client.searchIssues({ state: "Todo", projectName: "Backend", assigneeMe: true, team: "LIN" });

    expect(sdk.issues).toHaveBeenCalledWith({
      filter: {
        state: { name: { eq: "Todo" } },
        project: { name: { eq: "Backend" } },
        assignee: { isMe: { eq: true } },
        team: { or: [{ name: { eq: "LIN" } }, { key: { eq: "LIN" } }] },
      },
    });
  });

  it("maps each returned node to a LinearIssue using the filter's state name", async () => {
    const { client, sdk } = makeClient();
    sdk.issues.mockResolvedValue({
      nodes: [makeSdkIssue({ id: "a" }), makeSdkIssue({ id: "b" })],
    });

    const results = await client.searchIssues({ state: "Todo" });

    expect(results.map((r) => r.id)).toEqual(["a", "b"]);
    expect(results[0].state).toBe("Todo");
  });

  it("returns an empty array when the SDK returns no nodes", async () => {
    const { client, sdk } = makeClient();
    sdk.issues.mockResolvedValue({ nodes: undefined });

    const results = await client.searchIssues({ state: "Todo" });

    expect(results).toEqual([]);
  });
});

describe("RealLinearClient.postComment", () => {
  it("posts a comment via the SDK", async () => {
    const { client, sdk } = makeClient();
    sdk.createComment.mockResolvedValue({});

    await client.postComment("issue-1", "hello");

    expect(sdk.createComment).toHaveBeenCalledWith({ issueId: "issue-1", body: "hello" });
  });
});

describe("RealLinearClient.updateIssueState", () => {
  it("warns and does nothing when the issue has no team", async () => {
    const { client, sdk, logger } = makeClient();
    sdk.issue.mockResolvedValue(makeSdkIssue({ team: Promise.resolve(null) }));

    await client.updateIssueState("issue-1", "Done");

    expect(logger.warn).toHaveBeenCalledWith({ issueId: "issue-1" }, "Cannot update state: issue has no team");
    expect(sdk.updateIssue).not.toHaveBeenCalled();
  });

  it("warns and does nothing when the state name cannot be resolved for the team", async () => {
    const { client, sdk, logger } = makeClient();
    sdk.issue.mockResolvedValue(makeSdkIssue());
    sdk.team.mockResolvedValue({ states: () => Promise.resolve({ nodes: [{ id: "s1", name: "Other" }] }) });

    await client.updateIssueState("issue-1", "Done");

    expect(logger.warn).toHaveBeenCalledWith(
      { issueId: "issue-1", stateName: "Done", teamId: "team-1" },
      "Could not find workflow state by name",
    );
    expect(sdk.updateIssue).not.toHaveBeenCalled();
  });

  it("resolves the stateId and updates the issue", async () => {
    const { client, sdk } = makeClient();
    sdk.issue.mockResolvedValue(makeSdkIssue());
    sdk.team.mockResolvedValue({
      states: () => Promise.resolve({ nodes: [{ id: "state-done", name: "Done" }] }),
    });

    await client.updateIssueState("issue-1", "Done");

    expect(sdk.updateIssue).toHaveBeenCalledWith("issue-1", { stateId: "state-done" });
  });

  it("caches the team's state map across calls (team() fetched only once)", async () => {
    const { client, sdk } = makeClient();
    sdk.issue.mockResolvedValue(makeSdkIssue());
    sdk.team.mockResolvedValue({
      states: () => Promise.resolve({ nodes: [{ id: "state-done", name: "Done" }] }),
    });

    await client.updateIssueState("issue-1", "Done");
    await client.updateIssueState("issue-1", "Done");

    expect(sdk.team).toHaveBeenCalledTimes(1);
  });
});

describe("RealLinearClient.addLabel", () => {
  it("resolves an existing label via the SDK and adds it when missing from the issue", async () => {
    const { client, sdk } = makeClient();
    const issue = makeSdkIssue({ labelIds: ["existing-id"] });
    sdk.issue.mockResolvedValue(issue);
    sdk.issueLabels.mockResolvedValue({ nodes: [{ id: "label-new", name: "ai:planning" }] });

    await client.addLabel("issue-1", "ai:planning");

    expect(sdk.updateIssue).toHaveBeenCalledWith("issue-1", { labelIds: ["existing-id", "label-new"] });
  });

  it("creates a new label when none exists, scoped to the issue's team", async () => {
    const { client, sdk } = makeClient();
    sdk.issue.mockResolvedValue(makeSdkIssue({ labelIds: [] }));
    sdk.issueLabels.mockResolvedValue({ nodes: [] });
    sdk.createIssueLabel.mockResolvedValue({ issueLabel: Promise.resolve({ id: "label-brand-new" }) });

    await client.addLabel("issue-1", "ai:new-label");

    expect(sdk.createIssueLabel).toHaveBeenCalledWith({ name: "ai:new-label", teamId: "team-1" });
    expect(sdk.updateIssue).toHaveBeenCalledWith("issue-1", { labelIds: ["label-brand-new"] });
  });

  it("creates a team-less label when the issue has no team", async () => {
    const { client, sdk } = makeClient();
    sdk.issue.mockResolvedValue(makeSdkIssue({ labelIds: [], team: Promise.resolve(null) }));
    sdk.issueLabels.mockResolvedValue({ nodes: [] });
    sdk.createIssueLabel.mockResolvedValue({ issueLabel: Promise.resolve({ id: "label-x" }) });

    await client.addLabel("issue-1", "ai:x");

    expect(sdk.createIssueLabel).toHaveBeenCalledWith({ name: "ai:x" });
  });

  it("throws when label creation does not return an issueLabel", async () => {
    const { client, sdk } = makeClient();
    sdk.issue.mockResolvedValue(makeSdkIssue({ labelIds: [] }));
    sdk.issueLabels.mockResolvedValue({ nodes: [] });
    sdk.createIssueLabel.mockResolvedValue({ issueLabel: Promise.resolve(null) });

    await expect(client.addLabel("issue-1", "ai:x")).rejects.toThrow(
      "Failed to create label: ai:x",
    );
  });

  it("does not re-add a label that is already present on the issue", async () => {
    const { client, sdk } = makeClient();
    sdk.issue.mockResolvedValue(makeSdkIssue({ labelIds: ["label-existing"] }));
    sdk.issueLabels.mockResolvedValue({ nodes: [{ id: "label-existing", name: "ai:planning" }] });

    await client.addLabel("issue-1", "ai:planning");

    expect(sdk.updateIssue).not.toHaveBeenCalled();
  });

  it("uses the label cache on a second call instead of querying the SDK again", async () => {
    const { client, sdk } = makeClient();
    sdk.issue.mockResolvedValue(makeSdkIssue({ labelIds: [] }));
    sdk.issueLabels.mockResolvedValue({ nodes: [{ id: "label-cached", name: "ai:planning" }] });

    await client.addLabel("issue-1", "ai:planning");
    sdk.issue.mockResolvedValue(makeSdkIssue({ labelIds: ["label-cached"] }));
    await client.addLabel("issue-1", "ai:planning");

    expect(sdk.issueLabels).toHaveBeenCalledTimes(1);
  });
});

describe("RealLinearClient.removeLabel", () => {
  it("removes a label found via the issue's labels() when not cached", async () => {
    const { client, sdk } = makeClient();
    sdk.issue.mockResolvedValue(
      makeSdkIssue({
        labelIds: ["label-1", "label-2"],
        labels: () => Promise.resolve({ nodes: [{ id: "label-1", name: "ai:todo" }] }),
      }),
    );

    await client.removeLabel("issue-1", "ai:todo");

    expect(sdk.updateIssue).toHaveBeenCalledWith("issue-1", { labelIds: ["label-2"] });
  });

  it("is a no-op when the label name is not found on the issue", async () => {
    const { client, sdk } = makeClient();
    sdk.issue.mockResolvedValue(makeSdkIssue({ labels: () => Promise.resolve({ nodes: [] }) }));

    await client.removeLabel("issue-1", "ai:missing");

    expect(sdk.updateIssue).not.toHaveBeenCalled();
  });

  it("uses the label cache (from a prior listLabels/removeLabel/addLabel call) instead of re-querying labels()", async () => {
    const { client, sdk } = makeClient();
    const labelsFn = vi.fn().mockResolvedValue({ nodes: [{ id: "label-1", name: "ai:todo" }] });
    sdk.issue.mockResolvedValue(makeSdkIssue({ labelIds: ["label-1"], labels: labelsFn }));

    await client.listLabels("issue-1");
    await client.removeLabel("issue-1", "ai:todo");

    expect(labelsFn).toHaveBeenCalledTimes(1);
    expect(sdk.updateIssue).toHaveBeenCalledWith("issue-1", { labelIds: [] });
  });
});

describe("RealLinearClient.listLabels", () => {
  it("returns the issue's label names and seeds the label cache", async () => {
    const { client, sdk } = makeClient();
    sdk.issue.mockResolvedValue(
      makeSdkIssue({ labels: () => Promise.resolve({ nodes: [{ id: "l1", name: "bug" }] }) }),
    );

    const labels = await client.listLabels("issue-1");

    expect(labels).toEqual(["bug"]);
  });

  it("returns an empty array when the issue has no labels", async () => {
    const { client, sdk } = makeClient();
    sdk.issue.mockResolvedValue(makeSdkIssue({ labels: () => Promise.resolve({ nodes: undefined }) }));

    expect(await client.listLabels("issue-1")).toEqual([]);
  });
});

describe("RealLinearClient blocker hydration failure", () => {
  it("getRelatedContext logs a warning and omits a blocker whose relation.issue rejects", async () => {
    const { client, sdk, logger } = makeClient();
    const focus = makeSdkIssue({
      id: "focus-id",
      parent: Promise.resolve(null),
      inverseRelations: () =>
        Promise.resolve({
          nodes: [{ id: "rel-1", type: "blocks", issue: Promise.reject(new Error("fetch failed")) }],
        }),
    });
    sdk.issue.mockResolvedValue(focus);

    const ctx = await client.getRelatedContext("focus-id");

    expect(ctx.blockers).toEqual([]);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ relationId: "rel-1", focusIssueId: "focus-id" }),
      "Failed to hydrate blocker issue from relation",
    );
  });
});
