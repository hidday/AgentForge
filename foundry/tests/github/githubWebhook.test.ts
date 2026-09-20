import { describe, it, expect, vi } from "vitest";
import Fastify from "fastify";
import { registerGitHubWebhook } from "../../src/github/githubWebhook.js";

async function buildApp() {
  const orchestrator = {};
  const app = Fastify({ logger: false });
  registerGitHubWebhook(app, orchestrator as never);
  await app.ready();
  return { app };
}

describe("POST /webhooks/github", () => {
  it("returns 400 for a payload missing the required action field", async () => {
    const { app } = await buildApp();

    const response = await app.inject({
      method: "POST",
      url: "/webhooks/github",
      payload: { pull_request: { number: 1, state: "open" } },
    });

    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body)).toEqual({ error: "Invalid webhook payload" });
  });

  it("returns 400 when pull_request.number is the wrong type", async () => {
    const { app } = await buildApp();

    const response = await app.inject({
      method: "POST",
      url: "/webhooks/github",
      payload: { action: "closed", pull_request: { number: "not-a-number", state: "closed" } },
    });

    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body)).toEqual({ error: "Invalid webhook payload" });
  });

  it("returns 200 for a minimal valid payload with no optional fields", async () => {
    const { app } = await buildApp();

    const response = await app.inject({
      method: "POST",
      url: "/webhooks/github",
      payload: { action: "ping" },
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ ok: true });
  });

  it("returns 200 for a full valid payload including pull_request and repository", async () => {
    const { app } = await buildApp();

    const response = await app.inject({
      method: "POST",
      url: "/webhooks/github",
      payload: {
        action: "closed",
        pull_request: { number: 12, state: "closed", merged: true },
        repository: { full_name: "owner/repo" },
      },
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ ok: true });
  });
});
