import { describe, it, expect, vi, afterEach } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { registerLinearWebhook } from "../../src/linear/linearWebhook.js";

function buildApp(opts: { isNew?: boolean } = {}) {
  const orchestrator = { handleLinearWebhook: vi.fn().mockResolvedValue(undefined) };
  const idempotencyRepo = { tryMarkProcessed: vi.fn().mockResolvedValue(opts.isNew ?? true) };
  const app = Fastify();
  registerLinearWebhook(app, orchestrator as never, idempotencyRepo as never);
  return { app, orchestrator, idempotencyRepo };
}

describe("registerLinearWebhook", () => {
  let app: FastifyInstance;

  afterEach(async () => {
    await app?.close();
  });

  it("returns 400 for an invalid payload", async () => {
    ({ app } = buildApp());

    const response = await app.inject({
      method: "POST",
      url: "/webhooks/linear",
      payload: { action: "create" },
    });

    expect(response.statusCode).toBe(400);
  });

  it("returns 200 with duplicate: true without calling the orchestrator on a repeat event", async () => {
    let orchestrator;
    ({ app, orchestrator } = buildApp({ isNew: false }));

    const response = await app.inject({
      method: "POST",
      url: "/webhooks/linear",
      payload: { action: "create", type: "Issue", data: { id: "issue-1" } },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true, duplicate: true });
    expect(orchestrator.handleLinearWebhook).not.toHaveBeenCalled();
  });

  it("dispatches issue.created for an Issue create event", async () => {
    let orchestrator;
    ({ app, orchestrator } = buildApp());

    const response = await app.inject({
      method: "POST",
      url: "/webhooks/linear",
      payload: { action: "create", type: "Issue", data: { id: "issue-1" } },
    });

    expect(response.statusCode).toBe(200);
    expect(orchestrator.handleLinearWebhook).toHaveBeenCalledWith({
      action: "issue.created",
      issueId: "issue-1",
    });
  });

  it("dispatches issue.updated for an Issue update event", async () => {
    let orchestrator;
    ({ app, orchestrator } = buildApp());

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

  it("dispatches comment.command when a comment body contains a recognized command", async () => {
    let orchestrator;
    ({ app, orchestrator } = buildApp());

    const response = await app.inject({
      method: "POST",
      url: "/webhooks/linear",
      payload: {
        action: "create",
        type: "Comment",
        data: { id: "comment-1", issueId: "issue-1", body: "/approve" },
      },
    });

    expect(response.statusCode).toBe(200);
    expect(orchestrator.handleLinearWebhook).toHaveBeenCalledWith(
      expect.objectContaining({ action: "comment.command", issueId: "issue-1" }),
    );
  });

  it("returns ok without dispatching when a comment has no recognized command", async () => {
    let orchestrator;
    ({ app, orchestrator } = buildApp());

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
    expect(response.json()).toEqual({ ok: true });
    expect(orchestrator.handleLinearWebhook).not.toHaveBeenCalled();
  });

  it("returns ok without dispatching when a Comment create event is missing body or issueId", async () => {
    let orchestrator;
    ({ app, orchestrator } = buildApp());

    const response = await app.inject({
      method: "POST",
      url: "/webhooks/linear",
      payload: { action: "create", type: "Comment", data: { id: "comment-1" } },
    });

    expect(response.statusCode).toBe(200);
    expect(orchestrator.handleLinearWebhook).not.toHaveBeenCalled();
  });

  it("returns ignored: true for an event type/action it doesn't recognize", async () => {
    let orchestrator;
    ({ app, orchestrator } = buildApp());

    const response = await app.inject({
      method: "POST",
      url: "/webhooks/linear",
      payload: { action: "remove", type: "Issue", data: { id: "issue-1" } },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true, ignored: true });
    expect(orchestrator.handleLinearWebhook).not.toHaveBeenCalled();
  });

  it("uses a dedupe key combining type, action, and data id", async () => {
    let idempotencyRepo;
    ({ app, idempotencyRepo } = buildApp());

    await app.inject({
      method: "POST",
      url: "/webhooks/linear",
      payload: { action: "create", type: "Issue", data: { id: "issue-1" } },
    });

    expect(idempotencyRepo.tryMarkProcessed).toHaveBeenCalledWith("linear", "Issue:create:issue-1");
  });
});
