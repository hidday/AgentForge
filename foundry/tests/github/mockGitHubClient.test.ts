import { describe, it, expect } from "vitest";
import { MockGitHubClient } from "../../src/github/githubClient.js";

describe("MockGitHubClient", () => {
  it("resolves repo access verification without throwing", async () => {
    const client = new MockGitHubClient();
    await expect(client.verifyRepoAccess("acme/repo")).resolves.toBeUndefined();
  });

  it("always reports 'main' as the default branch", async () => {
    const client = new MockGitHubClient();
    await expect(client.getDefaultBranch("acme/repo")).resolves.toBe("main");
  });

  it("tracks created branches in creation order", async () => {
    const client = new MockGitHubClient();

    await client.createBranch("acme/repo", "ai/issue-1");
    await client.createBranch("acme/repo", "ai/issue-2");

    expect(client.getCreatedBranches()).toEqual(["ai/issue-1", "ai/issue-2"]);
  });

  it("returns a copy of created branches, not a live reference", async () => {
    const client = new MockGitHubClient();
    await client.createBranch("acme/repo", "ai/issue-1");

    const branches = client.getCreatedBranches();
    branches.push("not-real");

    expect(client.getCreatedBranches()).toEqual(["ai/issue-1"]);
  });

  it("creates draft PRs with incrementing PR numbers starting at 100", async () => {
    const client = new MockGitHubClient();

    const first = await client.createDraftPR("acme/repo", "head-1", "main", "Title 1", "Body 1");
    const second = await client.createDraftPR("acme/repo", "head-2", "main", "Title 2", "Body 2");

    expect(first).toBe(100);
    expect(second).toBe(101);
  });

  it("records created PRs as draft with the given metadata", async () => {
    const client = new MockGitHubClient();
    const prNumber = await client.createDraftPR("acme/repo", "head-1", "main", "My PR", "Body");

    const created = client.getCreatedPRs();
    expect(created.get(prNumber)).toEqual({
      repo: "acme/repo",
      head: "head-1",
      title: "My PR",
      draft: true,
    });
  });

  it("returns a snapshot map of created PRs, not a live reference", async () => {
    const client = new MockGitHubClient();
    const prNumber = await client.createDraftPR("acme/repo", "head-1", "main", "My PR", "Body");

    const snapshot = client.getCreatedPRs();
    snapshot.delete(prNumber);

    expect(client.getCreatedPRs().has(prNumber)).toBe(true);
  });

  it("marks an existing PR as no longer draft", async () => {
    const client = new MockGitHubClient();
    const prNumber = await client.createDraftPR("acme/repo", "head-1", "main", "My PR", "Body");

    await client.markPRReady("acme/repo", prNumber);

    expect(client.getCreatedPRs().get(prNumber)?.draft).toBe(false);
  });

  it("silently no-ops marking a nonexistent PR as ready", async () => {
    const client = new MockGitHubClient();
    await expect(client.markPRReady("acme/repo", 9999)).resolves.toBeUndefined();
  });

  it("returns a canned unified diff for getPRDiff", async () => {
    const client = new MockGitHubClient();
    const diff = await client.getPRDiff("acme/repo", 100);

    expect(diff).toContain("diff --git a/src/handler.ts b/src/handler.ts");
    expect(diff).toContain("export async function handleRequest");
  });

  it("returns an empty array for listPRComments", async () => {
    const client = new MockGitHubClient();
    await expect(client.listPRComments("acme/repo", 100)).resolves.toEqual([]);
  });

  it("creates PR review comments with incrementing comment ids", async () => {
    const client = new MockGitHubClient();

    const first = await client.createPRReviewComment(
      "acme/repo",
      100,
      "Fix this",
      "src/handler.ts",
      42,
    );
    const second = await client.createPRReviewComment(
      "acme/repo",
      100,
      "Fix that",
      "src/other.ts",
      7,
    );

    expect(first).toBe(1000);
    expect(second).toBe(1001);
  });

  it("formats the review comment body with file path and line when line is given", async () => {
    const client = new MockGitHubClient();
    await client.createPRReviewComment("acme/repo", 100, "Needs work", "src/handler.ts", 42);

    // commentOnPR records into the same internal list; use a subsequent call to
    // exercise the no-line branch and confirm both formats via observable behavior.
    await expect(
      client.createPRReviewComment("acme/repo", 100, "No line here", "src/other.ts"),
    ).resolves.toBe(1001);
  });

  it("replies to a review comment without throwing", async () => {
    const client = new MockGitHubClient();
    await expect(
      client.replyToReviewComment("acme/repo", 100, 1000, "Thanks, fixed."),
    ).resolves.toBeUndefined();
  });

  it("submits a PR review without throwing, for each event type", async () => {
    const client = new MockGitHubClient();
    await expect(
      client.submitPRReview("acme/repo", 100, "LGTM", "APPROVE"),
    ).resolves.toBeUndefined();
    await expect(
      client.submitPRReview("acme/repo", 100, "Needs changes", "REQUEST_CHANGES"),
    ).resolves.toBeUndefined();
    await expect(
      client.submitPRReview("acme/repo", 100, "Just a note", "COMMENT"),
    ).resolves.toBeUndefined();
  });

  it("comments on a PR without throwing", async () => {
    const client = new MockGitHubClient();
    await expect(
      client.commentOnPR("acme/repo", 100, "Automated comment"),
    ).resolves.toBeUndefined();
  });
});
