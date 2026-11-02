import { describe, it, expect } from "vitest";
import { MockGitHubClient } from "../../src/github/githubClient.js";

describe("MockGitHubClient", () => {
  it("resolves repo access checks and the default branch", async () => {
    const client = new MockGitHubClient();
    await expect(client.verifyRepoAccess("acme/backend")).resolves.toBeUndefined();
    await expect(client.getDefaultBranch("acme/backend")).resolves.toBe("main");
  });

  it("records created branches", async () => {
    const client = new MockGitHubClient();
    await client.createBranch("acme/backend", "ai/run-1");
    await client.createBranch("acme/backend", "ai/run-2");
    expect(client.getCreatedBranches()).toEqual(["ai/run-1", "ai/run-2"]);
  });

  it("creates draft PRs with incrementing numbers and tracks their draft state", async () => {
    const client = new MockGitHubClient();
    const pr1 = await client.createDraftPR("acme/backend", "ai/run-1", "main", "Title 1", "Body 1");
    const pr2 = await client.createDraftPR("acme/backend", "ai/run-2", "main", "Title 2", "Body 2");

    expect(pr2).toBe(pr1 + 1);

    const created = client.getCreatedPRs();
    expect(created.get(pr1)).toEqual({
      repo: "acme/backend",
      head: "ai/run-1",
      title: "Title 1",
      draft: true,
    });
  });

  it("marks a PR ready by clearing its draft flag", async () => {
    const client = new MockGitHubClient();
    const pr = await client.createDraftPR("acme/backend", "ai/run-1", "main", "Title", "Body");

    await client.markPRReady("acme/backend", pr);

    expect(client.getCreatedPRs().get(pr)?.draft).toBe(false);
  });

  it("markPRReady is a no-op for an unknown PR number", async () => {
    const client = new MockGitHubClient();
    await expect(client.markPRReady("acme/backend", 999)).resolves.toBeUndefined();
  });

  it("returns a non-empty diff string from getPRDiff", async () => {
    const client = new MockGitHubClient();
    const diff = await client.getPRDiff("acme/backend", 1);
    expect(diff).toContain("diff --git");
  });

  it("listPRComments returns an empty array", async () => {
    const client = new MockGitHubClient();
    expect(await client.listPRComments("acme/backend", 1)).toEqual([]);
  });

  it("commentOnPR and createPRReviewComment and replyToReviewComment and submitPRReview all resolve", async () => {
    const client = new MockGitHubClient();
    await expect(client.commentOnPR("acme/backend", 1, "a comment")).resolves.toBeUndefined();

    const commentId = await client.createPRReviewComment(
      "acme/backend",
      1,
      "nit: rename this",
      "src/a.ts",
      42,
    );
    expect(typeof commentId).toBe("number");

    const commentIdNoLine = await client.createPRReviewComment(
      "acme/backend",
      1,
      "general comment",
      "src/b.ts",
    );
    expect(commentIdNoLine).toBe(commentId + 1);

    await expect(
      client.replyToReviewComment("acme/backend", 1, commentId, "thanks, fixed"),
    ).resolves.toBeUndefined();

    await expect(
      client.submitPRReview("acme/backend", 1, "LGTM", "APPROVE"),
    ).resolves.toBeUndefined();
  });
});
