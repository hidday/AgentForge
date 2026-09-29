import { describe, it, expect } from "vitest";
import {
  MockLinearClient,
  type LinearIssue,
  type RelatedLinearIssue,
} from "../../src/linear/linearClient.js";

function makeIssue(overrides: Partial<LinearIssue> = {}): LinearIssue {
  return {
    id: "issue-1",
    title: "Focus issue",
    description: "",
    branchName: "ai/issue-1",
    state: "Todo",
    labels: [],
    priority: 0,
    ...overrides,
  };
}

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
  it("returns a cloned copy of a seeded issue", async () => {
    const client = new MockLinearClient();
    const seeded = makeIssue({ id: "issue-1", title: "Original title" });
    client.seedIssue(seeded);

    const result = await client.getIssue("issue-1");
    result.title = "Mutated";

    expect(result).toEqual({ ...seeded, title: "Mutated" });
    const second = await client.getIssue("issue-1");
    expect(second.title).toBe("Original title");
  });

  it("throws when the issue was never seeded", () => {
    const client = new MockLinearClient();

    expect(() => client.getIssue("missing")).toThrow("Mock: Issue missing not found");
  });
});

describe("MockLinearClient.searchIssues", () => {
  it("matches issues by state and returns cloned results", async () => {
    const client = new MockLinearClient();
    client.seedIssue(makeIssue({ id: "a", state: "Todo" }));
    client.seedIssue(makeIssue({ id: "b", state: "Done" }));

    const results = await client.searchIssues({ state: "Todo" });

    expect(results).toHaveLength(1);
    expect(results[0].id).toBe("a");
  });

  it("further filters by projectName when provided", async () => {
    const client = new MockLinearClient();
    client.seedIssue(makeIssue({ id: "a", state: "Todo", project: "Alpha" }));
    client.seedIssue(makeIssue({ id: "b", state: "Todo", project: "Beta" }));

    const results = await client.searchIssues({ state: "Todo", projectName: "Beta" });

    expect(results).toEqual([makeIssue({ id: "b", state: "Todo", project: "Beta" })]);
  });

  it("returns an empty array when nothing matches", async () => {
    const client = new MockLinearClient();
    client.seedIssue(makeIssue({ id: "a", state: "Todo" }));

    const results = await client.searchIssues({ state: "In Review" });

    expect(results).toEqual([]);
  });
});

describe("MockLinearClient.postComment / getPostedComments", () => {
  it("records posted comments and returns them via getPostedComments", async () => {
    const client = new MockLinearClient();

    await client.postComment("issue-1", "First comment");
    await client.postComment("issue-2", "Second comment");

    expect(client.getPostedComments()).toEqual([
      { issueId: "issue-1", body: "First comment" },
      { issueId: "issue-2", body: "Second comment" },
    ]);
  });

  it("returns a copy so mutating the result does not affect internal state", async () => {
    const client = new MockLinearClient();
    await client.postComment("issue-1", "Comment");

    const comments = client.getPostedComments();
    comments.push({ issueId: "issue-2", body: "Injected" });

    expect(client.getPostedComments()).toEqual([{ issueId: "issue-1", body: "Comment" }]);
  });
});

describe("MockLinearClient.updateIssueState", () => {
  it("updates the state of a seeded issue", async () => {
    const client = new MockLinearClient();
    client.seedIssue(makeIssue({ id: "issue-1", state: "Todo" }));

    await client.updateIssueState("issue-1", "In Progress");

    const issue = await client.getIssue("issue-1");
    expect(issue.state).toBe("In Progress");
  });

  it("is a no-op when the issue does not exist", async () => {
    const client = new MockLinearClient();

    await expect(client.updateIssueState("missing", "In Progress")).resolves.toBeUndefined();
  });
});

describe("MockLinearClient.addLabel", () => {
  it("adds a label that is not already present", async () => {
    const client = new MockLinearClient();
    client.seedIssue(makeIssue({ id: "issue-1", labels: ["foo"] }));

    await client.addLabel("issue-1", "bar");

    const labels = await client.listLabels("issue-1");
    expect(labels).toEqual(["foo", "bar"]);
  });

  it("does not duplicate a label that is already present", async () => {
    const client = new MockLinearClient();
    client.seedIssue(makeIssue({ id: "issue-1", labels: ["foo"] }));

    await client.addLabel("issue-1", "foo");

    const labels = await client.listLabels("issue-1");
    expect(labels).toEqual(["foo"]);
  });

  it("is a no-op when the issue does not exist", async () => {
    const client = new MockLinearClient();

    await expect(client.addLabel("missing", "foo")).resolves.toBeUndefined();
  });
});

describe("MockLinearClient.removeLabel", () => {
  it("removes an existing label from a seeded issue", async () => {
    const client = new MockLinearClient();
    client.seedIssue(makeIssue({ id: "issue-1", labels: ["foo", "bar"] }));

    await client.removeLabel("issue-1", "foo");

    const labels = await client.listLabels("issue-1");
    expect(labels).toEqual(["bar"]);
  });

  it("is a no-op when the label is not present on the issue", async () => {
    const client = new MockLinearClient();
    client.seedIssue(makeIssue({ id: "issue-1", labels: ["bar"] }));

    await client.removeLabel("issue-1", "foo");

    const labels = await client.listLabels("issue-1");
    expect(labels).toEqual(["bar"]);
  });

  it("is a no-op when the issue does not exist", async () => {
    const client = new MockLinearClient();

    await expect(client.removeLabel("missing", "foo")).resolves.toBeUndefined();
  });
});

describe("MockLinearClient.listLabels", () => {
  it("returns a copy of the seeded issue's labels", async () => {
    const client = new MockLinearClient();
    client.seedIssue(makeIssue({ id: "issue-1", labels: ["foo", "bar"] }));

    const labels = await client.listLabels("issue-1");
    labels.push("mutated");

    expect(await client.listLabels("issue-1")).toEqual(["foo", "bar"]);
  });

  it("returns an empty array when the issue does not exist", async () => {
    const client = new MockLinearClient();

    const labels = await client.listLabels("missing");

    expect(labels).toEqual([]);
  });
});
