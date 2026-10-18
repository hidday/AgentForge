import { describe, it, expect, vi } from "vitest";
import Fastify from "fastify";
import { registerLinearWebhook } from "../../src/linear/linearWebhook.js";

async function buildApp(opts?: { duplicate?: boolean }) {
  const mockOrchestrator = {
    handleLinearWebhook: vi.fn(),
  };
  const mockIdempotencyRepo = {
    tryMarkProcessed: vi.fn().mockResolvedValue(!opts?.duplicate),
  };

  const app = Fastify({ logger: false });
  registerLinearWebhook(app, mockOrchestrator as never, mockIdempotencyRepo as never);

  await app.ready();
  return { app, mockOrchestrator, mockIdempotencyRepo };
}

describe("POST /webhooks/linear", () => {
  it("returns 400 when the payload is invalid (missing required fields)", async () => {
    const { app, mockOrchestrator } = await buildApp();

    const response = await app.inject({
      method: "POST",
      url: "/webhooks/linear",
      payload: { action: "create" },
    });

    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body)).toEqual({ error: "Invalid webhook payload" });
    expect(mockOrchestrator.handleLinearWebhook).not.toHaveBeenCalled();
  });

  it("returns 400 when data.id is missing", async () => {
    const { app } = await buildApp();

    const response = await app.inject({
      method: "POST",
      url: "/webhooks/linear",
      payload: { action: "create", type: "Issue", data: {} },
    });

    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body)).toEqual({ error: "Invalid webhook payload" });
  });

  it("handles Issue create events and forwards issue.created to the orchestrator", async () => {
    const { app, mockOrchestrator } = await buildApp();

    const response = await app.inject({
      method: "POST",
      url: "/webhooks/linear",
      payload: { action: "create", type: "Issue", data: { id: "issue-1" } },
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ ok: true });
    expect(mockOrchestrator.handleLinearWebhook).toHaveBeenCalledWith({
      action: "issue.created",
      issueId: "issue-1",
    });
  });

  it("handles Issue update events and forwards issue.updated to the orchestrator", async () => {
    const { app, mockOrchestrator } = await buildApp();

    const response = await app.inject({
      method: "POST",
      url: "/webhooks/linear",
      payload: { action: "update", type: "Issue", data: { id: "issue-2" } },
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ ok: true });
    expect(mockOrchestrator.handleLinearWebhook).toHaveBeenCalledWith({
      action: "issue.updated",
      issueId: "issue-2",
    });
  });

  it("parses a recognized command from a Comment create event and forwards it", async () => {
    const { app, mockOrchestrator } = await buildApp();

    const response = await app.inject({
      method: "POST",
      url: "/webhooks/linear",
      payload: {
        action: "create",
        type: "Comment",
        data: { id: "comment-1", body: "/approve", issueId: "issue-3" },
      },
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ ok: true });
    expect(mockOrchestrator.handleLinearWebhook).toHaveBeenCalledWith(
      expect.objectContaining({ action: "comment.command", issueId: "issue-3" }),
    );
  });

  it("does not forward a Comment create event whose body has no recognized command", async () => {
    const { app, mockOrchestrator } = await buildApp();

    const response = await app.inject({
      method: "POST",
      url: "/webhooks/linear",
      payload: {
        action: "create",
        type: "Comment",
        data: { id: "comment-2", body: "just a regular comment, nothing special", issueId: "issue-4" },
      },
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ ok: true });
    expect(mockOrchestrator.handleLinearWebhook).not.toHaveBeenCalled();
  });

  it("ignores a Comment create event missing body or issueId without calling the orchestrator", async () => {
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
    expect(JSON.parse(response.body)).toEqual({ ok: true, ignored: true });
    expect(mockOrchestrator.handleLinearWebhook).not.toHaveBeenCalled();
  });

  it("returns ok+ignored for an unrecognized action/type combination", async () => {
    const { app, mockOrchestrator } = await buildApp();

    const response = await app.inject({
      method: "POST",
      url: "/webhooks/linear",
      payload: { action: "remove", type: "Issue", data: { id: "issue-5" } },
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ ok: true, ignored: true });
    expect(mockOrchestrator.handleLinearWebhook).not.toHaveBeenCalled();
  });

  it("short-circuits duplicate webhooks without calling the orchestrator", async () => {
    const { app, mockOrchestrator, mockIdempotencyRepo } = await buildApp({ duplicate: true });

    const response = await app.inject({
      method: "POST",
      url: "/webhooks/linear",
      payload: { action: "create", type: "Issue", data: { id: "issue-6" } },
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ ok: true, duplicate: true });
    expect(mockOrchestrator.handleLinearWebhook).not.toHaveBeenCalled();
    expect(mockIdempotencyRepo.tryMarkProcessed).toHaveBeenCalledWith(
      "linear",
      "Issue:create:issue-6",
    );
  });
});
