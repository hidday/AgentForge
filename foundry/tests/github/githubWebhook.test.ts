import { describe, it, expect, vi, beforeEach } from "vitest";
import Fastify from "fastify";
import { registerGitHubWebhook } from "../../src/github/githubWebhook.js";

async function buildApp() {
  const mockOrchestrator = {};
  const app = Fastify({ logger: false });
  registerGitHubWebhook(app, mockOrchestrator as never);
  await app.ready();
  return { app };
}

describe("POST /webhooks/github", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 200 { ok: true } for a minimal valid payload (action only)", async () => {
    const { app } = await buildApp();

    const res = await app.inject({
      method: "POST",
      url: "/webhooks/github",
      payload: { action: "opened" },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
  });

  it("returns 200 { ok: true } for a full pull_request event payload", async () => {
    const { app } = await buildApp();

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

  it("accepts a pull_request without the optional merged field", async () => {
    const { app } = await buildApp();

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

  it("returns 400 when action is missing", async () => {
    const { app } = await buildApp();

    const res = await app.inject({
      method: "POST",
      url: "/webhooks/github",
      payload: { repository: { full_name: "org/repo" } },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: "Invalid webhook payload" });
  });

  it("returns 400 when action is not a string", async () => {
    const { app } = await buildApp();

    const res = await app.inject({
      method: "POST",
      url: "/webhooks/github",
      payload: { action: 123 },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: "Invalid webhook payload" });
  });

  it("returns 400 when pull_request.number is missing", async () => {
    const { app } = await buildApp();

    const res = await app.inject({
      method: "POST",
      url: "/webhooks/github",
      payload: { action: "opened", pull_request: { state: "open" } },
    });

    expect(res.statusCode).toBe(400);
  });

  it("returns 400 for a malformed / empty body", async () => {
    const { app } = await buildApp();

    const res = await app.inject({
      method: "POST",
      url: "/webhooks/github",
      payload: {},
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: "Invalid webhook payload" });
  });

  it("returns 400 when repository.full_name is not a string", async () => {
    const { app } = await buildApp();

    const res = await app.inject({
      method: "POST",
      url: "/webhooks/github",
      payload: { action: "opened", repository: { full_name: 123 } },
    });

    expect(res.statusCode).toBe(400);
  });
});
