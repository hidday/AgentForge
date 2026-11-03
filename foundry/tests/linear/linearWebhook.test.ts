import { describe, it, expect, vi, beforeEach } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { registerLinearWebhook } from "../../src/linear/linearWebhook.js";
import type { OrchestratorService } from "../../src/orchestrator/orchestratorService.js";
import type { IdempotencyRepository } from "../../src/orchestrator/idempotencyRepository.js";

function makeMocks() {
  const orchestrator = {
    handleLinearWebhook: vi.fn().mockResolvedValue(undefined),
  };
  const idempotencyRepo = {
    tryMarkProcessed: vi.fn().mockResolvedValue(true),
  };
  return { orchestrator, idempotencyRepo };
}

async function buildApp(
  orchestrator: ReturnType<typeof makeMocks>["orchestrator"],
  idempotencyRepo: ReturnType<typeof makeMocks>["idempotencyRepo"],
): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  registerLinearWebhook(
    app,
    orchestrator as unknown as OrchestratorService,
    idempotencyRepo as unknown as IdempotencyRepository,
  );
  await app.ready();
  return app;
}

describe("registerLinearWebhook POST /webhooks/linear", () => {
  let orchestrator: ReturnType<typeof makeMocks>["orchestrator"];
  let idempotencyRepo: ReturnType<typeof makeMocks>["idempotencyRepo"];

  beforeEach(() => {
    ({ orchestrator, idempotencyRepo } = makeMocks());
  });

  it("returns 400 for a malformed payload (missing required fields)", async () => {
    const app = await buildApp(orchestrator, idempotencyRepo);

    const response = await app.inject({
      method: "POST",
      url: "/webhooks/linear",
      payload: { action: "create" }, // missing `type` and `data`
    });

    expect(response.statusCode).toBe(400);
    const body = JSON.parse(response.body) as { error: string };
    expect(body.error).toBe("Invalid webhook payload");
    expect(idempotencyRepo.tryMarkProcessed).not.toHaveBeenCalled();
    expect(orchestrator.handleLinearWebhook).not.toHaveBeenCalled();
  });

  it("returns 400 when data.id is missing", async () => {
    const app = await buildApp(orchestrator, idempotencyRepo);

    const response = await app.inject({
      method: "POST",
      url: "/webhooks/linear",
      payload: { action: "create", type: "Issue", data: { title: "no id" } },
    });

    expect(response.statusCode).toBe(400);
  });

  it("returns 400 for a JSON body that is not an object (e.g. a bare string)", async () => {
    const app = await buildApp(orchestrator, idempotencyRepo);

    const response = await app.inject({
      method: "POST",
      url: "/webhooks/linear",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify("not an object"),
    });

    expect(response.statusCode).toBe(400);
  });

  it("deduplicates using a key derived from type, action and data.id", async () => {
    const app = await buildApp(orchestrator, idempotencyRepo);

    await app.inject({
      method: "POST",
      url: "/webhooks/linear",
      payload: { action: "create", type: "Issue", data: { id: "issue-1" } },
    });

    expect(idempotencyRepo.tryMarkProcessed).toHaveBeenCalledWith(
      "linear",
      "Issue:create:issue-1",
    );
  });

  it("returns 200 with duplicate:true and skips the orchestrator on a duplicate event", async () => {
    idempotencyRepo.tryMarkProcessed.mockResolvedValue(false);
    const app = await buildApp(orchestrator, idempotencyRepo);

    const response = await app.inject({
      method: "POST",
      url: "/webhooks/linear",
      payload: { action: "create", type: "Issue", data: { id: "issue-1" } },
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ ok: true, duplicate: true });
    expect(orchestrator.handleLinearWebhook).not.toHaveBeenCalled();
  });

  it("forwards an Issue create event as issue.created", async () => {
    const app = await buildApp(orchestrator, idempotencyRepo);

    const response = await app.inject({
      method: "POST",
      url: "/webhooks/linear",
      payload: { action: "create", type: "Issue", data: { id: "issue-1" } },
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ ok: true });
    expect(orchestrator.handleLinearWebhook).toHaveBeenCalledWith({
      action: "issue.created",
      issueId: "issue-1",
    });
  });

  it("forwards an Issue update event as issue.updated", async () => {
    const app = await buildApp(orchestrator, idempotencyRepo);

    const response = await app.inject({
      method: "POST",
      url: "/webhooks/linear",
      payload: { action: "update", type: "Issue", data: { id: "issue-2" } },
    });

    expect(response.statusCode).toBe(200);
    expect(orchestrator.handleLinearWebhook).toHaveBeenCalledWith({
      action: "issue.updated",
      issueId: "issue-2",
    });
  });

  it("parses a recognised comment command and forwards comment.command with the parsed command", async () => {
    const app = await buildApp(orchestrator, idempotencyRepo);

    const response = await app.inject({
      method: "POST",
      url: "/webhooks/linear",
      payload: {
        action: "create",
        type: "Comment",
        data: { id: "comment-1", issueId: "issue-3", body: "/approve-plan" },
      },
    });

    expect(response.statusCode).toBe(200);
    expect(orchestrator.handleLinearWebhook).toHaveBeenCalledWith({
      action: "comment.command",
      issueId: "issue-3",
      command: { type: "approve-plan" },
    });
  });

  it("forwards an unknown-but-slash-prefixed command as the unknown command type", async () => {
    const app = await buildApp(orchestrator, idempotencyRepo);

    const response = await app.inject({
      method: "POST",
      url: "/webhooks/linear",
      payload: {
        action: "create",
        type: "Comment",
        data: { id: "comment-1", issueId: "issue-3", body: "/not-a-real-command" },
      },
    });

    expect(response.statusCode).toBe(200);
    expect(orchestrator.handleLinearWebhook).toHaveBeenCalledWith({
      action: "comment.command",
      issueId: "issue-3",
      command: { type: "unknown", raw: "/not-a-real-command" },
    });
  });

  it("returns 200 ok without forwarding when a comment body has no command", async () => {
    const app = await buildApp(orchestrator, idempotencyRepo);

    const response = await app.inject({
      method: "POST",
      url: "/webhooks/linear",
      payload: {
        action: "create",
        type: "Comment",
        data: { id: "comment-1", issueId: "issue-3", body: "just a regular comment" },
      },
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ ok: true });
    expect(orchestrator.handleLinearWebhook).not.toHaveBeenCalled();
  });

  it("returns 200 ok without forwarding a Comment create event missing a body", async () => {
    const app = await buildApp(orchestrator, idempotencyRepo);

    const response = await app.inject({
      method: "POST",
      url: "/webhooks/linear",
      payload: {
        action: "create",
        type: "Comment",
        data: { id: "comment-1", issueId: "issue-3" },
      },
    });

    expect(response.statusCode).toBe(200);
    expect(orchestrator.handleLinearWebhook).not.toHaveBeenCalled();
  });

  it("returns 200 ok without forwarding a Comment create event missing an issueId", async () => {
    const app = await buildApp(orchestrator, idempotencyRepo);

    const response = await app.inject({
      method: "POST",
      url: "/webhooks/linear",
      payload: {
        action: "create",
        type: "Comment",
        data: { id: "comment-1", body: "/approve-plan" },
      },
    });

    expect(response.statusCode).toBe(200);
    expect(orchestrator.handleLinearWebhook).not.toHaveBeenCalled();
  });

  it("returns 200 ignored:true for an unhandled type/action combination", async () => {
    const app = await buildApp(orchestrator, idempotencyRepo);

    const response = await app.inject({
      method: "POST",
      url: "/webhooks/linear",
      payload: { action: "delete", type: "Issue", data: { id: "issue-4" } },
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ ok: true, ignored: true });
    expect(orchestrator.handleLinearWebhook).not.toHaveBeenCalled();
  });

  it("returns 200 ignored:true for a Comment update event (not create)", async () => {
    const app = await buildApp(orchestrator, idempotencyRepo);

    const response = await app.inject({
      method: "POST",
      url: "/webhooks/linear",
      payload: {
        action: "update",
        type: "Comment",
        data: { id: "comment-1", issueId: "issue-3", body: "/approve-plan" },
      },
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ ok: true, ignored: true });
    expect(orchestrator.handleLinearWebhook).not.toHaveBeenCalled();
  });

  it("propagates an error thrown by the orchestrator (surfaced as a 500)", async () => {
    orchestrator.handleLinearWebhook.mockRejectedValue(new Error("orchestrator failure"));
    const app = await buildApp(orchestrator, idempotencyRepo);

    const response = await app.inject({
      method: "POST",
      url: "/webhooks/linear",
      payload: { action: "create", type: "Issue", data: { id: "issue-1" } },
    });

    expect(response.statusCode).toBe(500);
  });
});
