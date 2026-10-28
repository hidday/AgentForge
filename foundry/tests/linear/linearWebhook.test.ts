import { describe, it, expect, vi, afterEach } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { registerLinearWebhook } from "../../src/linear/linearWebhook.js";

function buildApp(orchestrator: { handleLinearWebhook: ReturnType<typeof vi.fn> }, idempotencyRepo: { tryMarkProcessed: ReturnType<typeof vi.fn> }) {
  const app = Fastify({ logger: false });
  registerLinearWebhook(app, orchestrator as never, idempotencyRepo as never);
  return app;
}

describe("registerLinearWebhook", () => {
  let app: FastifyInstance | undefined;

  afterEach(async () => {
    if (app) await app.close();
    app = undefined;
  });

  it("rejects a malformed payload", async () => {
    const orchestrator = { handleLinearWebhook: vi.fn() };
    const idempotencyRepo = { tryMarkProcessed: vi.fn() };
    app = buildApp(orchestrator, idempotencyRepo);
    await app.ready();

    const response = await app.inject({
      method: "POST",
      url: "/webhooks/linear",
      payload: { action: "create" },
    });

    expect(response.statusCode).toBe(400);
    expect(idempotencyRepo.tryMarkProcessed).not.toHaveBeenCalled();
  });

  it("returns duplicate:true without dispatching when the event was already processed", async () => {
    const orchestrator = { handleLinearWebhook: vi.fn() };
    const idempotencyRepo = { tryMarkProcessed: vi.fn().mockResolvedValue(false) };
    app = buildApp(orchestrator, idempotencyRepo);
    await app.ready();

    const response = await app.inject({
      method: "POST",
      url: "/webhooks/linear",
      payload: { action: "create", type: "Issue", data: { id: "evt-1" } },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true, duplicate: true });
    expect(orchestrator.handleLinearWebhook).not.toHaveBeenCalled();
  });

  it("dispatches issue.created for a new Issue create event", async () => {
    const orchestrator = { handleLinearWebhook: vi.fn() };
    const idempotencyRepo = { tryMarkProcessed: vi.fn().mockResolvedValue(true) };
    app = buildApp(orchestrator, idempotencyRepo);
    await app.ready();

    const response = await app.inject({
      method: "POST",
      url: "/webhooks/linear",
      payload: { action: "create", type: "Issue", data: { id: "LIN-1" } },
    });

    expect(response.statusCode).toBe(200);
    expect(orchestrator.handleLinearWebhook).toHaveBeenCalledWith({
      action: "issue.created",
      issueId: "LIN-1",
    });
  });

  it("dispatches issue.updated for an Issue update event", async () => {
    const orchestrator = { handleLinearWebhook: vi.fn() };
    const idempotencyRepo = { tryMarkProcessed: vi.fn().mockResolvedValue(true) };
    app = buildApp(orchestrator, idempotencyRepo);
    await app.ready();

    const response = await app.inject({
      method: "POST",
      url: "/webhooks/linear",
      payload: { action: "update", type: "Issue", data: { id: "LIN-1" } },
    });

    expect(response.statusCode).toBe(200);
    expect(orchestrator.handleLinearWebhook).toHaveBeenCalledWith({
      action: "issue.updated",
      issueId: "LIN-1",
    });
  });

  it("dispatches comment.command when a comment body parses to a recognized command", async () => {
    const orchestrator = { handleLinearWebhook: vi.fn() };
    const idempotencyRepo = { tryMarkProcessed: vi.fn().mockResolvedValue(true) };
    app = buildApp(orchestrator, idempotencyRepo);
    await app.ready();

    const response = await app.inject({
      method: "POST",
      url: "/webhooks/linear",
      payload: {
        action: "create",
        type: "Comment",
        data: { id: "cmt-1", body: "/approve-plan", issueId: "LIN-1" },
      },
    });

    expect(response.statusCode).toBe(200);
    expect(orchestrator.handleLinearWebhook).toHaveBeenCalledWith(
      expect.objectContaining({ action: "comment.command", issueId: "LIN-1" }),
    );
  });

  it("does not dispatch when a comment body does not parse to a recognized command", async () => {
    const orchestrator = { handleLinearWebhook: vi.fn() };
    const idempotencyRepo = { tryMarkProcessed: vi.fn().mockResolvedValue(true) };
    app = buildApp(orchestrator, idempotencyRepo);
    await app.ready();

    const response = await app.inject({
      method: "POST",
      url: "/webhooks/linear",
      payload: {
        action: "create",
        type: "Comment",
        data: { id: "cmt-1", body: "just a regular comment", issueId: "LIN-1" },
      },
    });

    expect(response.statusCode).toBe(200);
    expect(orchestrator.handleLinearWebhook).not.toHaveBeenCalled();
  });

  it("ignores a comment create event missing body or issueId", async () => {
    const orchestrator = { handleLinearWebhook: vi.fn() };
    const idempotencyRepo = { tryMarkProcessed: vi.fn().mockResolvedValue(true) };
    app = buildApp(orchestrator, idempotencyRepo);
    await app.ready();

    const response = await app.inject({
      method: "POST",
      url: "/webhooks/linear",
      payload: { action: "create", type: "Comment", data: { id: "cmt-1" } },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true, ignored: true });
    expect(orchestrator.handleLinearWebhook).not.toHaveBeenCalled();
  });

  it("returns ignored:true for an unhandled type/action combination", async () => {
    const orchestrator = { handleLinearWebhook: vi.fn() };
    const idempotencyRepo = { tryMarkProcessed: vi.fn().mockResolvedValue(true) };
    app = buildApp(orchestrator, idempotencyRepo);
    await app.ready();

    const response = await app.inject({
      method: "POST",
      url: "/webhooks/linear",
      payload: { action: "remove", type: "Issue", data: { id: "LIN-1" } },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true, ignored: true });
  });
});
