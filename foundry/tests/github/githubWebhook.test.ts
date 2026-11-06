import { describe, it, expect, vi } from "vitest";
import Fastify from "fastify";
import { registerGitHubWebhook } from "../../src/github/githubWebhook.js";

function buildApp() {
  const mockOrchestrator = {};
  const app = Fastify({ logger: false });
  registerGitHubWebhook(app, mockOrchestrator as never);
  return app;
}

describe("POST /webhooks/github", () => {
  it("returns 200 for a minimal valid payload", async () => {
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
        repository: { full_name: "org/repo" },
      },
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ ok: true });
  });

  it("returns 400 when the payload is missing required fields", async () => {
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

  it("returns 400 when pull_request.number is not a number", async () => {
    const app = buildApp();
    await app.ready();

    const response = await app.inject({
      method: "POST",
      url: "/webhooks/github",
      payload: { action: "opened", pull_request: { number: "nope", state: "open" } },
    });

    expect(response.statusCode).toBe(400);
  });

  it("does not touch the orchestrator (stub handler)", async () => {
    const mockOrchestrator = { handleLinearWebhook: vi.fn() };
    const app = Fastify({ logger: false });
    registerGitHubWebhook(app, mockOrchestrator as never);
    await app.ready();

    await app.inject({
      method: "POST",
      url: "/webhooks/github",
      payload: { action: "opened" },
    });

    expect(mockOrchestrator.handleLinearWebhook).not.toHaveBeenCalled();
  });
});
