import { describe, it, expect, vi } from "vitest";
import Fastify from "fastify";
import { registerLinearWebhook } from "../../src/linear/linearWebhook.js";

function buildApp(orchestratorOverrides: Record<string, unknown> = {}, isNew = true) {
  const mockOrchestrator = {
    handleLinearWebhook: vi.fn().mockResolvedValue(undefined),
    ...orchestratorOverrides,
  };
  const mockIdempotencyRepo = {
    tryMarkProcessed: vi.fn().mockResolvedValue(isNew),
  };
  const app = Fastify({ logger: false });
  registerLinearWebhook(app, mockOrchestrator as never, mockIdempotencyRepo as never);
  return { app, mockOrchestrator, mockIdempotencyRepo };
}

describe("POST /webhooks/linear", () => {
  it("returns 400 for a payload failing schema validation", async () => {
    const { app } = buildApp();
    await app.ready();

    const response = await app.inject({
      method: "POST",
      url: "/webhooks/linear",
      payload: { action: "create" },
    });

    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body)).toEqual({ error: "Invalid webhook payload" });
  });

  it("dedupes using the idempotency repo and returns duplicate:true without calling the orchestrator", async () => {
    const { app, mockOrchestrator, mockIdempotencyRepo } = buildApp({}, false);
    await app.ready();

    const response = await app.inject({
      method: "POST",
      url: "/webhooks/linear",
      payload: { action: "create", type: "Issue", data: { id: "issue-1" } },
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ ok: true, duplicate: true });
    expect(mockIdempotencyRepo.tryMarkProcessed).toHaveBeenCalledWith(
      "linear",
      "Issue:create:issue-1",
    );
    expect(mockOrchestrator.handleLinearWebhook).not.toHaveBeenCalled();
  });

  it("forwards issue.created for a new Issue/create event", async () => {
    const { app, mockOrchestrator } = buildApp();
    await app.ready();

    const response = await app.inject({
      method: "POST",
      url: "/webhooks/linear",
      payload: { action: "create", type: "Issue", data: { id: "issue-1", title: "New issue" } },
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ ok: true });
    expect(mockOrchestrator.handleLinearWebhook).toHaveBeenCalledWith({
      action: "issue.created",
      issueId: "issue-1",
    });
  });

  it("forwards issue.updated for an Issue/update event", async () => {
    const { app, mockOrchestrator } = buildApp();
    await app.ready();

    const response = await app.inject({
      method: "POST",
      url: "/webhooks/linear",
      payload: { action: "update", type: "Issue", data: { id: "issue-1" } },
    });

    expect(response.statusCode).toBe(200);
    expect(mockOrchestrator.handleLinearWebhook).toHaveBeenCalledWith({
      action: "issue.updated",
      issueId: "issue-1",
    });
  });

  it("parses a recognized slash command from a Comment/create event and forwards comment.command", async () => {
    const { app, mockOrchestrator } = buildApp();
    await app.ready();

    const response = await app.inject({
      method: "POST",
      url: "/webhooks/linear",
      payload: {
        action: "create",
        type: "Comment",
        data: { id: "comment-1", body: "/approve-plan", issueId: "issue-1" },
      },
    });

    expect(response.statusCode).toBe(200);
    expect(mockOrchestrator.handleLinearWebhook).toHaveBeenCalledWith({
      action: "comment.command",
      issueId: "issue-1",
      command: { type: "approve-plan" },
    });
  });

  it("does not forward a Comment/create event whose body is not a command", async () => {
    const { app, mockOrchestrator } = buildApp();
    await app.ready();

    const response = await app.inject({
      method: "POST",
      url: "/webhooks/linear",
      payload: {
        action: "create",
        type: "Comment",
        data: { id: "comment-1", body: "just a regular comment", issueId: "issue-1" },
      },
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ ok: true });
    expect(mockOrchestrator.handleLinearWebhook).not.toHaveBeenCalled();
  });

  it("falls through to ignored:true for a Comment/create event missing body or issueId", async () => {
    const { app, mockOrchestrator } = buildApp();
    await app.ready();

    const response = await app.inject({
      method: "POST",
      url: "/webhooks/linear",
      payload: { action: "create", type: "Comment", data: { id: "comment-1" } },
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ ok: true, ignored: true });
    expect(mockOrchestrator.handleLinearWebhook).not.toHaveBeenCalled();
  });

  it("returns ignored:true for an event type/action combination it does not handle", async () => {
    const { app, mockOrchestrator } = buildApp();
    await app.ready();

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
