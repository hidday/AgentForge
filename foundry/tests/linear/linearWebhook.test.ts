import { describe, it, expect, vi, beforeEach } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { registerLinearWebhook } from "../../src/linear/linearWebhook.js";
import type { OrchestratorService } from "../../src/orchestrator/orchestratorService.js";
import type { IdempotencyRepository } from "../../src/orchestrator/idempotencyRepository.js";

function makeOrchestrator() {
  return { handleLinearWebhook: vi.fn().mockResolvedValue(undefined) };
}

function makeIdempotencyRepo(tryMarkProcessed: (...args: unknown[]) => Promise<boolean>) {
  return { tryMarkProcessed: vi.fn(tryMarkProcessed) };
}

async function buildApp(
  orchestrator: ReturnType<typeof makeOrchestrator>,
  idempotencyRepo: ReturnType<typeof makeIdempotencyRepo>,
): Promise<FastifyInstance> {
  const app = Fastify();
  registerLinearWebhook(
    app,
    orchestrator as unknown as OrchestratorService,
    idempotencyRepo as unknown as IdempotencyRepository,
  );
  await app.ready();
  return app;
}

describe("registerLinearWebhook", () => {
  let orchestrator: ReturnType<typeof makeOrchestrator>;
  let idempotencyRepo: ReturnType<typeof makeIdempotencyRepo>;

  beforeEach(() => {
    orchestrator = makeOrchestrator();
    idempotencyRepo = makeIdempotencyRepo(() => Promise.resolve(true));
  });

  it("returns 400 for a payload missing required fields", async () => {
    const app = await buildApp(orchestrator, idempotencyRepo);

    const res = await app.inject({
      method: "POST",
      url: "/webhooks/linear",
      payload: { action: "create" },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: "Invalid webhook payload" });
    expect(orchestrator.handleLinearWebhook).not.toHaveBeenCalled();
  });

  it("dedupes using type:action:id and skips orchestrator dispatch on a duplicate", async () => {
    idempotencyRepo = makeIdempotencyRepo(() => Promise.resolve(false));
    const app = await buildApp(orchestrator, idempotencyRepo);

    const res = await app.inject({
      method: "POST",
      url: "/webhooks/linear",
      payload: { action: "create", type: "Issue", data: { id: "issue-1" } },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, duplicate: true });
    expect(idempotencyRepo.tryMarkProcessed).toHaveBeenCalledWith("linear", "Issue:create:issue-1");
    expect(orchestrator.handleLinearWebhook).not.toHaveBeenCalled();
  });

  it("dispatches issue.created for a new Issue/create event", async () => {
    const app = await buildApp(orchestrator, idempotencyRepo);

    const res = await app.inject({
      method: "POST",
      url: "/webhooks/linear",
      payload: { action: "create", type: "Issue", data: { id: "issue-1" } },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    expect(orchestrator.handleLinearWebhook).toHaveBeenCalledWith({
      action: "issue.created",
      issueId: "issue-1",
    });
  });

  it("dispatches issue.updated for an Issue/update event", async () => {
    const app = await buildApp(orchestrator, idempotencyRepo);

    const res = await app.inject({
      method: "POST",
      url: "/webhooks/linear",
      payload: { action: "update", type: "Issue", data: { id: "issue-2" } },
    });

    expect(res.statusCode).toBe(200);
    expect(orchestrator.handleLinearWebhook).toHaveBeenCalledWith({
      action: "issue.updated",
      issueId: "issue-2",
    });
  });

  it("dispatches comment.command with the parsed command for a recognized slash command comment", async () => {
    const app = await buildApp(orchestrator, idempotencyRepo);

    const res = await app.inject({
      method: "POST",
      url: "/webhooks/linear",
      payload: {
        action: "create",
        type: "Comment",
        data: { id: "comment-1", issueId: "issue-3", body: "/approve-plan" },
      },
    });

    expect(res.statusCode).toBe(200);
    expect(orchestrator.handleLinearWebhook).toHaveBeenCalledWith({
      action: "comment.command",
      issueId: "issue-3",
      command: { type: "approve-plan" },
    });
  });

  it("does not dispatch for a Comment/create event whose body has no recognized command", async () => {
    const app = await buildApp(orchestrator, idempotencyRepo);

    const res = await app.inject({
      method: "POST",
      url: "/webhooks/linear",
      payload: {
        action: "create",
        type: "Comment",
        data: { id: "comment-2", issueId: "issue-3", body: "just a regular comment" },
      },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    expect(orchestrator.handleLinearWebhook).not.toHaveBeenCalled();
  });

  it("does not dispatch a Comment/create event missing a body or issueId", async () => {
    const app = await buildApp(orchestrator, idempotencyRepo);

    const res = await app.inject({
      method: "POST",
      url: "/webhooks/linear",
      payload: {
        action: "create",
        type: "Comment",
        data: { id: "comment-3" },
      },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, ignored: true });
    expect(orchestrator.handleLinearWebhook).not.toHaveBeenCalled();
  });

  it("returns ignored:true for an unrecognized type/action combination", async () => {
    const app = await buildApp(orchestrator, idempotencyRepo);

    const res = await app.inject({
      method: "POST",
      url: "/webhooks/linear",
      payload: { action: "remove", type: "Issue", data: { id: "issue-9" } },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, ignored: true });
    expect(orchestrator.handleLinearWebhook).not.toHaveBeenCalled();
  });
});
