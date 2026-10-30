import { describe, it, expect, vi, beforeEach } from "vitest";
import Fastify from "fastify";
import { registerLinearWebhook } from "../../src/linear/linearWebhook.js";

function buildMocks() {
  const orchestrator = { handleLinearWebhook: vi.fn().mockResolvedValue(undefined) };
  const idempotencyRepo = { tryMarkProcessed: vi.fn().mockResolvedValue(true) };
  return { orchestrator, idempotencyRepo };
}

async function buildApp(orchestrator: unknown, idempotencyRepo: unknown) {
  const app = Fastify({ logger: false });
  registerLinearWebhook(app, orchestrator as never, idempotencyRepo as never);
  await app.ready();
  return app;
}

describe("registerLinearWebhook", () => {
  let orchestrator: ReturnType<typeof buildMocks>["orchestrator"];
  let idempotencyRepo: ReturnType<typeof buildMocks>["idempotencyRepo"];

  beforeEach(() => {
    ({ orchestrator, idempotencyRepo } = buildMocks());
  });

  it("returns 400 for an invalid payload", async () => {
    const app = await buildApp(orchestrator, idempotencyRepo);
    const res = await app.inject({ method: "POST", url: "/webhooks/linear", payload: {} });
    expect(res.statusCode).toBe(400);
  });

  it("returns ok+duplicate without dispatching when the event was already processed", async () => {
    idempotencyRepo.tryMarkProcessed.mockResolvedValue(false);
    const app = await buildApp(orchestrator, idempotencyRepo);

    const res = await app.inject({
      method: "POST",
      url: "/webhooks/linear",
      payload: { action: "create", type: "Issue", data: { id: "issue-1" } },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, duplicate: true });
    expect(orchestrator.handleLinearWebhook).not.toHaveBeenCalled();
  });

  it("dispatches issue.created on Issue create", async () => {
    const app = await buildApp(orchestrator, idempotencyRepo);

    const res = await app.inject({
      method: "POST",
      url: "/webhooks/linear",
      payload: { action: "create", type: "Issue", data: { id: "issue-1" } },
    });

    expect(res.statusCode).toBe(200);
    expect(orchestrator.handleLinearWebhook).toHaveBeenCalledWith({
      action: "issue.created",
      issueId: "issue-1",
    });
  });

  it("dispatches issue.updated on Issue update", async () => {
    const app = await buildApp(orchestrator, idempotencyRepo);

    await app.inject({
      method: "POST",
      url: "/webhooks/linear",
      payload: { action: "update", type: "Issue", data: { id: "issue-1" } },
    });

    expect(orchestrator.handleLinearWebhook).toHaveBeenCalledWith({
      action: "issue.updated",
      issueId: "issue-1",
    });
  });

  it("dispatches comment.command when a Comment create body parses to a command", async () => {
    const app = await buildApp(orchestrator, idempotencyRepo);

    const res = await app.inject({
      method: "POST",
      url: "/webhooks/linear",
      payload: {
        action: "create",
        type: "Comment",
        data: { id: "comment-1", issueId: "issue-1", body: "/approve-plan" },
      },
    });

    expect(res.statusCode).toBe(200);
    expect(orchestrator.handleLinearWebhook).toHaveBeenCalledWith(
      expect.objectContaining({ action: "comment.command", issueId: "issue-1" }),
    );
  });

  it("acknowledges without dispatching a comment whose body is not a recognized command", async () => {
    const app = await buildApp(orchestrator, idempotencyRepo);

    const res = await app.inject({
      method: "POST",
      url: "/webhooks/linear",
      payload: {
        action: "create",
        type: "Comment",
        data: { id: "comment-1", issueId: "issue-1", body: "just a note" },
      },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    expect(orchestrator.handleLinearWebhook).not.toHaveBeenCalled();
  });

  it("acknowledges a Comment create missing body/issueId without dispatching", async () => {
    const app = await buildApp(orchestrator, idempotencyRepo);

    const res = await app.inject({
      method: "POST",
      url: "/webhooks/linear",
      payload: { action: "create", type: "Comment", data: { id: "comment-1" } },
    });

    expect(res.statusCode).toBe(200);
    expect(orchestrator.handleLinearWebhook).not.toHaveBeenCalled();
  });

  it("acknowledges and ignores any other event type/action combination", async () => {
    const app = await buildApp(orchestrator, idempotencyRepo);

    const res = await app.inject({
      method: "POST",
      url: "/webhooks/linear",
      payload: { action: "remove", type: "Issue", data: { id: "issue-1" } },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, ignored: true });
    expect(orchestrator.handleLinearWebhook).not.toHaveBeenCalled();
  });
});
