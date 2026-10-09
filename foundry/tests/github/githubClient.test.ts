import { describe, it, expect } from "vitest";
import { MockGitHubClient } from "../../src/github/githubClient.js";

function getPrComments(client: MockGitHubClient): { prNumber: number; body: string }[] {
  return (client as unknown as { prComments: { prNumber: number; body: string }[] }).prComments;
}

describe("MockGitHubClient", () => {
  it("starts with no created branches or PRs", () => {
    const client = new MockGitHubClient();
    expect(client.getCreatedBranches()).toEqual([]);
    expect(client.getCreatedPRs()).toEqual(new Map());
  });

  it("verifyRepoAccess and getDefaultBranch resolve without side effects", async () => {
    const client = new MockGitHubClient();
    await expect(client.verifyRepoAccess("org/repo")).resolves.toBeUndefined();
    await expect(client.getDefaultBranch("org/repo")).resolves.toBe("main");
  });

  it("createBranch records the branch name", async () => {
    const client = new MockGitHubClient();
    await client.createBranch("org/repo", "feature/x");
    await client.createBranch("org/repo", "feature/y");
    expect(client.getCreatedBranches()).toEqual(["feature/x", "feature/y"]);
  });

  it("createDraftPR assigns incrementing PR numbers starting at 100 and marks draft true", async () => {
    const client = new MockGitHubClient();
    const first = await client.createDraftPR("org/repo", "head1", "main", "Title 1", "Body 1");
    const second = await client.createDraftPR("org/repo", "head2", "main", "Title 2", "Body 2");

    expect(first).toBe(100);
    expect(second).toBe(101);

    const prs = client.getCreatedPRs();
    expect(prs.get(100)).toEqual({ repo: "org/repo", head: "head1", title: "Title 1", draft: true });
    expect(prs.get(101)).toEqual({ repo: "org/repo", head: "head2", title: "Title 2", draft: true });
  });

  it("commentOnPR records the comment", async () => {
    const client = new MockGitHubClient();
    await client.commentOnPR("org/repo", 100, "Looks good");
    expect(getPrComments(client)).toEqual([{ prNumber: 100, body: "Looks good" }]);
  });

  it("getPRDiff returns a stub unified diff", async () => {
    const client = new MockGitHubClient();
    const diff = await client.getPRDiff("org/repo", 100);
    expect(diff).toContain("diff --git a/src/handler.ts b/src/handler.ts");
    expect(diff).toContain("+export async function handleRequest");
  });

  it("markPRReady flips draft to false for an existing PR", async () => {
    const client = new MockGitHubClient();
    const prNumber = await client.createDraftPR("org/repo", "head1", "main", "Title", "Body");
    await client.markPRReady("org/repo", prNumber);
    expect(client.getCreatedPRs().get(prNumber)?.draft).toBe(false);
  });

  it("markPRReady is a no-op when the PR does not exist", async () => {
    const client = new MockGitHubClient();
    await expect(client.markPRReady("org/repo", 9999)).resolves.toBeUndefined();
    expect(client.getCreatedPRs().size).toBe(0);
  });

  it("listPRComments always resolves to an empty array", async () => {
    const client = new MockGitHubClient();
    await expect(client.listPRComments("org/repo", 100)).resolves.toEqual([]);
  });

  it("createPRReviewComment formats body with path and line, and increments comment ids", async () => {
    const client = new MockGitHubClient();
    const id1 = await client.createPRReviewComment("org/repo", 100, "fix this", "src/a.ts", 42);
    const id2 = await client.createPRReviewComment("org/repo", 100, "and this", "src/b.ts", 7);

    expect(id1).toBe(1000);
    expect(id2).toBe(1001);
    expect(getPrComments(client)).toEqual([
      { prNumber: 100, body: "[src/a.ts:42] fix this" },
      { prNumber: 100, body: "[src/b.ts:7] and this" },
    ]);
  });

  it("createPRReviewComment omits the line suffix when line is undefined", async () => {
    const client = new MockGitHubClient();
    await client.createPRReviewComment("org/repo", 100, "file-level note", "src/a.ts");
    expect(getPrComments(client)).toEqual([{ prNumber: 100, body: "[src/a.ts] file-level note" }]);
  });

  it("createPRReviewComment treats line 0 as falsy and omits the line suffix", async () => {
    const client = new MockGitHubClient();
    await client.createPRReviewComment("org/repo", 100, "note", "src/a.ts", 0);
    expect(getPrComments(client)).toEqual([{ prNumber: 100, body: "[src/a.ts] note" }]);
  });

  it("replyToReviewComment records the reply body against the PR number", async () => {
    const client = new MockGitHubClient();
    await client.replyToReviewComment("org/repo", 100, 1000, "thanks, fixed");
    expect(getPrComments(client)).toEqual([{ prNumber: 100, body: "thanks, fixed" }]);
  });

  it("submitPRReview records the review body against the PR number", async () => {
    const client = new MockGitHubClient();
    await client.submitPRReview("org/repo", 100, "LGTM overall", "APPROVE");
    expect(getPrComments(client)).toEqual([{ prNumber: 100, body: "LGTM overall" }]);
  });
});
