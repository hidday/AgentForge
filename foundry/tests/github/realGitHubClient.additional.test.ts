import { describe, it, expect, vi, beforeEach } from "vitest";
import { RealGitHubClient } from "../../src/github/realGitHubClient.js";

const octokitMock = {
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

vi.mock("@octokit/rest", () => ({
  Octokit: vi.fn(() => octokitMock),
}));

function makeLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
}

describe("RealGitHubClient - non-Error rejection branches", () => {
  let client: RealGitHubClient;
  let logger: ReturnType<typeof makeLogger>;

  beforeEach(() => {
    vi.clearAllMocks();
    logger = makeLogger();
    client = new RealGitHubClient("test-token", logger as never);
  });

  it("verifyRepoAccess stringifies a non-Error rejection in the wrapped message", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    octokitMock.repos.get.mockRejectedValue({ weird: "not an Error instance" } as any);

    await expect(client.verifyRepoAccess("org/repo")).rejects.toThrow(
      /Original: \[object Object\]/,
    );
  });

  it("wrapError (via getDefaultBranch) stringifies a non-Error rejection", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    octokitMock.repos.get.mockRejectedValue("plain string failure" as any);

    await expect(client.getDefaultBranch("org/repo")).rejects.toThrow(
      'GitHub getDefaultBranch failed for "org/repo": plain string failure',
    );
  });

  it("createDraftPR treats a non-Error 422-shaped rejection as non-field-validation and looks up the existing PR", async () => {
    // A plain object with status 422 but no `message`, so
    // `err instanceof Error` is false and String(err) is used instead --
    // this can never match the '"code":"invalid"' field-validation check,
    // so it falls through to the "look up existing PR" branch.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    octokitMock.pulls.create.mockRejectedValue({ status: 422 } as any);
    octokitMock.pulls.list.mockResolvedValue({ data: [{ number: 909 }] });

    const prNumber = await client.createDraftPR("org/repo", "head", "main", "Title", "Body");

    expect(prNumber).toBe(909);
  });

  it("replyToReviewComment logs a stringified non-Error rejection instead of throwing", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    octokitMock.pulls.createReplyForReviewComment.mockRejectedValue("comment gone" as any);

    await expect(
      client.replyToReviewComment("org/repo", 10, 555, "reply body"),
    ).resolves.toBeUndefined();

    expect(logger.warn).toHaveBeenCalledWith(
      { repo: "org/repo", prNumber: 10, commentId: 555, error: "comment gone" },
      "Failed to reply to PR review comment, skipping",
    );
  });

  it("submitPRReview wraps a non-Error rejection using String(err) for the message check", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    octokitMock.pulls.createReview.mockRejectedValue({ notAnError: true } as any);

    await expect(
      client.submitPRReview("org/repo", 10, "body", "REQUEST_CHANGES"),
    ).rejects.toThrow(/GitHub submitPRReview failed for "org\/repo"/);
    expect(octokitMock.pulls.createReview).toHaveBeenCalledTimes(1);
  });
});
