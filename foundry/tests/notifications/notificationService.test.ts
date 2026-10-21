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
    summary: "The plan needs human review.",
    linearIssue: { id: "LIN-1", identifier: "ENG-1", title: "Fix the thing", url: "https://linear.app/x" },
    runState: "HumanClarificationNeeded",
    runUrl: "https://foundry.local/runs/run-1",
    ...overrides,
  };
}

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };

describe("NotificationService.isConfigured", () => {
  beforeEach(() => logger.warn.mockClear());

  it("is false when nothing is configured", () => {
    const svc = new NotificationService({ emailFrom: "a@b.com" }, logger as never);
    expect(svc.isConfigured()).toBe(false);
  });

  it("is true with only a slack webhook configured", () => {
    const svc = new NotificationService(
      { emailFrom: "a@b.com", slackWebhookUrl: "https://hooks.slack.com/x" },
      logger as never,
    );
    expect(svc.isConfigured()).toBe(true);
  });

  it("is true with email configured (to + resend key)", () => {
    const svc = new NotificationService(
      { emailFrom: "a@b.com", emailTo: "to@b.com", resendApiKey: "key" },
      logger as never,
    );
    expect(svc.isConfigured()).toBe(true);
  });

  it("is false when only emailTo is set without a resend key", () => {
    const svc = new NotificationService(
      { emailFrom: "a@b.com", emailTo: "to@b.com" },
      logger as never,
    );
    expect(svc.isConfigured()).toBe(false);
  });
});

describe("NotificationService.sendHumanRequest", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    logger.warn.mockClear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function configBoth(): NotificationConfig {
    return {
      emailFrom: "AgentForge <noreply@agentforge.dev>",
      emailTo: "human@example.com",
      resendApiKey: "resend-key",
      slackWebhookUrl: "https://hooks.slack.com/services/x",
    };
  }

  it("does not attempt any channel when none are configured", async () => {
    const svc = new NotificationService({ emailFrom: "a@b.com" }, logger as never);
    const result = await svc.sendHumanRequest(makePayload());

    expect(result.slack.attempted).toBe(false);
    expect(result.email.attempted).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("marks slack ok and posts a JSON webhook when configured and the webhook succeeds", async () => {
    fetchMock.mockResolvedValue({ ok: true });
    const svc = new NotificationService(
      { emailFrom: "a@b.com", slackWebhookUrl: "https://hooks.slack.com/services/x" },
      logger as never,
    );

    const result = await svc.sendHumanRequest(makePayload());

    expect(result.slack).toEqual({ attempted: true, ok: true });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://hooks.slack.com/services/x",
      expect.objectContaining({ method: "POST" }),
    );
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.text).toContain("ENG-1");
  });

  it("records a slack error and logs a warning when the webhook returns non-ok", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500, text: () => Promise.resolve("boom") });
    const svc = new NotificationService(
      { emailFrom: "a@b.com", slackWebhookUrl: "https://hooks.slack.com/services/x" },
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

  it("sends email via Resend and splits comma-separated recipients", async () => {
    fetchMock.mockResolvedValue({ ok: true });
    const svc = new NotificationService(
      { emailFrom: "a@b.com", emailTo: "x@b.com, y@b.com", resendApiKey: "key" },
      logger as never,
    );

    const result = await svc.sendHumanRequest(makePayload());

    expect(result.email).toEqual({ attempted: true, ok: true });
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.resend.com/emails");
    const body = JSON.parse(opts.body as string);
    expect(body.to).toEqual(["x@b.com", "y@b.com"]);
    expect(opts.headers.Authorization).toBe("Bearer key");
  });

  it("records an email error and logs a warning when Resend returns non-ok", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 422, text: () => Promise.resolve("bad") });
    const svc = new NotificationService(
      { emailFrom: "a@b.com", emailTo: "x@b.com", resendApiKey: "key" },
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

  it("attempts both channels concurrently when both are configured", async () => {
    fetchMock.mockResolvedValue({ ok: true });
    const svc = new NotificationService(configBoth(), logger as never);

    const result = await svc.sendHumanRequest(makePayload());

    expect(result.slack).toEqual({ attempted: true, ok: true });
    expect(result.email).toEqual({ attempted: true, ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("includes plan confidence and open questions in the slack payload when present", async () => {
    fetchMock.mockResolvedValue({ ok: true });
    const svc = new NotificationService(
      { emailFrom: "a@b.com", slackWebhookUrl: "https://hooks.slack.com/services/x" },
      logger as never,
    );

    await svc.sendHumanRequest(
      makePayload({
        planConfidence: 0.42,
        context: "Some extra context about the run.",
        openQuestions: [
          { id: "q1", question: "Should we do X?", requiredForExecution: true },
          { id: "q2", question: "Or Y?", requiredForExecution: false },
        ],
      }),
    );

    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    const serialized = JSON.stringify(body);
    expect(serialized).toContain("0.42");
    expect(serialized).toContain("Should we do X?");
    expect(serialized).toContain("Some extra context about the run.");
  });

  it("falls back to an untitled label when the linear issue has no title and no url", async () => {
    fetchMock.mockResolvedValue({ ok: true });
    const svc = new NotificationService(
      { emailFrom: "a@b.com", slackWebhookUrl: "https://hooks.slack.com/services/x" },
      logger as never,
    );

    await svc.sendHumanRequest(
      makePayload({
        linearIssue: { id: "LIN-9", title: null, url: null },
      }),
    );

    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.text).toContain("(untitled)");
  });

  it("builds email html and text bodies including context, open questions, and confidence", async () => {
    fetchMock.mockResolvedValue({ ok: true });
    const svc = new NotificationService(
      { emailFrom: "a@b.com", emailTo: "x@b.com", resendApiKey: "key" },
      logger as never,
    );

    await svc.sendHumanRequest(
      makePayload({
        planConfidence: 0.75,
        context: "<script>alert(1)</script>",
        openQuestions: [{ id: "q1", question: "Really?", requiredForExecution: true }],
      }),
    );

    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.html).toContain("0.75");
    expect(body.html).not.toContain("<script>alert(1)</script>");
    expect(body.html).toContain("&lt;script&gt;");
    expect(body.text).toContain("Really?");
  });
});
