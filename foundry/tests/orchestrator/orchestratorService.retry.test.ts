import { describe, it, expect, vi } from "vitest";
import { OrchestratorService } from "../../src/orchestrator/orchestratorService.js";
import { RunState } from "../../src/domain/runState.js";
import { buildDeps, makeRun, makeArtifact, makePlan } from "./_fixtures.js";

describe("OrchestratorService.retryRun", () => {
  it("sets up a new worktree when the run has no branchName yet", async () => {
    const { deps, runRepo, gitService, plannerAgent, artifactRepo } = buildDeps({
      answerResearcherAgent: undefined,
    });
    const svc = new OrchestratorService(deps as never);

    const run = makeRun({ state: RunState.Todo, branchName: null, workingDirectory: "/repo" });
    runRepo.findById
      .mockResolvedValueOnce(run)
      .mockResolvedValue(makeRun({ state: RunState.PlanReview }));
    (deps.linearClient.getIssue as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "LIN-1", title: "Test", description: "Test", branchName: "ai/lin-1", labels: [], priority: 0,
    });
    (deps.repoRegistry.getRepoByName as ReturnType<typeof vi.fn>).mockReturnValue({
      name: "test-repo", defaultBranch: "main", allowedPaths: ["src/"], protectedPaths: [],
      constraints: { requiredChecks: [], maxFilesChanged: 10, maxDiffLines: 500, forbiddenPatterns: [], mustNotTouch: [] },
    });
    runRepo.update
      .mockResolvedValueOnce(makeRun({ workingDirectory: "/repo/.worktrees/run-1", branchName: "ai/run-1" }))
      .mockResolvedValue(makeRun({ state: RunState.Planning, planVersion: 1 }));
    runRepo.updateState
      .mockResolvedValueOnce(makeRun({ state: RunState.Planning }))
      .mockResolvedValueOnce(makeRun({ state: RunState.PlanReview }))
      .mockResolvedValueOnce(makeRun({ state: RunState.AwaitingPlanApproval }));

    artifactRepo.findLatestByType.mockImplementation((_: string, type: string) =>
      type === "Plan" ? Promise.resolve(makeArtifact({ type: "Plan", payloadJson: makePlan() })) : Promise.resolve(null),
    );
    plannerAgent.run.mockResolvedValue(makePlan({ openQuestions: [] }));
    (deps.planReviewerAgent as { run: ReturnType<typeof vi.fn> }).run.mockResolvedValue({
      overallVerdict: "approved", summary: "OK", findings: [],
    });

    const result = await svc.retryRun("run-1");

    expect(gitService.setupRunWorktree).toHaveBeenCalledWith(
      "/repo",
      "run-1",
      "main",
      "ai/lin-1",
    );
    expect(result.state).toBe(RunState.AwaitingPlanApproval);
  });

  it("skips worktree setup when the run already has a branchName", async () => {
    const { deps, runRepo, gitService, plannerAgent, artifactRepo } = buildDeps({
      answerResearcherAgent: undefined,
    });
    const svc = new OrchestratorService(deps as never);

    const run = makeRun({ state: RunState.Todo, branchName: "ai/run-1", workingDirectory: "/repo/.worktrees/run-1" });
    runRepo.findById
      .mockResolvedValueOnce(run)
      .mockResolvedValue(makeRun({ state: RunState.PlanReview }));
    (deps.linearClient.getIssue as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "LIN-1", title: "Test", description: "Test", branchName: "ai/lin-1", labels: [], priority: 0,
    });
    runRepo.update.mockResolvedValue(makeRun({ state: RunState.Planning, planVersion: 1 }));
    runRepo.updateState
      .mockResolvedValueOnce(makeRun({ state: RunState.Planning }))
      .mockResolvedValueOnce(makeRun({ state: RunState.PlanReview }))
      .mockResolvedValueOnce(makeRun({ state: RunState.AwaitingPlanApproval }));

    artifactRepo.findLatestByType.mockImplementation((_: string, type: string) =>
      type === "Plan" ? Promise.resolve(makeArtifact({ type: "Plan", payloadJson: makePlan() })) : Promise.resolve(null),
    );
    plannerAgent.run.mockResolvedValue(makePlan({ openQuestions: [] }));
    (deps.planReviewerAgent as { run: ReturnType<typeof vi.fn> }).run.mockResolvedValue({
      overallVerdict: "approved", summary: "OK", findings: [],
    });

    await svc.retryRun("run-1");

    expect(gitService.setupRunWorktree).not.toHaveBeenCalled();
  });

  it("pauses for clarification when the re-plan still has blocking questions", async () => {
    const { deps, runRepo, plannerAgent, artifactRepo } = buildDeps({
      answerResearcherAgent: undefined,
    });
    const svc = new OrchestratorService(deps as never);

    const run = makeRun({ state: RunState.Todo, branchName: "ai/run-1" });
    runRepo.findById.mockResolvedValue(run);
    (deps.linearClient.getIssue as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "LIN-1", title: "Test", description: "Test", branchName: "ai/lin-1", labels: [], priority: 0,
    });
    runRepo.update.mockResolvedValue(makeRun({ state: RunState.Planning, planVersion: 1 }));
    runRepo.updateState
      .mockResolvedValueOnce(makeRun({ state: RunState.Planning }))
      .mockResolvedValueOnce(makeRun({ state: RunState.HumanClarificationNeeded }));

    artifactRepo.findLatestByType.mockResolvedValue(null);
    plannerAgent.run.mockResolvedValue(
      makePlan({ openQuestions: [{ id: "q1", question: "Which env?", requiredForExecution: true }] }),
    );

    const result = await svc.retryRun("run-1");

    expect(result.state).toBe(RunState.HumanClarificationNeeded);
    expect((deps.planReviewerAgent as { run: ReturnType<typeof vi.fn> }).run).not.toHaveBeenCalled();
  });
});

describe("OrchestratorService.runPlanning", () => {
  it("re-plans using prior artifacts (rejection context, human/researched answers, plan review) when present", async () => {
    const { deps, runRepo, artifactRepo, plannerAgent } = buildDeps({
      answerResearcherAgent: undefined,
    });
    const svc = new OrchestratorService(deps as never);

    const run = makeRun({ state: RunState.Planning, planVersion: 1 });
    runRepo.findById
      .mockResolvedValueOnce(run)
      .mockResolvedValue(makeRun({ state: RunState.PlanReview }));
    (deps.linearClient.getIssue as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "LIN-1", title: "Test", description: "Test", branchName: "ai/lin-1", labels: [], priority: 0,
    });

    const previousPlan = makePlan({ planVersion: 1 });
    artifactRepo.findLatestByType.mockImplementation((_: string, type: string) => {
      if (type === "RejectionContext")
        return Promise.resolve(
          makeArtifact({ type: "RejectionContext", payloadJson: { planVersion: 1, feedback: "use OAuth2", source: "api", mode: "iterate" } }),
        );
      if (type === "Plan") return Promise.resolve(makeArtifact({ type: "Plan", payloadJson: previousPlan }));
      if (type === "HumanAnswers")
        return Promise.resolve(makeArtifact({ type: "HumanAnswers", payloadJson: { answers: [{ questionId: "q1", answer: "yes" }] } }));
      if (type === "ResearchedAnswers")
        return Promise.resolve(
          makeArtifact({
            type: "ResearchedAnswers",
            payloadJson: { summary: "s", answers: [{ questionId: "q1", question: "Q", answer: "A", confidence: "high" }], completedAt: "2026-01-01T00:00:00Z" },
          }),
        );
      if (type === "PlanReview")
        return Promise.resolve(
          makeArtifact({ type: "PlanReview", payloadJson: { summary: "review summary", findings: [] } }),
        );
      return Promise.resolve(null);
    });

    runRepo.update.mockResolvedValue(makeRun({ state: RunState.Planning, planVersion: 2 }));
    runRepo.updateState
      .mockResolvedValueOnce(makeRun({ state: RunState.PlanReview }))
      .mockResolvedValueOnce(makeRun({ state: RunState.AwaitingPlanApproval }));

    plannerAgent.run.mockResolvedValue(makePlan({ planVersion: 2, openQuestions: [] }));
    (deps.planReviewerAgent as { run: ReturnType<typeof vi.fn> }).run.mockResolvedValue({
      overallVerdict: "approved", summary: "OK", findings: [],
    });

    await svc.runPlanning("run-1");

    expect(plannerAgent.run).toHaveBeenCalledWith(
      expect.anything(),
      "run-1",
      expect.objectContaining({
        planVersionOverride: 2,
        previousPlan,
        humanFeedback: { planVersion: 1, feedback: "use OAuth2" },
        humanAnswers: [{ questionId: "q1", answer: "yes" }],
        researchedAnswers: [{ questionId: "q1", question: "Q", answer: "A", confidence: "high" }],
        planReviewFindings: { summary: "review summary", findings: [] },
      }),
    );
  });

  it("pauses for clarification when the retried plan still has blocking questions", async () => {
    const { deps, runRepo, artifactRepo, plannerAgent } = buildDeps({
      answerResearcherAgent: undefined,
    });
    const svc = new OrchestratorService(deps as never);

    const run = makeRun({ state: RunState.Planning, planVersion: 1 });
    runRepo.findById.mockResolvedValue(run);
    (deps.linearClient.getIssue as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "LIN-1", title: "Test", description: "Test", branchName: "ai/lin-1", labels: [], priority: 0,
    });
    artifactRepo.findLatestByType.mockResolvedValue(null);
    runRepo.update.mockResolvedValue(makeRun({ state: RunState.Planning, planVersion: 2 }));
    runRepo.updateState.mockResolvedValueOnce(makeRun({ state: RunState.HumanClarificationNeeded }));

    plannerAgent.run.mockResolvedValue(
      makePlan({ planVersion: 2, openQuestions: [{ id: "q1", question: "Which?", requiredForExecution: true }] }),
    );

    const result = await svc.runPlanning("run-1");

    expect(result.state).toBe(RunState.HumanClarificationNeeded);
    expect((deps.planReviewerAgent as { run: ReturnType<typeof vi.fn> }).run).not.toHaveBeenCalled();
  });
});
