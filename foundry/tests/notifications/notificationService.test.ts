import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  NotificationService,
  type NotificationPayload,
} from "../../src/notifications/notificationService.js";

const noopLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  fatal: vi.fn(),
  child: () => noopLogger,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} as any;

function makePayload(overrides: Partial<NotificationPayload> = {}): NotificationPayload {
  return {
    runId: "run-1",
    reason: "plan_ambiguous",
    summary: "The plan has an ambiguous requirement.",
    linearIssue: { id: "lin-1", identifier: "LIN-1", title: "Add auth", url: "https://linear.app/x" },
    runState: "AwaitingPlanApproval",
    runUrl: "https://foundry.local/runs/run-1",
    ...overrides,
  };
}

describe("NotificationService.isConfigured", () => {
  it("is configured when a Slack webhook is set", () => {
    const svc = new NotificationService({ emailFrom: "a@b.com", slackWebhookUrl: "https://hooks.slack.com/x" }, noopLogger);
    expect(svc.isConfigured()).toBe(true);
  });

  it("is configured when both emailTo and resendApiKey are set", () => {
    const svc = new NotificationService(
      { emailFrom: "a@b.com", emailTo: "ops@b.com", resendApiKey: "key" },
      noopLogger,
    );
    expect(svc.isConfigured()).toBe(true);
  });

  it("is not configured when only emailTo is set without an API key", () => {
    const svc = new NotificationService({ emailFrom: "a@b.com", emailTo: "ops@b.com" }, noopLogger);
    expect(svc.isConfigured()).toBe(false);
  });

  it("is not configured when nothing is set", () => {
    const svc = new NotificationService({ emailFrom: "a@b.com" }, noopLogger);
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

  it("does not attempt anything when nothing is configured", async () => {
    const svc = new NotificationService({ emailFrom: "a@b.com" }, noopLogger);

    const result = await svc.sendHumanRequest(makePayload());

    expect(result).toEqual({
      slack: { attempted: false, ok: false },
      email: { attempted: false, ok: false },
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sends a Slack notification and reports success", async () => {
    fetchMock.mockResolvedValue({ ok: true });
    const svc = new NotificationService(
      { emailFrom: "a@b.com", slackWebhookUrl: "https://hooks.slack.com/x" },
      noopLogger,
    );

    const result = await svc.sendHumanRequest(
      makePayload({
        planConfidence: 0.42,
        openQuestions: [
          { id: "q1", question: "Should we strip unknown fields?", requiredForExecution: true },
          { id: "q2", question: "Any rate limiting?", requiredForExecution: false },
        ],
        context: "x".repeat(2000),
      }),
    );

    expect(result.slack).toEqual({ attempted: true, ok: true });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://hooks.slack.com/x",
      expect.objectContaining({ method: "POST" }),
    );
    const [, options] = fetchMock.mock.calls[0];
    const body = JSON.parse(options.body as string);
    expect(body.text).toContain("LIN-1");
    expect(JSON.stringify(body.blocks)).toContain("required");
    expect(JSON.stringify(body.blocks)).toContain("…"); // truncated context
  });

  it("includes a Linear issue button only when the issue has a url", async () => {
    fetchMock.mockResolvedValue({ ok: true });
    const svc = new NotificationService(
      { emailFrom: "a@b.com", slackWebhookUrl: "https://hooks.slack.com/x" },
      noopLogger,
    );

    await svc.sendHumanRequest(
      makePayload({ linearIssue: { id: "lin-1", title: null, url: null } }),
    );

    const [, options] = fetchMock.mock.calls[0];
    const body = JSON.parse(options.body as string);
    const actionsBlock = body.blocks.find((b: { type: string }) => b.type === "actions");
    expect(actionsBlock.elements).toHaveLength(1);
  });

  it("marks Slack as failed when the webhook responds with a non-ok status", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500, text: async () => "server error" });
    const svc = new NotificationService(
      { emailFrom: "a@b.com", slackWebhookUrl: "https://hooks.slack.com/x" },
      noopLogger,
    );

    const result = await svc.sendHumanRequest(makePayload());

    expect(result.slack).toEqual({ attempted: true, ok: false, error: expect.stringContaining("500") });
    expect(noopLogger.warn).toHaveBeenCalled();
  });

  it("marks Slack as failed when fetch itself rejects", async () => {
    fetchMock.mockRejectedValue(new Error("network down"));
    const svc = new NotificationService(
      { emailFrom: "a@b.com", slackWebhookUrl: "https://hooks.slack.com/x" },
      noopLogger,
    );

    const result = await svc.sendHumanRequest(makePayload());

    expect(result.slack).toEqual({ attempted: true, ok: false, error: "network down" });
  });

  it("sends an email via Resend and reports success, splitting multiple recipients", async () => {
    fetchMock.mockResolvedValue({ ok: true });
    const svc = new NotificationService(
      { emailFrom: "bot@foundry.dev", emailTo: "a@b.com, c@d.com", resendApiKey: "key-123" },
      noopLogger,
    );

    const result = await svc.sendHumanRequest(
      makePayload({
        reason: "impl_rejected",
        planConfidence: 0.9,
        context: "<script>alert(1)</script>",
        openQuestions: [{ id: "q1", question: "A & B?", requiredForExecution: true }],
        linearIssue: { id: "lin-1", title: null, url: "https://linear.app/x" },
      }),
    );

    expect(result.email).toEqual({ attempted: true, ok: true });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.resend.com/emails",
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: "Bearer key-123" }),
      }),
    );
    const [, options] = fetchMock.mock.calls[0];
    const body = JSON.parse(options.body as string);
    expect(body.to).toEqual(["a@b.com", "c@d.com"]);
    expect(body.html).toContain("&lt;script&gt;");
    expect(body.html).not.toContain("<script>alert(1)</script>");
    expect(body.text).toContain("A & B?");
    expect(body.subject).toContain("(untitled)");
  });

  it("marks email as failed when Resend responds with a non-ok status", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 401, text: async () => "unauthorized" });
    const svc = new NotificationService(
      { emailFrom: "bot@foundry.dev", emailTo: "a@b.com", resendApiKey: "bad-key" },
      noopLogger,
    );

    const result = await svc.sendHumanRequest(makePayload());

    expect(result.email.ok).toBe(false);
    expect(result.email.error).toContain("401");
  });

  it("sends both Slack and email concurrently when both are configured", async () => {
    fetchMock.mockResolvedValue({ ok: true });
    const svc = new NotificationService(
      {
        emailFrom: "bot@foundry.dev",
        emailTo: "a@b.com",
        resendApiKey: "key",
        slackWebhookUrl: "https://hooks.slack.com/x",
      },
      noopLogger,
    );

    const result = await svc.sendHumanRequest(makePayload());

    expect(result.slack).toEqual({ attempted: true, ok: true });
    expect(result.email).toEqual({ attempted: true, ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("falls back to an empty error body string when reading the failure response fails", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 503, text: async () => { throw new Error("stream closed"); } });
    const svc = new NotificationService(
      { emailFrom: "a@b.com", slackWebhookUrl: "https://hooks.slack.com/x" },
      noopLogger,
    );

    const result = await svc.sendHumanRequest(makePayload());

    expect(result.slack.error).toContain("503");
  });
});
