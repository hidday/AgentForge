import { describe, it, expect } from "vitest";
import { OrchestratorService } from "../../src/orchestrator/orchestratorService.js";
import { RunState } from "../../src/domain/runState.js";
import { PolicyViolationError } from "../../src/utils/errors.js";
import { buildDeps, makeRun, makeArtifact, makeExecutionReport, makeReview } from "./_fixtures.js";

describe("OrchestratorService.markReady", () => {
  it("posts the completion comment and returns the run when all policy checks pass", async () => {
    const { deps, runRepo, artifactRepo, linearClient } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    const run = makeRun({ prNumber: 9, state: RunState.AIReview });
    runRepo.findById.mockResolvedValue(run);
    artifactRepo.findLatestByType.mockImplementation((_: string, type: string) => {
      if (type === "Review") return Promise.resolve(makeArtifact({ type: "Review", payloadJson: makeReview({ overallVerdict: "approved" }) }));
      if (type === "ExecutionReport") return Promise.resolve(makeArtifact({ type: "ExecutionReport", payloadJson: makeExecutionReport() }));
      return Promise.resolve(null);
    });

    const result = await svc.markReady("run-1");

    expect(linearClient.postComment).toHaveBeenCalledWith(
      run.linearIssueId,
      expect.stringContaining("Ready for Human Review"),
    );
    expect(result).toBe(run);
  });

  it("propagates the PolicyViolationError and does not post a comment when there is no PR", async () => {
    const { deps, runRepo, artifactRepo, linearClient } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    runRepo.findById.mockResolvedValue(makeRun({ prNumber: null }));
    artifactRepo.findLatestByType.mockResolvedValue(null);

    await expect(svc.markReady("run-1")).rejects.toBeInstanceOf(PolicyViolationError);
    expect(linearClient.postComment).not.toHaveBeenCalled();
  });

  it("propagates the PolicyViolationError when checks are failing", async () => {
    const { deps, runRepo, artifactRepo } = buildDeps();
    const svc = new OrchestratorService(deps as never);

    runRepo.findById.mockResolvedValue(makeRun({ prNumber: 9 }));
    artifactRepo.findLatestByType.mockImplementation((_: string, type: string) => {
      if (type === "ExecutionReport")
        return Promise.resolve(
          makeArtifact({
            type: "ExecutionReport",
            payloadJson: makeExecutionReport({
              checks: {
                lint: { status: "pass", details: "ok" },
                typecheck: { status: "pass", details: "ok" },
                tests: { status: "fail", details: "broken" },
              },
            }),
          }),
        );
      return Promise.resolve(null);
    });

    try {
      await svc.markReady("run-1");
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(PolicyViolationError);
      expect((err as PolicyViolationError).rule).toBe("ready_requires_green_checks");
    }
  });
});
