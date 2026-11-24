import { describe, it, expect, afterEach } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { registerGitHubWebhook } from "../../src/github/githubWebhook.js";

describe("registerGitHubWebhook", () => {
  let app: FastifyInstance;

  afterEach(async () => {
    await app?.close();
  });

  it("returns 200 for a valid webhook payload", async () => {
    app = Fastify();
    registerGitHubWebhook(app, {} as never);

    const response = await app.inject({
      method: "POST",
      url: "/webhooks/github",
      payload: {
        action: "opened",
        pull_request: { number: 1, state: "open", merged: false },
        repository: { full_name: "org/repo" },
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true });
  });

  it("returns 200 for a minimal payload with only the required action field", async () => {
    app = Fastify();
    registerGitHubWebhook(app, {} as never);

    const response = await app.inject({
      method: "POST",
      url: "/webhooks/github",
      payload: { action: "ping" },
    });

    expect(response.statusCode).toBe(200);
  });

  it("returns 400 for a payload missing the required action field", async () => {
    app = Fastify();
    registerGitHubWebhook(app, {} as never);

    const response = await app.inject({
      method: "POST",
      url: "/webhooks/github",
      payload: { pull_request: { number: 1, state: "open" } },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "Invalid webhook payload" });
  });
});
