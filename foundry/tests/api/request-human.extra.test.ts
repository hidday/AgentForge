import { describe, it, expect, vi } from "vitest";
import Fastify from "fastify";
import { registerApiRoutes } from "../../src/api/routes.js";
import { RunState } from "../../src/domain/runState.js";
import { RunEvent } from "../../src/domain/runEvent.js";

function makeRun() {
  return {
    id: "run-1",
    linearIssueId: "LIN-1",
    linearIssueIdentifier: "LIN-1",
    linearIssueDescription: "Test issue",
    linearIssueTitle: "Add login",
    linearIssueUrl: "https://linear.app/team/issue/LIN-1",
    repo: "test-repo",
    branchName: null,
    prNumber: null,
    state: RunState.AwaitingPlanApproval,
    planVersion: 1,
    approvedPlanVersion: null,
    plannerRuntime: null,
    executorRuntime: null,
    reviewerRuntime: null,
    remediationRuntime: null,
    workingDirectory: "/tmp",
    latestArtifactVersion: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

async function buildApp(existingEvents: { eventType: string; createdAt: Date; payloadJson: unknown }[]) {
  const run = makeRun();
  const mockRunRepo = { findById: vi.fn().mockResolvedValue(run), findAll: vi.fn() };
  const mockArtifactRepo = {
    findByRunId: vi.fn().mockResolvedValue([]),
    findLatestByType: vi.fn().mockResolvedValue(null),
  };
  const mockEventRepo = {
    findByRunId: vi.fn().mockResolvedValue(existingEvents),
    create: vi.fn().mockResolvedValue({}),
  };

  const mockOrchestrator = {
    getRunRepo: () => mockRunRepo,
    getArtifactRepo: () => mockArtifactRepo,
    getEventRepo: () => mockEventRepo,
  };

  const mockEmitter = { on: vi.fn(), off: vi.fn() };
  const mockProcessRunner = {
    getActiveProcesses: vi.fn().mockReturnValue([]),
    getProcessOutput: vi.fn().mockReturnValue(null),
  };

  const app = Fastify({ logger: false });
  registerApiRoutes(
    app,
    mockOrchestrator as never,
    mockEmitter as never,
    mockProcessRunner as never,
    undefined,
    { debounceHours: 6 },
  );
  await app.ready();
  return { app, mockEventRepo };
}

describe("POST /api/runs/:id/actions/request-human -- debounce cutoff boundary", () => {
  it("does NOT debounce when a matching-reason event exists but is older than the debounce window", async () => {
    const staleTs = new Date(Date.now() - 7 * 60 * 60 * 1000); // 7h ago, window is 6h
    const { app, mockEventRepo } = await buildApp([
      {
        eventType: RunEvent.HUMAN_REQUESTED,
        createdAt: staleTs,
        payloadJson: { reason: "plan_ambiguous" },
      },
    ]);

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/request-human",
      payload: { reason: "plan_ambiguous", summary: "Still unclear after a while" },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as { debounced: boolean };
    expect(body.debounced).toBe(false);
    expect(mockEventRepo.create).toHaveBeenCalledTimes(1);
  });
});
