import { describe, it, expect, vi, beforeEach } from "vitest";
import Fastify from "fastify";
import { registerLinearWebhook } from "../../src/linear/linearWebhook.js";
import type { OrchestratorService } from "../../src/orchestrator/orchestratorService.js";
import type { IdempotencyRepository } from "../../src/orchestrator/idempotencyRepository.js";

function buildApp(opts: { tryMarkProcessed?: ReturnType<typeof vi.fn> } = {}) {
  const orchestrator = {
    handleLinearWebhook: vi.fn().mockResolvedValue(undefined),
  };
  const idempotencyRepo = {
    tryMarkProcessed: opts.tryMarkProcessed ?? vi.fn().mockResolvedValue(true),
  };
  const app = Fastify();
  registerLinearWebhook(
    app,
    orchestrator as unknown as OrchestratorService,
    idempotencyRepo as unknown as IdempotencyRepository,
  );
  return { app, orchestrator, idempotencyRepo };
}

describe("registerLinearWebhook", () => {
  it("returns 400 for a payload missing required fields", async () => {
    const { app } = buildApp();

    const response = await app.inject({
      method: "POST",
      url: "/webhooks/linear",
      payload: { action: "create" },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "Invalid webhook payload" });
  });

  it("returns 200 with duplicate: true and skips the orchestrator when the webhook was already processed", async () => {
    const { app, orchestrator } = buildApp({
      tryMarkProcessed: vi.fn().mockResolvedValue(false),
    });

    const response = await app.inject({
      method: "POST",
      url: "/webhooks/linear",
      payload: { action: "create", type: "Issue", data: { id: "issue-1" } },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true, duplicate: true });
    expect(orchestrator.handleLinearWebhook).not.toHaveBeenCalled();
  });

  it("forwards an issue.created event for a new Issue/create webhook", async () => {
    const { app, orchestrator } = buildApp();

    const response = await app.inject({
      method: "POST",
      url: "/webhooks/linear",
      payload: { action: "create", type: "Issue", data: { id: "issue-1" } },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true });
    expect(orchestrator.handleLinearWebhook).toHaveBeenCalledWith({
      action: "issue.created",
      issueId: "issue-1",
    });
  });

  it("forwards an issue.updated event for an Issue/update webhook", async () => {
    const { app, orchestrator } = buildApp();

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

  it("parses and forwards a recognized command from a Comment/create webhook", async () => {
    const { app, orchestrator } = buildApp();

    const response = await app.inject({
      method: "POST",
      url: "/webhooks/linear",
      payload: {
        action: "create",
        type: "Comment",
        data: { id: "comment-1", body: "/pause-ai", issueId: "issue-3" },
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true });
    expect(orchestrator.handleLinearWebhook).toHaveBeenCalledWith({
      action: "comment.command",
      issueId: "issue-3",
      command: expect.anything(),
    });
  });

  it("does not forward a Comment/create webhook whose body has no recognized command", async () => {
    const { app, orchestrator } = buildApp();

    const response = await app.inject({
      method: "POST",
      url: "/webhooks/linear",
      payload: {
        action: "create",
        type: "Comment",
        data: { id: "comment-1", body: "just chatting, no command here", issueId: "issue-3" },
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true });
    expect(orchestrator.handleLinearWebhook).not.toHaveBeenCalled();
  });

  it("ignores a Comment/create webhook missing body or issueId", async () => {
    const { app, orchestrator } = buildApp();

    const response = await app.inject({
      method: "POST",
      url: "/webhooks/linear",
      payload: { action: "create", type: "Comment", data: { id: "comment-1" } },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true, ignored: true });
    expect(orchestrator.handleLinearWebhook).not.toHaveBeenCalled();
  });

  it("ignores an unrecognized type/action combination", async () => {
    const { app, orchestrator } = buildApp();

    const response = await app.inject({
      method: "POST",
      url: "/webhooks/linear",
      payload: { action: "remove", type: "Issue", data: { id: "issue-1" } },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true, ignored: true });
    expect(orchestrator.handleLinearWebhook).not.toHaveBeenCalled();
  });
});
