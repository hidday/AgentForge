import { describe, it, expect } from "vitest";
import { OrchestratorService } from "../../src/orchestrator/orchestratorService.js";
import { RunState } from "../../src/domain/runState.js";
import { buildDeps, makeRun } from "./_fixtures.js";

describe("OrchestratorService.startRun -- existing active run guard", () => {
  it("returns the existing active run without creating a new one or calling the planner", async () => {
    const { deps, runRepo, plannerAgent } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    const existing = makeRun({ id: "run-existing", state: RunState.Planning });
    runRepo.findActiveByIssueId.mockResolvedValue(existing);

    const result = await svc.startRun("LIN-1");

    expect(result).toBe(existing);
    expect(runRepo.create).not.toHaveBeenCalled();
    expect(plannerAgent.run).not.toHaveBeenCalled();
    expect(deps.linearClient.getIssue).not.toHaveBeenCalled();
  });
});

describe("OrchestratorService -- requireRun (private, exercised via public methods)", () => {
  it("throws a plain Error identifying the missing run when it does not exist", async () => {
    const { deps, runRepo } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    runRepo.findById.mockResolvedValue(null);

    await expect(svc.runPlanning("run-missing")).rejects.toThrow("Run not found: run-missing");
  });
});
