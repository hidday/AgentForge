import { describe, it, expect, vi, beforeEach } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { registerLinearWebhook } from "../../src/linear/linearWebhook.js";

function buildApp(opts?: {
  tryMarkProcessed?: (source: string, key: string) => Promise<boolean>;
  handleLinearWebhook?: (payload: unknown) => Promise<void>;
}) {
  const handleLinearWebhook = vi.fn(opts?.handleLinearWebhook ?? (async () => {}));
  const orchestrator = { handleLinearWebhook };

  const tryMarkProcessed = vi.fn(opts?.tryMarkProcessed ?? (async () => true));
  const idempotencyRepo = { tryMarkProcessed };

  const app: FastifyInstance = Fastify({ logger: false });
  registerLinearWebhook(app, orchestrator as never, idempotencyRepo as never);

  return { app, handleLinearWebhook, tryMarkProcessed };
}

describe("registerLinearWebhook", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 400 for a payload missing required fields", async () => {
    const { app, handleLinearWebhook, tryMarkProcessed } = buildApp();
    await app.ready();

    const response = await app.inject({
      method: "POST",
      url: "/webhooks/linear",
      payload: { action: "create" }, // missing type and data
    });

    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body)).toEqual({ error: "Invalid webhook payload" });
    expect(tryMarkProcessed).not.toHaveBeenCalled();
    expect(handleLinearWebhook).not.toHaveBeenCalled();
  });

  it("returns 400 when data.id is missing", async () => {
    const { app } = buildApp();
    await app.ready();

    const response = await app.inject({
      method: "POST",
      url: "/webhooks/linear",
      payload: { action: "create", type: "Issue", data: { title: "no id" } },
    });

    expect(response.statusCode).toBe(400);
  });

  it("returns 200 with duplicate=true and skips the orchestrator on a duplicate event", async () => {
    const { app, handleLinearWebhook, tryMarkProcessed } = buildApp({
      tryMarkProcessed: async () => false,
    });
    await app.ready();

    const response = await app.inject({
      method: "POST",
      url: "/webhooks/linear",
      payload: { action: "create", type: "Issue", data: { id: "issue-1" } },
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ ok: true, duplicate: true });
    expect(tryMarkProcessed).toHaveBeenCalledWith("linear", "Issue:create:issue-1");
    expect(handleLinearWebhook).not.toHaveBeenCalled();
  });

  it("dispatches issue.created for a new Issue/create event", async () => {
    const { app, handleLinearWebhook } = buildApp();
    await app.ready();

    const response = await app.inject({
      method: "POST",
      url: "/webhooks/linear",
      payload: { action: "create", type: "Issue", data: { id: "issue-1" } },
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ ok: true });
    expect(handleLinearWebhook).toHaveBeenCalledWith({
      action: "issue.created",
      issueId: "issue-1",
    });
  });

  it("dispatches issue.updated for an Issue/update event", async () => {
    const { app, handleLinearWebhook } = buildApp();
    await app.ready();

    const response = await app.inject({
      method: "POST",
      url: "/webhooks/linear",
      payload: { action: "update", type: "Issue", data: { id: "issue-2" } },
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ ok: true });
    expect(handleLinearWebhook).toHaveBeenCalledWith({
      action: "issue.updated",
      issueId: "issue-2",
    });
  });

  it("dispatches comment.command when a Comment/create event has a recognized command body", async () => {
    const { app, handleLinearWebhook } = buildApp();
    await app.ready();

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
    expect(JSON.parse(response.body)).toEqual({ ok: true });
    expect(handleLinearWebhook).toHaveBeenCalledWith({
      action: "comment.command",
      issueId: "issue-3",
      command: { type: "approve-plan" },
    });
  });

  it("returns ok without dispatching when a Comment/create body has no recognized command", async () => {
    const { app, handleLinearWebhook } = buildApp();
    await app.ready();

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
    expect(handleLinearWebhook).not.toHaveBeenCalled();
  });

  it("falls through to ignored=true for a Comment/create event missing a body", async () => {
    const { app, handleLinearWebhook } = buildApp();
    await app.ready();

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
    expect(JSON.parse(response.body)).toEqual({ ok: true, ignored: true });
    expect(handleLinearWebhook).not.toHaveBeenCalled();
  });

  it("falls through to ignored=true for a Comment/create event missing issueId", async () => {
    const { app, handleLinearWebhook } = buildApp();
    await app.ready();

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
    expect(JSON.parse(response.body)).toEqual({ ok: true, ignored: true });
    expect(handleLinearWebhook).not.toHaveBeenCalled();
  });

  it("returns ignored=true for event types/actions it does not handle", async () => {
    const { app, handleLinearWebhook } = buildApp();
    await app.ready();

    const response = await app.inject({
      method: "POST",
      url: "/webhooks/linear",
      payload: { action: "remove", type: "Issue", data: { id: "issue-4" } },
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ ok: true, ignored: true });
    expect(handleLinearWebhook).not.toHaveBeenCalled();
  });
});
