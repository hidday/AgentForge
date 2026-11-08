import { describe, it, expect, vi, beforeEach } from "vitest";
import Fastify from "fastify";
import { registerLinearWebhook } from "../../src/linear/linearWebhook.js";

function buildMocks() {
  const orchestrator = { handleLinearWebhook: vi.fn().mockResolvedValue(undefined) };
  const idempotencyRepo = { tryMarkProcessed: vi.fn().mockResolvedValue(true) };
  return { orchestrator, idempotencyRepo };
}

async function buildApp(
  orchestrator: { handleLinearWebhook: ReturnType<typeof vi.fn> },
  idempotencyRepo: { tryMarkProcessed: ReturnType<typeof vi.fn> },
) {
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

  it("returns 400 for a payload failing schema validation", async () => {
    const app = await buildApp(orchestrator, idempotencyRepo);

    const response = await app.inject({
      method: "POST",
      url: "/webhooks/linear",
      payload: { action: "create" },
    });

    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body)).toEqual({ error: "Invalid webhook payload" });
    expect(idempotencyRepo.tryMarkProcessed).not.toHaveBeenCalled();
  });

  it("routes Issue/create to issue.created and dedupes on type:action:id", async () => {
    const app = await buildApp(orchestrator, idempotencyRepo);

    const response = await app.inject({
      method: "POST",
      url: "/webhooks/linear",
      payload: { action: "create", type: "Issue", data: { id: "issue-1" } },
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ ok: true });
    expect(idempotencyRepo.tryMarkProcessed).toHaveBeenCalledWith("linear", "Issue:create:issue-1");
    expect(orchestrator.handleLinearWebhook).toHaveBeenCalledWith({
      action: "issue.created",
      issueId: "issue-1",
    });
  });

  it("routes Issue/update to issue.updated", async () => {
    const app = await buildApp(orchestrator, idempotencyRepo);

    const response = await app.inject({
      method: "POST",
      url: "/webhooks/linear",
      payload: { action: "update", type: "Issue", data: { id: "issue-2" } },
    });

    expect(response.statusCode).toBe(200);
    expect(orchestrator.handleLinearWebhook).toHaveBeenCalledWith({
      action: "issue.updated",
      issueId: "issue-2",
    });
  });

  it("parses a recognised command from a Comment/create and routes comment.command", async () => {
    const app = await buildApp(orchestrator, idempotencyRepo);

    const response = await app.inject({
      method: "POST",
      url: "/webhooks/linear",
      payload: {
        action: "create",
        type: "Comment",
        data: { id: "comment-1", issueId: "issue-3", body: "/approve" },
      },
    });

    expect(response.statusCode).toBe(200);
    expect(orchestrator.handleLinearWebhook).toHaveBeenCalledWith(
      expect.objectContaining({ action: "comment.command", issueId: "issue-3" }),
    );
  });

  it("does not call the orchestrator for a Comment/create with no recognised command", async () => {
    const app = await buildApp(orchestrator, idempotencyRepo);

    const response = await app.inject({
      method: "POST",
      url: "/webhooks/linear",
      payload: {
        action: "create",
        type: "Comment",
        data: { id: "comment-2", issueId: "issue-3", body: "just a normal comment" },
      },
    });

    expect(response.statusCode).toBe(200);
    expect(orchestrator.handleLinearWebhook).not.toHaveBeenCalled();
  });

  it("falls through to ignored:true for a Comment/create with no body", async () => {
    const app = await buildApp(orchestrator, idempotencyRepo);

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
    expect(orchestrator.handleLinearWebhook).not.toHaveBeenCalled();
  });

  it("ignores a Comment/create with no issueId", async () => {
    const app = await buildApp(orchestrator, idempotencyRepo);

    const response = await app.inject({
      method: "POST",
      url: "/webhooks/linear",
      payload: {
        action: "create",
        type: "Comment",
        data: { id: "comment-4", body: "/approve" },
      },
    });

    expect(response.statusCode).toBe(200);
    expect(orchestrator.handleLinearWebhook).not.toHaveBeenCalled();
  });

  it("returns ignored:true for an unrecognised type/action combination", async () => {
    const app = await buildApp(orchestrator, idempotencyRepo);

    const response = await app.inject({
      method: "POST",
      url: "/webhooks/linear",
      payload: { action: "remove", type: "Reaction", data: { id: "r-1" } },
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ ok: true, ignored: true });
    expect(orchestrator.handleLinearWebhook).not.toHaveBeenCalled();
  });

  it("short-circuits as a duplicate when the idempotency repo reports it was already processed", async () => {
    idempotencyRepo.tryMarkProcessed.mockResolvedValue(false);
    const app = await buildApp(orchestrator, idempotencyRepo);

    const response = await app.inject({
      method: "POST",
      url: "/webhooks/linear",
      payload: { action: "create", type: "Issue", data: { id: "issue-1" } },
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ ok: true, duplicate: true });
    expect(orchestrator.handleLinearWebhook).not.toHaveBeenCalled();
  });
});
