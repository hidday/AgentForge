import { describe, it, expect } from "vitest";
import Fastify from "fastify";
import { registerGitHubWebhook } from "../../src/github/githubWebhook.js";
import type { OrchestratorService } from "../../src/orchestrator/orchestratorService.js";

function buildApp() {
  const app = Fastify({ logger: false });
  // The GitHub webhook handler is currently a stub that never calls the
  // orchestrator, so an empty object stands in for it.
  registerGitHubWebhook(app, {} as OrchestratorService);
  return app;
}

describe("registerGitHubWebhook", () => {
  it("returns 400 with an error body when the payload fails schema validation", async () => {
    const app = buildApp();

    const response = await app.inject({
      method: "POST",
      url: "/webhooks/github",
      payload: { not_action: "oops" },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "Invalid webhook payload" });
  });

  it("returns 400 when pull_request is present but missing required fields", async () => {
    const app = buildApp();

    const response = await app.inject({
      method: "POST",
      url: "/webhooks/github",
      payload: { action: "opened", pull_request: { number: 1 } },
    });

    expect(response.statusCode).toBe(400);
  });

  it("accepts a minimal valid payload with only an action", async () => {
    const app = buildApp();

    const response = await app.inject({
      method: "POST",
      url: "/webhooks/github",
      payload: { action: "opened" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true });
  });

  it("accepts a full payload with pull_request and repository", async () => {
    const app = buildApp();

    const response = await app.inject({
      method: "POST",
      url: "/webhooks/github",
      payload: {
        action: "closed",
        pull_request: { number: 42, state: "closed", merged: true },
        repository: { full_name: "acme/widgets" },
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true });
  });
});
