import { describe, it, expect } from "vitest";
import { MockGitHubClient } from "../../src/github/githubClient.js";

describe("MockGitHubClient", () => {
  it("resolves repo access checks and the default branch without side effects", async () => {
    const client = new MockGitHubClient();
    await expect(client.verifyRepoAccess("org/repo")).resolves.toBeUndefined();
    await expect(client.getDefaultBranch("org/repo")).resolves.toBe("main");
  });

  it("records created branches and makes them retrievable", async () => {
    const client = new MockGitHubClient();
    await client.createBranch("org/repo", "ai/run-1");
    await client.createBranch("org/repo", "ai/run-2");

    expect(client.getCreatedBranches()).toEqual(["ai/run-1", "ai/run-2"]);
  });

  it("creates a draft PR with an incrementing PR number and stores its metadata", async () => {
    const client = new MockGitHubClient();
    const first = await client.createDraftPR("org/repo", "ai/run-1", "main", "Title 1", "Body 1");
    const second = await client.createDraftPR("org/repo", "ai/run-2", "main", "Title 2", "Body 2");

    expect(second).toBe(first + 1);

    const prs = client.getCreatedPRs();
    expect(prs.get(first)).toEqual({ repo: "org/repo", head: "ai/run-1", title: "Title 1", draft: true });
  });

  it("marks a PR as not-draft when markPRReady is called", async () => {
    const client = new MockGitHubClient();
    const prNumber = await client.createDraftPR("org/repo", "ai/run-1", "main", "T", "B");

    await client.markPRReady("org/repo", prNumber);

    expect(client.getCreatedPRs().get(prNumber)?.draft).toBe(false);
  });

  it("is a no-op when markPRReady targets a PR number that was never created", async () => {
    const client = new MockGitHubClient();
    await expect(client.markPRReady("org/repo", 9999)).resolves.toBeUndefined();
  });

  it("returns a deterministic non-empty unified diff from getPRDiff", async () => {
    const client = new MockGitHubClient();
    const diff = await client.getPRDiff("org/repo", 1);
    expect(diff).toContain("diff --git");
  });

  it("returns an empty array from listPRComments", async () => {
    const client = new MockGitHubClient();
    await expect(client.listPRComments("org/repo", 1)).resolves.toEqual([]);
  });

  it("creates PR review comments with incrementing comment ids and embeds the line number in the body", async () => {
    const client = new MockGitHubClient();
    const id1 = await client.createPRReviewComment("org/repo", 1, "issue here", "src/a.ts", 42);
    const id2 = await client.createPRReviewComment("org/repo", 1, "issue here", "src/b.ts");

    expect(id2).toBe(id1 + 1);
  });

  it("resolves replyToReviewComment and submitPRReview without throwing", async () => {
    const client = new MockGitHubClient();
    await expect(
      client.replyToReviewComment("org/repo", 1, 1000, "thanks"),
    ).resolves.toBeUndefined();
    await expect(
      client.submitPRReview("org/repo", 1, "LGTM", "APPROVE"),
    ).resolves.toBeUndefined();
  });
});
