import { describe, it, expect, vi } from "vitest";
import Fastify from "fastify";
import { registerGitHubWebhook } from "../../src/github/githubWebhook.js";

async function buildApp() {
  const mockOrchestrator = {
    handleLinearWebhook: vi.fn(),
  };

  const app = Fastify({ logger: false });
  registerGitHubWebhook(app, mockOrchestrator as never);

  await app.ready();
  return { app, mockOrchestrator };
}

describe("POST /webhooks/github", () => {
  it("returns 200 ok for a minimal valid payload (action only)", async () => {
    const { app } = await buildApp();

    const response = await app.inject({
      method: "POST",
      url: "/webhooks/github",
      payload: { action: "opened" },
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ ok: true });
  });

  it("returns 200 ok for a full payload with pull_request and repository", async () => {
    const { app } = await buildApp();

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
    expect(JSON.parse(response.body)).toEqual({ ok: true });
  });

  it("accepts a payload where pull_request.merged is omitted (optional field)", async () => {
    const { app } = await buildApp();

    const response = await app.inject({
      method: "POST",
      url: "/webhooks/github",
      payload: {
        action: "synchronize",
        pull_request: { number: 1, state: "open" },
      },
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ ok: true });
  });

  it("returns 400 when action is missing", async () => {
    const { app } = await buildApp();

    const response = await app.inject({
      method: "POST",
      url: "/webhooks/github",
      payload: {},
    });

    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body)).toEqual({ error: "Invalid webhook payload" });
  });

  it("returns 400 when action has the wrong type", async () => {
    const { app } = await buildApp();

    const response = await app.inject({
      method: "POST",
      url: "/webhooks/github",
      payload: { action: 123 },
    });

    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body)).toEqual({ error: "Invalid webhook payload" });
  });

  it("returns 400 when pull_request.number has the wrong type", async () => {
    const { app } = await buildApp();

    const response = await app.inject({
      method: "POST",
      url: "/webhooks/github",
      payload: {
        action: "opened",
        pull_request: { number: "not-a-number", state: "open" },
      },
    });

    expect(response.statusCode).toBe(400);
  });

  it("returns 400 when repository.full_name is missing", async () => {
    const { app } = await buildApp();

    const response = await app.inject({
      method: "POST",
      url: "/webhooks/github",
      payload: {
        action: "opened",
        repository: {},
      },
    });

    expect(response.statusCode).toBe(400);
  });

  it("returns 400 for a malformed (non-JSON-object) body", async () => {
    const { app } = await buildApp();

    const response = await app.inject({
      method: "POST",
      url: "/webhooks/github",
      payload: "not an object",
      headers: { "content-type": "application/json" },
    });

    expect(response.statusCode).toBe(400);
  });

  it("never calls into the orchestrator (handler is a stub)", async () => {
    const { app, mockOrchestrator } = await buildApp();

    await app.inject({
      method: "POST",
      url: "/webhooks/github",
      payload: { action: "opened" },
    });

    expect(mockOrchestrator.handleLinearWebhook).not.toHaveBeenCalled();
  });
});
