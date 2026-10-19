import { describe, it, expect } from "vitest";
import Fastify from "fastify";
import { registerGitHubWebhook } from "../../src/github/githubWebhook.js";

function buildApp() {
  const app = Fastify({ logger: false });
  registerGitHubWebhook(app, {} as never);
  return app;
}

describe("registerGitHubWebhook POST /webhooks/github", () => {
  it("returns 400 for a payload missing the required 'action' field", async () => {
    const app = buildApp();
    await app.ready();
    const response = await app.inject({
      method: "POST",
      url: "/webhooks/github",
      payload: { pull_request: { number: 1, state: "open" } },
    });
    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body)).toEqual({ error: "Invalid webhook payload" });
  });

  it("returns 200 for a minimal valid payload with only 'action'", async () => {
    const app = buildApp();
    await app.ready();
    const response = await app.inject({
      method: "POST",
      url: "/webhooks/github",
      payload: { action: "opened" },
    });
    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ ok: true });
  });

  it("returns 200 for a full pull_request event payload", async () => {
    const app = buildApp();
    await app.ready();
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
