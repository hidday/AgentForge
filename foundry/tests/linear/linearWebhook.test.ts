import { describe, it, expect, vi, beforeEach } from "vitest";
import Fastify from "fastify";
import { registerLinearWebhook } from "../../src/linear/linearWebhook.js";

// `parseLinearCommand` itself is covered exhaustively by
// `linearCommandParser.test.ts`. Here we only verify that this route wires
// it up correctly (dispatches when a command parses, ignores otherwise).

function buildApp() {
  const orchestrator = { handleLinearWebhook: vi.fn().mockResolvedValue(undefined) };
  const idempotencyRepo = { tryMarkProcessed: vi.fn().mockResolvedValue(true) };

  const app = Fastify({ logger: false });
  registerLinearWebhook(app, orchestrator as never, idempotencyRepo as never);

  return { app, orchestrator, idempotencyRepo };
}

describe("POST /webhooks/linear", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 400 for a malformed payload", async () => {
    const { app } = buildApp();
    await app.ready();

    const res = await app.inject({
      method: "POST",
      url: "/webhooks/linear",
      payload: { action: "create" }, // missing `type` and `data`
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: "Invalid webhook payload" });
  });

  it("returns 400 when data.id is missing", async () => {
    const { app } = buildApp();
    await app.ready();

    const res = await app.inject({
      method: "POST",
      url: "/webhooks/linear",
      payload: { action: "create", type: "Issue", data: {} },
    });

    expect(res.statusCode).toBe(400);
  });

  it("dispatches issue.created for an Issue/create event and marks it processed", async () => {
    const { app, orchestrator, idempotencyRepo } = buildApp();
    await app.ready();

    const res = await app.inject({
      method: "POST",
      url: "/webhooks/linear",
      payload: { action: "create", type: "Issue", data: { id: "issue-1", title: "New issue" } },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    expect(idempotencyRepo.tryMarkProcessed).toHaveBeenCalledWith(
      "linear",
      "Issue:create:issue-1",
    );
    expect(orchestrator.handleLinearWebhook).toHaveBeenCalledWith({
      action: "issue.created",
      issueId: "issue-1",
    });
  });

  it("dispatches issue.updated for an Issue/update event", async () => {
    const { app, orchestrator } = buildApp();
    await app.ready();

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

  it("dispatches comment.command when the comment body parses to a known command", async () => {
    const { app, orchestrator } = buildApp();
    await app.ready();

    const res = await app.inject({
      method: "POST",
      url: "/webhooks/linear",
      payload: {
        action: "create",
        type: "Comment",
        data: { id: "comment-1", body: "/approve-plan", issueId: "issue-1" },
      },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    expect(orchestrator.handleLinearWebhook).toHaveBeenCalledWith({
      action: "comment.command",
      issueId: "issue-1",
      command: { type: "approve-plan" },
    });
  });

  it("does not dispatch when the comment body is not a recognized command", async () => {
    const { app, orchestrator } = buildApp();
    await app.ready();

    const res = await app.inject({
      method: "POST",
      url: "/webhooks/linear",
      payload: {
        action: "create",
        type: "Comment",
        data: { id: "comment-2", body: "just a regular comment", issueId: "issue-1" },
      },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    expect(orchestrator.handleLinearWebhook).not.toHaveBeenCalled();
  });

  it("falls through to ignored when a Comment/create event lacks body or issueId", async () => {
    const { app, orchestrator } = buildApp();
    await app.ready();

    const res = await app.inject({
      method: "POST",
      url: "/webhooks/linear",
      payload: { action: "create", type: "Comment", data: { id: "comment-3" } },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, ignored: true });
    expect(orchestrator.handleLinearWebhook).not.toHaveBeenCalled();
  });

  it("returns ignored:true for event types/actions this webhook doesn't handle", async () => {
    const { app, orchestrator } = buildApp();
    await app.ready();

    const res = await app.inject({
      method: "POST",
      url: "/webhooks/linear",
      payload: { action: "remove", type: "Issue", data: { id: "issue-9" } },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, ignored: true });
    expect(orchestrator.handleLinearWebhook).not.toHaveBeenCalled();
  });

  it("returns duplicate:true and skips dispatch when the event was already processed", async () => {
    const { app, orchestrator, idempotencyRepo } = buildApp();
    idempotencyRepo.tryMarkProcessed.mockResolvedValue(false);
    await app.ready();

    const res = await app.inject({
      method: "POST",
      url: "/webhooks/linear",
      payload: { action: "create", type: "Issue", data: { id: "issue-1" } },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, duplicate: true });
    expect(orchestrator.handleLinearWebhook).not.toHaveBeenCalled();
  });

  it("treats the same event delivered twice as a duplicate on the second delivery", async () => {
    const { app, orchestrator, idempotencyRepo } = buildApp();
    // First delivery: newly recorded.
    idempotencyRepo.tryMarkProcessed.mockResolvedValueOnce(true);
    // Second delivery of the identical event: already recorded.
    idempotencyRepo.tryMarkProcessed.mockResolvedValueOnce(false);
    await app.ready();

    const payload = { action: "create", type: "Issue", data: { id: "issue-dup" } };

    const first = await app.inject({ method: "POST", url: "/webhooks/linear", payload });
    const second = await app.inject({ method: "POST", url: "/webhooks/linear", payload });

    expect(first.json()).toEqual({ ok: true });
    expect(second.json()).toEqual({ ok: true, duplicate: true });
    expect(orchestrator.handleLinearWebhook).toHaveBeenCalledTimes(1);
  });
});
