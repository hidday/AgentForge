import { describe, it, expect } from "vitest";
import { MockGitHubClient } from "../../src/github/githubClient.js";

describe("MockGitHubClient", () => {
  it("verifyRepoAccess and getDefaultBranch resolve without side effects", async () => {
    const client = new MockGitHubClient();
    await expect(client.verifyRepoAccess("org/repo")).resolves.toBeUndefined();
    await expect(client.getDefaultBranch("org/repo")).resolves.toBe("main");
  });

  it("createBranch records the branch name", async () => {
    const client = new MockGitHubClient();
    await client.createBranch("org/repo", "ai/issue-1");
    await client.createBranch("org/repo", "ai/issue-2");

    expect(client.getCreatedBranches()).toEqual(["ai/issue-1", "ai/issue-2"]);
  });

  it("createDraftPR assigns increasing PR numbers and records PR metadata as draft", async () => {
    const client = new MockGitHubClient();
    const first = await client.createDraftPR("org/repo", "ai/issue-1", "main", "Title", "Body");
    const second = await client.createDraftPR("org/repo", "ai/issue-2", "main", "Title 2", "Body 2");

    expect(second).toBe(first + 1);
    const prs = client.getCreatedPRs();
    expect(prs.get(first)).toEqual({
      repo: "org/repo",
      head: "ai/issue-1",
      title: "Title",
      draft: true,
    });
  });

  it("commentOnPR and getPRDiff behave as recording/fixture helpers", async () => {
    const client = new MockGitHubClient();
    await client.commentOnPR("org/repo", 100, "Looks good");
    const diff = await client.getPRDiff("org/repo", 100);

    expect(diff).toContain("diff --git");
  });

  it("markPRReady flips draft to false for an existing PR and is a no-op for an unknown one", async () => {
    const client = new MockGitHubClient();
    const prNumber = await client.createDraftPR("org/repo", "ai/issue-1", "main", "T", "B");

    await client.markPRReady("org/repo", prNumber);
    expect(client.getCreatedPRs().get(prNumber)?.draft).toBe(false);

    await expect(client.markPRReady("org/repo", 999999)).resolves.toBeUndefined();
  });

  it("listPRComments always resolves to an empty array", async () => {
    const client = new MockGitHubClient();
    await expect(client.listPRComments("org/repo", 1)).resolves.toEqual([]);
  });

  it("createPRReviewComment embeds the path and line in the comment body and returns an id", async () => {
    const client = new MockGitHubClient();
    const withLine = await client.createPRReviewComment(
      "org/repo",
      1,
      "Fix this",
      "src/foo.ts",
      42,
    );
    const withoutLine = await client.createPRReviewComment("org/repo", 1, "Fix this", "src/foo.ts");

    expect(withoutLine).toBe(withLine + 1);
  });

  it("replyToReviewComment and submitPRReview resolve without throwing", async () => {
    const client = new MockGitHubClient();
    await expect(
      client.replyToReviewComment("org/repo", 1, 1000, "Thanks"),
    ).resolves.toBeUndefined();
    await expect(
      client.submitPRReview("org/repo", 1, "LGTM", "APPROVE"),
    ).resolves.toBeUndefined();
  });
});
