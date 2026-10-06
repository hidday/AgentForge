import { describe, it, expect, vi } from "vitest";
import { OrchestratorService } from "../../src/orchestrator/orchestratorService.js";
import { RunState } from "../../src/domain/runState.js";
import { RunEvent } from "../../src/domain/runEvent.js";
import { PolicyViolationError } from "../../src/utils/errors.js";
import {
  makeRun,
  makeArtifact,
  makeExecutionReport,
  makeReview,
  buildFullDeps,
} from "./testHelpers.js";

describe("OrchestratorService.markReady", () => {
  it("posts the completion comment and returns the run when all policy conditions are met", async () => {
    const run = makeRun({ state: RunState.AIReview, prNumber: 7 });
    const built = buildFullDeps({
      run,
      artifacts: [
        makeArtifact({ type: "Review", version: 1, payloadJson: makeReview({ overallVerdict: "approved" }) }),
        makeArtifact({ type: "ExecutionReport", version: 1, payloadJson: makeExecutionReport() }),
      ],
    });
    const svc = new OrchestratorService(built.deps as never);

    const result = await svc.markReady("run-1");

    expect(result.state).toBe(RunState.AIReview);
    expect(built.linearClient.postComment).toHaveBeenCalledWith(
      run.linearIssueId,
      "AI workflow complete. Issue marked as **Ready for Human Review**.",
    );
  });

  it("propagates the underlying PolicyViolationError when checks fail", async () => {
    const run = makeRun({ state: RunState.AIReview, prNumber: null });
    const built = buildFullDeps({ run, artifacts: [] });
    const svc = new OrchestratorService(built.deps as never);

    let caught: PolicyViolationError | undefined;
    try {
      await svc.markReady("run-1");
    } catch (err) {
      caught = err as PolicyViolationError;
    }
    expect(caught).toBeInstanceOf(PolicyViolationError);
    expect(caught?.rule).toBe("ready_requires_pr");
    expect(built.linearClient.postComment).not.toHaveBeenCalled();
  });

  it("throws when the run does not exist", async () => {
    const run = makeRun();
    const built = buildFullDeps({ run });
    built.runRepo.findById.mockResolvedValueOnce(null);
    const svc = new OrchestratorService(built.deps as never);

    await expect(svc.markReady("missing")).rejects.toThrow("Run not found: missing");
  });
});

describe("OrchestratorService.approveHumanReview", () => {
  it("runs the distillation agent, transitions to Done via HUMAN_APPROVED, and posts a completion comment", async () => {
    const run = makeRun({ state: RunState.ReadyForHumanReview });
    const built = buildFullDeps({ run });
    const svc = new OrchestratorService(built.deps as never);

    const result = await svc.approveHumanReview("run-1");

    expect(built.distillationAgent.run).toHaveBeenCalledWith("run-1", expect.objectContaining({ id: "run-1" }));
    expect(result.state).toBe(RunState.Done);

    const eventTypes = built.eventRepo.create.mock.calls.map(
      (c: unknown[]) => (c[0] as { eventType: string }).eventType,
    );
    expect(eventTypes).toContain(RunEvent.HUMAN_APPROVED);

    expect(built.linearClient.postComment).toHaveBeenCalledWith(
      run.linearIssueId,
      "Human review approved. Run is **Done**.",
    );
  });

  it("cleans up the worktree and updates skill metrics when the run reaches Done", async () => {
    const run = makeRun({ state: RunState.ReadyForHumanReview, workingDirectory: "/tmp/worktree-x" });
    const built = buildFullDeps({ run });
    built.gitService.resolveMainRepoPath.mockReturnValue("/tmp/main-repo");
    built.eventRepo.findByRunId.mockResolvedValue([
      {
        id: "e1",
        runId: "run-1",
        eventType: "SKILL_INJECTION",
        source: "orchestrator",
        payloadJson: { skillIds: ["skill-1"] },
        createdAt: new Date(),
      },
    ]);
    built.agentSkillRepo.incrementSuccess.mockResolvedValue({ id: "skill-1" });

    const svc = new OrchestratorService(built.deps as never);
    await svc.approveHumanReview("run-1");

    expect(built.gitService.removeWorktree).toHaveBeenCalledWith("/tmp/main-repo", "/tmp/worktree-x");
    expect(built.agentSkillRepo.incrementSuccess).toHaveBeenCalledWith("skill-1");
    expect(built.agentSkillRepo.archiveIfLowUtility).toHaveBeenCalledWith({ id: "skill-1" });
  });

  it("does NOT clean up the worktree when workingDirectory IS the main repo path", async () => {
    const run = makeRun({ state: RunState.ReadyForHumanReview, workingDirectory: "/tmp/main-repo" });
    const built = buildFullDeps({ run });
    built.gitService.resolveMainRepoPath.mockReturnValue("/tmp/main-repo");

    const svc = new OrchestratorService(built.deps as never);
    await svc.approveHumanReview("run-1");

    expect(built.gitService.removeWorktree).not.toHaveBeenCalled();
  });

  it("swallows a distillation agent failure (best-effort) and still completes the run", async () => {
    const run = makeRun({ state: RunState.ReadyForHumanReview });
    const built = buildFullDeps({ run });
    built.distillationAgent.run.mockRejectedValue(new Error("distillation boom"));

    const svc = new OrchestratorService(built.deps as never);
    const result = await svc.approveHumanReview("run-1");

    expect(result.state).toBe(RunState.Done);
    expect(built.logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ runId: "run-1", error: "distillation boom" }),
      "Distillation agent failed (best-effort, ignoring)",
    );
  });

  it("still succeeds when there is no distillationAgent configured", async () => {
    const run = makeRun({ state: RunState.ReadyForHumanReview });
    const built = buildFullDeps({ run, overrides: { distillationAgent: undefined } });

    const svc = new OrchestratorService(built.deps as never);
    const result = await svc.approveHumanReview("run-1");

    expect(result.state).toBe(RunState.Done);
  });

  it("propagates a StateTransitionError when the run is not in a state that allows HUMAN_APPROVED", async () => {
    const run = makeRun({ state: RunState.Todo });
    const built = buildFullDeps({ run });

    const svc = new OrchestratorService(built.deps as never);
    await expect(svc.approveHumanReview("run-1")).rejects.toThrow(
      /No transition from state "Todo" for event "HUMAN_APPROVED"/,
    );
  });
});
