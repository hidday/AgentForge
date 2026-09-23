import { describe, it, expect, vi, beforeEach } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { registerGitHubWebhook } from "../../src/github/githubWebhook.js";
import type { OrchestratorService } from "../../src/orchestrator/orchestratorService.js";

function buildApp(): FastifyInstance {
  const app = Fastify({ logger: false });
  const mockOrchestrator = {} as OrchestratorService;
  registerGitHubWebhook(app, mockOrchestrator);
  return app;
}

describe("registerGitHubWebhook", () => {
  let app: FastifyInstance;

  beforeEach(() => {
    app = buildApp();
  });

  it("returns 400 for a payload missing the required 'action' field", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/webhooks/github",
      payload: { pull_request: { number: 1, state: "open" } },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: "Invalid webhook payload" });
  });

  it("returns 400 when 'action' has the wrong type", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/webhooks/github",
      payload: { action: 123 },
    });

    expect(res.statusCode).toBe(400);
  });

  it("returns 200 for a minimal valid payload (action only)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/webhooks/github",
      payload: { action: "opened" },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
  });

  it("returns 200 for a full pull_request + repository payload", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/webhooks/github",
      payload: {
        action: "closed",
        pull_request: { number: 7, state: "closed", merged: true },
        repository: { full_name: "owner/repo" },
      },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
  });

  it("accepts a payload with pull_request.merged omitted (optional field)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/webhooks/github",
      payload: {
        action: "synchronize",
        pull_request: { number: 3, state: "open" },
      },
    });

    expect(res.statusCode).toBe(200);
  });
});
