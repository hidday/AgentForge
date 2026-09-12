import { describe, it, expect, beforeEach } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { registerGitHubWebhook } from "../../src/github/githubWebhook.js";
import type { OrchestratorService } from "../../src/orchestrator/orchestratorService.js";

describe("registerGitHubWebhook", () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = Fastify();
    registerGitHubWebhook(app, {} as unknown as OrchestratorService);
    await app.ready();
  });

  it("returns 400 with an error message for a payload missing the required 'action' field", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/webhooks/github",
      payload: { pull_request: { number: 1, state: "open" } },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: "Invalid webhook payload" });
  });

  it("returns 400 when pull_request.number is not a number", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/webhooks/github",
      payload: { action: "opened", pull_request: { number: "1", state: "open" } },
    });

    expect(res.statusCode).toBe(400);
  });

  it("returns 200 ok for a minimal valid payload with only 'action'", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/webhooks/github",
      payload: { action: "opened" },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
  });

  it("returns 200 ok for a full pull_request event payload", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/webhooks/github",
      payload: {
        action: "closed",
        pull_request: { number: 42, state: "closed", merged: true },
        repository: { full_name: "owner/repo" },
      },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
  });
});
