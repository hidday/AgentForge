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
    summary: "The plan has ambiguous requirements.",
    linearIssue: { id: "issue-1", identifier: "ENG-42", title: "Add feature", url: "https://linear.app/x" },
    runState: "AwaitingPlanApproval",
    runUrl: "https://app.example.com/runs/run-1",
    ...overrides,
  };
}

describe("NotificationService.isConfigured", () => {
  const logger = makeLogger();

  it("is true when a Slack webhook is configured", () => {
    const svc = new NotificationService({ emailFrom: "a@b.com", slackWebhookUrl: "https://hooks.slack.com/x" }, logger as never);
    expect(svc.isConfigured()).toBe(true);
  });

  it("is true when both emailTo and resendApiKey are configured", () => {
    const svc = new NotificationService(
      { emailFrom: "a@b.com", emailTo: "me@example.com", resendApiKey: "key" },
      logger as never,
    );
    expect(svc.isConfigured()).toBe(true);
  });

  it("is false when emailTo is set but resendApiKey is missing", () => {
    const svc = new NotificationService({ emailFrom: "a@b.com", emailTo: "me@example.com" }, logger as never);
    expect(svc.isConfigured()).toBe(false);
  });

  it("is false when nothing is configured", () => {
    const svc = new NotificationService({ emailFrom: "a@b.com" }, logger as never);
    expect(svc.isConfigured()).toBe(false);
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

  it("attempts neither channel when nothing is configured", async () => {
    const svc = new NotificationService({ emailFrom: "a@b.com" }, logger as never);
    const result = await svc.sendHumanRequest(makePayload());
    expect(result).toEqual({
      slack: { attempted: false, ok: false },
      email: { attempted: false, ok: false },
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sends a Slack notification and reports ok on a successful webhook response", async () => {
    fetchMock.mockResolvedValue({ ok: true });
    const config: NotificationConfig = {
      emailFrom: "a@b.com",
      slackWebhookUrl: "https://hooks.slack.com/x",
    };
    const svc = new NotificationService(config, logger as never);

    const result = await svc.sendHumanRequest(
      makePayload({
        planConfidence: 0.42,
        openQuestions: [
          { id: "q1", question: "Should we use OAuth?", requiredForExecution: true },
          { id: "q2", question: "Which DB?", requiredForExecution: false },
        ],
        context: "x".repeat(2000),
      }),
    );

    expect(result.slack).toEqual({ attempted: true, ok: true });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://hooks.slack.com/x",
      expect.objectContaining({ method: "POST" }),
    );
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.text).toContain("ENG-42");
    expect(body.blocks).toBeInstanceOf(Array);
  });

  it("records a Slack failure and logs a warning when the webhook responds with an error", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500, text: () => Promise.resolve("boom") });
    const svc = new NotificationService(
      { emailFrom: "a@b.com", slackWebhookUrl: "https://hooks.slack.com/x" },
      logger as never,
    );

    const result = await svc.sendHumanRequest(makePayload());

    expect(result.slack.attempted).toBe(true);
    expect(result.slack.ok).toBe(false);
    expect(result.slack.error).toContain("500");
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ runId: "run-1" }),
      "Slack notification failed",
    );
  });

  it("records a Slack failure when fetch itself rejects", async () => {
    fetchMock.mockRejectedValue(new Error("network down"));
    const svc = new NotificationService(
      { emailFrom: "a@b.com", slackWebhookUrl: "https://hooks.slack.com/x" },
      logger as never,
    );

    const result = await svc.sendHumanRequest(makePayload());
    expect(result.slack.ok).toBe(false);
    expect(result.slack.error).toBe("network down");
  });

  it("sends an email via Resend and reports ok on success", async () => {
    fetchMock.mockResolvedValue({ ok: true });
    const svc = new NotificationService(
      { emailFrom: "AgentForge <a@b.com>", emailTo: "me@example.com, you@example.com", resendApiKey: "key" },
      logger as never,
    );

    const result = await svc.sendHumanRequest(
      makePayload({
        reason: "impl_rejected",
        planConfidence: 0.9,
        context: "some context",
        openQuestions: [{ id: "q1", question: "ok?", requiredForExecution: true }],
        linearIssue: { id: "issue-1", title: null, url: null },
      }),
    );

    expect(result.email).toEqual({ attempted: true, ok: true });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.resend.com/emails",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ Authorization: "Bearer key" }),
      }),
    );
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.to).toEqual(["me@example.com", "you@example.com"]);
    expect(body.html).toContain("(untitled)");
    expect(body.text).toContain("(untitled)");
  });

  it("records an email failure and logs a warning on a non-ok Resend response", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 422, text: () => Promise.resolve("bad request") });
    const svc = new NotificationService(
      { emailFrom: "a@b.com", emailTo: "me@example.com", resendApiKey: "key" },
      logger as never,
    );

    const result = await svc.sendHumanRequest(makePayload());

    expect(result.email.ok).toBe(false);
    expect(result.email.error).toContain("422");
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ runId: "run-1" }),
      "Email notification failed",
    );
  });

  it("sends both channels concurrently when both are configured", async () => {
    fetchMock.mockResolvedValue({ ok: true });
    const svc = new NotificationService(
      {
        emailFrom: "a@b.com",
        emailTo: "me@example.com",
        resendApiKey: "key",
        slackWebhookUrl: "https://hooks.slack.com/x",
      },
      logger as never,
    );

    const result = await svc.sendHumanRequest(makePayload());

    expect(result.slack).toEqual({ attempted: true, ok: true });
    expect(result.email).toEqual({ attempted: true, ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it.each([
    ["plan_ambiguous", "Plan needs review (ambiguous)"],
    ["plan_low_confidence", "Plan needs review (low confidence)"],
    ["impl_rejected", "Implementation needs review (rejected by agent)"],
    ["impl_uncertain", "Implementation needs review (uncertain)"],
    ["other", "Human intervention requested"],
  ] as const)("renders the correct label for reason=%s", async (reason, expectedLabel) => {
    fetchMock.mockResolvedValue({ ok: true });
    const svc = new NotificationService(
      { emailFrom: "a@b.com", slackWebhookUrl: "https://hooks.slack.com/x" },
      logger as never,
    );

    await svc.sendHumanRequest(makePayload({ reason }));

    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.text).toContain(expectedLabel);
  });

  it("escapes HTML-sensitive characters in the email body", async () => {
    fetchMock.mockResolvedValue({ ok: true });
    const svc = new NotificationService(
      { emailFrom: "a@b.com", emailTo: "me@example.com", resendApiKey: "key" },
      logger as never,
    );

    await svc.sendHumanRequest(
      makePayload({
        summary: `<script>alert("x")</script> & 'quoted'`,
        linearIssue: { id: "issue-1", title: "<b>bold</b>", url: null },
      }),
    );

    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.html).not.toContain("<script>");
    expect(body.html).toContain("&lt;script&gt;");
    expect(body.html).toContain("&amp;");
  });
});
