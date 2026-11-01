import { describe, it, expect } from "vitest";
import Fastify from "fastify";
import { registerGitHubWebhook } from "../../src/github/githubWebhook.js";
import type { OrchestratorService } from "../../src/orchestrator/orchestratorService.js";

function buildApp() {
  const app = Fastify();
  registerGitHubWebhook(app, {} as OrchestratorService);
  return app;
}

describe("registerGitHubWebhook", () => {
  it("returns 400 for a payload missing the required action field", async () => {
    const app = buildApp();

    const response = await app.inject({
      method: "POST",
      url: "/webhooks/github",
      payload: { pull_request: { number: 1, state: "open" } },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "Invalid webhook payload" });
  });

  it("returns 200 for a minimal valid payload", async () => {
    const app = buildApp();

    const response = await app.inject({
      method: "POST",
      url: "/webhooks/github",
      payload: { action: "opened" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true });
  });

  it("returns 200 for a full payload including pull_request and repository", async () => {
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
