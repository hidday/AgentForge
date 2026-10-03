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
    summary: "The plan has ambiguous requirements.",
    linearIssue: {
      id: "LIN-1",
      identifier: "ENG-42",
      title: "Add auth",
      url: "https://linear.app/team/issue/ENG-42",
    },
    runState: "AwaitingHumanInput",
    runUrl: "https://foundry.example.com/runs/run-1",
    ...overrides,
  };
}

describe("NotificationService.isConfigured", () => {
  const logger = makeLogger();

  it("returns true when a slackWebhookUrl is set", () => {
    const svc = new NotificationService(
      { emailFrom: "a@b.com", slackWebhookUrl: "https://hooks.slack.com/x" },
      logger as never,
    );
    expect(svc.isConfigured()).toBe(true);
  });

  it("returns true when both emailTo and resendApiKey are set", () => {
    const svc = new NotificationService(
      { emailFrom: "a@b.com", emailTo: "ops@x.com", resendApiKey: "key" },
      logger as never,
    );
    expect(svc.isConfigured()).toBe(true);
  });

  it("returns false when emailTo is set but resendApiKey is missing", () => {
    const svc = new NotificationService(
      { emailFrom: "a@b.com", emailTo: "ops@x.com" },
      logger as never,
    );
    expect(svc.isConfigured()).toBe(false);
  });

  it("returns false when nothing is configured", () => {
    const svc = new NotificationService({ emailFrom: "a@b.com" }, logger as never);
    expect(svc.isConfigured()).toBe(false);
  });
});

describe("NotificationService.sendHumanRequest", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("attempts neither channel and returns both unattempted when nothing is configured", async () => {
    const logger = makeLogger();
    const svc = new NotificationService({ emailFrom: "a@b.com" }, logger as never);

    const result = await svc.sendHumanRequest(makePayload());

    expect(result).toEqual({
      slack: { attempted: false, ok: false },
      email: { attempted: false, ok: false },
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sends a Slack webhook and reports ok on success", async () => {
    fetchMock.mockResolvedValue({ ok: true });
    const logger = makeLogger();
    const config: NotificationConfig = {
      emailFrom: "a@b.com",
      slackWebhookUrl: "https://hooks.slack.com/services/x",
    };
    const svc = new NotificationService(config, logger as never);

    const result = await svc.sendHumanRequest(makePayload());

    expect(result.slack).toEqual({ attempted: true, ok: true });
    expect(result.email).toEqual({ attempted: false, ok: false });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, options] = fetchMock.mock.calls[0] as [string, { method: string; body: string }];
    expect(url).toBe("https://hooks.slack.com/services/x");
    expect(options.method).toBe("POST");
    const body = JSON.parse(options.body) as { text: string; blocks: unknown[] };
    expect(body.text).toContain("Plan needs review (ambiguous)");
    expect(body.text).toContain("ENG-42");
  });

  it("includes planConfidence and openQuestions fields in the Slack payload when provided", async () => {
    fetchMock.mockResolvedValue({ ok: true });
    const logger = makeLogger();
    const svc = new NotificationService(
      { emailFrom: "a@b.com", slackWebhookUrl: "https://hooks.slack.com/services/x" },
      logger as never,
    );

    await svc.sendHumanRequest(
      makePayload({
        planConfidence: 0.42,
        context: "Some additional context that is relevant.",
        openQuestions: [
          { id: "q1", question: "Should we use OAuth?", requiredForExecution: true },
          { id: "q2", question: "What about rate limits?", requiredForExecution: false },
        ],
      }),
    );

    const [, options] = fetchMock.mock.calls[0] as [string, { body: string }];
    const body = JSON.parse(options.body) as { blocks: { text?: { text: string } }[] };
    const serialized = JSON.stringify(body);
    expect(serialized).toContain("0.42");
    expect(serialized).toContain("Open questions");
    expect(serialized).toContain("Should we use OAuth?");
    expect(serialized).toContain("Some additional context");
    expect(serialized).toContain("[required]");
  });

  it("marks Slack as failed and logs a warning when the webhook responds non-ok", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500, text: () => Promise.resolve("boom") });
    const logger = makeLogger();
    const svc = new NotificationService(
      { emailFrom: "a@b.com", slackWebhookUrl: "https://hooks.slack.com/services/x" },
      logger as never,
    );

    const result = await svc.sendHumanRequest(makePayload());

    expect(result.slack.attempted).toBe(true);
    expect(result.slack.ok).toBe(false);
    expect(result.slack.error).toContain("Slack webhook returned 500");
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ runId: "run-1" }),
      "Slack notification failed",
    );
  });

  it("marks Slack as failed when fetch itself rejects (network error)", async () => {
    fetchMock.mockRejectedValue(new Error("network down"));
    const logger = makeLogger();
    const svc = new NotificationService(
      { emailFrom: "a@b.com", slackWebhookUrl: "https://hooks.slack.com/services/x" },
      logger as never,
    );

    const result = await svc.sendHumanRequest(makePayload());

    expect(result.slack.ok).toBe(false);
    expect(result.slack.error).toBe("network down");
  });

  it("sends an email via Resend and reports ok on success", async () => {
    fetchMock.mockResolvedValue({ ok: true });
    const logger = makeLogger();
    const svc = new NotificationService(
      { emailFrom: "AgentForge <noreply@x.com>", emailTo: "ops@x.com", resendApiKey: "key123" },
      logger as never,
    );

    const result = await svc.sendHumanRequest(makePayload());

    expect(result.email).toEqual({ attempted: true, ok: true });
    expect(result.slack).toEqual({ attempted: false, ok: false });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, options] = fetchMock.mock.calls[0] as [
      string,
      { headers: Record<string, string>; body: string },
    ];
    expect(url).toBe("https://api.resend.com/emails");
    expect(options.headers.Authorization).toBe("Bearer key123");
    const body = JSON.parse(options.body) as {
      from: string;
      to: string[];
      subject: string;
      html: string;
      text: string;
    };
    expect(body.from).toBe("AgentForge <noreply@x.com>");
    expect(body.to).toEqual(["ops@x.com"]);
    expect(body.subject).toContain("ENG-42");
    expect(body.html).toContain("Add auth");
    expect(body.text).toContain("Add auth");
  });

  it("splits a comma-separated emailTo into multiple trimmed recipients", async () => {
    fetchMock.mockResolvedValue({ ok: true });
    const logger = makeLogger();
    const svc = new NotificationService(
      {
        emailFrom: "a@b.com",
        emailTo: "ops@x.com, backup@x.com ,  third@x.com",
        resendApiKey: "key",
      },
      logger as never,
    );

    await svc.sendHumanRequest(makePayload());

    const [, options] = fetchMock.mock.calls[0] as [string, { body: string }];
    const body = JSON.parse(options.body) as { to: string[] };
    expect(body.to).toEqual(["ops@x.com", "backup@x.com", "third@x.com"]);
  });

  it("marks email as failed and logs a warning when Resend responds non-ok", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 422,
      text: () => Promise.resolve("invalid from address"),
    });
    const logger = makeLogger();
    const svc = new NotificationService(
      { emailFrom: "a@b.com", emailTo: "ops@x.com", resendApiKey: "key" },
      logger as never,
    );

    const result = await svc.sendHumanRequest(makePayload());

    expect(result.email.ok).toBe(false);
    expect(result.email.error).toContain("Resend returned 422");
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ runId: "run-1" }),
      "Email notification failed",
    );
  });

  it("sends both Slack and email concurrently when both are configured", async () => {
    fetchMock.mockResolvedValue({ ok: true });
    const logger = makeLogger();
    const svc = new NotificationService(
      {
        emailFrom: "a@b.com",
        emailTo: "ops@x.com",
        resendApiKey: "key",
        slackWebhookUrl: "https://hooks.slack.com/services/x",
      },
      logger as never,
    );

    const result = await svc.sendHumanRequest(makePayload());

    expect(result.slack).toEqual({ attempted: true, ok: true });
    expect(result.email).toEqual({ attempted: true, ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("renders a HTML-escaped email body for a payload containing HTML-special characters", async () => {
    fetchMock.mockResolvedValue({ ok: true });
    const logger = makeLogger();
    const svc = new NotificationService(
      { emailFrom: "a@b.com", emailTo: "ops@x.com", resendApiKey: "key" },
      logger as never,
    );

    await svc.sendHumanRequest(
      makePayload({
        summary: `<script>alert("xss")</script> & 'quoted'`,
        linearIssue: {
          id: "LIN-1",
          title: null,
          url: null,
        },
      }),
    );

    const [, options] = fetchMock.mock.calls[0] as [string, { body: string }];
    const body = JSON.parse(options.body) as { html: string; text: string };
    expect(body.html).not.toContain("<script>alert");
    expect(body.html).toContain("&lt;script&gt;");
    expect(body.html).toContain("&amp;");
    expect(body.html).toContain("&#39;quoted&#39;");
    expect(body.html).toContain("(untitled)");
    // text body is not HTML-escaped
    expect(body.text).toContain('<script>alert("xss")</script>');
  });

  it("truncates a very long context string in both Slack and email bodies", async () => {
    fetchMock.mockResolvedValue({ ok: true });
    const logger = makeLogger();
    const svc = new NotificationService(
      {
        emailFrom: "a@b.com",
        emailTo: "ops@x.com",
        resendApiKey: "key",
        slackWebhookUrl: "https://hooks.slack.com/services/x",
      },
      logger as never,
    );

    const longContext = "y".repeat(3000);
    await svc.sendHumanRequest(makePayload({ context: longContext }));

    const slackCall = fetchMock.mock.calls.find(
      (c) => (c[0] as string) === "https://hooks.slack.com/services/x",
    ) as [string, { body: string }];
    const slackBody = JSON.parse(slackCall[1].body) as unknown;
    expect(JSON.stringify(slackBody)).toContain("…");
    expect(JSON.stringify(slackBody).length).toBeLessThan(longContext.length + 2000);

    const emailCall = fetchMock.mock.calls.find(
      (c) => (c[0] as string) === "https://api.resend.com/emails",
    ) as [string, { body: string }];
    const emailBody = JSON.parse(emailCall[1].body) as { html: string; text: string };
    expect(emailBody.html).toContain("…");
    expect(emailBody.text).toContain("…");
  });

  it.each([
    ["plan_ambiguous", "Plan needs review (ambiguous)"],
    ["plan_low_confidence", "Plan needs review (low confidence)"],
    ["impl_rejected", "Implementation needs review (rejected by agent)"],
    ["impl_uncertain", "Implementation needs review (uncertain)"],
    ["other", "Human intervention requested"],
  ] as const)("renders the correct label for reason=%s", async (reason, expectedLabel) => {
    fetchMock.mockResolvedValue({ ok: true });
    const logger = makeLogger();
    const svc = new NotificationService(
      { emailFrom: "a@b.com", slackWebhookUrl: "https://hooks.slack.com/services/x" },
      logger as never,
    );

    await svc.sendHumanRequest(makePayload({ reason }));

    const [, options] = fetchMock.mock.calls[0] as [string, { body: string }];
    const body = JSON.parse(options.body) as { text: string };
    expect(body.text).toContain(expectedLabel);
  });
});
