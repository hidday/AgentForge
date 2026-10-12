import { describe, it, expect, vi } from "vitest";
import Fastify from "fastify";
import { registerLinearWebhook } from "../../src/linear/linearWebhook.js";
import type { OrchestratorService } from "../../src/orchestrator/orchestratorService.js";
import type { IdempotencyRepository } from "../../src/orchestrator/idempotencyRepository.js";

function buildDeps(tryMarkProcessedResult = true) {
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
  registerLinearWebhook(
    app,
    orchestrator as OrchestratorService,
    idempotencyRepo as IdempotencyRepository,
  );
  await app.ready();
  return app;
}

describe("POST /webhooks/linear", () => {
  it("returns 400 for an invalid payload", async () => {
    const { orchestrator, idempotencyRepo } = buildDeps();
    const app = await buildApp(orchestrator, idempotencyRepo);

    const response = await app.inject({
      method: "POST",
      url: "/webhooks/linear",
      payload: { action: "create" }, // missing required "type" and "data"
    });

    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body)).toEqual({ error: "Invalid webhook payload" });
    expect(idempotencyRepo.tryMarkProcessed).not.toHaveBeenCalled();
  });

  it("returns 200 with duplicate:true and skips the orchestrator when already processed", async () => {
    const { orchestrator, idempotencyRepo } = buildDeps(false);
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

  it("uses type:action:id as the dedupe key", async () => {
    const { orchestrator, idempotencyRepo } = buildDeps();
    const app = await buildApp(orchestrator, idempotencyRepo);

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

  it("dispatches issue.created for a new Issue", async () => {
    const { orchestrator, idempotencyRepo } = buildDeps();
    const app = await buildApp(orchestrator, idempotencyRepo);

    const response = await app.inject({
      method: "POST",
      url: "/webhooks/linear",
      payload: { action: "create", type: "Issue", data: { id: "issue-1" } },
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ ok: true });
    expect(orchestrator.handleLinearWebhook).toHaveBeenCalledWith({
      action: "issue.created",
      issueId: "issue-1",
    });
  });

  it("dispatches issue.updated for an updated Issue", async () => {
    const { orchestrator, idempotencyRepo } = buildDeps();
    const app = await buildApp(orchestrator, idempotencyRepo);

    const response = await app.inject({
      method: "POST",
      url: "/webhooks/linear",
      payload: { action: "update", type: "Issue", data: { id: "issue-1" } },
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ ok: true });
    expect(orchestrator.handleLinearWebhook).toHaveBeenCalledWith({
      action: "issue.updated",
      issueId: "issue-1",
    });
  });

  it("dispatches comment.command when a comment body contains a recognized slash command", async () => {
    const { orchestrator, idempotencyRepo } = buildDeps();
    const app = await buildApp(orchestrator, idempotencyRepo);

    const response = await app.inject({
      method: "POST",
      url: "/webhooks/linear",
      payload: {
        action: "create",
        type: "Comment",
        data: { id: "comment-1", body: "/approve-plan", issueId: "issue-1" },
      },
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ ok: true });
    expect(orchestrator.handleLinearWebhook).toHaveBeenCalledWith({
      action: "comment.command",
      issueId: "issue-1",
      command: { type: "approve-plan" },
    });
  });

  it("returns ok without dispatching when the comment body has no recognized command", async () => {
    const { orchestrator, idempotencyRepo } = buildDeps();
    const app = await buildApp(orchestrator, idempotencyRepo);

    const response = await app.inject({
      method: "POST",
      url: "/webhooks/linear",
      payload: {
        action: "create",
        type: "Comment",
        data: { id: "comment-1", body: "just a regular comment", issueId: "issue-1" },
      },
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ ok: true });
    expect(orchestrator.handleLinearWebhook).not.toHaveBeenCalled();
  });

  it("returns ignored:true when a Comment create event is missing body or issueId", async () => {
    const { orchestrator, idempotencyRepo } = buildDeps();
    const app = await buildApp(orchestrator, idempotencyRepo);

    const response = await app.inject({
      method: "POST",
      url: "/webhooks/linear",
      payload: { action: "create", type: "Comment", data: { id: "comment-1" } },
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ ok: true, ignored: true });
    expect(orchestrator.handleLinearWebhook).not.toHaveBeenCalled();
  });

  it("returns ignored:true for an event type/action combination that is not handled", async () => {
    const { orchestrator, idempotencyRepo } = buildDeps();
    const app = await buildApp(orchestrator, idempotencyRepo);

    const response = await app.inject({
      method: "POST",
      url: "/webhooks/linear",
      payload: { action: "remove", type: "Issue", data: { id: "issue-1" } },
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ ok: true, ignored: true });
    expect(orchestrator.handleLinearWebhook).not.toHaveBeenCalled();
  });
});
