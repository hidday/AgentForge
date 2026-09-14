import { describe, it, expect, vi, beforeEach } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { registerLinearWebhook } from "../../src/linear/linearWebhook.js";

function buildApp(opts: { tryMarkProcessed?: ReturnType<typeof vi.fn> } = {}) {
  const mockOrchestrator = { handleLinearWebhook: vi.fn().mockResolvedValue(undefined) };
  const mockIdempotencyRepo = {
    tryMarkProcessed: opts.tryMarkProcessed ?? vi.fn().mockResolvedValue(true),
  };
  const app: FastifyInstance = Fastify({ logger: false });
  registerLinearWebhook(app, mockOrchestrator as never, mockIdempotencyRepo as never);
  return { app, mockOrchestrator, mockIdempotencyRepo };
}

describe("POST /webhooks/linear", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 400 when the payload fails schema validation", async () => {
    const { app } = buildApp();
    await app.ready();

    const res = await app.inject({
      method: "POST",
      url: "/webhooks/linear",
      payload: { action: "create" }, // missing type/data
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: "Invalid webhook payload" });
  });

  it("returns 200 with duplicate:true and skips orchestrator when idempotency check says duplicate", async () => {
    const tryMarkProcessed = vi.fn().mockResolvedValue(false);
    const { app, mockOrchestrator } = buildApp({ tryMarkProcessed });
    await app.ready();

    const res = await app.inject({
      method: "POST",
      url: "/webhooks/linear",
      payload: { action: "create", type: "Issue", data: { id: "issue-1" } },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, duplicate: true });
    expect(mockOrchestrator.handleLinearWebhook).not.toHaveBeenCalled();
    expect(tryMarkProcessed).toHaveBeenCalledWith("linear", "Issue:create:issue-1");
  });

  it("dispatches issue.created for Issue/create and returns 200", async () => {
    const { app, mockOrchestrator } = buildApp();
    await app.ready();

    const res = await app.inject({
      method: "POST",
      url: "/webhooks/linear",
      payload: { action: "create", type: "Issue", data: { id: "issue-1", title: "New" } },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    expect(mockOrchestrator.handleLinearWebhook).toHaveBeenCalledWith({
      action: "issue.created",
      issueId: "issue-1",
    });
  });

  it("dispatches issue.updated for Issue/update and returns 200", async () => {
    const { app, mockOrchestrator } = buildApp();
    await app.ready();

    const res = await app.inject({
      method: "POST",
      url: "/webhooks/linear",
      payload: { action: "update", type: "Issue", data: { id: "issue-2" } },
    });

    expect(res.statusCode).toBe(200);
    expect(mockOrchestrator.handleLinearWebhook).toHaveBeenCalledWith({
      action: "issue.updated",
      issueId: "issue-2",
    });
  });

  it("parses and dispatches a recognized slash command from a new Comment", async () => {
    const { app, mockOrchestrator } = buildApp();
    await app.ready();

    const res = await app.inject({
      method: "POST",
      url: "/webhooks/linear",
      payload: {
        action: "create",
        type: "Comment",
        data: { id: "comment-1", issueId: "issue-3", body: "/approve-plan" },
      },
    });

    expect(res.statusCode).toBe(200);
    expect(mockOrchestrator.handleLinearWebhook).toHaveBeenCalledWith({
      action: "comment.command",
      issueId: "issue-3",
      command: { type: "approve-plan" },
    });
  });

  it("dispatches a reject-plan command with its parsed body", async () => {
    const { app, mockOrchestrator } = buildApp();
    await app.ready();

    const res = await app.inject({
      method: "POST",
      url: "/webhooks/linear",
      payload: {
        action: "create",
        type: "Comment",
        data: { id: "comment-2", issueId: "issue-3", body: "/reject-plan use OAuth2" },
      },
    });

    expect(res.statusCode).toBe(200);
    expect(mockOrchestrator.handleLinearWebhook).toHaveBeenCalledWith({
      action: "comment.command",
      issueId: "issue-3",
      command: { type: "reject-plan", body: "use OAuth2" },
    });
  });

  it("returns 200 without dispatching when a Comment body has no recognizable command", async () => {
    const { app, mockOrchestrator } = buildApp();
    await app.ready();

    const res = await app.inject({
      method: "POST",
      url: "/webhooks/linear",
      payload: {
        action: "create",
        type: "Comment",
        data: { id: "comment-3", issueId: "issue-3", body: "just a regular comment" },
      },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    expect(mockOrchestrator.handleLinearWebhook).not.toHaveBeenCalled();
  });

  it("returns 200 without dispatching when a Comment event is missing body or issueId", async () => {
    const { app, mockOrchestrator } = buildApp();
    await app.ready();

    const res = await app.inject({
      method: "POST",
      url: "/webhooks/linear",
      payload: {
        action: "create",
        type: "Comment",
        data: { id: "comment-4" }, // no body, no issueId
      },
    });

    expect(res.statusCode).toBe(200);
    expect(mockOrchestrator.handleLinearWebhook).not.toHaveBeenCalled();
  });

  it("returns 200 { ok: true, ignored: true } for an unhandled type/action combination", async () => {
    const { app, mockOrchestrator } = buildApp();
    await app.ready();

    const res = await app.inject({
      method: "POST",
      url: "/webhooks/linear",
      payload: { action: "remove", type: "Issue", data: { id: "issue-9" } },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, ignored: true });
    expect(mockOrchestrator.handleLinearWebhook).not.toHaveBeenCalled();
  });

  it("builds the dedupe key from type, action, and data.id", async () => {
    const tryMarkProcessed = vi.fn().mockResolvedValue(true);
    const { app } = buildApp({ tryMarkProcessed });
    await app.ready();

    await app.inject({
      method: "POST",
      url: "/webhooks/linear",
      payload: { action: "create", type: "Comment", data: { id: "c-99" } },
    });

    expect(tryMarkProcessed).toHaveBeenCalledWith("linear", "Comment:create:c-99");
  });
});
