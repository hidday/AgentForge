import { describe, it, expect, vi, beforeEach } from "vitest";
import Fastify from "fastify";
import { registerLinearWebhook } from "../../src/linear/linearWebhook.js";

function buildDeps() {
  const orchestrator = { handleLinearWebhook: vi.fn().mockResolvedValue(undefined) };
  const idempotencyRepo = { tryMarkProcessed: vi.fn().mockResolvedValue(true) };
  return { orchestrator, idempotencyRepo };
}

async function buildApp(orchestrator: unknown, idempotencyRepo: unknown) {
  const app = Fastify({ logger: false });
  registerLinearWebhook(app, orchestrator as never, idempotencyRepo as never);
  await app.ready();
  return app;
}

describe("POST /webhooks/linear", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 400 for an invalid payload", async () => {
    const { orchestrator, idempotencyRepo } = buildDeps();
    const app = await buildApp(orchestrator, idempotencyRepo);
    const response = await app.inject({
      method: "POST",
      url: "/webhooks/linear",
      payload: { action: "create" },
    });
    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body)).toEqual({ error: "Invalid webhook payload" });
    expect(idempotencyRepo.tryMarkProcessed).not.toHaveBeenCalled();
  });

  it("returns duplicate=true and skips handling when the event was already processed", async () => {
    const { orchestrator, idempotencyRepo } = buildDeps();
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

  it("dispatches issue.created for a new Issue/create event", async () => {
    const { orchestrator, idempotencyRepo } = buildDeps();
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
    expect(idempotencyRepo.tryMarkProcessed).toHaveBeenCalledWith("linear", "Issue:create:issue-1");
  });

  it("dispatches issue.updated for an Issue/update event", async () => {
    const { orchestrator, idempotencyRepo } = buildDeps();
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

  it("dispatches comment.command when the comment body parses to a known command", async () => {
    const { orchestrator, idempotencyRepo } = buildDeps();
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

  it("does not dispatch a command when the comment body has no recognizable command", async () => {
    const { orchestrator, idempotencyRepo } = buildDeps();
    const app = await buildApp(orchestrator, idempotencyRepo);
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

  it("returns ok without dispatching for a Comment/create event missing body or issueId", async () => {
    const { orchestrator, idempotencyRepo } = buildDeps();
    const app = await buildApp(orchestrator, idempotencyRepo);
    const response = await app.inject({
      method: "POST",
      url: "/webhooks/linear",
      payload: { action: "create", type: "Comment", data: { id: "comment-3" } },
    });
    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ ok: true, ignored: true });
    expect(orchestrator.handleLinearWebhook).not.toHaveBeenCalled();
  });

  it("returns ignored=true for an event type/action combination it does not handle", async () => {
    const { orchestrator, idempotencyRepo } = buildDeps();
    const app = await buildApp(orchestrator, idempotencyRepo);
    const response = await app.inject({
      method: "POST",
      url: "/webhooks/linear",
      payload: { action: "remove", type: "Issue", data: { id: "issue-4" } },
    });
    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ ok: true, ignored: true });
    expect(orchestrator.handleLinearWebhook).not.toHaveBeenCalled();
  });
});
