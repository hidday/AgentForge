import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  NotificationService,
  type NotificationPayload,
  type HumanRequestReason,
} from "../../src/notifications/notificationService.js";

function makeLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
}

function makePayload(overrides: Partial<NotificationPayload> = {}): NotificationPayload {
  return {
    runId: "run-1",
    reason: "plan_ambiguous",
    summary: "Needs a human decision",
    linearIssue: { id: "LIN-1", title: "Fix the thing", url: "https://linear.app/x" },
    runState: "AwaitingPlanApproval",
    runUrl: "https://foundry.example.com/runs/run-1",
    ...overrides,
  };
}

describe("NotificationService.isConfigured", () => {
  it("is false when neither Slack nor email is configured", () => {
    const svc = new NotificationService({ emailFrom: "a@b.com" }, makeLogger() as never);
    expect(svc.isConfigured()).toBe(false);
  });

  it("is true when a Slack webhook is configured", () => {
    const svc = new NotificationService(
      { emailFrom: "a@b.com", slackWebhookUrl: "https://hooks.slack.com/x" },
      makeLogger() as never,
    );
    expect(svc.isConfigured()).toBe(true);
  });

  it("is true when both emailTo and resendApiKey are configured", () => {
    const svc = new NotificationService(
      { emailFrom: "a@b.com", emailTo: "me@example.com", resendApiKey: "key" },
      makeLogger() as never,
    );
    expect(svc.isConfigured()).toBe(true);
  });

  it("is false when only emailTo is set without an API key", () => {
    const svc = new NotificationService(
      { emailFrom: "a@b.com", emailTo: "me@example.com" },
      makeLogger() as never,
    );
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

  it("attempts neither channel when unconfigured", async () => {
    const svc = new NotificationService({ emailFrom: "a@b.com" }, makeLogger() as never);
    const result = await svc.sendHumanRequest(makePayload());

    expect(result.slack).toEqual({ attempted: false, ok: false });
    expect(result.email).toEqual({ attempted: false, ok: false });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("posts to the Slack webhook and reports success", async () => {
    fetchMock.mockResolvedValue({ ok: true, text: async () => "" });
    const svc = new NotificationService(
      { emailFrom: "a@b.com", slackWebhookUrl: "https://hooks.slack.com/x" },
      makeLogger() as never,
    );

    const result = await svc.sendHumanRequest(makePayload());

    expect(result.slack).toEqual({ attempted: true, ok: true });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://hooks.slack.com/x",
      expect.objectContaining({ method: "POST" }),
    );
    const body = JSON.parse((fetchMock.mock.calls[0]![1] as { body: string }).body);
    expect(body.text).toContain("LIN-1");
    expect(body.text).toContain("Fix the thing");
  });

  it("records a Slack failure without throwing, and logs a warning", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500, text: async () => "server error" });
    const logger = makeLogger();
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

  it("sends email via Resend when emailTo and resendApiKey are both configured", async () => {
    fetchMock.mockResolvedValue({ ok: true, text: async () => "" });
    const svc = new NotificationService(
      { emailFrom: "a@b.com", emailTo: "me@example.com, you@example.com", resendApiKey: "key" },
      makeLogger() as never,
    );

    const result = await svc.sendHumanRequest(makePayload());

    expect(result.email).toEqual({ attempted: true, ok: true });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.resend.com/emails",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ Authorization: "Bearer key" }),
      }),
    );
    const body = JSON.parse((fetchMock.mock.calls[0]![1] as { body: string }).body);
    expect(body.to).toEqual(["me@example.com", "you@example.com"]);
  });

  it("records an email failure without throwing, and logs a warning", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 422, text: async () => "bad request" });
    const logger = makeLogger();
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
    fetchMock.mockResolvedValue({ ok: true, text: async () => "" });
    const svc = new NotificationService(
      {
        emailFrom: "a@b.com",
        emailTo: "me@example.com",
        resendApiKey: "key",
        slackWebhookUrl: "https://hooks.slack.com/x",
      },
      makeLogger() as never,
    );

    const result = await svc.sendHumanRequest(makePayload());

    expect(result.slack.ok).toBe(true);
    expect(result.email.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("includes planConfidence, open questions, and context in the Slack payload when present", async () => {
    fetchMock.mockResolvedValue({ ok: true, text: async () => "" });
    const svc = new NotificationService(
      { emailFrom: "a@b.com", slackWebhookUrl: "https://hooks.slack.com/x" },
      makeLogger() as never,
    );

    await svc.sendHumanRequest(
      makePayload({
        planConfidence: 0.42,
        context: "x".repeat(2000),
        openQuestions: [
          { id: "q1", question: "What about edge case A?", requiredForExecution: true },
          { id: "q2", question: "y".repeat(300), requiredForExecution: false },
        ],
      }),
    );

    const body = JSON.parse((fetchMock.mock.calls[0]![1] as { body: string }).body);
    const serialized = JSON.stringify(body);
    expect(serialized).toContain("0.42");
    expect(serialized).toContain("[required]");
    expect(serialized).toContain("…");
  });

  it("handles a payload with no linear issue url and no identifier", async () => {
    fetchMock.mockResolvedValue({ ok: true, text: async () => "" });
    const svc = new NotificationService(
      { emailFrom: "a@b.com", slackWebhookUrl: "https://hooks.slack.com/x" },
      makeLogger() as never,
    );

    await svc.sendHumanRequest(
      makePayload({
        linearIssue: { id: "LIN-2", title: null, url: null },
      }),
    );

    const body = JSON.parse((fetchMock.mock.calls[0]![1] as { body: string }).body);
    expect(JSON.stringify(body)).toContain("(untitled)");
  });

  it.each<[HumanRequestReason, string]>([
    ["plan_ambiguous", "ambiguous"],
    ["plan_low_confidence", "low confidence"],
    ["impl_rejected", "rejected by agent"],
    ["impl_uncertain", "uncertain"],
    ["other", "Human intervention requested"],
  ])("renders the reason label for %s", async (reason, expectedSubstring) => {
    fetchMock.mockResolvedValue({ ok: true, text: async () => "" });
    const svc = new NotificationService(
      { emailFrom: "a@b.com", slackWebhookUrl: "https://hooks.slack.com/x" },
      makeLogger() as never,
    );

    await svc.sendHumanRequest(makePayload({ reason }));

    const body = JSON.parse((fetchMock.mock.calls[0]![1] as { body: string }).body);
    expect(body.text).toContain(expectedSubstring);
  });

  it("escapes HTML special characters in the rendered email body", async () => {
    fetchMock.mockResolvedValue({ ok: true, text: async () => "" });
    const svc = new NotificationService(
      { emailFrom: "a@b.com", emailTo: "me@example.com", resendApiKey: "key" },
      makeLogger() as never,
    );

    await svc.sendHumanRequest(
      makePayload({
        linearIssue: { id: "LIN-1", title: "<script>alert(1)</script>", url: null },
        openQuestions: [
          { id: "q1", question: "A & B <tag>", requiredForExecution: true },
        ],
      }),
    );

    const body = JSON.parse((fetchMock.mock.calls[0]![1] as { body: string }).body);
    expect(body.html).not.toContain("<script>alert(1)</script>");
    expect(body.html).toContain("&lt;script&gt;");
    expect(body.html).toContain("&amp;");
  });

  it("includes context and open questions in the plain-text email body", async () => {
    fetchMock.mockResolvedValue({ ok: true, text: async () => "" });
    const svc = new NotificationService(
      { emailFrom: "a@b.com", emailTo: "me@example.com", resendApiKey: "key" },
      makeLogger() as never,
    );

    await svc.sendHumanRequest(
      makePayload({
        context: "some important context",
        planConfidence: 0.75,
        openQuestions: [{ id: "q1", question: "Really?", requiredForExecution: true }],
      }),
    );

    const body = JSON.parse((fetchMock.mock.calls[0]![1] as { body: string }).body);
    expect(body.text).toContain("some important context");
    expect(body.text).toContain("0.75");
    expect(body.text).toContain("[required] Really?");
  });
});
