import { describe, it, expect, vi } from "vitest";
import { OrchestratorService } from "../../src/orchestrator/orchestratorService.js";
import { RunState } from "../../src/domain/runState.js";
import { buildDeps, makeRun, makePlan, makeArtifact, makeExecutionReport } from "./orchestratorServiceTestHelpers.js";

describe("OrchestratorService simple accessors", () => {
  it("expose the injected repositories and clients", () => {
    const { deps, runRepo, artifactRepo, eventRepo, agentSkillRepo, linearClient } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    expect(svc.getRunRepo()).toBe(runRepo);
    expect(svc.getArtifactRepo()).toBe(artifactRepo);
    expect(svc.getEventRepo()).toBe(eventRepo);
    expect(svc.getAgentSkillRepo()).toBe(agentSkillRepo);
    expect(svc.getLinearClient()).toBe(linearClient);
  });
});

describe("OrchestratorService.rejectPlan blocking questions", () => {
  it("pauses for human clarification when the re-plan after rejection still has blocking questions", async () => {
    const { deps, plannerAgent } = buildDeps(
      {},
      makeRun({ state: RunState.AwaitingPlanApproval, planVersion: 1 }),
    );
    plannerAgent.run.mockResolvedValue(
      makePlan({
        planVersion: 2,
        openQuestions: [{ id: "q1", question: "Which backend?", requiredForExecution: true }],
      }),
    );
    const svc = new OrchestratorService(deps as never);
    const reviewSpy = vi.spyOn(svc, "runPlanReview");

    const result = await svc.rejectPlan("run-1", "needs rework", "api", "fresh");

    expect(reviewSpy).not.toHaveBeenCalled();
    expect(result.state).toBe(RunState.HumanClarificationNeeded);
  });
});

describe("OrchestratorService.updateSkillMetrics failure path", () => {
  it("decrements skill utility (incrementFailure) when a run with injected skills fails", async () => {
    const { deps, eventRepo, agentSkillRepo } = buildDeps({}, makeRun({ state: RunState.Todo }));
    eventRepo.findByRunId.mockResolvedValue([
      {
        id: "e1",
        runId: "run-1",
        eventType: "SKILL_INJECTION",
        source: "orchestrator",
        payloadJson: { skillIds: ["skill-1"] },
        createdAt: new Date(),
      },
    ]);
    const svc = new OrchestratorService(deps as never);
    const spy = vi
      .spyOn(svc as unknown as { transitionAndRecord: unknown } as never, "transitionAndRecord")
      .mockImplementation(async () => {
        throw new Error("unused");
      });
    spy.mockRestore();

    // Drive the real failure path through handleCommand's pause/resume is not
    // terminal; instead call the private path indirectly via answerQuestions'
    // CLARIFICATION_EXHAUSTED transition, which lands on Failed.
    const run = makeRun({ state: RunState.HumanClarificationNeeded });
    const built = buildDeps({}, run);
    built.eventRepo.findByRunId.mockResolvedValue([
      ...Array.from({ length: 3 }, (_, i) => ({
        id: `clarify-${i}`,
        runId: "run-1",
        eventType: "NEEDS_HUMAN_CLARIFICATION",
        source: "planner-agent",
        payloadJson: {},
        createdAt: new Date(),
      })),
      {
        id: "skill-evt",
        runId: "run-1",
        eventType: "SKILL_INJECTION",
        source: "orchestrator",
        payloadJson: { skillIds: ["skill-1"] },
        createdAt: new Date(),
      },
    ]);
    built.artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
      if (type === "Plan") {
        return Promise.resolve(
          makeArtifact({
            type: "Plan",
            payloadJson: makePlan({
              openQuestions: [{ id: "q1", question: "x?", requiredForExecution: true }],
            }),
          }),
        );
      }
      if (type === "TaskBundle") {
        return Promise.resolve(
          makeArtifact({
            type: "TaskBundle",
            payloadJson: {
              issue: { id: "LIN-1", title: "t", description: "d", labels: [], priority: 1 },
              repo: {
                name: "test-repo",
                defaultBranch: "main",
                workingBranch: "ai/run-1",
                repoPath: "/tmp/run-1",
                allowedPaths: [],
                protectedPaths: [],
              },
              constraints: {
                requiredChecks: [],
                maxFilesChanged: 50,
                maxDiffLines: 2000,
                forbiddenPatterns: [],
                mustNotTouch: [],
              },
              definitionOfDone: [],
            },
          }),
        );
      }
      return Promise.resolve(null);
    });
    built.plannerAgent.run.mockResolvedValue(
      makePlan({
        planVersion: 2,
        openQuestions: [{ id: "q1", question: "x?", requiredForExecution: true }],
      }),
    );
    const svc2 = new OrchestratorService(built.deps as never);

    const result = await svc2.answerQuestions("run-1", [{ questionId: "q1", answer: "y" }]);

    expect(result.state).toBe(RunState.Failed);
    expect(agentSkillRepo.incrementFailure).not.toHaveBeenCalled(); // different agentSkillRepo instance
    expect(built.agentSkillRepo.incrementFailure).toHaveBeenCalledWith("skill-1");
    expect(built.agentSkillRepo.incrementSuccess).not.toHaveBeenCalled();
  });
});

describe("OrchestratorService.formatExecutionReportComment edge cases", () => {
  it("omits the files-changed and notes sections when both are empty", async () => {
    const { deps, artifactRepo, linearClient, executorAgent } = buildDeps(
      {},
      makeRun({ state: RunState.Implementing, approvedPlanVersion: 1, prNumber: null }),
    );
    artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) =>
      type === "Plan"
        ? Promise.resolve(makeArtifact({ type: "Plan", payloadJson: makePlan({ planVersion: 1 }) }))
        : Promise.resolve(null),
    );
    executorAgent.run.mockResolvedValue({
      report: makeExecutionReport({ filesChanged: [], notes: [] }),
      prNumber: 42,
    });
    const svc = new OrchestratorService(deps as never);
    vi.spyOn(svc, "runReview").mockResolvedValue(makeRun());

    await svc.runExecution("run-1");

    const comment = linearClient.postComment.mock.calls.find(([, body]: [string, string]) =>
      body.includes("Execution Report"),
    )?.[1];
    expect(comment).not.toContain("Files changed");
    expect(comment).not.toContain("### Notes");
  });
});

describe("OrchestratorService.ensureTaskBundleArtifact (via startRun)", () => {
  it("does not create a duplicate TaskBundle artifact if one already exists for the run", async () => {
    const { deps, artifactRepo } = buildDeps();
    artifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) =>
      type === "TaskBundle"
        ? Promise.resolve(makeArtifact({ type: "TaskBundle", payloadJson: {} }))
        : Promise.resolve(null),
    );
    const svc = new OrchestratorService(deps as never);
    vi.spyOn(svc, "runPlanReview").mockResolvedValue(makeRun());

    await svc.startRun("LIN-1");

    expect(artifactRepo.create).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: "TaskBundle" }),
    );
  });
});
