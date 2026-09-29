import { describe, it, expect } from "vitest";
import { OrchestratorService } from "../../src/orchestrator/orchestratorService.js";
import { RunState } from "../../src/domain/runState.js";
import { RunEvent } from "../../src/domain/runEvent.js";
import {
  buildStorefulDeps,
  makeRun,
  makePlan,
  makePlanReview,
  stubPlanner,
  stubPlanReviser,
} from "./helpers/testKit.js";

describe("OrchestratorService -- buildTaskBundle edge cases (via runPlanReview)", () => {
  it("uses the remote default branch and logs a warning when it differs from config, and forwards openQuestions/risks into the approval comment", async () => {
    const run = makeRun({ id: "run-1", state: RunState.PlanReview, planVersion: 1 });
    const h = buildStorefulDeps(run);
    await h.artifactRepo.create({
      runId: "run-1",
      type: "Plan",
      version: 1,
      payloadJson: makePlan({
        planVersion: 1,
        openQuestions: [{ id: "q1", question: "Nice to know?", requiredForExecution: false }],
        risks: ["Might need a migration."],
      }),
    });
    h.githubClient.getDefaultBranch.mockResolvedValue("develop");
    h.planReviewerAgent.run.mockResolvedValue(makePlanReview({ overallVerdict: "approved" }));

    const svc = new OrchestratorService(h.deps as never);
    await svc.runPlanReview("run-1");

    expect(h.logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ repo: "test-repo", config: "main", remote: "develop" }),
      "Config defaultBranch differs from GitHub, using remote value",
    );
    const comment = h.linearClient.postComment.mock.calls.find(
      (c: unknown[]) => typeof c[1] === "string" && (c[1] as string).includes("AI Plan"),
    )?.[1] as string;
    expect(comment).toContain("Open Questions:");
    expect(comment).toContain("Nice to know?");
    expect(comment).toContain("Risks:");
    expect(comment).toContain("Might need a migration.");
  });

  it("falls back to the config default branch and logs a warning (Error) when getDefaultBranch rejects with an Error", async () => {
    const run = makeRun({ id: "run-1", state: RunState.PlanReview, planVersion: 1 });
    const h = buildStorefulDeps(run);
    await h.artifactRepo.create({
      runId: "run-1",
      type: "Plan",
      version: 1,
      payloadJson: makePlan({ planVersion: 1 }),
    });
    h.githubClient.getDefaultBranch.mockRejectedValue(new Error("GitHub API down"));
    h.planReviewerAgent.run.mockResolvedValue(makePlanReview({ overallVerdict: "approved" }));

    const svc = new OrchestratorService(h.deps as never);
    await svc.runPlanReview("run-1");

    expect(h.logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ repo: "test-repo", error: "GitHub API down" }),
      "Failed to resolve default branch from GitHub, falling back to config value",
    );
  });

  it("falls back to the config default branch and stringifies a non-Error rejection from getDefaultBranch", async () => {
    const run = makeRun({ id: "run-1", state: RunState.PlanReview, planVersion: 1 });
    const h = buildStorefulDeps(run);
    await h.artifactRepo.create({
      runId: "run-1",
      type: "Plan",
      version: 1,
      payloadJson: makePlan({ planVersion: 1 }),
    });
    h.githubClient.getDefaultBranch.mockRejectedValue("rate limited");
    h.planReviewerAgent.run.mockResolvedValue(makePlanReview({ overallVerdict: "approved" }));

    const svc = new OrchestratorService(h.deps as never);
    await svc.runPlanReview("run-1");

    expect(h.logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ error: "rate limited" }),
      "Failed to resolve default branch from GitHub, falling back to config value",
    );
  });

  it("omits relatedContext and stringifies a non-Error rejection from getRelatedContext", async () => {
    const run = makeRun({ id: "run-1", state: RunState.PlanReview, planVersion: 1 });
    const h = buildStorefulDeps(run);
    await h.artifactRepo.create({
      runId: "run-1",
      type: "Plan",
      version: 1,
      payloadJson: makePlan({ planVersion: 1 }),
    });
    h.linearClient.getRelatedContext.mockRejectedValue("linear unreachable");
    h.planReviewerAgent.run.mockResolvedValue(makePlanReview({ overallVerdict: "approved" }));

    const svc = new OrchestratorService(h.deps as never);
    await svc.runPlanReview("run-1");

    expect(h.logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ issueId: "LIN-1", error: "linear unreachable" }),
      "Failed to fetch related Linear context; proceeding without it",
    );
  });
});

describe("OrchestratorService -- formatPlanReviewComment / formatCodeReviewComment finding details", () => {
  it("renders the (step N) suffix for findings with an affectedStepId and omits it for findings without one", async () => {
    const run = makeRun({ id: "run-1", state: RunState.PlanReview, planVersion: 1 });
    const h = buildStorefulDeps(run);
    await h.artifactRepo.create({
      runId: "run-1",
      type: "Plan",
      version: 1,
      payloadJson: makePlan({ planVersion: 1 }),
    });
    h.planReviewerAgent.run.mockResolvedValue(
      makePlanReview({
        overallVerdict: "changes_requested",
        findings: [
          {
            id: "f1",
            severity: "important",
            type: "gap",
            title: "Missing validation",
            details: "Add input validation",
            affectedStepId: "s1",
          },
          {
            id: "f2",
            severity: "nit",
            type: "style",
            title: "Naming nit",
            details: "Rename variable",
          },
        ],
      }),
    );
    stubPlanReviser(h, makePlan({ planVersion: 2 }), {
      originalPlanVersion: 1,
      revisedPlanVersion: 2,
      reviewId: "plan-review-1",
      dispositions: [],
    });

    const svc = new OrchestratorService(h.deps as never);
    await svc.runPlanReview("run-1");

    const comment = h.linearClient.postComment.mock.calls.find(
      (c: unknown[]) => typeof c[1] === "string" && (c[1] as string).includes("AI Plan Review"),
    )?.[1] as string;
    expect(comment).toContain("(step s1)");
    expect(comment).toContain("Naming nit");
    expect(comment).not.toContain("(step undefined)");
  });

  it("renders the :lineHint suffix for review findings with a lineHint and omits it for findings without one", async () => {
    const run = makeRun({ id: "run-1", state: RunState.AIReview, prNumber: 7 });
    const h = buildStorefulDeps(run);
    await h.artifactRepo.create({
      runId: "run-1",
      type: "Plan",
      version: 1,
      payloadJson: makePlan({ planVersion: 1 }),
    });
    await h.artifactRepo.create({
      runId: "run-1",
      type: "ExecutionReport",
      version: 1,
      payloadJson: {
        executionVersion: 1,
        summary: "x",
        filesChanged: [],
        checks: {
          lint: { status: "pass", details: "ok" },
          typecheck: { status: "pass", details: "ok" },
          tests: { status: "pass", details: "ok" },
        },
        notes: [],
        prDraftCreated: true,
        score: 0.9,
        scoreRationale: "ok",
      },
    });
    h.reviewerAgent.run.mockResolvedValue({
      reviewId: "rev-1",
      summary: "found stuff",
      overallVerdict: "changes_requested",
      findings: [
        {
          id: "f1",
          severity: "important",
          type: "bug",
          file: "src/a.ts",
          lineHint: 42,
          title: "Off by one",
          details: "Check bounds",
        },
        {
          id: "f2",
          severity: "nit",
          type: "style",
          file: "src/b.ts",
          title: "No line hint",
          details: "Cosmetic",
        },
      ],
    });
    h.remediationAgent.run.mockRejectedValue(new Error("stop before remediation"));

    const svc = new OrchestratorService(h.deps as never);
    await expect(svc.runReview("run-1")).rejects.toThrow("stop before remediation");

    const comment = h.linearClient.postComment.mock.calls.find(
      (c: unknown[]) => typeof c[1] === "string" && (c[1] as string).includes("AI Code Review"),
    )?.[1] as string;
    expect(comment).toContain("src/a.ts:42");
    expect(comment).toContain("src/b.ts)");
    expect(comment).not.toContain("src/b.ts:undefined");
  });
});

describe("OrchestratorService.rejectPlan -- mode handling", () => {
  it("mode='fresh' skips loading prior plan/answers/review context", async () => {
    const run = makeRun({ id: "run-1", state: RunState.AwaitingPlanApproval, planVersion: 1 });
    const h = buildStorefulDeps(run);
    await h.artifactRepo.create({
      runId: "run-1",
      type: "Plan",
      version: 1,
      payloadJson: makePlan({ planVersion: 1 }),
    });
    await h.artifactRepo.create({
      runId: "run-1",
      type: "HumanAnswers",
      version: 1,
      payloadJson: { answers: [{ questionId: "q1", answer: "yes" }] },
    });

    stubPlanner(h, makePlan({ planVersion: 2, openQuestions: [] }));
    h.planReviewerAgent.run.mockResolvedValue(makePlanReview({ overallVerdict: "approved" }));

    const svc = new OrchestratorService(h.deps as never);
    await svc.rejectPlan("run-1", "start over", "api", "fresh");

    expect(h.plannerAgent.run).toHaveBeenCalledWith(
      expect.anything(),
      "run-1",
      expect.not.objectContaining({
        previousPlan: expect.anything(),
        humanAnswers: expect.anything(),
      }),
    );
  });

  it("mode='iterate' (default) forwards the previous plan, human answers, researched answers, and plan review findings", async () => {
    const run = makeRun({ id: "run-1", state: RunState.AwaitingPlanApproval, planVersion: 1 });
    const h = buildStorefulDeps(run);
    await h.artifactRepo.create({
      runId: "run-1",
      type: "Plan",
      version: 1,
      payloadJson: makePlan({ planVersion: 1 }),
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
      payloadJson: { summary: "s", findings: [] },
    });

    stubPlanner(h, makePlan({ planVersion: 2, openQuestions: [] }));
    h.planReviewerAgent.run.mockResolvedValue(makePlanReview({ overallVerdict: "approved" }));

    const svc = new OrchestratorService(h.deps as never);
    await svc.rejectPlan("run-1", "iterate please", "api", "iterate");

    expect(h.plannerAgent.run).toHaveBeenCalledWith(
      expect.anything(),
      "run-1",
      expect.objectContaining({
        previousPlan: expect.objectContaining({ planVersion: 1 }),
        humanAnswers: [{ questionId: "q1", answer: "yes" }],
        researchedAnswers: [{ questionId: "q1", question: "Q", answer: "A", confidence: "high" }],
        planReviewFindings: { summary: "s", findings: [] },
      }),
    );
  });

  it("pauses for clarification when the re-plan after rejection still has blocking questions", async () => {
    const run = makeRun({ id: "run-1", state: RunState.AwaitingPlanApproval, planVersion: 1 });
    const h = buildStorefulDeps(run);
    await h.artifactRepo.create({
      runId: "run-1",
      type: "Plan",
      version: 1,
      payloadJson: makePlan({ planVersion: 1 }),
    });

    stubPlanner(
      h,
      makePlan({
        planVersion: 2,
        openQuestions: [{ id: "q1", question: "Still unclear?", requiredForExecution: true }],
      }),
    );

    const svc = new OrchestratorService(h.deps as never);
    const result = await svc.rejectPlan("run-1", "not sure", "api", "iterate");

    expect(result.state).toBe(RunState.HumanClarificationNeeded);
    expect(h.planReviewerAgent.run).not.toHaveBeenCalled();
  });
});

describe("OrchestratorService.answerQuestions -- additional edge cases", () => {
  it("throws when there is no Plan artifact", async () => {
    const run = makeRun({ id: "run-1", state: RunState.HumanClarificationNeeded });
    const h = buildStorefulDeps(run);
    const svc = new OrchestratorService(h.deps as never);

    await expect(
      svc.answerQuestions("run-1", [{ questionId: "q1", answer: "yes" }]),
    ).rejects.toThrow(/No plan artifact found/);
  });

  it("throws when there is no TaskBundle artifact (clarification path)", async () => {
    const run = makeRun({ id: "run-1", state: RunState.HumanClarificationNeeded });
    const h = buildStorefulDeps(run);
    await h.artifactRepo.create({
      runId: "run-1",
      type: "Plan",
      version: 1,
      payloadJson: makePlan({
        openQuestions: [{ id: "q1", question: "Required?", requiredForExecution: true }],
      }),
    });

    const svc = new OrchestratorService(h.deps as never);

    await expect(
      svc.answerQuestions("run-1", [{ questionId: "q1", answer: "yes" }]),
    ).rejects.toThrow(/No TaskBundle artifact found/);
  });

  it("loops back to HumanClarificationNeeded (not Failed) when blockers remain but the iteration count is below the max", async () => {
    const run = makeRun({ id: "run-1", state: RunState.HumanClarificationNeeded, planVersion: 1 });
    const h = buildStorefulDeps(run);
    await h.artifactRepo.create({
      runId: "run-1",
      type: "Plan",
      version: 1,
      payloadJson: makePlan({
        openQuestions: [{ id: "q1", question: "Required?", requiredForExecution: true }],
      }),
    });
    await h.artifactRepo.create({
      runId: "run-1",
      type: "TaskBundle",
      version: 1,
      payloadJson: { issue: { id: "LIN-1" } },
    });
    // Only 1 prior clarification event -- below MAX_CLARIFICATION_ITERATIONS (3).
    h.store.events.push({
      id: "evt-clar-0",
      runId: "run-1",
      eventType: RunEvent.NEEDS_HUMAN_CLARIFICATION,
      source: "planner-agent",
      payloadJson: {},
      createdAt: new Date(),
    });

    stubPlanner(
      h,
      makePlan({
        planVersion: 2,
        openQuestions: [{ id: "q1", question: "Still?", requiredForExecution: true }],
      }),
    );

    const svc = new OrchestratorService(h.deps as never);
    const result = await svc.answerQuestions("run-1", [{ questionId: "q1", answer: "still not sure" }]);

    expect(result.state).toBe(RunState.HumanClarificationNeeded);
    const lastEvent = h.store.events[h.store.events.length - 1];
    expect(lastEvent.eventType).toBe(RunEvent.NEEDS_HUMAN_CLARIFICATION);
    expect((lastEvent.payloadJson as { iteration: number }).iteration).toBe(2);
  });
});

describe("OrchestratorService.runManualPlanRevision -- no operator note", () => {
  it("revises without an operator note when none is provided and the reviewer requests changes", async () => {
    const run = makeRun({ id: "run-1", state: RunState.AwaitingPlanApproval, planVersion: 1 });
    const h = buildStorefulDeps(run);
    await h.artifactRepo.create({
      runId: "run-1",
      type: "Plan",
      version: 1,
      payloadJson: makePlan({ planVersion: 1 }),
    });
    h.planReviewerAgent.run.mockResolvedValue(
      makePlanReview({ overallVerdict: "changes_requested" }),
    );
    stubPlanReviser(h, makePlan({ planVersion: 2 }), {
      originalPlanVersion: 1,
      revisedPlanVersion: 2,
      reviewId: "plan-review-1",
      dispositions: [],
    });

    const svc = new OrchestratorService(h.deps as never);
    await svc.runManualPlanRevision("run-1");

    expect(h.planReviserAgent.run).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.anything(),
      "run-1",
      undefined,
    );
  });
});

describe("OrchestratorService.approveHumanReview -- non-Error distillation failure", () => {
  it("stringifies a non-Error thrown by distillation and still completes the run", async () => {
    const run = makeRun({ id: "run-1", state: RunState.ReadyForHumanReview });
    const h = buildStorefulDeps(run);
    h.distillationAgent.run.mockRejectedValue("disk full");

    const svc = new OrchestratorService({ ...h.deps, distillationAgent: h.distillationAgent } as never);
    const result = await svc.approveHumanReview("run-1");

    expect(result.state).toBe(RunState.Done);
    expect(h.logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ runId: "run-1", error: "disk full" }),
      "Distillation agent failed (best-effort, ignoring)",
    );
  });
});

describe("OrchestratorService -- retrieveSkillsForPlanning with missing title/description", () => {
  it("builds the relevance query from empty strings when linearIssueTitle/Description are null", async () => {
    const run = makeRun({
      id: "run-1",
      state: RunState.Todo,
      linearIssueTitle: null,
      linearIssueDescription: null,
    });
    const h = buildStorefulDeps(run);
    h.runRepo.findActiveByIssueId.mockResolvedValue(null);
    h.runRepo.create.mockImplementation((data: Partial<typeof run>) =>
      Promise.resolve({ ...run, ...data }),
    );
    stubPlanner(h, makePlan({ openQuestions: [] }));
    h.planReviewerAgent.run.mockResolvedValue(makePlanReview({ overallVerdict: "approved" }));

    const svc = new OrchestratorService({ ...h.deps, agentSkillRepo: h.agentSkillRepo } as never);
    await svc.startRun("LIN-1");

    expect(h.agentSkillRepo.findTopKByRelevance).toHaveBeenCalledWith(
      "test-repo",
      " ",
      expect.any(Number),
    );
  });
});

describe("OrchestratorService -- updateSkillMetrics with a legacy event missing skillIds", () => {
  it("treats a SKILL_INJECTION event without a skillIds array as contributing no skills", async () => {
    const run = makeRun({ id: "run-1", state: RunState.ReadyForHumanReview });
    const h = buildStorefulDeps(run);
    h.store.events.push({
      id: "evt-1",
      runId: "run-1",
      eventType: "SKILL_INJECTION",
      source: "orchestrator",
      payloadJson: {},
      createdAt: new Date(),
    });

    const svc = new OrchestratorService({ ...h.deps, agentSkillRepo: h.agentSkillRepo } as never);
    await svc.approveHumanReview("run-1");

    expect(h.agentSkillRepo.incrementSuccess).not.toHaveBeenCalled();
    expect(h.agentSkillRepo.incrementFailure).not.toHaveBeenCalled();
  });
});
