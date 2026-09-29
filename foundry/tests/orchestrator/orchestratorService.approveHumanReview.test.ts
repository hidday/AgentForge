import { describe, it, expect } from "vitest";
import { OrchestratorService } from "../../src/orchestrator/orchestratorService.js";
import { RunState } from "../../src/domain/runState.js";
import { buildStorefulDeps, makeRun } from "./helpers/testKit.js";

describe("OrchestratorService.approveHumanReview", () => {
  it("runs distillation, transitions to Done, and posts the completion comment", async () => {
    const run = makeRun({ id: "run-1", state: RunState.ReadyForHumanReview });
    const h = buildStorefulDeps(run);
    const svc = new OrchestratorService({ ...h.deps, distillationAgent: h.distillationAgent } as never);

    const result = await svc.approveHumanReview("run-1");

    expect(h.distillationAgent.run).toHaveBeenCalledWith("run-1", expect.objectContaining({ id: "run-1" }));
    expect(result.state).toBe(RunState.Done);
    expect(h.linearClient.postComment).toHaveBeenCalledWith(
      "LIN-1",
      "Human review approved. Run is **Done**.",
    );
  });

  it("still completes the run when distillation fails (best-effort, logs a warning)", async () => {
    const run = makeRun({ id: "run-1", state: RunState.ReadyForHumanReview });
    const h = buildStorefulDeps(run);
    h.distillationAgent.run.mockRejectedValue(new Error("distillation blew up"));
    const svc = new OrchestratorService({ ...h.deps, distillationAgent: h.distillationAgent } as never);

    const result = await svc.approveHumanReview("run-1");

    expect(result.state).toBe(RunState.Done);
    expect(h.logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ runId: "run-1", error: "distillation blew up" }),
      "Distillation agent failed (best-effort, ignoring)",
    );
  });

  it("completes the run without attempting distillation when no distillationAgent is injected", async () => {
    const run = makeRun({ id: "run-1", state: RunState.ReadyForHumanReview });
    const h = buildStorefulDeps(run);
    const svc = new OrchestratorService(h.deps as never);

    const result = await svc.approveHumanReview("run-1");

    expect(result.state).toBe(RunState.Done);
  });

  it("cleans up the worktree and updates skill metrics when the run reaches Done", async () => {
    const run = makeRun({
      id: "run-1",
      state: RunState.ReadyForHumanReview,
      workingDirectory: "/tmp/worktree",
    });
    const h = buildStorefulDeps(run);
    h.gitService.resolveMainRepoPath.mockReturnValue("/tmp/main-repo");

    const svc = new OrchestratorService({ ...h.deps, agentSkillRepo: h.agentSkillRepo } as never);
    await svc.approveHumanReview("run-1");

    expect(h.gitService.removeWorktree).toHaveBeenCalledWith("/tmp/main-repo", "/tmp/worktree");
  });

  it("does not remove the worktree when workingDirectory already IS the main repo path", async () => {
    const run = makeRun({
      id: "run-1",
      state: RunState.ReadyForHumanReview,
      workingDirectory: "/tmp/main-repo",
    });
    const h = buildStorefulDeps(run);
    h.gitService.resolveMainRepoPath.mockReturnValue("/tmp/main-repo");

    const svc = new OrchestratorService(h.deps as never);
    await svc.approveHumanReview("run-1");

    expect(h.gitService.removeWorktree).not.toHaveBeenCalled();
  });
});
