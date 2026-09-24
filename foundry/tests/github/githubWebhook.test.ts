import { describe, it, expect, vi, beforeEach } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { registerGitHubWebhook } from "../../src/github/githubWebhook.js";
import type { OrchestratorService } from "../../src/orchestrator/orchestratorService.js";

function buildApp(): { app: FastifyInstance; mockOrchestrator: OrchestratorService } {
  // registerGitHubWebhook takes the orchestrator but the current
  // implementation is a stub that never calls into it; the parameter is
  // still exercised (passed in, typed, accepted) so a plain mock suffices.
  const mockOrchestrator = {} as OrchestratorService;

  const app = Fastify({ logger: false });
  registerGitHubWebhook(app, mockOrchestrator);

  return { app, mockOrchestrator };
}

describe("POST /webhooks/github", () => {
  let app: FastifyInstance;

  beforeEach(() => {
    ({ app } = buildApp());
  });

  it("returns 200 { ok: true } for a minimal valid payload (action only)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/webhooks/github",
      payload: { action: "opened" },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
  });

  it("returns 200 for a full pull_request payload with action=opened", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/webhooks/github",
      payload: {
        action: "opened",
        pull_request: { number: 42, state: "open" },
        repository: { full_name: "acme/widgets" },
      },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
  });

  it("returns 200 for action=closed with merged=true", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/webhooks/github",
      payload: {
        action: "closed",
        pull_request: { number: 42, state: "closed", merged: true },
        repository: { full_name: "acme/widgets" },
      },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
  });

  it("returns 200 for action=closed with merged=false", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/webhooks/github",
      payload: {
        action: "closed",
        pull_request: { number: 42, state: "closed", merged: false },
        repository: { full_name: "acme/widgets" },
      },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
  });

  it("returns 200 for action=synchronize (push to PR branch)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/webhooks/github",
      payload: {
        action: "synchronize",
        pull_request: { number: 7, state: "open" },
        repository: { full_name: "acme/widgets" },
      },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
  });

  it("returns 200 for action=review_requested", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/webhooks/github",
      payload: {
        action: "review_requested",
        pull_request: { number: 7, state: "open" },
        repository: { full_name: "acme/widgets" },
      },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
  });

  it("returns 400 with an error body when the payload is missing the required action field", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/webhooks/github",
      payload: { pull_request: { number: 1, state: "open" } },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: "Invalid webhook payload" });
  });

  it("returns 400 when action has the wrong type", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/webhooks/github",
      payload: { action: 123 },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: "Invalid webhook payload" });
  });

  it("returns 400 when pull_request.number is missing", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/webhooks/github",
      payload: {
        action: "opened",
        pull_request: { state: "open" },
      },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: "Invalid webhook payload" });
  });

  it("returns 400 when pull_request.number has the wrong type", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/webhooks/github",
      payload: {
        action: "opened",
        pull_request: { number: "42", state: "open" },
      },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: "Invalid webhook payload" });
  });

  it("returns 400 when pull_request.merged has the wrong type", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/webhooks/github",
      payload: {
        action: "closed",
        pull_request: { number: 1, state: "closed", merged: "yes" },
      },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: "Invalid webhook payload" });
  });

  it("returns 400 when repository.full_name is missing", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/webhooks/github",
      payload: {
        action: "opened",
        repository: {},
      },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: "Invalid webhook payload" });
  });

  it("returns 400 when the body is an empty object", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/webhooks/github",
      payload: {},
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: "Invalid webhook payload" });
  });

  it("returns 400 when the body is not an object (e.g. an array)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/webhooks/github",
      payload: [],
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: "Invalid webhook payload" });
  });

  it("does not call into the orchestrator (current stub behavior)", async () => {
    const orchestratorSpies = vi.fn();
    const app2 = Fastify({ logger: false });
    const spiedOrchestrator = new Proxy(
      {},
      {
        get() {
          orchestratorSpies();
          return undefined;
        },
      },
    ) as OrchestratorService;
    registerGitHubWebhook(app2, spiedOrchestrator);

    await app2.inject({
      method: "POST",
      url: "/webhooks/github",
      payload: { action: "opened" },
    });

    expect(orchestratorSpies).not.toHaveBeenCalled();
  });
});
