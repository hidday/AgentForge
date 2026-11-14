import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  NotificationService,
  type NotificationConfig,
  type NotificationPayload,
} from "../../src/notifications/notificationService.js";

function makeLogger() {
  return { warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn() };
}

function makePayload(overrides: Partial<NotificationPayload> = {}): NotificationPayload {
  return {
    runId: "run-1",
    reason: "plan_ambiguous",
    summary: "The plan is unclear on auth strategy",
    linearIssue: { id: "li-1", identifier: "ENG-1", title: "Add login", url: "https://linear.app/issue/ENG-1" },
    runState: "AwaitingPlanApproval",
    runUrl: "http://localhost:5173/runs/run-1",
    ...overrides,
  };
}

describe("NotificationService.isConfigured", () => {
  it("is true when a Slack webhook URL is set", () => {
    const service = new NotificationService(
      { emailFrom: "a@b.com", slackWebhookUrl: "https://hooks.slack.com/x" },
      makeLogger() as never,
    );
    expect(service.isConfigured()).toBe(true);
  });

  it("is true when both emailTo and resendApiKey are set", () => {
    const service = new NotificationService(
      { emailFrom: "a@b.com", emailTo: "user@example.com", resendApiKey: "key" },
      makeLogger() as never,
    );
    expect(service.isConfigured()).toBe(true);
  });

  it("is false when email is only partially configured", () => {
    const service = new NotificationService(
      { emailFrom: "a@b.com", emailTo: "user@example.com" },
      makeLogger() as never,
    );
    expect(service.isConfigured()).toBe(false);
  });

  it("is false when nothing is configured", () => {
    const service = new NotificationService({ emailFrom: "a@b.com" }, makeLogger() as never);
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

  it("does nothing and attempts no channel when unconfigured", async () => {
    const service = new NotificationService({ emailFrom: "a@b.com" }, makeLogger() as never);

    const result = await service.sendHumanRequest(makePayload());

    expect(result).toEqual({
      slack: { attempted: false, ok: false },
      email: { attempted: false, ok: false },
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sends a Slack message and reports success", async () => {
    fetchMock.mockResolvedValue({ ok: true });
    const config: NotificationConfig = {
      emailFrom: "a@b.com",
      slackWebhookUrl: "https://hooks.slack.com/x",
    };
    const service = new NotificationService(config, makeLogger() as never);

    const result = await service.sendHumanRequest(makePayload());

    expect(result.slack).toEqual({ attempted: true, ok: true });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://hooks.slack.com/x",
      expect.objectContaining({ method: "POST" }),
    );
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.text).toContain("ENG-1");
    expect(body.text).toContain("Plan needs review (ambiguous)");
  });

  it("includes plan confidence and open questions in the Slack payload when present", async () => {
    fetchMock.mockResolvedValue({ ok: true });
    const service = new NotificationService(
      { emailFrom: "a@b.com", slackWebhookUrl: "https://hooks.slack.com/x" },
      makeLogger() as never,
    );

    await service.sendHumanRequest(
      makePayload({
        planConfidence: 0.42,
        context: "x".repeat(2000),
        openQuestions: [
          { id: "q1", question: "y".repeat(300), requiredForExecution: true },
          { id: "q2", question: "second question", requiredForExecution: false },
        ],
      }),
    );

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    const flattened = JSON.stringify(body.blocks);
    expect(flattened).toContain("0.42");
    expect(flattened).toContain("[required]");
    expect(flattened).toContain("…");
  });

  it("reports a Slack failure when the webhook responds with a non-ok status", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500, text: () => Promise.resolve("boom") });
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

  it("reports a Slack failure when fetch itself rejects", async () => {
    fetchMock.mockRejectedValue(new Error("network down"));
    const service = new NotificationService(
      { emailFrom: "a@b.com", slackWebhookUrl: "https://hooks.slack.com/x" },
      makeLogger() as never,
    );

    const result = await service.sendHumanRequest(makePayload());

    expect(result.slack.error).toBe("network down");
  });

  it("sends an email via Resend and reports success, splitting multiple recipients", async () => {
    fetchMock.mockResolvedValue({ ok: true });
    const service = new NotificationService(
      {
        emailFrom: "AgentForge <noreply@agentforge.dev>",
        emailTo: "a@example.com, b@example.com",
        resendApiKey: "key-123",
      },
      makeLogger() as never,
    );

    const result = await service.sendHumanRequest(makePayload());

    expect(result.email).toEqual({ attempted: true, ok: true });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.resend.com/emails",
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: "Bearer key-123" }),
      }),
    );
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.to).toEqual(["a@example.com", "b@example.com"]);
    expect(body.html).toContain("Add login");
    expect(body.text).toContain("Run: http://localhost:5173/runs/run-1");
  });

  it("escapes HTML-significant characters in the rendered email", async () => {
    fetchMock.mockResolvedValue({ ok: true });
    const service = new NotificationService(
      { emailFrom: "a@b.com", emailTo: "user@example.com", resendApiKey: "key" },
      makeLogger() as never,
    );

    await service.sendHumanRequest(
      makePayload({ summary: `<script>alert("x")</script>` }),
    );

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.html).not.toContain("<script>alert");
    expect(body.html).toContain("&lt;script&gt;");
  });

  it("reports an email failure when Resend responds with a non-ok status", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 422, text: () => Promise.resolve("bad request") });
    const logger = makeLogger();
    const service = new NotificationService(
      { emailFrom: "a@b.com", emailTo: "user@example.com", resendApiKey: "key" },
      logger as never,
    );

    const result = await service.sendHumanRequest(makePayload());

    expect(result.email.ok).toBe(false);
    expect(result.email.error).toContain("422");
    expect(logger.warn).toHaveBeenCalled();
  });

  it("attempts both Slack and email concurrently when both are configured", async () => {
    fetchMock.mockResolvedValue({ ok: true });
    const service = new NotificationService(
      {
        emailFrom: "a@b.com",
        slackWebhookUrl: "https://hooks.slack.com/x",
        emailTo: "user@example.com",
        resendApiKey: "key",
      },
      makeLogger() as never,
    );

    const result = await service.sendHumanRequest(makePayload());

    expect(result.slack.attempted).toBe(true);
    expect(result.email.attempted).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("renders the untitled fallback and omits optional sections when fields are absent", async () => {
    fetchMock.mockResolvedValue({ ok: true });
    const service = new NotificationService(
      { emailFrom: "a@b.com", emailTo: "user@example.com", resendApiKey: "key" },
      makeLogger() as never,
    );

    await service.sendHumanRequest(
      makePayload({
        linearIssue: { id: "li-2", title: null, url: null },
        reason: "other",
      }),
    );

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.html).toContain("(untitled)");
    expect(body.text).not.toContain("Linear:");
  });
});
