import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  NotificationService,
  type NotificationConfig,
  type NotificationPayload,
} from "../../src/notifications/notificationService.js";

function makePayload(overrides: Partial<NotificationPayload> = {}): NotificationPayload {
  return {
    runId: "run-1",
    reason: "plan_ambiguous",
    summary: "Needs a human decision",
    linearIssue: { id: "issue-1", identifier: "ENG-1", title: "Add feature", url: "https://linear.app/x" },
    runState: "HumanClarificationNeeded",
    runUrl: "https://foundry.example.com/runs/run-1",
    ...overrides,
  };
}

function makeLogger() {
  return { warn: vi.fn(), info: vi.fn(), error: vi.fn() } as unknown as import("pino").Logger;
}

describe("NotificationService.isConfigured", () => {
  it("is true when a Slack webhook URL is set", () => {
    const service = new NotificationService(
      { emailFrom: "a@b.com", slackWebhookUrl: "https://hooks.slack.com/x" },
      makeLogger(),
    );
    expect(service.isConfigured()).toBe(true);
  });

  it("is true when both emailTo and resendApiKey are set", () => {
    const service = new NotificationService(
      { emailFrom: "a@b.com", emailTo: "to@b.com", resendApiKey: "key" },
      makeLogger(),
    );
    expect(service.isConfigured()).toBe(true);
  });

  it("is false when emailTo is set without a resendApiKey", () => {
    const service = new NotificationService({ emailFrom: "a@b.com", emailTo: "to@b.com" }, makeLogger());
    expect(service.isConfigured()).toBe(false);
  });

  it("is false when nothing is configured", () => {
    const service = new NotificationService({ emailFrom: "a@b.com" }, makeLogger());
    expect(service.isConfigured()).toBe(false);
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

  it("does nothing (no attempts) when nothing is configured", async () => {
    const service = new NotificationService({ emailFrom: "a@b.com" }, makeLogger());
    const result = await service.sendHumanRequest(makePayload());

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result).toEqual({
      slack: { attempted: false, ok: false },
      email: { attempted: false, ok: false },
    });
  });

  it("posts to the Slack webhook and reports ok on success", async () => {
    fetchMock.mockResolvedValue({ ok: true });
    const config: NotificationConfig = {
      emailFrom: "a@b.com",
      slackWebhookUrl: "https://hooks.slack.com/x",
    };
    const service = new NotificationService(config, makeLogger());

    const result = await service.sendHumanRequest(
      makePayload({
        planConfidence: 0.42,
        context: "some context",
        openQuestions: [
          { id: "q1", question: "What about X?", requiredForExecution: true },
          { id: "q2", question: "And Y?", requiredForExecution: false },
        ],
      }),
    );

    expect(fetchMock).toHaveBeenCalledWith(
      "https://hooks.slack.com/x",
      expect.objectContaining({ method: "POST" }),
    );
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.text).toContain("ENG-1");
    expect(result.slack).toEqual({ attempted: true, ok: true });
    expect(result.email.attempted).toBe(false);
  });

  it("records a Slack failure (non-ok response) without throwing, and logs a warning", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500, text: () => Promise.resolve("server error") });
    const logger = makeLogger();
    const service = new NotificationService(
      { emailFrom: "a@b.com", slackWebhookUrl: "https://hooks.slack.com/x" },
      logger,
    );

    const result = await service.sendHumanRequest(makePayload());

    expect(result.slack).toEqual({
      attempted: true,
      ok: false,
      error: expect.stringContaining("500"),
    });
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ runId: "run-1" }),
      "Slack notification failed",
    );
  });

  it("sends an email via Resend and reports ok on success, splitting comma-separated recipients", async () => {
    fetchMock.mockResolvedValue({ ok: true });
    const config: NotificationConfig = {
      emailFrom: "from@b.com",
      emailTo: "to1@b.com, to2@b.com",
      resendApiKey: "key-123",
    };
    const service = new NotificationService(config, makeLogger());

    const result = await service.sendHumanRequest(makePayload({ planConfidence: 0.9 }));

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.resend.com/emails",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ Authorization: "Bearer key-123" }),
      }),
    );
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.to).toEqual(["to1@b.com", "to2@b.com"]);
    expect(body.html).toContain("ENG-1");
    expect(result.email).toEqual({ attempted: true, ok: true });
  });

  it("renders open questions in both the HTML and text email bodies, marking required ones", async () => {
    fetchMock.mockResolvedValue({ ok: true });
    const config: NotificationConfig = {
      emailFrom: "from@b.com",
      emailTo: "to@b.com",
      resendApiKey: "key-123",
    };
    const service = new NotificationService(config, makeLogger());

    await service.sendHumanRequest(
      makePayload({
        context: "Some extra context for the reviewer.",
        openQuestions: [
          { id: "q1", question: "What about X?", requiredForExecution: true },
          { id: "q2", question: "And Y?", requiredForExecution: false },
        ],
      }),
    );

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.html).toContain("Open questions:");
    expect(body.html).toContain("<strong>[required]</strong>");
    expect(body.html).toContain("What about X?");
    expect(body.html).toContain("And Y?");
    expect(body.html).toContain("Some extra context for the reviewer.");

    expect(body.text).toContain("Open questions:");
    expect(body.text).toContain("- [required] What about X?");
    expect(body.text).toContain("- And Y?");
    expect(body.text).toContain("Context:");
  });

  it("omits the open-questions and context sections entirely when neither is provided", async () => {
    fetchMock.mockResolvedValue({ ok: true });
    const config: NotificationConfig = {
      emailFrom: "from@b.com",
      emailTo: "to@b.com",
      resendApiKey: "key-123",
    };
    const service = new NotificationService(config, makeLogger());

    await service.sendHumanRequest(makePayload());

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.html).not.toContain("Open questions:");
    expect(body.text).not.toContain("Open questions:");
    expect(body.text).not.toContain("Context:");
  });

  it("records an email failure without throwing, and logs a warning", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 401, text: () => Promise.resolve("unauthorized") });
    const logger = makeLogger();
    const service = new NotificationService(
      { emailFrom: "from@b.com", emailTo: "to@b.com", resendApiKey: "bad-key" },
      logger,
    );

    const result = await service.sendHumanRequest(makePayload());

    expect(result.email).toEqual({
      attempted: true,
      ok: false,
      error: expect.stringContaining("401"),
    });
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ runId: "run-1" }),
      "Email notification failed",
    );
  });

  it("attempts both Slack and email concurrently when both are configured", async () => {
    fetchMock.mockResolvedValue({ ok: true });
    const config: NotificationConfig = {
      emailFrom: "from@b.com",
      emailTo: "to@b.com",
      resendApiKey: "key",
      slackWebhookUrl: "https://hooks.slack.com/x",
    };
    const service = new NotificationService(config, makeLogger());

    const result = await service.sendHumanRequest(makePayload());

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.slack).toEqual({ attempted: true, ok: true });
    expect(result.email).toEqual({ attempted: true, ok: true });
  });

  it("renders every HumanRequestReason to a distinct, non-empty label", async () => {
    fetchMock.mockResolvedValue({ ok: true });
    const config: NotificationConfig = {
      emailFrom: "a@b.com",
      slackWebhookUrl: "https://hooks.slack.com/x",
    };
    const service = new NotificationService(config, makeLogger());
    const reasons: NotificationPayload["reason"][] = [
      "plan_ambiguous",
      "plan_low_confidence",
      "impl_rejected",
      "impl_uncertain",
      "other",
    ];
    const labels = new Set<string>();

    for (const reason of reasons) {
      fetchMock.mockClear();
      await service.sendHumanRequest(makePayload({ reason }));
      const body = JSON.parse(fetchMock.mock.calls[0][1].body);
      expect(body.text.length).toBeGreaterThan(0);
      labels.add(body.text);
    }

    expect(labels.size).toBe(reasons.length);
  });

  it("escapes HTML special characters in the email body", async () => {
    fetchMock.mockResolvedValue({ ok: true });
    const config: NotificationConfig = {
      emailFrom: "a@b.com",
      emailTo: "to@b.com",
      resendApiKey: "key",
    };
    const service = new NotificationService(config, makeLogger());

    await service.sendHumanRequest(
      makePayload({
        summary: '<script>alert("x")</script>',
        linearIssue: { id: "issue-1", title: "<b>bold</b> & co", url: null },
      }),
    );

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.html).not.toContain("<script>");
    expect(body.html).toContain("&lt;script&gt;");
    expect(body.html).toContain("&amp;");
  });

  it("falls back to '(untitled)' when the linear issue has no title, and omits the Linear link when absent", async () => {
    fetchMock.mockResolvedValue({ ok: true });
    const config: NotificationConfig = {
      emailFrom: "a@b.com",
      emailTo: "to@b.com",
      resendApiKey: "key",
    };
    const service = new NotificationService(config, makeLogger());

    await service.sendHumanRequest(
      makePayload({ linearIssue: { id: "issue-1", title: null, url: null } }),
    );

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.subject).toContain("(untitled)");
    expect(body.text).not.toMatch(/Linear:/);
  });

  it("truncates long context in both Slack and email bodies", async () => {
    fetchMock.mockResolvedValue({ ok: true });
    const longContext = "x".repeat(3000);
    const config: NotificationConfig = {
      emailFrom: "a@b.com",
      emailTo: "to@b.com",
      resendApiKey: "key",
      slackWebhookUrl: "https://hooks.slack.com/x",
    };
    const service = new NotificationService(config, makeLogger());

    await service.sendHumanRequest(makePayload({ context: longContext }));

    const slackBody = JSON.parse(fetchMock.mock.calls[0][1].body);
    const slackContextBlock = JSON.stringify(slackBody.blocks);
    expect(slackContextBlock).toContain("…");
    expect(slackContextBlock.length).toBeLessThan(longContext.length);

    const emailBody = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(emailBody.text).toContain("…");
  });
});
