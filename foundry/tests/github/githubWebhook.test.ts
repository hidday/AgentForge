import { describe, it, expect } from "vitest";
import Fastify from "fastify";
import { registerGitHubWebhook } from "../../src/github/githubWebhook.js";

async function buildApp() {
  const app = Fastify({ logger: false });
  const mockOrchestrator = {};
  registerGitHubWebhook(app, mockOrchestrator as never);
  await app.ready();
  return app;
}

describe("POST /webhooks/github", () => {
  it("returns 200 ok for a minimal valid payload", async () => {
    const app = await buildApp();

    const response = await app.inject({
      method: "POST",
      url: "/webhooks/github",
      payload: { action: "opened" },
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ ok: true });
  });

  it("returns 200 ok for a full pull_request payload", async () => {
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
      payload: { repository: { full_name: "acme/widgets" } },
    });

    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body)).toEqual({ error: "Invalid webhook payload" });
  });

  it("returns 400 when action has the wrong type", async () => {
    const app = await buildApp();

    const response = await app.inject({
      method: "POST",
      url: "/webhooks/github",
      payload: { action: 123 },
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

  it("returns 400 when the body is empty", async () => {
    const app = await buildApp();

    const response = await app.inject({
      method: "POST",
      url: "/webhooks/github",
      payload: {},
    });

    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body)).toEqual({ error: "Invalid webhook payload" });
  });
});
