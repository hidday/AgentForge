import { describe, it, expect, vi } from "vitest";
import Fastify from "fastify";
import { registerGitHubWebhook } from "../../src/github/githubWebhook.js";

async function buildApp() {
  const mockOrchestrator = {};
  const app = Fastify({ logger: false });
  registerGitHubWebhook(app, mockOrchestrator as never);
  await app.ready();
  return app;
}

describe("POST /webhooks/github", () => {
  it("returns 200 ok for a valid payload with no pull_request or repository", async () => {
    const app = await buildApp();

    const response = await app.inject({
      method: "POST",
      url: "/webhooks/github",
      payload: { action: "opened" },
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ ok: true });
  });

  it("returns 200 ok for a valid payload including pull_request and repository", async () => {
    const app = await buildApp();

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
    expect(JSON.parse(response.body)).toEqual({ ok: true });
  });

  it("returns 400 for a payload missing the required 'action' field", async () => {
    const app = await buildApp();

    const response = await app.inject({
      method: "POST",
      url: "/webhooks/github",
      payload: { pull_request: { number: 1, state: "open" } },
    });

    expect(response.statusCode).toBe(400);
    const body = JSON.parse(response.body) as { error: string };
    expect(body.error).toBe("Invalid webhook payload");
  });

  it("returns 400 when pull_request.number has the wrong type", async () => {
    const app = await buildApp();

    const response = await app.inject({
      method: "POST",
      url: "/webhooks/github",
      payload: { action: "opened", pull_request: { number: "42", state: "open" } },
    });

    expect(response.statusCode).toBe(400);
  });

  it("never calls into the orchestrator (stub route)", async () => {
    const mockOrchestrator = { handleLinearWebhook: vi.fn() };
    const app = Fastify({ logger: false });
    registerGitHubWebhook(app, mockOrchestrator as never);
    await app.ready();

    await app.inject({ method: "POST", url: "/webhooks/github", payload: { action: "opened" } });

    expect(mockOrchestrator.handleLinearWebhook).not.toHaveBeenCalled();
  });
});
