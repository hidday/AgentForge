import { describe, it, expect } from "vitest";
import Fastify from "fastify";
import { registerGitHubWebhook } from "../../src/github/githubWebhook.js";
import type { OrchestratorService } from "../../src/orchestrator/orchestratorService.js";

async function buildApp() {
  const app = Fastify({ logger: false });
  // The handler is currently a stub that never calls the orchestrator, but we
  // pass a typed stand-in so the test still exercises the real signature.
  registerGitHubWebhook(app, {} as OrchestratorService);
  await app.ready();
  return app;
}

describe("POST /webhooks/github", () => {
  it("returns 400 with an error message when the payload fails schema validation", async () => {
    const app = await buildApp();

    const response = await app.inject({
      method: "POST",
      url: "/webhooks/github",
      payload: { not: "a valid payload" },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "Invalid webhook payload" });
  });

  it("returns 400 when action is missing entirely", async () => {
    const app = await buildApp();

    const response = await app.inject({
      method: "POST",
      url: "/webhooks/github",
      payload: { pull_request: { number: 1, state: "open" } },
    });

    expect(response.statusCode).toBe(400);
  });

  it("returns 400 when pull_request is present but missing required fields", async () => {
    const app = await buildApp();

    const response = await app.inject({
      method: "POST",
      url: "/webhooks/github",
      payload: { action: "opened", pull_request: { number: 1 } },
    });

    expect(response.statusCode).toBe(400);
  });

  it("returns 200 ok for a minimal valid payload with only 'action'", async () => {
    const app = await buildApp();

    const response = await app.inject({
      method: "POST",
      url: "/webhooks/github",
      payload: { action: "opened" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true });
  });

  it("returns 200 ok for a full valid payload including pull_request and repository", async () => {
    const app = await buildApp();

    const response = await app.inject({
      method: "POST",
      url: "/webhooks/github",
      payload: {
        action: "closed",
        pull_request: { number: 42, state: "closed", merged: true },
        repository: { full_name: "octo/repo" },
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true });
  });

  it("accepts pull_request without the optional 'merged' field", async () => {
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
    expect(response.json()).toEqual({ ok: true });
  });
});
