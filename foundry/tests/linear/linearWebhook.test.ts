import { describe, it, expect, vi } from "vitest";
import Fastify from "fastify";
import { registerLinearWebhook } from "../../src/linear/linearWebhook.js";

function buildApp(overrides: { orchestrator?: Record<string, unknown>; idempotent?: boolean } = {}) {
  const orchestrator = {
    handleLinearWebhook: vi.fn().mockResolvedValue(undefined),
    ...overrides.orchestrator,
  };
  const idempotencyRepo = {
    tryMarkProcessed: vi.fn().mockResolvedValue(overrides.idempotent ?? true),
  };

  const app = Fastify({ logger: false });
  registerLinearWebhook(app, orchestrator as never, idempotencyRepo as never);

  return { app, orchestrator, idempotencyRepo };
}

describe("registerLinearWebhook", () => {
  it("returns 400 for a malformed payload (missing required fields)", async () => {
    const { app, orchestrator } = buildApp();
    await app.ready();

    const response = await app.inject({
      method: "POST",
      url: "/webhooks/linear",
      payload: { foo: "bar" },
    });

    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body)).toEqual({ error: "Invalid webhook payload" });
    expect(orchestrator.handleLinearWebhook).not.toHaveBeenCalled();
  });

  it("returns 400 when data is missing an id", async () => {
    const { app } = buildApp();
    await app.ready();

    const response = await app.inject({
      method: "POST",
      url: "/webhooks/linear",
      payload: { action: "create", type: "Issue", data: {} },
    });

    expect(response.statusCode).toBe(400);
  });

  it("returns 200 with duplicate=true and skips the orchestrator when the event was already processed", async () => {
    const { app, orchestrator, idempotencyRepo } = buildApp({ idempotent: false });
    await app.ready();

    const response = await app.inject({
      method: "POST",
      url: "/webhooks/linear",
      payload: { action: "create", type: "Issue", data: { id: "issue-1" } },
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ ok: true, duplicate: true });
    expect(orchestrator.handleLinearWebhook).not.toHaveBeenCalled();
    expect(idempotencyRepo.tryMarkProcessed).toHaveBeenCalledWith("linear", "Issue:create:issue-1");
  });

  it("dispatches issue.created for Issue/create events", async () => {
    const { app, orchestrator } = buildApp();
    await app.ready();

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

  it("dispatches issue.updated for Issue/update events", async () => {
    const { app, orchestrator } = buildApp();
    await app.ready();

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

  it("dispatches comment.command for a Comment/create event with a recognized command", async () => {
    const { app, orchestrator } = buildApp();
    await app.ready();

    const response = await app.inject({
      method: "POST",
      url: "/webhooks/linear",
      payload: {
        action: "create",
        type: "Comment",
        data: { id: "comment-1", issueId: "issue-1", body: "/approve-plan" },
      },
    });

    expect(response.statusCode).toBe(200);
    expect(orchestrator.handleLinearWebhook).toHaveBeenCalledWith({
      action: "comment.command",
      issueId: "issue-1",
      command: { type: "approve-plan" },
    });
  });

  it("does not call the orchestrator for a Comment/create event whose body is not a command", async () => {
    const { app, orchestrator } = buildApp();
    await app.ready();

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
    expect(JSON.parse(response.body)).toEqual({ ok: true });
    expect(orchestrator.handleLinearWebhook).not.toHaveBeenCalled();
  });

  it("ignores a Comment/create event missing body or issueId", async () => {
    const { app, orchestrator } = buildApp();
    await app.ready();

    const response = await app.inject({
      method: "POST",
      url: "/webhooks/linear",
      payload: { action: "create", type: "Comment", data: { id: "comment-1" } },
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ ok: true, ignored: true });
    expect(orchestrator.handleLinearWebhook).not.toHaveBeenCalled();
  });

  it("returns ok+ignored=true for an unrecognized type/action combination", async () => {
    const { app, orchestrator } = buildApp();
    await app.ready();

    const response = await app.inject({
      method: "POST",
      url: "/webhooks/linear",
      payload: { action: "remove", type: "Issue", data: { id: "issue-1" } },
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ ok: true, ignored: true });
    expect(orchestrator.handleLinearWebhook).not.toHaveBeenCalled();
  });

  it("propagates an error thrown by the orchestrator as a 500", async () => {
    const { app } = buildApp({
      orchestrator: { handleLinearWebhook: vi.fn().mockRejectedValue(new Error("boom")) },
    });
    await app.ready();

    const response = await app.inject({
      method: "POST",
      url: "/webhooks/linear",
      payload: { action: "create", type: "Issue", data: { id: "issue-1" } },
    });

    expect(response.statusCode).toBe(500);
  });
});
