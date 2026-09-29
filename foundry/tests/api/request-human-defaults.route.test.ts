import { describe, it, expect, vi, beforeEach } from "vitest";
import Fastify from "fastify";
import { registerApiRoutes } from "../../src/api/routes.js";
import { RunState } from "../../src/domain/runState.js";

// Covers branches request-human.route.test.ts leaves out: the run-not-found
// path, and the default debounceHours/uiBaseUrl fallbacks used when
// RegisterApiRoutesOptions omits them.

function makeRun() {
  return {
    id: "run-1",
    linearIssueId: "LIN-1",
    linearIssueIdentifier: null,
    linearIssueDescription: null,
    linearIssueTitle: "Add login",
    linearIssueUrl: null,
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

async function buildApp() {
  const mockRunRepo = { findById: vi.fn(), findAll: vi.fn() };
  const mockArtifactRepo = {
    findByRunId: vi.fn().mockResolvedValue([]),
    findLatestByType: vi.fn().mockResolvedValue(null),
  };
  const mockEventRepo = {
    findByRunId: vi.fn().mockResolvedValue([]),
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
  // No `options` passed at all: exercises the debounceHours ?? 6 and
  // uiBaseUrl ?? "http://localhost:5173" defaults, and notificationService
  // being undefined.
  registerApiRoutes(app, mockOrchestrator as never, mockEmitter as never, mockProcessRunner as never);
  await app.ready();

  return { app, mockRunRepo, mockEventRepo };
}

describe("POST /api/runs/:id/actions/request-human — defaults and not-found", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 404 when the run does not exist", async () => {
    const { app, mockRunRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(null);

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/missing/actions/request-human",
      payload: { reason: "other", summary: "Need a human" },
    });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: "Run not found" });
  });

  it("uses the default debounceHours (6) and uiBaseUrl when options are omitted", async () => {
    const { app, mockRunRepo, mockEventRepo } = await buildApp();
    mockRunRepo.findById.mockResolvedValue(makeRun());

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/request-human",
      payload: { reason: "other", summary: "Need a human, please" },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as { ok: boolean; debounced: boolean; notified: unknown };
    expect(body.ok).toBe(true);
    expect(body.debounced).toBe(false);
    expect(body.notified).toEqual({ slack: false, email: false });

    expect(mockEventRepo.create).toHaveBeenCalledTimes(1);
    const eventArgs = mockEventRepo.create.mock.calls[0][0] as { payloadJson: { runUrl: string } };
    expect(eventArgs.payloadJson.runUrl).toBe("http://localhost:5173/runs/run-1");
  });
});
