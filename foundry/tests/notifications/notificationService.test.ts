import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  NotificationService,
  type NotificationPayload,
} from "../../src/notifications/notificationService.js";

function makeLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
}

function makePayload(overrides: Partial<NotificationPayload> = {}): NotificationPayload {
  return {
    runId: "run-1",
    reason: "plan_low_confidence",
    summary: "Plan confidence is below threshold.",
    runState: "HumanClarificationNeeded",
    runUrl: "https://foundry.example.com/runs/run-1",
    linearIssue: {
      id: "LIN-1",
      identifier: "ENG-42",
      title: "Add feature X",
      url: "https://linear.app/team/issue/ENG-42",
    },
    ...overrides,
  };
}

describe("NotificationService.isConfigured", () => {
  it("is false when neither slack nor email is configured", () => {
    const svc = new NotificationService({ emailFrom: "a@b.com" }, makeLogger() as never);
    expect(svc.isConfigured()).toBe(false);
  });

  it("is true when a slack webhook is configured", () => {
    const svc = new NotificationService(
      { emailFrom: "a@b.com", slackWebhookUrl: "https://hooks.slack.com/x" },
      makeLogger() as never,
    );
    expect(svc.isConfigured()).toBe(true);
  });

  it("is true when both emailTo and resendApiKey are configured", () => {
    const svc = new NotificationService(
      { emailFrom: "a@b.com", emailTo: "ops@b.com", resendApiKey: "key" },
      makeLogger() as never,
    );
    expect(svc.isConfigured()).toBe(true);
  });

  it("is false when emailTo is set but resendApiKey is missing", () => {
    const svc = new NotificationService(
      { emailFrom: "a@b.com", emailTo: "ops@b.com" },
      makeLogger() as never,
    );
    expect(svc.isConfigured()).toBe(false);
  });
});

describe("NotificationService.sendHumanRequest", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("does not attempt any channel when nothing is configured", async () => {
    const svc = new NotificationService({ emailFrom: "a@b.com" }, makeLogger() as never);
    const result = await svc.sendHumanRequest(makePayload());
    expect(result.slack.attempted).toBe(false);
    expect(result.email.attempted).toBe(false);
  });

  it("marks slack ok=true on a successful webhook call and includes reason/title/issue in the body", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, text: async () => "" });
    global.fetch = fetchMock as unknown as typeof fetch;

    const svc = new NotificationService(
      { emailFrom: "a@b.com", slackWebhookUrl: "https://hooks.slack.com/x" },
      makeLogger() as never,
    );
    const result = await svc.sendHumanRequest(
      makePayload({ planConfidence: 0.42, openQuestions: [
        { id: "q1", question: "Is this safe?", requiredForExecution: true },
      ] }),
    );

    expect(result.slack).toEqual({ attempted: true, ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://hooks.slack.com/x");
    const body = JSON.parse(init.body as string);
    expect(body.text).toContain("ENG-42");
    expect(body.text).toContain("low confidence");
    expect(JSON.stringify(body.blocks)).toContain("0.42");
    expect(JSON.stringify(body.blocks)).toContain("Is this safe?");
  });

  it("marks slack ok=false and logs a warning when the webhook responds with a non-ok status", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: false, status: 500, text: async () => "server error" });
    global.fetch = fetchMock as unknown as typeof fetch;
    const logger = makeLogger();

    const svc = new NotificationService(
      { emailFrom: "a@b.com", slackWebhookUrl: "https://hooks.slack.com/x" },
      logger as never,
    );
    const result = await svc.sendHumanRequest(makePayload());

    expect(result.slack.ok).toBe(false);
    expect(result.slack.error).toContain("500");
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ runId: "run-1" }),
      "Slack notification failed",
    );
  });

  it("sends to Resend when email is configured, splitting comma-separated recipients", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, text: async () => "" });
    global.fetch = fetchMock as unknown as typeof fetch;

    const svc = new NotificationService(
      { emailFrom: "Bot <bot@x.com>", emailTo: "a@x.com, b@x.com", resendApiKey: "secret" },
      makeLogger() as never,
    );
    const result = await svc.sendHumanRequest(makePayload());

    expect(result.email).toEqual({ attempted: true, ok: true });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.resend.com/emails");
    expect(init.headers.Authorization).toBe("Bearer secret");
    const body = JSON.parse(init.body as string);
    expect(body.to).toEqual(["a@x.com", "b@x.com"]);
    expect(body.html).toContain("Add feature X");
    expect(body.text).toContain("Add feature X");
  });

  it("marks email ok=false and logs a warning when Resend responds with a non-ok status", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: false, status: 401, text: async () => "unauthorized" });
    global.fetch = fetchMock as unknown as typeof fetch;
    const logger = makeLogger();

    const svc = new NotificationService(
      { emailFrom: "a@b.com", emailTo: "ops@b.com", resendApiKey: "bad-key" },
      logger as never,
    );
    const result = await svc.sendHumanRequest(makePayload());

    expect(result.email.ok).toBe(false);
    expect(result.email.error).toContain("401");
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ runId: "run-1" }),
      "Email notification failed",
    );
  });

  it("attempts both channels concurrently when both are configured", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, text: async () => "" });
    global.fetch = fetchMock as unknown as typeof fetch;

    const svc = new NotificationService(
      {
        emailFrom: "a@b.com",
        emailTo: "ops@b.com",
        resendApiKey: "secret",
        slackWebhookUrl: "https://hooks.slack.com/x",
      },
      makeLogger() as never,
    );
    const result = await svc.sendHumanRequest(makePayload({ context: "x".repeat(2100) }));

    expect(result.slack.attempted).toBe(true);
    expect(result.email.attempted).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("falls back to '(untitled)' and omits the Linear link when the issue has no title/url", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, text: async () => "" });
    global.fetch = fetchMock as unknown as typeof fetch;

    const svc = new NotificationService(
      { emailFrom: "a@b.com", slackWebhookUrl: "https://hooks.slack.com/x" },
      makeLogger() as never,
    );
    await svc.sendHumanRequest(
      makePayload({ linearIssue: { id: "LIN-9", title: null, url: null } }),
    );

    const [, init] = fetchMock.mock.calls[0];
    const body = JSON.parse(init.body as string);
    expect(body.text).toContain("(untitled)");
    const actionsBlock = body.blocks.find((b: { type: string }) => b.type === "actions");
    expect(actionsBlock.elements).toHaveLength(1);
  });
});
