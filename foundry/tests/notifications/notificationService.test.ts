import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NotificationService, type NotificationPayload } from "../../src/notifications/notificationService.js";

function makeLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
}

function makePayload(overrides: Partial<NotificationPayload> = {}): NotificationPayload {
  return {
    runId: "run-1",
    reason: "plan_low_confidence",
    summary: "Needs a human look",
    linearIssue: { id: "LIN-1", identifier: "ENG-1", title: "Add login", url: "https://linear.app/x" },
    runState: "AwaitingPlanApproval",
    runUrl: "https://dashboard/run-1",
    ...overrides,
  };
}

describe("NotificationService.isConfigured", () => {
  it("is false when neither slack nor email is configured", () => {
    const service = new NotificationService({ emailFrom: "a@b.com" }, makeLogger() as never);
    expect(service.isConfigured()).toBe(false);
  });

  it("is true when a slack webhook url is set", () => {
    const service = new NotificationService(
      { emailFrom: "a@b.com", slackWebhookUrl: "https://hooks.slack.com/x" },
      makeLogger() as never,
    );
    expect(service.isConfigured()).toBe(true);
  });

  it("is true only when both emailTo and resendApiKey are set", () => {
    const partial = new NotificationService(
      { emailFrom: "a@b.com", emailTo: "to@b.com" },
      makeLogger() as never,
    );
    expect(partial.isConfigured()).toBe(false);

    const full = new NotificationService(
      { emailFrom: "a@b.com", emailTo: "to@b.com", resendApiKey: "key" },
      makeLogger() as never,
    );
    expect(full.isConfigured()).toBe(true);
  });
});

describe("NotificationService.sendHumanRequest", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    global.fetch = vi.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("attempts neither channel and returns an unattempted result when nothing is configured", async () => {
    const service = new NotificationService({ emailFrom: "a@b.com" }, makeLogger() as never);

    const result = await service.sendHumanRequest(makePayload());

    expect(result).toEqual({
      slack: { attempted: false, ok: false },
      email: { attempted: false, ok: false },
    });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("posts to the Slack webhook and reports ok:true on a 2xx response", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true });
    const service = new NotificationService(
      { emailFrom: "a@b.com", slackWebhookUrl: "https://hooks.slack.com/x" },
      makeLogger() as never,
    );

    const result = await service.sendHumanRequest(
      makePayload({
        planConfidence: 0.42,
        openQuestions: [
          { id: "q1", question: "What auth provider?", requiredForExecution: true },
        ],
        context: "some context",
      }),
    );

    expect(result.slack).toEqual({ attempted: true, ok: true });
    expect(global.fetch).toHaveBeenCalledWith(
      "https://hooks.slack.com/x",
      expect.objectContaining({ method: "POST" }),
    );
    const body = JSON.parse((global.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body);
    expect(body.text).toContain("ENG-1");
  });

  it("captures the error and logs a warning when the Slack webhook responds with a non-ok status", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      status: 500,
      text: () => Promise.resolve("server error"),
    });
    const logger = makeLogger();
    const service = new NotificationService(
      { emailFrom: "a@b.com", slackWebhookUrl: "https://hooks.slack.com/x" },
      logger as never,
    );

    const result = await service.sendHumanRequest(makePayload());

    expect(result.slack.ok).toBe(false);
    expect(result.slack.error).toContain("500");
    expect(logger.warn).toHaveBeenCalled();
  });

  it("sends an email via Resend and reports ok:true, splitting multiple recipients", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true });
    const service = new NotificationService(
      { emailFrom: "a@b.com", emailTo: "x@b.com, y@b.com", resendApiKey: "key" },
      makeLogger() as never,
    );

    const result = await service.sendHumanRequest(
      makePayload({ context: "<script>bad</script>", linearIssue: { id: "LIN-1", title: null, url: null } }),
    );

    expect(result.email).toEqual({ attempted: true, ok: true });
    const [url, init] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe("https://api.resend.com/emails");
    const body = JSON.parse(init.body);
    expect(body.to).toEqual(["x@b.com", "y@b.com"]);
    expect(body.html).toContain("&lt;script&gt;");
  });

  it("captures the error and logs a warning when the Resend API responds with a non-ok status", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      status: 422,
      text: () => Promise.resolve("invalid"),
    });
    const logger = makeLogger();
    const service = new NotificationService(
      { emailFrom: "a@b.com", emailTo: "x@b.com", resendApiKey: "key" },
      logger as never,
    );

    const result = await service.sendHumanRequest(makePayload());

    expect(result.email.ok).toBe(false);
    expect(result.email.error).toContain("422");
    expect(logger.warn).toHaveBeenCalled();
  });

  it("attempts both channels concurrently when both are configured", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true });
    const service = new NotificationService(
      {
        emailFrom: "a@b.com",
        emailTo: "x@b.com",
        resendApiKey: "key",
        slackWebhookUrl: "https://hooks.slack.com/x",
      },
      makeLogger() as never,
    );

    const result = await service.sendHumanRequest(makePayload());

    expect(result.slack.attempted).toBe(true);
    expect(result.email.attempted).toBe(true);
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });
});
