import { describe, it, expect, beforeEach } from "vitest";
import { MockGitHubClient, type PRComment } from "../../src/github/githubClient.js";

describe("MockGitHubClient", () => {
  let client: MockGitHubClient;

  beforeEach(() => {
    client = new MockGitHubClient();
  });

  it("resolves verifyRepoAccess without error", async () => {
    await expect(client.verifyRepoAccess("acme/repo")).resolves.toBeUndefined();
  });

  it("returns 'main' as the default branch", async () => {
    await expect(client.getDefaultBranch("acme/repo")).resolves.toBe("main");
  });

  it("records created branches and exposes them via getCreatedBranches", async () => {
    await client.createBranch("acme/repo", "ai/feature-1");
    await client.createBranch("acme/repo", "ai/feature-2");

    expect(client.getCreatedBranches()).toEqual(["ai/feature-1", "ai/feature-2"]);
  });

  it("creates draft PRs with incrementing numbers starting at 100", async () => {
    const first = await client.createDraftPR(
      "acme/repo",
      "ai/feature-1",
      "main",
      "Title 1",
      "Body 1",
    );
    const second = await client.createDraftPR(
      "acme/repo",
      "ai/feature-2",
      "main",
      "Title 2",
      "Body 2",
    );

    expect(first).toBe(100);
    expect(second).toBe(101);
  });

  it("exposes created PRs via getCreatedPRs with draft true", async () => {
    const prNumber = await client.createDraftPR(
      "acme/repo",
      "ai/feature-1",
      "main",
      "My Title",
      "My Body",
    );

    const prs = client.getCreatedPRs();
    expect(prs.get(prNumber)).toEqual({
      repo: "acme/repo",
      head: "ai/feature-1",
      title: "My Title",
      draft: true,
    });
  });

  it("marks a known PR as not draft when markPRReady is called", async () => {
    const prNumber = await client.createDraftPR("acme/repo", "ai/feature-1", "main", "T", "B");

    await client.markPRReady("acme/repo", prNumber);

    const prs = client.getCreatedPRs();
    expect(prs.get(prNumber)?.draft).toBe(false);
  });

  it("markPRReady is a no-op for an unknown PR number", async () => {
    await expect(client.markPRReady("acme/repo", 99999)).resolves.toBeUndefined();
    expect(client.getCreatedPRs().size).toBe(0);
  });

  it("commentOnPR resolves and records the comment internally", async () => {
    await expect(client.commentOnPR("acme/repo", 100, "hello")).resolves.toBeUndefined();
    const comments = (client as unknown as { prComments: { prNumber: number; body: string }[] })
      .prComments;
    expect(comments).toEqual([{ prNumber: 100, body: "hello" }]);
  });

  it("getPRDiff returns a fixed sample diff mentioning the added handler", async () => {
    const diff = await client.getPRDiff("acme/repo", 100);
    expect(diff).toContain("diff --git a/src/handler.ts b/src/handler.ts");
    expect(diff).toContain("+export async function handleRequest(req: Request)");
  });

  it("listPRComments resolves to an empty array", async () => {
    const comments: PRComment[] = await client.listPRComments("acme/repo", 100);
    expect(comments).toEqual([]);
  });

  it("createPRReviewComment returns incrementing ids starting at 1000", async () => {
    const first = await client.createPRReviewComment("acme/repo", 100, "nit", "src/a.ts", 5);
    const second = await client.createPRReviewComment("acme/repo", 100, "nit2", "src/b.ts", 6);

    expect(first).toBe(1000);
    expect(second).toBe(1001);
  });

  it("createPRReviewComment formats the stored body with path and line when line is provided", async () => {
    await client.createPRReviewComment("acme/repo", 100, "fix this", "src/a.ts", 42);

    const comments = (client as unknown as { prComments: { prNumber: number; body: string }[] })
      .prComments;
    expect(comments).toEqual([{ prNumber: 100, body: "[src/a.ts:42] fix this" }]);
  });

  it("createPRReviewComment formats the stored body with just the path when line is omitted", async () => {
    await client.createPRReviewComment("acme/repo", 100, "fix this", "src/a.ts");

    const comments = (client as unknown as { prComments: { prNumber: number; body: string }[] })
      .prComments;
    expect(comments).toEqual([{ prNumber: 100, body: "[src/a.ts] fix this" }]);
  });

  it("replyToReviewComment resolves and records the reply body", async () => {
    await expect(
      client.replyToReviewComment("acme/repo", 100, 1000, "thanks for the catch"),
    ).resolves.toBeUndefined();

    const comments = (client as unknown as { prComments: { prNumber: number; body: string }[] })
      .prComments;
    expect(comments).toEqual([{ prNumber: 100, body: "thanks for the catch" }]);
  });

  it("submitPRReview resolves and records the review body", async () => {
    await expect(
      client.submitPRReview("acme/repo", 100, "LGTM", "APPROVE"),
    ).resolves.toBeUndefined();

    const comments = (client as unknown as { prComments: { prNumber: number; body: string }[] })
      .prComments;
    expect(comments).toEqual([{ prNumber: 100, body: "LGTM" }]);
  });
});
