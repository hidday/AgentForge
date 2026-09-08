import { describe, it, expect, vi, beforeEach } from "vitest";
import Fastify from "fastify";
import { registerApiRoutes } from "../../src/api/routes.js";
import { RunState } from "../../src/domain/runState.js";

// Covers GET /api/runs/:id/skills branches the primary runsSkills.test.ts
// suite doesn't reach: a SKILL_INJECTION event whose payload omits
// `skillIds` (the `?? []` fallback), and a SKILL_DISTILLATION event whose
// payload omits `shouldPersist`/`reason` (their `?? false` / `?? ""`
// fallbacks). The route's `!runId` guard is also exercised directly against
// the registered handler, since Fastify's router never dispatches to this
// handler with an empty `:id` segment over real HTTP.

function makeRun() {
  return {
    id: "run-1",
    linearIssueId: "LIN-1",
    linearIssueTitle: "title",
    linearIssueUrl: null,
    repo: "test-repo",
    branchName: null,
    prNumber: null,
    state: RunState.Done,
    planVersion: 1,
    approvedPlanVersion: 1,
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

function buildOrchestrator(overrides: { events?: unknown[]; skills?: Record<string, unknown> } = {}) {
  const mockRunRepo = { findById: vi.fn().mockResolvedValue(makeRun()), findAll: vi.fn() };
  const mockArtifactRepo = { findByRunId: vi.fn().mockResolvedValue([]) };
  const mockEventRepo = { findByRunId: vi.fn().mockResolvedValue(overrides.events ?? []) };

  const skillsMap = overrides.skills ?? {};
  const mockAgentSkillRepo = {
    findById: vi.fn().mockImplementation((id: string) => Promise.resolve(skillsMap[id] ?? null)),
    findByRepoCategoryNearTime: vi.fn().mockResolvedValue(null),
  };

  const mockOrchestrator = {
    getRunRepo: () => mockRunRepo,
    getArtifactRepo: () => mockArtifactRepo,
    getEventRepo: () => mockEventRepo,
    getAgentSkillRepo: () => mockAgentSkillRepo,
  };

  return { mockOrchestrator, mockRunRepo, mockEventRepo, mockAgentSkillRepo };
}

async function buildApp(overrides: { events?: unknown[]; skills?: Record<string, unknown> } = {}) {
  const { mockOrchestrator } = buildOrchestrator(overrides);
  const mockEmitter = { on: vi.fn(), off: vi.fn() };
  const mockProcessRunner = { getActiveProcesses: vi.fn(), getProcessOutput: vi.fn() };

  const app = Fastify({ logger: false });
  registerApiRoutes(app, mockOrchestrator as never, mockEmitter as never, mockProcessRunner as never);
  await app.ready();
  return { app };
}

describe("GET /api/runs/:id/skills edge branches", () => {
  beforeEach(() => vi.clearAllMocks());

  it("defaults skillIds to [] when a SKILL_INJECTION event's payload omits it", async () => {
    const { app } = await buildApp({
      events: [
        {
          id: "event-1",
          runId: "run-1",
          eventType: "SKILL_INJECTION",
          source: "orchestrator",
          payloadJson: {}, // no skillIds field at all
          createdAt: new Date(),
        },
      ],
    });

    const res = await app.inject({ method: "GET", url: "/api/runs/run-1/skills" });

    expect(res.statusCode).toBe(200);
    const body = res.json() as { injectedSkills: unknown[] };
    expect(body.injectedSkills).toEqual([]);
  });

  it("defaults shouldPersist to false and reason to '' when a SKILL_DISTILLATION payload omits them", async () => {
    const { app } = await buildApp({
      events: [
        {
          id: "event-1",
          runId: "run-1",
          eventType: "SKILL_DISTILLATION",
          source: "distillation-agent",
          payloadJson: {}, // no shouldPersist / reason fields
          createdAt: new Date(),
        },
      ],
    });

    const res = await app.inject({ method: "GET", url: "/api/runs/run-1/skills" });

    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      distillationDecision: { shouldPersist: boolean; reason: string } | null;
    };
    expect(body.distillationDecision).toMatchObject({ shouldPersist: false, reason: "" });
  });

  it("responds 400 with 'runId is required' when the handler is invoked with an empty id param", async () => {
    // Fastify's router never matches `:id` to an empty string over real HTTP
    // (there is no path segment to dispatch to), so this guard is exercised
    // directly against the handler the route registered, the same way it
    // would run inside Fastify's request lifecycle.
    const handlers = new Map<string, (request: unknown, reply: unknown) => unknown>();
    const fakeApp = {
      get: vi.fn((url: string, handler: (request: unknown, reply: unknown) => unknown) => {
        handlers.set(url, handler);
      }),
      post: vi.fn(),
      log: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
    };
    const { mockOrchestrator } = buildOrchestrator();
    const mockEmitter = { on: vi.fn(), off: vi.fn() };
    const mockProcessRunner = { getActiveProcesses: vi.fn(), getProcessOutput: vi.fn() };

    registerApiRoutes(
      fakeApp as never,
      mockOrchestrator as never,
      mockEmitter as never,
      mockProcessRunner as never,
    );

    const handler = handlers.get("/api/runs/:id/skills");
    expect(handler).toBeDefined();

    let sentCode: number | undefined;
    let sentBody: unknown;
    const reply = {
      code: (code: number) => {
        sentCode = code;
        return reply;
      },
      send: (body: unknown) => {
        sentBody = body;
        return reply;
      },
    };
    const request = { params: { id: "" } };

    await handler!(request, reply);

    expect(sentCode).toBe(400);
    expect(sentBody).toEqual({ error: "runId is required" });
  });
});
