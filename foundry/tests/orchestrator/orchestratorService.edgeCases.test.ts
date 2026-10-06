import { describe, it, expect, vi } from "vitest";
import { OrchestratorService } from "../../src/orchestrator/orchestratorService.js";
import { RunState } from "../../src/domain/runState.js";
import { RunEvent } from "../../src/domain/runEvent.js";
import {
  makeRun,
  makePlan,
  makeArtifact,
  makeTaskBundle,
  makeExecutionReport,
  makeReview,
  makeRemediation,
  makePlanReview,
  buildFullDeps,
} from "./testHelpers.js";
import type { Plan } from "../../src/schemas/plan.js";

describe("OrchestratorService.answerQuestions -- guard clauses and iteration branch", () => {
  it("throws when no Plan artifact exists for the run", async () => {
    const run = makeRun({ state: RunState.HumanClarificationNeeded });
    const built = buildFullDeps({ run, artifacts: [] });
    const svc = new OrchestratorService(built.deps as never);

    await expect(
      svc.answerQuestions("run-1", [{ questionId: "q1", answer: "yes" }]),
    ).rejects.toThrow("No plan artifact found for run run-1");
  });

  it("throws when no TaskBundle artifact exists for the run (after CLARIFICATION_PROVIDED)", async () => {
    const run = makeRun({ state: RunState.HumanClarificationNeeded });
    const plan = makePlan({
      openQuestions: [{ id: "q1", question: "Scope?", requiredForExecution: true }],
    });
    const built = buildFullDeps({
      run,
      artifacts: [makeArtifact({ type: "Plan", version: 1, payloadJson: plan })],
    });
    const svc = new OrchestratorService(built.deps as never);

    await expect(
      svc.answerQuestions("run-1", [{ questionId: "q1", answer: "yes" }]),
    ).rejects.toThrow("No TaskBundle artifact found for run run-1");
  });

  it("when the re-plan is still blocked but under MAX_CLARIFICATION_ITERATIONS: returns to HumanClarificationNeeded with an incremented iteration count", async () => {
    const run = makeRun({ state: RunState.HumanClarificationNeeded, planVersion: 1 });
    const plan = makePlan({
      planVersion: 1,
      openQuestions: [{ id: "q1", question: "Which provider?", requiredForExecution: true }],
    });
    const taskBundle = makeTaskBundle();
    const built = buildFullDeps({
      run,
      artifacts: [
        makeArtifact({ type: "Plan", version: 1, payloadJson: plan }),
        makeArtifact({ type: "TaskBundle", version: 1, payloadJson: taskBundle }),
      ],
    });
    const stillBlockedPlan = makePlan({
      planVersion: 2,
      openQuestions: [{ id: "q1", question: "Still which provider?", requiredForExecution: true }],
    });
    built.plannerAgent.run.mockResolvedValue(stillBlockedPlan);
    // One prior NEEDS_HUMAN_CLARIFICATION event -> clarificationCount=1, under MAX=3.
    built.eventRepo.findByRunId.mockResolvedValue([
      {
        id: "e1",
        runId: "run-1",
        eventType: RunEvent.NEEDS_HUMAN_CLARIFICATION,
        source: "planner-agent",
        payloadJson: {},
        createdAt: new Date(),
      },
    ]);

    const svc = new OrchestratorService(built.deps as never);
    const result = await svc.answerQuestions("run-1", [{ questionId: "q1", answer: "still unsure" }]);

    expect(result.state).toBe(RunState.HumanClarificationNeeded);
    const finalEvent = built.eventRepo.create.mock.calls.find(
      (c: unknown[]) => (c[0] as { eventType: string }).eventType === RunEvent.NEEDS_HUMAN_CLARIFICATION,
    );
    expect(
      (finalEvent![0] as { payloadJson: Record<string, unknown> }).payloadJson,
    ).toMatchObject({ iteration: 2 });
    expect(built.planReviewerAgent.run).not.toHaveBeenCalled();
  });
});

describe("OrchestratorService.rejectPlan -- mode branches and full iterate-context injection", () => {
  it("'fresh' mode: does not load prior iterate context (no previousPlan/humanAnswers/researchedAnswers/planReviewFindings passed)", async () => {
    const run = makeRun({ state: RunState.AwaitingPlanApproval, planVersion: 2 });
    const built = buildFullDeps({
      run,
      artifacts: [makeArtifact({ type: "Plan", version: 2, payloadJson: makePlan({ planVersion: 2 }) })],
    });
    built.plannerAgent.run.mockResolvedValue(makePlan({ planVersion: 3, openQuestions: [] }));
    built.planReviewerAgent.run.mockImplementation(async () => {
      const r = makePlanReview({ overallVerdict: "approved" });
      await built.artifactRepo.create({ runId: "run-1", type: "PlanReview", version: 1, payloadJson: r, rawText: "{}" });
      return r;
    });

    const svc = new OrchestratorService(built.deps as never);
    await svc.rejectPlan("run-1", "feedback text", "api", "fresh");

    expect(built.plannerAgent.run).toHaveBeenCalledWith(
      expect.anything(),
      "run-1",
      expect.not.objectContaining({
        previousPlan: expect.anything(),
        humanAnswers: expect.anything(),
        researchedAnswers: expect.anything(),
        planReviewFindings: expect.anything(),
      }),
    );
  });

  it("'iterate' mode: injects previousPlan, humanAnswers, researchedAnswers, and planReviewFindings from prior artifacts", async () => {
    const run = makeRun({ state: RunState.AwaitingPlanApproval, planVersion: 2 });
    const previousPlan = makePlan({ planVersion: 2 });
    const humanAnswersPayload = { answers: [{ questionId: "q1", answer: "yes" }] };
    const researchedAnswersPayload = {
      summary: "Researched",
      answers: [
        { questionId: "q2", question: "Which db?", answer: "Postgres", confidence: "high" as const },
      ],
      completedAt: new Date().toISOString(),
    };
    const planReviewPayload = {
      summary: "Needs work",
      findings: [{ id: "f1", severity: "important", title: "t", details: "d" }],
    };
    const built = buildFullDeps({
      run,
      artifacts: [
        makeArtifact({ type: "Plan", version: 2, payloadJson: previousPlan }),
        makeArtifact({ type: "HumanAnswers", version: 1, payloadJson: humanAnswersPayload }),
        makeArtifact({ type: "ResearchedAnswers", version: 1, payloadJson: researchedAnswersPayload }),
        makeArtifact({ type: "PlanReview", version: 1, payloadJson: planReviewPayload }),
      ],
    });
    built.plannerAgent.run.mockResolvedValue(makePlan({ planVersion: 3, openQuestions: [] }));
    built.planReviewerAgent.run.mockImplementation(async () => {
      const r = makePlanReview({ overallVerdict: "approved" });
      await built.artifactRepo.create({ runId: "run-1", type: "PlanReview", version: 2, payloadJson: r, rawText: "{}" });
      return r;
    });

    const svc = new OrchestratorService(built.deps as never);
    await svc.rejectPlan("run-1", "feedback text", "api", "iterate");

    expect(built.plannerAgent.run).toHaveBeenCalledWith(
      expect.anything(),
      "run-1",
      expect.objectContaining({
        previousPlan,
        humanAnswers: humanAnswersPayload.answers,
        researchedAnswers: researchedAnswersPayload.answers,
        planReviewFindings: { summary: planReviewPayload.summary, findings: planReviewPayload.findings },
      }),
    );
  });

  it("pauses for human clarification again when the re-plan after rejection still has blocking questions", async () => {
    const run = makeRun({ state: RunState.AwaitingPlanApproval, planVersion: 1 });
    const built = buildFullDeps({
      run,
      artifacts: [makeArtifact({ type: "Plan", version: 1, payloadJson: makePlan({ planVersion: 1 }) })],
    });
    built.plannerAgent.run.mockResolvedValue(
      makePlan({
        planVersion: 2,
        openQuestions: [{ id: "q1", question: "Scope?", requiredForExecution: true }],
      }),
    );

    const svc = new OrchestratorService(built.deps as never);
    const result = await svc.rejectPlan("run-1", "feedback", "api", "iterate");

    expect(result.state).toBe(RunState.HumanClarificationNeeded);
    expect(built.planReviewerAgent.run).not.toHaveBeenCalled();
  });
});

describe("OrchestratorService.runRemediation -- the markReady success path", () => {
  it("returns the final run (state ReadyForHumanReview) when markReady's own checks happen to pass", async () => {
    // Simulate the (narrow) real-world case where some other process already
    // re-approved the review before remediation ran its course: the latest
    // Review is "approved" with no blocker findings and the latest
    // ExecutionReport is green, so markReady succeeds and runRemediation
    // returns normally (the uncaught-rejection path exercised elsewhere in
    // orchestratorService.remediation.test.ts does NOT apply here).
    const run = makeRun({ state: RunState.AddressingReview, branchName: "ai/run-1", prNumber: 10 });
    const changesRequestedReview = makeReview({
      overallVerdict: "changes_requested",
      findings: [{ id: "f1", severity: "blocker", type: "bug", file: "a.ts", title: "t", details: "d" }],
    });
    const built = buildFullDeps({
      run,
      artifacts: [
        makeArtifact({ type: "Review", version: 1, payloadJson: changesRequestedReview }),
        makeArtifact({ type: "ExecutionReport", version: 1, payloadJson: makeExecutionReport() }),
      ],
    });
    built.remediationAgent.run.mockImplementation(async () => {
      const remediation = makeRemediation({
        executionReport: makeExecutionReport({ executionVersion: 2 }),
      });
      // The remediation pass is immediately followed by a fresh, approved
      // Review (e.g. an automated re-review) -- a newer artifact version so
      // findLatestByType("Review") picks it up ahead of markReady's check.
      await built.artifactRepo.create({
        runId: "run-1",
        type: "Review",
        version: 2,
        payloadJson: makeReview({ overallVerdict: "approved", findings: [] }),
        rawText: "{}",
      });
      return remediation;
    });

    const svc = new OrchestratorService(built.deps as never);
    const result = await svc.runRemediation("run-1");

    expect(result.state).toBe(RunState.ReadyForHumanReview);
    expect(built.linearClient.postComment).toHaveBeenCalledWith(
      run.linearIssueId,
      "AI workflow complete. Issue marked as **Ready for Human Review**.",
    );
  });
});

describe("OrchestratorService.buildTaskBundle -- default branch resolution from GitHub", () => {
  it("uses the remote default branch (and logs a warning) when it differs from the repo config", async () => {
    const run = makeRun({ state: RunState.PlanReview, planVersion: 1 });
    const plan = makePlan({ planVersion: 1 });
    const built = buildFullDeps({
      run,
      artifacts: [makeArtifact({ type: "Plan", version: 1, payloadJson: plan })],
    });
    built.githubClient.getDefaultBranch.mockResolvedValue("trunk");
    built.planReviewerAgent.run.mockResolvedValue(makePlanReview({ overallVerdict: "approved" }));

    const svc = new OrchestratorService(built.deps as never);
    await svc.runPlanReview("run-1");

    expect(built.logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ config: "main", remote: "trunk" }),
      "Config defaultBranch differs from GitHub, using remote value",
    );
    expect(built.planReviewerAgent.run).toHaveBeenCalledWith(
      plan,
      expect.objectContaining({ repo: expect.objectContaining({ defaultBranch: "trunk" }) }),
      "run-1",
    );
  });

  it("falls back to the config default branch (and logs a warning) when GitHub lookup fails", async () => {
    const run = makeRun({ state: RunState.PlanReview, planVersion: 1 });
    const plan = makePlan({ planVersion: 1 });
    const built = buildFullDeps({
      run,
      artifacts: [makeArtifact({ type: "Plan", version: 1, payloadJson: plan })],
    });
    built.githubClient.getDefaultBranch.mockRejectedValue(new Error("network down"));
    built.planReviewerAgent.run.mockResolvedValue(makePlanReview({ overallVerdict: "approved" }));

    const svc = new OrchestratorService(built.deps as never);
    await svc.runPlanReview("run-1");

    expect(built.logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ repo: "test-repo", error: "network down" }),
      "Failed to resolve default branch from GitHub, falling back to config value",
    );
    expect(built.planReviewerAgent.run).toHaveBeenCalledWith(
      plan,
      expect.objectContaining({ repo: expect.objectContaining({ defaultBranch: "main" }) }),
      "run-1",
    );
  });
});

describe("OrchestratorService -- execution report comment formatting via runExecution", () => {
  function setupExecutionDeps(report: ReturnType<typeof makeExecutionReport>) {
    const run = makeRun({
      state: RunState.Implementing,
      approvedPlanVersion: 1,
      branchName: "ai/run-1",
    });
    const plan = makePlan({ planVersion: 1 });
    const built = buildFullDeps({
      run,
      artifacts: [makeArtifact({ type: "Plan", version: 1, payloadJson: plan })],
    });
    built.executorAgent.run.mockImplementation(async () => {
      await built.artifactRepo.create({
        runId: "run-1",
        type: "ExecutionReport",
        version: report.executionVersion,
        payloadJson: report,
        rawText: "{}",
      });
      return { report, prNumber: 1 };
    });
    built.reviewerAgent.run.mockImplementation(async () => {
      const review = makeReview({ overallVerdict: "approved" });
      await built.artifactRepo.create({
        runId: "run-1",
        type: "Review",
        version: 1,
        payloadJson: review,
        rawText: "{}",
      });
      return review;
    });
    return built;
  }

  it("omits the 'Files changed' section entirely when filesChanged is empty", async () => {
    const built = setupExecutionDeps(makeExecutionReport({ filesChanged: [] }));
    const svc = new OrchestratorService(built.deps as never);
    await svc.runExecution("run-1");

    const comment = built.linearClient.postComment.mock.calls.find((c: unknown[]) =>
      (c[1] as string).includes("Execution Report"),
    )?.[1] as string;
    expect(comment).not.toContain("Files changed");
  });

  it("collapses the file list inside a <details> block when there are more than 8 files changed", async () => {
    const manyFiles = Array.from({ length: 9 }, (_, i) => `src/file${i}.ts`);
    const built = setupExecutionDeps(makeExecutionReport({ filesChanged: manyFiles }));
    const svc = new OrchestratorService(built.deps as never);
    await svc.runExecution("run-1");

    const comment = built.linearClient.postComment.mock.calls.find((c: unknown[]) =>
      (c[1] as string).includes("Execution Report"),
    )?.[1] as string;
    expect(comment).toContain("<details>");
    expect(comment).toContain("Files changed (9)");
    expect(comment).toContain("</details>");
  });

  it("lists files inline (no <details>) when there are 8 or fewer files changed", async () => {
    const files = Array.from({ length: 8 }, (_, i) => `src/file${i}.ts`);
    const built = setupExecutionDeps(makeExecutionReport({ filesChanged: files }));
    const svc = new OrchestratorService(built.deps as never);
    await svc.runExecution("run-1");

    const comment = built.linearClient.postComment.mock.calls.find((c: unknown[]) =>
      (c[1] as string).includes("Execution Report"),
    )?.[1] as string;
    expect(comment).not.toContain("<details>");
    expect(comment).toContain("Files changed (8)");
  });

  it("includes a Notes section only when notes are present", async () => {
    const withNotes = setupExecutionDeps(makeExecutionReport({ notes: ["Watch out for X"] }));
    const svc1 = new OrchestratorService(withNotes.deps as never);
    await svc1.runExecution("run-1");
    const commentWithNotes = withNotes.linearClient.postComment.mock.calls.find((c: unknown[]) =>
      (c[1] as string).includes("Execution Report"),
    )?.[1] as string;
    expect(commentWithNotes).toContain("### Notes");
    expect(commentWithNotes).toContain("Watch out for X");

    const withoutNotes = setupExecutionDeps(makeExecutionReport({ notes: [] }));
    const svc2 = new OrchestratorService(withoutNotes.deps as never);
    await svc2.runExecution("run-1");
    const commentNoNotes = withoutNotes.linearClient.postComment.mock.calls.find((c: unknown[]) =>
      (c[1] as string).includes("Execution Report"),
    )?.[1] as string;
    expect(commentNoNotes).not.toContain("### Notes");
  });
});

describe("OrchestratorService -- formatPlanComment via runPlanReview's approved-comment path", () => {
  it("includes an 'Open Questions' section with a per-question blocks-execution marker, and a Risks section, when present", async () => {
    // formatPlanComment renders `*blocks execution*` per-question based on
    // each OpenQuestion's own `requiredForExecution` flag; this is distinct
    // from startRun's separate "any required question blocks the whole run"
    // check, so we exercise formatPlanComment directly via runPlanReview
    // (which always reaches it on an approved verdict) rather than through
    // startRun's blocking-question short-circuit.
    const run = makeRun({ state: RunState.PlanReview });
    const plan: Plan = makePlan({
      planVersion: 1,
      openQuestions: [
        { id: "q1", question: "Non-blocking one?", requiredForExecution: false },
        { id: "q2", question: "Blocking one?", requiredForExecution: true },
      ],
      risks: ["Might break prod"],
    });
    const built = buildFullDeps({
      run,
      artifacts: [makeArtifact({ type: "Plan", version: 1, payloadJson: plan })],
    });
    built.planReviewerAgent.run.mockResolvedValue(makePlanReview({ overallVerdict: "approved" }));

    const svc = new OrchestratorService(built.deps as never);
    await svc.runPlanReview("run-1");

    const planComment = built.linearClient.postComment.mock.calls.find((c: unknown[]) =>
      (c[1] as string).includes("AI Plan"),
    )?.[1] as string;
    expect(planComment).toBeDefined();
    expect(planComment).toContain("**Open Questions:**");
    expect(planComment).toContain("Blocking one? *blocks execution*");
    expect(planComment).toContain("Non-blocking one?");
    expect(planComment).not.toContain("Non-blocking one? *blocks execution*");
    expect(planComment).toContain("**Risks:**");
    expect(planComment).toContain("Might break prod");
  });
});

describe("OrchestratorService.retrieveSkillsForPlanning -- SKILL_INJECTION event emission", () => {
  it("records a SKILL_INJECTION event when the skill repo returns relevant skills", async () => {
    const run = makeRun({ state: RunState.Todo, linearIssueTitle: "Add dark mode" });
    const built = buildFullDeps({
      run,
      overrides: {
        agentSkillRepo: {
          findTopKByRelevance: vi.fn().mockResolvedValue([
            { id: "skill-1", repoSlug: "test-repo", name: "Dark mode", description: null, taskCategory: "ui", skillMarkdown: "# tips", utilityScore: 0.8, lastUsedAt: new Date() },
          ]),
          incrementSuccess: vi.fn(),
          incrementFailure: vi.fn(),
          archiveIfLowUtility: vi.fn(),
        },
      },
    });
    built.runRepo.findActiveByIssueId.mockResolvedValue(null);
    built.runRepo.create.mockResolvedValue(run);
    const plan = makePlan({ openQuestions: [] });
    built.plannerAgent.run.mockImplementation(async () => {
      await built.artifactRepo.create({
        runId: "run-1",
        type: "Plan",
        version: plan.planVersion,
        payloadJson: plan,
        rawText: "{}",
      });
      return plan;
    });
    built.planReviewerAgent.run.mockResolvedValue(makePlanReview({ overallVerdict: "approved" }));

    const svc = new OrchestratorService(built.deps as never);
    await svc.startRun("LIN-1");

    const injectionEvent = built.eventRepo.create.mock.calls.find(
      (c: unknown[]) => (c[0] as { eventType: string }).eventType === "SKILL_INJECTION",
    );
    expect(injectionEvent).toBeDefined();
    expect(
      (injectionEvent![0] as { payloadJson: { skillIds: string[] } }).payloadJson.skillIds,
    ).toEqual(["skill-1"]);
  });
});

describe("OrchestratorService.updateSkillMetrics -- failure path and per-skill error handling", () => {
  it("calls incrementFailure (not incrementSuccess) when the run ends as Failed", async () => {
    const run = makeRun({ state: RunState.HumanClarificationNeeded, planVersion: 1 });
    const plan = makePlan({
      openQuestions: [{ id: "q1", question: "Scope?", requiredForExecution: true }],
    });
    const taskBundle = makeTaskBundle();
    const agentSkillRepo = {
      findTopKByRelevance: vi.fn().mockResolvedValue([]),
      incrementSuccess: vi.fn(),
      incrementFailure: vi.fn().mockResolvedValue({ id: "skill-1" }),
      archiveIfLowUtility: vi.fn(),
    };
    const built = buildFullDeps({
      run,
      artifacts: [
        makeArtifact({ type: "Plan", version: 1, payloadJson: plan }),
        makeArtifact({ type: "TaskBundle", version: 1, payloadJson: taskBundle }),
      ],
      overrides: { agentSkillRepo },
    });
    built.plannerAgent.run.mockResolvedValue(
      makePlan({ planVersion: 2, openQuestions: [{ id: "q1", question: "Still?", requiredForExecution: true }] }),
    );
    // 3 prior NEEDS_HUMAN_CLARIFICATION events -> at MAX, run fails. Also
    // seed a SKILL_INJECTION event so updateSkillMetrics has work to do.
    built.eventRepo.findByRunId.mockResolvedValue([
      { id: "e1", runId: "run-1", eventType: RunEvent.NEEDS_HUMAN_CLARIFICATION, source: "planner-agent", payloadJson: {}, createdAt: new Date() },
      { id: "e2", runId: "run-1", eventType: RunEvent.NEEDS_HUMAN_CLARIFICATION, source: "planner-agent", payloadJson: {}, createdAt: new Date() },
      { id: "e3", runId: "run-1", eventType: RunEvent.NEEDS_HUMAN_CLARIFICATION, source: "planner-agent", payloadJson: {}, createdAt: new Date() },
      { id: "e4", runId: "run-1", eventType: "SKILL_INJECTION", source: "orchestrator", payloadJson: { skillIds: ["skill-1"] }, createdAt: new Date() },
    ]);

    const svc = new OrchestratorService(built.deps as never);
    const result = await svc.answerQuestions("run-1", [{ questionId: "q1", answer: "still unsure" }]);

    expect(result.state).toBe(RunState.Failed);
    expect(agentSkillRepo.incrementFailure).toHaveBeenCalledWith("skill-1");
    expect(agentSkillRepo.incrementSuccess).not.toHaveBeenCalled();
    expect(agentSkillRepo.archiveIfLowUtility).toHaveBeenCalledWith({ id: "skill-1" });
  });

  it("logs a warning and continues when updating a skill's metric throws", async () => {
    const run = makeRun({ state: RunState.ReadyForHumanReview });
    const agentSkillRepo = {
      findTopKByRelevance: vi.fn().mockResolvedValue([]),
      incrementSuccess: vi.fn().mockRejectedValue(new Error("db down")),
      incrementFailure: vi.fn(),
      archiveIfLowUtility: vi.fn(),
    };
    const built = buildFullDeps({ run, overrides: { agentSkillRepo } });
    built.eventRepo.findByRunId.mockResolvedValue([
      { id: "e1", runId: "run-1", eventType: "SKILL_INJECTION", source: "orchestrator", payloadJson: { skillIds: ["skill-1"] }, createdAt: new Date() },
    ]);

    const svc = new OrchestratorService(built.deps as never);
    const result = await svc.approveHumanReview("run-1");

    expect(result.state).toBe(RunState.Done);
    expect(built.logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ runId: "run-1", skillId: "skill-1", error: "db down" }),
      "Failed to update skill metric",
    );
    expect(agentSkillRepo.archiveIfLowUtility).not.toHaveBeenCalled();
  });

  it("deduplicates skill IDs across multiple SKILL_INJECTION events before updating metrics", async () => {
    const run = makeRun({ state: RunState.ReadyForHumanReview });
    const agentSkillRepo = {
      findTopKByRelevance: vi.fn().mockResolvedValue([]),
      incrementSuccess: vi.fn().mockResolvedValue({ id: "skill-1" }),
      incrementFailure: vi.fn(),
      archiveIfLowUtility: vi.fn(),
    };
    const built = buildFullDeps({ run, overrides: { agentSkillRepo } });
    built.eventRepo.findByRunId.mockResolvedValue([
      { id: "e1", runId: "run-1", eventType: "SKILL_INJECTION", source: "orchestrator", payloadJson: { skillIds: ["skill-1"] }, createdAt: new Date() },
      { id: "e2", runId: "run-1", eventType: "SKILL_INJECTION", source: "orchestrator", payloadJson: { skillIds: ["skill-1", "skill-2"] }, createdAt: new Date() },
    ]);
    agentSkillRepo.incrementSuccess.mockImplementation((id: string) => Promise.resolve({ id }));

    const svc = new OrchestratorService(built.deps as never);
    await svc.approveHumanReview("run-1");

    expect(agentSkillRepo.incrementSuccess).toHaveBeenCalledTimes(2);
    expect(agentSkillRepo.incrementSuccess).toHaveBeenCalledWith("skill-1");
    expect(agentSkillRepo.incrementSuccess).toHaveBeenCalledWith("skill-2");
  });
});

describe("OrchestratorService.runPlanning -- full prior-context injection", () => {
  it("passes rejectionContext (humanFeedback), humanAnswers, researchedAnswers, AND planReviewFindings together when all four prior artifacts exist", async () => {
    const run = makeRun({ state: RunState.Planning, planVersion: 3 });
    const previousPlan = makePlan({ planVersion: 3 });
    const rejectionPayload = {
      planVersion: 3,
      feedback: "Please simplify",
      source: "api" as const,
      mode: "iterate" as const,
    };
    const humanAnswersPayload = { answers: [{ questionId: "q1", answer: "yes" }] };
    const researchedAnswersPayload = {
      summary: "done",
      answers: [
        { questionId: "q2", question: "DB?", answer: "Postgres", confidence: "high" as const },
      ],
      completedAt: new Date().toISOString(),
    };
    const planReviewPayload = {
      summary: "Needs tightening",
      findings: [{ id: "f1", severity: "important", title: "t", details: "d" }],
    };
    const built = buildFullDeps({
      run,
      artifacts: [
        makeArtifact({ type: "Plan", version: 3, payloadJson: previousPlan }),
        makeArtifact({ type: "RejectionContext", version: 3, payloadJson: rejectionPayload }),
        makeArtifact({ type: "HumanAnswers", version: 1, payloadJson: humanAnswersPayload }),
        makeArtifact({ type: "ResearchedAnswers", version: 1, payloadJson: researchedAnswersPayload }),
        makeArtifact({ type: "PlanReview", version: 1, payloadJson: planReviewPayload }),
      ],
    });
    built.plannerAgent.run.mockResolvedValue(makePlan({ planVersion: 4, openQuestions: [] }));
    built.planReviewerAgent.run.mockResolvedValue(makePlanReview({ overallVerdict: "approved" }));

    const svc = new OrchestratorService(built.deps as never);
    await svc.runPlanning("run-1");

    expect(built.plannerAgent.run).toHaveBeenCalledWith(
      expect.anything(),
      "run-1",
      expect.objectContaining({
        planVersionOverride: 4,
        previousPlan,
        humanFeedback: { planVersion: 3, feedback: "Please simplify" },
        humanAnswers: humanAnswersPayload.answers,
        researchedAnswers: researchedAnswersPayload.answers,
        planReviewFindings: { summary: planReviewPayload.summary, findings: planReviewPayload.findings },
      }),
    );
  });
});

describe("OrchestratorService -- maybeResearchAndReplan forwards prior human answers", () => {
  it("includes humanAnswers in both the answer-researcher call and the follow-up planner call when a HumanAnswers artifact already exists", async () => {
    const run = makeRun({ state: RunState.Todo, branchName: "ai/run-1", planVersion: 1 });
    const humanAnswersPayload = { answers: [{ questionId: "q0", answer: "already answered" }] };
    const built = buildFullDeps({
      run,
      artifacts: [makeArtifact({ type: "HumanAnswers", version: 1, payloadJson: humanAnswersPayload })],
      overrides: {
        answerResearcherAgent: { run: vi.fn() },
      },
    });

    const planWithQuestions = makePlan({
      planVersion: 2,
      openQuestions: [{ id: "q1", question: "Which provider?", requiredForExecution: false }],
    });
    const revisedPlan = makePlan({ planVersion: 3, openQuestions: [] });
    built.plannerAgent.run
      .mockResolvedValueOnce(planWithQuestions)
      .mockImplementationOnce(async () => {
        await built.artifactRepo.create({
          runId: "run-1",
          type: "Plan",
          version: revisedPlan.planVersion,
          payloadJson: revisedPlan,
          rawText: "{}",
        });
        return revisedPlan;
      });
    (built.deps.answerResearcherAgent as { run: ReturnType<typeof vi.fn> }).run.mockResolvedValue({
      summary: "Researched",
      answers: [
        { questionId: "q1", question: "Which provider?", answer: "AWS", confidence: "high" as const },
      ],
      completedAt: new Date().toISOString(),
    });
    built.planReviewerAgent.run.mockResolvedValue(makePlanReview({ overallVerdict: "approved" }));

    const svc = new OrchestratorService(built.deps as never);
    await svc.retryRun("run-1");

    expect(
      (built.deps.answerResearcherAgent as { run: ReturnType<typeof vi.fn> }).run,
    ).toHaveBeenCalledWith(
      planWithQuestions,
      expect.anything(),
      "run-1",
      expect.objectContaining({ humanAnswers: humanAnswersPayload.answers }),
    );

    // Second plannerAgent.run call (inside maybeResearchAndReplan) should also
    // carry the prior human answers alongside the fresh researchedAnswers.
    expect(built.plannerAgent.run).toHaveBeenNthCalledWith(
      2,
      expect.anything(),
      "run-1",
      expect.objectContaining({
        humanAnswers: humanAnswersPayload.answers,
        researchedAnswers: [
          { questionId: "q1", question: "Which provider?", answer: "AWS", confidence: "high" },
        ],
      }),
    );
  });
});
