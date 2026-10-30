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
  it("returns 400 for a payload missing the required 'action' field", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/webhooks/github",
      payload: { not_action: "x" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: "Invalid webhook payload" });
  });

  it("accepts a minimal valid payload and acknowledges it", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/webhooks/github",
      payload: { action: "opened" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
  });

  it("accepts a full pull_request payload", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/webhooks/github",
      payload: {
        action: "closed",
        pull_request: { number: 5, state: "closed", merged: true },
        repository: { full_name: "org/repo" },
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
  });
});
