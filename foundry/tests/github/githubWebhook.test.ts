import { describe, it, expect } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { registerGitHubWebhook } from "../../src/github/githubWebhook.js";

function buildApp() {
  const orchestrator = {};
  const app: FastifyInstance = Fastify({ logger: false });
  registerGitHubWebhook(app, orchestrator as never);
  return app;
}

describe("POST /webhooks/github", () => {
  it("returns 400 for a payload that fails schema validation", async () => {
    const app = buildApp();
    const response = await app.inject({
      method: "POST",
      url: "/webhooks/github",
      payload: { pull_request: { number: "not-a-number" } },
    });
    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body).error).toBe("Invalid webhook payload");
  });

  it("acknowledges a minimal valid payload with just an action", async () => {
    const app = buildApp();
    const response = await app.inject({
      method: "POST",
      url: "/webhooks/github",
      payload: { action: "opened" },
    });
    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ ok: true });
  });

  it("acknowledges a full pull_request payload", async () => {
    const app = buildApp();
    const response = await app.inject({
      method: "POST",
      url: "/webhooks/github",
      payload: {
        action: "closed",
        pull_request: { number: 42, state: "closed", merged: true },
        repository: { full_name: "hidday/agentforge" },
      },
    });
    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ ok: true });
  });
});
