import { describe, it, expect, vi } from "vitest";
import Fastify from "fastify";
import { registerLinearWebhook } from "../../src/linear/linearWebhook.js";

function buildDeps() {
  const mockOrchestrator = { handleLinearWebhook: vi.fn().mockResolvedValue(undefined) };
  const mockIdempotencyRepo = { tryMarkProcessed: vi.fn().mockResolvedValue(true) };
  return { mockOrchestrator, mockIdempotencyRepo };
}

async function buildApp(
  mockOrchestrator: ReturnType<typeof buildDeps>["mockOrchestrator"],
  mockIdempotencyRepo: ReturnType<typeof buildDeps>["mockIdempotencyRepo"],
) {
  const app = Fastify({ logger: false });
  registerLinearWebhook(app, mockOrchestrator as never, mockIdempotencyRepo as never);
  await app.ready();
  return app;
}

describe("POST /webhooks/linear", () => {
  it("returns 400 for a payload missing required fields", async () => {
    const { mockOrchestrator, mockIdempotencyRepo } = buildDeps();
    const app = await buildApp(mockOrchestrator, mockIdempotencyRepo);

    const response = await app.inject({
      method: "POST",
      url: "/webhooks/linear",
      payload: { action: "create" },
    });

    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body)).toEqual({ error: "Invalid webhook payload" });
    expect(mockIdempotencyRepo.tryMarkProcessed).not.toHaveBeenCalled();
  });

  it("returns 400 when data.id is missing", async () => {
    const { mockOrchestrator, mockIdempotencyRepo } = buildDeps();
    const app = await buildApp(mockOrchestrator, mockIdempotencyRepo);

    const response = await app.inject({
      method: "POST",
      url: "/webhooks/linear",
      payload: { action: "create", type: "Issue", data: {} },
    });

    expect(response.statusCode).toBe(400);
  });

  it("returns 200 with duplicate:true and skips the orchestrator on a duplicate event", async () => {
    const { mockOrchestrator, mockIdempotencyRepo } = buildDeps();
    mockIdempotencyRepo.tryMarkProcessed.mockResolvedValue(false);
    const app = await buildApp(mockOrchestrator, mockIdempotencyRepo);

    const response = await app.inject({
      method: "POST",
      url: "/webhooks/linear",
      payload: { action: "create", type: "Issue", data: { id: "issue-1" } },
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ ok: true, duplicate: true });
    expect(mockOrchestrator.handleLinearWebhook).not.toHaveBeenCalled();
  });

  it("dedupes using type:action:id and marks new events as processed", async () => {
    const { mockOrchestrator, mockIdempotencyRepo } = buildDeps();
    const app = await buildApp(mockOrchestrator, mockIdempotencyRepo);

    await app.inject({
      method: "POST",
      url: "/webhooks/linear",
      payload: { action: "create", type: "Issue", data: { id: "issue-1" } },
    });

    expect(mockIdempotencyRepo.tryMarkProcessed).toHaveBeenCalledWith(
      "linear",
      "Issue:create:issue-1",
    );
  });

  it("handles Issue/create by notifying the orchestrator with issue.created", async () => {
    const { mockOrchestrator, mockIdempotencyRepo } = buildDeps();
    const app = await buildApp(mockOrchestrator, mockIdempotencyRepo);

    const response = await app.inject({
      method: "POST",
      url: "/webhooks/linear",
      payload: { action: "create", type: "Issue", data: { id: "issue-1" } },
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ ok: true });
    expect(mockOrchestrator.handleLinearWebhook).toHaveBeenCalledWith({
      action: "issue.created",
      issueId: "issue-1",
    });
  });

  it("handles Issue/update by notifying the orchestrator with issue.updated", async () => {
    const { mockOrchestrator, mockIdempotencyRepo } = buildDeps();
    const app = await buildApp(mockOrchestrator, mockIdempotencyRepo);

    const response = await app.inject({
      method: "POST",
      url: "/webhooks/linear",
      payload: { action: "update", type: "Issue", data: { id: "issue-2" } },
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ ok: true });
    expect(mockOrchestrator.handleLinearWebhook).toHaveBeenCalledWith({
      action: "issue.updated",
      issueId: "issue-2",
    });
  });

  it("parses a recognized slash command from a new comment and forwards it", async () => {
    const { mockOrchestrator, mockIdempotencyRepo } = buildDeps();
    const app = await buildApp(mockOrchestrator, mockIdempotencyRepo);

    const response = await app.inject({
      method: "POST",
      url: "/webhooks/linear",
      payload: {
        action: "create",
        type: "Comment",
        data: { id: "comment-1", body: "/ai-plan", issueId: "issue-1" },
      },
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ ok: true });
    expect(mockOrchestrator.handleLinearWebhook).toHaveBeenCalledWith({
      action: "comment.command",
      issueId: "issue-1",
      command: { type: "ai-plan" },
    });
  });

  it("returns ok without forwarding when the comment has no recognizable command", async () => {
    const { mockOrchestrator, mockIdempotencyRepo } = buildDeps();
    const app = await buildApp(mockOrchestrator, mockIdempotencyRepo);

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
    expect(mockOrchestrator.handleLinearWebhook).not.toHaveBeenCalled();
  });

  it("returns ignored:true for a Comment/create event missing a body", async () => {
    const { mockOrchestrator, mockIdempotencyRepo } = buildDeps();
    const app = await buildApp(mockOrchestrator, mockIdempotencyRepo);

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
    expect(mockOrchestrator.handleLinearWebhook).not.toHaveBeenCalled();
  });

  it("returns ignored:true for a Comment/create event missing an issueId", async () => {
    const { mockOrchestrator, mockIdempotencyRepo } = buildDeps();
    const app = await buildApp(mockOrchestrator, mockIdempotencyRepo);

    const response = await app.inject({
      method: "POST",
      url: "/webhooks/linear",
      payload: {
        action: "create",
        type: "Comment",
        data: { id: "comment-1", body: "/ai-plan" },
      },
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ ok: true, ignored: true });
    expect(mockOrchestrator.handleLinearWebhook).not.toHaveBeenCalled();
  });

  it("returns ignored:true for an unhandled type/action combination", async () => {
    const { mockOrchestrator, mockIdempotencyRepo } = buildDeps();
    const app = await buildApp(mockOrchestrator, mockIdempotencyRepo);

    const response = await app.inject({
      method: "POST",
      url: "/webhooks/linear",
      payload: { action: "remove", type: "Issue", data: { id: "issue-1" } },
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ ok: true, ignored: true });
    expect(mockOrchestrator.handleLinearWebhook).not.toHaveBeenCalled();
  });
});
