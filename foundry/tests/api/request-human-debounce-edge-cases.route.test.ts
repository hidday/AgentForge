import { describe, it, expect, vi, beforeEach } from "vitest";
import Fastify from "fastify";
import { registerApiRoutes } from "../../src/api/routes.js";
import { RunState } from "../../src/domain/runState.js";
import { RunEvent } from "../../src/domain/runEvent.js";

// Covers the two `return false` short-circuit branches inside the debounce
// lookup's `events.find(...)` predicate in POST /actions/request-human:
// an event of a different type, and a matching-type event outside the
// debounce window. request-human.route.test.ts only exercises events that
// pass both checks (or fail on the reason comparison), never these two.

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
  const mockRunRepo = { findById: vi.fn().mockResolvedValue(makeRun()), findAll: vi.fn() };
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

  const notificationService = {
    isConfigured: () => true,
    sendHumanRequest: vi.fn().mockResolvedValue({
      slack: { attempted: true, ok: true },
      email: { attempted: false, ok: false },
    }),
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
    { notificationService: notificationService as never, debounceHours: 6 },
  );
  await app.ready();

  return { app, mockEventRepo };
}

describe("POST /api/runs/:id/actions/request-human — debounce predicate edge cases", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("ignores a recent event of a different eventType (not HUMAN_REQUESTED)", async () => {
    const { app, mockEventRepo } = await buildApp([
      {
        eventType: "STATE_TRANSITION",
        createdAt: new Date(Date.now() - 60 * 60 * 1000),
        payloadJson: { reason: "plan_ambiguous" },
      },
    ]);

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/request-human",
      payload: { reason: "plan_ambiguous", summary: "Need a human decision" },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ debounced: false });
    expect(mockEventRepo.create).toHaveBeenCalledTimes(1);
  });

  it("ignores a matching-type HUMAN_REQUESTED event that is outside the debounce window", async () => {
    const { app, mockEventRepo } = await buildApp([
      {
        eventType: RunEvent.HUMAN_REQUESTED,
        createdAt: new Date(Date.now() - 7 * 60 * 60 * 1000), // 7h ago, window is 6h
        payloadJson: { reason: "plan_ambiguous" },
      },
    ]);

    const res = await app.inject({
      method: "POST",
      url: "/api/runs/run-1/actions/request-human",
      payload: { reason: "plan_ambiguous", summary: "Need a human decision again" },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ debounced: false });
    expect(mockEventRepo.create).toHaveBeenCalledTimes(1);
  });
});
