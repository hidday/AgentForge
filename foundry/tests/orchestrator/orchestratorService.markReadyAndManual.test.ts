import { describe, it, expect, vi } from "vitest";
import { OrchestratorService } from "../../src/orchestrator/orchestratorService.js";
import { RunState } from "../../src/domain/runState.js";
import { RunEvent } from "../../src/domain/runEvent.js";
import { PolicyViolationError } from "../../src/utils/errors.js";
import {
  buildStoreDeps,
  makeRun,
  makePlan,
  makePlanReview,
  makeExecutionReport,
  makeReview,
  makeArtifact,
  wirePlanReviewerAgent,
  wirePlanReviserAgent,
} from "./fixtures.js";

describe("OrchestratorService.markReady", () => {
  it("succeeds and posts the completion comment when all policy conditions are met", async () => {
    const initialRun = makeRun({ id: "run-1", state: RunState.AIReview, prNumber: 5 });
    const { deps, linearClient } = buildStoreDeps(initialRun, [
      makeArtifact({ type: "Review", version: 1, payloadJson: makeReview({ overallVerdict: "approved" }) }),
      makeArtifact({ type: "ExecutionReport", version: 1, payloadJson: makeExecutionReport() }),
    ]);
    const svc = new OrchestratorService(deps as never);

    const result = await svc.markReady("run-1");

    expect(result.state).toBe(RunState.AIReview);
    const comment = (linearClient.postComment as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(comment[1]).toContain("Ready for Human Review");
  });

  it("propagates PolicyViolationError when checks are failing", async () => {
    const initialRun = makeRun({ id: "run-1", state: RunState.AIReview, prNumber: 5 });
    const { deps } = buildStoreDeps(initialRun, [
      makeArtifact({ type: "Review", version: 1, payloadJson: makeReview({ overallVerdict: "approved" }) }),
      makeArtifact({
        type: "ExecutionReport",
        version: 1,
        payloadJson: makeExecutionReport({ checks: { lint: { status: "pass", details: "" }, typecheck: { status: "pass", details: "" }, tests: { status: "fail", details: "broken" } } }),
      }),
    ]);
    const svc = new OrchestratorService(deps as never);

    await expect(svc.markReady("run-1")).rejects.toThrow(PolicyViolationError);
  });

  it("throws when unresolved blocker findings remain", async () => {
    const initialRun = makeRun({ id: "run-1", state: RunState.AIReview, prNumber: 5 });
    const { deps } = buildStoreDeps(initialRun, [
      makeArtifact({
        type: "Review",
        version: 1,
        payloadJson: makeReview({
          overallVerdict: "approved",
          findings: [{ id: "f1", severity: "blocker", type: "bug", file: "a.ts", title: "t", details: "d" }],
        }),
      }),
      makeArtifact({ type: "ExecutionReport", version: 1, payloadJson: makeExecutionReport() }),
    ]);
    const svc = new OrchestratorService(deps as never);

    await expect(svc.markReady("run-1")).rejects.toThrow(/unresolved blocker/);
  });
});

describe("OrchestratorService.runManualReReview", () => {
  it("throws when no Plan artifact exists", async () => {
    const initialRun = makeRun({ id: "run-1", state: RunState.AwaitingPlanApproval });
    const { deps } = buildStoreDeps(initialRun);
    const svc = new OrchestratorService(deps as never);

    await expect(svc.runManualReReview("run-1")).rejects.toThrow(/No plan artifact found/);
  });

  it("approved verdict: records RE_REVIEW_REQUESTED and PLAN_REVIEW_APPROVED, returns to AwaitingPlanApproval", async () => {
    const initialRun = makeRun({ id: "run-1", state: RunState.AwaitingPlanApproval, planVersion: 2 });
    const { deps, store, planReviewerAgent, artifactRepo } = buildStoreDeps(initialRun, [
      makeArtifact({ type: "Plan", version: 2, payloadJson: makePlan({ planVersion: 2 }) }),
    ]);
    const svc = new OrchestratorService(deps as never);

    wirePlanReviewerAgent(artifactRepo, planReviewerAgent, () => makePlanReview({ overallVerdict: "approved" }));

    const result = await svc.runManualReReview("run-1", { note: "double check step 2" });

    expect(result.state).toBe(RunState.AwaitingPlanApproval);
    expect(store.events.map((e) => e.eventType)).toEqual(
      expect.arrayContaining([RunEvent.RE_REVIEW_REQUESTED, RunEvent.PLAN_REVIEW_APPROVED]),
    );
    const reReviewEvent = store.events.find((e) => e.eventType === RunEvent.RE_REVIEW_REQUESTED);
    expect((reReviewEvent!.payloadJson as { note?: string }).note).toBe("double check step 2");
    expect(planReviewerAgent.run).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      "run-1",
      { operatorNote: "double check step 2" },
    );
  });

  it("changes_requested verdict still returns to AwaitingPlanApproval (human retains control)", async () => {
    const initialRun = makeRun({ id: "run-1", state: RunState.AwaitingPlanApproval, planVersion: 2 });
    const { deps, store, planReviewerAgent, artifactRepo } = buildStoreDeps(initialRun, [
      makeArtifact({ type: "Plan", version: 2, payloadJson: makePlan({ planVersion: 2 }) }),
    ]);
    const svc = new OrchestratorService(deps as never);

    wirePlanReviewerAgent(artifactRepo, planReviewerAgent, () =>
      makePlanReview({
        overallVerdict: "changes_requested",
        findings: [{ id: "f1", severity: "nit", type: "x", title: "t", details: "d" }],
      }),
    );

    const result = await svc.runManualReReview("run-1");

    expect(result.state).toBe(RunState.AwaitingPlanApproval);
    expect(planReviewerAgent.run).toHaveBeenCalledWith(expect.anything(), expect.anything(), "run-1", undefined);
    const reReviewEvent = store.events.find((e) => e.eventType === RunEvent.RE_REVIEW_REQUESTED);
    expect(reReviewEvent!.payloadJson).toEqual({ from: RunState.AwaitingPlanApproval, to: RunState.PlanReview, trigger: "re-review" });
  });
});

describe("OrchestratorService.runManualPlanRevision", () => {
  it("throws when no Plan artifact exists", async () => {
    const initialRun = makeRun({ id: "run-1", state: RunState.AwaitingPlanApproval });
    const { deps } = buildStoreDeps(initialRun);
    const svc = new OrchestratorService(deps as never);

    await expect(svc.runManualPlanRevision("run-1")).rejects.toThrow(/No plan artifact found/);
  });

  it("approved verdict: no revision needed, returns to AwaitingPlanApproval", async () => {
    const initialRun = makeRun({ id: "run-1", state: RunState.AwaitingPlanApproval, planVersion: 2 });
    const { deps, store, planReviewerAgent, planReviserAgent, artifactRepo } = buildStoreDeps(initialRun, [
      makeArtifact({ type: "Plan", version: 2, payloadJson: makePlan({ planVersion: 2 }) }),
    ]);
    const svc = new OrchestratorService(deps as never);

    wirePlanReviewerAgent(artifactRepo, planReviewerAgent, () => makePlanReview({ overallVerdict: "approved" }));

    const result = await svc.runManualPlanRevision("run-1");

    expect(result.state).toBe(RunState.AwaitingPlanApproval);
    expect(planReviserAgent.run).not.toHaveBeenCalled();
    expect(store.events.map((e) => e.eventType)).toEqual(
      expect.arrayContaining([RunEvent.RE_REVIEW_REQUESTED, RunEvent.PLAN_REVIEW_APPROVED]),
    );
  });

  it("changes_requested verdict: chains into runPlanRevision and returns the revised plan's run", async () => {
    const initialRun = makeRun({ id: "run-1", state: RunState.AwaitingPlanApproval, planVersion: 2 });
    const { deps, store, planReviewerAgent, planReviserAgent, artifactRepo } = buildStoreDeps(initialRun, [
      makeArtifact({ type: "Plan", version: 2, payloadJson: makePlan({ planVersion: 2 }) }),
    ]);
    const svc = new OrchestratorService(deps as never);

    wirePlanReviewerAgent(artifactRepo, planReviewerAgent, () =>
      makePlanReview({
        overallVerdict: "changes_requested",
        findings: [{ id: "f1", severity: "important", type: "x", title: "t", details: "d" }],
      }),
    );
    wirePlanReviserAgent(artifactRepo, planReviserAgent, (plan) => makePlan({ ...plan, planVersion: plan.planVersion + 1 }));

    const result = await svc.runManualPlanRevision("run-1", { note: "tighten scope" });

    expect(result.state).toBe(RunState.AwaitingPlanApproval);
    expect(planReviserAgent.run).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.anything(),
      "run-1",
      { operatorNote: "tighten scope" },
    );
    expect(store.events.map((e) => e.eventType)).toEqual(
      expect.arrayContaining([
        RunEvent.RE_REVIEW_REQUESTED,
        RunEvent.PLAN_REVIEW_CHANGES_REQUESTED,
        RunEvent.PLAN_REVISED,
      ]),
    );
    expect(store.run.planVersion).toBe(3);
  });
});

describe("OrchestratorService.approveHumanReview", () => {
  it("transitions to Done and posts the final comment when there is no distillation agent configured", async () => {
    const initialRun = makeRun({ id: "run-1", state: RunState.ReadyForHumanReview, workingDirectory: "/tmp" });
    const { deps, store, linearClient, gitService } = buildStoreDeps(initialRun);
    const svc = new OrchestratorService(deps as never);

    const result = await svc.approveHumanReview("run-1");

    expect(result.state).toBe(RunState.Done);
    const comment = (linearClient.postComment as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(comment[1]).toContain("Human review approved");
    // workingDirectory === mainRepoPath ("/tmp" both) -> no worktree cleanup
    expect(gitService.removeWorktree).not.toHaveBeenCalled();
    expect(store.events.map((e) => e.eventType)).toContain(RunEvent.HUMAN_APPROVED);
  });

  it("cleans up the worktree when workingDirectory differs from the main repo path", async () => {
    const initialRun = makeRun({
      id: "run-1",
      state: RunState.ReadyForHumanReview,
      workingDirectory: "/tmp/worktree-run-1",
    });
    const { deps, gitService } = buildStoreDeps(initialRun);
    gitService.resolveMainRepoPath.mockReturnValue("/tmp");
    const svc = new OrchestratorService(deps as never);

    await svc.approveHumanReview("run-1");

    expect(gitService.removeWorktree).toHaveBeenCalledWith("/tmp", "/tmp/worktree-run-1");
  });

  it("calls the distillation agent before transitioning, passing the run", async () => {
    const initialRun = makeRun({ id: "run-1", state: RunState.ReadyForHumanReview });
    const { deps } = buildStoreDeps(initialRun);
    const distillationAgent = { run: vi.fn().mockResolvedValue(undefined) };
    const svc = new OrchestratorService({ ...deps, distillationAgent } as never);

    await svc.approveHumanReview("run-1");

    expect(distillationAgent.run).toHaveBeenCalledWith("run-1", expect.objectContaining({ id: "run-1" }));
  });

  it("swallows distillation agent errors (best-effort) and still completes the run", async () => {
    const initialRun = makeRun({ id: "run-1", state: RunState.ReadyForHumanReview });
    const { deps, logger } = buildStoreDeps(initialRun);
    const distillationAgent = { run: vi.fn().mockRejectedValue(new Error("distillation blew up")) };
    const svc = new OrchestratorService({ ...deps, distillationAgent } as never);

    const result = await svc.approveHumanReview("run-1");

    expect(result.state).toBe(RunState.Done);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ runId: "run-1", error: "distillation blew up" }),
      "Distillation agent failed (best-effort, ignoring)",
    );
  });
});
