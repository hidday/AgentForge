import { describe, it, expect } from "vitest";
import Fastify from "fastify";
import { registerGitHubWebhook } from "../../src/github/githubWebhook.js";
import type { OrchestratorService } from "../../src/orchestrator/orchestratorService.js";

async function buildApp() {
  const app = Fastify();
  // The handler is a stub that never calls into the orchestrator, so an
  // empty object stands in for it without needing to mock its methods.
  registerGitHubWebhook(app, {} as OrchestratorService);
  await app.ready();
  return app;
}

describe("registerGitHubWebhook", () => {
  it("accepts a minimal valid payload and returns ok", async () => {
    const app = await buildApp();

    const response = await app.inject({
      method: "POST",
      url: "/webhooks/github",
      payload: { action: "opened" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true });
  });

  it("accepts a full pull_request payload", async () => {
    const app = await buildApp();

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
    expect(response.json()).toEqual({ ok: true });
  });

  it("rejects a payload missing the required action field", async () => {
    const app = await buildApp();

    const response = await app.inject({
      method: "POST",
      url: "/webhooks/github",
      payload: { pull_request: { number: 1, state: "open" } },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "Invalid webhook payload" });
  });

  it("rejects a payload where pull_request.number has the wrong type", async () => {
    const app = await buildApp();

    const response = await app.inject({
      method: "POST",
      url: "/webhooks/github",
      payload: { action: "opened", pull_request: { number: "not-a-number", state: "open" } },
    });

    expect(response.statusCode).toBe(400);
  });

  it("rejects a body that is valid JSON but the wrong shape (e.g. an array)", async () => {
    const app = await buildApp();

    const response = await app.inject({
      method: "POST",
      url: "/webhooks/github",
      payload: [1, 2, 3],
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "Invalid webhook payload" });
  });

  it("returns an error for a body that fails to parse as JSON at all", async () => {
    const app = await buildApp();

    const response = await app.inject({
      method: "POST",
      url: "/webhooks/github",
      headers: { "content-type": "application/json" },
      payload: "{not valid json",
    });

    expect(response.statusCode).toBeGreaterThanOrEqual(400);
    expect(response.statusCode).toBeLessThan(500);
  });
});
