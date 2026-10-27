import { describe, it, expect, vi, beforeEach } from "vitest";
import Fastify from "fastify";
import { registerLinearWebhook } from "../../src/linear/linearWebhook.js";

function buildDeps() {
  const orchestrator = { handleLinearWebhook: vi.fn().mockResolvedValue(undefined) };
  const idempotencyRepo = { tryMarkProcessed: vi.fn().mockResolvedValue(true) };
  return { orchestrator, idempotencyRepo };
}

async function buildApp(
  orchestrator: ReturnType<typeof buildDeps>["orchestrator"],
  idempotencyRepo: ReturnType<typeof buildDeps>["idempotencyRepo"],
) {
  const app = Fastify({ logger: false });
  registerLinearWebhook(app, orchestrator as never, idempotencyRepo as never);
  await app.ready();
  return app;
}

describe("registerLinearWebhook POST /webhooks/linear", () => {
  let deps: ReturnType<typeof buildDeps>;

  beforeEach(() => {
    deps = buildDeps();
  });

  it("returns 400 for a payload missing required fields", async () => {
    const app = await buildApp(deps.orchestrator, deps.idempotencyRepo);

    const response = await app.inject({
      method: "POST",
      url: "/webhooks/linear",
      payload: { action: "create" },
    });

    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body)).toEqual({ error: "Invalid webhook payload" });
    expect(deps.idempotencyRepo.tryMarkProcessed).not.toHaveBeenCalled();
  });

  it("returns 200 with duplicate:true and skips the orchestrator when the event was already processed", async () => {
    deps.idempotencyRepo.tryMarkProcessed.mockResolvedValue(false);
    const app = await buildApp(deps.orchestrator, deps.idempotencyRepo);

    const response = await app.inject({
      method: "POST",
      url: "/webhooks/linear",
      payload: { action: "create", type: "Issue", data: { id: "issue-1" } },
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ ok: true, duplicate: true });
    expect(deps.orchestrator.handleLinearWebhook).not.toHaveBeenCalled();
    expect(deps.idempotencyRepo.tryMarkProcessed).toHaveBeenCalledWith(
      "linear",
      "Issue:create:issue-1",
    );
  });

  it("routes Issue/create to issue.created", async () => {
    const app = await buildApp(deps.orchestrator, deps.idempotencyRepo);

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
  });

  it("routes Issue/update to issue.updated", async () => {
    const app = await buildApp(deps.orchestrator, deps.idempotencyRepo);

    const response = await app.inject({
      method: "POST",
      url: "/webhooks/linear",
      payload: { action: "update", type: "Issue", data: { id: "issue-1" } },
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ ok: true });
    expect(deps.orchestrator.handleLinearWebhook).toHaveBeenCalledWith({
      action: "issue.updated",
      issueId: "issue-1",
    });
  });

  it("parses a recognized slash command on Comment/create and routes comment.command", async () => {
    const app = await buildApp(deps.orchestrator, deps.idempotencyRepo);

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
    expect(deps.orchestrator.handleLinearWebhook).toHaveBeenCalledWith({
      action: "comment.command",
      issueId: "issue-1",
      command: { type: "approve-plan" },
    });
  });

  it("does not invoke the orchestrator for a Comment/create whose body is not a command", async () => {
    const app = await buildApp(deps.orchestrator, deps.idempotencyRepo);

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
    expect(deps.orchestrator.handleLinearWebhook).not.toHaveBeenCalled();
  });

  it("returns ok/ignored for a Comment/create missing body", async () => {
    const app = await buildApp(deps.orchestrator, deps.idempotencyRepo);

    const response = await app.inject({
      method: "POST",
      url: "/webhooks/linear",
      payload: {
        action: "create",
        type: "Comment",
        data: { id: "comment-1", issueId: "issue-1" },
      },
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ ok: true, ignored: true });
    expect(deps.orchestrator.handleLinearWebhook).not.toHaveBeenCalled();
  });

  it("returns ok/ignored for a Comment/create missing issueId", async () => {
    const app = await buildApp(deps.orchestrator, deps.idempotencyRepo);

    const response = await app.inject({
      method: "POST",
      url: "/webhooks/linear",
      payload: {
        action: "create",
        type: "Comment",
        data: { id: "comment-1", body: "/approve-plan" },
      },
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ ok: true, ignored: true });
    expect(deps.orchestrator.handleLinearWebhook).not.toHaveBeenCalled();
  });

  it("returns ok/ignored for an event type/action combination that is not handled", async () => {
    const app = await buildApp(deps.orchestrator, deps.idempotencyRepo);

    const response = await app.inject({
      method: "POST",
      url: "/webhooks/linear",
      payload: { action: "remove", type: "Reaction", data: { id: "reaction-1" } },
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ ok: true, ignored: true });
    expect(deps.orchestrator.handleLinearWebhook).not.toHaveBeenCalled();
  });
});
