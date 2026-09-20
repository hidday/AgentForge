import { describe, it, expect, vi } from "vitest";
import Fastify from "fastify";
import { registerLinearWebhook } from "../../src/linear/linearWebhook.js";

async function buildApp(overrides: { tryMarkProcessed?: ReturnType<typeof vi.fn> } = {}) {
  const orchestrator = { handleLinearWebhook: vi.fn().mockResolvedValue(undefined) };
  const idempotencyRepo = {
    tryMarkProcessed: overrides.tryMarkProcessed ?? vi.fn().mockResolvedValue(true),
  };

  const app = Fastify({ logger: false });
  registerLinearWebhook(app, orchestrator as never, idempotencyRepo as never);
  await app.ready();

  return { app, orchestrator, idempotencyRepo };
}

describe("POST /webhooks/linear", () => {
  it("returns 400 for a payload missing required fields", async () => {
    const { app } = await buildApp();

    const response = await app.inject({
      method: "POST",
      url: "/webhooks/linear",
      payload: { action: "create" },
    });

    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body)).toEqual({ error: "Invalid webhook payload" });
  });

  it("short-circuits duplicate events without invoking the orchestrator", async () => {
    const { app, orchestrator } = await buildApp({
      tryMarkProcessed: vi.fn().mockResolvedValue(false),
    });

    const response = await app.inject({
      method: "POST",
      url: "/webhooks/linear",
      payload: { action: "create", type: "Issue", data: { id: "issue-1" } },
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ ok: true, duplicate: true });
    expect(orchestrator.handleLinearWebhook).not.toHaveBeenCalled();
  });

  it("uses type:action:id as the idempotency dedupe key", async () => {
    const { app, idempotencyRepo } = await buildApp();

    await app.inject({
      method: "POST",
      url: "/webhooks/linear",
      payload: { action: "create", type: "Issue", data: { id: "issue-42" } },
    });

    expect(idempotencyRepo.tryMarkProcessed).toHaveBeenCalledWith(
      "linear",
      "Issue:create:issue-42",
    );
  });

  it("handles Issue create as issue.created", async () => {
    const { app, orchestrator } = await buildApp();

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

  it("handles Issue update as issue.updated", async () => {
    const { app, orchestrator } = await buildApp();

    const response = await app.inject({
      method: "POST",
      url: "/webhooks/linear",
      payload: { action: "update", type: "Issue", data: { id: "issue-2" } },
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ ok: true });
    expect(orchestrator.handleLinearWebhook).toHaveBeenCalledWith({
      action: "issue.updated",
      issueId: "issue-2",
    });
  });

  it("parses a valid slash command from a new Comment and forwards it", async () => {
    const { app, orchestrator } = await buildApp();

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
    expect(orchestrator.handleLinearWebhook).toHaveBeenCalledWith({
      action: "comment.command",
      issueId: "issue-3",
      command: { type: "approve-plan" },
    });
  });

  it("does not invoke the orchestrator for a Comment whose body is not a command", async () => {
    const { app, orchestrator } = await buildApp();

    const response = await app.inject({
      method: "POST",
      url: "/webhooks/linear",
      payload: {
        action: "create",
        type: "Comment",
        data: { id: "comment-2", issueId: "issue-3", body: "just a regular comment" },
      },
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ ok: true });
    expect(orchestrator.handleLinearWebhook).not.toHaveBeenCalled();
  });

  it("ignores a Comment create missing body or issueId", async () => {
    const { app, orchestrator } = await buildApp();

    const response = await app.inject({
      method: "POST",
      url: "/webhooks/linear",
      payload: { action: "create", type: "Comment", data: { id: "comment-3" } },
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ ok: true, ignored: true });
    expect(orchestrator.handleLinearWebhook).not.toHaveBeenCalled();
  });

  it("ignores unrecognized type/action combinations", async () => {
    const { app, orchestrator } = await buildApp();

    const response = await app.inject({
      method: "POST",
      url: "/webhooks/linear",
      payload: { action: "remove", type: "Issue", data: { id: "issue-9" } },
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ ok: true, ignored: true });
    expect(orchestrator.handleLinearWebhook).not.toHaveBeenCalled();
  });
});
