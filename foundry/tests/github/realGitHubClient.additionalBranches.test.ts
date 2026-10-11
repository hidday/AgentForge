import { describe, it, expect, vi, beforeEach } from "vitest";

const mockReposGet = vi.fn();
const mockPullsCreate = vi.fn();
const mockPullsList = vi.fn();
const mockCreateReplyForReviewComment = vi.fn();
const mockCreateReview = vi.fn();

vi.mock("@octokit/rest", () => {
  return {
    Octokit: vi.fn().mockImplementation(() => ({
      repos: { get: mockReposGet },
      git: { getRef: vi.fn(), createRef: vi.fn() },
      pulls: {
        create: mockPullsCreate,
        list: mockPullsList,
        get: vi.fn(),
        createReviewComment: vi.fn(),
        createReplyForReviewComment: mockCreateReplyForReviewComment,
        createReview: mockCreateReview,
      },
      issues: { createComment: vi.fn(), listComments: vi.fn() },
      graphql: vi.fn(),
    })),
  };
});

import { RealGitHubClient } from "../../src/github/realGitHubClient.js";

function makeLogger() {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

describe("RealGitHubClient — non-Error throw branches (err instanceof Error ? ... : String(err))", () => {
  let logger: ReturnType<typeof makeLogger>;
  let client: RealGitHubClient;

  beforeEach(() => {
    vi.clearAllMocks();
    logger = makeLogger();
    client = new RealGitHubClient("fake-token", logger as never);
  });

  it("verifyRepoAccess: stringifies a non-Error rejection from repos.get", async () => {
    // eslint-disable-next-line prefer-promise-reject-errors
    mockReposGet.mockRejectedValue("network died");

    await expect(client.verifyRepoAccess("org/repo")).rejects.toThrow(
      /Original: network died/,
    );
  });

  it("wrapError (getDefaultBranch): stringifies a non-Error rejection", async () => {
    // eslint-disable-next-line prefer-promise-reject-errors
    mockReposGet.mockRejectedValue({ weird: "object" });

    await expect(client.getDefaultBranch("org/repo")).rejects.toThrow(
      /GitHub getDefaultBranch failed for "org\/repo".*\[object Object\]/,
    );
  });

  it("createDraftPR: treats a non-Error 422 rejection as non-field-validation and looks up the existing PR", async () => {
    // `message` only exists on Error instances; a non-Error rejection means
    // `isFieldValidation` is computed against an empty message, taking the
    // "look up existing PR" branch rather than the invalid-field branch.
    const nonErrorWithStatus = { status: 422 } as unknown;
    mockPullsCreate.mockRejectedValue(nonErrorWithStatus);
    mockPullsList.mockResolvedValue({ data: [] });

    await expect(
      client.createDraftPR("org/repo", "feature/x", "main", "Title", "Body"),
    ).rejects.toThrow(/GitHub createDraftPR failed/);
  });

  it("replyToReviewComment: logs String(err) for a non-Error rejection instead of throwing", async () => {
    // eslint-disable-next-line prefer-promise-reject-errors
    mockCreateReplyForReviewComment.mockRejectedValue(404);

    await expect(
      client.replyToReviewComment("org/repo", 7, 123, "thanks"),
    ).resolves.toBeUndefined();

    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ error: "404" }),
      "Failed to reply to PR review comment, skipping",
    );
  });

  it("submitPRReview: stringifies a non-Error rejection and does not match the own-PR fallback pattern", async () => {
    // eslint-disable-next-line prefer-promise-reject-errors
    mockCreateReview.mockRejectedValue(503);

    await expect(
      client.submitPRReview("org/repo", 7, "please fix", "REQUEST_CHANGES"),
    ).rejects.toThrow(/GitHub submitPRReview failed/);
    expect(mockCreateReview).toHaveBeenCalledTimes(1);
  });
});
