import { describe, it, expect } from "vitest";
import Fastify from "fastify";
import { registerGitHubWebhook } from "../../src/github/githubWebhook.js";
import type { OrchestratorService } from "../../src/orchestrator/orchestratorService.js";

async function buildApp() {
  const app = Fastify();
  registerGitHubWebhook(app, {} as OrchestratorService);
  await app.ready();
  return app;
}

describe("registerGitHubWebhook POST /webhooks/github", () => {
  it("returns 400 with an error body when the payload fails schema validation", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/webhooks/github",
      payload: { not: "valid" },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: "Invalid webhook payload" });
  });

  it("returns 200 ok for a minimal valid payload with only the required 'action' field", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/webhooks/github",
      payload: { action: "opened" },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
  });

  it("returns 200 ok for a full pull_request payload including repository info", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/webhooks/github",
      payload: {
        action: "closed",
        pull_request: { number: 7, state: "closed", merged: true },
        repository: { full_name: "org/repo" },
      },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
  });
});
