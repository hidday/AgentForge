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
import { AgentRunner } from "./runtime/agentRunner.js";
import { PlannerAgent } from "./agents/plannerAgent.js";
import { PlanReviewerAgent } from "./agents/planReviewerAgent.js";
import { PlanReviserAgent } from "./agents/planReviserAgent.js";
import { ExecutorAgent } from "./agents/executorAgent.js";
import { ReviewerAgent } from "./agents/reviewerAgent.js";
import { RemediationAgent } from "./agents/remediationAgent.js";
import { MockLinearClient } from "./linear/linearClient.js";
import { MockGitHubClient } from "./github/githubClient.js";
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

function buildServices() {
  const prisma = getPrismaClient();

  const runRepo = new RunRepository(prisma);
  const artifactRepo = new ArtifactRepository(prisma);
  const eventRepo = new EventRepository(prisma);
  const idempotencyRepo = new IdempotencyRepository(prisma);
  const repoRegistry = loadRepoRegistry(env.REPOS_CONFIG_PATH, env.REPOS_ROOT_PATH, logger);

  const processRunner = new ProcessRunner(env.AGENT_RUNTIME_MODE, logger);
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
  const agentRunner = new AgentRunner(claudeCodeRunner, codexRunner, logger);

  const githubClient = new MockGitHubClient();
  const plannerAgent = new PlannerAgent(agentRunner, artifactRepo, logger);
  const planReviewerAgent = new PlanReviewerAgent(agentRunner, artifactRepo, logger);
  const planReviserAgent = new PlanReviserAgent(agentRunner, artifactRepo, logger);
  const executorAgent = new ExecutorAgent(agentRunner, artifactRepo, githubClient, logger);
  const reviewerAgent = new ReviewerAgent(agentRunner, artifactRepo, logger);
  const remediationAgent = new RemediationAgent(agentRunner, artifactRepo, logger);

  const linearClient = new MockLinearClient();
  linearClient.seedIssue(MOCK_ISSUE);

  const linearSync = new LinearSyncService(linearClient, logger);
  const githubSync = new GitHubSyncService(githubClient, logger);

  const dashboardEmitter = new RunEventEmitter();

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

  return { orchestrator, idempotencyRepo, dashboardEmitter };
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

  const { orchestrator, idempotencyRepo, dashboardEmitter } = buildServices();

  app.get("/health", () => ({
    status: "ok",
    mode: env.AGENT_RUNTIME_MODE,
    timestamp: new Date().toISOString(),
  }));

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

  registerLinearWebhook(app, orchestrator, idempotencyRepo);
  registerGitHubWebhook(app, orchestrator);
  registerApiRoutes(app, orchestrator, dashboardEmitter);

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
}

main().catch((err: unknown) => {
  logger.fatal(err, "Failed to start server");
  process.exit(1);
});
