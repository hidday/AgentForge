import { describe, it, expect } from "vitest";
import Fastify from "fastify";
import { registerGitHubWebhook } from "../../src/github/githubWebhook.js";
import type { OrchestratorService } from "../../src/orchestrator/orchestratorService.js";

async function buildApp() {
  const app = Fastify({ logger: false });
  // registerGitHubWebhook's orchestrator parameter is currently unused (the
  // handler is a stub), so a minimal stand-in is sufficient here.
  const fakeOrchestrator = {} as OrchestratorService;
  registerGitHubWebhook(app, fakeOrchestrator);
  await app.ready();
  return app;
}

describe("registerGitHubWebhook POST /webhooks/github", () => {
  it("returns 200 ok for a minimal valid payload (action only)", async () => {
    const app = await buildApp();

    const response = await app.inject({
      method: "POST",
      url: "/webhooks/github",
      payload: { action: "opened" },
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ ok: true });
  });

  it("returns 200 ok for a full payload including pull_request and repository", async () => {
    const app = await buildApp();

    const response = await app.inject({
      method: "POST",
      url: "/webhooks/github",
      payload: {
        action: "closed",
        pull_request: { number: 42, state: "closed", merged: true },
        repository: { full_name: "acme/widgets" },
      },
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ ok: true });
  });

  it("returns 200 ok when pull_request.merged is omitted (optional field)", async () => {
    const app = await buildApp();

    const response = await app.inject({
      method: "POST",
      url: "/webhooks/github",
      payload: {
        action: "synchronize",
        pull_request: { number: 7, state: "open" },
      },
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ ok: true });
  });

  it("returns 400 when action is missing", async () => {
    const app = await buildApp();

    const response = await app.inject({
      method: "POST",
      url: "/webhooks/github",
      payload: {},
    });

    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body)).toEqual({ error: "Invalid webhook payload" });
  });

  it("returns 400 when pull_request.number has the wrong type", async () => {
    const app = await buildApp();

    const response = await app.inject({
      method: "POST",
      url: "/webhooks/github",
      payload: {
        action: "opened",
        pull_request: { number: "not-a-number", state: "open" },
      },
    });

    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body)).toEqual({ error: "Invalid webhook payload" });
  });

  it("returns 400 when repository.full_name has the wrong type", async () => {
    const app = await buildApp();

    const response = await app.inject({
      method: "POST",
      url: "/webhooks/github",
      payload: {
        action: "opened",
        repository: { full_name: 12345 },
      },
    });

    expect(response.statusCode).toBe(400);
  });

  it("returns 400 when action has the wrong type", async () => {
    const app = await buildApp();

    const response = await app.inject({
      method: "POST",
      url: "/webhooks/github",
      payload: { action: 12345 },
    });

    expect(response.statusCode).toBe(400);
  });
});
