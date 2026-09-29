import { describe, it, expect, vi } from "vitest";
import Fastify from "fastify";
import { registerGitHubWebhook } from "../../src/github/githubWebhook.js";

function buildApp() {
  const mockOrchestrator = {};
  const app = Fastify({ logger: false });
  registerGitHubWebhook(app, mockOrchestrator as never);
  return { app };
}

describe("POST /webhooks/github", () => {
  it("returns 400 for a payload missing the required action field", async () => {
    const { app } = buildApp();

    const response = await app.inject({
      method: "POST",
      url: "/webhooks/github",
      payload: { pull_request: { number: 1, state: "open" } },
    });

    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body)).toEqual({ error: "Invalid webhook payload" });
  });

  it("returns 400 when pull_request is present but malformed", async () => {
    const { app } = buildApp();

    const response = await app.inject({
      method: "POST",
      url: "/webhooks/github",
      payload: { action: "opened", pull_request: { number: "not-a-number" } },
    });

    expect(response.statusCode).toBe(400);
  });

  it("returns 200 ok for a minimal valid payload with only action", async () => {
    const { app } = buildApp();

    const response = await app.inject({
      method: "POST",
      url: "/webhooks/github",
      payload: { action: "opened" },
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ ok: true });
  });

  it("returns 200 ok for a full valid payload including pull_request and repository", async () => {
    const { app } = buildApp();

    const response = await app.inject({
      method: "POST",
      url: "/webhooks/github",
      payload: {
        action: "closed",
        pull_request: { number: 42, state: "closed", merged: true },
        repository: { full_name: "owner/repo" },
      },
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ ok: true });
  });
});
