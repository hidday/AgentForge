import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { registerApiRoutes } from "../../src/api/routes.js";
import { RunState } from "../../src/domain/runState.js";
import type { DashboardEvent } from "../../src/api/runEventEmitter.js";

function makeRun(overrides: Record<string, unknown> = {}) {
  return {
    id: "run-1",
    linearIssueId: "LIN-1",
    linearIssueIdentifier: "ENG-1",
    linearIssueDescription: "Description",
    linearIssueTitle: "Title",
    linearIssueUrl: "https://linear.app/team/issue/ENG-1",
    repo: "test-repo",
    branchName: "ai/run-1",
    prNumber: null,
    state: RunState.Todo,
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
    ...overrides,
  };
}

function buildOrchestrator(overrides: Record<string, unknown> = {}) {
  const mockRunRepo = { findById: vi.fn(), findAll: vi.fn() };
  const mockArtifactRepo = {
    findByRunId: vi.fn().mockResolvedValue([]),
    findLatestByType: vi.fn().mockResolvedValue(null),
  };
  const mockEventRepo = { findByRunId: vi.fn().mockResolvedValue([]), create: vi.fn() };

  const mockOrchestrator = {
    getRunRepo: () => mockRunRepo,
    getArtifactRepo: () => mockArtifactRepo,
    getEventRepo: () => mockEventRepo,
    answerQuestions: vi.fn(),
    approvePlan: vi.fn(),
    rejectPlan: vi.fn(),
    approveHumanReview: vi.fn(),
    handleCommand: vi.fn(),
    runPlanRevision: vi.fn(),
    runPlanReview: vi.fn(),
    runExecution: vi.fn(),
    runReview: vi.fn(),
    runRemediation: vi.fn(),
    runManualReReview: vi.fn(),
    runManualPlanRevision: vi.fn(),
    retryRun: vi.fn(),
    getAgentSkillRepo: vi.fn().mockReturnValue(null),
    ...overrides,
  };

  return { mockOrchestrator, mockRunRepo, mockArtifactRepo, mockEventRepo };
}

async function buildApp(opts: {
  orchestratorOverrides?: Record<string, unknown>;
  linearPollService?: Record<string, unknown>;
} = {}) {
  const { mockOrchestrator, mockRunRepo, mockArtifactRepo, mockEventRepo } = buildOrchestrator(
    opts.orchestratorOverrides,
  );

  const mockEmitter = { on: vi.fn(), off: vi.fn(), emitChatReply: vi.fn() };

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
    opts.linearPollService as never,
  );

  await app.ready();
  return { app, mockOrchestrator, mockRunRepo, mockArtifactRepo, mockEventRepo, mockProcessRunner, mockEmitter };
}

describe("routes.ts remaining coverage gaps", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("GET /api/runs", () => {
    it("returns runs filtered by state query param", async () => {
      const { app, mockRunRepo } = await buildApp();
      mockRunRepo.findAll.mockResolvedValue([makeRun()]);

      const res = await app.inject({ method: "GET", url: "/api/runs?state=Todo" });

      expect(res.statusCode).toBe(200);
      expect(mockRunRepo.findAll).toHaveBeenCalledWith("Todo");
      const body = res.json() as { runs: unknown[] };
      expect(body.runs).toHaveLength(1);
    });

    it("returns all runs when no state query param is given", async () => {
      const { app, mockRunRepo } = await buildApp();
      mockRunRepo.findAll.mockResolvedValue([]);

      const res = await app.inject({ method: "GET", url: "/api/runs" });

      expect(res.statusCode).toBe(200);
      expect(mockRunRepo.findAll).toHaveBeenCalledWith(undefined);
    });
  });

  describe("GET /api/runs/:id", () => {
    it("returns run with artifacts and events when found", async () => {
      const run = makeRun();
      const { app, mockRunRepo, mockArtifactRepo, mockEventRepo } = await buildApp();
      mockRunRepo.findById.mockResolvedValue(run);
      mockArtifactRepo.findByRunId.mockResolvedValue([{ id: "art-1" }]);
      mockEventRepo.findByRunId.mockResolvedValue([{ id: "evt-1" }]);

      const res = await app.inject({ method: "GET", url: "/api/runs/run-1" });

      expect(res.statusCode).toBe(200);
      const body = res.json() as { run: unknown; artifacts: unknown[]; events: unknown[] };
      expect(body.run).toMatchObject({ id: "run-1" });
      expect(body.artifacts).toEqual([{ id: "art-1" }]);
      expect(body.events).toEqual([{ id: "evt-1" }]);
    });

    it("returns 404 when run is not found", async () => {
      const { app, mockRunRepo } = await buildApp();
      mockRunRepo.findById.mockResolvedValue(null);

      const res = await app.inject({ method: "GET", url: "/api/runs/missing" });

      expect(res.statusCode).toBe(404);
    });
  });

  describe("GET /api/runs/:id/artifacts", () => {
    it("returns artifacts for a found run", async () => {
      const { app, mockRunRepo, mockArtifactRepo } = await buildApp();
      mockRunRepo.findById.mockResolvedValue(makeRun());
      mockArtifactRepo.findByRunId.mockResolvedValue([{ id: "art-1" }]);

      const res = await app.inject({ method: "GET", url: "/api/runs/run-1/artifacts" });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ artifacts: [{ id: "art-1" }] });
    });

    it("returns 404 when run is not found", async () => {
      const { app, mockRunRepo } = await buildApp();
      mockRunRepo.findById.mockResolvedValue(null);

      const res = await app.inject({ method: "GET", url: "/api/runs/missing/artifacts" });

      expect(res.statusCode).toBe(404);
    });
  });

  describe("GET /api/runs/:id/events", () => {
    it("returns events for a found run", async () => {
      const { app, mockRunRepo, mockEventRepo } = await buildApp();
      mockRunRepo.findById.mockResolvedValue(makeRun());
      mockEventRepo.findByRunId.mockResolvedValue([{ id: "evt-1" }]);

      const res = await app.inject({ method: "GET", url: "/api/runs/run-1/events" });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ events: [{ id: "evt-1" }] });
    });

    it("returns 404 when run is not found", async () => {
      const { app, mockRunRepo } = await buildApp();
      mockRunRepo.findById.mockResolvedValue(null);

      const res = await app.inject({ method: "GET", url: "/api/runs/missing/events" });

      expect(res.statusCode).toBe(404);
    });
  });

  describe("POST /api/runs/:id/actions/approve-plan", () => {
    it("approves the plan, triggers execution in the background, and returns the new state", async () => {
      const run = makeRun({ state: RunState.Implementing });
      const { app, mockOrchestrator } = await buildApp();
      mockOrchestrator.approvePlan.mockResolvedValue(run);
      mockOrchestrator.runExecution.mockResolvedValue(undefined);

      const res = await app.inject({
        method: "POST",
        url: "/api/runs/run-1/actions/approve-plan",
        payload: { note: "  looks good  " },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ ok: true, state: RunState.Implementing });
      expect(mockOrchestrator.approvePlan).toHaveBeenCalledWith("run-1", { note: "looks good" });
      expect(mockOrchestrator.runExecution).toHaveBeenCalledWith("run-1", { note: "looks good" });
    });

    it("returns 400 when approvePlan throws", async () => {
      const { app, mockOrchestrator } = await buildApp();
      mockOrchestrator.approvePlan.mockRejectedValue(new Error("Cannot approve"));

      const res = await app.inject({
        method: "POST",
        url: "/api/runs/run-1/actions/approve-plan",
      });

      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual({ error: "Cannot approve" });
    });
  });

  describe("POST /api/runs/:id/actions/re-review-plan", () => {
    it("triggers manual re-review and returns ok with runId", async () => {
      const { app, mockOrchestrator } = await buildApp();
      mockOrchestrator.runManualReReview.mockResolvedValue(undefined);

      const res = await app.inject({
        method: "POST",
        url: "/api/runs/run-1/actions/re-review-plan",
        payload: { note: "re-check" },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ ok: true, runId: "run-1" });
      expect(mockOrchestrator.runManualReReview).toHaveBeenCalledWith("run-1", { note: "re-check" });
    });
  });

  describe("POST /api/runs/:id/actions/revise-plan", () => {
    it("triggers manual plan revision and returns ok with runId", async () => {
      const { app, mockOrchestrator } = await buildApp();
      mockOrchestrator.runManualPlanRevision.mockResolvedValue(undefined);

      const res = await app.inject({
        method: "POST",
        url: "/api/runs/run-1/actions/revise-plan",
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ ok: true, runId: "run-1" });
      expect(mockOrchestrator.runManualPlanRevision).toHaveBeenCalledWith("run-1", {
        note: undefined,
      });
    });
  });

  describe("POST /api/runs/:id/actions/approve-review", () => {
    it("approves human review and returns the new state", async () => {
      const run = makeRun({ state: RunState.Done });
      const { app, mockOrchestrator } = await buildApp();
      mockOrchestrator.approveHumanReview.mockResolvedValue(run);

      const res = await app.inject({
        method: "POST",
        url: "/api/runs/run-1/actions/approve-review",
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ ok: true, state: RunState.Done });
      expect(mockOrchestrator.approveHumanReview).toHaveBeenCalledWith("run-1");
    });

    it("returns 400 when approveHumanReview throws", async () => {
      const { app, mockOrchestrator } = await buildApp();
      mockOrchestrator.approveHumanReview.mockRejectedValue(new Error("Wrong state"));

      const res = await app.inject({
        method: "POST",
        url: "/api/runs/run-1/actions/approve-review",
      });

      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual({ error: "Wrong state" });
    });
  });

  describe("POST /api/runs/:id/actions/pause", () => {
    it("sends a pause-ai command when the run is found", async () => {
      const run = makeRun();
      const { app, mockRunRepo, mockOrchestrator } = await buildApp();
      mockRunRepo.findById.mockResolvedValue(run);
      mockOrchestrator.handleCommand.mockResolvedValue(undefined);

      const res = await app.inject({ method: "POST", url: "/api/runs/run-1/actions/pause" });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ ok: true });
      expect(mockOrchestrator.handleCommand).toHaveBeenCalledWith(run.linearIssueId, {
        type: "pause-ai",
      });
    });

    it("returns 404 when run is not found", async () => {
      const { app, mockRunRepo } = await buildApp();
      mockRunRepo.findById.mockResolvedValue(null);

      const res = await app.inject({ method: "POST", url: "/api/runs/missing/actions/pause" });

      expect(res.statusCode).toBe(404);
    });

    it("returns 400 when handleCommand throws", async () => {
      const { app, mockRunRepo, mockOrchestrator } = await buildApp();
      mockRunRepo.findById.mockResolvedValue(makeRun());
      mockOrchestrator.handleCommand.mockRejectedValue(new Error("boom"));

      const res = await app.inject({ method: "POST", url: "/api/runs/run-1/actions/pause" });

      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual({ error: "boom" });
    });
  });

  describe("POST /api/runs/:id/actions/resume", () => {
    it("sends a resume-ai command when the run is found", async () => {
      const run = makeRun();
      const { app, mockRunRepo, mockOrchestrator } = await buildApp();
      mockRunRepo.findById.mockResolvedValue(run);
      mockOrchestrator.handleCommand.mockResolvedValue(undefined);

      const res = await app.inject({ method: "POST", url: "/api/runs/run-1/actions/resume" });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ ok: true });
      expect(mockOrchestrator.handleCommand).toHaveBeenCalledWith(run.linearIssueId, {
        type: "resume-ai",
      });
    });

    it("returns 404 when run is not found", async () => {
      const { app, mockRunRepo } = await buildApp();
      mockRunRepo.findById.mockResolvedValue(null);

      const res = await app.inject({ method: "POST", url: "/api/runs/missing/actions/resume" });

      expect(res.statusCode).toBe(404);
    });

    it("returns 400 when handleCommand throws", async () => {
      const { app, mockRunRepo, mockOrchestrator } = await buildApp();
      mockRunRepo.findById.mockResolvedValue(makeRun());
      mockOrchestrator.handleCommand.mockRejectedValue(new Error("boom"));

      const res = await app.inject({ method: "POST", url: "/api/runs/run-1/actions/resume" });

      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual({ error: "boom" });
    });
  });

  describe("POST /api/runs/:id/actions/retry", () => {
    it("returns 404 when run is not found", async () => {
      const { app, mockRunRepo } = await buildApp();
      mockRunRepo.findById.mockResolvedValue(null);

      const res = await app.inject({ method: "POST", url: "/api/runs/missing/actions/retry" });

      expect(res.statusCode).toBe(404);
    });

    it("returns 400 for a non-retryable state", async () => {
      const { app, mockRunRepo } = await buildApp();
      mockRunRepo.findById.mockResolvedValue(makeRun({ state: RunState.Done }));

      const res = await app.inject({ method: "POST", url: "/api/runs/run-1/actions/retry" });

      expect(res.statusCode).toBe(400);
      const body = res.json() as { error: string };
      expect(body.error).toContain("Retry is not supported");
    });

    const retryMatrix: [RunState, string][] = [
      [RunState.Todo, "retryRun"],
      [RunState.Planning, "runPlanning"],
      [RunState.PlanRevision, "runPlanRevision"],
      [RunState.PlanReview, "runPlanReview"],
      [RunState.Implementing, "runExecution"],
      [RunState.AIReview, "runReview"],
      [RunState.AddressingReview, "runRemediation"],
    ];

    it.each(retryMatrix)("triggers the right orchestrator method for state %s", async (state, method) => {
      const { app, mockRunRepo, mockOrchestrator } = await buildApp({
        orchestratorOverrides: { runPlanning: vi.fn().mockResolvedValue(undefined) },
      });
      mockRunRepo.findById.mockResolvedValue(makeRun({ state }));
      (mockOrchestrator as Record<string, ReturnType<typeof vi.fn>>)[method].mockResolvedValue(
        undefined,
      );

      const res = await app.inject({ method: "POST", url: "/api/runs/run-1/actions/retry" });

      expect(res.statusCode).toBe(200);
      const body = res.json() as { ok: boolean; runId: string; state: string; retrying: boolean };
      expect(body).toEqual({ ok: true, runId: "run-1", state, retrying: true });
      expect((mockOrchestrator as Record<string, ReturnType<typeof vi.fn>>)[method]).toHaveBeenCalledWith(
        "run-1",
      );
    });

    it("logs but does not throw when the fire-and-forget retry rejects", async () => {
      const { app, mockRunRepo, mockOrchestrator } = await buildApp();
      mockRunRepo.findById.mockResolvedValue(makeRun({ state: RunState.Todo }));
      mockOrchestrator.retryRun.mockRejectedValue(new Error("retry failed"));

      const res = await app.inject({ method: "POST", url: "/api/runs/run-1/actions/retry" });

      expect(res.statusCode).toBe(200);
      // give the fire-and-forget rejection a tick to settle without throwing
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  });

  describe("GET /api/runs/:id/summary", () => {
    it("returns 404 when run is not found", async () => {
      const { app, mockRunRepo } = await buildApp();
      mockRunRepo.findById.mockResolvedValue(null);

      const res = await app.inject({ method: "GET", url: "/api/runs/missing/summary" });

      expect(res.statusCode).toBe(404);
    });

    it("returns null plan/planReview/review/executionReport when no artifacts exist", async () => {
      const run = makeRun();
      const { app, mockRunRepo } = await buildApp();
      mockRunRepo.findById.mockResolvedValue(run);

      const res = await app.inject({ method: "GET", url: "/api/runs/run-1/summary" });

      expect(res.statusCode).toBe(200);
      const body = res.json() as {
        plan: unknown;
        planReview: unknown;
        review: unknown;
        executionReport: unknown;
        run: { id: string; linearIssue: { id: string } };
      };
      expect(body.plan).toBeNull();
      expect(body.planReview).toBeNull();
      expect(body.review).toBeNull();
      expect(body.executionReport).toBeNull();
      expect(body.run.id).toBe("run-1");
      expect(body.run.linearIssue.id).toBe(run.linearIssueId);
    });

    it("summarizes plan risks that are strings, objects with description, and other shapes", async () => {
      const run = makeRun();
      const { app, mockRunRepo, mockArtifactRepo } = await buildApp();
      mockRunRepo.findById.mockResolvedValue(run);
      mockArtifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
        if (type === "Plan") {
          return Promise.resolve({
            version: 2,
            payloadJson: {
              summary: "Do the thing",
              confidence: 0.9,
              openQuestions: [{ id: "q1", question: "Which env?", requiredForExecution: true }],
              steps: [{ id: "s1", title: "Step 1", description: "Do step 1" }],
              risks: ["plain risk", { description: "object risk" }, { weird: true }, 42],
              testPlan: "run unit tests",
            },
          });
        }
        return Promise.resolve(null);
      });

      const res = await app.inject({ method: "GET", url: "/api/runs/run-1/summary" });

      expect(res.statusCode).toBe(200);
      const body = res.json() as {
        plan: { risks: string[]; riskCount: number; stepCount: number; summary: string };
      };
      expect(body.plan.summary).toBe("Do the thing");
      expect(body.plan.stepCount).toBe(1);
      expect(body.plan.riskCount).toBe(4);
      expect(body.plan.risks[0]).toBe("plain risk");
      expect(body.plan.risks[1]).toBe("object risk");
      expect(body.plan.risks[2]).toBe(JSON.stringify({ weird: true }));
      expect(body.plan.risks[3]).toBe("42");
    });

    it("includes planReview, review, and executionReport payloads when present", async () => {
      const run = makeRun();
      const { app, mockRunRepo, mockArtifactRepo } = await buildApp();
      mockRunRepo.findById.mockResolvedValue(run);
      mockArtifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
        if (type === "PlanReview") {
          return Promise.resolve({ version: 1, payloadJson: { verdict: "approve" } });
        }
        if (type === "Review") {
          return Promise.resolve({ version: 1, payloadJson: { verdict: "pass" } });
        }
        if (type === "ExecutionReport") {
          return Promise.resolve({
            version: 3,
            payloadJson: { executionVersion: 3, score: 0.8, scoreRationale: "solid" },
          });
        }
        return Promise.resolve(null);
      });

      const res = await app.inject({ method: "GET", url: "/api/runs/run-1/summary" });

      expect(res.statusCode).toBe(200);
      const body = res.json() as {
        planReview: { version: number; payload: unknown };
        review: { version: number; payload: unknown };
        executionReport: { version: number; executionVersion: number; score: number };
      };
      expect(body.planReview).toEqual({ version: 1, payload: { verdict: "approve" } });
      expect(body.review).toEqual({ version: 1, payload: { verdict: "pass" } });
      expect(body.executionReport.executionVersion).toBe(3);
      expect(body.executionReport.score).toBe(0.8);
    });

    it("falls back to artifact version for executionReport.executionVersion when payload lacks it", async () => {
      const run = makeRun();
      const { app, mockRunRepo, mockArtifactRepo } = await buildApp();
      mockRunRepo.findById.mockResolvedValue(run);
      mockArtifactRepo.findLatestByType.mockImplementation((_runId: string, type: string) => {
        if (type === "ExecutionReport") {
          return Promise.resolve({ version: 5, payloadJson: null });
        }
        return Promise.resolve(null);
      });

      const res = await app.inject({ method: "GET", url: "/api/runs/run-1/summary" });

      const body = res.json() as { executionReport: { executionVersion: number } };
      expect(body.executionReport.executionVersion).toBe(5);
    });
  });

  describe("GET /api/processes", () => {
    it("returns all active processes when no runId filter is given", async () => {
      const { app, mockProcessRunner } = await buildApp();
      mockProcessRunner.getActiveProcesses.mockReturnValue([
        { id: "p1", runId: "run-1" },
        { id: "p2", runId: "run-2" },
      ]);

      const res = await app.inject({ method: "GET", url: "/api/processes" });

      expect(res.statusCode).toBe(200);
      const body = res.json() as { processes: { id: string }[] };
      expect(body.processes).toHaveLength(2);
    });

    it("filters active processes by runId", async () => {
      const { app, mockProcessRunner } = await buildApp();
      mockProcessRunner.getActiveProcesses.mockReturnValue([
        { id: "p1", runId: "run-1" },
        { id: "p2", runId: "run-2" },
      ]);

      const res = await app.inject({ method: "GET", url: "/api/processes?runId=run-2" });

      expect(res.statusCode).toBe(200);
      const body = res.json() as { processes: { id: string; runId: string }[] };
      expect(body.processes).toEqual([{ id: "p2", runId: "run-2" }]);
    });
  });

  describe("GET /api/processes/:id/output", () => {
    it("returns output when the process exists", async () => {
      const { app, mockProcessRunner } = await buildApp();
      mockProcessRunner.getProcessOutput.mockReturnValue("log output");

      const res = await app.inject({ method: "GET", url: "/api/processes/p1/output" });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ processId: "p1", output: "log output" });
    });

    it("returns 404 when no output is available", async () => {
      const { app, mockProcessRunner } = await buildApp();
      mockProcessRunner.getProcessOutput.mockReturnValue(null);

      const res = await app.inject({ method: "GET", url: "/api/processes/missing/output" });

      expect(res.statusCode).toBe(404);
    });
  });

  describe("GET /api/linear/pending", () => {
    it("returns 501 when linearPollService is not configured", async () => {
      const { app } = await buildApp();

      const res = await app.inject({ method: "GET", url: "/api/linear/pending" });

      expect(res.statusCode).toBe(501);
    });

    it("returns discovered issues on success", async () => {
      const discoverPendingIssues = vi.fn().mockResolvedValue([{ id: "issue-1" }]);
      const { app } = await buildApp({
        linearPollService: { discoverPendingIssues },
      });

      const res = await app.inject({ method: "GET", url: "/api/linear/pending" });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ issues: [{ id: "issue-1" }] });
      expect(discoverPendingIssues).toHaveBeenCalledOnce();
    });

    it("returns 500 when discoverPendingIssues throws", async () => {
      const discoverPendingIssues = vi.fn().mockRejectedValue(new Error("Linear API down"));
      const { app } = await buildApp({
        linearPollService: { discoverPendingIssues },
      });

      const res = await app.inject({ method: "GET", url: "/api/linear/pending" });

      expect(res.statusCode).toBe(500);
      expect(res.json()).toEqual({ error: "Linear API down" });
    });
  });

  describe("POST /api/linear/ingest", () => {
    it("returns 501 when linearPollService is not configured", async () => {
      const { app } = await buildApp();

      const res = await app.inject({
        method: "POST",
        url: "/api/linear/ingest",
        payload: { issueIds: ["issue-1"] },
      });

      expect(res.statusCode).toBe(501);
    });

    it("returns 400 when issueIds is missing or empty", async () => {
      const { app } = await buildApp({
        linearPollService: { startRunsForIssues: vi.fn() },
      });

      const res = await app.inject({
        method: "POST",
        url: "/api/linear/ingest",
        payload: { issueIds: [] },
      });

      expect(res.statusCode).toBe(400);
    });

    it("starts runs for the given issue ids on success", async () => {
      const startRunsForIssues = vi
        .fn()
        .mockResolvedValue({ started: ["issue-1"], skipped: [] });
      const { app } = await buildApp({
        linearPollService: { startRunsForIssues },
      });

      const res = await app.inject({
        method: "POST",
        url: "/api/linear/ingest",
        payload: { issueIds: ["issue-1"] },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ ok: true, started: ["issue-1"], skipped: [] });
      expect(startRunsForIssues).toHaveBeenCalledWith(["issue-1"]);
    });

    it("returns 500 when startRunsForIssues throws", async () => {
      const startRunsForIssues = vi.fn().mockRejectedValue(new Error("DB unavailable"));
      const { app } = await buildApp({
        linearPollService: { startRunsForIssues },
      });

      const res = await app.inject({
        method: "POST",
        url: "/api/linear/ingest",
        payload: { issueIds: ["issue-1"] },
      });

      expect(res.statusCode).toBe(500);
      expect(res.json()).toEqual({ error: "DB unavailable" });
    });
  });

  describe("GET /api/events/stream", () => {
    // Fastify's `.inject()` cannot exercise a handler that keeps the
    // connection open forever (raw writes + heartbeat interval, no
    // reply.send()). Instead we capture the handler registered via
    // `app.get` on a minimal fake FastifyInstance and invoke it directly
    // with fake request/reply objects.
    let capturedHandler: ((request: unknown, reply: unknown) => void) | undefined;

    function buildFakeAppForStream(mockEmitter: { on: ReturnType<typeof vi.fn>; off: ReturnType<typeof vi.fn> }) {
      const { mockOrchestrator } = buildOrchestrator();
      const mockProcessRunner = {
        getActiveProcesses: vi.fn().mockReturnValue([]),
        getProcessOutput: vi.fn().mockReturnValue(null),
      };

      const fakeApp = {
        get: vi.fn((path: string, handler: (request: unknown, reply: unknown) => void) => {
          if (path === "/api/events/stream") {
            capturedHandler = handler;
          }
        }),
        post: vi.fn(),
        log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      };

      registerApiRoutes(
        fakeApp as unknown as FastifyInstance,
        mockOrchestrator as never,
        mockEmitter as never,
        mockProcessRunner as never,
      );

      return fakeApp;
    }

    beforeEach(() => {
      capturedHandler = undefined;
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("writes SSE headers, forwards dashboard events, and heartbeats", () => {
      const mockEmitter = { on: vi.fn(), off: vi.fn() };
      buildFakeAppForStream(mockEmitter);
      expect(capturedHandler).toBeDefined();

      const rawWrites: string[] = [];
      const closeCallbacks: Array<() => void> = [];
      const reply = {
        raw: {
          writeHead: vi.fn(),
          write: vi.fn((chunk: string) => {
            rawWrites.push(chunk);
          }),
        },
      };
      const request = {
        raw: {
          on: vi.fn((event: string, cb: () => void) => {
            if (event === "close") closeCallbacks.push(cb);
          }),
        },
      };

      capturedHandler!(request, reply);

      expect(reply.raw.writeHead).toHaveBeenCalledWith(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });
      expect(rawWrites).toContain(":\n\n");
      expect(mockEmitter.on).toHaveBeenCalledWith("dashboard", expect.any(Function));

      const dashboardHandler = mockEmitter.on.mock.calls.find((c) => c[0] === "dashboard")?.[1] as (
        event: DashboardEvent,
      ) => void;
      const event: DashboardEvent = {
        type: "run:state-changed",
        runId: "run-1",
        from: "Todo",
        to: "Planning",
        timestamp: "2026-01-01T00:00:00.000Z",
      };
      dashboardHandler(event);

      expect(rawWrites.some((w) => w === `data: ${JSON.stringify(event)}\n\n`)).toBe(true);

      // Heartbeat fires every 15s.
      vi.advanceTimersByTime(15_000);
      expect(rawWrites.filter((w) => w === ":\n\n").length).toBeGreaterThanOrEqual(2);

      // Closing the connection cleans up the listener and stops the heartbeat.
      expect(closeCallbacks).toHaveLength(1);
      closeCallbacks[0]();
      expect(mockEmitter.off).toHaveBeenCalledWith("dashboard", dashboardHandler);

      const writesAfterClose = rawWrites.length;
      vi.advanceTimersByTime(30_000);
      expect(rawWrites.length).toBe(writesAfterClose);
    });
  });
});
