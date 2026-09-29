import { describe, it, expect } from "vitest";
import { OrchestratorService } from "../../src/orchestrator/orchestratorService.js";
import { RunState } from "../../src/domain/runState.js";
import {
  buildStorefulDeps,
  makeRun,
  makePlan,
  makePlanReview,
  makeRepoEntry,
  stubPlanner,
  stubPlanReviewer,
} from "./helpers/testKit.js";

describe("OrchestratorService.startRun", () => {
  it("returns the existing active run without creating a new one", async () => {
    const existing = makeRun({ id: "run-existing", state: RunState.Implementing });
    const h = buildStorefulDeps(existing);
    h.runRepo.findActiveByIssueId.mockResolvedValue(existing);
    const svc = new OrchestratorService(h.deps as never);

    const result = await svc.startRun("LIN-1");

    expect(result).toBe(existing);
    expect(h.gitService.setupRunWorktree).not.toHaveBeenCalled();
    expect(h.plannerAgent.run).not.toHaveBeenCalled();
  });

  it("creates a run, sets up a worktree, plans, and proceeds to plan review on the happy path", async () => {
    const todoRun = makeRun({ id: "run-1", state: RunState.Todo });
    const h = buildStorefulDeps(todoRun);
    h.runRepo.findActiveByIssueId.mockResolvedValue(null);
    h.runRepo.create.mockImplementation((data: Partial<typeof todoRun>) =>
      Promise.resolve({ ...todoRun, ...data }),
    );

    stubPlanner(h, makePlan({ openQuestions: [] }));
    stubPlanReviewer(h, makePlanReview({ overallVerdict: "approved" }));

    const svc = new OrchestratorService(h.deps as never);
    const result = await svc.startRun("LIN-1");

    expect(h.gitService.setupRunWorktree).toHaveBeenCalledWith(
      "/tmp/worktree",
      "run-1",
      "main",
      "ai/lin-1-test-issue",
    );
    expect(h.dashboardEmitter.emitRunCreated).toHaveBeenCalledWith("run-1", "LIN-1", "test-repo");
    expect(h.plannerAgent.run).toHaveBeenCalledTimes(1);
    expect(h.planReviewerAgent.run).toHaveBeenCalledTimes(1);
    expect(result.state).toBe(RunState.AwaitingPlanApproval);
  });

  it("pauses for clarification when the initial plan has blocking open questions", async () => {
    const todoRun = makeRun({ id: "run-1", state: RunState.Todo });
    const h = buildStorefulDeps(todoRun);
    h.runRepo.findActiveByIssueId.mockResolvedValue(null);
    h.runRepo.create.mockImplementation((data: Partial<typeof todoRun>) =>
      Promise.resolve({ ...todoRun, ...data }),
    );

    stubPlanner(
      h,
      makePlan({
        openQuestions: [{ id: "q1", question: "Blocking?", requiredForExecution: true }],
      }),
    );

    const svc = new OrchestratorService(h.deps as never);
    const result = await svc.startRun("LIN-1");

    expect(result.state).toBe(RunState.HumanClarificationNeeded);
    expect(h.planReviewerAgent.run).not.toHaveBeenCalled();
  });
});

describe("OrchestratorService.runPlanning", () => {
  it("retries planning with prior rejection/plan/answers/review context and proceeds to plan review", async () => {
    const run = makeRun({ id: "run-1", state: RunState.Planning, planVersion: 2 });
    const h = buildStorefulDeps(run);

    // Seed prior artifacts that should be forwarded into plannerAgent.run
    await h.artifactRepo.create({
      runId: "run-1",
      type: "RejectionContext",
      version: 2,
      payloadJson: { planVersion: 2, feedback: "fix X", source: "api", mode: "iterate" },
    });
    await h.artifactRepo.create({
      runId: "run-1",
      type: "Plan",
      version: 2,
      payloadJson: makePlan({ planVersion: 2 }),
    });
    await h.artifactRepo.create({
      runId: "run-1",
      type: "HumanAnswers",
      version: 1,
      payloadJson: { answers: [{ questionId: "q1", answer: "yes" }] },
    });
    await h.artifactRepo.create({
      runId: "run-1",
      type: "ResearchedAnswers",
      version: 1,
      payloadJson: {
        summary: "s",
        answers: [{ questionId: "q1", question: "Q", answer: "A", confidence: "high" }],
        completedAt: "2026-01-01T00:00:00Z",
      },
    });
    await h.artifactRepo.create({
      runId: "run-1",
      type: "PlanReview",
      version: 1,
      payloadJson: { summary: "needs work", findings: [] },
    });

    stubPlanner(h, makePlan({ planVersion: 3, openQuestions: [] }));
    stubPlanReviewer(h, makePlanReview({ overallVerdict: "approved" }));

    const svc = new OrchestratorService(h.deps as never);
    const result = await svc.runPlanning("run-1");

    expect(h.plannerAgent.run).toHaveBeenCalledWith(
      expect.anything(),
      "run-1",
      expect.objectContaining({
        planVersionOverride: 3,
        previousPlan: expect.objectContaining({ planVersion: 2 }),
        humanFeedback: { planVersion: 2, feedback: "fix X" },
        humanAnswers: [{ questionId: "q1", answer: "yes" }],
        researchedAnswers: [
          { questionId: "q1", question: "Q", answer: "A", confidence: "high" },
        ],
        planReviewFindings: { summary: "needs work", findings: [] },
      }),
    );
    expect(result.state).toBe(RunState.AwaitingPlanApproval);
  });

  it("pauses for clarification when the re-plan still has blocking questions", async () => {
    const run = makeRun({ id: "run-1", state: RunState.Planning, planVersion: 1 });
    const h = buildStorefulDeps(run);

    stubPlanner(
      h,
      makePlan({
        planVersion: 2,
        openQuestions: [{ id: "q1", question: "Still unclear?", requiredForExecution: true }],
      }),
    );

    const svc = new OrchestratorService(h.deps as never);
    const result = await svc.runPlanning("run-1");

    expect(result.state).toBe(RunState.HumanClarificationNeeded);
    expect(h.planReviewerAgent.run).not.toHaveBeenCalled();
  });

  it("throws when the run does not exist", async () => {
    const h = buildStorefulDeps(makeRun());
    h.runRepo.findById.mockResolvedValue(null);
    const svc = new OrchestratorService(h.deps as never);

    await expect(svc.runPlanning("missing-run")).rejects.toThrow(/Run not found/);
  });
});

describe("OrchestratorService.retryRun", () => {
  it("reuses the existing branch/worktree when the run already has a branchName", async () => {
    const run = makeRun({ id: "run-1", state: RunState.Todo, branchName: "ai/run-1" });
    const h = buildStorefulDeps(run);
    stubPlanner(h, makePlan({ openQuestions: [] }));
    stubPlanReviewer(h, makePlanReview({ overallVerdict: "approved" }));

    const svc = new OrchestratorService(h.deps as never);
    const result = await svc.retryRun("run-1");

    expect(h.gitService.setupRunWorktree).not.toHaveBeenCalled();
    expect(result.state).toBe(RunState.AwaitingPlanApproval);
  });

  it("sets up a fresh worktree when the run has no branchName yet", async () => {
    const run = makeRun({ id: "run-1", state: RunState.Todo, branchName: null });
    const h = buildStorefulDeps(run);
    h.repoRegistry.getRepoByName.mockReturnValue(makeRepoEntry());
    stubPlanner(h, makePlan({ openQuestions: [] }));
    stubPlanReviewer(h, makePlanReview({ overallVerdict: "approved" }));

    const svc = new OrchestratorService(h.deps as never);
    const result = await svc.retryRun("run-1");

    expect(h.gitService.setupRunWorktree).toHaveBeenCalledWith(
      "/tmp/main-repo",
      "run-1",
      "main",
      "ai/lin-1-test-issue",
    );
    expect(result.state).toBe(RunState.AwaitingPlanApproval);
  });

  it("falls back to the default repo when getRepoByName returns nothing", async () => {
    const run = makeRun({ id: "run-1", state: RunState.Todo, branchName: null });
    const h = buildStorefulDeps(run);
    h.repoRegistry.getRepoByName.mockReturnValue(undefined);
    h.repoRegistry.getDefaultRepo.mockReturnValue(makeRepoEntry({ name: "default-repo" }));
    stubPlanner(h, makePlan({ openQuestions: [] }));
    stubPlanReviewer(h, makePlanReview({ overallVerdict: "approved" }));

    const svc = new OrchestratorService(h.deps as never);
    await svc.retryRun("run-1");

    expect(h.repoRegistry.getDefaultRepo).toHaveBeenCalled();
  });

  it("pauses for clarification when the re-plan has blocking questions", async () => {
    const run = makeRun({ id: "run-1", state: RunState.Todo, branchName: "ai/run-1" });
    const h = buildStorefulDeps(run);
    stubPlanner(
      h,
      makePlan({ openQuestions: [{ id: "q1", question: "?", requiredForExecution: true }] }),
    );

    const svc = new OrchestratorService(h.deps as never);
    const result = await svc.retryRun("run-1");

    expect(result.state).toBe(RunState.HumanClarificationNeeded);
    expect(h.planReviewerAgent.run).not.toHaveBeenCalled();
  });
});
