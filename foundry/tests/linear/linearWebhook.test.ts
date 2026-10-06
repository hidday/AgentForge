import { describe, it, expect, vi, beforeEach } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { registerLinearWebhook } from "../../src/linear/linearWebhook.js";

async function buildApp(opts: { isNew?: boolean } = {}) {
  const mockOrchestrator = {
    handleLinearWebhook: vi.fn().mockResolvedValue(undefined),
  };
  const mockIdempotencyRepo = {
    tryMarkProcessed: vi.fn().mockResolvedValue(opts.isNew ?? true),
  };

  const app: FastifyInstance = Fastify({ logger: false });
  registerLinearWebhook(
    app,
    mockOrchestrator as never,
    mockIdempotencyRepo as never,
  );

  await app.ready();
  return { app, mockOrchestrator, mockIdempotencyRepo };
}

describe("registerLinearWebhook POST /webhooks/linear", () => {
  let app: FastifyInstance;
  let mockOrchestrator: { handleLinearWebhook: ReturnType<typeof vi.fn> };
  let mockIdempotencyRepo: { tryMarkProcessed: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    ({ app, mockOrchestrator, mockIdempotencyRepo } = await buildApp());
  });

  it("returns 400 for a payload that fails schema validation", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/webhooks/linear",
      payload: { action: "create" /* missing type and data */ },
    });

    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body)).toEqual({ error: "Invalid webhook payload" });
    expect(mockIdempotencyRepo.tryMarkProcessed).not.toHaveBeenCalled();
    expect(mockOrchestrator.handleLinearWebhook).not.toHaveBeenCalled();
  });

  it("returns 400 when data.id is missing", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/webhooks/linear",
      payload: { action: "create", type: "Issue", data: {} },
    });

    expect(response.statusCode).toBe(400);
  });

  it("short-circuits as a duplicate without invoking the orchestrator", async () => {
    ({ app, mockOrchestrator, mockIdempotencyRepo } = await buildApp({ isNew: false }));

    const response = await app.inject({
      method: "POST",
      url: "/webhooks/linear",
      payload: { action: "create", type: "Issue", data: { id: "issue-1" } },
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ ok: true, duplicate: true });
    expect(mockOrchestrator.handleLinearWebhook).not.toHaveBeenCalled();
  });

  it("uses a dedupe key combining type, action and data.id", async () => {
    await app.inject({
      method: "POST",
      url: "/webhooks/linear",
      payload: { action: "create", type: "Issue", data: { id: "issue-42" } },
    });

    expect(mockIdempotencyRepo.tryMarkProcessed).toHaveBeenCalledWith(
      "linear",
      "Issue:create:issue-42",
    );
  });

  it("dispatches issue.created for an Issue create event", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/webhooks/linear",
      payload: { action: "create", type: "Issue", data: { id: "issue-1", title: "New" } },
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ ok: true });
    expect(mockOrchestrator.handleLinearWebhook).toHaveBeenCalledWith({
      action: "issue.created",
      issueId: "issue-1",
    });
  });

  it("dispatches issue.updated for an Issue update event", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/webhooks/linear",
      payload: { action: "update", type: "Issue", data: { id: "issue-1" } },
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ ok: true });
    expect(mockOrchestrator.handleLinearWebhook).toHaveBeenCalledWith({
      action: "issue.updated",
      issueId: "issue-1",
    });
  });

  it("dispatches comment.command when a comment body parses to a known command", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/webhooks/linear",
      payload: {
        action: "create",
        type: "Comment",
        data: { id: "comment-1", issueId: "issue-9", body: "/approve-plan" },
      },
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ ok: true });
    expect(mockOrchestrator.handleLinearWebhook).toHaveBeenCalledWith({
      action: "comment.command",
      issueId: "issue-9",
      command: { type: "approve-plan" },
    });
  });

  it("dispatches comment.command with a parsed body for /reject-plan", async () => {
    await app.inject({
      method: "POST",
      url: "/webhooks/linear",
      payload: {
        action: "create",
        type: "Comment",
        data: { id: "comment-2", issueId: "issue-9", body: "/reject-plan needs rework" },
      },
    });

    expect(mockOrchestrator.handleLinearWebhook).toHaveBeenCalledWith({
      action: "comment.command",
      issueId: "issue-9",
      command: { type: "reject-plan", body: "needs rework" },
    });
  });

  it("does not dispatch when a comment body does not parse to a command", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/webhooks/linear",
      payload: {
        action: "create",
        type: "Comment",
        data: { id: "comment-3", issueId: "issue-9", body: "just a regular comment" },
      },
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ ok: true });
    expect(mockOrchestrator.handleLinearWebhook).not.toHaveBeenCalled();
  });

  it("does not dispatch a comment create event missing a body", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/webhooks/linear",
      payload: {
        action: "create",
        type: "Comment",
        data: { id: "comment-4", issueId: "issue-9" },
      },
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ ok: true, ignored: true });
    expect(mockOrchestrator.handleLinearWebhook).not.toHaveBeenCalled();
  });

  it("does not dispatch a comment create event missing an issueId", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/webhooks/linear",
      payload: {
        action: "create",
        type: "Comment",
        data: { id: "comment-5", body: "/ai-plan" },
      },
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ ok: true, ignored: true });
    expect(mockOrchestrator.handleLinearWebhook).not.toHaveBeenCalled();
  });

  it("returns ignored:true for an unhandled type/action combination", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/webhooks/linear",
      payload: { action: "remove", type: "Issue", data: { id: "issue-1" } },
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ ok: true, ignored: true });
    expect(mockOrchestrator.handleLinearWebhook).not.toHaveBeenCalled();
  });
});
