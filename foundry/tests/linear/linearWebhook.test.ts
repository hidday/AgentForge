import { describe, it, expect, vi } from "vitest";
import Fastify from "fastify";
import { registerLinearWebhook } from "../../src/linear/linearWebhook.js";

function buildApp() {
  const mockOrchestrator = { handleLinearWebhook: vi.fn().mockResolvedValue(undefined) };
  const mockIdempotencyRepo = { tryMarkProcessed: vi.fn().mockResolvedValue(true) };
  const app = Fastify({ logger: false });
  registerLinearWebhook(app, mockOrchestrator as never, mockIdempotencyRepo as never);
  return { app, mockOrchestrator, mockIdempotencyRepo };
}

describe("POST /webhooks/linear", () => {
  it("returns 400 for a payload missing required fields", async () => {
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

  it("returns 200 { ok, duplicate: true } and skips dispatch on a duplicate event", async () => {
    const { app, mockOrchestrator, mockIdempotencyRepo } = buildApp();
    mockIdempotencyRepo.tryMarkProcessed.mockResolvedValue(false);
    await app.ready();

    const res = await app.inject({
      method: "POST",
      url: "/webhooks/linear",
      payload: { action: "create", type: "Issue", data: { id: "issue-1" } },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, duplicate: true });
    expect(mockOrchestrator.handleLinearWebhook).not.toHaveBeenCalled();
    expect(mockIdempotencyRepo.tryMarkProcessed).toHaveBeenCalledWith(
      "linear",
      "Issue:create:issue-1",
    );
  });

  it("dispatches issue.created for an Issue create event", async () => {
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

  it("dispatches issue.updated for an Issue update event", async () => {
    const { app, mockOrchestrator } = buildApp();
    await app.ready();

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

  it("parses a slash command from a Comment create event and dispatches comment.command", async () => {
    const { app, mockOrchestrator } = buildApp();
    await app.ready();

    const res = await app.inject({
      method: "POST",
      url: "/webhooks/linear",
      payload: {
        action: "create",
        type: "Comment",
        data: { id: "comment-1", issueId: "issue-1", body: "/approve-plan" },
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

  it("parses a reject-plan command with a body", async () => {
    const { app, mockOrchestrator } = buildApp();
    await app.ready();

    const res = await app.inject({
      method: "POST",
      url: "/webhooks/linear",
      payload: {
        action: "create",
        type: "Comment",
        data: { id: "comment-1", issueId: "issue-1", body: "/reject-plan needs OAuth2" },
      },
    });

    expect(res.statusCode).toBe(200);
    expect(mockOrchestrator.handleLinearWebhook).toHaveBeenCalledWith({
      action: "comment.command",
      issueId: "issue-1",
      command: { type: "reject-plan", body: "needs OAuth2" },
    });
  });

  it("does not dispatch for a Comment create event whose body is not a command", async () => {
    const { app, mockOrchestrator } = buildApp();
    await app.ready();

    const res = await app.inject({
      method: "POST",
      url: "/webhooks/linear",
      payload: {
        action: "create",
        type: "Comment",
        data: { id: "comment-1", issueId: "issue-1", body: "just a regular comment" },
      },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    expect(mockOrchestrator.handleLinearWebhook).not.toHaveBeenCalled();
  });

  it("returns 200 { ok, ignored: true } for a Comment create event missing a body", async () => {
    const { app, mockOrchestrator } = buildApp();
    await app.ready();

    const res = await app.inject({
      method: "POST",
      url: "/webhooks/linear",
      payload: { action: "create", type: "Comment", data: { id: "comment-1", issueId: "issue-1" } },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, ignored: true });
    expect(mockOrchestrator.handleLinearWebhook).not.toHaveBeenCalled();
  });

  it("returns 200 { ok, ignored: true } for a Comment create event missing issueId", async () => {
    const { app, mockOrchestrator } = buildApp();
    await app.ready();

    const res = await app.inject({
      method: "POST",
      url: "/webhooks/linear",
      payload: { action: "create", type: "Comment", data: { id: "comment-1", body: "/approve-plan" } },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, ignored: true });
    expect(mockOrchestrator.handleLinearWebhook).not.toHaveBeenCalled();
  });

  it("returns 200 { ok, ignored: true } for an unrecognized type/action combination", async () => {
    const { app, mockOrchestrator } = buildApp();
    await app.ready();

    const res = await app.inject({
      method: "POST",
      url: "/webhooks/linear",
      payload: { action: "remove", type: "Issue", data: { id: "issue-1" } },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, ignored: true });
    expect(mockOrchestrator.handleLinearWebhook).not.toHaveBeenCalled();
  });
});
