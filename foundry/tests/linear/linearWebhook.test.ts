import { describe, it, expect, vi } from "vitest";
import Fastify from "fastify";
import { registerLinearWebhook } from "../../src/linear/linearWebhook.js";

function buildDeps(overrides: { tryMarkProcessed?: ReturnType<typeof vi.fn> } = {}) {
  const mockOrchestrator = {
    handleLinearWebhook: vi.fn().mockResolvedValue(undefined),
  };
  const mockIdempotencyRepo = {
    tryMarkProcessed: overrides.tryMarkProcessed ?? vi.fn().mockResolvedValue(true),
  };
  return { mockOrchestrator, mockIdempotencyRepo };
}

async function buildApp(deps: ReturnType<typeof buildDeps>) {
  const app = Fastify({ logger: false });
  registerLinearWebhook(app, deps.mockOrchestrator as never, deps.mockIdempotencyRepo as never);
  await app.ready();
  return app;
}

describe("registerLinearWebhook", () => {
  it("returns 400 for a payload missing required fields", async () => {
    const deps = buildDeps();
    const app = await buildApp(deps);

    const response = await app.inject({
      method: "POST",
      url: "/webhooks/linear",
      payload: { action: "create" },
    });

    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body)).toEqual({ error: "Invalid webhook payload" });
    expect(deps.mockIdempotencyRepo.tryMarkProcessed).not.toHaveBeenCalled();
  });

  it("returns 400 when data.id is missing", async () => {
    const deps = buildDeps();
    const app = await buildApp(deps);

    const response = await app.inject({
      method: "POST",
      url: "/webhooks/linear",
      payload: { action: "create", type: "Issue", data: {} },
    });

    expect(response.statusCode).toBe(400);
  });

  it("handles Issue create events", async () => {
    const deps = buildDeps();
    const app = await buildApp(deps);

    const response = await app.inject({
      method: "POST",
      url: "/webhooks/linear",
      payload: { action: "create", type: "Issue", data: { id: "issue-1" } },
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ ok: true });
    expect(deps.mockOrchestrator.handleLinearWebhook).toHaveBeenCalledWith({
      action: "issue.created",
      issueId: "issue-1",
    });
    expect(deps.mockIdempotencyRepo.tryMarkProcessed).toHaveBeenCalledWith(
      "linear",
      "Issue:create:issue-1",
    );
  });

  it("handles Issue update events", async () => {
    const deps = buildDeps();
    const app = await buildApp(deps);

    const response = await app.inject({
      method: "POST",
      url: "/webhooks/linear",
      payload: { action: "update", type: "Issue", data: { id: "issue-1" } },
    });

    expect(response.statusCode).toBe(200);
    expect(deps.mockOrchestrator.handleLinearWebhook).toHaveBeenCalledWith({
      action: "issue.updated",
      issueId: "issue-1",
    });
  });

  it("parses and forwards a recognized slash command from a Comment create event", async () => {
    const deps = buildDeps();
    const app = await buildApp(deps);

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
    expect(deps.mockOrchestrator.handleLinearWebhook).toHaveBeenCalledWith({
      action: "comment.command",
      issueId: "issue-1",
      command: { type: "approve-plan" },
    });
  });

  it("forwards a reject-plan command with its body", async () => {
    const deps = buildDeps();
    const app = await buildApp(deps);

    const response = await app.inject({
      method: "POST",
      url: "/webhooks/linear",
      payload: {
        action: "create",
        type: "Comment",
        data: { id: "comment-1", issueId: "issue-1", body: "/reject-plan use OAuth instead" },
      },
    });

    expect(response.statusCode).toBe(200);
    expect(deps.mockOrchestrator.handleLinearWebhook).toHaveBeenCalledWith({
      action: "comment.command",
      issueId: "issue-1",
      command: { type: "reject-plan", body: "use OAuth instead" },
    });
  });

  it("does not call the orchestrator for a Comment with no recognized command, but still returns ok", async () => {
    const deps = buildDeps();
    const app = await buildApp(deps);

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
    expect(deps.mockOrchestrator.handleLinearWebhook).not.toHaveBeenCalled();
  });

  it("ignores a Comment create event missing body or issueId", async () => {
    const deps = buildDeps();
    const app = await buildApp(deps);

    const response = await app.inject({
      method: "POST",
      url: "/webhooks/linear",
      payload: {
        action: "create",
        type: "Comment",
        data: { id: "comment-1" },
      },
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ ok: true, ignored: true });
    expect(deps.mockOrchestrator.handleLinearWebhook).not.toHaveBeenCalled();
  });

  it("ignores event types/actions it does not handle", async () => {
    const deps = buildDeps();
    const app = await buildApp(deps);

    const response = await app.inject({
      method: "POST",
      url: "/webhooks/linear",
      payload: { action: "remove", type: "Reaction", data: { id: "reaction-1" } },
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ ok: true, ignored: true });
    expect(deps.mockOrchestrator.handleLinearWebhook).not.toHaveBeenCalled();
  });

  it("short-circuits duplicate events using the idempotency repository", async () => {
    const deps = buildDeps({ tryMarkProcessed: vi.fn().mockResolvedValue(false) });
    const app = await buildApp(deps);

    const response = await app.inject({
      method: "POST",
      url: "/webhooks/linear",
      payload: { action: "create", type: "Issue", data: { id: "issue-1" } },
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ ok: true, duplicate: true });
    expect(deps.mockOrchestrator.handleLinearWebhook).not.toHaveBeenCalled();
  });
});
