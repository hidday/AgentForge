import { describe, it, expect } from "vitest";
import { OrchestratorService } from "../../src/orchestrator/orchestratorService.js";
import { RunState } from "../../src/domain/runState.js";
import {
  buildDeps,
  makeRun,
  makePlan,
  makeArtifact,
  makeExecutionReport,
  makeReview,
} from "./testHelpers.js";

describe("OrchestratorService.retryRun -- repo resolution fallback", () => {
  it("falls back to the default repo when getRepoByName returns undefined", async () => {
    const run = makeRun({ id: "run-1", state: RunState.Todo, branchName: null });
    const built = buildDeps({ run });
    built.repoRegistry.getRepoByName.mockReturnValue(undefined);

    const svc = new OrchestratorService(built.deps as never);
    await svc.retryRun("run-1");

    expect(built.repoRegistry.getDefaultRepo).toHaveBeenCalled();
  });
});

describe("OrchestratorService.answerQuestions -- prior ResearchedAnswers carried into the re-plan", () => {
  it("forwards an existing ResearchedAnswers artifact's answers to the re-plan call", async () => {
    const run = makeRun({ id: "run-1", state: RunState.HumanClarificationNeeded, planVersion: 1 });
    const plan = makePlan({
      openQuestions: [{ id: "q1", question: "Scope?", requiredForExecution: true }],
    });
    const built = buildDeps({
      run,
      artifacts: {
        Plan: makeArtifact({ type: "Plan", payloadJson: plan }),
        TaskBundle: makeArtifact({ type: "TaskBundle", payloadJson: {} }),
        ResearchedAnswers: makeArtifact({
          type: "ResearchedAnswers",
          payloadJson: {
            summary: "s",
            answers: [{ questionId: "q2", question: "?", answer: "prior research", confidence: "medium" }],
            completedAt: new Date().toISOString(),
          },
        }),
      },
    });
    built.setPlannerPlan(makePlan({ planVersion: 2, openQuestions: [] }));

    const svc = new OrchestratorService(built.deps as never);
    const result = await svc.answerQuestions("run-1", [{ questionId: "q1", answer: "yes" }]);

    expect(built.plannerAgent.run).toHaveBeenCalledWith(
      expect.anything(),
      "run-1",
      expect.objectContaining({
        researchedAnswers: [
          { questionId: "q2", question: "?", answer: "prior research", confidence: "medium" },
        ],
      }),
    );
    expect(result.state).toBe(RunState.AwaitingPlanApproval);
  });
});

describe("OrchestratorService -- requireRun 'not found' guard", () => {
  it("throws a plain Error when the run does not exist", async () => {
    const { deps, runRepo } = buildDeps();
    runRepo.findById.mockResolvedValue(null);
    const svc = new OrchestratorService(deps as never);

    await expect(svc.approvePlan("missing-run")).rejects.toThrow("Run not found: missing-run");
  });
});

describe("OrchestratorService.buildTaskBundle -- non-Error rejections stringified", () => {
  it("stringifies a non-Error thrown by githubClient.getDefaultBranch", async () => {
    const run = makeRun({ id: "run-1", state: RunState.PlanReview, planVersion: 1 });
    const plan = makePlan({ planVersion: 1 });
    const built = buildDeps({
      run,
      artifacts: { Plan: makeArtifact({ type: "Plan", payloadJson: plan }) },
    });
    built.githubClient.getDefaultBranch.mockRejectedValue("network down");

    const svc = new OrchestratorService(built.deps as never);
    await svc.runPlanReview("run-1");

    expect(built.logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ repo: "test-repo", error: "network down" }),
      "Failed to resolve default branch from GitHub, falling back to config value",
    );
  });

  it("stringifies a non-Error thrown by linearClient.getRelatedContext", async () => {
    const run = makeRun({ id: "run-1", state: RunState.PlanReview, planVersion: 1 });
    const plan = makePlan({ planVersion: 1 });
    const built = buildDeps({
      run,
      artifacts: { Plan: makeArtifact({ type: "Plan", payloadJson: plan }) },
    });
    built.linearClient.getRelatedContext.mockRejectedValue({ code: "RATE_LIMIT" });

    const svc = new OrchestratorService(built.deps as never);
    await svc.runPlanReview("run-1");

    expect(built.logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ issueId: "LIN-1", error: "[object Object]" }),
      "Failed to fetch related Linear context; proceeding without it",
    );
  });
});

describe("OrchestratorService -- formatPlanComment risks section", () => {
  it("includes a Risks section when the plan lists risks", async () => {
    const run = makeRun({ id: "run-1", state: RunState.PlanReview, planVersion: 1 });
    const plan = makePlan({ planVersion: 1, risks: ["Breaking API change", "Data migration needed"] });
    const built = buildDeps({
      run,
      artifacts: { Plan: makeArtifact({ type: "Plan", payloadJson: plan }) },
    });

    const svc = new OrchestratorService(built.deps as never);
    await svc.runPlanReview("run-1");

    const comment = built.linearClient.postComment.mock.calls.find((c: unknown[]) =>
      (c[1] as string).includes("AI Plan"),
    );
    expect(comment).toBeDefined();
    expect(comment![1]).toContain("**Risks:**");
    expect(comment![1]).toContain("Breaking API change");
  });
});

describe("OrchestratorService.runManualPlanRevision -- no operator note on changes_requested", () => {
  it("passes undefined (not an empty note object) to runPlanRevision when no note was given", async () => {
    const run = makeRun({ id: "run-1", state: RunState.AwaitingPlanApproval, planVersion: 2 });
    const plan = makePlan({ planVersion: 2 });
    const built = buildDeps({
      run,
      artifacts: { Plan: makeArtifact({ type: "Plan", payloadJson: plan }) },
    });
    built.setPlanReviewResult({
      reviewId: "pr-1",
      overallVerdict: "changes_requested",
      summary: "Needs work",
      findings: [{ id: "f1", severity: "important", title: "Issue", details: "detail" }],
    });

    const svc = new OrchestratorService(built.deps as never);
    const result = await svc.runManualPlanRevision("run-1");

    expect(built.planReviserAgent.run).toHaveBeenCalledWith(
      plan,
      expect.objectContaining({ overallVerdict: "changes_requested" }),
      expect.anything(),
      "run-1",
      undefined,
    );
    expect(result.state).toBe(RunState.AwaitingPlanApproval);
  });
});

describe("OrchestratorService.approveHumanReview -- non-Error distillation failure", () => {
  it("stringifies a non-Error thrown by the distillation agent", async () => {
    const run = makeRun({ id: "run-1", state: RunState.ReadyForHumanReview });
    const built = buildDeps({ run, withDistillationAgent: true });
    built.distillationAgent!.run.mockRejectedValue("distillation service unavailable");

    const svc = new OrchestratorService(built.deps as never);
    const result = await svc.approveHumanReview("run-1");

    expect(result.state).toBe(RunState.Done);
    expect(built.logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ runId: "run-1", error: "distillation service unavailable" }),
      expect.stringContaining("Distillation agent failed"),
    );
  });
});

describe("OrchestratorService -- comment formatting edge cases", () => {
  it("formatPlanReviewComment omits the step reference when a finding has no affectedStepId", async () => {
    const run = makeRun({ id: "run-1", state: RunState.PlanReview, planVersion: 1 });
    const plan = makePlan({ planVersion: 1 });
    const built = buildDeps({
      run,
      artifacts: { Plan: makeArtifact({ type: "Plan", payloadJson: plan }) },
    });
    built.setPlanReviewResult({
      reviewId: "pr-1",
      overallVerdict: "changes_requested",
      summary: "Needs work",
      findings: [{ id: "f1", severity: "nit", title: "Style nit", details: "tidy up" }],
    });

    const svc = new OrchestratorService(built.deps as never);
    await svc.runPlanReview("run-1");

    const comment = built.linearClient.postComment.mock.calls.find((c: unknown[]) =>
      (c[1] as string).includes("Style nit"),
    );
    expect(comment).toBeDefined();
    expect(comment![1]).not.toContain("(step ");
  });

  it("formatCodeReviewComment omits the line reference when a finding has no lineHint", async () => {
    const run = makeRun({ id: "run-1", state: RunState.AIReview, prNumber: 42 });
    const built = buildDeps({
      run,
      artifacts: {
        ExecutionReport: makeArtifact({ type: "ExecutionReport", payloadJson: makeExecutionReport() }),
        Plan: makeArtifact({ type: "Plan", payloadJson: makePlan() }),
      },
    });
    built.setReviewResult(
      makeReview({
        overallVerdict: "changes_requested",
        findings: [
          { id: "f1", severity: "nit", type: "style", file: "src/a.ts", title: "Nit", details: "tidy" },
        ],
      }),
    );

    const svc = new OrchestratorService(built.deps as never);
    await expect(svc.runReview("run-1")).rejects.toMatchObject({
      rule: "ready_requires_approved_verdict",
    });

    const comment = built.linearClient.postComment.mock.calls.find((c: unknown[]) =>
      (c[1] as string).includes("AI Code Review"),
    );
    expect(comment).toBeDefined();
    expect(comment![1]).toContain("(src/a.ts)");
    expect(comment![1]).not.toMatch(/src\/a\.ts:\d/);
  });

  it("formatExecutionReportComment renders the neutral icon for a skipped check", async () => {
    const run = makeRun({ id: "run-1", state: RunState.Implementing, approvedPlanVersion: 1 });
    const built = buildDeps({
      run,
      artifacts: { Plan: makeArtifact({ type: "Plan", payloadJson: makePlan({ planVersion: 1 }) }) },
    });
    built.setExecutorResult({
      report: makeExecutionReport({
        checks: {
          lint: { status: "pass", details: "ok" },
          typecheck: { status: "pass", details: "ok" },
          tests: { status: "skip", details: "no tests configured" },
        },
      }),
      prNumber: 42,
    });

    const svc = new OrchestratorService(built.deps as never);
    await svc.runExecution("run-1");

    const comment = built.linearClient.postComment.mock.calls.find((c: unknown[]) =>
      (c[1] as string).includes("Execution Report"),
    );
    expect(comment![1]).toContain(":heavy_minus_sign:");
  });

  it("formatExecutionReportComment renders the failure icon for a failed check", async () => {
    const run = makeRun({ id: "run-1", state: RunState.Implementing, approvedPlanVersion: 1 });
    const built = buildDeps({
      run,
      artifacts: { Plan: makeArtifact({ type: "Plan", payloadJson: makePlan({ planVersion: 1 }) }) },
    });
    built.setExecutorResult({
      report: makeExecutionReport({
        checks: {
          lint: { status: "pass", details: "ok" },
          typecheck: { status: "pass", details: "ok" },
          tests: { status: "fail", details: "2 tests failing" },
        },
      }),
      prNumber: 42,
    });

    const svc = new OrchestratorService(built.deps as never);
    // Failing checks means the approved-verdict review chain still ends by
    // rejecting at markReady's green-checks assertion; the execution-report
    // comment is posted before that, so we can still assert on its content.
    await expect(svc.runExecution("run-1")).rejects.toMatchObject({
      rule: "ready_requires_green_checks",
    });

    const comment = built.linearClient.postComment.mock.calls.find((c: unknown[]) =>
      (c[1] as string).includes("Execution Report"),
    );
    expect(comment![1]).toContain(":x:");
  });
});

describe("OrchestratorService -- retrieveSkillsForPlanning query building with missing title/description", () => {
  it("falls back to empty strings when the run has no linearIssueTitle/Description", async () => {
    const run = makeRun({ id: "run-1", state: RunState.Todo });
    const built = buildDeps({ run, withAgentSkillRepo: true });
    // `??` only falls back on null/undefined (not ""), so the title/description
    // must actually be absent to exercise those fallback branches.
    built.linearClient.getIssue.mockResolvedValue({
      id: "LIN-1",
      title: null,
      description: null,
      branchName: "ai/lin-1",
      labels: [],
      priority: 0,
      project: "test-project",
      team: "test-team",
      identifier: "LIN-1",
      url: "https://linear.app/issue/LIN-1",
    } as never);
    built.agentSkillRepo!.findTopKByRelevance.mockResolvedValue([]);

    const svc = new OrchestratorService(built.deps as never);
    // startRun persists a run whose linearIssueTitle/Description come straight
    // from the (null) issue fields, exercising the `?? ""` fallbacks in the
    // skill-query concatenation for a run that never got a title/description.
    await svc.startRun("LIN-1");

    expect(built.agentSkillRepo!.findTopKByRelevance).toHaveBeenCalledWith(
      "test-repo",
      " ",
      expect.any(Number),
    );
  });
});

describe("OrchestratorService.updateSkillMetrics -- remaining branches", () => {
  it("is a no-op when there are no SKILL_INJECTION events for the run", async () => {
    const run = makeRun({ id: "run-1", state: RunState.ReadyForHumanReview });
    const built = buildDeps({ run, withAgentSkillRepo: true });
    built.eventRepo.findByRunId.mockResolvedValue([]);

    const svc = new OrchestratorService(built.deps as never);
    await svc.approveHumanReview("run-1");

    expect(built.agentSkillRepo!.incrementSuccess).not.toHaveBeenCalled();
    expect(built.agentSkillRepo!.incrementFailure).not.toHaveBeenCalled();
  });

  it("falls back to an empty skill id list when an injection event's payload has no skillIds", async () => {
    const run = makeRun({ id: "run-1", state: RunState.ReadyForHumanReview });
    const built = buildDeps({ run, withAgentSkillRepo: true });
    built.eventRepo.findByRunId.mockResolvedValue([
      {
        id: "evt-1",
        runId: "run-1",
        eventType: "SKILL_INJECTION",
        source: "orchestrator",
        payloadJson: {},
        createdAt: new Date(),
      },
    ]);

    const svc = new OrchestratorService(built.deps as never);
    await svc.approveHumanReview("run-1");

    expect(built.agentSkillRepo!.incrementSuccess).not.toHaveBeenCalled();
  });

  it("stringifies a non-Error thrown while updating a skill's metrics", async () => {
    const run = makeRun({ id: "run-1", state: RunState.ReadyForHumanReview });
    const built = buildDeps({ run, withAgentSkillRepo: true });
    built.eventRepo.findByRunId.mockResolvedValue([
      {
        id: "evt-1",
        runId: "run-1",
        eventType: "SKILL_INJECTION",
        source: "orchestrator",
        payloadJson: { skillIds: ["skill-1"] },
        createdAt: new Date(),
      },
    ]);
    built.agentSkillRepo!.incrementSuccess.mockRejectedValue("timeout");

    const svc = new OrchestratorService(built.deps as never);
    await svc.approveHumanReview("run-1");

    expect(built.logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ runId: "run-1", skillId: "skill-1", error: "timeout" }),
      "Failed to update skill metric",
    );
  });
});
