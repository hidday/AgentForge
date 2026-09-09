import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  NotificationService,
  type NotificationConfig,
  type NotificationPayload,
} from "../../src/notifications/notificationService.js";

function makeLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };
}

function makePayload(overrides: Partial<NotificationPayload> = {}): NotificationPayload {
  return {
    runId: "run-1",
    reason: "plan_ambiguous",
    summary: "The plan needs clarification.",
    linearIssue: {
      id: "issue-1",
      identifier: "PRY-1",
      title: "Add validation",
      url: "https://linear.app/team/issue/PRY-1",
    },
    runState: "HumanClarificationNeeded",
    runUrl: "https://foundry.example.com/runs/run-1",
    ...overrides,
  };
}

describe("NotificationService.isConfigured", () => {
  it("is true when a Slack webhook URL is configured", () => {
    const svc = new NotificationService(
      { emailFrom: "a@b.com", slackWebhookUrl: "https://hooks.slack.com/x" },
      makeLogger() as never,
    );
    expect(svc.isConfigured()).toBe(true);
  });

  it("is true when both emailTo and resendApiKey are configured", () => {
    const svc = new NotificationService(
      { emailFrom: "a@b.com", emailTo: "dev@b.com", resendApiKey: "re_123" },
      makeLogger() as never,
    );
    expect(svc.isConfigured()).toBe(true);
  });

  it("is false when emailTo is set without a resendApiKey", () => {
    const svc = new NotificationService(
      { emailFrom: "a@b.com", emailTo: "dev@b.com" },
      makeLogger() as never,
    );
    expect(svc.isConfigured()).toBe(false);
  });

  it("is false when nothing is configured", () => {
    const svc = new NotificationService({ emailFrom: "a@b.com" }, makeLogger() as never);
    expect(svc.isConfigured()).toBe(false);
  });
});

describe("NotificationService.sendHumanRequest", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("reports both channels as not attempted when nothing is configured", async () => {
    const svc = new NotificationService({ emailFrom: "a@b.com" }, makeLogger() as never);
    const result = await svc.sendHumanRequest(makePayload());

    expect(result).toEqual({
      slack: { attempted: false, ok: false },
      email: { attempted: false, ok: false },
    });
  });

  it("sends a Slack webhook and reports ok:true on 2xx", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, text: () => Promise.resolve("") });
    global.fetch = fetchMock as unknown as typeof fetch;

    const config: NotificationConfig = {
      emailFrom: "a@b.com",
      slackWebhookUrl: "https://hooks.slack.com/x",
    };
    const svc = new NotificationService(config, makeLogger() as never);

    const result = await svc.sendHumanRequest(
      makePayload({
        planConfidence: 0.42,
        context: "Some long context ".repeat(200),
        openQuestions: [
          { id: "q1", question: "Use Postgres?", requiredForExecution: true },
          { id: "q2", question: "Add caching?", requiredForExecution: false },
        ],
      }),
    );

    expect(result.slack).toEqual({ attempted: true, ok: true });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://hooks.slack.com/x",
      expect.objectContaining({ method: "POST" }),
    );
    const body = JSON.parse((fetchMock.mock.calls[0][1] as { body: string }).body) as {
      text: string;
      blocks: unknown[];
    };
    expect(body.text).toContain("PRY-1");
    expect(body.text).toContain("Plan needs review (ambiguous)");
  });

  it("stringifies a non-Error rejection when the Slack fetch call itself throws", async () => {
    const fetchMock = vi.fn().mockRejectedValue("network unreachable");
    global.fetch = fetchMock as unknown as typeof fetch;
    const logger = makeLogger();

    const svc = new NotificationService(
      { emailFrom: "a@b.com", slackWebhookUrl: "https://hooks.slack.com/x" },
      logger as never,
    );

    const result = await svc.sendHumanRequest(makePayload());

    expect(result.slack).toEqual({ attempted: true, ok: false, error: "network unreachable" });
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ error: "network unreachable" }),
      "Slack notification failed",
    );
  });

  it("falls back to '(untitled)' in the Slack message title when the issue has no title", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, text: () => Promise.resolve("") });
    global.fetch = fetchMock as unknown as typeof fetch;

    const svc = new NotificationService(
      { emailFrom: "a@b.com", slackWebhookUrl: "https://hooks.slack.com/x" },
      makeLogger() as never,
    );

    await svc.sendHumanRequest(
      makePayload({ linearIssue: { id: "issue-1", identifier: "PRY-1", title: null, url: null } }),
    );

    const body = JSON.parse((fetchMock.mock.calls[0][1] as { body: string }).body) as {
      text: string;
    };
    expect(body.text).toContain("(untitled)");
  });

  it("marks the Slack send as failed and logs a warning on a non-2xx response", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: false, status: 500, text: () => Promise.resolve("server error") });
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

  it("sends an email via Resend and reports ok:true on 2xx, splitting comma-separated recipients", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, text: () => Promise.resolve("") });
    global.fetch = fetchMock as unknown as typeof fetch;

    const svc = new NotificationService(
      {
        emailFrom: "AgentForge <no-reply@example.com>",
        emailTo: " a@b.com , c@d.com ",
        resendApiKey: "re_123",
      },
      makeLogger() as never,
    );

    const result = await svc.sendHumanRequest(
      makePayload({
        planConfidence: 0.75,
        context: "Extra context",
        openQuestions: [
          { id: "q1", question: "Use Postgres?", requiredForExecution: true },
          { id: "q2", question: "Add caching?", requiredForExecution: false },
        ],
        linearIssue: { id: "issue-1", title: null, url: null },
      }),
    );

    expect(result.email).toEqual({ attempted: true, ok: true });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.resend.com/emails",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ Authorization: "Bearer re_123" }),
      }),
    );
    const body = JSON.parse((fetchMock.mock.calls[0][1] as { body: string }).body) as {
      to: string[];
      html: string;
      text: string;
    };
    expect(body.to).toEqual(["a@b.com", "c@d.com"]);
    expect(body.html).toContain("(untitled)");
    expect(body.text).toContain("issue-1: (untitled)");
    // Both a required and a non-required question should be rendered, only the
    // former annotated with "[required]" / "<strong>[required]</strong>".
    expect(body.html).toContain("<strong>[required]</strong> Use Postgres?");
    expect(body.html).toContain("<li>Add caching?</li>");
    expect(body.text).toContain("[required] Use Postgres?");
    expect(body.text).toContain("- Add caching?");
  });

  it("stringifies a non-Error rejection when the email fetch call itself throws", async () => {
    const fetchMock = vi.fn().mockRejectedValue("dns failure");
    global.fetch = fetchMock as unknown as typeof fetch;
    const logger = makeLogger();

    const svc = new NotificationService(
      { emailFrom: "a@b.com", emailTo: "dev@b.com", resendApiKey: "re_123" },
      logger as never,
    );

    const result = await svc.sendHumanRequest(makePayload());

    expect(result.email).toEqual({ attempted: true, ok: false, error: "dns failure" });
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ error: "dns failure" }),
      "Email notification failed",
    );
  });

  it("marks the email send as failed and logs a warning on a non-2xx response", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: false, status: 429, text: () => Promise.resolve("rate limited") });
    global.fetch = fetchMock as unknown as typeof fetch;
    const logger = makeLogger();

    const svc = new NotificationService(
      { emailFrom: "a@b.com", emailTo: "dev@b.com", resendApiKey: "re_123" },
      logger as never,
    );

    const result = await svc.sendHumanRequest(makePayload());

    expect(result.email.ok).toBe(false);
    expect(result.email.error).toContain("429");
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ runId: "run-1" }),
      "Email notification failed",
    );
  });

  it("sends both Slack and email concurrently when both are configured", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, text: () => Promise.resolve("") });
    global.fetch = fetchMock as unknown as typeof fetch;

    const svc = new NotificationService(
      {
        emailFrom: "a@b.com",
        emailTo: "dev@b.com",
        resendApiKey: "re_123",
        slackWebhookUrl: "https://hooks.slack.com/x",
      },
      makeLogger() as never,
    );

    const result = await svc.sendHumanRequest(makePayload());

    expect(result.slack.ok).toBe(true);
    expect(result.email.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("uses each HumanRequestReason's label and handles an issue identifier fallback to id", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, text: () => Promise.resolve("") });
    global.fetch = fetchMock as unknown as typeof fetch;

    const reasons: NotificationPayload["reason"][] = [
      "plan_ambiguous",
      "plan_low_confidence",
      "impl_rejected",
      "impl_uncertain",
      "other",
    ];

    for (const reason of reasons) {
      const svc = new NotificationService(
        { emailFrom: "a@b.com", slackWebhookUrl: "https://hooks.slack.com/x" },
        makeLogger() as never,
      );
      const result = await svc.sendHumanRequest(
        makePayload({ reason, linearIssue: { id: "issue-only-id", title: "T", url: null } }),
      );
      expect(result.slack.ok).toBe(true);
    }

    const lastCallBody = JSON.parse(
      (fetchMock.mock.calls.at(-1)?.[1] as { body: string }).body,
    ) as { text: string };
    expect(lastCallBody.text).toContain("issue-only-id");
  });
});
