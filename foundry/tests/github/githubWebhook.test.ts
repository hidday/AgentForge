import { describe, it, expect, beforeEach } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { registerGitHubWebhook } from "../../src/github/githubWebhook.js";

describe("registerGitHubWebhook", () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = Fastify();
    registerGitHubWebhook(app, {} as never);
    await app.ready();
  });

  it("returns 400 for a payload missing the required action field", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/webhooks/github",
      payload: { pull_request: { number: 1, state: "open" } },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "Invalid webhook payload" });
  });

  it("accepts a minimal valid payload with only an action", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/webhooks/github",
      payload: { action: "opened" },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true });
  });

  it("accepts a full pull_request payload", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/webhooks/github",
      payload: {
        action: "closed",
        pull_request: { number: 42, state: "closed", merged: true },
        repository: { full_name: "acme/backend" },
      },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true });
  });
});
