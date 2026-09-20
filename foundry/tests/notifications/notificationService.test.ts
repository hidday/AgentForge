import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  NotificationService,
  type NotificationConfig,
  type NotificationPayload,
} from "../../src/notifications/notificationService.js";

function makeLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
}

function makePayload(overrides: Partial<NotificationPayload> = {}): NotificationPayload {
  return {
    runId: "run-1",
    reason: "plan_ambiguous",
    summary: "The plan is unclear about auth handling.",
    linearIssue: {
      id: "LIN-1",
      identifier: "LIN-1",
      title: "Add auth",
      url: "https://linear.app/team/issue/LIN-1",
    },
    runState: "AwaitingPlanApproval",
    runUrl: "https://app.example.com/runs/run-1",
    ...overrides,
  };
}

describe("NotificationService.isConfigured", () => {
  const logger = makeLogger();

  it("is false when neither Slack nor email is configured", () => {
    const service = new NotificationService({ emailFrom: "bot@example.com" }, logger as never);
    expect(service.isConfigured()).toBe(false);
  });

  it("is true when a Slack webhook URL is set", () => {
    const service = new NotificationService(
      { emailFrom: "bot@example.com", slackWebhookUrl: "https://hooks.slack.com/x" },
      logger as never,
    );
    expect(service.isConfigured()).toBe(true);
  });

  it("is true when both emailTo and resendApiKey are set", () => {
    const service = new NotificationService(
      { emailFrom: "bot@example.com", emailTo: "you@example.com", resendApiKey: "key" },
      logger as never,
    );
    expect(service.isConfigured()).toBe(true);
  });

  it("is false when only emailTo is set without an API key", () => {
    const service = new NotificationService(
      { emailFrom: "bot@example.com", emailTo: "you@example.com" },
      logger as never,
    );
    expect(service.isConfigured()).toBe(false);
  });
});

describe("NotificationService.sendHumanRequest", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let logger: ReturnType<typeof makeLogger>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    logger = makeLogger();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function baseConfig(overrides: Partial<NotificationConfig> = {}): NotificationConfig {
    return { emailFrom: "bot@example.com", ...overrides };
  }

  it("does not attempt any channel when nothing is configured", async () => {
    const service = new NotificationService(baseConfig(), logger as never);

    const result = await service.sendHumanRequest(makePayload());

    expect(result.slack).toEqual({ attempted: false, ok: false });
    expect(result.email).toEqual({ attempted: false, ok: false });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sends a Slack message with header, summary, and action buttons when a webhook is configured", async () => {
    fetchMock.mockResolvedValue({ ok: true, text: async () => "" });
    const service = new NotificationService(
      baseConfig({ slackWebhookUrl: "https://hooks.slack.com/x" }),
      logger as never,
    );

    const result = await service.sendHumanRequest(makePayload());

    expect(result.slack).toEqual({ attempted: true, ok: true });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://hooks.slack.com/x",
      expect.objectContaining({ method: "POST" }),
    );
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string) as {
      text: string;
      blocks: unknown[];
    };
    expect(body.text).toContain("LIN-1");
    expect(body.text).toContain("Add auth");
    expect(body.blocks.length).toBeGreaterThan(0);
  });

  it("includes plan confidence and open questions fields in the Slack payload when present", async () => {
    fetchMock.mockResolvedValue({ ok: true, text: async () => "" });
    const service = new NotificationService(
      baseConfig({ slackWebhookUrl: "https://hooks.slack.com/x" }),
      logger as never,
    );

    await service.sendHumanRequest(
      makePayload({
        planConfidence: 0.42,
        context: "Some extra context",
        openQuestions: [
          { id: "q1", question: "Is X required?", requiredForExecution: true },
          { id: "q2", question: "Is Y optional?", requiredForExecution: false },
        ],
      }),
    );

    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string) as { blocks: unknown[] };
    const serialized = JSON.stringify(body);
    expect(serialized).toContain("0.42");
    expect(serialized).toContain("Some extra context");
    expect(serialized).toContain("Is X required?");
    expect(serialized).toContain("required");
  });

  it("truncates very long context in the Slack payload", async () => {
    fetchMock.mockResolvedValue({ ok: true, text: async () => "" });
    const service = new NotificationService(
      baseConfig({ slackWebhookUrl: "https://hooks.slack.com/x" }),
      logger as never,
    );
    const longContext = "x".repeat(2000);

    await service.sendHumanRequest(makePayload({ context: longContext }));

    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string) as { blocks: unknown[] };
    const serialized = JSON.stringify(body);
    expect(serialized).toContain("…");
    expect(serialized.length).toBeLessThan(longContext.length + 500);
  });

  it("records a Slack failure and logs a warning without throwing when the webhook returns non-ok", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500, text: async () => "server error" });
    const service = new NotificationService(
      baseConfig({ slackWebhookUrl: "https://hooks.slack.com/x" }),
      logger as never,
    );

    const result = await service.sendHumanRequest(makePayload());

    expect(result.slack.ok).toBe(false);
    expect(result.slack.error).toContain("500");
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ runId: "run-1" }),
      "Slack notification failed",
    );
  });

  it("records a Slack failure when the fetch call itself rejects", async () => {
    fetchMock.mockRejectedValue(new Error("network down"));
    const service = new NotificationService(
      baseConfig({ slackWebhookUrl: "https://hooks.slack.com/x" }),
      logger as never,
    );

    const result = await service.sendHumanRequest(makePayload());

    expect(result.slack.ok).toBe(false);
    expect(result.slack.error).toBe("network down");
  });

  it("sends an email via Resend with subject, html, and text bodies when configured", async () => {
    fetchMock.mockResolvedValue({ ok: true, text: async () => "" });
    const service = new NotificationService(
      baseConfig({ emailTo: "a@example.com, b@example.com", resendApiKey: "resend-key" }),
      logger as never,
    );

    const result = await service.sendHumanRequest(makePayload());

    expect(result.email).toEqual({ attempted: true, ok: true });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.resend.com/emails",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ Authorization: "Bearer resend-key" }),
      }),
    );
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string) as {
      to: string[];
      subject: string;
      html: string;
      text: string;
    };
    expect(body.to).toEqual(["a@example.com", "b@example.com"]);
    expect(body.subject).toContain("LIN-1");
    expect(body.html).toContain("Add auth");
    expect(body.text).toContain("Add auth");
  });

  it("escapes HTML-sensitive characters in the email body", async () => {
    fetchMock.mockResolvedValue({ ok: true, text: async () => "" });
    const service = new NotificationService(
      baseConfig({ emailTo: "a@example.com", resendApiKey: "key" }),
      logger as never,
    );

    await service.sendHumanRequest(
      makePayload({
        summary: `<script>alert("x")</script> & 'quote'`,
        linearIssue: { id: "LIN-1", title: "T", url: null },
      }),
    );

    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string) as { html: string };
    expect(body.html).not.toContain("<script>");
    expect(body.html).toContain("&lt;script&gt;");
    expect(body.html).toContain("&amp;");
  });

  it("records an email failure and logs a warning without throwing when Resend returns non-ok", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 422, text: async () => "bad request" });
    const service = new NotificationService(
      baseConfig({ emailTo: "a@example.com", resendApiKey: "key" }),
      logger as never,
    );

    const result = await service.sendHumanRequest(makePayload());

    expect(result.email.ok).toBe(false);
    expect(result.email.error).toContain("422");
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ runId: "run-1" }),
      "Email notification failed",
    );
  });

  it("sends both Slack and email concurrently and reports independent results when one fails", async () => {
    fetchMock.mockImplementation((url: string) => {
      if (url.includes("slack")) {
        return Promise.resolve({ ok: true, text: async () => "" });
      }
      return Promise.resolve({ ok: false, status: 500, text: async () => "boom" });
    });
    const service = new NotificationService(
      baseConfig({
        slackWebhookUrl: "https://hooks.slack.com/x",
        emailTo: "a@example.com",
        resendApiKey: "key",
      }),
      logger as never,
    );

    const result = await service.sendHumanRequest(makePayload());

    expect(result.slack).toEqual({ attempted: true, ok: true });
    expect(result.email.attempted).toBe(true);
    expect(result.email.ok).toBe(false);
  });

  it("renders each human request reason with a distinct human-readable label", async () => {
    fetchMock.mockResolvedValue({ ok: true, text: async () => "" });
    const service = new NotificationService(
      baseConfig({ slackWebhookUrl: "https://hooks.slack.com/x" }),
      logger as never,
    );

    const reasons: NotificationPayload["reason"][] = [
      "plan_ambiguous",
      "plan_low_confidence",
      "impl_rejected",
      "impl_uncertain",
      "other",
    ];
    const titles: string[] = [];
    for (const reason of reasons) {
      await service.sendHumanRequest(makePayload({ reason }));
      const body = JSON.parse(
        fetchMock.mock.calls[fetchMock.mock.calls.length - 1][1].body as string,
      ) as { text: string };
      titles.push(body.text);
    }

    expect(new Set(titles).size).toBe(reasons.length);
  });

  it("falls back to '(untitled)' when the Linear issue has no title", async () => {
    fetchMock.mockResolvedValue({ ok: true, text: async () => "" });
    const service = new NotificationService(
      baseConfig({ slackWebhookUrl: "https://hooks.slack.com/x" }),
      logger as never,
    );

    await service.sendHumanRequest(
      makePayload({ linearIssue: { id: "LIN-2", title: null, url: null } }),
    );

    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string) as { text: string };
    expect(body.text).toContain("(untitled)");
    expect(body.text).toContain("LIN-2");
  });
});
