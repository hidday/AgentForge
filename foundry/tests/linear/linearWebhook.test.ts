import { describe, it, expect, vi, beforeEach } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { registerLinearWebhook } from "../../src/linear/linearWebhook.js";

function buildApp(opts: { tryMarkProcessed?: ReturnType<typeof vi.fn> } = {}) {
  const orchestrator = { handleLinearWebhook: vi.fn().mockResolvedValue(undefined) };
  const idempotencyRepo = {
    tryMarkProcessed: opts.tryMarkProcessed ?? vi.fn().mockResolvedValue(true),
  };
  const app: FastifyInstance = Fastify({ logger: false });
  registerLinearWebhook(app, orchestrator as never, idempotencyRepo as never);
  return { app, orchestrator, idempotencyRepo };
}

describe("POST /webhooks/linear", () => {
  let app: FastifyInstance;
  let orchestrator: { handleLinearWebhook: ReturnType<typeof vi.fn> };
  let idempotencyRepo: { tryMarkProcessed: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    ({ app, orchestrator, idempotencyRepo } = buildApp());
  });

  it("returns 400 for a payload that fails schema validation", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/webhooks/linear",
      payload: { action: "create" },
    });
    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body).error).toBe("Invalid webhook payload");
    expect(orchestrator.handleLinearWebhook).not.toHaveBeenCalled();
  });

  it("returns 200 with duplicate=true and skips handling for an already-processed event", async () => {
    ({ app, orchestrator, idempotencyRepo } = buildApp({
      tryMarkProcessed: vi.fn().mockResolvedValue(false),
    }));
    const response = await app.inject({
      method: "POST",
      url: "/webhooks/linear",
      payload: { action: "create", type: "Issue", data: { id: "issue-1" } },
    });
    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ ok: true, duplicate: true });
    expect(orchestrator.handleLinearWebhook).not.toHaveBeenCalled();
  });

  it("handles Issue create by forwarding issue.created", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/webhooks/linear",
      payload: { action: "create", type: "Issue", data: { id: "issue-1" } },
    });
    expect(response.statusCode).toBe(200);
    expect(orchestrator.handleLinearWebhook).toHaveBeenCalledWith({
      action: "issue.created",
      issueId: "issue-1",
    });
  });

  it("handles Issue update by forwarding issue.updated", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/webhooks/linear",
      payload: { action: "update", type: "Issue", data: { id: "issue-1" } },
    });
    expect(response.statusCode).toBe(200);
    expect(orchestrator.handleLinearWebhook).toHaveBeenCalledWith({
      action: "issue.updated",
      issueId: "issue-1",
    });
  });

  it("parses a recognized command from a new Comment and forwards comment.command", async () => {
    idempotencyRepo.tryMarkProcessed.mockResolvedValue(true);
    const response = await app.inject({
      method: "POST",
      url: "/webhooks/linear",
      payload: {
        action: "create",
        type: "Comment",
        data: { id: "comment-1", issueId: "issue-1", body: "/approve" },
      },
    });
    expect(response.statusCode).toBe(200);
    expect(orchestrator.handleLinearWebhook).toHaveBeenCalledWith(
      expect.objectContaining({ action: "comment.command", issueId: "issue-1" }),
    );
  });

  it("does not forward a comment that contains no recognized command", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/webhooks/linear",
      payload: {
        action: "create",
        type: "Comment",
        data: { id: "comment-1", issueId: "issue-1", body: "just a regular comment" },
      },
    });
    expect(response.statusCode).toBe(200);
    expect(orchestrator.handleLinearWebhook).not.toHaveBeenCalled();
  });

  it("ignores comment creation missing a body or issueId", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/webhooks/linear",
      payload: { action: "create", type: "Comment", data: { id: "comment-1" } },
    });
    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ ok: true, ignored: true });
  });

  it("returns ok/ignored for an event type it does not recognize", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/webhooks/linear",
      payload: { action: "remove", type: "Reaction", data: { id: "r-1" } },
    });
    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ ok: true, ignored: true });
    expect(orchestrator.handleLinearWebhook).not.toHaveBeenCalled();
  });
});
