import { describe, it, expect } from "vitest";
import { OrchestratorService } from "../../src/orchestrator/orchestratorService.js";
import { RunState } from "../../src/domain/runState.js";
import {
  buildStorefulDeps,
  makeRun,
  makePlan,
  makePlanReview,
  stubPlanner,
  stubPlanReviewer,
} from "./helpers/testKit.js";

describe("OrchestratorService -- skill retrieval during planning (retrieveSkillsForPlanning)", () => {
  it("does nothing when no agentSkillRepo is injected", async () => {
    const run = makeRun({ id: "run-1", state: RunState.Todo });
    const h = buildStorefulDeps(run);
    h.runRepo.findActiveByIssueId.mockResolvedValue(null);
    h.runRepo.create.mockImplementation((data: Partial<typeof run>) =>
      Promise.resolve({ ...run, ...data }),
    );
    stubPlanner(h, makePlan({ openQuestions: [] }));
    stubPlanReviewer(h, makePlanReview({ overallVerdict: "approved" }));

    const svc = new OrchestratorService(h.deps as never);
    await svc.startRun("LIN-1");

    // No agentSkillRepo => plannerAgent.run must be called with an empty priorSkills array.
    expect(h.plannerAgent.run).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ priorSkills: [] }),
    );
  });

  it("queries top-K relevant skills by repo+query and forwards them to the planner", async () => {
    const run = makeRun({
      id: "run-1",
      state: RunState.Todo,
      linearIssueTitle: "Add OAuth support",
    });
    const h = buildStorefulDeps(run);
    h.runRepo.findActiveByIssueId.mockResolvedValue(null);
    h.runRepo.create.mockImplementation((data: Partial<typeof run>) =>
      Promise.resolve({ ...run, ...data }),
    );

    const skills = [
      {
        id: "skill-1",
        repoSlug: "test-repo",
        name: "OAuth setup",
        description: "How to add OAuth",
        taskCategory: "auth",
        skillMarkdown: "# OAuth",
        utilityScore: 0.8,
        lastUsedAt: new Date(),
      },
    ];
    h.agentSkillRepo.findTopKByRelevance.mockResolvedValue(skills);

    stubPlanner(h, makePlan({ openQuestions: [] }));
    stubPlanReviewer(h, makePlanReview({ overallVerdict: "approved" }));

    const svc = new OrchestratorService({ ...h.deps, agentSkillRepo: h.agentSkillRepo } as never);
    await svc.startRun("LIN-1");

    expect(h.agentSkillRepo.findTopKByRelevance).toHaveBeenCalledWith(
      "test-repo",
      expect.stringContaining("Add OAuth support"),
      expect.any(Number),
    );
    expect(h.plannerAgent.run).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ priorSkills: skills }),
    );
    const eventTypes = h.store.events.map((e) => e.eventType);
    expect(eventTypes).toContain("SKILL_INJECTION");
  });

  it("does NOT record a SKILL_INJECTION event when no skills are found", async () => {
    const run = makeRun({ id: "run-1", state: RunState.Todo });
    const h = buildStorefulDeps(run);
    h.runRepo.findActiveByIssueId.mockResolvedValue(null);
    h.runRepo.create.mockImplementation((data: Partial<typeof run>) =>
      Promise.resolve({ ...run, ...data }),
    );
    h.agentSkillRepo.findTopKByRelevance.mockResolvedValue([]);

    stubPlanner(h, makePlan({ openQuestions: [] }));
    stubPlanReviewer(h, makePlanReview({ overallVerdict: "approved" }));

    const svc = new OrchestratorService({ ...h.deps, agentSkillRepo: h.agentSkillRepo } as never);
    await svc.startRun("LIN-1");

    const eventTypes = h.store.events.map((e) => e.eventType);
    expect(eventTypes).not.toContain("SKILL_INJECTION");
  });
});

describe("OrchestratorService -- skill utility metric updates on run completion (updateSkillMetrics)", () => {
  it("does nothing when no agentSkillRepo is injected, even when the run reaches Done", async () => {
    const run = makeRun({ id: "run-1", state: RunState.ReadyForHumanReview });
    const h = buildStorefulDeps(run);
    const svc = new OrchestratorService(h.deps as never);

    await svc.approveHumanReview("run-1");

    expect(h.store.run.state).toBe(RunState.Done);
  });

  it("does nothing when there were no SKILL_INJECTION events for the run", async () => {
    const run = makeRun({ id: "run-1", state: RunState.ReadyForHumanReview });
    const h = buildStorefulDeps(run);

    const svc = new OrchestratorService({ ...h.deps, agentSkillRepo: h.agentSkillRepo } as never);
    await svc.approveHumanReview("run-1");

    expect(h.agentSkillRepo.incrementSuccess).not.toHaveBeenCalled();
    expect(h.agentSkillRepo.incrementFailure).not.toHaveBeenCalled();
  });

  it("increments success and archives-if-low-utility for each distinct injected skill when the run succeeds (Done)", async () => {
    const run = makeRun({ id: "run-1", state: RunState.ReadyForHumanReview });
    const h = buildStorefulDeps(run);
    h.store.events.push(
      {
        id: "evt-1",
        runId: "run-1",
        eventType: "SKILL_INJECTION",
        source: "orchestrator",
        payloadJson: { skillIds: ["skill-a", "skill-b"] },
        createdAt: new Date(),
      },
      {
        id: "evt-2",
        runId: "run-1",
        eventType: "SKILL_INJECTION",
        source: "orchestrator",
        // "skill-a" repeats across two injection events (e.g. initial plan + a
        // re-plan) and must only be updated once, deduplicated.
        payloadJson: { skillIds: ["skill-a"] },
        createdAt: new Date(),
      },
    );
    const updatedSkill = {
      id: "skill-a",
      repoSlug: "test-repo",
      name: null,
      description: null,
      taskCategory: "x",
      skillMarkdown: "",
      utilityScore: 0.5,
      lastUsedAt: new Date(),
    };
    h.agentSkillRepo.incrementSuccess.mockResolvedValue(updatedSkill);

    const svc = new OrchestratorService({ ...h.deps, agentSkillRepo: h.agentSkillRepo } as never);
    await svc.approveHumanReview("run-1");

    expect(h.agentSkillRepo.incrementSuccess).toHaveBeenCalledTimes(2);
    expect(h.agentSkillRepo.incrementSuccess).toHaveBeenCalledWith("skill-a");
    expect(h.agentSkillRepo.incrementSuccess).toHaveBeenCalledWith("skill-b");
    expect(h.agentSkillRepo.incrementFailure).not.toHaveBeenCalled();
    expect(h.agentSkillRepo.archiveIfLowUtility).toHaveBeenCalledTimes(2);
  });

  it("increments failure for injected skills when the run fails (Failed)", async () => {
    const run = makeRun({
      id: "run-1",
      state: RunState.HumanClarificationNeeded,
      planVersion: 1,
    });
    const h = buildStorefulDeps(run);
    h.store.events.push({
      id: "evt-1",
      runId: "run-1",
      eventType: "SKILL_INJECTION",
      source: "orchestrator",
      payloadJson: { skillIds: ["skill-a"] },
      createdAt: new Date(),
    });
    // 3 prior clarification events already recorded => next one exhausts.
    for (let i = 0; i < 3; i++) {
      h.store.events.push({
        id: `evt-clar-${i}`,
        runId: "run-1",
        eventType: "NEEDS_HUMAN_CLARIFICATION",
        source: "planner-agent",
        payloadJson: {},
        createdAt: new Date(),
      });
    }
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

    stubPlanner(
      h,
      makePlan({
        planVersion: 2,
        openQuestions: [{ id: "q1", question: "Still?", requiredForExecution: true }],
      }),
    );
    const updatedSkill = {
      id: "skill-a",
      repoSlug: "test-repo",
      name: null,
      description: null,
      taskCategory: "x",
      skillMarkdown: "",
      utilityScore: 0.1,
      lastUsedAt: new Date(),
    };
    h.agentSkillRepo.incrementFailure.mockResolvedValue(updatedSkill);

    const svc = new OrchestratorService({ ...h.deps, agentSkillRepo: h.agentSkillRepo } as never);
    const result = await svc.answerQuestions("run-1", [{ questionId: "q1", answer: "still stuck" }]);

    expect(result.state).toBe(RunState.Failed);
    expect(h.agentSkillRepo.incrementFailure).toHaveBeenCalledWith("skill-a");
    expect(h.agentSkillRepo.incrementSuccess).not.toHaveBeenCalled();
  });

  it("logs a warning (and continues) when updating a skill's metric throws", async () => {
    const run = makeRun({ id: "run-1", state: RunState.ReadyForHumanReview });
    const h = buildStorefulDeps(run);
    h.store.events.push({
      id: "evt-1",
      runId: "run-1",
      eventType: "SKILL_INJECTION",
      source: "orchestrator",
      payloadJson: { skillIds: ["skill-a"] },
      createdAt: new Date(),
    });
    h.agentSkillRepo.incrementSuccess.mockRejectedValue(new Error("db down"));

    const svc = new OrchestratorService({ ...h.deps, agentSkillRepo: h.agentSkillRepo } as never);
    const result = await svc.approveHumanReview("run-1");

    expect(result.state).toBe(RunState.Done);
    expect(h.logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ runId: "run-1", skillId: "skill-a", error: "db down" }),
      "Failed to update skill metric",
    );
  });
});
