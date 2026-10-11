import { describe, it, expect, vi } from "vitest";
import { GitHubSyncService } from "../../src/sync/githubSync.js";
import type { ResolutionItem } from "../../src/schemas/remediation.js";

function makeLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
}

function makeGithubClient() {
  return {
    verifyRepoAccess: vi.fn(),
    getDefaultBranch: vi.fn(),
    createBranch: vi.fn(),
    createDraftPR: vi.fn(),
    commentOnPR: vi.fn().mockResolvedValue(undefined),
    getPRDiff: vi.fn(),
    markPRReady: vi.fn().mockResolvedValue(undefined),
    listPRComments: vi.fn(),
    createPRReviewComment: vi.fn(),
    replyToReviewComment: vi.fn().mockResolvedValue(undefined),
    submitPRReview: vi.fn().mockResolvedValue(undefined),
  };
}

function makeResolution(overrides: Partial<ResolutionItem> = {}): ResolutionItem {
  return {
    findingId: "f1",
    status: "accepted",
    action: "Added a null check",
    rationale: "Prevents crash",
    ...overrides,
  };
}

describe("GitHubSyncService.postRemediationResolutions — unmapped status icon fallback", () => {
  it("uses the grey-question icon in the inline reply when the status is not in the known icon map", async () => {
    const githubClient = makeGithubClient();
    const svc = new GitHubSyncService(githubClient as never, makeLogger() as never);

    await svc.postRemediationResolutions(
      "test-repo",
      42,
      [makeResolution({ findingId: "f1", status: "escalated" as never })],
      { f1: 101 },
    );

    expect(githubClient.replyToReviewComment).toHaveBeenCalledWith(
      "test-repo",
      42,
      101,
      expect.stringContaining(":grey_question: **escalated**"),
    );
  });

  it("uses the grey-question icon in the summary table row when the status is not in the known icon map", async () => {
    const githubClient = makeGithubClient();
    const svc = new GitHubSyncService(githubClient as never, makeLogger() as never);

    await svc.postRemediationResolutions(
      "test-repo",
      42,
      [makeResolution({ findingId: "unmapped", status: "escalated" as never })],
      {},
    );

    const body = githubClient.commentOnPR.mock.calls[0][2] as string;
    expect(body).toContain(":grey_question: **unmapped**");
  });
});
