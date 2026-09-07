import { describe, it, expect, vi, afterEach } from "vitest";
import { NotificationService, type NotificationPayload } from "../../src/notifications/notificationService.js";

function makeLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
}

function makePayload(overrides: Partial<NotificationPayload> = {}): NotificationPayload {
  return {
    runId: "run-1",
    reason: "plan_ambiguous",
    summary: "The plan is ambiguous about auth strategy",
    linearIssue: { id: "lin-1", identifier: "ENG-42", title: "Add login", url: "https://linear.app/x/ENG-42" },
    runState: "AwaitingPlanApproval",
    runUrl: "https://app.example.com/runs/run-1",
    ...overrides,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("NotificationService.isConfigured", () => {
  it("is true when a slack webhook is configured", () => {
    const svc = new NotificationService(
      { emailFrom: "a@b.com", slackWebhookUrl: "https://hooks.slack.com/x" },
      makeLogger() as never,
    );
    expect(svc.isConfigured()).toBe(true);
  });

  it("is true when both emailTo and resendApiKey are configured", () => {
    const svc = new NotificationService(
      { emailFrom: "a@b.com", emailTo: "team@b.com", resendApiKey: "re_123" },
      makeLogger() as never,
    );
    expect(svc.isConfigured()).toBe(true);
  });

  it("is false when emailTo is set but resendApiKey is missing", () => {
    const svc = new NotificationService(
      { emailFrom: "a@b.com", emailTo: "team@b.com" },
      makeLogger() as never,
    );
    expect(svc.isConfigured()).toBe(false);
  });

  it("is false when nothing is configured", () => {
    const svc = new NotificationService({ emailFrom: "a@b.com" }, makeLogger() as never);
    expect(svc.isConfigured()).toBe(false);
  });
});

describe("NotificationService.sendHumanRequest -- channel selection", () => {
  it("attempts neither channel when nothing is configured", async () => {
    const svc = new NotificationService({ emailFrom: "a@b.com" }, makeLogger() as never);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const result = await svc.sendHumanRequest(makePayload());

    expect(result).toEqual({
      slack: { attempted: false, ok: false },
      email: { attempted: false, ok: false },
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sends only slack when only slack is configured", async () => {
    const svc = new NotificationService(
      { emailFrom: "a@b.com", slackWebhookUrl: "https://hooks.slack.com/x" },
      makeLogger() as never,
    );
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true }));

    const result = await svc.sendHumanRequest(makePayload());

    expect(result.slack).toEqual({ attempted: true, ok: true });
    expect(result.email).toEqual({ attempted: false, ok: false });
  });

  it("sends both channels when both are configured, and calls fetch for each", async () => {
    const svc = new NotificationService(
      {
        emailFrom: "a@b.com",
        slackWebhookUrl: "https://hooks.slack.com/x",
        emailTo: "team@b.com",
        resendApiKey: "re_123",
      },
      makeLogger() as never,
    );
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);

    const result = await svc.sendHumanRequest(makePayload());

    expect(result.slack.ok).toBe(true);
    expect(result.email.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenCalledWith("https://hooks.slack.com/x", expect.any(Object));
    expect(fetchMock).toHaveBeenCalledWith("https://api.resend.com/emails", expect.any(Object));
  });

  it("records a slack failure without throwing and logs a warning", async () => {
    const logger = makeLogger();
    const svc = new NotificationService(
      { emailFrom: "a@b.com", slackWebhookUrl: "https://hooks.slack.com/x" },
      logger as never,
    );
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 500, text: () => Promise.resolve("server error") }));

    const result = await svc.sendHumanRequest(makePayload());

    expect(result.slack.ok).toBe(false);
    expect(result.slack.error).toContain("Slack webhook returned 500");
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ runId: "run-1" }),
      "Slack notification failed",
    );
  });

  it("records an email failure without throwing and logs a warning", async () => {
    const logger = makeLogger();
    const svc = new NotificationService(
      { emailFrom: "a@b.com", emailTo: "team@b.com", resendApiKey: "re_123" },
      logger as never,
    );
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 401, text: () => Promise.resolve("bad key") }));

    const result = await svc.sendHumanRequest(makePayload());

    expect(result.email.ok).toBe(false);
    expect(result.email.error).toContain("Resend returned 401");
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ runId: "run-1" }),
      "Email notification failed",
    );
  });

  it("falls back to a non-Error rejection message string for slack", async () => {
    const svc = new NotificationService(
      { emailFrom: "a@b.com", slackWebhookUrl: "https://hooks.slack.com/x" },
      makeLogger() as never,
    );
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue("network down"));

    const result = await svc.sendHumanRequest(makePayload());

    expect(result.slack.ok).toBe(false);
    expect(result.slack.error).toBe("network down");
  });

  it("falls back to a non-Error rejection message string for email", async () => {
    const svc = new NotificationService(
      { emailFrom: "a@b.com", emailTo: "team@b.com", resendApiKey: "re_123" },
      makeLogger() as never,
    );
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue("smtp gateway down"));

    const result = await svc.sendHumanRequest(makePayload());

    expect(result.email.ok).toBe(false);
    expect(result.email.error).toBe("smtp gateway down");
  });

  it("tolerates response.text() itself failing when building the error message", async () => {
    const svc = new NotificationService(
      { emailFrom: "a@b.com", slackWebhookUrl: "https://hooks.slack.com/x" },
      makeLogger() as never,
    );
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 503, text: () => Promise.reject(new Error("stream closed")) }),
    );

    const result = await svc.sendHumanRequest(makePayload());

    expect(result.slack.ok).toBe(false);
    expect(result.slack.error).toContain("Slack webhook returned 503");
  });
});

describe("NotificationService.sendHumanRequest -- Slack payload content", () => {
  it("includes plan confidence and open questions in the slack blocks and truncates a long context", async () => {
    const svc = new NotificationService(
      { emailFrom: "a@b.com", slackWebhookUrl: "https://hooks.slack.com/x" },
      makeLogger() as never,
    );
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);

    const longContext = "x".repeat(2000);
    await svc.sendHumanRequest(
      makePayload({
        planConfidence: 0.42,
        context: longContext,
        openQuestions: [
          { id: "q1", question: "Should we use OAuth?", requiredForExecution: true },
          { id: "q2", question: "What about rate limits?", requiredForExecution: false },
        ],
      }),
    );

    const [, options] = fetchMock.mock.calls[0] as [string, { body: string }];
    const body = JSON.parse(options.body) as { text: string; blocks: unknown[] };
    expect(body.text).toContain("ENG-42");
    const serialized = JSON.stringify(body.blocks);
    expect(serialized).toContain("0.42");
    expect(serialized).toContain("2 (1 required)");
    expect(serialized).toContain("Should we use OAuth?");
    // Truncated to 1500 chars + ellipsis, not the full 2000.
    expect(serialized).not.toContain("x".repeat(1600));
  });

  it("omits optional fields (confidence, context, questions) when absent, and uses fallback title text", async () => {
    const svc = new NotificationService(
      { emailFrom: "a@b.com", slackWebhookUrl: "https://hooks.slack.com/x" },
      makeLogger() as never,
    );
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);

    await svc.sendHumanRequest(
      makePayload({
        linearIssue: { id: "lin-1", title: null, url: null },
        planConfidence: undefined,
        context: undefined,
        openQuestions: [],
      }),
    );

    const [, options] = fetchMock.mock.calls[0] as [string, { body: string }];
    const body = JSON.parse(options.body) as { text: string };
    expect(body.text).toContain("lin-1");
    expect(body.text).toContain("(untitled)");
  });

  it("labels every HumanRequestReason distinctly", async () => {
    const reasons: NotificationPayload["reason"][] = [
      "plan_ambiguous",
      "plan_low_confidence",
      "impl_rejected",
      "impl_uncertain",
      "other",
    ];
    const titles = new Set<string>();

    for (const reason of reasons) {
      const svc = new NotificationService(
        { emailFrom: "a@b.com", slackWebhookUrl: "https://hooks.slack.com/x" },
        makeLogger() as never,
      );
      const fetchMock = vi.fn().mockResolvedValue({ ok: true });
      vi.stubGlobal("fetch", fetchMock);

      await svc.sendHumanRequest(makePayload({ reason }));

      const [, options] = fetchMock.mock.calls[0] as [string, { body: string }];
      const body = JSON.parse(options.body) as { text: string };
      titles.add(body.text);
    }

    expect(titles.size).toBe(reasons.length);
  });
});

describe("NotificationService.sendHumanRequest -- Email payload content", () => {
  it("sends to multiple comma-separated recipients, trimmed", async () => {
    const svc = new NotificationService(
      { emailFrom: "noreply@x.com", emailTo: "a@x.com, b@x.com ,c@x.com", resendApiKey: "re_123" },
      makeLogger() as never,
    );
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);

    await svc.sendHumanRequest(makePayload());

    const [url, options] = fetchMock.mock.calls[0] as [string, { body: string; headers: Record<string, string> }];
    expect(url).toBe("https://api.resend.com/emails");
    expect(options.headers.Authorization).toBe("Bearer re_123");
    const body = JSON.parse(options.body) as { to: string[]; from: string };
    expect(body.to).toEqual(["a@x.com", "b@x.com", "c@x.com"]);
    expect(body.from).toBe("noreply@x.com");
  });

  it("renders HTML with escaped content, confidence, context, and open questions", async () => {
    const svc = new NotificationService(
      { emailFrom: "a@b.com", emailTo: "team@b.com", resendApiKey: "re_123" },
      makeLogger() as never,
    );
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);

    await svc.sendHumanRequest(
      makePayload({
        summary: "<script>alert(1)</script>",
        planConfidence: 0.75,
        context: "some context",
        openQuestions: [
          { id: "q1", question: "A & B?", requiredForExecution: true },
          { id: "q2", question: "Optional one?", requiredForExecution: false },
        ],
      }),
    );

    const [, options] = fetchMock.mock.calls[0] as [string, { body: string }];
    const body = JSON.parse(options.body) as { html: string; text: string };
    expect(body.html).not.toContain("<script>alert(1)</script>");
    expect(body.html).toContain("&lt;script&gt;");
    expect(body.html).toContain("0.75");
    expect(body.html).toContain("some context");
    expect(body.html).toContain("A &amp; B?");
    expect(body.html).toContain("<strong>[required]</strong> A &amp; B?");
    expect(body.html).toContain("<li>Optional one?</li>");
    expect(body.html).toContain("Open Linear issue");
    expect(body.text).toContain("Plan confidence: 0.75");
    expect(body.text).toContain("Context:");
    expect(body.text).toContain("Open questions:");
    expect(body.text).toContain("- [required] A & B?");
    expect(body.text).toContain("- Optional one?");
    expect(body.text).toContain("Linear: https://linear.app/x/ENG-42");
  });

  it("omits the linear link and optional blocks in HTML/text when absent", async () => {
    const svc = new NotificationService(
      { emailFrom: "a@b.com", emailTo: "team@b.com", resendApiKey: "re_123" },
      makeLogger() as never,
    );
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);

    await svc.sendHumanRequest(
      makePayload({
        linearIssue: { id: "lin-1", title: null, url: undefined },
        planConfidence: undefined,
        context: undefined,
        openQuestions: undefined,
      }),
    );

    const [, options] = fetchMock.mock.calls[0] as [string, { body: string }];
    const body = JSON.parse(options.body) as { html: string; text: string };
    expect(body.html).not.toContain("Open Linear issue");
    expect(body.text).not.toContain("Linear:");
    expect(body.text).not.toContain("Plan confidence");
  });
});
