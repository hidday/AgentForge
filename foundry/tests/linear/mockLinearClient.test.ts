import { describe, it, expect } from "vitest";
import {
  MockLinearClient,
  type LinearIssue,
  type RelatedLinearIssue,
} from "../../src/linear/linearClient.js";

function makeIssue(overrides: Partial<LinearIssue> & { id: string }): LinearIssue {
  return {
    title: "Issue title",
    description: "Issue description",
    branchName: `ai/${overrides.id}`,
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
  it("returns a shallow copy of a seeded issue (top-level mutation is isolated)", async () => {
    const client = new MockLinearClient();
    const seeded = makeIssue({ id: "issue-1", title: "Original", labels: ["a"] });
    client.seedIssue(seeded);

    const issue = await client.getIssue("issue-1");
    expect(issue).toEqual(seeded);

    issue.title = "Mutated";
    const second = await client.getIssue("issue-1");
    expect(second.title).toBe("Original");
  });

  it("throws synchronously when the issue was never seeded", () => {
    const client = new MockLinearClient();
    expect(() => client.getIssue("missing")).toThrow("Mock: Issue missing not found");
  });
});

describe("MockLinearClient.searchIssues", () => {
  it("matches issues by state only when no other filters are given", async () => {
    const client = new MockLinearClient();
    client.seedIssue(makeIssue({ id: "1", state: "Todo" }));
    client.seedIssue(makeIssue({ id: "2", state: "Done" }));
    client.seedIssue(makeIssue({ id: "3", state: "Todo" }));

    const results = await client.searchIssues({ state: "Todo" });

    expect(results.map((i) => i.id).sort()).toEqual(["1", "3"]);
  });

  it("further narrows matches by projectName when provided", async () => {
    const client = new MockLinearClient();
    client.seedIssue(makeIssue({ id: "1", state: "Todo", project: "Alpha" }));
    client.seedIssue(makeIssue({ id: "2", state: "Todo", project: "Beta" }));

    const results = await client.searchIssues({ state: "Todo", projectName: "Alpha" });

    expect(results).toHaveLength(1);
    expect(results[0].id).toBe("1");
  });

  it("returns an empty array when nothing matches", async () => {
    const client = new MockLinearClient();
    client.seedIssue(makeIssue({ id: "1", state: "Todo" }));

    const results = await client.searchIssues({ state: "Done" });

    expect(results).toEqual([]);
  });

  it("returns a shallow copy of each issue so reassigning a top-level field does not affect the store", async () => {
    const client = new MockLinearClient();
    client.seedIssue(makeIssue({ id: "1", state: "Todo", title: "Original" }));

    const [result] = await client.searchIssues({ state: "Todo" });
    result.title = "Mutated";

    const [again] = await client.searchIssues({ state: "Todo" });
    expect(again.title).toBe("Original");
  });
});

describe("MockLinearClient.postComment / getPostedComments", () => {
  it("records posted comments and returns them via getPostedComments", async () => {
    const client = new MockLinearClient();

    await client.postComment("issue-1", "first comment");
    await client.postComment("issue-1", "second comment");

    expect(client.getPostedComments()).toEqual([
      { issueId: "issue-1", body: "first comment" },
      { issueId: "issue-1", body: "second comment" },
    ]);
  });

  it("returns a copy from getPostedComments so callers cannot mutate internal state", async () => {
    const client = new MockLinearClient();
    await client.postComment("issue-1", "comment");

    const comments = client.getPostedComments();
    comments.push({ issueId: "issue-2", body: "injected" });

    expect(client.getPostedComments()).toHaveLength(1);
  });
});

describe("MockLinearClient.updateIssueState", () => {
  it("updates the state of a seeded issue", async () => {
    const client = new MockLinearClient();
    client.seedIssue(makeIssue({ id: "issue-1", state: "Todo" }));

    await client.updateIssueState("issue-1", "Done");

    const issue = await client.getIssue("issue-1");
    expect(issue.state).toBe("Done");
  });

  it("is a no-op when the issue does not exist", async () => {
    const client = new MockLinearClient();
    await expect(client.updateIssueState("missing", "Done")).resolves.toBeUndefined();
  });
});

describe("MockLinearClient.addLabel", () => {
  it("adds a new label to a seeded issue", async () => {
    const client = new MockLinearClient();
    client.seedIssue(makeIssue({ id: "issue-1", labels: ["existing"] }));

    await client.addLabel("issue-1", "new-label");

    const issue = await client.getIssue("issue-1");
    expect(issue.labels).toEqual(["existing", "new-label"]);
  });

  it("does not add a duplicate label", async () => {
    const client = new MockLinearClient();
    client.seedIssue(makeIssue({ id: "issue-1", labels: ["dup"] }));

    await client.addLabel("issue-1", "dup");

    const issue = await client.getIssue("issue-1");
    expect(issue.labels).toEqual(["dup"]);
  });

  it("is a no-op when the issue does not exist", async () => {
    const client = new MockLinearClient();
    await expect(client.addLabel("missing", "label")).resolves.toBeUndefined();
  });
});

describe("MockLinearClient.removeLabel", () => {
  it("removes an existing label from a seeded issue", async () => {
    const client = new MockLinearClient();
    client.seedIssue(makeIssue({ id: "issue-1", labels: ["a", "b"] }));

    await client.removeLabel("issue-1", "a");

    const issue = await client.getIssue("issue-1");
    expect(issue.labels).toEqual(["b"]);
  });

  it("is a no-op when the label is not present", async () => {
    const client = new MockLinearClient();
    client.seedIssue(makeIssue({ id: "issue-1", labels: ["a"] }));

    await client.removeLabel("issue-1", "missing-label");

    const issue = await client.getIssue("issue-1");
    expect(issue.labels).toEqual(["a"]);
  });

  it("is a no-op when the issue does not exist", async () => {
    const client = new MockLinearClient();
    await expect(client.removeLabel("missing", "a")).resolves.toBeUndefined();
  });
});

describe("MockLinearClient.listLabels", () => {
  it("returns a copy of the seeded issue's labels", async () => {
    const client = new MockLinearClient();
    client.seedIssue(makeIssue({ id: "issue-1", labels: ["a", "b"] }));

    const labels = await client.listLabels("issue-1");
    expect(labels).toEqual(["a", "b"]);

    labels.push("c");
    expect(await client.listLabels("issue-1")).toEqual(["a", "b"]);
  });

  it("returns an empty array when the issue does not exist", async () => {
    const client = new MockLinearClient();
    expect(await client.listLabels("missing")).toEqual([]);
  });
});
