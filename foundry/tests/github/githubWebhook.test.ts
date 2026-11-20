import { describe, it, expect, beforeEach } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { registerGitHubWebhook } from "../../src/github/githubWebhook.js";

describe("registerGitHubWebhook", () => {
  let app: FastifyInstance;

  beforeEach(() => {
    app = Fastify();
    // The handler's orchestrator argument is currently unused (stub route),
    // so an empty object cast is sufficient to exercise the real behavior.
    registerGitHubWebhook(app, {} as never);
  });

  it("returns 200 ok for a minimal valid payload (action only)", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/webhooks/github",
      payload: { action: "opened" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true });
  });

  it("returns 200 ok for a full payload with pull_request and repository", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/webhooks/github",
      payload: {
        action: "closed",
        pull_request: { number: 42, state: "closed", merged: true },
        repository: { full_name: "acme/repo" },
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true });
  });

  it("returns 200 ok when merged is omitted on pull_request (optional field)", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/webhooks/github",
      payload: {
        action: "synchronize",
        pull_request: { number: 7, state: "open" },
      },
    });

    expect(response.statusCode).toBe(200);
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

  it("returns 400 when pull_request.number has the wrong type", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/webhooks/github",
      payload: { action: "opened", pull_request: { number: "not-a-number", state: "open" } },
    });

    expect(response.statusCode).toBe(400);
  });

  it("returns 400 for a completely empty body", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/webhooks/github",
      payload: {},
    });

    expect(response.statusCode).toBe(400);
  });
});
