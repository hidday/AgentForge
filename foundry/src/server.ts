import Fastify from "fastify";
import { env, parseBaseArgs } from "./config/env.js";
import { logger } from "./utils/logger.js";
import { getPrismaClient, disconnectPrisma } from "./db/prisma.js";
import { RunRepository } from "./orchestrator/runRepository.js";
import { ArtifactRepository } from "./orchestrator/artifactRepository.js";
import { EventRepository } from "./orchestrator/eventRepository.js";
import { IdempotencyRepository } from "./orchestrator/idempotencyRepository.js";
import { OrchestratorService } from "./orchestrator/orchestratorService.js";
import { ProcessRunner } from "./runtime/processRunner.js";
import { ClaudeCodeRunner } from "./runtime/claudeCodeRunner.js";
import { CodexRunner } from "./runtime/codexRunner.js";
import { CursorRunner } from "./runtime/cursorRunner.js";
import { AgentRunner } from "./runtime/agentRunner.js";
import { PlannerAgent } from "./agents/plannerAgent.js";
import { PlanReviewerAgent } from "./agents/planReviewerAgent.js";
import { PlanReviserAgent } from "./agents/planReviserAgent.js";
import { ExecutorAgent } from "./agents/executorAgent.js";
import { ReviewerAgent } from "./agents/reviewerAgent.js";
import { RemediationAgent } from "./agents/remediationAgent.js";
import { MockLinearClient } from "./linear/linearClient.js";
import type { LinearClient } from "./linear/linearClient.js";
import { RealLinearClient } from "./linear/realLinearClient.js";
import { MockGitHubClient } from "./github/githubClient.js";
import type { GitHubClient } from "./github/githubClient.js";
import { RealGitHubClient } from "./github/realGitHubClient.js";
import { registerLinearWebhook } from "./linear/linearWebhook.js";
import { registerGitHubWebhook } from "./github/githubWebhook.js";
import { loadRepoRegistry } from "./config/repoRegistry.js";
import { LinearSyncService } from "./sync/linearSync.js";
import { GitHubSyncService } from "./sync/githubSync.js";
import { createMockProcessHandler } from "./mocks/mockCliOutputs.js";
import { MOCK_ISSUE } from "./mocks/mockLinearData.js";
import { parseLinearCommand } from "./linear/linearCommandParser.js";
import { RunEventEmitter } from "./api/runEventEmitter.js";
import { registerApiRoutes } from "./api/routes.js";
import { LinearPollService } from "./sync/linearPoll.js";
import { RuntimeHealthCheck } from "./runtime/runtimeHealthCheck.js";

function buildServices() {
  const prisma = getPrismaClient();

  const runRepo = new RunRepository(prisma);
  const artifactRepo = new ArtifactRepository(prisma);
  const eventRepo = new EventRepository(prisma);
  const idempotencyRepo = new IdempotencyRepository(prisma);
  const repoRegistry = loadRepoRegistry(env.REPOS_CONFIG_PATH, env.REPOS_ROOT_PATH, logger);

  const dashboardEmitter = new RunEventEmitter();

  const processRunner = new ProcessRunner(env.AGENT_RUNTIME_MODE, logger, dashboardEmitter);
  if (env.AGENT_RUNTIME_MODE === "mock") {
    processRunner.setMockHandler(createMockProcessHandler());
  }

  const claudeCodeRunner = new ClaudeCodeRunner(
    processRunner,
    env.CLAUDE_CODE_COMMAND,
    parseBaseArgs(env.CLAUDE_CODE_ARGS_BASE),
    logger,
  );
  const codexRunner = new CodexRunner(
    processRunner,
    env.CODEX_COMMAND,
    parseBaseArgs(env.CODEX_ARGS_BASE),
    logger,
  );
  const cursorRunner = new CursorRunner(
    processRunner,
    env.CURSOR_COMMAND,
    parseBaseArgs(env.CURSOR_ARGS_BASE),
    env.CURSOR_MODEL,
    logger,
  );
  const agentRunner = new AgentRunner(claudeCodeRunner, codexRunner, cursorRunner, logger);

  const githubClient: GitHubClient = env.GITHUB_TOKEN
    ? new RealGitHubClient(env.GITHUB_TOKEN, logger)
    : new MockGitHubClient();

  const linearClient: LinearClient = env.LINEAR_API_KEY
    ? new RealLinearClient(env.LINEAR_API_KEY, logger)
    : (() => {
        const mock = new MockLinearClient();
        mock.seedIssue(MOCK_ISSUE);
        return mock;
      })();

  logger.info(
    {
      linearMode: env.LINEAR_API_KEY ? "real" : "mock",
      githubMode: env.GITHUB_TOKEN ? "real" : "mock",
    },
    "Initialized external clients",
  );

  const plannerAgent = new PlannerAgent(agentRunner, artifactRepo, logger);
  const planReviewerAgent = new PlanReviewerAgent(agentRunner, artifactRepo, logger);
  const planReviserAgent = new PlanReviserAgent(agentRunner, artifactRepo, logger);
  const executorAgent = new ExecutorAgent(agentRunner, artifactRepo, githubClient, logger);
  const reviewerAgent = new ReviewerAgent(agentRunner, artifactRepo, logger);
  const remediationAgent = new RemediationAgent(agentRunner, artifactRepo, logger);

  const linearSync = new LinearSyncService(linearClient, logger);
  const githubSync = new GitHubSyncService(githubClient, logger);

  const orchestrator = new OrchestratorService({
    runRepo,
    artifactRepo,
    eventRepo,
    linearClient,
    githubClient,
    repoRegistry,
    linearSync,
    githubSync,
    plannerAgent,
    planReviewerAgent,
    planReviserAgent,
    executorAgent,
    reviewerAgent,
    remediationAgent,
    logger,
    dashboardEmitter,
  });

  const linearPollService = env.LINEAR_API_KEY
    ? new LinearPollService(linearClient, runRepo, orchestrator, repoRegistry, logger)
    : undefined;

  const preflightProcessRunner = new ProcessRunner("real", logger);
  const runtimeConfigs = RuntimeHealthCheck.buildRuntimeConfigs(
    env.CLAUDE_CODE_COMMAND,
    parseBaseArgs(env.CLAUDE_CODE_ARGS_BASE),
    env.CODEX_COMMAND,
    parseBaseArgs(env.CODEX_ARGS_BASE),
    env.CURSOR_COMMAND,
  );
  const runtimeHealthCheck = new RuntimeHealthCheck(preflightProcessRunner, runtimeConfigs, logger);

  return {
    orchestrator,
    idempotencyRepo,
    dashboardEmitter,
    processRunner,
    linearPollService,
    runtimeHealthCheck,
    githubClient,
    repoRegistry,
  };
}

async function main(): Promise<void> {
  const app = Fastify({
    logger: {
      level: env.LOG_LEVEL,
      transport:
        process.env.NODE_ENV !== "production"
          ? { target: "pino-pretty", options: { colorize: true } }
          : undefined,
    },
  });

  const {
    orchestrator,
    idempotencyRepo,
    dashboardEmitter,
    processRunner,
    linearPollService,
    runtimeHealthCheck,
    githubClient,
    repoRegistry,
  } = buildServices();

  if (env.AGENT_RUNTIME_MODE === "real") {
    try {
      await runtimeHealthCheck.runPreflight();
    } catch {
      logger.fatal(
        "Agent preflight failed -- refusing to start. Fix the CLI authentication and retry.",
      );
      process.exit(1);
    }

    if (env.GITHUB_TOKEN) {
      try {
        for (const repo of repoRegistry.listRepos()) {
          await githubClient.verifyRepoAccess(repo.name);
        }
        logger.info("GitHub preflight passed: all configured repos are accessible");
      } catch (err) {
        logger.fatal(
          { error: err instanceof Error ? err.message : String(err) },
          "GitHub preflight failed -- refusing to start. Check GITHUB_TOKEN permissions.",
        );
        process.exit(1);
      }
    }
  }

  app.get("/health", () => {
    const preflight = runtimeHealthCheck.getLastResult();
    return {
      status: "ok",
      mode: env.AGENT_RUNTIME_MODE,
      timestamp: new Date().toISOString(),
      runtimes: preflight
        ? {
            ok: preflight.ok,
            required: preflight.requiredRuntimes,
            skipped: preflight.skippedRuntimes,
            results: preflight.results.map((r) => ({
              runtime: r.runtime,
              command: r.command,
              binary: r.binaryCheck.ok ? (r.binaryCheck.version ?? "ok") : r.binaryCheck.error,
              auth: r.authCheck.ok ? "ok" : r.authCheck.error,
            })),
          }
        : undefined,
    };
  });

  app.addHook("onRequest", async (request, reply) => {
    const origin = request.headers.origin;
    if (origin) {
      reply.header("Access-Control-Allow-Origin", origin);
      reply.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
      reply.header("Access-Control-Allow-Headers", "Content-Type");
    }
    if (request.method === "OPTIONS") {
      return reply.code(204).send();
    }
  });

  if (env.AGENT_RUNTIME_MODE === "real") {
    processRunner.rehydrateOrphans();
  }

  registerLinearWebhook(app, orchestrator, idempotencyRepo);
  registerGitHubWebhook(app, orchestrator);
  registerApiRoutes(app, orchestrator, dashboardEmitter, processRunner, linearPollService);

  app.post<{ Params: { issueId: string } }>("/simulate/run/:issueId", async (request, reply) => {
    const { issueId } = request.params;
    try {
      const run = await orchestrator.startRun(issueId);
      return await reply.send({ ok: true, runId: run.id, state: run.state });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return await reply.code(500).send({ ok: false, error: message });
    }
  });

  app.post<{ Params: { runId: string } }>(
    "/simulate/plan-review/:runId",
    async (request, reply) => {
      const { runId } = request.params;
      // Fire-and-forget: respond immediately so tsx hot-reloads don't kill the
      // in-flight long-running agent call (plan review can take 60-120 s).
      reply.send({ ok: true, runId, status: "started" });
      orchestrator.runPlanReview(runId).catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        app.log.error({ runId, error: message }, "Plan review failed");
      });
    },
  );

  app.post<{ Params: { runId: string } }>(
    "/simulate/plan-revision/:runId",
    async (request, reply) => {
      const { runId } = request.params;
      reply.send({ ok: true, runId, status: "started" });
      orchestrator.runPlanRevision(runId).catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        app.log.error({ runId, error: message }, "Plan revision failed");
      });
    },
  );

  app.post("/simulate/comment-command", async (request, reply) => {
    const body = request.body as { issueId?: string; command?: string } | undefined;
    if (!body?.issueId || !body?.command) {
      return reply.code(400).send({ error: "Required: { issueId, command }" });
    }

    const command = parseLinearCommand(body.command);
    if (!command) {
      return reply.code(400).send({ error: "Unrecognized command" });
    }

    try {
      await orchestrator.handleCommand(body.issueId, command);
      return await reply.send({ ok: true, command: command.type });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return await reply.code(500).send({ ok: false, error: message });
    }
  });

  app.setErrorHandler((error: { statusCode?: number; message: string }, _request, reply) => {
    app.log.error(error);
    const statusCode = error.statusCode ?? 500;
    reply.code(statusCode).send({ error: error.message, statusCode });
  });

  const shutdown = async (): Promise<void> => {
    app.log.info("Shutting down...");
    await app.close();
    await disconnectPrisma();
    process.exit(0);
  };

  process.on("SIGINT", () => {
    void shutdown();
  });
  process.on("SIGTERM", () => {
    void shutdown();
  });

  await app.listen({ port: env.PORT, host: "0.0.0.0" });
  app.log.info(`Server running on port ${env.PORT} in ${env.AGENT_RUNTIME_MODE} mode`);

  if (linearPollService && env.SYNC_ON_STARTUP) {
    try {
      const pending = await linearPollService.discoverPendingIssues();
      app.log.info(
        { count: pending.length, issues: pending.map((i) => ({ id: i.id, title: i.title })) },
        "Startup sync: discovered pending Linear issues (use dashboard to start runs)",
      );
    } catch (err) {
      app.log.warn(
        { error: err instanceof Error ? err.message : String(err) },
        "Startup sync failed",
      );
    }
  }
}

main().catch((err: unknown) => {
  logger.fatal(err, "Failed to start server");
  process.exit(1);
});
