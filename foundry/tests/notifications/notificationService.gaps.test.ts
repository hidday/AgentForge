import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  NotificationService,
  type NotificationConfig,
  type NotificationPayload,
} from "../../src/notifications/notificationService.js";

// Covers the "non-Error rejection" ternary branch (`err instanceof Error ?
// err.message : String(err)`) for both the Slack and email failure paths.
// notificationService.test.ts only ever rejects fetch with real Error
// instances.

function makeLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
}

function makePayload(overrides: Partial<NotificationPayload> = {}): NotificationPayload {
  return {
    runId: "run-1",
    reason: "plan_ambiguous",
    summary: "The plan has ambiguous requirements.",
    linearIssue: {
      id: "lin-1",
      identifier: "ENG-42",
      title: "Implement feature X",
      url: "https://linear.app/team/issue/ENG-42",
    },
    runState: "AwaitingPlanApproval",
    runUrl: "https://agentforge.example.com/runs/run-1",
    ...overrides,
  };
}

describe("NotificationService.sendHumanRequest — non-Error rejections", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("records a slack failure with the stringified value when fetch rejects with a non-Error", async () => {
    fetchMock.mockRejectedValue("slack network down");
    const logger = makeLogger();
    const config: NotificationConfig = {
      emailFrom: "noreply@example.com",
      slackWebhookUrl: "https://hooks.slack.com/x",
    };
    const service = new NotificationService(config, logger as never);

    const result = await service.sendHumanRequest(makePayload());

    expect(result.slack.ok).toBe(false);
    expect(result.slack.error).toBe("slack network down");
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ runId: "run-1", error: "slack network down" }),
      "Slack notification failed",
    );
  });

  it("records an email failure with the stringified value when fetch rejects with a non-Error", async () => {
    fetchMock.mockRejectedValue("resend network down");
    const logger = makeLogger();
    const config: NotificationConfig = {
      emailFrom: "noreply@example.com",
      emailTo: "ops@example.com",
      resendApiKey: "key-123",
    };
    const service = new NotificationService(config, logger as never);

    const result = await service.sendHumanRequest(makePayload());

    expect(result.email.ok).toBe(false);
    expect(result.email.error).toBe("resend network down");
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ runId: "run-1", error: "resend network down" }),
      "Email notification failed",
    );
  });
});
