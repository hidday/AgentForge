import { describe, it, expect, vi, beforeEach } from "vitest";
import Fastify from "fastify";
import { registerLinearWebhook } from "../../src/linear/linearWebhook.js";

function buildDeps() {
  const orchestrator = { handleLinearWebhook: vi.fn().mockResolvedValue(undefined) };
  const idempotencyRepo = { tryMarkProcessed: vi.fn().mockResolvedValue(true) };
  return { orchestrator, idempotencyRepo };
}

async function buildApp(deps: ReturnType<typeof buildDeps>) {
  const app = Fastify({ logger: false });
  registerLinearWebhook(app, deps.orchestrator as never, deps.idempotencyRepo as never);
  await app.ready();
  return app;
}

describe("registerLinearWebhook", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 400 for a malformed payload missing required fields", async () => {
    const deps = buildDeps();
    const app = await buildApp(deps);
    const response = await app.inject({
      method: "POST",
      url: "/webhooks/linear",
      payload: { action: "create" },
    });
    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body)).toEqual({ error: "Invalid webhook payload" });
    expect(deps.orchestrator.handleLinearWebhook).not.toHaveBeenCalled();
  });

  it("returns 400 for a completely malformed (non-object) JSON body", async () => {
    const deps = buildDeps();
    const app = await buildApp(deps);
    const response = await app.inject({
      method: "POST",
      url: "/webhooks/linear",
      headers: { "content-type": "application/json" },
      payload: "42",
    });
    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body)).toEqual({ error: "Invalid webhook payload" });
  });

  it("returns 200 and ignores a duplicate webhook without invoking the orchestrator", async () => {
    const deps = buildDeps();
    deps.idempotencyRepo.tryMarkProcessed.mockResolvedValue(false);
    const app = await buildApp(deps);
    const response = await app.inject({
      method: "POST",
      url: "/webhooks/linear",
      payload: { action: "create", type: "Issue", data: { id: "issue-1" } },
    });
    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ ok: true, duplicate: true });
    expect(deps.orchestrator.handleLinearWebhook).not.toHaveBeenCalled();
  });

  it("handles an Issue create event", async () => {
    const deps = buildDeps();
    const app = await buildApp(deps);
    const response = await app.inject({
      method: "POST",
      url: "/webhooks/linear",
      payload: { action: "create", type: "Issue", data: { id: "issue-1" } },
    });
    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ ok: true });
    expect(deps.orchestrator.handleLinearWebhook).toHaveBeenCalledWith({
      action: "issue.created",
      issueId: "issue-1",
    });
    expect(deps.idempotencyRepo.tryMarkProcessed).toHaveBeenCalledWith(
      "linear",
      "Issue:create:issue-1",
    );
  });

  it("handles an Issue update event", async () => {
    const deps = buildDeps();
    const app = await buildApp(deps);
    const response = await app.inject({
      method: "POST",
      url: "/webhooks/linear",
      payload: { action: "update", type: "Issue", data: { id: "issue-2" } },
    });
    expect(response.statusCode).toBe(200);
    expect(deps.orchestrator.handleLinearWebhook).toHaveBeenCalledWith({
      action: "issue.updated",
      issueId: "issue-2",
    });
  });

  it("parses a recognized command from a Comment create event and dispatches comment.command", async () => {
    const deps = buildDeps();
    const app = await buildApp(deps);
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
    expect(deps.orchestrator.handleLinearWebhook).toHaveBeenCalledWith({
      action: "comment.command",
      issueId: "issue-3",
      command: { type: "approve-plan" },
    });
  });

  it("does not dispatch a command for a Comment create event whose body has no recognized command", async () => {
    const deps = buildDeps();
    const app = await buildApp(deps);
    const response = await app.inject({
      method: "POST",
      url: "/webhooks/linear",
      payload: {
        action: "create",
        type: "Comment",
        data: { id: "comment-2", issueId: "issue-3", body: "just a regular comment" },
      },
    });
    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ ok: true });
    expect(deps.orchestrator.handleLinearWebhook).not.toHaveBeenCalled();
  });

  it("ignores a Comment create event missing a body", async () => {
    const deps = buildDeps();
    const app = await buildApp(deps);
    const response = await app.inject({
      method: "POST",
      url: "/webhooks/linear",
      payload: {
        action: "create",
        type: "Comment",
        data: { id: "comment-3", issueId: "issue-3" },
      },
    });
    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ ok: true, ignored: true });
    expect(deps.orchestrator.handleLinearWebhook).not.toHaveBeenCalled();
  });

  it("ignores a Comment create event missing an issueId", async () => {
    const deps = buildDeps();
    const app = await buildApp(deps);
    const response = await app.inject({
      method: "POST",
      url: "/webhooks/linear",
      payload: {
        action: "create",
        type: "Comment",
        data: { id: "comment-4", body: "/approve-plan" },
      },
    });
    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ ok: true, ignored: true });
    expect(deps.orchestrator.handleLinearWebhook).not.toHaveBeenCalled();
  });

  it("returns 200 with ignored=true for an event type/action combination that is not handled", async () => {
    const deps = buildDeps();
    const app = await buildApp(deps);
    const response = await app.inject({
      method: "POST",
      url: "/webhooks/linear",
      payload: { action: "remove", type: "Issue", data: { id: "issue-5" } },
    });
    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ ok: true, ignored: true });
    expect(deps.orchestrator.handleLinearWebhook).not.toHaveBeenCalled();
  });
});
