import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  NotificationService,
  type NotificationConfig,
  type NotificationPayload,
} from "../../src/notifications/notificationService.js";
import type { Logger } from "../../src/utils/logger.js";

function makeLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as unknown as Logger;
}

function makePayload(overrides: Partial<NotificationPayload> = {}): NotificationPayload {
  return {
    runId: "run-1",
    reason: "plan_low_confidence",
    summary: "The plan is uncertain about scope.",
    linearIssue: {
      id: "issue-1",
      identifier: "ENG-42",
      title: "Add feature X",
      url: "https://linear.app/team/issue/ENG-42",
    },
    runState: "AwaitingPlanApproval",
    runUrl: "https://dashboard.example.com/runs/run-1",
    ...overrides,
  };
}

function okResponse(body = "ok") {
  return {
    ok: true,
    status: 200,
    text: vi.fn().mockResolvedValue(body),
  };
}

function badResponse(status: number, body: string) {
  return {
    ok: false,
    status,
    text: vi.fn().mockResolvedValue(body),
  };
}

describe("NotificationService.isConfigured", () => {
  it("is false when neither slack nor email is configured", () => {
    const config: NotificationConfig = { emailFrom: "bot@example.com" };
    const service = new NotificationService(config, makeLogger());
    expect(service.isConfigured()).toBe(false);
  });

  it("is true when slackWebhookUrl is set", () => {
    const config: NotificationConfig = {
      emailFrom: "bot@example.com",
      slackWebhookUrl: "https://hooks.slack.com/services/x",
    };
    const service = new NotificationService(config, makeLogger());
    expect(service.isConfigured()).toBe(true);
  });

  it("is true when both emailTo and resendApiKey are set", () => {
    const config: NotificationConfig = {
      emailFrom: "bot@example.com",
      emailTo: "a@example.com",
      resendApiKey: "key-123",
    };
    const service = new NotificationService(config, makeLogger());
    expect(service.isConfigured()).toBe(true);
  });

  it("is false when only emailTo is set without resendApiKey", () => {
    const config: NotificationConfig = { emailFrom: "bot@example.com", emailTo: "a@example.com" };
    const service = new NotificationService(config, makeLogger());
    expect(service.isConfigured()).toBe(false);
  });

  it("is false when only resendApiKey is set without emailTo", () => {
    const config: NotificationConfig = { emailFrom: "bot@example.com", resendApiKey: "key-123" };
    const service = new NotificationService(config, makeLogger());
    expect(service.isConfigured()).toBe(false);
  });
});

describe("NotificationService.sendHumanRequest", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let logger: Logger;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    logger = makeLogger();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("attempts neither channel when neither is configured", async () => {
    const config: NotificationConfig = { emailFrom: "bot@example.com" };
    const service = new NotificationService(config, logger);

    const result = await service.sendHumanRequest(makePayload());

    expect(result.slack).toEqual({ attempted: false, ok: false });
    expect(result.email).toEqual({ attempted: false, ok: false });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("marks slack ok:true when configured and fetch resolves ok", async () => {
    const config: NotificationConfig = {
      emailFrom: "bot@example.com",
      slackWebhookUrl: "https://hooks.slack.com/services/x",
    };
    fetchMock.mockResolvedValue(okResponse());
    const service = new NotificationService(config, logger);

    const result = await service.sendHumanRequest(makePayload());

    expect(result.slack).toEqual({ attempted: true, ok: true });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://hooks.slack.com/services/x",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("marks slack ok:false with an error message built from status+body when fetch resolves !ok", async () => {
    const config: NotificationConfig = {
      emailFrom: "bot@example.com",
      slackWebhookUrl: "https://hooks.slack.com/services/x",
    };
    fetchMock.mockResolvedValue(badResponse(400, "invalid_payload"));
    const service = new NotificationService(config, logger);

    const result = await service.sendHumanRequest(makePayload());

    expect(result.slack.attempted).toBe(true);
    expect(result.slack.ok).toBe(false);
    expect(result.slack.error).toBe("Slack webhook returned 400: invalid_payload");
    expect(logger.warn).toHaveBeenCalledWith(
      { runId: "run-1", error: "Slack webhook returned 400: invalid_payload" },
      "Slack notification failed",
    );
  });

  it("catches a slack fetch network rejection and logs a warning", async () => {
    const config: NotificationConfig = {
      emailFrom: "bot@example.com",
      slackWebhookUrl: "https://hooks.slack.com/services/x",
    };
    fetchMock.mockRejectedValue(new Error("network down"));
    const service = new NotificationService(config, logger);

    const result = await service.sendHumanRequest(makePayload());

    expect(result.slack).toEqual({ attempted: true, ok: false, error: "network down" });
    expect(logger.warn).toHaveBeenCalledWith(
      { runId: "run-1", error: "network down" },
      "Slack notification failed",
    );
  });

  it("marks email ok:true when configured and fetch resolves ok, splitting/trimming/filtering the to field", async () => {
    const config: NotificationConfig = {
      emailFrom: "bot@example.com",
      emailTo: " a@example.com ,b@example.com,,c@example.com ",
      resendApiKey: "key-123",
    };
    fetchMock.mockResolvedValue(okResponse());
    const service = new NotificationService(config, logger);

    const result = await service.sendHumanRequest(makePayload());

    expect(result.email).toEqual({ attempted: true, ok: true });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.resend.com/emails",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ Authorization: "Bearer key-123" }),
      }),
    );
    const call = fetchMock.mock.calls[0];
    const body = JSON.parse((call[1] as { body: string }).body) as { to: string[] };
    expect(body.to).toEqual(["a@example.com", "b@example.com", "c@example.com"]);
  });

  it("marks email ok:false with an error message built from status+body when fetch resolves !ok", async () => {
    const config: NotificationConfig = {
      emailFrom: "bot@example.com",
      emailTo: "a@example.com",
      resendApiKey: "key-123",
    };
    fetchMock.mockResolvedValue(badResponse(500, "internal_error"));
    const service = new NotificationService(config, logger);

    const result = await service.sendHumanRequest(makePayload());

    expect(result.email.attempted).toBe(true);
    expect(result.email.ok).toBe(false);
    expect(result.email.error).toBe("Resend returned 500: internal_error");
    expect(logger.warn).toHaveBeenCalledWith(
      { runId: "run-1", error: "Resend returned 500: internal_error" },
      "Email notification failed",
    );
  });

  it("catches an email fetch network rejection and logs a warning", async () => {
    const config: NotificationConfig = {
      emailFrom: "bot@example.com",
      emailTo: "a@example.com",
      resendApiKey: "key-123",
    };
    fetchMock.mockRejectedValue(new Error("dns failure"));
    const service = new NotificationService(config, logger);

    const result = await service.sendHumanRequest(makePayload());

    expect(result.email).toEqual({ attempted: true, ok: false, error: "dns failure" });
    expect(logger.warn).toHaveBeenCalledWith(
      { runId: "run-1", error: "dns failure" },
      "Email notification failed",
    );
  });

  it("attempts and awaits both channels simultaneously when both are configured", async () => {
    const config: NotificationConfig = {
      emailFrom: "bot@example.com",
      slackWebhookUrl: "https://hooks.slack.com/services/x",
      emailTo: "a@example.com",
      resendApiKey: "key-123",
    };
    fetchMock.mockResolvedValue(okResponse());
    const service = new NotificationService(config, logger);

    const result = await service.sendHumanRequest(makePayload());

    expect(result.slack).toEqual({ attempted: true, ok: true });
    expect(result.email).toEqual({ attempted: true, ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("exercises planConfidence, context, and openQuestions truncation/prefix branches in the slack and email bodies", async () => {
    const config: NotificationConfig = {
      emailFrom: "bot@example.com",
      slackWebhookUrl: "https://hooks.slack.com/services/x",
      emailTo: "a@example.com",
      resendApiKey: "key-123",
    };
    fetchMock.mockResolvedValue(okResponse());
    const service = new NotificationService(config, logger);

    const longContext = "x".repeat(2500);
    const openQuestions = Array.from({ length: 6 }, (_, i) => ({
      id: `q${String(i)}`,
      question: `Question number ${String(i)} `.padEnd(250, "y"),
      requiredForExecution: i % 2 === 0,
    }));

    const payload = makePayload({
      planConfidence: 0.734,
      context: longContext,
      openQuestions,
    });

    await service.sendHumanRequest(payload);

    // --- Slack body assertions ---
    const slackCall = fetchMock.mock.calls.find(
      (c) => c[0] === "https://hooks.slack.com/services/x",
    );
    expect(slackCall).toBeDefined();
    const slackBody = JSON.parse((slackCall![1] as { body: string }).body) as {
      text: string;
      blocks: unknown[];
    };
    const slackJson = JSON.stringify(slackBody);

    // planConfidence formatted to 2 decimals
    expect(slackJson).toContain("0.73");
    // context truncated to 1500 chars with ellipsis
    expect(slackJson).toContain("…");
    expect(slackJson).not.toContain("x".repeat(1501));
    // open questions: slice(0,3) means only first 3 questions rendered in the Questions block,
    // but the count line reports the full length + required count
    expect(slackJson).toContain("6 (3 required)");
    expect(slackJson).toContain("[required] ");
    // question 3 (index 3, 4th question) should NOT appear in the truncated slice(0,3) block
    // (it may still appear in fields count text, so check specifically inside the "Questions:" text)
    const questionsSection = slackBody.blocks.find(
      (b) =>
        typeof b === "object" &&
        b !== null &&
        JSON.stringify(b).includes("*Questions:*"),
    );
    expect(questionsSection).toBeDefined();
    const questionsText = JSON.stringify(questionsSection);
    expect(questionsText).toContain("Question number 0");
    expect(questionsText).toContain("Question number 1");
    expect(questionsText).toContain("Question number 2");
    expect(questionsText).not.toContain("Question number 3");

    // --- Email body assertions ---
    const emailCall = fetchMock.mock.calls.find((c) => c[0] === "https://api.resend.com/emails");
    expect(emailCall).toBeDefined();
    const emailBody = JSON.parse((emailCall![1] as { body: string }).body) as {
      html: string;
      text: string;
    };

    // html escaped, contains confidence line
    expect(emailBody.html).toContain("Plan confidence:</strong> 0.73");
    expect(emailBody.html).toContain("<strong>[required]</strong>");
    // context block truncated to 2000 chars
    expect(emailBody.html).toContain("…");
    // openQuestions slice(0,5) -> question index 5 (6th) excluded from html list
    expect(emailBody.html).toContain("Question number 4");
    expect(emailBody.html).not.toContain("Question number 5");

    // text rendering mirrors the same slice(0,5) and required prefix
    expect(emailBody.text).toContain("[required] ");
    expect(emailBody.text).toContain("Question number 4");
    expect(emailBody.text).not.toContain("Question number 5");
    expect(emailBody.text).toContain("Plan confidence: 0.73");
    expect(emailBody.text).toContain("Context:");
    expect(emailBody.text).toContain(`Linear: ${payload.linearIssue.url}`);
  });

  it("omits the Linear link and confidence line when not provided", async () => {
    const config: NotificationConfig = {
      emailFrom: "bot@example.com",
      emailTo: "a@example.com",
      resendApiKey: "key-123",
    };
    fetchMock.mockResolvedValue(okResponse());
    const service = new NotificationService(config, logger);

    const payload = makePayload({
      linearIssue: { id: "issue-2", title: null, url: null },
      planConfidence: undefined,
      context: undefined,
      openQuestions: undefined,
    });

    await service.sendHumanRequest(payload);

    const emailCall = fetchMock.mock.calls[0];
    const emailBody = JSON.parse((emailCall[1] as { body: string }).body) as {
      html: string;
      text: string;
    };
    expect(emailBody.html).toContain("(untitled)");
    expect(emailBody.html).not.toContain("Plan confidence:");
    expect(emailBody.text).not.toContain("Plan confidence:");
    expect(emailBody.text).not.toContain("Linear:");
  });
});
