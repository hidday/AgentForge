import { describe, it, expect, vi } from "vitest";
import Fastify from "fastify";
import { registerLinearWebhook } from "../../src/linear/linearWebhook.js";
import type { OrchestratorService } from "../../src/orchestrator/orchestratorService.js";
import type { IdempotencyRepository } from "../../src/orchestrator/idempotencyRepository.js";

function buildDeps() {
  const mockOrchestrator = {
    handleLinearWebhook: vi.fn().mockResolvedValue(undefined),
  };
  const mockIdempotencyRepo = {
    tryMarkProcessed: vi.fn().mockResolvedValue(true),
  };
  return { mockOrchestrator, mockIdempotencyRepo };
}

async function buildApp(
  mockOrchestrator: ReturnType<typeof buildDeps>["mockOrchestrator"],
  mockIdempotencyRepo: ReturnType<typeof buildDeps>["mockIdempotencyRepo"],
) {
  const app = Fastify({ logger: false });
  registerLinearWebhook(
    app,
    mockOrchestrator as unknown as OrchestratorService,
    mockIdempotencyRepo as unknown as IdempotencyRepository,
  );
  await app.ready();
  return app;
}

describe("registerLinearWebhook POST /webhooks/linear", () => {
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

  it("returns 200 with duplicate:true and skips the orchestrator when the event was already processed", async () => {
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

  it("handles Issue create by dispatching issue.created", async () => {
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

  it("handles Issue update by dispatching issue.updated", async () => {
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

  it("parses a recognized slash command from a Comment create and dispatches comment.command", async () => {
    const { mockOrchestrator, mockIdempotencyRepo } = buildDeps();
    const app = await buildApp(mockOrchestrator, mockIdempotencyRepo);

    const response = await app.inject({
      method: "POST",
      url: "/webhooks/linear",
      payload: {
        action: "create",
        type: "Comment",
        data: { id: "comment-1", body: "/approve-plan", issueId: "issue-3" },
      },
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ ok: true });
    expect(mockOrchestrator.handleLinearWebhook).toHaveBeenCalledWith({
      action: "comment.command",
      issueId: "issue-3",
      command: { type: "approve-plan" },
    });
  });

  it("does not dispatch to the orchestrator when a Comment body has no recognized command", async () => {
    const { mockOrchestrator, mockIdempotencyRepo } = buildDeps();
    const app = await buildApp(mockOrchestrator, mockIdempotencyRepo);

    const response = await app.inject({
      method: "POST",
      url: "/webhooks/linear",
      payload: {
        action: "create",
        type: "Comment",
        data: { id: "comment-2", body: "just a regular comment", issueId: "issue-3" },
      },
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ ok: true });
    expect(mockOrchestrator.handleLinearWebhook).not.toHaveBeenCalled();
  });

  it("returns ok without dispatching when a Comment create is missing body", async () => {
    const { mockOrchestrator, mockIdempotencyRepo } = buildDeps();
    const app = await buildApp(mockOrchestrator, mockIdempotencyRepo);

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
    expect(mockOrchestrator.handleLinearWebhook).not.toHaveBeenCalled();
  });

  it("returns ok without dispatching when a Comment create is missing issueId", async () => {
    const { mockOrchestrator, mockIdempotencyRepo } = buildDeps();
    const app = await buildApp(mockOrchestrator, mockIdempotencyRepo);

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
    expect(mockOrchestrator.handleLinearWebhook).not.toHaveBeenCalled();
  });

  it("returns ok with ignored:true for an unrecognized type/action combination", async () => {
    const { mockOrchestrator, mockIdempotencyRepo } = buildDeps();
    const app = await buildApp(mockOrchestrator, mockIdempotencyRepo);

    const response = await app.inject({
      method: "POST",
      url: "/webhooks/linear",
      payload: {
        action: "remove",
        type: "Project",
        data: { id: "project-1" },
      },
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ ok: true, ignored: true });
    expect(mockOrchestrator.handleLinearWebhook).not.toHaveBeenCalled();
  });

  it("uses type:action:id as the dedupe key passed to the idempotency repo", async () => {
    const { mockOrchestrator, mockIdempotencyRepo } = buildDeps();
    const app = await buildApp(mockOrchestrator, mockIdempotencyRepo);

    await app.inject({
      method: "POST",
      url: "/webhooks/linear",
      payload: { action: "create", type: "Issue", data: { id: "issue-9" } },
    });

    expect(mockIdempotencyRepo.tryMarkProcessed).toHaveBeenCalledWith(
      "linear",
      "Issue:create:issue-9",
    );
  });
});
