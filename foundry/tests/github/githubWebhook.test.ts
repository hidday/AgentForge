import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { registerGitHubWebhook } from "../../src/github/githubWebhook.js";
import type { OrchestratorService } from "../../src/orchestrator/orchestratorService.js";

describe("registerGitHubWebhook", () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = Fastify({ logger: false });
    registerGitHubWebhook(app, {} as never as OrchestratorService);
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it("returns 200 { ok: true } for a valid payload with pull_request and repository", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/webhooks/github",
      payload: {
        action: "opened",
        pull_request: { number: 1, state: "open" },
        repository: { full_name: "x/y" },
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true });
  });

  it("returns 200 { ok: true } for a minimal valid payload with no pull_request or repository", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/webhooks/github",
      payload: { action: "ping" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true });
  });

  it("returns 400 { error: 'Invalid webhook payload' } when action is missing", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/webhooks/github",
      payload: {
        pull_request: { number: 1, state: "open" },
        repository: { full_name: "x/y" },
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "Invalid webhook payload" });
  });

  it("returns 400 when pull_request is present but malformed", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/webhooks/github",
      payload: {
        action: "opened",
        pull_request: { number: "not-a-number", state: "open" },
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "Invalid webhook payload" });
  });
});
