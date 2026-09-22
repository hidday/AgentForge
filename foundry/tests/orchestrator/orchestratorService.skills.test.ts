import { describe, it, expect, vi } from "vitest";
import { OrchestratorService } from "../../src/orchestrator/orchestratorService.js";
import { RunState } from "../../src/domain/runState.js";
import { RunEvent } from "../../src/domain/runEvent.js";
import {
  buildDeps,
  createStore,
  makeArtifact,
  makePlan,
  makeRun,
  makeTaskBundle,
  mockPlannerPersists,
  pushEvent,
} from "./testSupport.js";

function agentSkillRepo() {
  return {
    findTopKByRelevance: vi.fn().mockResolvedValue([]),
    incrementSuccess: vi.fn(),
    incrementFailure: vi.fn(),
    archiveIfLowUtility: vi.fn().mockResolvedValue(undefined),
  };
}

describe("OrchestratorService retrieveSkillsForPlanning (via retryRun)", () => {
  it("injects priorSkills into plannerAgent.run and records a SKILL_INJECTION event when skills are found", async () => {
    const run = makeRun({
      state: RunState.Todo,
      branchName: "ai/existing",
      planVersion: 1,
      linearIssueTitle: "Fix the widget",
      linearIssueDescription: "It is broken",
    });
    const store = createStore(run, []);
    const { deps, plannerAgent, planReviewerAgent } = buildDeps(store);
    const skillRepo = agentSkillRepo();
    skillRepo.findTopKByRelevance.mockResolvedValue([
      { id: "skill-1", repoSlug: "test-repo", name: "n", description: "d", taskCategory: "bugfix", skillMarkdown: "md", utilityScore: 1, lastUsedAt: new Date() },
    ]);
    mockPlannerPersists(plannerAgent, store, makePlan({ planVersion: 1, openQuestions: [] }));
    planReviewerAgent.run.mockResolvedValue({
      reviewId: "r1",
      summary: "ok",
      findings: [],
      overallVerdict: "approved",
    });

    const svc = new OrchestratorService({ ...deps, agentSkillRepo: skillRepo } as never);
    await svc.retryRun("run-1");

    expect(skillRepo.findTopKByRelevance).toHaveBeenCalledWith(
      "test-repo",
      expect.stringContaining("Fix the widget"),
      expect.any(Number),
    );
    expect(plannerAgent.run).toHaveBeenCalledWith(
      expect.anything(),
      "run-1",
      expect.objectContaining({
        priorSkills: [expect.objectContaining({ id: "skill-1" })],
      }),
    );

    const injectionEvent = store.events.find((e) => e.eventType === "SKILL_INJECTION");
    expect(injectionEvent).toBeDefined();
    expect((injectionEvent!.payloadJson as { skillIds: string[] }).skillIds).toEqual(["skill-1"]);
  });

  it("does not record a SKILL_INJECTION event when no relevant skills are found", async () => {
    const run = makeRun({ state: RunState.Todo, branchName: "ai/existing", planVersion: 1 });
    const store = createStore(run, []);
    const { deps, plannerAgent, planReviewerAgent } = buildDeps(store);
    const skillRepo = agentSkillRepo();
    mockPlannerPersists(plannerAgent, store, makePlan({ planVersion: 1, openQuestions: [] }));
    planReviewerAgent.run.mockResolvedValue({
      reviewId: "r1",
      summary: "ok",
      findings: [],
      overallVerdict: "approved",
    });

    const svc = new OrchestratorService({ ...deps, agentSkillRepo: skillRepo } as never);
    await svc.retryRun("run-1");

    const injectionEvent = store.events.find((e) => e.eventType === "SKILL_INJECTION");
    expect(injectionEvent).toBeUndefined();
  });
});

describe("OrchestratorService updateSkillMetrics (via terminal-state transitions)", () => {
  it("increments success and archives-if-low-utility for each distinct injected skill when a run reaches Done", async () => {
    const run = makeRun({ state: RunState.ReadyForHumanReview });
    const store = createStore(run, []);
    pushEvent(store, {
      eventType: "SKILL_INJECTION",
      source: "orchestrator",
      createdAt: new Date("2026-01-01T00:00:01Z"),
      payloadJson: { skillIds: ["skill-1", "skill-2"] },
    });
    // A second injection event (e.g. from a re-plan) re-mentions skill-1: must be deduplicated.
    pushEvent(store, {
      eventType: "SKILL_INJECTION",
      source: "orchestrator",
      createdAt: new Date("2026-01-01T00:00:02Z"),
      payloadJson: { skillIds: ["skill-1"] },
    });

    const { deps } = buildDeps(store);
    const skillRepo = agentSkillRepo();
    skillRepo.incrementSuccess.mockImplementation((id: string) =>
      Promise.resolve({ id, utilityScore: 1 }),
    );
    const svc = new OrchestratorService({ ...deps, agentSkillRepo: skillRepo } as never);

    await svc.approveHumanReview("run-1");

    expect(store.run.state).toBe(RunState.Done);
    expect(skillRepo.incrementSuccess).toHaveBeenCalledTimes(2);
    expect(skillRepo.incrementSuccess).toHaveBeenCalledWith("skill-1");
    expect(skillRepo.incrementSuccess).toHaveBeenCalledWith("skill-2");
    expect(skillRepo.incrementFailure).not.toHaveBeenCalled();
    expect(skillRepo.archiveIfLowUtility).toHaveBeenCalledTimes(2);
  });

  it("does nothing when there are no SKILL_INJECTION events for the run", async () => {
    const run = makeRun({ state: RunState.ReadyForHumanReview });
    const store = createStore(run, []);
    const { deps } = buildDeps(store);
    const skillRepo = agentSkillRepo();
    const svc = new OrchestratorService({ ...deps, agentSkillRepo: skillRepo } as never);

    await svc.approveHumanReview("run-1");

    expect(skillRepo.incrementSuccess).not.toHaveBeenCalled();
    expect(skillRepo.incrementFailure).not.toHaveBeenCalled();
  });

  it("increments failure (not success) when a run reaches Failed, and logs+continues if a metric update throws", async () => {
    const run = makeRun({ state: RunState.HumanClarificationNeeded, planVersion: 1 });
    const store = createStore(run, [
      makeArtifact({
        type: "Plan",
        version: 1,
        payloadJson: makePlan({
          openQuestions: [{ id: "q1", question: "Which env?", requiredForExecution: true }],
        }),
      }),
      makeArtifact({ type: "TaskBundle", version: 1, payloadJson: makeTaskBundle() }),
    ]);
    pushEvent(store, {
      eventType: "SKILL_INJECTION",
      source: "orchestrator",
      createdAt: new Date("2026-01-01T00:00:01Z"),
      payloadJson: { skillIds: ["skill-1"] },
    });
    // 3 prior NEEDS_HUMAN_CLARIFICATION events => at the iteration cap.
    for (let i = 0; i < 3; i++) {
      pushEvent(store, {
        eventType: RunEvent.NEEDS_HUMAN_CLARIFICATION,
        source: "planner-agent",
        createdAt: new Date(`2026-01-01T00:00:0${i + 2}Z`),
        payloadJson: {},
      });
    }

    const { deps, plannerAgent, logger } = buildDeps(store);
    plannerAgent.run.mockResolvedValue(
      makePlan({
        planVersion: 2,
        openQuestions: [{ id: "q1", question: "Still which env?", requiredForExecution: true }],
      }),
    );
    const skillRepo = agentSkillRepo();
    skillRepo.incrementFailure.mockRejectedValue(new Error("db unavailable"));

    const svc = new OrchestratorService({ ...deps, agentSkillRepo: skillRepo } as never);
    const result = await svc.answerQuestions("run-1", [{ questionId: "q1", answer: "prod" }]);

    expect(result.state).toBe(RunState.Failed);
    expect(skillRepo.incrementFailure).toHaveBeenCalledWith("skill-1");
    expect(skillRepo.incrementSuccess).not.toHaveBeenCalled();
    expect(skillRepo.archiveIfLowUtility).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ runId: "run-1", skillId: "skill-1", error: "db unavailable" }),
      "Failed to update skill metric",
    );
  });
});
