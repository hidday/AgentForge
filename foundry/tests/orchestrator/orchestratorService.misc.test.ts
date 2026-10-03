import { describe, it, expect, vi } from "vitest";
import { OrchestratorService } from "../../src/orchestrator/orchestratorService.js";
import { RunState } from "../../src/domain/runState.js";
import { RunEvent } from "../../src/domain/runEvent.js";
import { buildDeps, makeRun, makeArtifact, makePlan, makeExecutionReport } from "./_fixtures.js";

describe("OrchestratorService.answerQuestions -- additional guards and branches", () => {
  it("throws when there is no Plan artifact for the run", async () => {
    const { deps, runRepo, artifactRepo } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    runRepo.findById.mockResolvedValue(makeRun({ state: RunState.HumanClarificationNeeded }));
    artifactRepo.findLatestByType.mockResolvedValue(null);

    await expect(
      svc.answerQuestions("run-1", [{ questionId: "q1", answer: "yes" }]),
    ).rejects.toThrow("No plan artifact found for run run-1");
  });

  it("throws when there is no TaskBundle artifact after clarification is provided", async () => {
    const { deps, runRepo, artifactRepo } = buildDeps({ answerResearcherAgent: undefined });
    const svc = new OrchestratorService(deps as never);

    const run = makeRun({ state: RunState.HumanClarificationNeeded });
    runRepo.findById.mockResolvedValue(run);
    const plan = makePlan({ openQuestions: [{ id: "q1", question: "Required?", requiredForExecution: true }] });
    artifactRepo.findLatestByType.mockImplementation((_: string, type: string) => {
      if (type === "Plan") return Promise.resolve(makeArtifact({ type: "Plan", payloadJson: plan }));
      if (type === "TaskBundle") return Promise.resolve(null);
      return Promise.resolve(null);
    });
    runRepo.updateState.mockResolvedValue(makeRun({ state: RunState.Planning }));

    await expect(
      svc.answerQuestions("run-1", [{ questionId: "q1", answer: "yes" }]),
    ).rejects.toThrow("No TaskBundle artifact found for run run-1");
  });

  it("loops back to HumanClarificationNeeded with an incremented iteration count when still under the max", async () => {
    const { deps, runRepo, artifactRepo, eventRepo, plannerAgent } = buildDeps({
      answerResearcherAgent: undefined,
    });
    const svc = new OrchestratorService(deps as never);

    const run = makeRun({ state: RunState.HumanClarificationNeeded });
    runRepo.findById.mockResolvedValue(run);
    const plan = makePlan({ openQuestions: [{ id: "q1", question: "Required?", requiredForExecution: true }] });
    artifactRepo.findLatestByType.mockImplementation((_: string, type: string) => {
      if (type === "Plan") return Promise.resolve(makeArtifact({ type: "Plan", payloadJson: plan }));
      if (type === "TaskBundle")
        return Promise.resolve(
          makeArtifact({ type: "TaskBundle", payloadJson: { issue: {}, repo: {}, constraints: {}, definitionOfDone: [] } }),
        );
      return Promise.resolve(null);
    });
    runRepo.update.mockResolvedValue(makeRun({ state: RunState.Planning, planVersion: 2 }));
    runRepo.updateState
      .mockResolvedValueOnce(makeRun({ state: RunState.Planning })) // CLARIFICATION_PROVIDED
      .mockResolvedValueOnce(makeRun({ state: RunState.PlanReview })) // PLAN_CREATED
      .mockResolvedValueOnce(makeRun({ state: RunState.HumanClarificationNeeded })); // NEEDS_HUMAN_CLARIFICATION

    plannerAgent.run.mockResolvedValue(
      makePlan({ planVersion: 2, openQuestions: [{ id: "q1", question: "Still required?", requiredForExecution: true }] }),
    );
    // Only ONE prior clarification event -- below MAX_CLARIFICATION_ITERATIONS (3).
    eventRepo.findByRunId.mockResolvedValue([
      { id: "e1", runId: "run-1", eventType: RunEvent.NEEDS_HUMAN_CLARIFICATION, source: "planner-agent", payloadJson: {}, createdAt: new Date() },
    ]);

    const result = await svc.answerQuestions("run-1", [{ questionId: "q1", answer: "still unsure" }]);

    expect(result.state).toBe(RunState.HumanClarificationNeeded);
    const loopEvent = eventRepo.create.mock.calls.find(
      (c: unknown[]) => (c[0] as { eventType: string }).eventType === RunEvent.NEEDS_HUMAN_CLARIFICATION,
    );
    expect(loopEvent).toBeDefined();
    expect((loopEvent![0] as { payloadJson: { iteration: number } }).payloadJson.iteration).toBe(2);
  });
});

describe("OrchestratorService -- maybeResearchAndReplan picks up prior HumanAnswers", () => {
  it("forwards existing HumanAnswers into both the researcher call and the re-plan call", async () => {
    const { deps, runRepo, artifactRepo, eventRepo, plannerAgent, answerResearcherAgent, planReviewerAgent } =
      buildDeps();
    const svc = new OrchestratorService(deps as never);

    const todoRun = makeRun({ state: RunState.Todo });
    runRepo.findActiveByIssueId.mockResolvedValue(null);
    runRepo.create.mockResolvedValue(todoRun);
    (deps.repoRegistry.resolveForIssue as ReturnType<typeof vi.fn>).mockReturnValue({
      name: "test-repo", defaultBranch: "main", allowedPaths: ["src/"], protectedPaths: [],
      constraints: { requiredChecks: [], maxFilesChanged: 10, maxDiffLines: 500, forbiddenPatterns: [], mustNotTouch: [] },
    });
    (deps.repoRegistry.resolveWorkingDirectory as ReturnType<typeof vi.fn>).mockReturnValue("/tmp");
    (deps.repoRegistry.validateWorkingDirectory as ReturnType<typeof vi.fn>).mockReturnValue(undefined);
    (deps.linearClient.getIssue as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "LIN-1", title: "Test", description: "Test", branchName: "ai/lin-1", labels: [], priority: 0,
    });

    runRepo.update
      .mockResolvedValueOnce({ ...todoRun, workingDirectory: "/tmp/worktree", branchName: "ai/run-1" })
      .mockResolvedValueOnce(makeRun({ state: RunState.Planning, planVersion: 1 }))
      .mockResolvedValueOnce(makeRun({ state: RunState.Planning, planVersion: 2 }));
    runRepo.updateState
      .mockResolvedValueOnce(makeRun({ state: RunState.Planning }))
      .mockResolvedValueOnce(makeRun({ state: RunState.PlanReview }))
      .mockResolvedValueOnce(makeRun({ state: RunState.AwaitingPlanApproval }));

    const initialPlan = makePlan({
      planVersion: 1,
      openQuestions: [{ id: "q1", question: "Optional?", requiredForExecution: false }],
    });
    const revisedPlan = makePlan({ planVersion: 2, openQuestions: [] });

    artifactRepo.findLatestByType.mockImplementation((_: string, type: string) => {
      if (type === "ResearchedAnswers") return Promise.resolve(null);
      if (type === "HumanAnswers")
        return Promise.resolve(
          makeArtifact({ type: "HumanAnswers", payloadJson: { answers: [{ questionId: "q0", answer: "prior answer" }] } }),
        );
      if (type === "Plan") return Promise.resolve(makeArtifact({ type: "Plan", payloadJson: revisedPlan }));
      return Promise.resolve(null);
    });

    runRepo.findById.mockResolvedValue(makeRun({ state: RunState.PlanReview }));

    plannerAgent.run.mockResolvedValueOnce(initialPlan).mockResolvedValueOnce(revisedPlan);
    answerResearcherAgent.run.mockResolvedValue({
      summary: "done",
      answers: [{ questionId: "q1", question: "Optional?", answer: "yes", confidence: "high" }],
      completedAt: "2026-01-01T00:00:00Z",
    });
    planReviewerAgent.run.mockResolvedValue({ overallVerdict: "approved", summary: "OK", findings: [] });

    await svc.startRun("LIN-1");

    expect(answerResearcherAgent.run).toHaveBeenCalledWith(
      initialPlan,
      expect.anything(),
      "run-1",
      { humanAnswers: [{ questionId: "q0", answer: "prior answer" }] },
    );
    expect(plannerAgent.run).toHaveBeenLastCalledWith(
      expect.anything(),
      "run-1",
      expect.objectContaining({ humanAnswers: [{ questionId: "q0", answer: "prior answer" }] }),
    );
    expect(eventRepo.create).toHaveBeenCalled();
  });
});

describe("OrchestratorService.rejectPlan -- loadReplanContext picks up a prior PlanReview", () => {
  it("forwards planReviewFindings from a prior PlanReview artifact into the re-plan call", async () => {
    const { deps, runRepo, artifactRepo, plannerAgent } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    runRepo.findById
      .mockResolvedValueOnce(makeRun({ state: RunState.AwaitingPlanApproval, planVersion: 1 }))
      .mockResolvedValue(makeRun({ state: RunState.PlanReview, planVersion: 2 }));
    runRepo.updateState
      .mockResolvedValueOnce(makeRun({ state: RunState.Planning, planVersion: 1 })) // PLAN_REJECTED
      .mockResolvedValueOnce(makeRun({ state: RunState.PlanReview, planVersion: 2 })) // PLAN_CREATED
      .mockResolvedValueOnce(makeRun({ state: RunState.AwaitingPlanApproval, planVersion: 2 })); // PLAN_REVIEW_APPROVED
    runRepo.update.mockResolvedValue(makeRun({ state: RunState.Planning, planVersion: 2 }));
    (deps.linearClient.getIssue as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "LIN-1", title: "Test", description: "Test", branchName: "ai/lin-1", labels: [], priority: 0,
    });

    const planReviewPayload = { summary: "found 2 issues", findings: [{ id: "f1", severity: "important", title: "t", details: "d" }] };
    const newPlan = makePlan({ planVersion: 2, openQuestions: [] });
    artifactRepo.findLatestByType.mockImplementation((_: string, type: string) => {
      if (type === "PlanReview") return Promise.resolve(makeArtifact({ type: "PlanReview", payloadJson: planReviewPayload }));
      if (type === "Plan") return Promise.resolve(makeArtifact({ type: "Plan", payloadJson: newPlan }));
      return Promise.resolve(null);
    });
    plannerAgent.run.mockResolvedValue(newPlan);
    (deps.planReviewerAgent as { run: ReturnType<typeof vi.fn> }).run.mockResolvedValue({
      overallVerdict: "approved",
      summary: "OK",
      findings: [],
    });

    await svc.rejectPlan("run-1", "needs more work", "api", "iterate");

    expect(plannerAgent.run).toHaveBeenCalledWith(
      expect.anything(),
      "run-1",
      expect.objectContaining({ planReviewFindings: planReviewPayload }),
    );
  });
});

describe("OrchestratorService.rejectPlan -- loadReplanContext picks up prior HumanAnswers/ResearchedAnswers", () => {
  it("forwards humanAnswers and researchedAnswers from prior artifacts in iterate mode", async () => {
    const { deps, runRepo, artifactRepo, plannerAgent } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    runRepo.findById
      .mockResolvedValueOnce(makeRun({ state: RunState.AwaitingPlanApproval, planVersion: 1 }))
      .mockResolvedValue(makeRun({ state: RunState.PlanReview, planVersion: 2 }));
    runRepo.updateState
      .mockResolvedValueOnce(makeRun({ state: RunState.Planning, planVersion: 1 }))
      .mockResolvedValueOnce(makeRun({ state: RunState.PlanReview, planVersion: 2 }))
      .mockResolvedValueOnce(makeRun({ state: RunState.AwaitingPlanApproval, planVersion: 2 }));
    runRepo.update.mockResolvedValue(makeRun({ state: RunState.Planning, planVersion: 2 }));
    (deps.linearClient.getIssue as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "LIN-1", title: "Test", description: "Test", branchName: "ai/lin-1", labels: [], priority: 0,
    });

    const newPlan = makePlan({ planVersion: 2, openQuestions: [] });
    const humanAnswers = [{ questionId: "q1", answer: "yes" }];
    const researchedAnswers = [{ questionId: "q2", question: "Q2?", answer: "A2", confidence: "medium" }];
    artifactRepo.findLatestByType.mockImplementation((_: string, type: string) => {
      if (type === "Plan") return Promise.resolve(makeArtifact({ type: "Plan", payloadJson: newPlan }));
      if (type === "HumanAnswers") return Promise.resolve(makeArtifact({ type: "HumanAnswers", payloadJson: { answers: humanAnswers } }));
      if (type === "ResearchedAnswers")
        return Promise.resolve(
          makeArtifact({ type: "ResearchedAnswers", payloadJson: { summary: "s", answers: researchedAnswers, completedAt: "2026-01-01T00:00:00Z" } }),
        );
      return Promise.resolve(null);
    });
    plannerAgent.run.mockResolvedValue(newPlan);
    (deps.planReviewerAgent as { run: ReturnType<typeof vi.fn> }).run.mockResolvedValue({
      overallVerdict: "approved",
      summary: "OK",
      findings: [],
    });

    await svc.rejectPlan("run-1", "feedback", "api", "iterate");

    expect(plannerAgent.run).toHaveBeenCalledWith(
      expect.anything(),
      "run-1",
      expect.objectContaining({ humanAnswers, researchedAnswers }),
    );
  });
});

describe("OrchestratorService.formatExecutionReportComment -- no files changed", () => {
  it("omits the Files changed section entirely when filesChanged is empty", async () => {
    const { deps, runRepo, artifactRepo, executorAgent, linearClient } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    const run = makeRun({ state: RunState.Implementing, approvedPlanVersion: 1, branchName: null });
    runRepo.findById.mockResolvedValue(run);
    artifactRepo.findLatestByType.mockImplementation((_: string, type: string) =>
      type === "Plan" ? Promise.resolve(makeArtifact({ type: "Plan", payloadJson: makePlan({ planVersion: 1 }) })) : Promise.resolve(null),
    );
    (deps.linearClient.getIssue as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "LIN-1", title: "Test", description: "Test", branchName: "ai/lin-1", labels: [], priority: 0,
    });

    const report = makeExecutionReport({ filesChanged: [], notes: [] });
    executorAgent.run.mockResolvedValue({ report, prNumber: 1 });
    runRepo.update.mockResolvedValue(makeRun({ state: RunState.Implementing, prNumber: 1 }));
    runRepo.updateState.mockResolvedValue(makeRun({ state: RunState.AIReview, prNumber: 1 }));
    vi.spyOn(svc, "runReview").mockResolvedValue(makeRun({ state: RunState.ReadyForHumanReview }));

    await svc.runExecution("run-1");

    const comment = (linearClient.postComment as ReturnType<typeof vi.fn>).mock.calls.find(
      (c: unknown[]) => typeof c[1] === "string" && (c[1] as string).includes("Execution Report"),
    )![1] as string;

    expect(comment).not.toContain("Files changed");
    expect(comment).not.toContain("### Notes");
  });
});

describe("OrchestratorService.buildTaskBundle -- default branch mismatch", () => {
  it("prefers the remote default branch over the config value when they differ", async () => {
    const { deps, runRepo, artifactRepo, githubClient, plannerAgent, logger } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    runRepo.findById
      .mockResolvedValueOnce(makeRun({ state: RunState.AwaitingPlanApproval, planVersion: 1 }))
      .mockResolvedValue(makeRun({ state: RunState.PlanReview, planVersion: 2 }));
    runRepo.updateState
      .mockResolvedValueOnce(makeRun({ state: RunState.Planning, planVersion: 1 }))
      .mockResolvedValueOnce(makeRun({ state: RunState.PlanReview, planVersion: 2 }))
      .mockResolvedValueOnce(makeRun({ state: RunState.AwaitingPlanApproval, planVersion: 2 }));
    runRepo.update.mockResolvedValue(makeRun({ state: RunState.Planning, planVersion: 2 }));
    (deps.linearClient.getIssue as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "LIN-1", title: "Test", description: "Test", branchName: "ai/lin-1", labels: [], priority: 0,
    });
    githubClient.getDefaultBranch.mockResolvedValue("develop");

    const newPlan = makePlan({ planVersion: 2, openQuestions: [] });
    artifactRepo.findLatestByType.mockImplementation((_: string, type: string) =>
      type === "Plan" ? Promise.resolve(makeArtifact({ type: "Plan", payloadJson: newPlan })) : Promise.resolve(null),
    );
    plannerAgent.run.mockResolvedValue(newPlan);
    (deps.planReviewerAgent as { run: ReturnType<typeof vi.fn> }).run.mockResolvedValue({
      overallVerdict: "approved",
      summary: "OK",
      findings: [],
    });

    await svc.rejectPlan("run-1");

    const plannerCall = plannerAgent.run.mock.calls[0];
    const bundle = plannerCall[0] as { repo: { defaultBranch: string } };
    expect(bundle.repo.defaultBranch).toBe("develop");
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ config: "main", remote: "develop" }),
      "Config defaultBranch differs from GitHub, using remote value",
    );
  });
});

describe("OrchestratorService.formatExecutionReportComment -- collapsible files and notes", () => {
  it("collapses the file list in a <details> block when there are more than 8 files, and renders notes", async () => {
    const { deps, runRepo, artifactRepo, executorAgent, linearClient } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    const run = makeRun({ state: RunState.Implementing, approvedPlanVersion: 1, branchName: null });
    runRepo.findById.mockResolvedValue(run);
    artifactRepo.findLatestByType.mockImplementation((_: string, type: string) =>
      type === "Plan" ? Promise.resolve(makeArtifact({ type: "Plan", payloadJson: makePlan({ planVersion: 1 }) })) : Promise.resolve(null),
    );
    (deps.linearClient.getIssue as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "LIN-1", title: "Test", description: "Test", branchName: "ai/lin-1", labels: [], priority: 0,
    });

    const manyFiles = Array.from({ length: 9 }, (_, i) => `src/file${i}.ts`);
    const report = makeExecutionReport({ filesChanged: manyFiles, notes: ["Heads up: skipped a flaky test"] });
    executorAgent.run.mockResolvedValue({ report, prNumber: 1 });
    runRepo.update.mockResolvedValue(makeRun({ state: RunState.Implementing, prNumber: 1 }));
    runRepo.updateState.mockResolvedValue(makeRun({ state: RunState.AIReview, prNumber: 1 }));
    vi.spyOn(svc, "runReview").mockResolvedValue(makeRun({ state: RunState.ReadyForHumanReview }));

    await svc.runExecution("run-1");

    const comment = (linearClient.postComment as ReturnType<typeof vi.fn>).mock.calls.find(
      (c: unknown[]) => typeof c[1] === "string" && (c[1] as string).includes("Execution Report"),
    )![1] as string;

    expect(comment).toContain("<details>");
    expect(comment).toContain("Files changed (9)");
    expect(comment).toContain("### Notes");
    expect(comment).toContain("Heads up: skipped a flaky test");
  });
});

describe("OrchestratorService.updateSkillMetrics -- failure path", () => {
  it("calls incrementFailure (not incrementSuccess) when the run reaches Failed", async () => {
    const { deps, runRepo, artifactRepo, eventRepo, plannerAgent, agentSkillRepo } = buildDeps({
      answerResearcherAgent: undefined,
    });
    const svc = new OrchestratorService(deps as never);

    const run = makeRun({ state: RunState.HumanClarificationNeeded });
    runRepo.findById.mockResolvedValue(run);
    const plan = makePlan({ openQuestions: [{ id: "q1", question: "Required?", requiredForExecution: true }] });
    artifactRepo.findLatestByType.mockImplementation((_: string, type: string) => {
      if (type === "Plan") return Promise.resolve(makeArtifact({ type: "Plan", payloadJson: plan }));
      if (type === "TaskBundle")
        return Promise.resolve(
          makeArtifact({ type: "TaskBundle", payloadJson: { issue: {}, repo: {}, constraints: {}, definitionOfDone: [] } }),
        );
      return Promise.resolve(null);
    });
    runRepo.update.mockResolvedValue(makeRun({ state: RunState.Planning, planVersion: 2 }));
    runRepo.updateState
      .mockResolvedValueOnce(makeRun({ state: RunState.Planning }))
      .mockResolvedValueOnce(makeRun({ state: RunState.PlanReview }))
      .mockResolvedValueOnce(makeRun({ state: RunState.Failed }));

    plannerAgent.run.mockResolvedValue(
      makePlan({ planVersion: 2, openQuestions: [{ id: "q1", question: "Still required?", requiredForExecution: true }] }),
    );
    eventRepo.findByRunId.mockResolvedValue([
      { id: "e1", runId: "run-1", eventType: RunEvent.NEEDS_HUMAN_CLARIFICATION, source: "planner-agent", payloadJson: {}, createdAt: new Date() },
      { id: "e2", runId: "run-1", eventType: RunEvent.NEEDS_HUMAN_CLARIFICATION, source: "planner-agent", payloadJson: {}, createdAt: new Date() },
      { id: "e3", runId: "run-1", eventType: RunEvent.NEEDS_HUMAN_CLARIFICATION, source: "planner-agent", payloadJson: {}, createdAt: new Date() },
      { id: "e4", runId: "run-1", eventType: "SKILL_INJECTION", source: "orchestrator", payloadJson: { skillIds: ["s1"] }, createdAt: new Date() },
    ]);
    agentSkillRepo.incrementFailure.mockResolvedValue({ id: "s1", successCount: 0, failureCount: 1, utilityScore: 0 });

    const result = await svc.answerQuestions("run-1", [{ questionId: "q1", answer: "still unsure" }]);

    expect(result.state).toBe(RunState.Failed);
    expect(agentSkillRepo.incrementFailure).toHaveBeenCalledWith("s1");
    expect(agentSkillRepo.incrementSuccess).not.toHaveBeenCalled();
  });
});
