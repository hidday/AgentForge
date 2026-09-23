import { describe, it, expect, vi } from "vitest";
import { OrchestratorService } from "../../src/orchestrator/orchestratorService.js";
import { RunState } from "../../src/domain/runState.js";
import { buildFullDeps, makeRun, makePlan, makePlanReview } from "./_helpers/fixtures.js";

describe("OrchestratorService.runManualReReview", () => {
  it("throws when there is no Plan artifact", async () => {
    const run = makeRun({ id: "run-1", state: RunState.AwaitingPlanApproval });
    const { deps } = buildFullDeps(run);
    const svc = new OrchestratorService(deps as never);

    await expect(svc.runManualReReview("run-1")).rejects.toThrow(
      "No plan artifact found for run run-1",
    );
  });

  it("approved verdict: transitions RE_REVIEW_REQUESTED then PLAN_REVIEW_APPROVED, ending in AwaitingPlanApproval", async () => {
    const run = makeRun({ id: "run-1", state: RunState.AwaitingPlanApproval });
    const { deps, artifactRepo, planReviewerAgent } = buildFullDeps(run);
    artifactRepo.seed("Plan", makePlan());
    planReviewerAgent.run.mockResolvedValue(makePlanReview({ overallVerdict: "approved" }));

    const svc = new OrchestratorService(deps as never);
    const result = await svc.runManualReReview("run-1");

    expect(result.state).toBe(RunState.AwaitingPlanApproval);
  });

  it("changes_requested verdict: still returns to AwaitingPlanApproval (does not auto-chain into revision)", async () => {
    const run = makeRun({ id: "run-1", state: RunState.AwaitingPlanApproval });
    const { deps, artifactRepo, planReviewerAgent, planReviserAgent } = buildFullDeps(run);
    artifactRepo.seed("Plan", makePlan());
    planReviewerAgent.run.mockResolvedValue(
      makePlanReview({
        overallVerdict: "changes_requested",
        findings: [
          { id: "f1", severity: "important", type: "gap", title: "Missing case", details: "..." },
        ],
      }),
    );

    const svc = new OrchestratorService(deps as never);
    const result = await svc.runManualReReview("run-1");

    expect(result.state).toBe(RunState.AwaitingPlanApproval);
    expect(planReviserAgent.run).not.toHaveBeenCalled();
  });

  it("passes an operatorNote through to planReviewerAgent.run", async () => {
    const run = makeRun({ id: "run-1", state: RunState.AwaitingPlanApproval });
    const { deps, artifactRepo, planReviewerAgent } = buildFullDeps(run);
    artifactRepo.seed("Plan", makePlan());
    planReviewerAgent.run.mockResolvedValue(makePlanReview({ overallVerdict: "approved" }));

    const svc = new OrchestratorService(deps as never);
    await svc.runManualReReview("run-1", { note: "double check the migration plan" });

    expect(planReviewerAgent.run).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      "run-1",
      { operatorNote: "double check the migration plan" },
    );
  });
});

describe("OrchestratorService.runManualPlanRevision", () => {
  it("throws when there is no Plan artifact", async () => {
    const run = makeRun({ id: "run-1", state: RunState.AwaitingPlanApproval });
    const { deps } = buildFullDeps(run);
    const svc = new OrchestratorService(deps as never);

    await expect(svc.runManualPlanRevision("run-1")).rejects.toThrow(
      "No plan artifact found for run run-1",
    );
  });

  it("approved verdict: transitions RE_REVIEW_REQUESTED then PLAN_REVIEW_APPROVED without revising", async () => {
    const run = makeRun({ id: "run-1", state: RunState.AwaitingPlanApproval });
    const { deps, artifactRepo, planReviewerAgent, planReviserAgent } = buildFullDeps(run);
    artifactRepo.seed("Plan", makePlan());
    planReviewerAgent.run.mockResolvedValue(makePlanReview({ overallVerdict: "approved" }));

    const svc = new OrchestratorService(deps as never);
    const result = await svc.runManualPlanRevision("run-1");

    expect(result.state).toBe(RunState.AwaitingPlanApproval);
    expect(planReviserAgent.run).not.toHaveBeenCalled();
  });

  it("changes_requested verdict: chains into runPlanRevision and ends in AwaitingPlanApproval", async () => {
    const run = makeRun({ id: "run-1", state: RunState.AwaitingPlanApproval, planVersion: 1 });
    const { deps, artifactRepo, runRepo, planReviewerAgent, planReviserAgent } = buildFullDeps(run);
    artifactRepo.seed("Plan", makePlan({ planVersion: 1 }));
    artifactRepo.seed("PlanReview", makePlanReview({ overallVerdict: "changes_requested" }));
    planReviewerAgent.run.mockResolvedValue(
      makePlanReview({
        overallVerdict: "changes_requested",
        findings: [
          { id: "f1", severity: "important", type: "gap", title: "Missing case", details: "..." },
        ],
      }),
    );
    planReviserAgent.run.mockResolvedValue({
      revision: { dispositions: [{ findingId: "f1", status: "addressed", rationale: "Fixed" }] },
      revisedPlan: makePlan({ planVersion: 2 }),
    });

    const svc = new OrchestratorService(deps as never);
    const result = await svc.runManualPlanRevision("run-1", { note: "focus on step 3" });

    expect(planReviserAgent.run).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.anything(),
      "run-1",
      { operatorNote: "focus on step 3" },
    );
    expect(runRepo.getCurrent().planVersion).toBe(2);
    expect(result.state).toBe(RunState.AwaitingPlanApproval);
  });
});

describe("OrchestratorService.approveHumanReview", () => {
  it("transitions to Done, posts a completion comment, and cleans up the worktree", async () => {
    const run = makeRun({
      id: "run-1",
      state: RunState.ReadyForHumanReview,
      workingDirectory: "/tmp/worktree",
    });
    const { deps, gitService, linearClient } = buildFullDeps(run);

    const svc = new OrchestratorService(deps as never);
    const result = await svc.approveHumanReview("run-1");

    expect(result.state).toBe(RunState.Done);
    expect(linearClient.postComment).toHaveBeenCalledWith(
      "LIN-1",
      "Human review approved. Run is **Done**.",
    );
    // /tmp/worktree !== the resolved main repo path (/tmp/main-repo by default), so
    // the worktree cleanup path runs.
    expect(gitService.removeWorktree).toHaveBeenCalledWith("/tmp/main-repo", "/tmp/worktree");
  });

  it("does not remove the worktree when the run's workingDirectory already IS the main repo path", async () => {
    const run = makeRun({
      id: "run-1",
      state: RunState.ReadyForHumanReview,
      workingDirectory: "/tmp/main-repo",
    });
    const { deps, gitService } = buildFullDeps(run);
    gitService.resolveMainRepoPath.mockReturnValue("/tmp/main-repo");

    const svc = new OrchestratorService(deps as never);
    await svc.approveHumanReview("run-1");

    expect(gitService.removeWorktree).not.toHaveBeenCalled();
  });

  it("invokes the distillation agent when configured, and ignores it when it throws (best-effort)", async () => {
    const run = makeRun({ id: "run-1", state: RunState.ReadyForHumanReview });
    const distillationAgent = { run: vi.fn().mockRejectedValue(new Error("distillation failed")) };
    const { deps, logger } = buildFullDeps(run, { distillationAgent });

    const svc = new OrchestratorService(deps as never);
    const result = await svc.approveHumanReview("run-1");

    expect(distillationAgent.run).toHaveBeenCalledWith("run-1", expect.objectContaining({ id: "run-1" }));
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ runId: "run-1" }),
      "Distillation agent failed (best-effort, ignoring)",
    );
    expect(result.state).toBe(RunState.Done);
  });

  it("succeeds without a distillation agent configured", async () => {
    const run = makeRun({ id: "run-1", state: RunState.ReadyForHumanReview });
    const { deps } = buildFullDeps(run);

    const svc = new OrchestratorService(deps as never);
    const result = await svc.approveHumanReview("run-1");

    expect(result.state).toBe(RunState.Done);
  });
});
