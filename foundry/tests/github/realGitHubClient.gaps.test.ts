import { describe, it, expect, vi, beforeEach } from "vitest";
import { RealGitHubClient } from "../../src/github/realGitHubClient.js";

// Covers the "non-Error rejection" ternary branch (`err instanceof Error ?
// err.message : String(err)`) in wrapError() and in the catch blocks of
// replyToReviewComment() and submitPRReview(), none of which are exercised by
// realGitHubClient.test.ts (every rejection there is a real Error instance,
// except the inline ternary in verifyRepoAccess(), which has its own test).

function makeLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
}

function makeFakeOctokit() {
  return {
    repos: { get: vi.fn() },
    git: { getRef: vi.fn(), createRef: vi.fn() },
    pulls: {
      create: vi.fn(),
      list: vi.fn(),
      get: vi.fn(),
      createReviewComment: vi.fn(),
      createReplyForReviewComment: vi.fn(),
      createReview: vi.fn(),
    },
    issues: { createComment: vi.fn(), listComments: vi.fn() },
    graphql: vi.fn(),
  };
}

type FakeOctokit = ReturnType<typeof makeFakeOctokit>;

function injectOctokit(client: RealGitHubClient, octokit: FakeOctokit): void {
  (client as unknown as { octokit: FakeOctokit }).octokit = octokit;
}

describe("RealGitHubClient — non-Error rejection branches", () => {
  let octokit: FakeOctokit;
  let logger: ReturnType<typeof makeLogger>;
  let client: RealGitHubClient;

  beforeEach(() => {
    octokit = makeFakeOctokit();
    logger = makeLogger();
    client = new RealGitHubClient("test-token", logger as never);
    injectOctokit(client, octokit);
  });

  it("wrapError() stringifies a non-Error rejection (getDefaultBranch)", async () => {
    octokit.repos.get.mockRejectedValue("plain string failure");

    await expect(client.getDefaultBranch("acme/backend-api")).rejects.toThrow(
      /GitHub getDefaultBranch failed for "acme\/backend-api": plain string failure/,
    );
  });

  it("createDraftPR() handles a non-Error 422 rejection and still finds the existing PR", async () => {
    // A non-Error value with a custom toString(), so `String(err)` (not
    // `err.message`) is what drives the isFieldValidation / existing-PR branching.
    const err = { status: 422, toString: () => "A pull request already exists" };
    octokit.pulls.create.mockRejectedValue(err);
    octokit.pulls.list.mockResolvedValue({ data: [{ number: 777 }] });

    const prNumber = await client.createDraftPR(
      "acme/backend-api",
      "ai/issue-1",
      "main",
      "title",
      "body",
    );

    expect(prNumber).toBe(777);
  });

  it("replyToReviewComment() logs a stringified non-Error rejection and does not throw", async () => {
    octokit.pulls.createReplyForReviewComment.mockRejectedValue("comment API down");

    await expect(
      client.replyToReviewComment("acme/backend-api", 100, 5, "thanks"),
    ).resolves.toBeUndefined();

    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ repo: "acme/backend-api", prNumber: 100, commentId: 5, error: "comment API down" }),
      "Failed to reply to PR review comment, skipping",
    );
  });

  it("submitPRReview() wraps a non-Error rejection that doesn't match the 'own PR' fallback pattern", async () => {
    octokit.pulls.createReview.mockRejectedValue("rate limited by GitHub");

    await expect(
      client.submitPRReview("acme/backend-api", 100, "nice work", "REQUEST_CHANGES"),
    ).rejects.toThrow(/GitHub submitPRReview failed.*rate limited by GitHub/s);
    // Only the one call was made -- no fallback-to-COMMENT retry.
    expect(octokit.pulls.createReview).toHaveBeenCalledTimes(1);
  });
});
