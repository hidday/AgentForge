import { describe, it, expect, vi, beforeEach } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { registerLinearWebhook } from "../../src/linear/linearWebhook.js";

function makeOrchestrator() {
  return {
    handleLinearWebhook: vi.fn().mockResolvedValue(undefined),
  };
}

function makeIdempotencyRepo(tryMarkProcessedImpl?: () => Promise<boolean>) {
  return {
    tryMarkProcessed: vi.fn(tryMarkProcessedImpl ?? (() => Promise.resolve(true))),
  };
}

describe("registerLinearWebhook", () => {
  let app: FastifyInstance;
  let orchestrator: ReturnType<typeof makeOrchestrator>;
  let idempotencyRepo: ReturnType<typeof makeIdempotencyRepo>;

  function setup(tryMarkProcessedImpl?: () => Promise<boolean>) {
    app = Fastify();
    orchestrator = makeOrchestrator();
    idempotencyRepo = makeIdempotencyRepo(tryMarkProcessedImpl);
    registerLinearWebhook(app, orchestrator as never, idempotencyRepo as never);
  }

  beforeEach(() => {
    setup();
  });

  it("returns 400 for a payload missing required fields", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/webhooks/linear",
      payload: { action: "create" },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "Invalid webhook payload" });
    expect(orchestrator.handleLinearWebhook).not.toHaveBeenCalled();
  });

  it("returns 400 when data.id is missing", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/webhooks/linear",
      payload: { action: "create", type: "Issue", data: { title: "x" } },
    });

    expect(response.statusCode).toBe(400);
  });

  it("dedupes repeated webhooks and never calls the orchestrator for a duplicate", async () => {
    setup(() => Promise.resolve(false));

    const response = await app.inject({
      method: "POST",
      url: "/webhooks/linear",
      payload: { action: "create", type: "Issue", data: { id: "issue-1" } },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true, duplicate: true });
    expect(orchestrator.handleLinearWebhook).not.toHaveBeenCalled();
  });

  it("builds the dedupe key from type, action, and data.id", async () => {
    await app.inject({
      method: "POST",
      url: "/webhooks/linear",
      payload: { action: "create", type: "Issue", data: { id: "issue-42" } },
    });

    expect(idempotencyRepo.tryMarkProcessed).toHaveBeenCalledWith(
      "linear",
      "Issue:create:issue-42",
    );
  });

  it("handles Issue create by calling handleLinearWebhook with issue.created", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/webhooks/linear",
      payload: { action: "create", type: "Issue", data: { id: "issue-1", title: "New issue" } },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true });
    expect(orchestrator.handleLinearWebhook).toHaveBeenCalledWith({
      action: "issue.created",
      issueId: "issue-1",
    });
  });

  it("handles Issue update by calling handleLinearWebhook with issue.updated", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/webhooks/linear",
      payload: { action: "update", type: "Issue", data: { id: "issue-2" } },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true });
    expect(orchestrator.handleLinearWebhook).toHaveBeenCalledWith({
      action: "issue.updated",
      issueId: "issue-2",
    });
  });

  it("parses a recognized slash command from a new comment and forwards comment.command", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/webhooks/linear",
      payload: {
        action: "create",
        type: "Comment",
        data: { id: "comment-1", issueId: "issue-3", body: "/approve-plan" },
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true });
    expect(orchestrator.handleLinearWebhook).toHaveBeenCalledWith({
      action: "comment.command",
      issueId: "issue-3",
      command: { type: "approve-plan" },
    });
  });

  it("does not call the orchestrator when the comment body has no recognized command, but still returns ok", async () => {
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
    expect(orchestrator.handleLinearWebhook).not.toHaveBeenCalled();
  });

  it("ignores a Comment create event missing body or issueId", async () => {
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
    expect(orchestrator.handleLinearWebhook).not.toHaveBeenCalled();
  });

  it("ignores unrecognized type/action combinations", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/webhooks/linear",
      payload: { action: "remove", type: "Issue", data: { id: "issue-5" } },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true, ignored: true });
    expect(orchestrator.handleLinearWebhook).not.toHaveBeenCalled();
  });
});
