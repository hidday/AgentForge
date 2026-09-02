import { describe, it, expect, vi, beforeEach } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { registerLinearWebhook } from "../../src/linear/linearWebhook.js";

function buildDeps() {
  const mockOrchestrator = {
    handleLinearWebhook: vi.fn().mockResolvedValue(undefined),
  };
  const mockIdempotencyRepo = {
    tryMarkProcessed: vi.fn().mockResolvedValue(true),
  };
  return { mockOrchestrator, mockIdempotencyRepo };
}

async function buildApp(deps: ReturnType<typeof buildDeps>) {
  const app: FastifyInstance = Fastify({ logger: false });
  registerLinearWebhook(app, deps.mockOrchestrator as never, deps.mockIdempotencyRepo as never);
  await app.ready();
  return app;
}

describe("POST /webhooks/linear", () => {
  let deps: ReturnType<typeof buildDeps>;
  let app: FastifyInstance;

  beforeEach(async () => {
    deps = buildDeps();
    app = await buildApp(deps);
  });

  it("rejects a payload missing required fields", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/webhooks/linear",
      payload: { action: "create" },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: "Invalid webhook payload" });
    expect(deps.mockIdempotencyRepo.tryMarkProcessed).not.toHaveBeenCalled();
  });

  it("rejects a malformed body (data missing id)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/webhooks/linear",
      payload: { action: "create", type: "Issue", data: { title: "no id" } },
    });

    expect(res.statusCode).toBe(400);
  });

  it("dispatches issue.created for a new Issue/create event", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/webhooks/linear",
      payload: { action: "create", type: "Issue", data: { id: "issue-1" } },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    expect(deps.mockIdempotencyRepo.tryMarkProcessed).toHaveBeenCalledWith(
      "linear",
      "Issue:create:issue-1",
    );
    expect(deps.mockOrchestrator.handleLinearWebhook).toHaveBeenCalledWith({
      action: "issue.created",
      issueId: "issue-1",
    });
  });

  it("dispatches issue.updated for an Issue/update event", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/webhooks/linear",
      payload: { action: "update", type: "Issue", data: { id: "issue-2" } },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    expect(deps.mockOrchestrator.handleLinearWebhook).toHaveBeenCalledWith({
      action: "issue.updated",
      issueId: "issue-2",
    });
  });

  it("dispatches comment.command for a Comment/create event with a recognized slash command", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/webhooks/linear",
      payload: {
        action: "create",
        type: "Comment",
        data: { id: "comment-1", issueId: "issue-3", body: "/ai-plan" },
      },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    expect(deps.mockOrchestrator.handleLinearWebhook).toHaveBeenCalledWith({
      action: "comment.command",
      issueId: "issue-3",
      command: { type: "ai-plan" },
    });
  });

  it("does not dispatch for a Comment/create event whose body has no recognized command", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/webhooks/linear",
      payload: {
        action: "create",
        type: "Comment",
        data: { id: "comment-2", issueId: "issue-3", body: "just a regular comment" },
      },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    expect(deps.mockOrchestrator.handleLinearWebhook).not.toHaveBeenCalled();
  });

  it("ignores a Comment/create event missing body or issueId", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/webhooks/linear",
      payload: {
        action: "create",
        type: "Comment",
        data: { id: "comment-3" },
      },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, ignored: true });
    expect(deps.mockOrchestrator.handleLinearWebhook).not.toHaveBeenCalled();
  });

  it("returns ignored:true for an unhandled type/action combination", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/webhooks/linear",
      payload: { action: "remove", type: "Issue", data: { id: "issue-4" } },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, ignored: true });
    expect(deps.mockOrchestrator.handleLinearWebhook).not.toHaveBeenCalled();
  });

  it("short-circuits duplicate events without invoking the orchestrator", async () => {
    deps.mockIdempotencyRepo.tryMarkProcessed.mockResolvedValue(false);

    const res = await app.inject({
      method: "POST",
      url: "/webhooks/linear",
      payload: { action: "create", type: "Issue", data: { id: "issue-5" } },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, duplicate: true });
    expect(deps.mockOrchestrator.handleLinearWebhook).not.toHaveBeenCalled();
  });
});
