import { describe, it, expect, beforeEach } from "vitest";
import { MockGitHubClient } from "../../src/github/githubClient.js";

describe("MockGitHubClient", () => {
  let client: MockGitHubClient;

  beforeEach(() => {
    client = new MockGitHubClient();
  });

  it("resolves verifyRepoAccess without throwing regardless of repo value", async () => {
    await expect(client.verifyRepoAccess("org/repo")).resolves.toBeUndefined();
  });

  it("always returns 'main' for getDefaultBranch", async () => {
    await expect(client.getDefaultBranch("org/repo")).resolves.toBe("main");
  });

  describe("createBranch / getCreatedBranches", () => {
    it("starts with no created branches", () => {
      expect(client.getCreatedBranches()).toEqual([]);
    });

    it("records each created branch name in order", async () => {
      await client.createBranch("org/repo", "feature/one");
      await client.createBranch("org/repo", "feature/two");

      expect(client.getCreatedBranches()).toEqual(["feature/one", "feature/two"]);
    });

    it("returns a defensive copy that mutation does not affect internal state", async () => {
      await client.createBranch("org/repo", "feature/one");
      const branches = client.getCreatedBranches();
      branches.push("not-real");

      expect(client.getCreatedBranches()).toEqual(["feature/one"]);
    });
  });

  describe("createDraftPR / getCreatedPRs", () => {
    it("starts with no created PRs", () => {
      expect(client.getCreatedPRs().size).toBe(0);
    });

    it("assigns incrementing PR numbers starting at 100", async () => {
      const first = await client.createDraftPR("org/repo", "head1", "main", "Title 1", "Body 1");
      const second = await client.createDraftPR("org/repo", "head2", "main", "Title 2", "Body 2");

      expect(first).toBe(100);
      expect(second).toBe(101);
    });

    it("stores PR metadata as draft=true, keyed by PR number", async () => {
      const prNumber = await client.createDraftPR("org/repo", "feature", "main", "My PR", "desc");

      const prs = client.getCreatedPRs();
      expect(prs.get(prNumber)).toEqual({
        repo: "org/repo",
        head: "feature",
        title: "My PR",
        draft: true,
      });
    });
  });

  it("commentOnPR resolves without throwing", async () => {
    await expect(client.commentOnPR("org/repo", 1, "a comment")).resolves.toBeUndefined();
  });

  it("getPRDiff returns a non-empty unified diff string", async () => {
    const diff = await client.getPRDiff("org/repo", 1);
    expect(diff).toContain("diff --git");
    expect(diff).toContain("+++ b/src/handler.ts");
  });

  describe("markPRReady", () => {
    it("flips draft to false for an existing PR", async () => {
      const prNumber = await client.createDraftPR("org/repo", "head", "main", "T", "B");
      expect(client.getCreatedPRs().get(prNumber)?.draft).toBe(true);

      await client.markPRReady("org/repo", prNumber);

      expect(client.getCreatedPRs().get(prNumber)?.draft).toBe(false);
    });

    it("is a no-op for a PR number that was never created", async () => {
      await expect(client.markPRReady("org/repo", 9999)).resolves.toBeUndefined();
      expect(client.getCreatedPRs().size).toBe(0);
    });
  });

  it("listPRComments always resolves to an empty array", async () => {
    await expect(client.listPRComments("org/repo", 1)).resolves.toEqual([]);
  });

  describe("createPRReviewComment", () => {
    it("assigns incrementing comment ids starting at 1000", async () => {
      const first = await client.createPRReviewComment("org/repo", 1, "body", "src/a.ts", 10);
      const second = await client.createPRReviewComment("org/repo", 1, "body", "src/b.ts");

      expect(first).toBe(1000);
      expect(second).toBe(1001);
    });

    it("resolves with a numeric id whether or not a line is given", async () => {
      const withLine = await client.createPRReviewComment("org/repo", 1, "body", "src/a.ts", 42);
      const withoutLine = await client.createPRReviewComment("org/repo", 1, "body", "src/b.ts");

      expect(typeof withLine).toBe("number");
      expect(typeof withoutLine).toBe("number");
    });
  });

  it("replyToReviewComment resolves without throwing", async () => {
    await expect(
      client.replyToReviewComment("org/repo", 1, 1000, "a reply"),
    ).resolves.toBeUndefined();
  });

  it("submitPRReview resolves without throwing for every event type", async () => {
    await expect(client.submitPRReview("org/repo", 1, "lgtm", "APPROVE")).resolves.toBeUndefined();
    await expect(
      client.submitPRReview("org/repo", 1, "please fix", "REQUEST_CHANGES"),
    ).resolves.toBeUndefined();
    await expect(
      client.submitPRReview("org/repo", 1, "note", "COMMENT"),
    ).resolves.toBeUndefined();
  });
});
