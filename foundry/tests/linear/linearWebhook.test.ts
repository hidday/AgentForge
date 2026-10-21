import { describe, it, expect, vi, beforeEach } from "vitest";
import Fastify from "fastify";
import { registerLinearWebhook } from "../../src/linear/linearWebhook.js";
import type { OrchestratorService } from "../../src/orchestrator/orchestratorService.js";
import type { IdempotencyRepository } from "../../src/orchestrator/idempotencyRepository.js";

function buildMocks() {
  const orchestrator = { handleLinearWebhook: vi.fn().mockResolvedValue(undefined) };
  const idempotencyRepo = { tryMarkProcessed: vi.fn().mockResolvedValue(true) };
  return { orchestrator, idempotencyRepo };
}

async function buildApp(mocks: ReturnType<typeof buildMocks>) {
  const app = Fastify();
  registerLinearWebhook(
    app,
    mocks.orchestrator as unknown as OrchestratorService,
    mocks.idempotencyRepo as unknown as IdempotencyRepository,
  );
  await app.ready();
  return app;
}

describe("registerLinearWebhook", () => {
  let mocks: ReturnType<typeof buildMocks>;

  beforeEach(() => {
    mocks = buildMocks();
  });

  it("rejects a payload that fails schema validation", async () => {
    const app = await buildApp(mocks);

    const response = await app.inject({
      method: "POST",
      url: "/webhooks/linear",
      payload: { action: "create" }, // missing type + data
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "Invalid webhook payload" });
    expect(mocks.idempotencyRepo.tryMarkProcessed).not.toHaveBeenCalled();
  });

  it("short-circuits as a duplicate when the idempotency repo reports it was already processed", async () => {
    mocks.idempotencyRepo.tryMarkProcessed.mockResolvedValue(false);
    const app = await buildApp(mocks);

    const response = await app.inject({
      method: "POST",
      url: "/webhooks/linear",
      payload: { action: "create", type: "Issue", data: { id: "issue-1" } },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true, duplicate: true });
    expect(mocks.orchestrator.handleLinearWebhook).not.toHaveBeenCalled();
    expect(mocks.idempotencyRepo.tryMarkProcessed).toHaveBeenCalledWith(
      "linear",
      "Issue:create:issue-1",
    );
  });

  it("dispatches issue.created for a new Issue", async () => {
    const app = await buildApp(mocks);

    const response = await app.inject({
      method: "POST",
      url: "/webhooks/linear",
      payload: { action: "create", type: "Issue", data: { id: "issue-1" } },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true });
    expect(mocks.orchestrator.handleLinearWebhook).toHaveBeenCalledWith({
      action: "issue.created",
      issueId: "issue-1",
    });
  });

  it("dispatches issue.updated for an updated Issue", async () => {
    const app = await buildApp(mocks);

    const response = await app.inject({
      method: "POST",
      url: "/webhooks/linear",
      payload: { action: "update", type: "Issue", data: { id: "issue-1" } },
    });

    expect(response.statusCode).toBe(200);
    expect(mocks.orchestrator.handleLinearWebhook).toHaveBeenCalledWith({
      action: "issue.updated",
      issueId: "issue-1",
    });
  });

  it("dispatches comment.command when a Comment body parses as a valid command", async () => {
    const app = await buildApp(mocks);

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
    expect(mocks.orchestrator.handleLinearWebhook).toHaveBeenCalledWith({
      action: "comment.command",
      issueId: "issue-1",
      command: { type: "approve-plan" },
    });
  });

  it("does not dispatch for a Comment whose body has no recognizable command", async () => {
    const app = await buildApp(mocks);

    const response = await app.inject({
      method: "POST",
      url: "/webhooks/linear",
      payload: {
        action: "create",
        type: "Comment",
        data: { id: "comment-1", body: "just chatting, not a command", issueId: "issue-1" },
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true });
    expect(mocks.orchestrator.handleLinearWebhook).not.toHaveBeenCalled();
  });

  it("does not dispatch for a Comment missing a body", async () => {
    const app = await buildApp(mocks);

    const response = await app.inject({
      method: "POST",
      url: "/webhooks/linear",
      payload: { action: "create", type: "Comment", data: { id: "comment-1", issueId: "issue-1" } },
    });

    expect(response.statusCode).toBe(200);
    expect(mocks.orchestrator.handleLinearWebhook).not.toHaveBeenCalled();
  });

  it("does not dispatch for a Comment missing an issueId", async () => {
    const app = await buildApp(mocks);

    const response = await app.inject({
      method: "POST",
      url: "/webhooks/linear",
      payload: { action: "create", type: "Comment", data: { id: "comment-1", body: "/approve" } },
    });

    expect(response.statusCode).toBe(200);
    expect(mocks.orchestrator.handleLinearWebhook).not.toHaveBeenCalled();
  });

  it("returns ok+ignored for an event type/action combination it doesn't handle", async () => {
    const app = await buildApp(mocks);

    const response = await app.inject({
      method: "POST",
      url: "/webhooks/linear",
      payload: { action: "remove", type: "Issue", data: { id: "issue-1" } },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true, ignored: true });
    expect(mocks.orchestrator.handleLinearWebhook).not.toHaveBeenCalled();
  });
});
