import { describe, it, expect } from "vitest";
import Fastify from "fastify";
import { registerGitHubWebhook } from "../../src/github/githubWebhook.js";

function buildApp() {
  const app = Fastify({ logger: false });
  registerGitHubWebhook(app, {} as never);
  return app;
}

describe("POST /webhooks/github", () => {
  it("returns 400 when the payload fails schema validation", async () => {
    const app = buildApp();
    const response = await app.inject({
      method: "POST",
      url: "/webhooks/github",
      payload: { not: "a valid payload" },
    });
    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body)).toEqual({ error: "Invalid webhook payload" });
  });

  it("returns 200 ok for a minimal valid payload (action only)", async () => {
    const app = buildApp();
    const response = await app.inject({
      method: "POST",
      url: "/webhooks/github",
      payload: { action: "opened" },
    });
    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ ok: true });
  });

  it("returns 200 ok for a full pull_request payload", async () => {
    const app = buildApp();
    const response = await app.inject({
      method: "POST",
      url: "/webhooks/github",
      payload: {
        action: "closed",
        pull_request: { number: 7, state: "closed", merged: true },
        repository: { full_name: "acme/repo" },
      },
    });
    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ ok: true });
  });

  it("returns 400 when pull_request.number is missing but pull_request object is present", async () => {
    const app = buildApp();
    const response = await app.inject({
      method: "POST",
      url: "/webhooks/github",
      payload: { action: "edited", pull_request: { state: "open" } },
    });
    expect(response.statusCode).toBe(400);
  });
});
