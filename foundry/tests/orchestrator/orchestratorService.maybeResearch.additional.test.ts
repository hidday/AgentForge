import { describe, it, expect, vi } from "vitest";
import { OrchestratorService } from "../../src/orchestrator/orchestratorService.js";
import { RunState } from "../../src/domain/runState.js";
import { buildFullDeps, makeRun, makePlan } from "./_helpers/fixtures.js";

// maybeResearchAndReplan is private; exercise its "existing HumanAnswers artifact"
// branch (injected into both the researcher call and the follow-up planner
// re-plan call) via retryRun, which calls it directly.
describe("maybeResearchAndReplan -- injects an existing HumanAnswers artifact (via retryRun)", () => {
  it("passes humanAnswers to both the answerResearcherAgent and the post-research planner re-plan call", async () => {
    const run = makeRun({ id: "run-1", state: RunState.Todo, branchName: "ai/existing" });
    const answerResearcherAgent = {
      run: vi.fn().mockResolvedValue({
        summary: "Researched",
        answers: [
          { questionId: "q1", question: "Optional?", answer: "Sure", confidence: "high" as const },
        ],
        completedAt: new Date().toISOString(),
      }),
    };
    const { deps, artifactRepo, plannerAgent } = buildFullDeps(run, { answerResearcherAgent });

    artifactRepo.seed("HumanAnswers", {
      answers: [{ questionId: "q0", answer: "Previously answered" }],
      submittedAt: new Date().toISOString(),
    });

    const planWithOptionalQuestion = makePlan({
      planVersion: 1,
      openQuestions: [{ id: "q1", question: "Optional?", requiredForExecution: false }],
    });
    const revisedPlan = makePlan({ planVersion: 2, openQuestions: [] });

    plannerAgent.run
      .mockResolvedValueOnce(planWithOptionalQuestion)
      .mockResolvedValueOnce(revisedPlan);
    artifactRepo.seed("Plan", revisedPlan);

    const svc = new OrchestratorService(deps as never);
    await svc.retryRun("run-1");

    expect(answerResearcherAgent.run).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      "run-1",
      expect.objectContaining({
        humanAnswers: [{ questionId: "q0", answer: "Previously answered" }],
      }),
    );

    // Second plannerAgent.run call is the post-research re-plan.
    expect(plannerAgent.run).toHaveBeenCalledTimes(2);
    expect(plannerAgent.run.mock.calls[1][2]).toMatchObject({
      humanAnswers: [{ questionId: "q0", answer: "Previously answered" }],
      researchedAnswers: expect.arrayContaining([expect.objectContaining({ questionId: "q1" })]),
    });
  });
});
