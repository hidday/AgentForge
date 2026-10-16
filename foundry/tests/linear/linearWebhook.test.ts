import { describe, it, expect, vi } from "vitest";
import Fastify from "fastify";
import { registerLinearWebhook } from "../../src/linear/linearWebhook.js";

function buildMocks(tryMarkProcessedResult = true) {
  const orchestrator = {
    handleLinearWebhook: vi.fn().mockResolvedValue(undefined),
  };
  const idempotencyRepo = {
    tryMarkProcessed: vi.fn().mockResolvedValue(tryMarkProcessedResult),
  };
  return { orchestrator, idempotencyRepo };
}

async function buildApp(orchestrator: unknown, idempotencyRepo: unknown) {
  const app = Fastify({ logger: false });
  registerLinearWebhook(app, orchestrator as never, idempotencyRepo as never);
  await app.ready();
  return app;
}

describe("POST /webhooks/linear", () => {
  it("returns 400 for an invalid payload shape", async () => {
    const { orchestrator, idempotencyRepo } = buildMocks();
    const app = await buildApp(orchestrator, idempotencyRepo);

    const response = await app.inject({
      method: "POST",
      url: "/webhooks/linear",
      payload: { action: "create" }, // missing type and data
    });

    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body)).toEqual({ error: "Invalid webhook payload" });
    expect(idempotencyRepo.tryMarkProcessed).not.toHaveBeenCalled();
    expect(orchestrator.handleLinearWebhook).not.toHaveBeenCalled();
  });

  it("returns 400 when data is missing required id field", async () => {
    const { orchestrator, idempotencyRepo } = buildMocks();
    const app = await buildApp(orchestrator, idempotencyRepo);

    const response = await app.inject({
      method: "POST",
      url: "/webhooks/linear",
      payload: { action: "create", type: "Issue", data: {} },
    });

    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body)).toEqual({ error: "Invalid webhook payload" });
  });

  it("returns 200 duplicate:true and does not call the orchestrator for a duplicate event", async () => {
    const { orchestrator, idempotencyRepo } = buildMocks(false);
    const app = await buildApp(orchestrator, idempotencyRepo);

    const response = await app.inject({
      method: "POST",
      url: "/webhooks/linear",
      payload: { action: "create", type: "Issue", data: { id: "iss-1" } },
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ ok: true, duplicate: true });
    expect(idempotencyRepo.tryMarkProcessed).toHaveBeenCalledWith("linear", "Issue:create:iss-1");
    expect(orchestrator.handleLinearWebhook).not.toHaveBeenCalled();
  });

  it("handles type:Issue action:create by calling handleLinearWebhook with issue.created", async () => {
    const { orchestrator, idempotencyRepo } = buildMocks(true);
    const app = await buildApp(orchestrator, idempotencyRepo);

    const response = await app.inject({
      method: "POST",
      url: "/webhooks/linear",
      payload: { action: "create", type: "Issue", data: { id: "iss-1", title: "New issue" } },
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ ok: true });
    expect(orchestrator.handleLinearWebhook).toHaveBeenCalledWith({
      action: "issue.created",
      issueId: "iss-1",
    });
  });

  it("handles type:Issue action:update by calling handleLinearWebhook with issue.updated", async () => {
    const { orchestrator, idempotencyRepo } = buildMocks(true);
    const app = await buildApp(orchestrator, idempotencyRepo);

    const response = await app.inject({
      method: "POST",
      url: "/webhooks/linear",
      payload: { action: "update", type: "Issue", data: { id: "iss-2" } },
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ ok: true });
    expect(orchestrator.handleLinearWebhook).toHaveBeenCalledWith({
      action: "issue.updated",
      issueId: "iss-2",
    });
  });

  it("handles type:Comment action:create with a recognized command and issueId by calling handleLinearWebhook with comment.command", async () => {
    const { orchestrator, idempotencyRepo } = buildMocks(true);
    const app = await buildApp(orchestrator, idempotencyRepo);

    const response = await app.inject({
      method: "POST",
      url: "/webhooks/linear",
      payload: {
        action: "create",
        type: "Comment",
        data: { id: "cmt-1", issueId: "iss-3", body: "/approve-plan" },
      },
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ ok: true });
    expect(orchestrator.handleLinearWebhook).toHaveBeenCalledWith({
      action: "comment.command",
      issueId: "iss-3",
      command: { type: "approve-plan" },
    });
  });

  it("does not call handleLinearWebhook for a Comment/create whose body does not parse to a command", async () => {
    const { orchestrator, idempotencyRepo } = buildMocks(true);
    const app = await buildApp(orchestrator, idempotencyRepo);

    const response = await app.inject({
      method: "POST",
      url: "/webhooks/linear",
      payload: {
        action: "create",
        type: "Comment",
        data: { id: "cmt-2", issueId: "iss-4", body: "just a regular comment, no command here" },
      },
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ ok: true });
    expect(orchestrator.handleLinearWebhook).not.toHaveBeenCalled();
  });

  it("does not call handleLinearWebhook for a Comment/create missing issueId, and reports ignored:true", async () => {
    const { orchestrator, idempotencyRepo } = buildMocks(true);
    const app = await buildApp(orchestrator, idempotencyRepo);

    const response = await app.inject({
      method: "POST",
      url: "/webhooks/linear",
      payload: {
        action: "create",
        type: "Comment",
        data: { id: "cmt-3", body: "/approve-plan" },
      },
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ ok: true, ignored: true });
    expect(orchestrator.handleLinearWebhook).not.toHaveBeenCalled();
  });

  it("does not call handleLinearWebhook for a Comment/create missing body, and reports ignored:true", async () => {
    const { orchestrator, idempotencyRepo } = buildMocks(true);
    const app = await buildApp(orchestrator, idempotencyRepo);

    const response = await app.inject({
      method: "POST",
      url: "/webhooks/linear",
      payload: {
        action: "create",
        type: "Comment",
        data: { id: "cmt-4", issueId: "iss-5" },
      },
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ ok: true, ignored: true });
    expect(orchestrator.handleLinearWebhook).not.toHaveBeenCalled();
  });

  it("returns 200 ignored:true and does not call the orchestrator for any other type/action combination", async () => {
    const { orchestrator, idempotencyRepo } = buildMocks(true);
    const app = await buildApp(orchestrator, idempotencyRepo);

    const response = await app.inject({
      method: "POST",
      url: "/webhooks/linear",
      payload: { action: "remove", type: "Issue", data: { id: "iss-6" } },
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ ok: true, ignored: true });
    expect(orchestrator.handleLinearWebhook).not.toHaveBeenCalled();
  });
});
