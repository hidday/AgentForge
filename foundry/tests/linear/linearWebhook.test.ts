import { describe, it, expect, vi, beforeEach } from "vitest";
import Fastify from "fastify";
import { registerLinearWebhook } from "../../src/linear/linearWebhook.js";

function buildApp(opts: { tryMarkProcessed?: ReturnType<typeof vi.fn> } = {}) {
  const orchestrator = { handleLinearWebhook: vi.fn().mockResolvedValue(undefined) };
  const idempotencyRepo = {
    tryMarkProcessed: opts.tryMarkProcessed ?? vi.fn().mockResolvedValue(true),
  };
  const app = Fastify({ logger: false });
  registerLinearWebhook(app, orchestrator as never, idempotencyRepo as never);
  return { app, orchestrator, idempotencyRepo };
}

describe("POST /webhooks/linear", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 400 when the payload fails schema validation", async () => {
    const { app } = buildApp();
    const response = await app.inject({
      method: "POST",
      url: "/webhooks/linear",
      payload: { action: "create" },
    });
    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body)).toEqual({ error: "Invalid webhook payload" });
  });

  it("returns ok+duplicate without calling the orchestrator when the event was already processed", async () => {
    const tryMarkProcessed = vi.fn().mockResolvedValue(false);
    const { app, orchestrator } = buildApp({ tryMarkProcessed });
    const response = await app.inject({
      method: "POST",
      url: "/webhooks/linear",
      payload: { action: "create", type: "Issue", data: { id: "issue-1" } },
    });
    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ ok: true, duplicate: true });
    expect(orchestrator.handleLinearWebhook).not.toHaveBeenCalled();
    expect(tryMarkProcessed).toHaveBeenCalledWith("linear", "Issue:create:issue-1");
  });

  it("dispatches issue.created for a new Issue/create event", async () => {
    const { app, orchestrator } = buildApp();
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

  it("dispatches issue.updated for an Issue/update event", async () => {
    const { app, orchestrator } = buildApp();
    const response = await app.inject({
      method: "POST",
      url: "/webhooks/linear",
      payload: { action: "update", type: "Issue", data: { id: "issue-1" } },
    });
    expect(response.statusCode).toBe(200);
    expect(orchestrator.handleLinearWebhook).toHaveBeenCalledWith({
      action: "issue.updated",
      issueId: "issue-1",
    });
  });

  it("dispatches comment.command when a Comment/create carries a recognized slash command", async () => {
    const { app, orchestrator } = buildApp();
    const response = await app.inject({
      method: "POST",
      url: "/webhooks/linear",
      payload: {
        action: "create",
        type: "Comment",
        data: { id: "comment-1", issueId: "issue-1", body: "/approve-plan" },
      },
    });
    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ ok: true });
    expect(orchestrator.handleLinearWebhook).toHaveBeenCalledWith({
      action: "comment.command",
      issueId: "issue-1",
      command: { type: "approve-plan" },
    });
  });

  it("does not dispatch for a Comment/create whose body has no recognized command", async () => {
    const { app, orchestrator } = buildApp();
    const response = await app.inject({
      method: "POST",
      url: "/webhooks/linear",
      payload: {
        action: "create",
        type: "Comment",
        data: { id: "comment-1", issueId: "issue-1", body: "just a regular comment" },
      },
    });
    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ ok: true });
    expect(orchestrator.handleLinearWebhook).not.toHaveBeenCalled();
  });

  it("does not dispatch for a Comment/create missing a body or issueId", async () => {
    const { app, orchestrator } = buildApp();
    const response = await app.inject({
      method: "POST",
      url: "/webhooks/linear",
      payload: { action: "create", type: "Comment", data: { id: "comment-1" } },
    });
    expect(response.statusCode).toBe(200);
    expect(orchestrator.handleLinearWebhook).not.toHaveBeenCalled();
  });

  it("returns ok+ignored for an unrecognized type/action combination", async () => {
    const { app, orchestrator } = buildApp();
    const response = await app.inject({
      method: "POST",
      url: "/webhooks/linear",
      payload: { action: "remove", type: "Reaction", data: { id: "reaction-1" } },
    });
    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ ok: true, ignored: true });
    expect(orchestrator.handleLinearWebhook).not.toHaveBeenCalled();
  });
});
