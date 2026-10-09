import { describe, it, expect } from "vitest";
import Fastify from "fastify";
import { registerGitHubWebhook } from "../../src/github/githubWebhook.js";

async function buildApp() {
  const app = Fastify({ logger: false });
  registerGitHubWebhook(app, {} as never);
  await app.ready();
  return app;
}

describe("registerGitHubWebhook", () => {
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

  it("returns 200 ok for a full valid payload with pull_request and repository", async () => {
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
    expect(JSON.parse(response.body)).toEqual({ ok: true });
  });

  it("accepts a payload without the optional merged field", async () => {
    const app = await buildApp();
    const response = await app.inject({
      method: "POST",
      url: "/webhooks/github",
      payload: {
        action: "synchronize",
        pull_request: { number: 1, state: "open" },
      },
    });
    expect(response.statusCode).toBe(200);
  });

  it("returns 400 when action is missing", async () => {
    const app = await buildApp();
    const response = await app.inject({
      method: "POST",
      url: "/webhooks/github",
      payload: { pull_request: { number: 1, state: "open" } },
    });
    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body)).toEqual({ error: "Invalid webhook payload" });
  });

  it("returns 400 when pull_request.number has the wrong type", async () => {
    const app = await buildApp();
    const response = await app.inject({
      method: "POST",
      url: "/webhooks/github",
      payload: { action: "opened", pull_request: { number: "not-a-number", state: "open" } },
    });
    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body)).toEqual({ error: "Invalid webhook payload" });
  });

  it("returns 400 when repository.full_name is missing", async () => {
    const app = await buildApp();
    const response = await app.inject({
      method: "POST",
      url: "/webhooks/github",
      payload: { action: "opened", repository: {} },
    });
    expect(response.statusCode).toBe(400);
  });

  it("returns 400 for a completely malformed (non-object) JSON body", async () => {
    const app = await buildApp();
    const response = await app.inject({
      method: "POST",
      url: "/webhooks/github",
      headers: { "content-type": "application/json" },
      payload: "42",
    });
    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body)).toEqual({ error: "Invalid webhook payload" });
  });
});
