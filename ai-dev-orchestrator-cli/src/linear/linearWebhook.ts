import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { OrchestratorService } from "../orchestrator/orchestratorService.js";
import { parseLinearCommand } from "./linearCommandParser.js";

const LinearWebhookPayloadSchema = z.object({
  action: z.string(),
  type: z.string(),
  data: z.object({
    id: z.string(),
    title: z.string().optional(),
    description: z.string().optional(),
    body: z.string().optional(),
    issueId: z.string().optional(),
  }),
});

export function registerLinearWebhook(
  app: FastifyInstance,
  orchestrator: OrchestratorService,
): void {
  app.post("/webhooks/linear", async (request, reply) => {
    const parsed = LinearWebhookPayloadSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid webhook payload" });
    }

    const { action, type, data } = parsed.data;

    if (type === "Issue" && action === "create") {
      await orchestrator.handleLinearWebhook({
        action: "issue.created",
        issueId: data.id,
      });
      return reply.code(200).send({ ok: true });
    }

    if (type === "Issue" && action === "update") {
      await orchestrator.handleLinearWebhook({
        action: "issue.updated",
        issueId: data.id,
      });
      return reply.code(200).send({ ok: true });
    }

    if (type === "Comment" && action === "create" && data.body && data.issueId) {
      const command = parseLinearCommand(data.body);
      if (command) {
        await orchestrator.handleLinearWebhook({
          action: "comment.command",
          issueId: data.issueId,
          command,
        });
      }
      return reply.code(200).send({ ok: true });
    }

    return reply.code(200).send({ ok: true, ignored: true });
  });
}
