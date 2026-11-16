import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  NotificationService,
  type NotificationConfig,
  type NotificationPayload,
} from "../../src/notifications/notificationService.js";

function makeMockLogger() {
  return {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  };
}

function makePayload(overrides: Partial<NotificationPayload> = {}): NotificationPayload {
  return {
    runId: "run-1",
    reason: "plan_low_confidence",
    summary: "Needs a human look",
    linearIssue: {
      id: "issue-1",
      identifier: "ENG-42",
      title: "Fix the thing",
      url: "https://linear.app/issue/ENG-42",
    },
    runState: "AWAITING_HUMAN",
    runUrl: "https://foundry.example.com/runs/run-1",
    ...overrides,
  };
}

function okResponse() {
  return { ok: true };
}

function failResponse(status: number, text: string) {
  return { ok: false, status, text: async () => text };
}

describe("NotificationService.isConfigured", () => {
  const logger = makeMockLogger();

  it("is true when only slackWebhookUrl is set", () => {
    const config: NotificationConfig = {
      emailFrom: "from@example.com",
      slackWebhookUrl: "https://hooks.slack.test/webhook",
    };
    const svc = new NotificationService(config, logger as never);
    expect(svc.isConfigured()).toBe(true);
  });

  it("is true when emailTo and resendApiKey are both set (no slack)", () => {
    const config: NotificationConfig = {
      emailFrom: "from@example.com",
      emailTo: "to@example.com",
      resendApiKey: "re_123",
    };
    const svc = new NotificationService(config, logger as never);
    expect(svc.isConfigured()).toBe(true);
  });

  it("is false when neither slack nor a complete email config is set", () => {
    const config: NotificationConfig = {
      emailFrom: "from@example.com",
      emailTo: "to@example.com",
      // resendApiKey missing -> email leg incomplete
    };
    const svc = new NotificationService(config, logger as never);
    expect(svc.isConfigured()).toBe(false);

    const emptyConfig: NotificationConfig = { emailFrom: "from@example.com" };
    const svc2 = new NotificationService(emptyConfig, logger as never);
    expect(svc2.isConfigured()).toBe(false);
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

  it("attempts only slack when only slack is configured", async () => {
    fetchMock.mockResolvedValueOnce(okResponse());
    const logger = makeMockLogger();
    const config: NotificationConfig = {
      emailFrom: "from@example.com",
      slackWebhookUrl: "https://hooks.slack.test/webhook",
    };
    const svc = new NotificationService(config, logger as never);
    const result = await svc.sendHumanRequest(makePayload());

    expect(result.slack.attempted).toBe(true);
    expect(result.slack.ok).toBe(true);
    expect(result.email.attempted).toBe(false);
    expect(result.email.ok).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe("https://hooks.slack.test/webhook");
  });

  it("attempts only email when only email is configured", async () => {
    fetchMock.mockResolvedValueOnce(okResponse());
    const logger = makeMockLogger();
    const config: NotificationConfig = {
      emailFrom: "from@example.com",
      emailTo: "to@example.com",
      resendApiKey: "re_123",
    };
    const svc = new NotificationService(config, logger as never);
    const result = await svc.sendHumanRequest(makePayload());

    expect(result.slack.attempted).toBe(false);
    expect(result.slack.ok).toBe(false);
    expect(result.email.attempted).toBe(true);
    expect(result.email.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe("https://api.resend.com/emails");
  });

  it("attempts both when both slack and email are configured", async () => {
    fetchMock.mockResolvedValueOnce(okResponse()).mockResolvedValueOnce(okResponse());
    const logger = makeMockLogger();
    const config: NotificationConfig = {
      emailFrom: "from@example.com",
      slackWebhookUrl: "https://hooks.slack.test/webhook",
      emailTo: "to@example.com",
      resendApiKey: "re_123",
    };
    const svc = new NotificationService(config, logger as never);
    const result = await svc.sendHumanRequest(makePayload());

    expect(result.slack.attempted).toBe(true);
    expect(result.slack.ok).toBe(true);
    expect(result.email.attempted).toBe(true);
    expect(result.email.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("attempts neither and never calls fetch when nothing is configured", async () => {
    const logger = makeMockLogger();
    const config: NotificationConfig = { emailFrom: "from@example.com" };
    const svc = new NotificationService(config, logger as never);
    const result = await svc.sendHumanRequest(makePayload());

    expect(result.slack).toEqual({ attempted: false, ok: false });
    expect(result.email).toEqual({ attempted: false, ok: false });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("records a slack failure, keeps ok false, and logs a warning", async () => {
    fetchMock.mockResolvedValueOnce(failResponse(500, "boom"));
    const logger = makeMockLogger();
    const config: NotificationConfig = {
      emailFrom: "from@example.com",
      slackWebhookUrl: "https://hooks.slack.test/webhook",
    };
    const svc = new NotificationService(config, logger as never);
    const result = await svc.sendHumanRequest(makePayload());

    expect(result.slack.attempted).toBe(true);
    expect(result.slack.ok).toBe(false);
    expect(result.slack.error).toContain("500");
    expect(result.slack.error).toContain("boom");
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ runId: "run-1", error: result.slack.error }),
      "Slack notification failed",
    );
  });

  it("records an email failure, keeps ok false, and logs a warning", async () => {
    fetchMock.mockResolvedValueOnce(failResponse(503, "unavailable"));
    const logger = makeMockLogger();
    const config: NotificationConfig = {
      emailFrom: "from@example.com",
      emailTo: "to@example.com",
      resendApiKey: "re_123",
    };
    const svc = new NotificationService(config, logger as never);
    const result = await svc.sendHumanRequest(makePayload());

    expect(result.email.attempted).toBe(true);
    expect(result.email.ok).toBe(false);
    expect(result.email.error).toContain("503");
    expect(result.email.error).toContain("unavailable");
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ runId: "run-1", error: result.email.error }),
      "Email notification failed",
    );
  });

  it("includes planConfidence and openQuestions fields in the slack body only when present", async () => {
    fetchMock.mockResolvedValueOnce(okResponse());
    const logger = makeMockLogger();
    const config: NotificationConfig = {
      emailFrom: "from@example.com",
      slackWebhookUrl: "https://hooks.slack.test/webhook",
    };
    const svc = new NotificationService(config, logger as never);
    await svc.sendHumanRequest(
      makePayload({
        planConfidence: 0.42,
        openQuestions: [
          { id: "q1", question: "Which env?", requiredForExecution: true },
          { id: "q2", question: "Which branch?", requiredForExecution: false },
        ],
      }),
    );

    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    const sectionWithFields = body.blocks.find(
      (b: { fields?: { text: string }[] }) => Array.isArray(b.fields) && b.fields.length > 0,
    );
    const fieldTexts = sectionWithFields.fields.map((f: { text: string }) => f.text);
    expect(fieldTexts.some((t: string) => t.includes("Plan confidence:") && t.includes("0.42"))).toBe(
      true,
    );
    expect(fieldTexts.some((t: string) => t.includes("Open questions:") && t.includes("2 (1 required)"))).toBe(
      true,
    );
  });

  it("omits planConfidence and openQuestions fields from the slack body when absent", async () => {
    fetchMock.mockResolvedValueOnce(okResponse());
    const logger = makeMockLogger();
    const config: NotificationConfig = {
      emailFrom: "from@example.com",
      slackWebhookUrl: "https://hooks.slack.test/webhook",
    };
    const svc = new NotificationService(config, logger as never);
    await svc.sendHumanRequest(makePayload({ openQuestions: [] }));

    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    const sectionWithFields = body.blocks.find(
      (b: { fields?: { text: string }[] }) => Array.isArray(b.fields) && b.fields.length > 0,
    );
    const fieldTexts = sectionWithFields.fields.map((f: { text: string }) => f.text);
    expect(fieldTexts.some((t: string) => t.includes("Plan confidence:"))).toBe(false);
    expect(fieldTexts.some((t: string) => t.includes("Open questions:"))).toBe(false);
  });

  it("renders email body containing the issue title, run state, and summary", async () => {
    fetchMock.mockResolvedValueOnce(okResponse());
    const logger = makeMockLogger();
    const config: NotificationConfig = {
      emailFrom: "from@example.com",
      emailTo: "to@example.com",
      resendApiKey: "re_123",
    };
    const svc = new NotificationService(config, logger as never);
    await svc.sendHumanRequest(makePayload());

    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.html).toContain("Fix the thing");
    expect(body.html).toContain("AWAITING_HUMAN");
    expect(body.html).toContain("Needs a human look");
    expect(body.text).toContain("Fix the thing");
    expect(body.text).toContain("AWAITING_HUMAN");
    expect(body.text).toContain("Needs a human look");
  });
});
