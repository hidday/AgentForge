import { describe, it, expect, vi, beforeEach } from "vitest";
import Fastify from "fastify";
import { registerLinearWebhook } from "../../src/linear/linearWebhook.js";

function buildApp(opts: { tryMarkProcessed?: ReturnType<typeof vi.fn> } = {}) {
  const orchestrator = {
    handleLinearWebhook: vi.fn().mockResolvedValue(undefined),
  };
  const idempotencyRepo = {
    tryMarkProcessed: opts.tryMarkProcessed ?? vi.fn().mockResolvedValue(true),
  };

  const app = Fastify({ logger: false });
  registerLinearWebhook(app, orchestrator as never, idempotencyRepo as never);

  return { app, orchestrator, idempotencyRepo };
}

describe("registerLinearWebhook", () => {
  let app: ReturnType<typeof buildApp>["app"];
  let orchestrator: ReturnType<typeof buildApp>["orchestrator"];
  let idempotencyRepo: ReturnType<typeof buildApp>["idempotencyRepo"];

  beforeEach(async () => {
    ({ app, orchestrator, idempotencyRepo } = buildApp());
    await app.ready();
  });

  it("returns 400 for a payload missing required fields", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/webhooks/linear",
      payload: { action: "create" }, // missing type and data
    });

    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body)).toEqual({ error: "Invalid webhook payload" });
    expect(orchestrator.handleLinearWebhook).not.toHaveBeenCalled();
  });

  it("returns 200 with duplicate:true and skips the handler when already processed", async () => {
    ({ app, orchestrator, idempotencyRepo } = buildApp({
      tryMarkProcessed: vi.fn().mockResolvedValue(false),
    }));
    await app.ready();

    const response = await app.inject({
      method: "POST",
      url: "/webhooks/linear",
      payload: { action: "create", type: "Issue", data: { id: "issue-1" } },
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ ok: true, duplicate: true });
    expect(orchestrator.handleLinearWebhook).not.toHaveBeenCalled();
  });

  it("uses type:action:id as the dedupe key", async () => {
    await app.inject({
      method: "POST",
      url: "/webhooks/linear",
      payload: { action: "create", type: "Issue", data: { id: "issue-42" } },
    });

    expect(idempotencyRepo.tryMarkProcessed).toHaveBeenCalledWith("linear", "Issue:create:issue-42");
  });

  it("handles Issue create by calling handleLinearWebhook with issue.created", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/webhooks/linear",
      payload: { action: "create", type: "Issue", data: { id: "issue-1", title: "New issue" } },
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ ok: true });
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
    expect(JSON.parse(response.body)).toEqual({ ok: true });
    expect(orchestrator.handleLinearWebhook).toHaveBeenCalledWith({
      action: "issue.updated",
      issueId: "issue-2",
    });
  });

  it("handles a recognized Comment command by dispatching comment.command", async () => {
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
    expect(JSON.parse(response.body)).toEqual({ ok: true });
    expect(orchestrator.handleLinearWebhook).toHaveBeenCalledWith({
      action: "comment.command",
      issueId: "issue-3",
      command: { type: "approve-plan" },
    });
  });

  it("handles a reject-plan Comment command, capturing the body text", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/webhooks/linear",
      payload: {
        action: "create",
        type: "Comment",
        data: { id: "comment-2", issueId: "issue-4", body: "/reject-plan needs more detail" },
      },
    });

    expect(response.statusCode).toBe(200);
    expect(orchestrator.handleLinearWebhook).toHaveBeenCalledWith({
      action: "comment.command",
      issueId: "issue-4",
      command: { type: "reject-plan", body: "needs more detail" },
    });
  });

  it("returns 200 ok without dispatching when a Comment body has no recognized command", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/webhooks/linear",
      payload: {
        action: "create",
        type: "Comment",
        data: { id: "comment-3", issueId: "issue-5", body: "just a regular comment" },
      },
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ ok: true });
    expect(orchestrator.handleLinearWebhook).not.toHaveBeenCalled();
  });

  it("returns ignored:true when a Comment create is missing body", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/webhooks/linear",
      payload: {
        action: "create",
        type: "Comment",
        data: { id: "comment-4", issueId: "issue-6" },
      },
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ ok: true, ignored: true });
    expect(orchestrator.handleLinearWebhook).not.toHaveBeenCalled();
  });

  it("returns ignored:true when a Comment create is missing issueId", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/webhooks/linear",
      payload: {
        action: "create",
        type: "Comment",
        data: { id: "comment-5", body: "/approve-plan" },
      },
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ ok: true, ignored: true });
    expect(orchestrator.handleLinearWebhook).not.toHaveBeenCalled();
  });

  it("returns ignored:true for an unrecognized type/action combination", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/webhooks/linear",
      payload: { action: "remove", type: "Project", data: { id: "proj-1" } },
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ ok: true, ignored: true });
    expect(orchestrator.handleLinearWebhook).not.toHaveBeenCalled();
  });
});
