import { describe, it, expect, vi, beforeEach } from "vitest";
import { RealLinearClient } from "../../src/linear/realLinearClient.js";

function makeLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
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
  parent: Promise<FakeIssue | null>;
  state: Promise<{ id: string; name: string } | null>;
  project: Promise<{ name: string } | null>;
  cycle: Promise<{ name: string } | null>;
  team: Promise<{ id: string; key: string } | null>;
  labels: () => Promise<{ nodes: Array<{ id: string; name: string }> }>;
  inverseRelations: () => Promise<{ nodes: unknown[] }>;
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

interface FakeSdk {
  issue: ReturnType<typeof vi.fn>;
  issues: ReturnType<typeof vi.fn>;
  createComment: ReturnType<typeof vi.fn>;
  updateIssue: ReturnType<typeof vi.fn>;
  team: ReturnType<typeof vi.fn>;
  issueLabels: ReturnType<typeof vi.fn>;
  createIssueLabel: ReturnType<typeof vi.fn>;
}

function buildClient(): { client: RealLinearClient; sdk: FakeSdk; logger: ReturnType<typeof makeLogger> } {
  const logger = makeLogger();
  const client = new RealLinearClient("test-key", logger as never);
  const sdk: FakeSdk = {
    issue: vi.fn(),
    issues: vi.fn(),
    createComment: vi.fn(),
    updateIssue: vi.fn(),
    team: vi.fn(),
    issueLabels: vi.fn(),
    createIssueLabel: vi.fn(),
  };
  (client as unknown as { sdk: FakeSdk }).sdk = sdk;
  return { client, sdk, logger };
}

describe("RealLinearClient.getIssue", () => {
  it("maps all SDK fields, defaulting missing project/team/cycle/state", async () => {
    const { client, sdk } = buildClient();
    const issue = makeFakeIssue({
      id: "issue-1",
      identifier: "PRY-42",
      description: null,
      labels: () => Promise.resolve({ nodes: [{ id: "l1", name: "bug" }] }),
      state: Promise.resolve(null),
      project: Promise.resolve(null),
      cycle: Promise.resolve(null),
      team: Promise.resolve(null),
    });
    sdk.issue.mockResolvedValue(issue);

    const result = await client.getIssue("issue-1");

    expect(result).toEqual({
      id: "issue-1",
      identifier: "PRY-42",
      title: "Issue title",
      description: "",
      branchName: "ai/issue-1",
      state: "Unknown",
      labels: ["bug"],
      priority: 0,
      url: "https://linear.app/team/issue/PRY-1",
      project: undefined,
      team: undefined,
      cycle: undefined,
    });
  });

  it("maps project/team/cycle names when present", async () => {
    const { client, sdk } = buildClient();
    const issue = makeFakeIssue({
      id: "issue-1",
      project: Promise.resolve({ name: "Project A" }),
      cycle: Promise.resolve({ name: "Cycle 5" }),
      team: Promise.resolve({ id: "team-1", key: "PRY" }),
    });
    sdk.issue.mockResolvedValue(issue);

    const result = await client.getIssue("issue-1");

    expect(result.project).toBe("Project A");
    expect(result.cycle).toBe("Cycle 5");
    expect(result.team).toBe("PRY");
  });
});

describe("RealLinearClient.searchIssues", () => {
  it("builds a state-only filter and maps results when no optional filters are given", async () => {
    const { client, sdk } = buildClient();
    const resultIssue = makeFakeIssue({ id: "r1" });
    sdk.issues.mockResolvedValue({ nodes: [resultIssue] });

    const results = await client.searchIssues({ state: "Todo" });

    expect(sdk.issues).toHaveBeenCalledWith({ filter: { state: { name: { eq: "Todo" } } } });
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ id: "r1", state: "Todo" });
  });

  it("adds project, assignee, and team clauses when provided", async () => {
    const { client, sdk } = buildClient();
    sdk.issues.mockResolvedValue({ nodes: [] });

    await client.searchIssues({
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
  });

  it("returns an empty array when the SDK returns no nodes", async () => {
    const { client, sdk } = buildClient();
    sdk.issues.mockResolvedValue({ nodes: [] });

    const results = await client.searchIssues({ state: "Todo" });

    expect(results).toEqual([]);
  });

  it("handles an undefined issuesConn gracefully", async () => {
    const { client, sdk } = buildClient();
    sdk.issues.mockResolvedValue(undefined);

    const results = await client.searchIssues({ state: "Todo" });

    expect(results).toEqual([]);
  });
});

describe("RealLinearClient.postComment", () => {
  it("calls sdk.createComment with issueId and body", async () => {
    const { client, sdk } = buildClient();
    sdk.createComment.mockResolvedValue({});

    await client.postComment("issue-1", "Hello world");

    expect(sdk.createComment).toHaveBeenCalledWith({ issueId: "issue-1", body: "Hello world" });
  });

  it("propagates errors from the SDK", async () => {
    const { client, sdk } = buildClient();
    sdk.createComment.mockRejectedValue(new Error("Linear API error"));

    await expect(client.postComment("issue-1", "Hello")).rejects.toThrow("Linear API error");
  });
});

describe("RealLinearClient.updateIssueState", () => {
  it("warns and does nothing when the issue has no team", async () => {
    const { client, sdk, logger } = buildClient();
    sdk.issue.mockResolvedValue(makeFakeIssue({ id: "issue-1", team: Promise.resolve(null) }));

    await client.updateIssueState("issue-1", "Done");

    expect(sdk.updateIssue).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith({ issueId: "issue-1" }, "Cannot update state: issue has no team");
  });

  it("warns and does nothing when the named workflow state cannot be found", async () => {
    const { client, sdk, logger } = buildClient();
    sdk.issue.mockResolvedValue(
      makeFakeIssue({ id: "issue-1", team: Promise.resolve({ id: "team-1", key: "PRY" }) }),
    );
    sdk.team.mockResolvedValue({ states: () => Promise.resolve({ nodes: [{ id: "s1", name: "Todo" }] }) });

    await client.updateIssueState("issue-1", "NonexistentState");

    expect(sdk.updateIssue).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(
      { issueId: "issue-1", stateName: "NonexistentState", teamId: "team-1" },
      "Could not find workflow state by name",
    );
  });

  it("resolves the state id from the team's workflow states and updates the issue", async () => {
    const { client, sdk } = buildClient();
    sdk.issue.mockResolvedValue(
      makeFakeIssue({ id: "issue-1", team: Promise.resolve({ id: "team-1", key: "PRY" }) }),
    );
    sdk.team.mockResolvedValue({
      states: () =>
        Promise.resolve({ nodes: [{ id: "s1", name: "Todo" }, { id: "s2", name: "Done" }] }),
    });
    sdk.updateIssue.mockResolvedValue({});

    await client.updateIssueState("issue-1", "Done");

    expect(sdk.updateIssue).toHaveBeenCalledWith("issue-1", { stateId: "s2" });
  });

  it("caches the team's state map across calls (sdk.team is called only once)", async () => {
    const { client, sdk } = buildClient();
    sdk.issue.mockResolvedValue(
      makeFakeIssue({ id: "issue-1", team: Promise.resolve({ id: "team-1", key: "PRY" }) }),
    );
    sdk.team.mockResolvedValue({
      states: () => Promise.resolve({ nodes: [{ id: "s1", name: "Todo" }, { id: "s2", name: "Done" }] }),
    });
    sdk.updateIssue.mockResolvedValue({});

    await client.updateIssueState("issue-1", "Done");
    await client.updateIssueState("issue-1", "Todo");

    expect(sdk.team).toHaveBeenCalledTimes(1);
  });
});

describe("RealLinearClient.addLabel", () => {
  it("creates the issue's team-scoped label when it does not exist, then adds it", async () => {
    const { client, sdk } = buildClient();
    sdk.issue.mockResolvedValue(
      makeFakeIssue({ id: "issue-1", labelIds: [], team: Promise.resolve({ id: "team-1", key: "PRY" }) }),
    );
    sdk.issueLabels.mockResolvedValue({ nodes: [] });
    sdk.createIssueLabel.mockResolvedValue({ issueLabel: Promise.resolve({ id: "new-label-id" }) });
    sdk.updateIssue.mockResolvedValue({});

    await client.addLabel("issue-1", "ai:planning");

    expect(sdk.issueLabels).toHaveBeenCalledWith({ filter: { name: { eq: "ai:planning" } } });
    expect(sdk.createIssueLabel).toHaveBeenCalledWith({ name: "ai:planning", teamId: "team-1" });
    expect(sdk.updateIssue).toHaveBeenCalledWith("issue-1", { labelIds: ["new-label-id"] });
  });

  it("reuses an existing label found via issueLabels() instead of creating one", async () => {
    const { client, sdk } = buildClient();
    sdk.issue.mockResolvedValue(makeFakeIssue({ id: "issue-1", labelIds: [] }));
    sdk.issueLabels.mockResolvedValue({ nodes: [{ id: "existing-label", name: "ai:planning" }] });
    sdk.updateIssue.mockResolvedValue({});

    await client.addLabel("issue-1", "ai:planning");

    expect(sdk.createIssueLabel).not.toHaveBeenCalled();
    expect(sdk.updateIssue).toHaveBeenCalledWith("issue-1", { labelIds: ["existing-label"] });
  });

  it("does not call updateIssue when the label is already on the issue", async () => {
    const { client, sdk } = buildClient();
    sdk.issue.mockResolvedValue(makeFakeIssue({ id: "issue-1", labelIds: ["existing-label"] }));
    sdk.issueLabels.mockResolvedValue({ nodes: [{ id: "existing-label", name: "ai:planning" }] });

    await client.addLabel("issue-1", "ai:planning");

    expect(sdk.updateIssue).not.toHaveBeenCalled();
  });

  it("throws when label creation reports no created label", async () => {
    const { client, sdk } = buildClient();
    sdk.issue.mockResolvedValue(makeFakeIssue({ id: "issue-1", labelIds: [] }));
    sdk.issueLabels.mockResolvedValue({ nodes: [] });
    sdk.createIssueLabel.mockResolvedValue({ issueLabel: Promise.resolve(null) });

    await expect(client.addLabel("issue-1", "ai:planning")).rejects.toThrow(
      "Failed to create label: ai:planning",
    );
  });

  it("uses the label cache on a second call and skips the issueLabels lookup", async () => {
    const { client, sdk } = buildClient();
    sdk.issue.mockResolvedValue(makeFakeIssue({ id: "issue-1", labelIds: [] }));
    sdk.issueLabels.mockResolvedValue({ nodes: [{ id: "cached-label", name: "ai:planning" }] });
    sdk.updateIssue.mockResolvedValue({});

    await client.addLabel("issue-1", "ai:planning");
    sdk.issue.mockResolvedValue(makeFakeIssue({ id: "issue-2", labelIds: [] }));
    await client.addLabel("issue-2", "ai:planning");

    expect(sdk.issueLabels).toHaveBeenCalledTimes(1);
  });
});

describe("RealLinearClient.removeLabel", () => {
  it("looks up the label id via labels() when not cached, removes it, and caches it", async () => {
    const { client, sdk } = buildClient();
    sdk.issue.mockResolvedValue(
      makeFakeIssue({
        id: "issue-1",
        labelIds: ["label-a", "label-b"],
        labels: () =>
          Promise.resolve({ nodes: [{ id: "label-a", name: "ai:planning" }, { id: "label-b", name: "bug" }] }),
      }),
    );
    sdk.updateIssue.mockResolvedValue({});

    await client.removeLabel("issue-1", "ai:planning");

    expect(sdk.updateIssue).toHaveBeenCalledWith("issue-1", { labelIds: ["label-b"] });
  });

  it("does nothing when the label name is not found on the issue", async () => {
    const { client, sdk } = buildClient();
    sdk.issue.mockResolvedValue(
      makeFakeIssue({
        id: "issue-1",
        labelIds: ["label-b"],
        labels: () => Promise.resolve({ nodes: [{ id: "label-b", name: "bug" }] }),
      }),
    );

    await client.removeLabel("issue-1", "nonexistent");

    expect(sdk.updateIssue).not.toHaveBeenCalled();
  });

  it("uses the cached label id on a later call instead of calling labels() again", async () => {
    const { client, sdk } = buildClient();
    const labelsFn = vi
      .fn()
      .mockResolvedValue({ nodes: [{ id: "label-a", name: "ai:planning" }] });
    sdk.issue.mockResolvedValue(
      makeFakeIssue({ id: "issue-1", labelIds: ["label-a"], labels: labelsFn }),
    );
    sdk.updateIssue.mockResolvedValue({});

    await client.removeLabel("issue-1", "ai:planning");
    sdk.issue.mockResolvedValue(
      makeFakeIssue({ id: "issue-1", labelIds: ["label-a"], labels: labelsFn }),
    );
    await client.removeLabel("issue-1", "ai:planning");

    expect(labelsFn).toHaveBeenCalledTimes(1);
    expect(sdk.updateIssue).toHaveBeenCalledTimes(2);
  });
});

describe("RealLinearClient.listLabels", () => {
  it("returns label names and populates the label cache", async () => {
    const { client, sdk } = buildClient();
    sdk.issue.mockResolvedValue(
      makeFakeIssue({
        id: "issue-1",
        labels: () =>
          Promise.resolve({ nodes: [{ id: "l1", name: "bug" }, { id: "l2", name: "ai:planning" }] }),
      }),
    );

    const names = await client.listLabels("issue-1");

    expect(names).toEqual(["bug", "ai:planning"]);
  });

  it("populates the cache so a subsequent removeLabel skips the labels() lookup", async () => {
    const { client, sdk } = buildClient();
    const labelsFn = vi
      .fn()
      .mockResolvedValue({ nodes: [{ id: "l1", name: "ai:planning" }] });
    sdk.issue.mockResolvedValue(makeFakeIssue({ id: "issue-1", labelIds: ["l1"], labels: labelsFn }));
    sdk.updateIssue.mockResolvedValue({});

    await client.listLabels("issue-1");
    expect(labelsFn).toHaveBeenCalledTimes(1);

    await client.removeLabel("issue-1", "ai:planning");
    // removeLabel should hit the cache populated by listLabels, not call labels() again
    expect(labelsFn).toHaveBeenCalledTimes(1);
    expect(sdk.updateIssue).toHaveBeenCalledWith("issue-1", { labelIds: [] });
  });

  it("returns [] when the issue has no labels", async () => {
    const { client, sdk } = buildClient();
    sdk.issue.mockResolvedValue(makeFakeIssue({ id: "issue-1" }));

    expect(await client.listLabels("issue-1")).toEqual([]);
  });
});

describe("RealLinearClient.getRelatedContext blocker hydration failure", () => {
  it("logs a warning and drops a blocker relation whose issue promise rejects", async () => {
    const { client, sdk, logger } = buildClient();
    const rejectedIssue = Promise.reject(new Error("deleted issue"));
    // Attach a no-op handler so Node doesn't report this as an unhandled
    // rejection before the client code below awaits (and catches) it.
    rejectedIssue.catch(() => undefined);
    const focus = makeFakeIssue({
      id: "focus-id",
      parent: Promise.resolve(null),
      inverseRelations: () =>
        Promise.resolve({
          nodes: [
            {
              id: "rel-1",
              type: "blocks",
              issue: rejectedIssue,
            },
          ],
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

  it("treats an undefined inverseRelations() connection as no blockers", async () => {
    const { client, sdk } = buildClient();
    const focus = makeFakeIssue({
      id: "focus-id",
      parent: Promise.resolve(null),
      inverseRelations: () => Promise.resolve(undefined as unknown as { nodes: unknown[] }),
    });
    sdk.issue.mockResolvedValue(focus);

    const ctx = await client.getRelatedContext("focus-id");

    expect(ctx.blockers).toEqual([]);
  });

  it("defaults a parent/blocker's state to 'Unknown' when the SDK resolves a null state", async () => {
    const { client, sdk } = buildClient();
    const parent = makeFakeIssue({ id: "parent-id", state: Promise.resolve(null) });
    const focus = makeFakeIssue({ id: "focus-id", parent: Promise.resolve(parent) });
    sdk.issue.mockResolvedValue(focus);

    const ctx = await client.getRelatedContext("focus-id");

    expect(ctx.parent?.state).toBe("Unknown");
  });

  it("treats an undefined labels() connection on a parent/blocker as no labels", async () => {
    const { client, sdk } = buildClient();
    const parent = makeFakeIssue({
      id: "parent-id",
      labels: () => Promise.resolve(undefined as unknown as { nodes: Array<{ id: string; name: string }> }),
    });
    const focus = makeFakeIssue({ id: "focus-id", parent: Promise.resolve(parent) });
    sdk.issue.mockResolvedValue(focus);

    const ctx = await client.getRelatedContext("focus-id");

    expect(ctx.parent?.labels).toEqual([]);
  });
});

describe("RealLinearClient.getIssue additional branch coverage", () => {
  it("treats an undefined labels() connection as no labels", async () => {
    const { client, sdk } = buildClient();
    sdk.issue.mockResolvedValue(
      makeFakeIssue({
        id: "issue-1",
        labels: () => Promise.resolve(undefined as unknown as { nodes: Array<{ id: string; name: string }> }),
      }),
    );

    const result = await client.getIssue("issue-1");

    expect(result.labels).toEqual([]);
  });
});

describe("RealLinearClient.searchIssues additional branch coverage", () => {
  it("maps a non-null project and cycle name on a search result", async () => {
    const { client, sdk } = buildClient();
    const resultIssue = makeFakeIssue({
      id: "r1",
      project: Promise.resolve({ name: "Project A" }),
      cycle: Promise.resolve({ name: "Cycle 3" }),
    });
    sdk.issues.mockResolvedValue({ nodes: [resultIssue] });

    const [result] = await client.searchIssues({ state: "Todo" });

    expect(result.project).toBe("Project A");
    expect(result.cycle).toBe("Cycle 3");
  });

  it("defaults description/project/team/cycle/labels when the SDK resolves them as null/undefined", async () => {
    const { client, sdk } = buildClient();
    const resultIssue = makeFakeIssue({
      id: "r1",
      description: null,
      project: Promise.resolve(null),
      cycle: Promise.resolve(null),
      team: Promise.resolve(null),
      labels: () => Promise.resolve(undefined as unknown as { nodes: Array<{ id: string; name: string }> }),
    });
    sdk.issues.mockResolvedValue({ nodes: [resultIssue] });

    const [result] = await client.searchIssues({ state: "Todo" });

    expect(result).toMatchObject({
      description: "",
      project: undefined,
      team: undefined,
      cycle: undefined,
      labels: [],
    });
  });
});

describe("RealLinearClient.listLabels additional branch coverage", () => {
  it("returns [] and populates nothing when the SDK resolves an undefined labels() connection", async () => {
    const { client, sdk } = buildClient();
    sdk.issue.mockResolvedValue(
      makeFakeIssue({
        id: "issue-1",
        labels: () => Promise.resolve(undefined as unknown as { nodes: Array<{ id: string; name: string }> }),
      }),
    );

    const names = await client.listLabels("issue-1");

    expect(names).toEqual([]);
  });
});

describe("RealLinearClient.updateIssueState additional branch coverage", () => {
  it("finds no state when the team's states() connection resolves undefined", async () => {
    const { client, sdk, logger } = buildClient();
    sdk.issue.mockResolvedValue(
      makeFakeIssue({ id: "issue-1", team: Promise.resolve({ id: "team-1", key: "PRY" }) }),
    );
    sdk.team.mockResolvedValue({ states: () => Promise.resolve(undefined) });

    await client.updateIssueState("issue-1", "Done");

    expect(sdk.updateIssue).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(
      { issueId: "issue-1", stateName: "Done", teamId: "team-1" },
      "Could not find workflow state by name",
    );
  });
});

describe("RealLinearClient.addLabel additional branch coverage", () => {
  it("creates a label with no teamId when the issue has no team", async () => {
    const { client, sdk } = buildClient();
    sdk.issue.mockResolvedValue(
      makeFakeIssue({ id: "issue-1", labelIds: [], team: Promise.resolve(null) }),
    );
    sdk.issueLabels.mockResolvedValue({ nodes: [] });
    sdk.createIssueLabel.mockResolvedValue({ issueLabel: Promise.resolve({ id: "new-label-id" }) });
    sdk.updateIssue.mockResolvedValue({});

    await client.addLabel("issue-1", "ai:planning");

    expect(sdk.createIssueLabel).toHaveBeenCalledWith({ name: "ai:planning" });
  });
});
