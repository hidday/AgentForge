import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { OrchestratorService } from "../orchestrator/orchestratorService.js";

const GitHubWebhookPayloadSchema = z.object({
  action: z.string(),
  pull_request: z
    .object({
      number: z.number(),
      state: z.string(),
      merged: z.boolean().optional(),
    })
    .optional(),
  repository: z
    .object({
      full_name: z.string(),
    })
    .optional(),
});

export function registerGitHubWebhook(
  app: FastifyInstance,
  _orchestrator: OrchestratorService,
): void {
  app.post("/webhooks/github", async (request, reply) => {
    const parsed = GitHubWebhookPayloadSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid webhook payload" });
    }

    // GitHub webhook handling is a stub for future extension.
    // In production, this would handle PR review events, check suite
    // completions, and merge events.
    return reply.code(200).send({ ok: true });
  });
}
