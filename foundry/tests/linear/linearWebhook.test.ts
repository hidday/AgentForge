import { describe, it, expect, vi } from "vitest";
import Fastify from "fastify";
import { registerLinearWebhook } from "../../src/linear/linearWebhook.js";

async function buildApp(tryMarkProcessedImpl?: () => Promise<boolean>) {
  const mockOrchestrator = {
    handleLinearWebhook: vi.fn().mockResolvedValue(undefined),
  };
  const mockIdempotencyRepo = {
    tryMarkProcessed: vi.fn(tryMarkProcessedImpl ?? (() => Promise.resolve(true))),
  };

  const app = Fastify({ logger: false });
  registerLinearWebhook(app, mockOrchestrator as never, mockIdempotencyRepo as never);
  await app.ready();
  return { app, mockOrchestrator, mockIdempotencyRepo };
}

describe("POST /webhooks/linear", () => {
  it("returns 400 for an invalid payload (missing required 'data.id')", async () => {
    const { app, mockOrchestrator, mockIdempotencyRepo } = await buildApp();

    const response = await app.inject({
      method: "POST",
      url: "/webhooks/linear",
      payload: { action: "create", type: "Issue", data: {} },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "Invalid webhook payload" });
    expect(mockIdempotencyRepo.tryMarkProcessed).not.toHaveBeenCalled();
    expect(mockOrchestrator.handleLinearWebhook).not.toHaveBeenCalled();
  });

  it("returns 200 duplicate:true and does not call the orchestrator when the event was already processed", async () => {
    const { app, mockOrchestrator, mockIdempotencyRepo } = await buildApp(() =>
      Promise.resolve(false),
    );

    const response = await app.inject({
      method: "POST",
      url: "/webhooks/linear",
      payload: { action: "create", type: "Issue", data: { id: "issue-1" } },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true, duplicate: true });
    expect(mockIdempotencyRepo.tryMarkProcessed).toHaveBeenCalledWith(
      "linear",
      "Issue:create:issue-1",
    );
    expect(mockOrchestrator.handleLinearWebhook).not.toHaveBeenCalled();
  });

  it("handles Issue/create by calling orchestrator with action 'issue.created'", async () => {
    const { app, mockOrchestrator } = await buildApp();

    const response = await app.inject({
      method: "POST",
      url: "/webhooks/linear",
      payload: { action: "create", type: "Issue", data: { id: "issue-1" } },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true });
    expect(mockOrchestrator.handleLinearWebhook).toHaveBeenCalledWith({
      action: "issue.created",
      issueId: "issue-1",
    });
  });

  it("handles Issue/update by calling orchestrator with action 'issue.updated'", async () => {
    const { app, mockOrchestrator } = await buildApp();

    const response = await app.inject({
      method: "POST",
      url: "/webhooks/linear",
      payload: { action: "update", type: "Issue", data: { id: "issue-2" } },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true });
    expect(mockOrchestrator.handleLinearWebhook).toHaveBeenCalledWith({
      action: "issue.updated",
      issueId: "issue-2",
    });
  });

  it("handles Comment/create with a recognized command body by calling orchestrator with 'comment.command'", async () => {
    const { app, mockOrchestrator } = await buildApp();

    const response = await app.inject({
      method: "POST",
      url: "/webhooks/linear",
      payload: {
        action: "create",
        type: "Comment",
        data: { id: "comment-1", issueId: "issue-3", body: "/pause-ai" },
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true });
    expect(mockOrchestrator.handleLinearWebhook).toHaveBeenCalledWith({
      action: "comment.command",
      issueId: "issue-3",
      command: { type: "pause-ai" },
    });
  });

  it("handles Comment/create with a non-command body as a 200 without calling the orchestrator", async () => {
    const { app, mockOrchestrator } = await buildApp();

    const response = await app.inject({
      method: "POST",
      url: "/webhooks/linear",
      payload: {
        action: "create",
        type: "Comment",
        data: { id: "comment-2", issueId: "issue-4", body: "just a regular comment" },
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true });
    expect(mockOrchestrator.handleLinearWebhook).not.toHaveBeenCalled();
  });

  it("falls through to ok:true, ignored:true for an unmatched type/action combination", async () => {
    const { app, mockOrchestrator } = await buildApp();

    const response = await app.inject({
      method: "POST",
      url: "/webhooks/linear",
      payload: { action: "remove", type: "Issue", data: { id: "issue-5" } },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true, ignored: true });
    expect(mockOrchestrator.handleLinearWebhook).not.toHaveBeenCalled();
  });

  it("falls through to ignored:true for Comment/create missing a body or issueId", async () => {
    const { app, mockOrchestrator } = await buildApp();

    const response = await app.inject({
      method: "POST",
      url: "/webhooks/linear",
      payload: {
        action: "create",
        type: "Comment",
        data: { id: "comment-3" },
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true, ignored: true });
    expect(mockOrchestrator.handleLinearWebhook).not.toHaveBeenCalled();
  });
});
