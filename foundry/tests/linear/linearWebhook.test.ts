import { describe, it, expect, vi, beforeEach } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { registerLinearWebhook } from "../../src/linear/linearWebhook.js";
import type { OrchestratorService } from "../../src/orchestrator/orchestratorService.js";
import type { IdempotencyRepository } from "../../src/orchestrator/idempotencyRepository.js";

function buildApp(opts: { isNew?: boolean } = {}) {
  const handleLinearWebhook = vi.fn().mockResolvedValue(undefined);
  const tryMarkProcessed = vi.fn().mockResolvedValue(opts.isNew ?? true);

  const app: FastifyInstance = Fastify({ logger: false });
  registerLinearWebhook(
    app,
    { handleLinearWebhook } as unknown as OrchestratorService,
    { tryMarkProcessed } as unknown as IdempotencyRepository,
  );

  return { app, handleLinearWebhook, tryMarkProcessed };
}

async function post(app: FastifyInstance, payload: unknown) {
  return app.inject({ method: "POST", url: "/webhooks/linear", payload });
}

describe("registerLinearWebhook", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 400 when the payload fails schema validation", async () => {
    const { app, handleLinearWebhook, tryMarkProcessed } = buildApp();

    const response = await post(app, { action: "create" }); // missing type/data

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "Invalid webhook payload" });
    expect(tryMarkProcessed).not.toHaveBeenCalled();
    expect(handleLinearWebhook).not.toHaveBeenCalled();
  });

  it("dedupes using type:action:id and short-circuits on a duplicate", async () => {
    const { app, handleLinearWebhook, tryMarkProcessed } = buildApp({ isNew: false });

    const response = await post(app, {
      action: "create",
      type: "Issue",
      data: { id: "issue-1" },
    });

    expect(tryMarkProcessed).toHaveBeenCalledWith("linear", "Issue:create:issue-1");
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true, duplicate: true });
    expect(handleLinearWebhook).not.toHaveBeenCalled();
  });

  it("handles Issue create by dispatching issue.created", async () => {
    const { app, handleLinearWebhook } = buildApp();

    const response = await post(app, {
      action: "create",
      type: "Issue",
      data: { id: "issue-1" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true });
    expect(handleLinearWebhook).toHaveBeenCalledWith({
      action: "issue.created",
      issueId: "issue-1",
    });
  });

  it("handles Issue update by dispatching issue.updated", async () => {
    const { app, handleLinearWebhook } = buildApp();

    const response = await post(app, {
      action: "update",
      type: "Issue",
      data: { id: "issue-2" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true });
    expect(handleLinearWebhook).toHaveBeenCalledWith({
      action: "issue.updated",
      issueId: "issue-2",
    });
  });

  it("parses a recognized slash command from a new comment and dispatches comment.command", async () => {
    const { app, handleLinearWebhook } = buildApp();

    const response = await post(app, {
      action: "create",
      type: "Comment",
      data: { id: "comment-1", issueId: "issue-3", body: "/ai-plan" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true });
    expect(handleLinearWebhook).toHaveBeenCalledWith({
      action: "comment.command",
      issueId: "issue-3",
      command: { type: "ai-plan" },
    });
  });

  it("does not dispatch when a comment has no recognized command", async () => {
    const { app, handleLinearWebhook } = buildApp();

    const response = await post(app, {
      action: "create",
      type: "Comment",
      data: { id: "comment-2", issueId: "issue-3", body: "just a normal comment" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true });
    expect(handleLinearWebhook).not.toHaveBeenCalled();
  });

  it("ignores a Comment create event missing body or issueId", async () => {
    const { app, handleLinearWebhook } = buildApp();

    const response = await post(app, {
      action: "create",
      type: "Comment",
      data: { id: "comment-3" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true, ignored: true });
    expect(handleLinearWebhook).not.toHaveBeenCalled();
  });

  it("ignores event types/actions that don't match any handled case", async () => {
    const { app, handleLinearWebhook } = buildApp();

    const response = await post(app, {
      action: "remove",
      type: "IssueLabel",
      data: { id: "label-1" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true, ignored: true });
    expect(handleLinearWebhook).not.toHaveBeenCalled();
  });
});
