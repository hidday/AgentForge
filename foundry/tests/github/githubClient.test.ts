import { describe, it, expect } from "vitest";
import { MockGitHubClient } from "../../src/github/githubClient.js";

describe("MockGitHubClient.verifyRepoAccess / getDefaultBranch", () => {
  it("resolves without error for any repo", async () => {
    const client = new MockGitHubClient();
    await expect(client.verifyRepoAccess("org/repo")).resolves.toBeUndefined();
  });

  it("always returns 'main' as the default branch", async () => {
    const client = new MockGitHubClient();
    await expect(client.getDefaultBranch("org/repo")).resolves.toBe("main");
  });
});

describe("MockGitHubClient.createBranch", () => {
  it("records created branches", async () => {
    const client = new MockGitHubClient();

    await client.createBranch("org/repo", "ai/feature-1");
    await client.createBranch("org/repo", "ai/feature-2");

    expect(client.getCreatedBranches()).toEqual(["ai/feature-1", "ai/feature-2"]);
  });

  it("returns a copy so mutating the result does not affect internal state", async () => {
    const client = new MockGitHubClient();
    await client.createBranch("org/repo", "ai/feature-1");

    const branches = client.getCreatedBranches();
    branches.push("injected");

    expect(client.getCreatedBranches()).toEqual(["ai/feature-1"]);
  });
});

describe("MockGitHubClient.createDraftPR / markPRReady / getCreatedPRs", () => {
  it("creates PRs with incrementing numbers starting at 100", async () => {
    const client = new MockGitHubClient();

    const pr1 = await client.createDraftPR("org/repo", "head-1", "main", "Title 1", "Body 1");
    const pr2 = await client.createDraftPR("org/repo", "head-2", "main", "Title 2", "Body 2");

    expect(pr1).toBe(100);
    expect(pr2).toBe(101);
  });

  it("tracks created PRs as drafts until marked ready", async () => {
    const client = new MockGitHubClient();
    const prNumber = await client.createDraftPR("org/repo", "head-1", "main", "Title", "Body");

    expect(client.getCreatedPRs().get(prNumber)).toEqual({
      repo: "org/repo",
      head: "head-1",
      title: "Title",
      draft: true,
    });

    await client.markPRReady("org/repo", prNumber);

    expect(client.getCreatedPRs().get(prNumber)?.draft).toBe(false);
  });

  it("does nothing when marking a non-existent PR as ready", async () => {
    const client = new MockGitHubClient();
    await expect(client.markPRReady("org/repo", 999)).resolves.toBeUndefined();
  });
});

describe("MockGitHubClient.commentOnPR / listPRComments", () => {
  it("always returns an empty array from listPRComments (mock does not store readable comments)", async () => {
    const client = new MockGitHubClient();
    await client.commentOnPR("org/repo", 100, "A comment");

    await expect(client.listPRComments("org/repo", 100)).resolves.toEqual([]);
  });
});

describe("MockGitHubClient.getPRDiff", () => {
  it("returns a fixed sample unified diff", async () => {
    const client = new MockGitHubClient();
    const diff = await client.getPRDiff("org/repo", 100);

    expect(diff).toContain("diff --git a/src/handler.ts b/src/handler.ts");
    expect(diff).toContain("export async function handleRequest");
  });
});

describe("MockGitHubClient.createPRReviewComment", () => {
  it("returns an incrementing comment id starting at 1000", async () => {
    const client = new MockGitHubClient();

    const id1 = await client.createPRReviewComment("org/repo", 100, "Looks good", "src/a.ts", 10);
    const id2 = await client.createPRReviewComment("org/repo", 100, "Nit", "src/b.ts", 20);

    expect(id1).toBe(1000);
    expect(id2).toBe(1001);
  });

  it("formats the comment with path and line when line is provided", async () => {
    const client = new MockGitHubClient();
    await client.createPRReviewComment("org/repo", 100, "Looks good", "src/a.ts", 10);

    // No direct getter for review comments, but listPRComments on the mock
    // always returns [] by design; verify no throw and a stable id contract instead.
    const id = await client.createPRReviewComment("org/repo", 100, "Another", "src/a.ts", 15);
    expect(id).toBe(1001);
  });

  it("formats the comment with just the path when line is omitted", async () => {
    const client = new MockGitHubClient();
    const id = await client.createPRReviewComment("org/repo", 100, "File-level comment", "src/a.ts");

    expect(id).toBe(1000);
  });
});

describe("MockGitHubClient.replyToReviewComment", () => {
  it("resolves without error", async () => {
    const client = new MockGitHubClient();
    await expect(
      client.replyToReviewComment("org/repo", 100, 1000, "Thanks, fixed."),
    ).resolves.toBeUndefined();
  });
});

describe("MockGitHubClient.submitPRReview", () => {
  it("resolves without error for each review event type", async () => {
    const client = new MockGitHubClient();
    await expect(client.submitPRReview("org/repo", 100, "LGTM", "APPROVE")).resolves.toBeUndefined();
    await expect(
      client.submitPRReview("org/repo", 100, "Needs work", "REQUEST_CHANGES"),
    ).resolves.toBeUndefined();
    await expect(
      client.submitPRReview("org/repo", 100, "Just a note", "COMMENT"),
    ).resolves.toBeUndefined();
  });
});
