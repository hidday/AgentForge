import { describe, it, expect, vi, beforeEach } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { registerLinearWebhook } from "../../src/linear/linearWebhook.js";

function buildApp(): {
  app: FastifyInstance;
  mockOrchestrator: { handleLinearWebhook: ReturnType<typeof vi.fn> };
  mockIdempotencyRepo: { tryMarkProcessed: ReturnType<typeof vi.fn> };
} {
  const mockOrchestrator = {
    handleLinearWebhook: vi.fn().mockResolvedValue(undefined),
  };
  const mockIdempotencyRepo = {
    tryMarkProcessed: vi.fn().mockResolvedValue(true),
  };

  const app = Fastify({ logger: false });
  registerLinearWebhook(app, mockOrchestrator as never, mockIdempotencyRepo as never);

  return { app, mockOrchestrator, mockIdempotencyRepo };
}

describe("POST /webhooks/linear", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 400 for a payload missing required fields", async () => {
    const { app, mockIdempotencyRepo } = buildApp();

    const res = await app.inject({
      method: "POST",
      url: "/webhooks/linear",
      payload: { action: "create" },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: "Invalid webhook payload" });
    expect(mockIdempotencyRepo.tryMarkProcessed).not.toHaveBeenCalled();
  });

  it("returns 400 for a malformed payload (wrong types)", async () => {
    const { app } = buildApp();

    const res = await app.inject({
      method: "POST",
      url: "/webhooks/linear",
      payload: { action: "create", type: "Issue", data: { id: 123 } },
    });

    expect(res.statusCode).toBe(400);
  });

  it("returns 200 with duplicate=true and skips processing when already seen", async () => {
    const { app, mockOrchestrator, mockIdempotencyRepo } = buildApp();
    mockIdempotencyRepo.tryMarkProcessed.mockResolvedValue(false);

    const res = await app.inject({
      method: "POST",
      url: "/webhooks/linear",
      payload: { action: "create", type: "Issue", data: { id: "issue-1" } },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, duplicate: true });
    expect(mockOrchestrator.handleLinearWebhook).not.toHaveBeenCalled();
  });

  it("dispatches issue.created for Issue/create", async () => {
    const { app, mockOrchestrator } = buildApp();

    const res = await app.inject({
      method: "POST",
      url: "/webhooks/linear",
      payload: { action: "create", type: "Issue", data: { id: "issue-1" } },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    expect(mockOrchestrator.handleLinearWebhook).toHaveBeenCalledWith({
      action: "issue.created",
      issueId: "issue-1",
    });
  });

  it("dispatches issue.updated for Issue/update", async () => {
    const { app, mockOrchestrator } = buildApp();

    const res = await app.inject({
      method: "POST",
      url: "/webhooks/linear",
      payload: { action: "update", type: "Issue", data: { id: "issue-1" } },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    expect(mockOrchestrator.handleLinearWebhook).toHaveBeenCalledWith({
      action: "issue.updated",
      issueId: "issue-1",
    });
  });

  it("dispatches comment.command for a Comment/create whose body is a recognized command", async () => {
    const { app, mockOrchestrator } = buildApp();

    const res = await app.inject({
      method: "POST",
      url: "/webhooks/linear",
      payload: {
        action: "create",
        type: "Comment",
        data: { id: "comment-1", body: "/approve-plan", issueId: "issue-1" },
      },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    expect(mockOrchestrator.handleLinearWebhook).toHaveBeenCalledWith({
      action: "comment.command",
      issueId: "issue-1",
      command: { type: "approve-plan" },
    });
  });

  it("does not dispatch for a Comment/create whose body has no recognized command", async () => {
    const { app, mockOrchestrator } = buildApp();

    const res = await app.inject({
      method: "POST",
      url: "/webhooks/linear",
      payload: {
        action: "create",
        type: "Comment",
        data: { id: "comment-1", body: "Just a regular comment, no command here.", issueId: "issue-1" },
      },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    expect(mockOrchestrator.handleLinearWebhook).not.toHaveBeenCalled();
  });

  it("returns ignored=true for a Comment/create missing a body", async () => {
    const { app, mockOrchestrator } = buildApp();

    const res = await app.inject({
      method: "POST",
      url: "/webhooks/linear",
      payload: {
        action: "create",
        type: "Comment",
        data: { id: "comment-1", issueId: "issue-1" },
      },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, ignored: true });
    expect(mockOrchestrator.handleLinearWebhook).not.toHaveBeenCalled();
  });

  it("returns ignored=true for a Comment/create missing an issueId", async () => {
    const { app, mockOrchestrator } = buildApp();

    const res = await app.inject({
      method: "POST",
      url: "/webhooks/linear",
      payload: {
        action: "create",
        type: "Comment",
        data: { id: "comment-1", body: "/approve-plan" },
      },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, ignored: true });
    expect(mockOrchestrator.handleLinearWebhook).not.toHaveBeenCalled();
  });

  it("returns ignored=true for an unrecognized type/action combination", async () => {
    const { app, mockOrchestrator } = buildApp();

    const res = await app.inject({
      method: "POST",
      url: "/webhooks/linear",
      payload: { action: "remove", type: "Issue", data: { id: "issue-1" } },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, ignored: true });
    expect(mockOrchestrator.handleLinearWebhook).not.toHaveBeenCalled();
  });

  it("uses a dedupe key combining type, action, and data.id", async () => {
    const { app, mockIdempotencyRepo } = buildApp();

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
});
