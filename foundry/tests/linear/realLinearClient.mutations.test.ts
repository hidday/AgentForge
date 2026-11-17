import { describe, it, expect, vi, beforeEach } from "vitest";
import { RealLinearClient } from "../../src/linear/realLinearClient.js";

function makeLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
}

function injectSdk(client: RealLinearClient, sdk: Record<string, unknown>) {
  (client as unknown as { sdk: Record<string, unknown> }).sdk = sdk;
}

describe("RealLinearClient.searchIssues", () => {
  it("builds a GraphQL filter from projectName, assigneeMe, and team and maps results", async () => {
    const logger = makeLogger();
    const client = new RealLinearClient("key", logger as never);
    const issuesFn = vi.fn().mockResolvedValue({
      nodes: [
        {
          id: "i1",
          identifier: "ENG-1",
          title: "Fix bug",
          description: "desc",
          branchName: "ai/i1",
          priority: 1,
          url: "https://linear.app/i1",
          labels: () => Promise.resolve({ nodes: [{ name: "bug" }] }),
          project: Promise.resolve({ name: "Core" }),
          cycle: Promise.resolve(null),
          team: Promise.resolve({ key: "ENG" }),
        },
      ],
    });
    injectSdk(client, { issues: issuesFn });

    const results = await client.searchIssues({
      state: "Todo",
      projectName: "Core",
      assigneeMe: true,
      team: "ENG",
    });

    expect(issuesFn).toHaveBeenCalledWith({
      filter: {
        state: { name: { eq: "Todo" } },
        project: { name: { eq: "Core" } },
        assignee: { isMe: { eq: true } },
        team: { or: [{ name: { eq: "ENG" } }, { key: { eq: "ENG" } }] },
      },
    });
    expect(results).toEqual([
      {
        id: "i1",
        identifier: "ENG-1",
        title: "Fix bug",
        description: "desc",
        branchName: "ai/i1",
        state: "Todo",
        labels: ["bug"],
        priority: 1,
        url: "https://linear.app/i1",
        project: "Core",
        team: "ENG",
        cycle: undefined,
      },
    ]);
  });

  it("returns an empty array and a minimal filter when no optional fields are provided", async () => {
    const client = new RealLinearClient("key", makeLogger() as never);
    const issuesFn = vi.fn().mockResolvedValue({ nodes: [] });
    injectSdk(client, { issues: issuesFn });

    const results = await client.searchIssues({ state: "Done" });

    expect(issuesFn).toHaveBeenCalledWith({ filter: { state: { name: { eq: "Done" } } } });
    expect(results).toEqual([]);
  });
});

describe("RealLinearClient.postComment", () => {
  it("creates a comment via the SDK with the issueId and body", async () => {
    const client = new RealLinearClient("key", makeLogger() as never);
    const createComment = vi.fn().mockResolvedValue({});
    injectSdk(client, { createComment });

    await client.postComment("LIN-1", "hello world");

    expect(createComment).toHaveBeenCalledWith({ issueId: "LIN-1", body: "hello world" });
  });
});

describe("RealLinearClient.updateIssueState", () => {
  it("warns and returns early when the issue has no team", async () => {
    const logger = makeLogger();
    const client = new RealLinearClient("key", logger as never);
    const updateIssue = vi.fn();
    injectSdk(client, {
      issue: vi.fn().mockResolvedValue({ team: Promise.resolve(null) }),
      updateIssue,
    });

    await client.updateIssueState("LIN-1", "Done");

    expect(logger.warn).toHaveBeenCalled();
    expect(updateIssue).not.toHaveBeenCalled();
  });

  it("warns and returns early when the target state name cannot be resolved", async () => {
    const logger = makeLogger();
    const client = new RealLinearClient("key", logger as never);
    const updateIssue = vi.fn();
    injectSdk(client, {
      issue: vi.fn().mockResolvedValue({ team: Promise.resolve({ id: "team-1" }) }),
      team: vi.fn().mockResolvedValue({ states: () => Promise.resolve({ nodes: [] }) }),
      updateIssue,
    });

    await client.updateIssueState("LIN-1", "NonexistentState");

    expect(logger.warn).toHaveBeenCalled();
    expect(updateIssue).not.toHaveBeenCalled();
  });

  it("resolves the state id and calls updateIssue when the state is found", async () => {
    const client = new RealLinearClient("key", makeLogger() as never);
    const updateIssue = vi.fn().mockResolvedValue({});
    injectSdk(client, {
      issue: vi.fn().mockResolvedValue({ team: Promise.resolve({ id: "team-1" }) }),
      team: vi.fn().mockResolvedValue({
        states: () => Promise.resolve({ nodes: [{ id: "state-done", name: "Done" }] }),
      }),
      updateIssue,
    });

    await client.updateIssueState("LIN-1", "Done");

    expect(updateIssue).toHaveBeenCalledWith("LIN-1", { stateId: "state-done" });
  });

  it("caches the team's state map so a second call does not re-fetch the team", async () => {
    const client = new RealLinearClient("key", makeLogger() as never);
    const teamFn = vi.fn().mockResolvedValue({
      states: () => Promise.resolve({ nodes: [{ id: "state-done", name: "Done" }] }),
    });
    injectSdk(client, {
      issue: vi.fn().mockResolvedValue({ team: Promise.resolve({ id: "team-1" }) }),
      team: teamFn,
      updateIssue: vi.fn().mockResolvedValue({}),
    });

    await client.updateIssueState("LIN-1", "Done");
    await client.updateIssueState("LIN-2", "Done");

    expect(teamFn).toHaveBeenCalledTimes(1);
  });
});

describe("RealLinearClient.addLabel", () => {
  it("creates a new label via the SDK when none exists, then adds it to the issue", async () => {
    const logger = makeLogger();
    const client = new RealLinearClient("key", logger as never);
    const updateIssue = vi.fn().mockResolvedValue({});
    injectSdk(client, {
      issue: vi.fn().mockResolvedValue({ team: Promise.resolve({ id: "team-1" }), labelIds: [] }),
      issueLabels: vi.fn().mockResolvedValue({ nodes: [] }),
      createIssueLabel: vi.fn().mockResolvedValue({
        issueLabel: Promise.resolve({ id: "label-new" }),
      }),
      updateIssue,
    });

    await client.addLabel("LIN-1", "ai:todo");

    expect(updateIssue).toHaveBeenCalledWith("LIN-1", { labelIds: ["label-new"] });
    expect(logger.info).toHaveBeenCalled();
  });

  it("reuses an existing label found via issueLabels without creating a new one", async () => {
    const client = new RealLinearClient("key", makeLogger() as never);
    const createIssueLabel = vi.fn();
    const updateIssue = vi.fn().mockResolvedValue({});
    injectSdk(client, {
      issue: vi.fn().mockResolvedValue({ team: Promise.resolve({ id: "team-1" }), labelIds: [] }),
      issueLabels: vi.fn().mockResolvedValue({ nodes: [{ id: "label-existing" }] }),
      createIssueLabel,
      updateIssue,
    });

    await client.addLabel("LIN-1", "ai:todo");

    expect(createIssueLabel).not.toHaveBeenCalled();
    expect(updateIssue).toHaveBeenCalledWith("LIN-1", { labelIds: ["label-existing"] });
  });

  it("does not call updateIssue when the label id is already present on the issue", async () => {
    const client = new RealLinearClient("key", makeLogger() as never);
    const updateIssue = vi.fn();
    injectSdk(client, {
      issue: vi.fn().mockResolvedValue({
        team: Promise.resolve({ id: "team-1" }),
        labelIds: ["label-existing"],
      }),
      issueLabels: vi.fn().mockResolvedValue({ nodes: [{ id: "label-existing" }] }),
      updateIssue,
    });

    await client.addLabel("LIN-1", "ai:todo");

    expect(updateIssue).not.toHaveBeenCalled();
  });

  it("throws when label creation does not return an issueLabel payload", async () => {
    const client = new RealLinearClient("key", makeLogger() as never);
    injectSdk(client, {
      issue: vi.fn().mockResolvedValue({ team: Promise.resolve({ id: "team-1" }), labelIds: [] }),
      issueLabels: vi.fn().mockResolvedValue({ nodes: [] }),
      createIssueLabel: vi.fn().mockResolvedValue({ issueLabel: Promise.resolve(null) }),
      updateIssue: vi.fn(),
    });

    await expect(client.addLabel("LIN-1", "ai:todo")).rejects.toThrow(
      /Failed to create label: ai:todo/,
    );
  });
});

describe("RealLinearClient.removeLabel", () => {
  it("looks up the label id via the issue's labels when not cached, then removes it", async () => {
    const client = new RealLinearClient("key", makeLogger() as never);
    const updateIssue = vi.fn().mockResolvedValue({});
    injectSdk(client, {
      issue: vi.fn().mockResolvedValue({
        labelIds: ["label-a", "label-b"],
        labels: () => Promise.resolve({ nodes: [{ id: "label-b", name: "ai:todo" }] }),
      }),
      updateIssue,
    });

    await client.removeLabel("LIN-1", "ai:todo");

    expect(updateIssue).toHaveBeenCalledWith("LIN-1", { labelIds: ["label-a"] });
  });

  it("is a no-op when the label is not cached and not found on the issue", async () => {
    const client = new RealLinearClient("key", makeLogger() as never);
    const updateIssue = vi.fn();
    injectSdk(client, {
      issue: vi.fn().mockResolvedValue({
        labelIds: ["label-a"],
        labels: () => Promise.resolve({ nodes: [] }),
      }),
      updateIssue,
    });

    await client.removeLabel("LIN-1", "nonexistent");

    expect(updateIssue).not.toHaveBeenCalled();
  });

  it("uses the cached label id (populated by a prior listLabels call) without re-fetching labels", async () => {
    const client = new RealLinearClient("key", makeLogger() as never);
    const labelsFn = vi.fn().mockResolvedValue({ nodes: [{ id: "label-cached", name: "ai:done" }] });
    const updateIssue = vi.fn().mockResolvedValue({});
    injectSdk(client, {
      issue: vi.fn().mockResolvedValue({ labelIds: ["label-cached"], labels: labelsFn }),
      updateIssue,
    });

    await client.listLabels("LIN-1");
    labelsFn.mockClear();
    await client.removeLabel("LIN-1", "ai:done");

    expect(labelsFn).not.toHaveBeenCalled();
    expect(updateIssue).toHaveBeenCalledWith("LIN-1", { labelIds: [] });
  });
});

describe("RealLinearClient.listLabels", () => {
  it("returns label names and populates the label cache as a side effect", async () => {
    const client = new RealLinearClient("key", makeLogger() as never);
    injectSdk(client, {
      issue: vi.fn().mockResolvedValue({
        labels: () =>
          Promise.resolve({ nodes: [{ id: "l1", name: "bug" }, { id: "l2", name: "ai:todo" }] }),
      }),
    });

    await expect(client.listLabels("LIN-1")).resolves.toEqual(["bug", "ai:todo"]);
  });
});
