import { describe, it, expect, vi } from "vitest";
import Fastify from "fastify";
import { registerGitHubWebhook } from "../../src/github/githubWebhook.js";

async function buildApp() {
  const orchestrator = {};
  const app = Fastify({ logger: false });
  registerGitHubWebhook(app, orchestrator as never);
  await app.ready();
  return { app };
}

describe("POST /webhooks/github", () => {
  it("returns 400 for a payload missing the required action field", async () => {
    const { app } = await buildApp();

    const response = await app.inject({
      method: "POST",
      url: "/webhooks/github",
      payload: { pull_request: { number: 1, state: "open" } },
    });

    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body)).toEqual({ error: "Invalid webhook payload" });
  });

  it("returns 200 for a minimal valid payload with only action", async () => {
    const { app } = await buildApp();

    const response = await app.inject({
      method: "POST",
      url: "/webhooks/github",
      payload: { action: "opened" },
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ ok: true });
  });

  it("returns 200 for a full pull_request event payload", async () => {
    const { app } = await buildApp();

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

  it("returns 400 when pull_request is present but missing required fields", async () => {
    const { app } = await buildApp();

    const response = await app.inject({
      method: "POST",
      url: "/webhooks/github",
      payload: { action: "opened", pull_request: { number: 1 } }, // missing state
    });

    expect(response.statusCode).toBe(400);
  });

  it("never calls into the orchestrator (stub only validates the payload)", async () => {
    const orchestrator = { anyMethod: vi.fn() };
    const app = Fastify({ logger: false });
    registerGitHubWebhook(app, orchestrator as never);
    await app.ready();

    await app.inject({
      method: "POST",
      url: "/webhooks/github",
      payload: { action: "opened" },
    });

    expect(orchestrator.anyMethod).not.toHaveBeenCalled();
  });
});
