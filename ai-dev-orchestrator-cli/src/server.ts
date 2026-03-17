import Fastify from "fastify";
import { env } from "./config/env.js";
import { logger } from "./utils/logger.js";
import { getPrismaClient, disconnectPrisma } from "./db/prisma.js";
import { RunRepository } from "./orchestrator/runRepository.js";
import { ArtifactRepository } from "./orchestrator/artifactRepository.js";
import { EventRepository } from "./orchestrator/eventRepository.js";
import { OrchestratorService } from "./orchestrator/orchestratorService.js";
import { ProcessRunner } from "./runtime/processRunner.js";
import { ClaudeCodeRunner } from "./runtime/claudeCodeRunner.js";
import { CodexRunner } from "./runtime/codexRunner.js";
import { AgentRunner } from "./runtime/agentRunner.js";
import { PlannerAgent } from "./agents/plannerAgent.js";
import { ExecutorAgent } from "./agents/executorAgent.js";
import { ReviewerAgent } from "./agents/reviewerAgent.js";
import { RemediationAgent } from "./agents/remediationAgent.js";
import { MockLinearClient } from "./linear/linearClient.js";
import { MockGitHubClient } from "./github/githubClient.js";
import { registerLinearWebhook } from "./linear/linearWebhook.js";
import { registerGitHubWebhook } from "./github/githubWebhook.js";
import { createMockProcessHandler } from "./mocks/mockCliOutputs.js";
import { MOCK_ISSUE } from "./mocks/mockLinearData.js";
import { parseLinearCommand } from "./linear/linearCommandParser.js";

function buildOrchestrator(): OrchestratorService {
  const prisma = getPrismaClient();

  const runRepo = new RunRepository(prisma);
  const artifactRepo = new ArtifactRepository(prisma);
  const eventRepo = new EventRepository(prisma);

  const processRunner = new ProcessRunner(env.AGENT_RUNTIME_MODE, logger);
  if (env.AGENT_RUNTIME_MODE === "mock") {
    processRunner.setMockHandler(createMockProcessHandler());
  }

  const claudeCodeRunner = new ClaudeCodeRunner(
    processRunner,
    env.CLAUDE_CODE_COMMAND,
    logger,
  );
  const codexRunner = new CodexRunner(
    processRunner,
    env.CODEX_COMMAND,
    logger,
  );
  const agentRunner = new AgentRunner(claudeCodeRunner, codexRunner, logger);

  const plannerAgent = new PlannerAgent(agentRunner, artifactRepo, logger);
  const executorAgent = new ExecutorAgent(
    agentRunner,
    artifactRepo,
    new MockGitHubClient(),
    logger,
  );
  const reviewerAgent = new ReviewerAgent(agentRunner, artifactRepo, logger);
  const remediationAgent = new RemediationAgent(agentRunner, artifactRepo, logger);

  const linearClient = new MockLinearClient();
  linearClient.seedIssue(MOCK_ISSUE);

  const githubClient = new MockGitHubClient();

  return new OrchestratorService({
    runRepo,
    artifactRepo,
    eventRepo,
    linearClient,
    githubClient,
    plannerAgent,
    executorAgent,
    reviewerAgent,
    remediationAgent,
    logger,
  });
}

async function main(): Promise<void> {
  const app = Fastify({
    logger: {
      level: env.LOG_LEVEL,
      transport:
        process.env["NODE_ENV"] !== "production"
          ? { target: "pino-pretty", options: { colorize: true } }
          : undefined,
    },
  });

  const orchestrator = buildOrchestrator();

  app.get("/health", async () => ({
    status: "ok",
    mode: env.AGENT_RUNTIME_MODE,
    timestamp: new Date().toISOString(),
  }));

  registerLinearWebhook(app, orchestrator);
  registerGitHubWebhook(app, orchestrator);

  app.post<{ Params: { issueId: string } }>(
    "/simulate/run/:issueId",
    async (request, reply) => {
      const { issueId } = request.params;
      try {
        const run = await orchestrator.startRun(issueId);
        return reply.send({ ok: true, runId: run.id, state: run.state });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return reply.code(500).send({ ok: false, error: message });
      }
    },
  );

  app.post("/simulate/comment-command", async (request, reply) => {
    const body = request.body as { issueId?: string; command?: string } | undefined;
    if (!body?.issueId || !body?.command) {
      return reply
        .code(400)
        .send({ error: "Required: { issueId, command }" });
    }

    const command = parseLinearCommand(body.command);
    if (!command) {
      return reply.code(400).send({ error: "Unrecognized command" });
    }

    try {
      await orchestrator.handleCommand(body.issueId, command);
      return reply.send({ ok: true, command: command.type });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return reply.code(500).send({ ok: false, error: message });
    }
  });

  app.setErrorHandler((error: { statusCode?: number; message: string }, _request, reply) => {
    app.log.error(error);
    const statusCode = error.statusCode ?? 500;
    reply.code(statusCode).send({
      error: error.message,
      statusCode,
    });
  });

  const shutdown = async (): Promise<void> => {
    app.log.info("Shutting down...");
    await app.close();
    await disconnectPrisma();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  await app.listen({ port: env.PORT, host: "0.0.0.0" });
  app.log.info(
    `Server running on port ${env.PORT} in ${env.AGENT_RUNTIME_MODE} mode`,
  );
}

main().catch((err) => {
  logger.fatal(err, "Failed to start server");
  process.exit(1);
});
