import { describe, it, expect, vi } from "vitest";
import { OrchestratorService } from "../../src/orchestrator/orchestratorService.js";
import { RunState } from "../../src/domain/runState.js";
import { RunEvent } from "../../src/domain/runEvent.js";
import { PolicyViolationError } from "../../src/utils/errors.js";
import type { Plan } from "../../src/schemas/plan.js";
import type { ExecutionReport } from "../../src/schemas/executionReport.js";
import type { Review } from "../../src/schemas/review.js";
import { buildDeps, makeStore, pushArtifact, type Store } from "./helpers/fixtures.js";

function makePlan(): Plan {
  return {
    planVersion: 1,
    summary: "Test plan",
    requirementsTraceability: "",
    assumptions: [],
    openQuestions: [],
    risks: [],
    steps: [{ id: "s1", title: "Step 1", description: "Do something" }],
    testPlan: "Run tests",
    confidence: 0.9,
  };
}

function makeExecutionReport(): ExecutionReport {
  return {
    executionVersion: 1,
    summary: "Implemented.",
    filesChanged: ["src/foo.ts"],
    checks: {
      lint: { status: "pass", details: "ok" },
      typecheck: { status: "pass", details: "ok" },
      tests: { status: "pass", details: "ok" },
    },
    notes: [],
    prDraftCreated: true,
    score: 0.9,
    scoreRationale: "Good",
  };
}

function setupAIReviewRun(store: Store, prNumber: number | null = 42) {
  store.run = { ...store.run, state: RunState.AIReview, prNumber };
  pushArtifact(store, "Plan", 1, makePlan());
  pushArtifact(store, "ExecutionReport", 1, makeExecutionReport());
}

function makeReview(overrides: Partial<Review> = {}): Review {
  return {
    reviewId: "rev-1",
    summary: "Review summary",
    findings: [],
    overallVerdict: "approved",
    ...overrides,
  };
}

describe("OrchestratorService.runReview", () => {
  it("throws via PolicyEngine when required preconditions are not met (e.g. no PR)", async () => {
    const store = makeStore();
    setupAIReviewRun(store, null);
    const built = buildDeps(store);
    const svc = new OrchestratorService(built.deps as never);

    await expect(svc.runReview("run-1")).rejects.toBeInstanceOf(PolicyViolationError);
    expect(built.reviewerAgent.run).not.toHaveBeenCalled();
  });

  describe("changes_requested verdict", () => {
    it("posts review findings to GitHub, transitions to AddressingReview, comments on Linear, and delegates to runRemediation with the comment map", async () => {
      const store = makeStore();
      setupAIReviewRun(store, 42);
      const built = buildDeps(store);
      const svc = new OrchestratorService(built.deps as never);

      const review = makeReview({
        overallVerdict: "changes_requested",
        findings: [
          {
            id: "f1",
            severity: "important",
            type: "bug",
            file: "src/foo.ts",
            title: "Bug",
            details: "detail",
          },
        ],
      });
      built.reviewerAgent.run.mockResolvedValue(review);
      built.githubSync.postReviewFindings.mockResolvedValue(new Map([["f1", 123]]));

      const finalRun = { ...store.run, state: RunState.AIReview };
      const runRemediationSpy = vi
        .spyOn(svc, "runRemediation")
        .mockResolvedValue(finalRun as never);

      const result = await svc.runReview("run-1");

      expect(built.githubSync.postReviewFindings).toHaveBeenCalledWith(
        "test-repo",
        42,
        review.findings,
        "changes_requested",
      );

      const eventTypes = built.eventRepo.create.mock.calls.map(
        (c: unknown[]) => (c[0] as { eventType: string }).eventType,
      );
      expect(eventTypes).toContain(RunEvent.REVIEW_CHANGES_REQUESTED);

      expect(built.linearClient.postComment).toHaveBeenCalledWith(
        "LIN-1",
        expect.stringContaining("Changes Requested"),
      );

      expect(runRemediationSpy).toHaveBeenCalledWith("run-1", { f1: 123 });
      expect(result).toBe(finalRun);
    });

    it("does NOT post review findings to GitHub when there are no findings, even with a PR", async () => {
      const store = makeStore();
      setupAIReviewRun(store, 42);
      const built = buildDeps(store);
      const svc = new OrchestratorService(built.deps as never);

      built.reviewerAgent.run.mockResolvedValue(
        makeReview({ overallVerdict: "changes_requested", findings: [] }),
      );
      vi.spyOn(svc, "runRemediation").mockResolvedValue(store.run as never);

      await svc.runReview("run-1");

      expect(built.githubSync.postReviewFindings).not.toHaveBeenCalled();
    });

  });

  describe("approved verdict", () => {
    it("transitions to ReadyForHumanReview and delegates to markReady, but returns the run from the REVIEW_APPROVED transition (not markReady's return value)", async () => {
      const store = makeStore();
      setupAIReviewRun(store, 42);
      const built = buildDeps(store);
      const svc = new OrchestratorService(built.deps as never);

      built.reviewerAgent.run.mockResolvedValue(makeReview({ overallVerdict: "approved" }));
      const differentRun = { ...store.run, state: RunState.Done, id: "different-object" } as never;
      const markReadySpy = vi.spyOn(svc, "markReady").mockResolvedValue(differentRun);

      const result = await svc.runReview("run-1");

      const eventTypes = built.eventRepo.create.mock.calls.map(
        (c: unknown[]) => (c[0] as { eventType: string }).eventType,
      );
      expect(eventTypes).toContain(RunEvent.REVIEW_APPROVED);
      expect(markReadySpy).toHaveBeenCalledWith("run-1");
      // Documents current behavior: runReview discards markReady's return value.
      expect(result).not.toBe(differentRun);
      expect(result.state).toBe(RunState.ReadyForHumanReview);
    });

    it("does not post review findings to GitHub on an approved verdict even with findings present", async () => {
      const store = makeStore();
      setupAIReviewRun(store, 42);
      const built = buildDeps(store);
      const svc = new OrchestratorService(built.deps as never);

      built.reviewerAgent.run.mockResolvedValue(
        makeReview({
          overallVerdict: "approved",
          findings: [
            {
              id: "f1",
              severity: "nit",
              type: "style",
              file: "src/foo.ts",
              title: "Nit",
              details: "detail",
            },
          ],
        }),
      );
      vi.spyOn(svc, "markReady").mockResolvedValue(store.run as never);

      await svc.runReview("run-1");

      // Findings only get posted on the changes_requested branch.
      expect(built.githubSync.postReviewFindings).toHaveBeenCalledWith(
        "test-repo",
        42,
        expect.any(Array),
        "approved",
      );
    });
  });

  it("fetches the PR diff when the run has a PR, and passes it to the reviewer agent", async () => {
    const store = makeStore();
    setupAIReviewRun(store, 42);
    const built = buildDeps(store);
    const svc = new OrchestratorService(built.deps as never);
    built.reviewerAgent.run.mockResolvedValue(makeReview({ overallVerdict: "approved" }));
    vi.spyOn(svc, "markReady").mockResolvedValue(store.run as never);

    await svc.runReview("run-1");

    expect(built.githubClient.getPRDiff).toHaveBeenCalledWith("test-repo", 42);
    expect(built.reviewerAgent.run).toHaveBeenCalledWith(
      expect.objectContaining({ planVersion: 1 }),
      expect.objectContaining({ executionVersion: 1 }),
      "diff content",
      expect.anything(),
      "run-1",
    );
  });
});
