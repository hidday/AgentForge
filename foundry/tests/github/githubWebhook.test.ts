import { describe, it, expect } from "vitest";
import Fastify from "fastify";
import { registerGitHubWebhook } from "../../src/github/githubWebhook.js";

function buildApp() {
  const app = Fastify();
  const mockOrchestrator = {};
  registerGitHubWebhook(app, mockOrchestrator as never);
  return app;
}

describe("POST /webhooks/github", () => {
  it("returns 200 { ok: true } for a valid payload with just an action", async () => {
    const app = buildApp();

    const res = await app.inject({
      method: "POST",
      url: "/webhooks/github",
      payload: { action: "opened" },
    });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ ok: true });
  });

  it("returns 400 { error: 'Invalid webhook payload' } when 'action' is missing", async () => {
    const app = buildApp();

    const res = await app.inject({
      method: "POST",
      url: "/webhooks/github",
      payload: { pull_request: { number: 1, state: "open" } },
    });

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body)).toEqual({ error: "Invalid webhook payload" });
  });

  it("returns 200 for a payload that also includes optional pull_request and repository sub-objects", async () => {
    const app = buildApp();

    const res = await app.inject({
      method: "POST",
      url: "/webhooks/github",
      payload: {
        action: "closed",
        pull_request: { number: 42, state: "closed", merged: true },
        repository: { full_name: "owner/repo" },
      },
    });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ ok: true });
  });
});
