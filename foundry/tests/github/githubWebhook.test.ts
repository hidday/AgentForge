import { describe, it, expect, vi, beforeEach } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { registerGitHubWebhook } from "../../src/github/githubWebhook.js";

function buildApp(): { app: FastifyInstance } {
  const mockOrchestrator = {};
  const app = Fastify({ logger: false });
  registerGitHubWebhook(app, mockOrchestrator as never);
  return { app };
}

describe("POST /webhooks/github", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 400 for a payload missing the required action field", async () => {
    const { app } = buildApp();

    const res = await app.inject({
      method: "POST",
      url: "/webhooks/github",
      payload: { pull_request: { number: 1, state: "open" } },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: "Invalid webhook payload" });
  });

  it("returns 400 for a malformed payload (wrong field types)", async () => {
    const { app } = buildApp();

    const res = await app.inject({
      method: "POST",
      url: "/webhooks/github",
      payload: { action: "opened", pull_request: { number: "not-a-number", state: "open" } },
    });

    expect(res.statusCode).toBe(400);
  });

  it("returns 200 ok for a minimal valid payload with only action set", async () => {
    const { app } = buildApp();

    const res = await app.inject({
      method: "POST",
      url: "/webhooks/github",
      payload: { action: "opened" },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
  });

  it("returns 200 ok for a full payload including pull_request and repository", async () => {
    const { app } = buildApp();

    const res = await app.inject({
      method: "POST",
      url: "/webhooks/github",
      payload: {
        action: "closed",
        pull_request: { number: 42, state: "closed", merged: true },
        repository: { full_name: "org/repo" },
      },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
  });

  it("returns 200 ok for a payload where pull_request.merged is omitted", async () => {
    const { app } = buildApp();

    const res = await app.inject({
      method: "POST",
      url: "/webhooks/github",
      payload: {
        action: "synchronize",
        pull_request: { number: 7, state: "open" },
      },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
  });
});
