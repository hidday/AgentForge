import { describe, it, expect } from "vitest";
import {
  MockLinearClient,
  type LinearIssue,
  type RelatedLinearIssue,
} from "../../src/linear/linearClient.js";

function makeRelated(overrides: Partial<RelatedLinearIssue> = {}): RelatedLinearIssue {
  return {
    id: "rel-1",
    identifier: "PRY-200",
    title: "Related issue",
    description: "Description",
    state: "Todo",
    labels: ["foo"],
    priority: 3,
    url: "https://linear.app/team/issue/PRY-200",
    ...overrides,
  };
}

function makeIssue(overrides: Partial<LinearIssue> = {}): LinearIssue {
  return {
    id: "issue-1",
    title: "Focus",
    description: "",
    branchName: "ai/issue-1",
    state: "Todo",
    labels: [],
    priority: 0,
    ...overrides,
  };
}

describe("MockLinearClient.getRelatedContext", () => {
  it("returns an empty blockers array when no relations have been seeded", async () => {
    const client = new MockLinearClient();
    client.seedIssue({
      id: "issue-1",
      title: "Focus",
      description: "",
      branchName: "ai/issue-1",
      state: "Todo",
      labels: [],
      priority: 0,
    });

    const ctx = await client.getRelatedContext("issue-1");

    expect(ctx).toEqual({ blockers: [] });
  });

  it("returns seeded parent and blockers via getRelatedContext", async () => {
    const client = new MockLinearClient();
    const parent = makeRelated({ id: "p1", identifier: "PRY-100", title: "Parent" });
    const blocker1 = makeRelated({ id: "b1", identifier: "PRY-101", title: "Blocker 1" });
    const blocker2 = makeRelated({ id: "b2", identifier: "PRY-102", title: "Blocker 2" });

    client.seedRelations("issue-1", { parent, blockers: [blocker1, blocker2] });

    const ctx = await client.getRelatedContext("issue-1");

    expect(ctx.parent).toEqual(parent);
    expect(ctx.blockers).toEqual([blocker1, blocker2]);
  });

  it("returns deep-cloned data so mutating the result does not affect future calls", async () => {
    const client = new MockLinearClient();
    const parent = makeRelated({ id: "p1", identifier: "PRY-100", title: "Original" });
    client.seedRelations("issue-1", { parent, blockers: [] });

    const first = await client.getRelatedContext("issue-1");
    if (first.parent) first.parent.title = "Mutated";

    const second = await client.getRelatedContext("issue-1");
    expect(second.parent?.title).toBe("Original");
  });

  it("supports overwriting previously seeded relations", async () => {
    const client = new MockLinearClient();
    client.seedRelations("issue-1", { blockers: [makeRelated({ id: "old" })] });
    client.seedRelations("issue-1", { blockers: [makeRelated({ id: "new" })] });

    const ctx = await client.getRelatedContext("issue-1");

    expect(ctx.blockers).toHaveLength(1);
    expect(ctx.blockers[0].id).toBe("new");
  });
});

describe("MockLinearClient.getIssue", () => {
  it("returns a clone of the seeded issue", async () => {
    const client = new MockLinearClient();
    const seeded = makeIssue({ id: "issue-1", title: "Original title" });
    client.seedIssue(seeded);

    const result = await client.getIssue("issue-1");
    expect(result).toEqual(seeded);

    result.title = "Mutated";
    const second = await client.getIssue("issue-1");
    expect(second.title).toBe("Original title");
  });

  it("throws when the issue was never seeded", () => {
    const client = new MockLinearClient();
    // getIssue throws synchronously (it is not an `async` function), so the
    // throw happens on invocation rather than via a rejected promise.
    expect(() => client.getIssue("missing-issue")).toThrow(
      "Mock: Issue missing-issue not found",
    );
  });
});

describe("MockLinearClient.searchIssues", () => {
  it("matches only issues with the given state", async () => {
    const client = new MockLinearClient();
    client.seedIssue(makeIssue({ id: "todo-1", state: "Todo" }));
    client.seedIssue(makeIssue({ id: "done-1", state: "Done" }));

    const results = await client.searchIssues({ state: "Todo" });

    expect(results.map((i) => i.id)).toEqual(["todo-1"]);
  });

  it("combines state and projectName filters (both must match)", async () => {
    const client = new MockLinearClient();
    client.seedIssue(makeIssue({ id: "match", state: "Todo", project: "Platform" }));
    client.seedIssue(makeIssue({ id: "wrong-project", state: "Todo", project: "Mobile" }));
    client.seedIssue(makeIssue({ id: "wrong-state", state: "Done", project: "Platform" }));

    const results = await client.searchIssues({ state: "Todo", projectName: "Platform" });

    expect(results.map((i) => i.id)).toEqual(["match"]);
  });

  it("excludes issues with no project when projectName filter is set", async () => {
    const client = new MockLinearClient();
    client.seedIssue(makeIssue({ id: "no-project", state: "Todo" }));

    const results = await client.searchIssues({ state: "Todo", projectName: "Platform" });

    expect(results).toEqual([]);
  });

  it("ignores assigneeMe and team filters (mock only filters on state/projectName)", async () => {
    const client = new MockLinearClient();
    client.seedIssue(makeIssue({ id: "issue-1", state: "Todo", team: "ENG" }));

    const results = await client.searchIssues({
      state: "Todo",
      assigneeMe: true,
      team: "OTHER-TEAM",
    });

    expect(results.map((i) => i.id)).toEqual(["issue-1"]);
  });

  it("returns an empty array when nothing matches", async () => {
    const client = new MockLinearClient();
    client.seedIssue(makeIssue({ id: "issue-1", state: "Done" }));

    const results = await client.searchIssues({ state: "Todo" });

    expect(results).toEqual([]);
  });

  it("returns clones, not live references to seeded issues", async () => {
    const client = new MockLinearClient();
    client.seedIssue(makeIssue({ id: "issue-1", state: "Todo" }));

    const [result] = await client.searchIssues({ state: "Todo" });
    result.title = "Mutated";

    const [second] = await client.searchIssues({ state: "Todo" });
    expect(second.title).toBe("Focus");
  });
});

describe("MockLinearClient.postComment / getPostedComments", () => {
  it("records posted comments against their issue id", async () => {
    const client = new MockLinearClient();

    await client.postComment("issue-1", "First comment");
    await client.postComment("issue-2", "Second comment");

    expect(client.getPostedComments()).toEqual([
      { issueId: "issue-1", body: "First comment" },
      { issueId: "issue-2", body: "Second comment" },
    ]);
  });

  it("returns a copy, so mutating the result does not affect internal state", async () => {
    const client = new MockLinearClient();
    await client.postComment("issue-1", "First comment");

    const comments = client.getPostedComments();
    comments.push({ issueId: "fake", body: "fake" });

    expect(client.getPostedComments()).toEqual([{ issueId: "issue-1", body: "First comment" }]);
  });
});

describe("MockLinearClient.updateIssueState", () => {
  it("updates the state of an existing issue", async () => {
    const client = new MockLinearClient();
    client.seedIssue(makeIssue({ id: "issue-1", state: "Todo" }));

    await client.updateIssueState("issue-1", "In Progress");

    const issue = await client.getIssue("issue-1");
    expect(issue.state).toBe("In Progress");
  });

  it("is a no-op and does not throw for a nonexistent issue", async () => {
    const client = new MockLinearClient();
    await expect(client.updateIssueState("missing", "Done")).resolves.toBeUndefined();
  });
});

describe("MockLinearClient.addLabel", () => {
  it("adds a new label to an existing issue", async () => {
    const client = new MockLinearClient();
    client.seedIssue(makeIssue({ id: "issue-1", labels: ["bug"] }));

    await client.addLabel("issue-1", "urgent");

    const issue = await client.getIssue("issue-1");
    expect(issue.labels).toEqual(["bug", "urgent"]);
  });

  it("does not add a duplicate label that already exists", async () => {
    const client = new MockLinearClient();
    client.seedIssue(makeIssue({ id: "issue-1", labels: ["bug"] }));

    await client.addLabel("issue-1", "bug");

    const issue = await client.getIssue("issue-1");
    expect(issue.labels).toEqual(["bug"]);
  });

  it("is a no-op and does not throw for a nonexistent issue", async () => {
    const client = new MockLinearClient();
    await expect(client.addLabel("missing", "urgent")).resolves.toBeUndefined();
  });
});

describe("MockLinearClient.removeLabel", () => {
  it("removes an existing label from an issue", async () => {
    const client = new MockLinearClient();
    client.seedIssue(makeIssue({ id: "issue-1", labels: ["bug", "urgent"] }));

    await client.removeLabel("issue-1", "bug");

    const issue = await client.getIssue("issue-1");
    expect(issue.labels).toEqual(["urgent"]);
  });

  it("is a no-op when the label is not present on the issue", async () => {
    const client = new MockLinearClient();
    client.seedIssue(makeIssue({ id: "issue-1", labels: ["urgent"] }));

    await client.removeLabel("issue-1", "bug");

    const issue = await client.getIssue("issue-1");
    expect(issue.labels).toEqual(["urgent"]);
  });

  it("is a no-op and does not throw for a nonexistent issue", async () => {
    const client = new MockLinearClient();
    await expect(client.removeLabel("missing", "bug")).resolves.toBeUndefined();
  });
});

describe("MockLinearClient.listLabels", () => {
  it("returns a copy of the issue's labels", async () => {
    const client = new MockLinearClient();
    client.seedIssue(makeIssue({ id: "issue-1", labels: ["bug", "urgent"] }));

    const labels = await client.listLabels("issue-1");
    expect(labels).toEqual(["bug", "urgent"]);

    labels.push("fake");
    expect(await client.listLabels("issue-1")).toEqual(["bug", "urgent"]);
  });

  it("returns an empty array for a nonexistent issue", async () => {
    const client = new MockLinearClient();
    await expect(client.listLabels("missing")).resolves.toEqual([]);
  });
});
