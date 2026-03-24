import type { FastifyInstance } from "fastify";
import type { OrchestratorService } from "../orchestrator/orchestratorService.js";
import type { RunEventEmitter, DashboardEvent } from "./runEventEmitter.js";
import type { LinearPollService } from "../sync/linearPoll.js";
import type { ProcessRunner } from "../runtime/processRunner.js";
import { RunEvent } from "../domain/runEvent.js";
import { RunState } from "../domain/runState.js";

export function registerApiRoutes(
  app: FastifyInstance,
  orchestrator: OrchestratorService,
  emitter: RunEventEmitter,
  processRunner: ProcessRunner,
  linearPollService?: LinearPollService,
): void {
  const runRepo = orchestrator.getRunRepo();
  const artifactRepo = orchestrator.getArtifactRepo();
  const eventRepo = orchestrator.getEventRepo();

  // ── List runs ──────────────────────────────────────────────────────────

  app.get<{ Querystring: { state?: string } }>("/api/runs", async (request) => {
    const runs = await runRepo.findAll(request.query.state);
    return { runs };
  });

  // ── Single run with latest artifacts + events ──────────────────────────

  app.get<{ Params: { id: string } }>("/api/runs/:id", async (request, reply) => {
    const run = await runRepo.findById(request.params.id);
    if (!run) return reply.code(404).send({ error: "Run not found" });

    const [artifacts, events] = await Promise.all([
      artifactRepo.findByRunId(run.id),
      eventRepo.findByRunId(run.id),
    ]);

    return { run, artifacts, events };
  });

  // ── Artifacts for a run ────────────────────────────────────────────────

  app.get<{ Params: { id: string } }>("/api/runs/:id/artifacts", async (request, reply) => {
    const run = await runRepo.findById(request.params.id);
    if (!run) return reply.code(404).send({ error: "Run not found" });

    const artifacts = await artifactRepo.findByRunId(run.id);
    return { artifacts };
  });

  // ── Events for a run ──────────────────────────────────────────────────

  app.get<{ Params: { id: string } }>("/api/runs/:id/events", async (request, reply) => {
    const run = await runRepo.findById(request.params.id);
    if (!run) return reply.code(404).send({ error: "Run not found" });

    const events = await eventRepo.findByRunId(run.id);
    return { events };
  });

  // ── Actions ────────────────────────────────────────────────────────────

  app.post<{ Params: { id: string } }>(
    "/api/runs/:id/actions/approve-plan",
    async (request, reply) => {
      try {
        const run = await orchestrator.approvePlan(request.params.id);
        orchestrator.runExecution(run.id).catch((err: unknown) => {
          const msg = err instanceof Error ? err.message.slice(0, 200) : String(err);
          app.log.error({ runId: run.id, error: msg }, "Execution failed");
        });
        return { ok: true, state: run.state };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return reply.code(400).send({ error: message });
      }
    },
  );

  app.post<{ Params: { id: string } }>(
    "/api/runs/:id/actions/reject-plan",
    async (request, reply) => {
      try {
        const run = await orchestrator.rejectPlan(request.params.id);
        return { ok: true, state: run.state };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return reply.code(400).send({ error: message });
      }
    },
  );

  app.post<{ Params: { id: string } }>(
    "/api/runs/:id/actions/approve-review",
    async (request, reply) => {
      try {
        const run = await orchestrator.approveHumanReview(request.params.id);
        return { ok: true, state: run.state };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return reply.code(400).send({ error: message });
      }
    },
  );

  app.post<{ Params: { id: string } }>(
    "/api/runs/:id/actions/pause",
    async (request, reply) => {
      try {
        const run = await runRepo.findById(request.params.id);
        if (!run) return reply.code(404).send({ error: "Run not found" });

        await orchestrator.handleCommand(run.linearIssueId, { type: "pause-ai" });
        return { ok: true };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return reply.code(400).send({ error: message });
      }
    },
  );

  app.post<{ Params: { id: string } }>(
    "/api/runs/:id/actions/resume",
    async (request, reply) => {
      try {
        const run = await runRepo.findById(request.params.id);
        if (!run) return reply.code(404).send({ error: "Run not found" });

        await orchestrator.handleCommand(run.linearIssueId, { type: "resume-ai" });
        return { ok: true };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return reply.code(400).send({ error: message });
      }
    },
  );

  app.post<{ Params: { id: string } }>(
    "/api/runs/:id/actions/retry",
    async (request, reply) => {
      const run = await runRepo.findById(request.params.id);
      if (!run) return reply.code(404).send({ error: "Run not found" });

      const logError = (err: unknown) => {
        const message = err instanceof Error ? err.message.slice(0, 200) : String(err);
        app.log.error({ runId: run.id, error: message }, "Retry stage failed");
      };

      const retryableStates: Record<string, () => void> = {
        [RunState.PlanRevision]: () => {
          orchestrator.runPlanRevision(run.id).catch(logError);
        },
        [RunState.PlanReview]: () => {
          orchestrator.runPlanReview(run.id).catch(logError);
        },
        [RunState.Implementing]: () => {
          orchestrator.runExecution(run.id).catch(logError);
        },
        [RunState.AIReview]: () => {
          orchestrator.runReview(run.id).catch(logError);
        },
        [RunState.AddressingReview]: () => {
          orchestrator.runRemediation(run.id).catch(logError);
        },
      };

      const trigger = retryableStates[run.state];
      if (!trigger) {
        return reply.code(400).send({
          error: `Retry is not supported for state "${run.state}". Retryable states: ${Object.keys(retryableStates).join(", ")}`,
        });
      }

      // Fire-and-forget so the HTTP response returns immediately while the
      // (potentially long-running) agent work happens in the background.
      trigger();
      return { ok: true, runId: run.id, state: run.state, retrying: true };
    },
  );

  // ── Active processes ────────────────────────────────────────────────────

  app.get<{ Querystring: { runId?: string } }>("/api/processes", async (request) => {
    const all = processRunner.getActiveProcesses();
    const { runId } = request.query;
    return { processes: runId ? all.filter((p) => p.runId === runId) : all };
  });

  app.get<{ Params: { id: string } }>("/api/processes/:id/output", async (request, reply) => {
    const output = processRunner.getProcessOutput(request.params.id);
    if (output === null) {
      return reply.code(404).send({ error: "Process not found or no output available" });
    }
    return { processId: request.params.id, output };
  });

  // ── Linear polling ──────────────────────────────────────────────────────

  app.get("/api/linear/pending", async (_request, reply) => {
    if (!linearPollService) {
      return reply.code(501).send({
        error: "Linear polling not available (no LINEAR_API_KEY configured)",
      });
    }
    try {
      const issues = await linearPollService.discoverPendingIssues();
      return { issues };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return reply.code(500).send({ error: message });
    }
  });

  app.post("/api/linear/ingest", async (request, reply) => {
    if (!linearPollService) {
      return reply.code(501).send({
        error: "Linear polling not available (no LINEAR_API_KEY configured)",
      });
    }
    const body = request.body as { issueIds?: string[] } | undefined;
    if (!body?.issueIds || !Array.isArray(body.issueIds) || body.issueIds.length === 0) {
      return reply.code(400).send({ error: "Required: { issueIds: string[] }" });
    }
    try {
      const result = await linearPollService.startRunsForIssues(body.issueIds);
      return { ok: true, ...result };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return reply.code(500).send({ error: message });
    }
  });

  // ── SSE stream ─────────────────────────────────────────────────────────

  app.get("/api/events/stream", (request, reply) => {
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });

    reply.raw.write(":\n\n");

    const handler = (event: DashboardEvent) => {
      reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
    };

    emitter.on("dashboard", handler);

    const heartbeat = setInterval(() => {
      reply.raw.write(":\n\n");
    }, 15_000);

    request.raw.on("close", () => {
      clearInterval(heartbeat);
      emitter.off("dashboard", handler);
    });
  });
}
