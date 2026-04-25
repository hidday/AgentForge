import type { FastifyInstance } from "fastify";
import type { OrchestratorService } from "../orchestrator/orchestratorService.js";
import type { RunEventEmitter, DashboardEvent } from "./runEventEmitter.js";
import type { LinearPollService } from "../sync/linearPoll.js";
import type { ProcessRunner } from "../runtime/processRunner.js";
import type {
  NotificationService,
  HumanRequestReason,
  NotificationPayload,
} from "../notifications/notificationService.js";
import { RunEvent } from "../domain/runEvent.js";
import { RunState } from "../domain/runState.js";
import { PolicyError, ValidationError } from "../utils/errors.js";
import type { SkillDocument } from "../domain/types.js";

const VALID_HUMAN_REQUEST_REASONS: HumanRequestReason[] = [
  "plan_ambiguous",
  "plan_low_confidence",
  "impl_rejected",
  "impl_uncertain",
  "other",
];

export interface RegisterApiRoutesOptions {
  notificationService?: NotificationService;
  uiBaseUrl?: string;
  debounceHours?: number;
}

export function registerApiRoutes(
  app: FastifyInstance,
  orchestrator: OrchestratorService,
  emitter: RunEventEmitter,
  processRunner: ProcessRunner,
  linearPollService?: LinearPollService,
  options: RegisterApiRoutesOptions = {},
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

  // ── Skills for a run ──────────────────────────────────────────────────

  app.get<{ Params: { id: string } }>("/api/runs/:id/skills", async (request, reply) => {
    const runId = request.params.id;
    if (!runId) return reply.code(400).send({ error: "runId is required" });

    const agentSkillRepo = orchestrator.getAgentSkillRepo();
    const events = await eventRepo.findByRunId(runId);

    // Extract injected skills — aggregate across all SKILL_INJECTION events (initial plan + replans)
    const injectionEvents = events.filter((e) => e.eventType === "SKILL_INJECTION");
    const injectedSkills: SkillDocument[] = [];
    if (injectionEvents.length > 0 && agentSkillRepo) {
      // Deduplicate skill IDs in case the same skill was injected in multiple planning passes
      const seenIds = new Set<string>();
      for (const evt of injectionEvents) {
        const ids = (evt.payloadJson as { skillIds?: string[] }).skillIds ?? [];
        for (const id of ids) seenIds.add(id);
      }
      for (const id of seenIds) {
        const skill = await agentSkillRepo.findById(id);
        if (skill) {
          injectedSkills.push({
            id: skill.id,
            repoSlug: skill.repoSlug,
            taskCategory: skill.taskCategory,
            skillMarkdown: skill.skillMarkdown,
            utilityScore: skill.utilityScore,
            lastUsedAt: skill.lastUsedAt,
          });
        }
      }
    }

    // Extract distillation decision
    const distillationEvent = events.find((e) => e.eventType === "SKILL_DISTILLATION");
    let distillationDecision: {
      shouldPersist: boolean;
      reason: string;
      taskCategory: string | null;
      displacedSkillId: string | null;
    } | null = null;

    if (distillationEvent) {
      const payload = distillationEvent.payloadJson as {
        shouldPersist?: boolean;
        reason?: string;
        taskCategory?: string | null;
        displacedSkillId?: string | null;
      };
      distillationDecision = {
        shouldPersist: payload.shouldPersist ?? false,
        reason: payload.reason ?? "",
        taskCategory: payload.taskCategory ?? null,
        displacedSkillId: payload.displacedSkillId ?? null,
      };
    }

    return { injectedSkills, distillationDecision };
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
      const body = request.body as { context?: unknown; mode?: unknown } | undefined;

      if (body !== undefined && body !== null && "context" in (body as object)) {
        if (
          typeof (body as { context?: unknown }).context !== "string" &&
          (body as { context?: unknown }).context !== undefined
        ) {
          return reply.code(400).send({ error: "context must be a string if provided" });
        }
      }

      const validModes = ["iterate", "fresh"] as const;
      const rawMode = (body as { mode?: unknown } | undefined)?.mode;
      if (rawMode !== undefined && !validModes.includes(rawMode as (typeof validModes)[number])) {
        return reply.code(400).send({ error: `mode must be one of: ${validModes.join(", ")}` });
      }
      const mode = (rawMode as "iterate" | "fresh" | undefined) ?? "iterate";

      const context =
        typeof (body as { context?: unknown } | undefined)?.context === "string"
          ? (body as { context: string }).context || undefined
          : undefined;

      try {
        const run = await orchestrator.rejectPlan(request.params.id, context, "api", mode);
        return { ok: true, state: run.state };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return reply.code(400).send({ error: message });
      }
    },
  );

  app.post<{ Params: { id: string } }>(
    "/api/runs/:id/actions/re-review-plan",
    async (request, reply) => {
      try {
        orchestrator.runManualReReview(request.params.id).catch((err: unknown) => {
          const msg = err instanceof Error ? err.message.slice(0, 200) : String(err);
          app.log.error({ runId: request.params.id, error: msg }, "Manual re-review failed");
        });
        return { ok: true, runId: request.params.id };
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

  app.post<{ Params: { id: string } }>("/api/runs/:id/actions/pause", async (request, reply) => {
    try {
      const run = await runRepo.findById(request.params.id);
      if (!run) return await reply.code(404).send({ error: "Run not found" });

      await orchestrator.handleCommand(run.linearIssueId, { type: "pause-ai" });
      return { ok: true };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return reply.code(400).send({ error: message });
    }
  });

  app.post<{ Params: { id: string } }>("/api/runs/:id/actions/resume", async (request, reply) => {
    try {
      const run = await runRepo.findById(request.params.id);
      if (!run) return await reply.code(404).send({ error: "Run not found" });

      await orchestrator.handleCommand(run.linearIssueId, { type: "resume-ai" });
      return { ok: true };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return reply.code(400).send({ error: message });
    }
  });

  app.post<{ Params: { id: string } }>(
    "/api/runs/:id/actions/answer-questions",
    async (request, reply) => {
      const body = request.body as { answers?: unknown } | undefined;

      // Schema validation
      if (!body?.answers || !Array.isArray(body.answers) || body.answers.length === 0) {
        return reply.code(400).send({
          error: "Required: { answers: Array<{ questionId: string; answer: string }> } (non-empty)",
        });
      }

      for (const item of body.answers as unknown[]) {
        if (
          typeof item !== "object" ||
          item === null ||
          typeof (item as Record<string, unknown>).questionId !== "string" ||
          !(item as Record<string, unknown>).questionId ||
          typeof (item as Record<string, unknown>).answer !== "string" ||
          !(item as Record<string, unknown>).answer
        ) {
          return reply.code(400).send({
            error:
              "Each answer must have a non-empty questionId (string) and a non-empty answer (string)",
          });
        }
      }

      const answers = body.answers as { questionId: string; answer: string }[];

      try {
        const run = await orchestrator.answerQuestions(request.params.id, answers);
        return { ok: true, run };
      } catch (err) {
        if (err instanceof PolicyError) {
          return reply.code(409).send({ error: err.message });
        }
        if (err instanceof ValidationError) {
          return reply.code(400).send({ error: err.message });
        }
        const message = err instanceof Error ? err.message : String(err);
        return reply.code(400).send({ error: message });
      }
    },
  );

  app.post<{ Params: { id: string } }>("/api/runs/:id/actions/retry", async (request, reply) => {
    const run = await runRepo.findById(request.params.id);
    if (!run) return reply.code(404).send({ error: "Run not found" });

    const logError = (err: unknown) => {
      const message = err instanceof Error ? err.message.slice(0, 200) : String(err);
      app.log.error({ runId: run.id, error: message }, "Retry stage failed");
    };

    const retryableStates: Record<string, () => void> = {
      [RunState.Todo]: () => {
        orchestrator.retryRun(run.id).catch(logError);
      },
      [RunState.Planning]: () => {
        orchestrator.runPlanning(run.id).catch(logError);
      },
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
  });

  // ── Trimmed summary for external monitors ───────────────────────────────

  app.get<{ Params: { id: string } }>("/api/runs/:id/summary", async (request, reply) => {
    const run = await runRepo.findById(request.params.id);
    if (!run) return reply.code(404).send({ error: "Run not found" });

    const [planArtifact, planReviewArtifact, reviewArtifact, executionArtifact] = await Promise.all(
      [
        artifactRepo.findLatestByType(run.id, "Plan"),
        artifactRepo.findLatestByType(run.id, "PlanReview"),
        artifactRepo.findLatestByType(run.id, "Review"),
        artifactRepo.findLatestByType(run.id, "ExecutionReport"),
      ],
    );

    const plan = planArtifact?.payloadJson as
      | {
          summary?: string;
          confidence?: number;
          openQuestions?: { id: string; question: string; requiredForExecution: boolean }[];
          steps?: { id: string; title: string; description: string }[];
          risks?: unknown[];
          testPlan?: string;
        }
      | undefined;

    const riskTexts =
      plan && Array.isArray(plan.risks)
        ? plan.risks.map((r) => {
            if (typeof r === "string") return r;
            if (r && typeof r === "object" && "description" in r) {
              const d = (r as { description?: unknown }).description;
              if (typeof d === "string") return d;
            }
            try {
              return JSON.stringify(r);
            } catch {
              return String(r);
            }
          })
        : [];

    return {
      run: {
        id: run.id,
        state: run.state,
        linearIssue: {
          id: run.linearIssueId,
          identifier: run.linearIssueIdentifier,
          title: run.linearIssueTitle,
          url: run.linearIssueUrl,
          description: run.linearIssueDescription,
        },
        linearIssueId: run.linearIssueId,
        linearIssueTitle: run.linearIssueTitle,
        linearIssueUrl: run.linearIssueUrl,
        repo: run.repo,
        branchName: run.branchName,
        prNumber: run.prNumber,
        planVersion: run.planVersion,
        approvedPlanVersion: run.approvedPlanVersion,
        createdAt: run.createdAt,
        updatedAt: run.updatedAt,
      },
      plan: plan
        ? {
            version: planArtifact?.version,
            summary: plan.summary,
            confidence: plan.confidence,
            openQuestions: plan.openQuestions ?? [],
            stepCount: Array.isArray(plan.steps) ? plan.steps.length : 0,
            steps: Array.isArray(plan.steps)
              ? plan.steps.map((s) => ({
                  id: s.id,
                  title: s.title,
                  description: s.description,
                }))
              : [],
            risks: riskTexts,
            riskCount: riskTexts.length,
            testPlan: plan.testPlan,
          }
        : null,
      planReview: planReviewArtifact
        ? {
            version: planReviewArtifact.version,
            payload: planReviewArtifact.payloadJson,
          }
        : null,
      review: reviewArtifact
        ? {
            version: reviewArtifact.version,
            payload: reviewArtifact.payloadJson,
          }
        : null,
      executionReport: executionArtifact
        ? {
            version: executionArtifact.version,
            payload: executionArtifact.payloadJson,
          }
        : null,
    };
  });

  // ── Request human intervention (notification hook) ─────────────────────

  app.post<{ Params: { id: string } }>(
    "/api/runs/:id/actions/request-human",
    async (request, reply) => {
      const body = request.body as
        | { reason?: unknown; summary?: unknown; context?: unknown }
        | undefined;

      const reason = body?.reason;
      if (
        typeof reason !== "string" ||
        !VALID_HUMAN_REQUEST_REASONS.includes(reason as HumanRequestReason)
      ) {
        return reply.code(400).send({
          error: `reason must be one of: ${VALID_HUMAN_REQUEST_REASONS.join(", ")}`,
        });
      }

      const summary = body?.summary;
      if (typeof summary !== "string" || !summary.trim()) {
        return reply.code(400).send({ error: "summary (non-empty string) is required" });
      }

      const context =
        typeof body?.context === "string" && body.context.trim() ? body.context : undefined;

      const run = await runRepo.findById(request.params.id);
      if (!run) return reply.code(404).send({ error: "Run not found" });

      const debounceHours = options.debounceHours ?? 6;
      const cutoff = Date.now() - debounceHours * 60 * 60 * 1000;
      const events = await eventRepo.findByRunId(run.id);
      const recent = events.find((e) => {
        if (e.eventType !== "HUMAN_REQUESTED") return false;
        if (e.createdAt.getTime() < cutoff) return false;
        const payload = e.payloadJson as { reason?: string } | null;
        return payload?.reason === reason;
      });

      const uiBaseUrl = options.uiBaseUrl ?? "http://localhost:5173";
      const runUrl = `${uiBaseUrl.replace(/\/$/, "")}/runs/${run.id}`;

      if (recent) {
        app.log.info(
          { runId: run.id, reason, lastNotifiedAt: recent.createdAt },
          "Skipping human-request notification (debounced)",
        );
        return {
          ok: true,
          debounced: true,
          lastNotifiedAt: recent.createdAt,
          notified: { slack: false, email: false },
        };
      }

      const planArtifact = await artifactRepo.findLatestByType(run.id, "Plan");
      const plan = planArtifact?.payloadJson as
        | {
            confidence?: number;
            openQuestions?: { id: string; question: string; requiredForExecution: boolean }[];
          }
        | undefined;

      const notificationPayload: NotificationPayload = {
        runId: run.id,
        reason: reason as HumanRequestReason,
        summary: summary.trim(),
        context,
        linearIssue: {
          id: run.linearIssueId,
          identifier: run.linearIssueIdentifier ?? undefined,
          title: run.linearIssueTitle,
          url: run.linearIssueUrl,
        },
        runState: run.state,
        runUrl,
        planConfidence: plan?.confidence,
        openQuestions: plan?.openQuestions ?? [],
      };

      let notified = { slack: false, email: false };
      if (options.notificationService?.isConfigured()) {
        const result = await options.notificationService.sendHumanRequest(notificationPayload);
        notified = { slack: result.slack.ok, email: result.email.ok };
      } else {
        app.log.warn(
          { runId: run.id, reason },
          "No notification channel configured — recording event only",
        );
      }

      await eventRepo.create({
        runId: run.id,
        eventType: RunEvent.HUMAN_REQUESTED,
        source: "api",
        payloadJson: {
          reason,
          summary: summary.trim(),
          context: context ?? null,
          runUrl,
          notified,
        },
      });

      return { ok: true, debounced: false, notified };
    },
  );

  // ── Active processes ────────────────────────────────────────────────────

  app.get<{ Querystring: { runId?: string } }>("/api/processes", (request) => {
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
