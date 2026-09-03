import { describe, it, expect, vi } from "vitest";
import { OrchestratorService } from "../../src/orchestrator/orchestratorService.js";
import { RunState } from "../../src/domain/runState.js";
import type { Plan } from "../../src/schemas/plan.js";
import type { TaskBundle } from "../../src/schemas/taskBundle.js";
import type { HumanAnswer } from "../../src/domain/types.js";
import type { ResearchedAnswers } from "../../src/schemas/researchedAnswers.js";
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

describe("OrchestratorService buildTaskBundle default-branch resolution (via retryRun)", () => {
  it("uses the remote default branch and logs a warning when it differs from the configured value", async () => {
    const store = makeStore({ state: RunState.Todo, branchName: "ai/existing" });
    const built = buildDeps(store);
    built.githubClient.getDefaultBranch.mockResolvedValue("develop");
    mockPlannerProducesPlan(built.plannerAgent.run, store, makePlan());
    const svc = new OrchestratorService(built.deps as never);
    vi.spyOn(svc, "runPlanReview").mockResolvedValue(store.run as never);

    await svc.retryRun("run-1");

    expect(built.logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ repo: "test-repo", config: "main", remote: "develop" }),
      expect.stringContaining("Config defaultBranch differs from GitHub"),
    );
    const bundleArg = built.plannerAgent.run.mock.calls[0]![0] as TaskBundle;
    expect(bundleArg.repo.defaultBranch).toBe("develop");
  });

  it("falls back to the configured default branch and logs a warning when GitHub lookup fails", async () => {
    const store = makeStore({ state: RunState.Todo, branchName: "ai/existing" });
    const built = buildDeps(store);
    built.githubClient.getDefaultBranch.mockRejectedValue(new Error("API rate limited"));
    mockPlannerProducesPlan(built.plannerAgent.run, store, makePlan());
    const svc = new OrchestratorService(built.deps as never);
    vi.spyOn(svc, "runPlanReview").mockResolvedValue(store.run as never);

    await svc.retryRun("run-1");

    expect(built.logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ repo: "test-repo", error: "API rate limited" }),
      expect.stringContaining("Failed to resolve default branch"),
    );
    const bundleArg = built.plannerAgent.run.mock.calls[0]![0] as TaskBundle;
    expect(bundleArg.repo.defaultBranch).toBe("main");
  });

  it("uses the configured default branch without warning when the remote value matches", async () => {
    const store = makeStore({ state: RunState.Todo, branchName: "ai/existing" });
    const built = buildDeps(store);
    built.githubClient.getDefaultBranch.mockResolvedValue("main");
    mockPlannerProducesPlan(built.plannerAgent.run, store, makePlan());
    const svc = new OrchestratorService(built.deps as never);
    vi.spyOn(svc, "runPlanReview").mockResolvedValue(store.run as never);

    await svc.retryRun("run-1");

    expect(built.logger.warn).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.stringContaining("differs from GitHub"),
    );
  });
});

describe("OrchestratorService.retrieveSkillsForPlanning", () => {
  it("does not record a SKILL_INJECTION event when the repository returns no relevant skills", async () => {
    const store = makeStore({ state: RunState.Todo, branchName: "ai/existing" });
    const built = buildDeps(store);
    const agentSkillRepo = { findTopKByRelevance: vi.fn().mockResolvedValue([]) };
    mockPlannerProducesPlan(built.plannerAgent.run, store, makePlan());
    const svc = new OrchestratorService({ ...built.deps, agentSkillRepo } as never);
    vi.spyOn(svc, "runPlanReview").mockResolvedValue(store.run as never);

    await svc.retryRun("run-1");

    expect(agentSkillRepo.findTopKByRelevance).toHaveBeenCalled();
    const injectionEvent = built.eventRepo.create.mock.calls.find(
      (c: unknown[]) => (c[0] as { eventType: string }).eventType === "SKILL_INJECTION",
    );
    expect(injectionEvent).toBeUndefined();
    expect(built.plannerAgent.run).toHaveBeenCalledWith(
      expect.anything(),
      "run-1",
      expect.objectContaining({ priorSkills: [] }),
    );
  });
});

describe("OrchestratorService.rejectPlan mode handling", () => {
  function setupAwaitingApprovalRunWithContext(store: ReturnType<typeof makeStore>) {
    store.run = { ...store.run, state: RunState.AwaitingPlanApproval, planVersion: 2 };
    pushArtifact(store, "Plan", 2, makePlan({ planVersion: 2 }));
    const humanAnswers: HumanAnswer[] = [{ questionId: "q1", answer: "yes" }];
    pushArtifact(store, "HumanAnswers", 1, {
      answers: humanAnswers,
      submittedAt: new Date().toISOString(),
    });
    const researchedAnswers: ResearchedAnswers = {
      summary: "done",
      answers: [
        { questionId: "q2", question: "which env", answer: "prod", confidence: "medium" },
      ],
      completedAt: new Date().toISOString(),
    };
    pushArtifact(store, "ResearchedAnswers", 1, researchedAnswers);
    pushArtifact(store, "PlanReview", 1, {
      summary: "needs tweaks",
      findings: [{ id: "f1", severity: "nit", title: "nit", details: "detail" }],
    });
    return { humanAnswers, researchedAnswers };
  }

  it("in default ('iterate') mode, injects previousPlan/humanAnswers/researchedAnswers/planReviewFindings alongside humanFeedback", async () => {
    const store = makeStore();
    const { humanAnswers, researchedAnswers } = setupAwaitingApprovalRunWithContext(store);
    const built = buildDeps(store);
    mockPlannerProducesPlan(built.plannerAgent.run, store, makePlan({ planVersion: 3 }));
    const svc = new OrchestratorService(built.deps as never);
    vi.spyOn(svc, "runPlanReview").mockResolvedValue(store.run as never);

    await svc.rejectPlan("run-1", "Please use OAuth2", "api");

    expect(built.plannerAgent.run).toHaveBeenCalledWith(
      expect.anything(),
      "run-1",
      expect.objectContaining({
        planVersionOverride: 3,
        previousPlan: expect.objectContaining({ planVersion: 2 }),
        humanFeedback: { planVersion: 2, feedback: "Please use OAuth2" },
        humanAnswers,
        researchedAnswers: researchedAnswers.answers,
        planReviewFindings: { summary: "needs tweaks", findings: expect.any(Array) },
      }),
    );
  });

  it("in 'fresh' mode, injects ONLY humanFeedback -- previousPlan/humanAnswers/researchedAnswers/planReviewFindings are omitted", async () => {
    const store = makeStore();
    setupAwaitingApprovalRunWithContext(store);
    const built = buildDeps(store);
    mockPlannerProducesPlan(built.plannerAgent.run, store, makePlan({ planVersion: 3 }));
    const svc = new OrchestratorService(built.deps as never);
    vi.spyOn(svc, "runPlanReview").mockResolvedValue(store.run as never);

    await svc.rejectPlan("run-1", "Start over with a simpler design", "api", "fresh");

    const callArgs = built.plannerAgent.run.mock.calls[0]![2] as Record<string, unknown>;
    expect(callArgs.humanFeedback).toEqual({
      planVersion: 2,
      feedback: "Start over with a simpler design",
    });
    expect(callArgs).not.toHaveProperty("previousPlan");
    expect(callArgs).not.toHaveProperty("humanAnswers");
    expect(callArgs).not.toHaveProperty("researchedAnswers");
    expect(callArgs).not.toHaveProperty("planReviewFindings");
  });

  it("posts a Linear comment tagged with the mode, and stores 'fresh' mode on the RejectionContext artifact", async () => {
    const store = makeStore();
    setupAwaitingApprovalRunWithContext(store);
    const built = buildDeps(store);
    mockPlannerProducesPlan(built.plannerAgent.run, store, makePlan({ planVersion: 3 }));
    const svc = new OrchestratorService(built.deps as never);
    vi.spyOn(svc, "runPlanReview").mockResolvedValue(store.run as never);

    await svc.rejectPlan("run-1", "Start fresh please", "linear", "fresh");

    expect(built.linearClient.postComment).toHaveBeenCalledWith(
      "LIN-1",
      expect.stringContaining("Plan rejected (fresh) with feedback: Start fresh please"),
    );
    const rejectionArtifact = store.artifacts.find((a) => a.type === "RejectionContext");
    expect(rejectionArtifact).toBeDefined();
    expect(rejectionArtifact!.payloadJson).toMatchObject({ mode: "fresh", source: "linear" });
  });
});
