import { describe, it, expect } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { registerGitHubWebhook } from "../../src/github/githubWebhook.js";
import type { OrchestratorService } from "../../src/orchestrator/orchestratorService.js";

function buildApp(): FastifyInstance {
  const app = Fastify({ logger: false });
  const fakeOrchestrator = {} as OrchestratorService;
  registerGitHubWebhook(app, fakeOrchestrator);
  return app;
}

describe("registerGitHubWebhook", () => {
  it("returns 200 ok for a minimal valid payload (action only)", async () => {
    const app = buildApp();
    const response = await app.inject({
      method: "POST",
      url: "/webhooks/github",
      payload: { action: "opened" },
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ ok: true });
  });

  it("returns 200 ok for a full PR event payload", async () => {
    const app = buildApp();
    const response = await app.inject({
      method: "POST",
      url: "/webhooks/github",
      payload: {
        action: "closed",
        pull_request: { number: 42, state: "closed", merged: true },
        repository: { full_name: "org/repo" },
      },
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ ok: true });
  });

  it("accepts a payload where pull_request.merged is omitted (optional field)", async () => {
    const app = buildApp();
    const response = await app.inject({
      method: "POST",
      url: "/webhooks/github",
      payload: {
        action: "synchronize",
        pull_request: { number: 7, state: "open" },
      },
    });

    expect(response.statusCode).toBe(200);
  });

  it("returns 400 when the body is missing the required 'action' field", async () => {
    const app = buildApp();
    const response = await app.inject({
      method: "POST",
      url: "/webhooks/github",
      payload: { pull_request: { number: 1, state: "open" } },
    });

    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body)).toEqual({ error: "Invalid webhook payload" });
  });

  it("returns 400 when 'action' has the wrong type", async () => {
    const app = buildApp();
    const response = await app.inject({
      method: "POST",
      url: "/webhooks/github",
      payload: { action: 123 },
    });

    expect(response.statusCode).toBe(400);
  });

  it("returns 400 when pull_request.number is the wrong type", async () => {
    const app = buildApp();
    const response = await app.inject({
      method: "POST",
      url: "/webhooks/github",
      payload: { action: "opened", pull_request: { number: "not-a-number", state: "open" } },
    });

    expect(response.statusCode).toBe(400);
  });

  it("returns 400 for a completely empty body", async () => {
    const app = buildApp();
    const response = await app.inject({
      method: "POST",
      url: "/webhooks/github",
      payload: {},
    });

    expect(response.statusCode).toBe(400);
  });
});
