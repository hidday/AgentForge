import { describe, it, expect, vi, afterEach } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { registerApiRoutes } from "../../src/api/routes.js";
import { RunState } from "../../src/domain/runState.js";

const createdAt = new Date("2026-02-01T10:00:00.000Z");
const updatedAt = new Date("2026-02-02T11:00:00.000Z");

function makeRun(overrides: Record<string, unknown> = {}) {
  return {
    id: "run-1",
    linearIssueId: "LIN-1",
    linearIssueIdentifier: "ENG-7",
    linearIssueDescription: "Describe",
    linearIssueTitle: "Add feature",
    linearIssueUrl: "https://linear.app/x/ENG-7",
    repo: "org/repo",
    branchName: "feat/eng-7",
    prNumber: 12,
    state: RunState.Implementing,
    planVersion: 2,
    approvedPlanVersion: 2,
    plannerRuntime: null,
    executorRuntime: null,
    reviewerRuntime: null,
    remediationRuntime: null,
    workingDirectory: "/tmp",
    latestArtifactVersion: 4,
    createdAt,
    updatedAt,
    ...overrides,
  };
}

interface BuildOpts {
  linear?: { discoverPendingIssues: ReturnType<typeof vi.fn>; startRunsForIssues: ReturnType<typeof vi.fn> };
}

async function buildApp(opts: BuildOpts = {}) {
  const runRepo = { findById: vi.fn(), findAll: vi.fn() };
  const artifactRepo = { findByRunId: vi.fn(), findLatestByType: vi.fn() };
  const eventRepo = { findByRunId: vi.fn() };
  const orchestrator = {
    getRunRepo: () => runRepo,
    getArtifactRepo: () => artifactRepo,
    getEventRepo: () => eventRepo,
  };
  const processRunner = { getActiveProcesses: vi.fn(), getProcessOutput: vi.fn() };

  const app: FastifyInstance = Fastify({ logger: false });
  registerApiRoutes(
    app,
    orchestrator as never,
    { on: vi.fn(), off: vi.fn() } as never,
    processRunner as never,
    opts.linear as never,
  );
  await app.ready();
  return { app, runRepo, artifactRepo, eventRepo, processRunner };
}

let current: FastifyInstance | undefined;
afterEach(async () => {
  await current?.close();
  current = undefined;
});

async function setup(opts: BuildOpts = {}) {
  const ctx = await buildApp(opts);
  current = ctx.app;
  return ctx;
}

describe("GET /api/runs", () => {
  it("returns all runs when no state filter is given", async () => {
    const { app, runRepo } = await setup();
    runRepo.findAll.mockResolvedValue([makeRun()]);

    const res = await app.inject({ method: "GET", url: "/api/runs" });

    expect(res.statusCode).toBe(200);
    expect(res.json().runs).toHaveLength(1);
    expect(res.json().runs[0].id).toBe("run-1");
    expect(runRepo.findAll).toHaveBeenCalledWith(undefined);
  });

  it("forwards the state query param to the repository", async () => {
    const { app, runRepo } = await setup();
    runRepo.findAll.mockResolvedValue([]);

    const res = await app.inject({ method: "GET", url: "/api/runs?state=Done" });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ runs: [] });
    expect(runRepo.findAll).toHaveBeenCalledWith("Done");
  });
});

describe("GET /api/runs/:id", () => {
  it("returns the run with its artifacts and events", async () => {
    const { app, runRepo, artifactRepo, eventRepo } = await setup();
    runRepo.findById.mockResolvedValue(makeRun());
    artifactRepo.findByRunId.mockResolvedValue([{ id: "a1", type: "Plan" }]);
    eventRepo.findByRunId.mockResolvedValue([{ id: "e1", eventType: "RUN_CREATED" }]);

    const res = await app.inject({ method: "GET", url: "/api/runs/run-1" });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.run.id).toBe("run-1");
    expect(body.artifacts).toEqual([{ id: "a1", type: "Plan" }]);
    expect(body.events).toEqual([{ id: "e1", eventType: "RUN_CREATED" }]);
    expect(artifactRepo.findByRunId).toHaveBeenCalledWith("run-1");
    expect(eventRepo.findByRunId).toHaveBeenCalledWith("run-1");
  });

  it("returns 404 and skips the artifact/event lookup when the run is missing", async () => {
    const { app, runRepo, artifactRepo, eventRepo } = await setup();
    runRepo.findById.mockResolvedValue(null);

    const res = await app.inject({ method: "GET", url: "/api/runs/missing" });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: "Run not found" });
    expect(runRepo.findById).toHaveBeenCalledWith("missing");
    expect(artifactRepo.findByRunId).not.toHaveBeenCalled();
    expect(eventRepo.findByRunId).not.toHaveBeenCalled();
  });
});

describe("GET /api/runs/:id/artifacts", () => {
  it("returns the run's artifacts", async () => {
    const { app, runRepo, artifactRepo } = await setup();
    runRepo.findById.mockResolvedValue(makeRun());
    artifactRepo.findByRunId.mockResolvedValue([{ id: "a1" }, { id: "a2" }]);

    const res = await app.inject({ method: "GET", url: "/api/runs/run-1/artifacts" });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ artifacts: [{ id: "a1" }, { id: "a2" }] });
  });

  it("returns 404 for an unknown run", async () => {
    const { app, runRepo, artifactRepo } = await setup();
    runRepo.findById.mockResolvedValue(null);

    const res = await app.inject({ method: "GET", url: "/api/runs/nope/artifacts" });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: "Run not found" });
    expect(artifactRepo.findByRunId).not.toHaveBeenCalled();
  });
});

describe("GET /api/runs/:id/events", () => {
  it("returns the run's events", async () => {
    const { app, runRepo, eventRepo } = await setup();
    runRepo.findById.mockResolvedValue(makeRun());
    eventRepo.findByRunId.mockResolvedValue([{ id: "e1" }]);

    const res = await app.inject({ method: "GET", url: "/api/runs/run-1/events" });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ events: [{ id: "e1" }] });
    expect(eventRepo.findByRunId).toHaveBeenCalledWith("run-1");
  });

  it("returns 404 for an unknown run", async () => {
    const { app, runRepo, eventRepo } = await setup();
    runRepo.findById.mockResolvedValue(null);

    const res = await app.inject({ method: "GET", url: "/api/runs/nope/events" });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: "Run not found" });
    expect(eventRepo.findByRunId).not.toHaveBeenCalled();
  });
});

describe("GET /api/runs/:id/summary", () => {
  function stubArtifacts(
    artifactRepo: { findLatestByType: ReturnType<typeof vi.fn> },
    byType: Record<string, unknown>,
  ) {
    artifactRepo.findLatestByType.mockImplementation(async (_runId: string, type: string) =>
      byType[type] ?? null,
    );
  }

  it("returns 404 for an unknown run", async () => {
    const { app, runRepo, artifactRepo } = await setup();
    runRepo.findById.mockResolvedValue(null);

    const res = await app.inject({ method: "GET", url: "/api/runs/nope/summary" });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: "Run not found" });
    expect(artifactRepo.findLatestByType).not.toHaveBeenCalled();
  });

  it("returns run metadata and null sections when no artifacts exist", async () => {
    const { app, runRepo, artifactRepo } = await setup();
    runRepo.findById.mockResolvedValue(makeRun());
    stubArtifacts(artifactRepo, {});

    const res = await app.inject({ method: "GET", url: "/api/runs/run-1/summary" });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      run: {
        id: "run-1",
        state: RunState.Implementing,
        linearIssue: {
          id: "LIN-1",
          identifier: "ENG-7",
          title: "Add feature",
          url: "https://linear.app/x/ENG-7",
          description: "Describe",
        },
        linearIssueId: "LIN-1",
        linearIssueTitle: "Add feature",
        linearIssueUrl: "https://linear.app/x/ENG-7",
        repo: "org/repo",
        branchName: "feat/eng-7",
        prNumber: 12,
        planVersion: 2,
        approvedPlanVersion: 2,
        createdAt: createdAt.toISOString(),
        updatedAt: updatedAt.toISOString(),
      },
      plan: null,
      planReview: null,
      review: null,
      executionReport: null,
    });
    expect(artifactRepo.findLatestByType.mock.calls.map((c) => c[1]).sort()).toEqual([
      "ExecutionReport",
      "Plan",
      "PlanReview",
      "Review",
    ]);
  });

  it("summarises a full plan, normalising every risk shape to text", async () => {
    const { app, runRepo, artifactRepo } = await setup();
    runRepo.findById.mockResolvedValue(makeRun());

    const circular: Record<string, unknown> = { kind: "loop" };
    circular.self = circular;

    stubArtifacts(artifactRepo, {
      Plan: {
        version: 3,
        payloadJson: {
          summary: "Do the thing",
          confidence: 0.82,
          openQuestions: [{ id: "q1", question: "Which DB?", requiredForExecution: true }],
          steps: [
            { id: "s1", title: "Step 1", description: "First", extra: "dropped" },
            { id: "s2", title: "Step 2", description: "Second" },
          ],
          risks: [
            "plain string risk",
            { description: "object risk", severity: "high" },
            { description: 99 },
            { severity: "low" },
            circular,
          ],
          testPlan: "run vitest",
        },
      },
      PlanReview: { version: 1, payloadJson: { verdict: "approve" } },
      Review: { version: 2, payloadJson: { verdict: "changes_requested" } },
      ExecutionReport: {
        version: 5,
        payloadJson: { executionVersion: 3, score: 8, scoreRationale: "solid", extra: true },
      },
    });

    const res = await app.inject({ method: "GET", url: "/api/runs/run-1/summary" });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.plan).toEqual({
      version: 3,
      summary: "Do the thing",
      confidence: 0.82,
      openQuestions: [{ id: "q1", question: "Which DB?", requiredForExecution: true }],
      stepCount: 2,
      steps: [
        { id: "s1", title: "Step 1", description: "First" },
        { id: "s2", title: "Step 2", description: "Second" },
      ],
      risks: [
        "plain string risk",
        "object risk",
        '{"description":99}',
        '{"severity":"low"}',
        "[object Object]",
      ],
      riskCount: 5,
      testPlan: "run vitest",
    });
    expect(body.planReview).toEqual({ version: 1, payload: { verdict: "approve" } });
    expect(body.review).toEqual({ version: 2, payload: { verdict: "changes_requested" } });
    expect(body.executionReport).toEqual({
      version: 5,
      executionVersion: 3,
      score: 8,
      scoreRationale: "solid",
      payload: { executionVersion: 3, score: 8, scoreRationale: "solid", extra: true },
    });
  });

  it("defaults missing plan collections and falls back to artifact version for execution", async () => {
    const { app, runRepo, artifactRepo } = await setup();
    runRepo.findById.mockResolvedValue(makeRun());
    stubArtifacts(artifactRepo, {
      Plan: { version: 1, payloadJson: { summary: "Minimal", steps: "not-an-array", risks: "nope" } },
      ExecutionReport: { version: 4, payloadJson: null },
    });

    const res = await app.inject({ method: "GET", url: "/api/runs/run-1/summary" });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.plan).toEqual({
      version: 1,
      summary: "Minimal",
      openQuestions: [],
      stepCount: 0,
      steps: [],
      risks: [],
      riskCount: 0,
    });
    expect(body.executionReport).toEqual({ version: 4, executionVersion: 4, payload: null });
  });
});

describe("GET /api/processes", () => {
  const processes = [
    { id: "p1", runId: "run-1", stage: "planning" },
    { id: "p2", runId: "run-2", stage: "execution" },
    { id: "p3", runId: "run-1", stage: "review" },
  ];

  it("returns every active process without a filter", async () => {
    const { app, processRunner } = await setup();
    processRunner.getActiveProcesses.mockReturnValue(processes);

    const res = await app.inject({ method: "GET", url: "/api/processes" });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ processes });
  });

  it("filters by runId when given", async () => {
    const { app, processRunner } = await setup();
    processRunner.getActiveProcesses.mockReturnValue(processes);

    const res = await app.inject({ method: "GET", url: "/api/processes?runId=run-1" });

    expect(res.json().processes.map((p: { id: string }) => p.id)).toEqual(["p1", "p3"]);
  });

  it("returns an empty list when no process matches the runId", async () => {
    const { app, processRunner } = await setup();
    processRunner.getActiveProcesses.mockReturnValue(processes);

    const res = await app.inject({ method: "GET", url: "/api/processes?runId=run-9" });

    expect(res.json()).toEqual({ processes: [] });
  });
});

describe("GET /api/processes/:id/output", () => {
  it("returns the process output", async () => {
    const { app, processRunner } = await setup();
    processRunner.getProcessOutput.mockReturnValue("line1\nline2");

    const res = await app.inject({ method: "GET", url: "/api/processes/p1/output" });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ processId: "p1", output: "line1\nline2" });
    expect(processRunner.getProcessOutput).toHaveBeenCalledWith("p1");
  });

  it("returns an empty string output (not 404) when the buffer is empty", async () => {
    const { app, processRunner } = await setup();
    processRunner.getProcessOutput.mockReturnValue("");

    const res = await app.inject({ method: "GET", url: "/api/processes/p1/output" });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ processId: "p1", output: "" });
  });

  it("returns 404 when no output is available", async () => {
    const { app, processRunner } = await setup();
    processRunner.getProcessOutput.mockReturnValue(null);

    const res = await app.inject({ method: "GET", url: "/api/processes/gone/output" });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: "Process not found or no output available" });
  });
});

describe("Linear polling routes", () => {
  function linearMock() {
    return { discoverPendingIssues: vi.fn(), startRunsForIssues: vi.fn() };
  }
  const notConfigured = { error: "Linear polling not available (no LINEAR_API_KEY configured)" };

  describe("GET /api/linear/pending", () => {
    it("returns 501 when Linear polling is not configured", async () => {
      const { app } = await setup();

      const res = await app.inject({ method: "GET", url: "/api/linear/pending" });

      expect(res.statusCode).toBe(501);
      expect(res.json()).toEqual(notConfigured);
    });

    it("returns discovered issues", async () => {
      const linear = linearMock();
      linear.discoverPendingIssues.mockResolvedValue([{ id: "i1", identifier: "ENG-1" }]);
      const { app } = await setup({ linear });

      const res = await app.inject({ method: "GET", url: "/api/linear/pending" });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ issues: [{ id: "i1", identifier: "ENG-1" }] });
    });

    it.each([
      [new Error("Linear API down"), "Linear API down"],
      ["raw failure", "raw failure"],
    ])("returns 500 when discovery rejects with %s", async (err, expected) => {
      const linear = linearMock();
      linear.discoverPendingIssues.mockRejectedValue(err);
      const { app } = await setup({ linear });

      const res = await app.inject({ method: "GET", url: "/api/linear/pending" });

      expect(res.statusCode).toBe(500);
      expect(res.json()).toEqual({ error: expected });
    });
  });

  describe("POST /api/linear/ingest", () => {
    it("returns 501 when Linear polling is not configured", async () => {
      const { app } = await setup();

      const res = await app.inject({
        method: "POST",
        url: "/api/linear/ingest",
        payload: { issueIds: ["i1"] },
      });

      expect(res.statusCode).toBe(501);
      expect(res.json()).toEqual(notConfigured);
    });

    it.each([
      ["no body", undefined],
      ["missing issueIds", {}],
      ["non-array issueIds", { issueIds: "i1" }],
      ["empty issueIds", { issueIds: [] }],
    ])("returns 400 for %s", async (_label, payload) => {
      const linear = linearMock();
      const { app } = await setup({ linear });

      const res = await app.inject({ method: "POST", url: "/api/linear/ingest", payload });

      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual({ error: "Required: { issueIds: string[] }" });
      expect(linear.startRunsForIssues).not.toHaveBeenCalled();
    });

    it("starts runs and spreads the started/skipped result", async () => {
      const linear = linearMock();
      linear.startRunsForIssues.mockResolvedValue({ started: ["i1"], skipped: ["i2"] });
      const { app } = await setup({ linear });

      const res = await app.inject({
        method: "POST",
        url: "/api/linear/ingest",
        payload: { issueIds: ["i1", "i2"] },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ ok: true, started: ["i1"], skipped: ["i2"] });
      expect(linear.startRunsForIssues).toHaveBeenCalledWith(["i1", "i2"]);
    });

    it.each([
      [new Error("ingest failed"), "ingest failed"],
      [123, "123"],
    ])("returns 500 when ingestion rejects with %s", async (err, expected) => {
      const linear = linearMock();
      linear.startRunsForIssues.mockRejectedValue(err);
      const { app } = await setup({ linear });

      const res = await app.inject({
        method: "POST",
        url: "/api/linear/ingest",
        payload: { issueIds: ["i1"] },
      });

      expect(res.statusCode).toBe(500);
      expect(res.json()).toEqual({ error: expected });
    });
  });
});
