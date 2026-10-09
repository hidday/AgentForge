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
  team: Promise<{ id: string; key: string } | null>;
  state: Promise<{ id: string; name: string } | null>;
  project: Promise<{ name: string } | null>;
  cycle: Promise<{ name: string } | null>;
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
    team: Promise.resolve({ id: "team-1", key: "PRY" }),
    state: Promise.resolve({ id: "state-1", name: "Todo" }),
    project: Promise.resolve(null),
    cycle: Promise.resolve(null),
    labels: () => Promise.resolve({ nodes: [] }),
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

function makeFakeSdk(): FakeSdk {
  return {
    issue: vi.fn(),
    issues: vi.fn(),
    team: vi.fn(),
    createComment: vi.fn(),
    updateIssue: vi.fn(),
    issueLabels: vi.fn(),
    createIssueLabel: vi.fn(),
  };
}

function build() {
  const logger = makeLogger();
  const client = new RealLinearClient("key", logger as never);
  const sdk = makeFakeSdk();
  (client as unknown as { sdk: FakeSdk }).sdk = sdk;
  return { client, sdk, logger };
}

describe("RealLinearClient.getRelatedContext blocker hydration failure", () => {
  it("logs a warning and drops a blocker whose relation.issue rejects", async () => {
    const { client, sdk, logger } = build();
    const okBlocker = makeFakeIssue({ id: "blocker-ok" });
    const focus = makeFakeIssue({
      id: "focus-id",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      inverseRelations: (() =>
        Promise.resolve({
          nodes: [
            { id: "rel-bad", type: "blocks", issue: Promise.reject(new Error("blocker gone")) },
            { id: "rel-ok", type: "blocks", issue: Promise.resolve(okBlocker) },
          ],
        })) as unknown as FakeIssue["labels"] extends never ? never : () => Promise<never>,
    } as unknown as Partial<FakeIssue> & { id: string });
    sdk.issue.mockImplementation((id: string) =>
      Promise.resolve(id === "focus-id" ? focus : okBlocker),
    );

    const ctx = await client.getRelatedContext("focus-id");

    expect(ctx.blockers).toHaveLength(1);
    expect(ctx.blockers[0].id).toBe("blocker-ok");
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ relationId: "rel-bad", focusIssueId: "focus-id" }),
      "Failed to hydrate blocker issue from relation",
    );
  });
});

describe("RealLinearClient.getIssue", () => {
  it("maps all fields, defaulting null description and missing relations", async () => {
    const { client, sdk } = build();
    const issue = makeFakeIssue({
      id: "i1",
      description: null,
      team: Promise.resolve(null),
      project: Promise.resolve(null),
      cycle: Promise.resolve(null),
      state: Promise.resolve(null),
      labels: () => Promise.resolve({ nodes: [{ id: "l1", name: "bug" }] }),
    });
    sdk.issue.mockResolvedValue(issue);

    const result = await client.getIssue("i1");

    expect(result).toEqual({
      id: "i1",
      identifier: "PRY-1",
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
    const { client, sdk } = build();
    const issue = makeFakeIssue({
      id: "i2",
      project: Promise.resolve({ name: "Project X" }),
      cycle: Promise.resolve({ name: "Cycle 3" }),
      team: Promise.resolve({ id: "team-1", key: "PRY" }),
    });
    sdk.issue.mockResolvedValue(issue);

    const result = await client.getIssue("i2");
    expect(result.project).toBe("Project X");
    expect(result.cycle).toBe("Cycle 3");
    expect(result.team).toBe("PRY");
  });
});

describe("RealLinearClient.searchIssues", () => {
  it("builds a filter with only state when no optional filters are given", async () => {
    const { client, sdk, logger } = build();
    const node = makeFakeIssue({ id: "i1" });
    sdk.issues.mockResolvedValue({ nodes: [node] });

    const results = await client.searchIssues({ state: "Todo" });

    expect(sdk.issues).toHaveBeenCalledWith({ filter: { state: { name: { eq: "Todo" } } } });
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe("i1");
    expect(results[0].state).toBe("Todo");
    expect(logger.info).toHaveBeenCalled();
  });

  it("adds project, assignee, and team clauses when provided", async () => {
    const { client, sdk } = build();
    sdk.issues.mockResolvedValue({ nodes: [] });

    await client.searchIssues({
      state: "Todo",
      projectName: "Project X",
      assigneeMe: true,
      team: "ENG",
    });

    expect(sdk.issues).toHaveBeenCalledWith({
      filter: {
        state: { name: { eq: "Todo" } },
        project: { name: { eq: "Project X" } },
        assignee: { isMe: { eq: true } },
        team: { or: [{ name: { eq: "ENG" } }, { key: { eq: "ENG" } }] },
      },
    });
  });

  it("returns [] when the connection has no nodes", async () => {
    const { client, sdk } = build();
    sdk.issues.mockResolvedValue(null);
    const results = await client.searchIssues({ state: "Todo" });
    expect(results).toEqual([]);
  });

  it("maps project/cycle/team names per result node", async () => {
    const { client, sdk } = build();
    const node = makeFakeIssue({
      id: "i1",
      project: Promise.resolve({ name: "Proj" }),
      cycle: Promise.resolve({ name: "Cyc" }),
      team: Promise.resolve({ id: "t1", key: "ENG" }),
      labels: () => Promise.resolve({ nodes: [{ id: "l1", name: "urgent" }] }),
    });
    sdk.issues.mockResolvedValue({ nodes: [node] });

    const [result] = await client.searchIssues({ state: "Todo" });
    expect(result.project).toBe("Proj");
    expect(result.cycle).toBe("Cyc");
    expect(result.team).toBe("ENG");
    expect(result.labels).toEqual(["urgent"]);
  });
});

describe("RealLinearClient.postComment", () => {
  it("posts via the SDK and logs", async () => {
    const { client, sdk, logger } = build();
    sdk.createComment.mockResolvedValue({});

    await client.postComment("i1", "hello");

    expect(sdk.createComment).toHaveBeenCalledWith({ issueId: "i1", body: "hello" });
    expect(logger.debug).toHaveBeenCalled();
  });
});

describe("RealLinearClient.updateIssueState", () => {
  it("warns and does nothing when the issue has no team", async () => {
    const { client, sdk, logger } = build();
    sdk.issue.mockResolvedValue(makeFakeIssue({ id: "i1", team: Promise.resolve(null) }));

    await client.updateIssueState("i1", "Done");

    expect(logger.warn).toHaveBeenCalled();
    expect(sdk.updateIssue).not.toHaveBeenCalled();
  });

  it("warns and does nothing when the named state cannot be resolved", async () => {
    const { client, sdk, logger } = build();
    sdk.issue.mockResolvedValue(
      makeFakeIssue({ id: "i1", team: Promise.resolve({ id: "team-1", key: "PRY" }) }),
    );
    sdk.team.mockResolvedValue({ states: () => Promise.resolve({ nodes: [] }) });

    await client.updateIssueState("i1", "Nonexistent");

    expect(logger.warn).toHaveBeenCalled();
    expect(sdk.updateIssue).not.toHaveBeenCalled();
  });

  it("resolves the state id and updates the issue, caching the team's states", async () => {
    const { client, sdk } = build();
    sdk.issue.mockResolvedValue(
      makeFakeIssue({ id: "i1", team: Promise.resolve({ id: "team-1", key: "PRY" }) }),
    );
    const statesFn = vi.fn().mockResolvedValue({ nodes: [{ id: "state-done", name: "Done" }] });
    sdk.team.mockResolvedValue({ states: statesFn });

    await client.updateIssueState("i1", "Done");
    expect(sdk.updateIssue).toHaveBeenCalledWith("i1", { stateId: "state-done" });

    // Second call for the same team should reuse the cached state map.
    sdk.issue.mockResolvedValue(
      makeFakeIssue({ id: "i2", team: Promise.resolve({ id: "team-1", key: "PRY" }) }),
    );
    await client.updateIssueState("i2", "Done");
    expect(sdk.team).toHaveBeenCalledTimes(1);
  });
});

describe("RealLinearClient.addLabel", () => {
  it("resolves an existing label via issueLabels, caches it, and appends it when missing", async () => {
    const { client, sdk } = build();
    sdk.issue.mockResolvedValue(
      makeFakeIssue({
        id: "i1",
        labelIds: ["other-id"],
        team: Promise.resolve({ id: "team-1", key: "PRY" }),
      }),
    );
    sdk.issueLabels.mockResolvedValue({ nodes: [{ id: "label-1", name: "bug" }] });

    await client.addLabel("i1", "bug");

    expect(sdk.issueLabels).toHaveBeenCalledWith({ filter: { name: { eq: "bug" } } });
    expect(sdk.updateIssue).toHaveBeenCalledWith("i1", { labelIds: ["other-id", "label-1"] });
  });

  it("does not update the issue when the label id is already present", async () => {
    const { client, sdk } = build();
    sdk.issue.mockResolvedValue(
      makeFakeIssue({ id: "i1", labelIds: ["label-1"], team: Promise.resolve(null) }),
    );
    sdk.issueLabels.mockResolvedValue({ nodes: [{ id: "label-1", name: "bug" }] });

    await client.addLabel("i1", "bug");

    expect(sdk.updateIssue).not.toHaveBeenCalled();
  });

  it("creates a new label (with teamId) when none exists, and caches it for reuse", async () => {
    const { client, sdk } = build();
    sdk.issue.mockResolvedValue(
      makeFakeIssue({ id: "i1", labelIds: [], team: Promise.resolve({ id: "team-1", key: "PRY" }) }),
    );
    sdk.issueLabels.mockResolvedValue({ nodes: [] });
    sdk.createIssueLabel.mockResolvedValue({
      issueLabel: Promise.resolve({ id: "new-label-id" }),
    });

    await client.addLabel("i1", "brand-new");

    expect(sdk.createIssueLabel).toHaveBeenCalledWith({ name: "brand-new", teamId: "team-1" });
    expect(sdk.updateIssue).toHaveBeenCalledWith("i1", { labelIds: ["new-label-id"] });

    // Second call for the same label name should hit the cache, not create again.
    sdk.issue.mockResolvedValue(
      makeFakeIssue({ id: "i2", labelIds: [], team: Promise.resolve({ id: "team-1", key: "PRY" }) }),
    );
    await client.addLabel("i2", "brand-new");
    expect(sdk.createIssueLabel).toHaveBeenCalledTimes(1);
  });

  it("creates a new label without a teamId when the issue has no team", async () => {
    const { client, sdk } = build();
    sdk.issue.mockResolvedValue(
      makeFakeIssue({ id: "i1", labelIds: [], team: Promise.resolve(null) }),
    );
    sdk.issueLabels.mockResolvedValue({ nodes: [] });
    sdk.createIssueLabel.mockResolvedValue({ issueLabel: Promise.resolve({ id: "new-id" }) });

    await client.addLabel("i1", "no-team-label");

    expect(sdk.createIssueLabel).toHaveBeenCalledWith({ name: "no-team-label" });
  });

  it("throws when label creation does not return an issueLabel", async () => {
    const { client, sdk } = build();
    sdk.issue.mockResolvedValue(
      makeFakeIssue({ id: "i1", labelIds: [], team: Promise.resolve(null) }),
    );
    sdk.issueLabels.mockResolvedValue({ nodes: [] });
    sdk.createIssueLabel.mockResolvedValue({ issueLabel: Promise.resolve(null) });

    await expect(client.addLabel("i1", "broken")).rejects.toThrow(
      "Failed to create label: broken",
    );
  });
});

describe("RealLinearClient.removeLabel", () => {
  it("removes the label using a cached label id without re-querying labels()", async () => {
    const { client, sdk } = build();
    const labelsFn = vi.fn();
    sdk.issue.mockResolvedValue(
      makeFakeIssue({ id: "i1", labelIds: ["label-1", "other"], labels: labelsFn }),
    );
    sdk.issueLabels.mockResolvedValue({ nodes: [{ id: "label-1", name: "bug" }] });
    sdk.createIssueLabel.mockResolvedValue({ issueLabel: Promise.resolve({ id: "label-1" }) });

    // Prime the cache via addLabel first.
    sdk.issue.mockResolvedValue(
      makeFakeIssue({ id: "i1", labelIds: [], team: Promise.resolve(null) }),
    );
    sdk.issueLabels.mockResolvedValue({ nodes: [{ id: "label-1", name: "bug" }] });
    await client.addLabel("i1", "bug");

    sdk.issue.mockResolvedValue(
      makeFakeIssue({ id: "i1", labelIds: ["label-1", "other"], labels: labelsFn }),
    );
    await client.removeLabel("i1", "bug");

    expect(labelsFn).not.toHaveBeenCalled();
    expect(sdk.updateIssue).toHaveBeenLastCalledWith("i1", { labelIds: ["other"] });
  });

  it("resolves the label id via labels() when not cached, then removes it", async () => {
    const { client, sdk } = build();
    sdk.issue.mockResolvedValue(
      makeFakeIssue({
        id: "i1",
        labelIds: ["label-1", "other"],
        labels: () => Promise.resolve({ nodes: [{ id: "label-1", name: "bug" }] }),
      }),
    );

    await client.removeLabel("i1", "bug");

    expect(sdk.updateIssue).toHaveBeenCalledWith("i1", { labelIds: ["other"] });
  });

  it("returns early without updating when the label is not found on the issue", async () => {
    const { client, sdk } = build();
    sdk.issue.mockResolvedValue(
      makeFakeIssue({
        id: "i1",
        labelIds: ["other"],
        labels: () => Promise.resolve({ nodes: [] }),
      }),
    );

    await client.removeLabel("i1", "missing-label");

    expect(sdk.updateIssue).not.toHaveBeenCalled();
  });
});

describe("RealLinearClient.listLabels", () => {
  it("returns label names and populates the label cache for reuse by removeLabel", async () => {
    const { client, sdk } = build();
    const labelsFn = vi.fn().mockResolvedValue({
      nodes: [
        { id: "label-1", name: "bug" },
        { id: "label-2", name: "urgent" },
      ],
    });
    sdk.issue.mockResolvedValue(makeFakeIssue({ id: "i1", labels: labelsFn }));

    const names = await client.listLabels("i1");
    expect(names).toEqual(["bug", "urgent"]);

    // removeLabel should now use the cache populated by listLabels, not call labels() again.
    sdk.issue.mockResolvedValue(
      makeFakeIssue({ id: "i1", labelIds: ["label-1", "label-2"], labels: labelsFn }),
    );
    await client.removeLabel("i1", "bug");
    expect(labelsFn).toHaveBeenCalledTimes(1);
    expect(sdk.updateIssue).toHaveBeenCalledWith("i1", { labelIds: ["label-2"] });
  });

  it("returns [] when the issue has no labels connection", async () => {
    const { client, sdk } = build();
    sdk.issue.mockResolvedValue(
      makeFakeIssue({ id: "i1", labels: () => Promise.resolve({ nodes: [] }) }),
    );
    expect(await client.listLabels("i1")).toEqual([]);
  });
});
