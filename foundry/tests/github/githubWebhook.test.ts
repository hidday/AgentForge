import { describe, it, expect, vi, beforeEach } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { registerGitHubWebhook } from "../../src/github/githubWebhook.js";

function buildApp(): FastifyInstance {
  const app = Fastify({ logger: false });
  const mockOrchestrator = {};
  registerGitHubWebhook(app, mockOrchestrator as never);
  return app;
}

describe("POST /webhooks/github", () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = buildApp();
    await app.ready();
  });

  it("returns 400 when the payload fails schema validation (missing required 'action')", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/webhooks/github",
      payload: { not: "valid" },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: "Invalid webhook payload" });
  });

  it("returns 200 { ok: true } for a minimal valid payload (action only)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/webhooks/github",
      payload: { action: "opened" },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
  });

  it("returns 200 { ok: true } for a full payload with pull_request and repository", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/webhooks/github",
      payload: {
        action: "closed",
        pull_request: { number: 5, state: "closed", merged: true },
        repository: { full_name: "acme/widgets" },
      },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
  });

  it("returns 400 when pull_request.number is the wrong type", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/webhooks/github",
      payload: {
        action: "opened",
        pull_request: { number: "not-a-number", state: "open" },
      },
    });

    expect(res.statusCode).toBe(400);
  });

  it("does not touch the orchestrator (stub handler)", async () => {
    const mockOrchestrator = { someMethod: vi.fn() };
    const app2 = Fastify({ logger: false });
    registerGitHubWebhook(app2, mockOrchestrator as never);
    await app2.ready();

    await app2.inject({
      method: "POST",
      url: "/webhooks/github",
      payload: { action: "opened" },
    });

    expect(mockOrchestrator.someMethod).not.toHaveBeenCalled();
  });
});
