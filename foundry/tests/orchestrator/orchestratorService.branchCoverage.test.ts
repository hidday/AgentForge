import { describe, it, expect } from "vitest";
import { OrchestratorService } from "../../src/orchestrator/orchestratorService.js";
import { RunState } from "../../src/domain/runState.js";
import { RunEvent } from "../../src/domain/runEvent.js";
import {
  buildDeps,
  makeRun,
  makePlan,
  makeArtifact,
  makeExecutionReport,
} from "./testHelpers.js";

describe("OrchestratorService.rejectPlan -- iterate mode context injection", () => {
  it("passes prior humanAnswers, researchedAnswers, and planReviewFindings to the planner", async () => {
    const run = makeRun({ id: "run-1", state: RunState.AwaitingPlanApproval, planVersion: 2 });
    const previousPlan = makePlan({ planVersion: 2 });
    const built = buildDeps({
      run,
      artifacts: {
        Plan: makeArtifact({ type: "Plan", payloadJson: previousPlan }),
        HumanAnswers: makeArtifact({
          type: "HumanAnswers",
          payloadJson: { answers: [{ questionId: "q1", answer: "yes" }] },
        }),
        ResearchedAnswers: makeArtifact({
          type: "ResearchedAnswers",
          payloadJson: {
            summary: "s",
            answers: [{ questionId: "q2", question: "?", answer: "a", confidence: "high" }],
            completedAt: new Date().toISOString(),
          },
        }),
        PlanReview: makeArtifact({
          type: "PlanReview",
          payloadJson: { summary: "prior review", findings: [] },
        }),
      },
    });
    built.setPlannerPlan(makePlan({ planVersion: 3, openQuestions: [] }));

    const svc = new OrchestratorService(built.deps as never);
    await svc.rejectPlan("run-1", "iterate please", "api", "iterate");

    expect(built.plannerAgent.run).toHaveBeenCalledWith(
      expect.anything(),
      "run-1",
      expect.objectContaining({
        humanAnswers: [{ questionId: "q1", answer: "yes" }],
        researchedAnswers: [{ questionId: "q2", question: "?", answer: "a", confidence: "high" }],
        planReviewFindings: { summary: "prior review", findings: [] },
      }),
    );
  });
});

describe("OrchestratorService.maybeResearchAndReplan -- prior human answers injected into research + re-plan", () => {
  it("forwards existing HumanAnswers to both the researcher and the follow-up planner call", async () => {
    const run = makeRun({ id: "run-1", state: RunState.Planning, planVersion: 1 });
    const built = buildDeps({
      run,
      withAnswerResearcherAgent: true,
      artifacts: {
        HumanAnswers: makeArtifact({
          type: "HumanAnswers",
          payloadJson: { answers: [{ questionId: "q1", answer: "us-east-1" }] },
        }),
      },
    });
    // Initial plan has an open question so the researcher fires; the plan the
    // planner returns on its SECOND call (the re-plan) should resolve it.
    built.setPlannerPlan(
      makePlan({
        planVersion: 1,
        openQuestions: [{ id: "q1", question: "Which region?", requiredForExecution: false }],
      }),
    );
    built.queuePlannerPlans(makePlan({ planVersion: 2, openQuestions: [] }));

    const svc = new OrchestratorService(built.deps as never);
    const result = await svc.runPlanning("run-1");

    expect(built.answerResearcherAgent!.run).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      "run-1",
      { humanAnswers: [{ questionId: "q1", answer: "us-east-1" }] },
    );
    expect(built.plannerAgent.run).toHaveBeenLastCalledWith(
      expect.anything(),
      "run-1",
      expect.objectContaining({
        humanAnswers: [{ questionId: "q1", answer: "us-east-1" }],
        researchedAnswers: expect.anything(),
      }),
    );
    expect(result.state).toBe(RunState.AwaitingPlanApproval);
  });
});

describe("OrchestratorService.buildTaskBundle -- remote default branch differs from config", () => {
  it("uses the remote branch and logs a warning when it differs from the configured value", async () => {
    const run = makeRun({ id: "run-1", state: RunState.PlanReview, planVersion: 1 });
    const plan = makePlan({ planVersion: 1 });
    const built = buildDeps({
      run,
      artifacts: { Plan: makeArtifact({ type: "Plan", payloadJson: plan }) },
    });
    built.githubClient.getDefaultBranch.mockResolvedValue("trunk");

    const svc = new OrchestratorService(built.deps as never);
    await svc.runPlanReview("run-1");

    expect(built.planReviewerAgent.run).toHaveBeenCalledWith(
      plan,
      expect.objectContaining({ repo: expect.objectContaining({ defaultBranch: "trunk" }) }),
      "run-1",
    );
    expect(built.logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ repo: "test-repo", config: "main", remote: "trunk" }),
      "Config defaultBranch differs from GitHub, using remote value",
    );
  });
});

describe("OrchestratorService.cleanupRunWorktree", () => {
  it("removes the worktree when the run's working directory is not the main repo path", async () => {
    const run = makeRun({
      id: "run-1",
      state: RunState.ReadyForHumanReview,
      workingDirectory: "/tmp/repo/worktrees/run-1",
    });
    const built = buildDeps({ run });
    built.gitService.resolveMainRepoPath.mockReturnValue("/tmp/repo");

    const svc = new OrchestratorService(built.deps as never);
    await svc.approveHumanReview("run-1");

    expect(built.gitService.removeWorktree).toHaveBeenCalledWith(
      "/tmp/repo",
      "/tmp/repo/worktrees/run-1",
    );
  });

  it("does not remove the worktree when the working directory IS the main repo path", async () => {
    const run = makeRun({
      id: "run-1",
      state: RunState.ReadyForHumanReview,
      workingDirectory: "/tmp/repo",
    });
    const built = buildDeps({ run });
    built.gitService.resolveMainRepoPath.mockReturnValue("/tmp/repo");

    const svc = new OrchestratorService(built.deps as never);
    await svc.approveHumanReview("run-1");

    expect(built.gitService.removeWorktree).not.toHaveBeenCalled();
  });
});

describe("OrchestratorService -- formatExecutionReportComment branches", () => {
  async function runWithReport(built: ReturnType<typeof buildDeps>) {
    const svc = new OrchestratorService(built.deps as never);
    await svc.runExecution("run-1");
    const call = built.linearClient.postComment.mock.calls.find((c: unknown[]) =>
      (c[1] as string).includes("Execution Report"),
    );
    return call![1] as string;
  }

  it("omits the files-changed section when no files changed", async () => {
    const run = makeRun({ id: "run-1", state: RunState.Implementing, approvedPlanVersion: 1 });
    const built = buildDeps({
      run,
      artifacts: { Plan: makeArtifact({ type: "Plan", payloadJson: makePlan({ planVersion: 1 }) }) },
    });
    built.setExecutorResult({ report: makeExecutionReport({ filesChanged: [] }), prNumber: 42 });

    const comment = await runWithReport(built);
    expect(comment).not.toContain("Files changed");
  });

  it("collapses the files-changed section behind <details> when more than 8 files changed", async () => {
    const run = makeRun({ id: "run-1", state: RunState.Implementing, approvedPlanVersion: 1 });
    const built = buildDeps({
      run,
      artifacts: { Plan: makeArtifact({ type: "Plan", payloadJson: makePlan({ planVersion: 1 }) }) },
    });
    const files = Array.from({ length: 9 }, (_, i) => `src/file${i}.ts`);
    built.setExecutorResult({ report: makeExecutionReport({ filesChanged: files }), prNumber: 42 });

    const comment = await runWithReport(built);
    expect(comment).toContain("<details>");
    expect(comment).toContain("Files changed (9)");
    expect(comment).toContain("src/file8.ts");
  });

  it("includes a Notes section when the report has notes", async () => {
    const run = makeRun({ id: "run-1", state: RunState.Implementing, approvedPlanVersion: 1 });
    const built = buildDeps({
      run,
      artifacts: { Plan: makeArtifact({ type: "Plan", payloadJson: makePlan({ planVersion: 1 }) }) },
    });
    built.setExecutorResult({
      report: makeExecutionReport({ notes: ["Skipped flaky integration test"] }),
      prNumber: 42,
    });

    const comment = await runWithReport(built);
    expect(comment).toContain("### Notes");
    expect(comment).toContain("Skipped flaky integration test");
  });
});

describe("OrchestratorService -- skill retrieval and metrics (agentSkillRepo integration)", () => {
  it("retrieves and injects prior skills, recording a SKILL_INJECTION event", async () => {
    const run = makeRun({ id: "run-1", state: RunState.Todo });
    const built = buildDeps({ run, withAgentSkillRepo: true });
    // startRun derives the run's title/description from the freshly-fetched
    // Linear issue (persisted onto the new run row), not from the run fixture.
    built.linearClient.getIssue.mockResolvedValue({
      id: "LIN-1",
      title: "Add OAuth support",
      description: "Users need to log in with Google",
      branchName: "ai/lin-1",
      labels: [],
      priority: 0,
      project: "test-project",
      team: "test-team",
      identifier: "LIN-1",
      url: "https://linear.app/issue/LIN-1",
    });
    built.agentSkillRepo!.findTopKByRelevance.mockResolvedValue([
      {
        id: "skill-1",
        repoSlug: "test-repo",
        name: "oauth-skill",
        description: "How to add OAuth",
        taskCategory: "auth",
        skillMarkdown: "# OAuth",
        utilityScore: 0.5,
        lastUsedAt: new Date(),
      },
    ]);

    const svc = new OrchestratorService(built.deps as never);
    await svc.startRun("LIN-1");

    expect(built.agentSkillRepo!.findTopKByRelevance).toHaveBeenCalledWith(
      "test-repo",
      expect.stringContaining("Add OAuth support"),
      expect.any(Number),
    );
    expect(built.eventRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "SKILL_INJECTION",
        payloadJson: { skillIds: ["skill-1"] },
      }),
    );
  });

  it("does not record a SKILL_INJECTION event when no skills are found", async () => {
    const run = makeRun({ id: "run-1", state: RunState.Todo });
    const built = buildDeps({ run, withAgentSkillRepo: true });
    built.agentSkillRepo!.findTopKByRelevance.mockResolvedValue([]);

    const svc = new OrchestratorService(built.deps as never);
    await svc.startRun("LIN-1");

    const injectionCall = built.eventRepo.create.mock.calls.find(
      (c: unknown[]) => (c[0] as { eventType: string }).eventType === "SKILL_INJECTION",
    );
    expect(injectionCall).toBeUndefined();
  });

  it("increments success metrics and archives-if-low-utility for injected skills when the run completes (Done)", async () => {
    const run = makeRun({ id: "run-1", state: RunState.ReadyForHumanReview });
    const built = buildDeps({ run, withAgentSkillRepo: true });
    built.eventRepo.findByRunId.mockResolvedValue([
      {
        id: "evt-1",
        runId: "run-1",
        eventType: "SKILL_INJECTION",
        source: "orchestrator",
        payloadJson: { skillIds: ["skill-1", "skill-2"] },
        createdAt: new Date(),
      },
      {
        id: "evt-2",
        runId: "run-1",
        eventType: "SKILL_INJECTION",
        source: "orchestrator",
        payloadJson: { skillIds: ["skill-1"] },
        createdAt: new Date(),
      },
    ]);

    const svc = new OrchestratorService(built.deps as never);
    await svc.approveHumanReview("run-1");

    // Deduplicated across the two injection events.
    expect(built.agentSkillRepo!.incrementSuccess).toHaveBeenCalledTimes(2);
    expect(built.agentSkillRepo!.incrementSuccess).toHaveBeenCalledWith("skill-1");
    expect(built.agentSkillRepo!.incrementSuccess).toHaveBeenCalledWith("skill-2");
    expect(built.agentSkillRepo!.incrementFailure).not.toHaveBeenCalled();
    expect(built.agentSkillRepo!.archiveIfLowUtility).toHaveBeenCalledTimes(2);
  });

  it("increments failure metrics for injected skills when the run fails (Failed), and swallows per-skill errors", async () => {
    const run = makeRun({ id: "run-1", state: RunState.HumanClarificationNeeded, planVersion: 1 });
    const plan = makePlan({
      openQuestions: [{ id: "q1", question: "Scope?", requiredForExecution: true }],
    });
    const built = buildDeps({
      run,
      withAgentSkillRepo: true,
      artifacts: {
        Plan: makeArtifact({ type: "Plan", payloadJson: plan }),
        TaskBundle: makeArtifact({ type: "TaskBundle", payloadJson: {} }),
      },
    });
    // Still-blocking re-plan so answerQuestions proceeds to the max-iterations check.
    built.setPlannerPlan(
      makePlan({
        planVersion: 2,
        openQuestions: [{ id: "q1", question: "Scope?", requiredForExecution: true }],
      }),
    );
    built.eventRepo.findByRunId.mockResolvedValue([
      { id: "e1", runId: "run-1", eventType: RunEvent.NEEDS_HUMAN_CLARIFICATION, source: "s", payloadJson: {}, createdAt: new Date() },
      { id: "e2", runId: "run-1", eventType: RunEvent.NEEDS_HUMAN_CLARIFICATION, source: "s", payloadJson: {}, createdAt: new Date() },
      { id: "e3", runId: "run-1", eventType: RunEvent.NEEDS_HUMAN_CLARIFICATION, source: "s", payloadJson: {}, createdAt: new Date() },
      {
        id: "e4",
        runId: "run-1",
        eventType: "SKILL_INJECTION",
        source: "orchestrator",
        payloadJson: { skillIds: ["skill-1"] },
        createdAt: new Date(),
      },
    ]);
    built.agentSkillRepo!.incrementFailure.mockRejectedValue(new Error("db unavailable"));

    const svc = new OrchestratorService(built.deps as never);
    const result = await svc.answerQuestions("run-1", [{ questionId: "q1", answer: "partial" }]);

    expect(result.state).toBe(RunState.Failed);
    expect(built.agentSkillRepo!.incrementFailure).toHaveBeenCalledWith("skill-1");
    expect(built.agentSkillRepo!.archiveIfLowUtility).not.toHaveBeenCalled();
    expect(built.logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ runId: "run-1", skillId: "skill-1", error: "db unavailable" }),
      "Failed to update skill metric",
    );
  });
});
