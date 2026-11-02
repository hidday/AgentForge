import { describe, it, expect, vi, beforeEach } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { registerLinearWebhook } from "../../src/linear/linearWebhook.js";

function buildApp(opts: { isNew?: boolean } = {}) {
  const orchestrator = { handleLinearWebhook: vi.fn().mockResolvedValue(undefined) };
  const idempotencyRepo = {
    tryMarkProcessed: vi.fn().mockResolvedValue(opts.isNew ?? true),
  };

  const app = Fastify();
  registerLinearWebhook(app, orchestrator as never, idempotencyRepo as never);

  return { app, orchestrator, idempotencyRepo };
}

describe("registerLinearWebhook", () => {
  let app: FastifyInstance;
  let orchestrator: ReturnType<typeof buildApp>["orchestrator"];
  let idempotencyRepo: ReturnType<typeof buildApp>["idempotencyRepo"];

  beforeEach(async () => {
    const built = buildApp();
    app = built.app;
    orchestrator = built.orchestrator;
    idempotencyRepo = built.idempotencyRepo;
    await app.ready();
  });

  it("returns 400 for a payload failing schema validation", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/webhooks/linear",
      payload: { action: "create" },
    });
    expect(response.statusCode).toBe(400);
  });

  it("short-circuits duplicate events via the idempotency repo", async () => {
    const built = buildApp({ isNew: false });
    await built.app.ready();

    const response = await built.app.inject({
      method: "POST",
      url: "/webhooks/linear",
      payload: { action: "create", type: "Issue", data: { id: "issue-1" } },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true, duplicate: true });
    expect(built.orchestrator.handleLinearWebhook).not.toHaveBeenCalled();
  });

  it("dispatches issue.created for a new Issue/create event", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/webhooks/linear",
      payload: { action: "create", type: "Issue", data: { id: "issue-1" } },
    });

    expect(response.statusCode).toBe(200);
    expect(orchestrator.handleLinearWebhook).toHaveBeenCalledWith({
      action: "issue.created",
      issueId: "issue-1",
    });
    expect(idempotencyRepo.tryMarkProcessed).toHaveBeenCalledWith("linear", "Issue:create:issue-1");
  });

  it("dispatches issue.updated for an Issue/update event", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/webhooks/linear",
      payload: { action: "update", type: "Issue", data: { id: "issue-1" } },
    });

    expect(response.statusCode).toBe(200);
    expect(orchestrator.handleLinearWebhook).toHaveBeenCalledWith({
      action: "issue.updated",
      issueId: "issue-1",
    });
  });

  it("parses and dispatches a recognized slash command from a new comment", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/webhooks/linear",
      payload: {
        action: "create",
        type: "Comment",
        data: { id: "comment-1", issueId: "issue-1", body: "/approve" },
      },
    });

    expect(response.statusCode).toBe(200);
    expect(orchestrator.handleLinearWebhook).toHaveBeenCalledWith({
      action: "comment.command",
      issueId: "issue-1",
      command: expect.anything(),
    });
  });

  it("does not dispatch a command for comment bodies with no recognized command", async () => {
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
    expect(orchestrator.handleLinearWebhook).not.toHaveBeenCalled();
  });

  it("ignores comment events missing a body or issueId", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/webhooks/linear",
      payload: { action: "create", type: "Comment", data: { id: "comment-1" } },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true, ignored: true });
    expect(orchestrator.handleLinearWebhook).not.toHaveBeenCalled();
  });

  it("returns ignored:true for unrecognized type/action combinations", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/webhooks/linear",
      payload: { action: "remove", type: "Issue", data: { id: "issue-1" } },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true, ignored: true });
    expect(orchestrator.handleLinearWebhook).not.toHaveBeenCalled();
  });
});
