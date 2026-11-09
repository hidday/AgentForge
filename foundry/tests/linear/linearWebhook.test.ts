import { describe, it, expect, vi, beforeEach } from "vitest";
import Fastify from "fastify";
import { registerLinearWebhook } from "../../src/linear/linearWebhook.js";
import type { OrchestratorService } from "../../src/orchestrator/orchestratorService.js";
import type { IdempotencyRepository } from "../../src/orchestrator/idempotencyRepository.js";

function buildMocks(tryMarkProcessedResult = true) {
  const orchestrator = {
    handleLinearWebhook: vi.fn().mockResolvedValue(undefined),
  };
  const idempotencyRepo = {
    tryMarkProcessed: vi.fn().mockResolvedValue(tryMarkProcessedResult),
  };
  return { orchestrator, idempotencyRepo };
}

async function buildApp(
  orchestrator: ReturnType<typeof buildMocks>["orchestrator"],
  idempotencyRepo: ReturnType<typeof buildMocks>["idempotencyRepo"],
) {
  const app = Fastify({ logger: false });
  registerLinearWebhook(
    app,
    orchestrator as unknown as OrchestratorService,
    idempotencyRepo as unknown as IdempotencyRepository,
  );
  await app.ready();
  return app;
}

describe("registerLinearWebhook POST /webhooks/linear", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 400 for a payload missing required fields", async () => {
    const { orchestrator, idempotencyRepo } = buildMocks();
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

  it("returns 400 when data.id is missing", async () => {
    const { orchestrator, idempotencyRepo } = buildMocks();
    const app = await buildApp(orchestrator, idempotencyRepo);

    const response = await app.inject({
      method: "POST",
      url: "/webhooks/linear",
      payload: { action: "create", type: "Issue", data: {} },
    });

    expect(response.statusCode).toBe(400);
  });

  it("deduplicates using type:action:id and skips the orchestrator on a duplicate", async () => {
    const { orchestrator, idempotencyRepo } = buildMocks(false);
    const app = await buildApp(orchestrator, idempotencyRepo);

    const response = await app.inject({
      method: "POST",
      url: "/webhooks/linear",
      payload: { action: "create", type: "Issue", data: { id: "issue-1" } },
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ ok: true, duplicate: true });
    expect(idempotencyRepo.tryMarkProcessed).toHaveBeenCalledWith(
      "linear",
      "Issue:create:issue-1",
    );
    expect(orchestrator.handleLinearWebhook).not.toHaveBeenCalled();
  });

  it("handles Issue create as issue.created", async () => {
    const { orchestrator, idempotencyRepo } = buildMocks();
    const app = await buildApp(orchestrator, idempotencyRepo);

    const response = await app.inject({
      method: "POST",
      url: "/webhooks/linear",
      payload: { action: "create", type: "Issue", data: { id: "issue-1", title: "New issue" } },
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ ok: true });
    expect(orchestrator.handleLinearWebhook).toHaveBeenCalledWith({
      action: "issue.created",
      issueId: "issue-1",
    });
  });

  it("handles Issue update as issue.updated", async () => {
    const { orchestrator, idempotencyRepo } = buildMocks();
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

  it("parses a recognized slash command on a new comment and dispatches comment.command", async () => {
    const { orchestrator, idempotencyRepo } = buildMocks();
    const app = await buildApp(orchestrator, idempotencyRepo);

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
    expect(orchestrator.handleLinearWebhook).toHaveBeenCalledWith({
      action: "comment.command",
      issueId: "issue-3",
      command: { type: "approve-plan" },
    });
  });

  it("parses a reject-plan command with a body and forwards it", async () => {
    const { orchestrator, idempotencyRepo } = buildMocks();
    const app = await buildApp(orchestrator, idempotencyRepo);

    const response = await app.inject({
      method: "POST",
      url: "/webhooks/linear",
      payload: {
        action: "create",
        type: "Comment",
        data: { id: "comment-2", issueId: "issue-3", body: "/reject-plan needs more detail" },
      },
    });

    expect(response.statusCode).toBe(200);
    expect(orchestrator.handleLinearWebhook).toHaveBeenCalledWith({
      action: "comment.command",
      issueId: "issue-3",
      command: { type: "reject-plan", body: "needs more detail" },
    });
  });

  it("does not dispatch to the orchestrator for a comment with no recognized command", async () => {
    const { orchestrator, idempotencyRepo } = buildMocks();
    const app = await buildApp(orchestrator, idempotencyRepo);

    const response = await app.inject({
      method: "POST",
      url: "/webhooks/linear",
      payload: {
        action: "create",
        type: "Comment",
        data: { id: "comment-3", issueId: "issue-3", body: "just a regular comment" },
      },
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ ok: true });
    expect(orchestrator.handleLinearWebhook).not.toHaveBeenCalled();
  });

  it("ignores a Comment create event missing a body", async () => {
    const { orchestrator, idempotencyRepo } = buildMocks();
    const app = await buildApp(orchestrator, idempotencyRepo);

    const response = await app.inject({
      method: "POST",
      url: "/webhooks/linear",
      payload: {
        action: "create",
        type: "Comment",
        data: { id: "comment-4", issueId: "issue-3" },
      },
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ ok: true, ignored: true });
    expect(orchestrator.handleLinearWebhook).not.toHaveBeenCalled();
  });

  it("ignores a Comment create event missing an issueId", async () => {
    const { orchestrator, idempotencyRepo } = buildMocks();
    const app = await buildApp(orchestrator, idempotencyRepo);

    const response = await app.inject({
      method: "POST",
      url: "/webhooks/linear",
      payload: {
        action: "create",
        type: "Comment",
        data: { id: "comment-5", body: "/approve-plan" },
      },
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ ok: true, ignored: true });
    expect(orchestrator.handleLinearWebhook).not.toHaveBeenCalled();
  });

  it("ignores an unrecognized action/type combination", async () => {
    const { orchestrator, idempotencyRepo } = buildMocks();
    const app = await buildApp(orchestrator, idempotencyRepo);

    const response = await app.inject({
      method: "POST",
      url: "/webhooks/linear",
      payload: { action: "remove", type: "IssueLabel", data: { id: "label-1" } },
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ ok: true, ignored: true });
    expect(orchestrator.handleLinearWebhook).not.toHaveBeenCalled();
  });
});
