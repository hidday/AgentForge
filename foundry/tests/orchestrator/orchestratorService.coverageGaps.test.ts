import { describe, it, expect, vi } from "vitest";
import { OrchestratorService } from "../../src/orchestrator/orchestratorService.js";
import { RunState } from "../../src/domain/runState.js";
import { RunEvent } from "../../src/domain/runEvent.js";
import type { Plan } from "../../src/schemas/plan.js";
import type { PlanReview } from "../../src/schemas/planReview.js";
import type { PlanRevision } from "../../src/schemas/planRevision.js";
import type { ExecutionReport } from "../../src/schemas/executionReport.js";
import { buildDeps, makeStore, pushArtifact, mockPlannerProducesPlan } from "./helpers/fixtures.js";

function makePlan(overrides: Partial<Plan> = {}): Plan {
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
    ...overrides,
  };
}

describe("OrchestratorService simple accessors", () => {
  it("exposes each injected dependency via its getter", () => {
    const store = makeStore();
    const built = buildDeps(store);
    const agentSkillRepo = { findTopKByRelevance: vi.fn() };
    const svc = new OrchestratorService({ ...built.deps, agentSkillRepo } as never);

    expect(svc.getRunRepo()).toBe(built.deps.runRepo);
    expect(svc.getArtifactRepo()).toBe(built.deps.artifactRepo);
    expect(svc.getEventRepo()).toBe(built.deps.eventRepo);
    expect(svc.getAgentSkillRepo()).toBe(agentSkillRepo);
    expect(svc.getLinearClient()).toBe(built.deps.linearClient);
  });

  it("getAgentSkillRepo returns undefined when none was configured", () => {
    const store = makeStore();
    const built = buildDeps(store);
    const svc = new OrchestratorService(built.deps as never);

    expect(svc.getAgentSkillRepo()).toBeUndefined();
  });
});

describe("OrchestratorService.approvePlan", () => {
  it("marks the plan version approved, transitions to Implementing, and posts a plain comment (no note)", async () => {
    const store = makeStore({ state: RunState.AwaitingPlanApproval, planVersion: 2 });
    pushArtifact(store, "Plan", 2, makePlan({ planVersion: 2 }));
    const built = buildDeps(store);
    const svc = new OrchestratorService(built.deps as never);

    const result = await svc.approvePlan("run-1");

    expect(built.runRepo.update).toHaveBeenCalledWith("run-1", { approvedPlanVersion: 2 });
    const eventTypes = built.eventRepo.create.mock.calls.map(
      (c: unknown[]) => (c[0] as { eventType: string }).eventType,
    );
    expect(eventTypes).toContain(RunEvent.PLAN_APPROVED);
    expect(built.linearClient.postComment).toHaveBeenCalledWith(
      "LIN-1",
      "Plan v2 approved. Starting implementation...",
    );
    expect(result.state).toBe(RunState.Implementing);
  });

  it("includes the operator note in both the transition payload and the Linear comment when provided", async () => {
    const store = makeStore({ state: RunState.AwaitingPlanApproval, planVersion: 2 });
    pushArtifact(store, "Plan", 2, makePlan({ planVersion: 2 }));
    const built = buildDeps(store);
    const svc = new OrchestratorService(built.deps as never);

    await svc.approvePlan("run-1", { note: "prioritize backward compatibility" });

    expect(built.linearClient.postComment).toHaveBeenCalledWith(
      "LIN-1",
      expect.stringContaining("prioritize backward compatibility"),
    );
    const approvalEvent = built.eventRepo.create.mock.calls.find(
      (c: unknown[]) => (c[0] as { eventType: string }).eventType === RunEvent.PLAN_APPROVED,
    );
    expect((approvalEvent![0] as { payloadJson: { note?: string } }).payloadJson.note).toBe(
      "prioritize backward compatibility",
    );
  });

  it("throws when there is no plan artifact for the run", async () => {
    const store = makeStore({ state: RunState.AwaitingPlanApproval });
    const built = buildDeps(store);
    const svc = new OrchestratorService(built.deps as never);

    await expect(svc.approvePlan("run-1")).rejects.toThrow("No plan artifact found");
  });
});

describe("OrchestratorService.runPlanRevision", () => {
  function planRevisionResult(overrides: Partial<PlanRevision> = {}): PlanRevision {
    return {
      originalPlanVersion: 1,
      revisedPlanVersion: 2,
      reviewId: "pr-1",
      dispositions: [
        { findingId: "f1", status: "accepted", rationale: "Valid concern, addressed" },
        { findingId: "f2", status: "dismissed", rationale: "Out of scope" },
      ],
      ...overrides,
    };
  }

  it("revises the plan, transitions to AwaitingPlanApproval, and posts the plan + disposition comment", async () => {
    const store = makeStore({ state: RunState.PlanRevision, planVersion: 1 });
    pushArtifact(store, "Plan", 1, makePlan({ planVersion: 1 }));
    pushArtifact(store, "PlanReview", 1, {
      reviewId: "pr-1",
      summary: "Needs work",
      findings: [
        { id: "f1", severity: "important", type: "bug", title: "Bug", details: "detail" },
      ],
      overallVerdict: "changes_requested",
    } as PlanReview);
    const built = buildDeps(store);
    const revisedPlan = makePlan({ planVersion: 2, summary: "Revised plan" });
    built.planReviserAgent.run.mockResolvedValue({
      revision: planRevisionResult(),
      revisedPlan,
    });

    const svc = new OrchestratorService(built.deps as never);
    const result = await svc.runPlanRevision("run-1");

    expect(built.planReviserAgent.run).toHaveBeenCalledWith(
      expect.objectContaining({ planVersion: 1 }),
      expect.objectContaining({ reviewId: "pr-1" }),
      expect.anything(),
      "run-1",
      undefined,
    );
    expect(built.runRepo.update).toHaveBeenCalledWith("run-1", { planVersion: 2 });
    const eventTypes = built.eventRepo.create.mock.calls.map(
      (c: unknown[]) => (c[0] as { eventType: string }).eventType,
    );
    expect(eventTypes).toContain(RunEvent.PLAN_REVISED);
    expect(result.state).toBe(RunState.AwaitingPlanApproval);

    const comment = built.linearClient.postComment.mock.calls.find((c: unknown[]) =>
      (c[1] as string).includes("Revised after AI review"),
    );
    expect(comment).toBeDefined();
    expect(comment![1] as string).toContain("Plan Revision Dispositions");
    expect(comment![1] as string).toContain("f1");
    expect(comment![1] as string).toContain("f2");
    expect(comment![1] as string).toContain("Valid concern, addressed");
  });

  it("passes opts.note through as operatorNote to the plan reviser", async () => {
    const store = makeStore({ state: RunState.PlanRevision, planVersion: 1 });
    pushArtifact(store, "Plan", 1, makePlan({ planVersion: 1 }));
    pushArtifact(store, "PlanReview", 1, {
      reviewId: "pr-1",
      summary: "Needs work",
      findings: [],
      overallVerdict: "changes_requested",
    } as PlanReview);
    const built = buildDeps(store);
    built.planReviserAgent.run.mockResolvedValue({
      revision: planRevisionResult({ dispositions: [] }),
      revisedPlan: makePlan({ planVersion: 2 }),
    });

    const svc = new OrchestratorService(built.deps as never);
    await svc.runPlanRevision("run-1", { note: "keep it minimal" });

    expect(built.planReviserAgent.run).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.anything(),
      "run-1",
      { operatorNote: "keep it minimal" },
    );
  });
});

describe("OrchestratorService.runPlanReview missing plan artifact", () => {
  it("throws when there is no Plan artifact for the run", async () => {
    const store = makeStore({ state: RunState.PlanReview, planVersion: 1 });
    const built = buildDeps(store);
    const svc = new OrchestratorService(built.deps as never);

    await expect(svc.runPlanReview("run-1")).rejects.toThrow("No plan artifact found for run run-1");
    expect(built.planReviewerAgent.run).not.toHaveBeenCalled();
  });
});

describe("OrchestratorService.runPlanReview changes_requested path", () => {
  it("posts the AI plan review comment and delegates into a real runPlanRevision, ending at AwaitingPlanApproval", async () => {
    const store = makeStore({ state: RunState.PlanReview, planVersion: 1 });
    pushArtifact(store, "Plan", 1, makePlan({ planVersion: 1 }));
    const built = buildDeps(store);
    built.planReviewerAgent.run.mockResolvedValue({
      reviewId: "pr-1",
      summary: "Some concerns",
      findings: [
        {
          id: "f1",
          severity: "important",
          type: "risk",
          affectedStepId: "s1",
          title: "Missing rollback plan",
          details: "No rollback strategy described",
        },
      ],
      overallVerdict: "changes_requested",
    } as PlanReview);
    built.planReviserAgent.run.mockResolvedValue({
      revision: {
        originalPlanVersion: 1,
        revisedPlanVersion: 2,
        reviewId: "pr-1",
        dispositions: [{ findingId: "f1", status: "accepted", rationale: "Added rollback step" }],
      },
      revisedPlan: makePlan({ planVersion: 2 }),
    });

    const svc = new OrchestratorService(built.deps as never);
    const result = await svc.runPlanReview("run-1");

    expect(built.linearClient.postComment).toHaveBeenCalledWith(
      "LIN-1",
      expect.stringContaining("Changes Requested"),
    );
    const reviewComment = built.linearClient.postComment.mock.calls.find((c: unknown[]) =>
      (c[1] as string).includes("Missing rollback plan"),
    );
    expect(reviewComment).toBeDefined();
    expect(reviewComment![1] as string).toContain("step s1");

    const eventTypes = built.eventRepo.create.mock.calls.map(
      (c: unknown[]) => (c[0] as { eventType: string }).eventType,
    );
    expect(eventTypes).toEqual([RunEvent.PLAN_REVIEW_CHANGES_REQUESTED, RunEvent.PLAN_REVISED]);
    expect(result.state).toBe(RunState.AwaitingPlanApproval);
  });
});

describe("OrchestratorService.rejectPlan blocking questions path", () => {
  it("pauses for human clarification when the re-plan after rejection still has blocking questions, without calling runPlanReview", async () => {
    const store = makeStore({ state: RunState.AwaitingPlanApproval, planVersion: 2 });
    pushArtifact(store, "Plan", 2, makePlan({ planVersion: 2 }));
    const built = buildDeps(store);
    mockPlannerProducesPlan(
      built.plannerAgent.run,
      store,
      makePlan({
        planVersion: 3,
        openQuestions: [{ id: "q1", question: "Which region?", requiredForExecution: true }],
      }),
    );
    const svc = new OrchestratorService(built.deps as never);
    const runPlanReviewSpy = vi.spyOn(svc, "runPlanReview");

    const result = await svc.rejectPlan("run-1", "Reconsider the region strategy", "api");

    expect(runPlanReviewSpy).not.toHaveBeenCalled();
    expect(result.state).toBe(RunState.HumanClarificationNeeded);
  });
});

describe("OrchestratorService.answerQuestions additional edge cases", () => {
  it("throws when there is no plan artifact for the run", async () => {
    const store = makeStore({ state: RunState.HumanClarificationNeeded });
    const built = buildDeps(store);
    const svc = new OrchestratorService(built.deps as never);

    await expect(svc.answerQuestions("run-1", [])).rejects.toThrow("No plan artifact found");
  });

  it("throws when there is no TaskBundle artifact for the run (HumanClarificationNeeded path)", async () => {
    const store = makeStore({ state: RunState.HumanClarificationNeeded, planVersion: 1 });
    pushArtifact(store, "Plan", 1, makePlan({
      planVersion: 1,
      openQuestions: [{ id: "q1", question: "Which env?", requiredForExecution: true }],
    }));
    const built = buildDeps(store);
    const svc = new OrchestratorService(built.deps as never);

    await expect(
      svc.answerQuestions("run-1", [{ questionId: "q1", answer: "prod" }]),
    ).rejects.toThrow("No TaskBundle artifact found");
  });

  it("loops back to HumanClarificationNeeded (incrementing the iteration count) when the re-plan still has blockers but the max iteration count has not been reached", async () => {
    const store = makeStore({ state: RunState.HumanClarificationNeeded, planVersion: 1 });
    pushArtifact(
      store,
      "Plan",
      1,
      makePlan({
        planVersion: 1,
        openQuestions: [{ id: "q1", question: "Which env?", requiredForExecution: true }],
      }),
    );
    pushArtifact(store, "TaskBundle", 1, {
      issue: { id: "LIN-1", title: "t", description: "d", labels: [], priority: 0 },
      repo: {
        name: "test-repo",
        defaultBranch: "main",
        workingBranch: "ai/run-1",
        repoPath: "/tmp",
        allowedPaths: [],
        protectedPaths: [],
      },
      constraints: {
        requiredChecks: [],
        maxFilesChanged: 10,
        maxDiffLines: 500,
        forbiddenPatterns: [],
        mustNotTouch: [],
      },
      definitionOfDone: [],
    });
    // One prior clarification round already recorded (below MAX_CLARIFICATION_ITERATIONS = 3).
    store.events.push({
      id: "evt-prior-clarification",
      runId: "run-1",
      eventType: RunEvent.NEEDS_HUMAN_CLARIFICATION,
      source: "planner-agent",
      payloadJson: {},
      createdAt: new Date(),
    });

    const built = buildDeps(store);
    mockPlannerProducesPlan(
      built.plannerAgent.run,
      store,
      makePlan({
        planVersion: 2,
        openQuestions: [{ id: "q2", question: "Which region?", requiredForExecution: true }],
      }),
    );

    const svc = new OrchestratorService(built.deps as never);
    const result = await svc.answerQuestions("run-1", [{ questionId: "q1", answer: "prod" }]);

    expect(result.state).toBe(RunState.HumanClarificationNeeded);
    const secondClarificationEvent = [...built.eventRepo.create.mock.calls]
      .reverse()
      .find(
        (c: unknown[]) => (c[0] as { eventType: string }).eventType === RunEvent.NEEDS_HUMAN_CLARIFICATION,
      );
    expect(secondClarificationEvent).toBeDefined();
    expect((secondClarificationEvent![0] as { payloadJson: { iteration: number } }).payloadJson.iteration).toBe(
      2,
    );
  });
});

describe("OrchestratorService.maybeResearchAndReplan with prior human answers present", () => {
  it("injects existing HumanAnswers into both the researcher call and the re-plan call", async () => {
    const store = makeStore({ state: RunState.Todo, planVersion: 0 });
    pushArtifact(store, "HumanAnswers", 1, {
      answers: [{ questionId: "q0", answer: "already answered" }],
      submittedAt: new Date().toISOString(),
    });
    const built = buildDeps(store);
    const answerResearcherAgent = {
      run: vi.fn().mockResolvedValue({
        summary: "Researched",
        answers: [
          { questionId: "q1", question: "Which db?", answer: "Postgres", confidence: "high" },
        ],
        completedAt: new Date().toISOString(),
      }),
    };
    mockPlannerProducesPlan(
      built.plannerAgent.run,
      store,
      makePlan({ planVersion: 1, openQuestions: [{ id: "q1", question: "Which db?", requiredForExecution: false }] }),
    );
    // The re-plan issued by maybeResearchAndReplan needs its own return value
    // (planVersion 2, no more open questions) -- override after the first call.
    let call = 0;
    built.plannerAgent.run.mockImplementation(() => {
      call += 1;
      if (call === 1) {
        const plan = makePlan({
          planVersion: 1,
          openQuestions: [{ id: "q1", question: "Which db?", requiredForExecution: false }],
        });
        pushArtifact(store, "Plan", 1, plan);
        return Promise.resolve(plan);
      }
      const revised = makePlan({ planVersion: 2, openQuestions: [] });
      pushArtifact(store, "Plan", 2, revised);
      return Promise.resolve(revised);
    });
    built.planReviewerAgent.run.mockResolvedValue({
      reviewId: "pr-1",
      summary: "fine",
      findings: [],
      overallVerdict: "approved",
    } as PlanReview);

    const svc = new OrchestratorService({ ...built.deps, answerResearcherAgent } as never);
    await svc.startRun("LIN-1");

    expect(answerResearcherAgent.run).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      "run-1",
      { humanAnswers: [{ questionId: "q0", answer: "already answered" }] },
    );
    // Second plannerAgent.run call (the re-plan after research) should also carry the humanAnswers.
    const secondCallArgs = built.plannerAgent.run.mock.calls[1]![2] as Record<string, unknown>;
    expect(secondCallArgs.humanAnswers).toEqual([{ questionId: "q0", answer: "already answered" }]);
  });
});

describe("OrchestratorService.updateSkillMetrics failure branch", () => {
  it("calls incrementFailure (not incrementSuccess) for injected skills when the run ends in Failed", async () => {
    const store = makeStore({ state: RunState.HumanClarificationNeeded, planVersion: 1 });
    pushArtifact(
      store,
      "Plan",
      1,
      makePlan({
        planVersion: 1,
        openQuestions: [{ id: "q1", question: "Which env?", requiredForExecution: true }],
      }),
    );
    pushArtifact(store, "TaskBundle", 1, {
      issue: { id: "LIN-1", title: "t", description: "d", labels: [], priority: 0 },
      repo: {
        name: "test-repo",
        defaultBranch: "main",
        workingBranch: "ai/run-1",
        repoPath: "/tmp",
        allowedPaths: [],
        protectedPaths: [],
      },
      constraints: {
        requiredChecks: [],
        maxFilesChanged: 10,
        maxDiffLines: 500,
        forbiddenPatterns: [],
        mustNotTouch: [],
      },
      definitionOfDone: [],
    });
    store.events.push(
      { id: "e1", runId: "run-1", eventType: RunEvent.NEEDS_HUMAN_CLARIFICATION, source: "x", payloadJson: {}, createdAt: new Date() },
      { id: "e2", runId: "run-1", eventType: RunEvent.NEEDS_HUMAN_CLARIFICATION, source: "x", payloadJson: {}, createdAt: new Date() },
      { id: "e3", runId: "run-1", eventType: RunEvent.NEEDS_HUMAN_CLARIFICATION, source: "x", payloadJson: {}, createdAt: new Date() },
      {
        id: "e4",
        runId: "run-1",
        eventType: "SKILL_INJECTION",
        source: "orchestrator",
        payloadJson: { skillIds: ["skill-x"] },
        createdAt: new Date(),
      },
    );

    const built = buildDeps(store);
    mockPlannerProducesPlan(
      built.plannerAgent.run,
      store,
      makePlan({
        planVersion: 2,
        openQuestions: [{ id: "q2", question: "Still blocked", requiredForExecution: true }],
      }),
    );
    const agentSkillRepo = {
      incrementSuccess: vi.fn(),
      incrementFailure: vi.fn().mockResolvedValue({
        id: "skill-x",
        utilityScore: 0.1,
        successCount: 0,
        failureCount: 1,
      }),
      archiveIfLowUtility: vi.fn().mockResolvedValue(undefined),
    };

    const svc = new OrchestratorService({ ...built.deps, agentSkillRepo } as never);
    const result = await svc.answerQuestions("run-1", [{ questionId: "q1", answer: "prod" }]);

    expect(result.state).toBe(RunState.Failed);
    expect(agentSkillRepo.incrementFailure).toHaveBeenCalledWith("skill-x");
    expect(agentSkillRepo.incrementSuccess).not.toHaveBeenCalled();
  });
});

describe("OrchestratorService formatExecutionReportComment edge cases", () => {
  function makeExecutionReport(overrides: Partial<ExecutionReport> = {}): ExecutionReport {
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
      ...overrides,
    };
  }

  function setupImplementingRun(store: ReturnType<typeof makeStore>) {
    store.run = { ...store.run, state: RunState.Implementing, approvedPlanVersion: 1, planVersion: 1 };
    pushArtifact(store, "Plan", 1, makePlan({ planVersion: 1 }));
  }

  it("omits the Files changed section entirely when no files changed", async () => {
    const store = makeStore();
    setupImplementingRun(store);
    const built = buildDeps(store);
    built.executorAgent.run.mockResolvedValue({
      report: makeExecutionReport({ filesChanged: [] }),
      prNumber: 1,
    });
    const svc = new OrchestratorService(built.deps as never);
    vi.spyOn(svc, "runReview").mockResolvedValue(store.run as never);

    await svc.runExecution("run-1");

    const comment = built.linearClient.postComment.mock.calls.find((c: unknown[]) =>
      (c[1] as string).includes("Execution Report"),
    )![1] as string;
    expect(comment).not.toContain("Files changed");
  });

  it("collapses the file list inside <details> when there are more than 8 files changed", async () => {
    const store = makeStore();
    setupImplementingRun(store);
    const built = buildDeps(store);
    const manyFiles = Array.from({ length: 9 }, (_, i) => `src/file${i}.ts`);
    built.executorAgent.run.mockResolvedValue({
      report: makeExecutionReport({ filesChanged: manyFiles }),
      prNumber: 1,
    });
    const svc = new OrchestratorService(built.deps as never);
    vi.spyOn(svc, "runReview").mockResolvedValue(store.run as never);

    await svc.runExecution("run-1");

    const comment = built.linearClient.postComment.mock.calls.find((c: unknown[]) =>
      (c[1] as string).includes("Execution Report"),
    )![1] as string;
    expect(comment).toContain("<details>");
    expect(comment).toContain("Files changed (9)");
    expect(comment).toContain("src/file8.ts");
  });

  it("includes a Notes section when the report has notes", async () => {
    const store = makeStore();
    setupImplementingRun(store);
    const built = buildDeps(store);
    built.executorAgent.run.mockResolvedValue({
      report: makeExecutionReport({ notes: ["Had to skip flaky test X"] }),
      prNumber: 1,
    });
    const svc = new OrchestratorService(built.deps as never);
    vi.spyOn(svc, "runReview").mockResolvedValue(store.run as never);

    await svc.runExecution("run-1");

    const comment = built.linearClient.postComment.mock.calls.find((c: unknown[]) =>
      (c[1] as string).includes("Execution Report"),
    )![1] as string;
    expect(comment).toContain("### Notes");
    expect(comment).toContain("Had to skip flaky test X");
  });
});
