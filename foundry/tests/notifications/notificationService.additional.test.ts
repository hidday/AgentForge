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
    summary: "The plan is ambiguous about auth",
    linearIssue: {
      id: "issue-1",
      identifier: "PRY-1",
      title: "Add auth",
      url: "https://linear.app/team/issue/PRY-1",
    },
    runState: "AwaitingPlanApproval",
    runUrl: "https://app.example.com/runs/run-1",
    ...overrides,
  };
}

function makeConfig(overrides: Partial<NotificationConfig> = {}): NotificationConfig {
  return { emailFrom: "bot@x.com", ...overrides };
}

describe("NotificationService - non-Error rejection branches", () => {
  let logger: ReturnType<typeof makeLogger>;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    logger = makeLogger();
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("stringifies a non-Error rejection from the Slack fetch call", async () => {
    fetchMock.mockRejectedValue("slack DNS failure");
    const service = new NotificationService(
      makeConfig({ slackWebhookUrl: "https://hooks.slack.com/x" }),
      logger as never,
    );

    const result = await service.sendHumanRequest(makePayload());

    expect(result.slack.ok).toBe(false);
    expect(result.slack.error).toBe("slack DNS failure");
  });

  it("stringifies a non-Error rejection from the email fetch call", async () => {
    fetchMock.mockRejectedValue({ code: "ECONNRESET" });
    const service = new NotificationService(
      makeConfig({ emailTo: "a@x.com", resendApiKey: "resend-key" }),
      logger as never,
    );

    const result = await service.sendHumanRequest(makePayload());

    expect(result.email.ok).toBe(false);
    expect(result.email.error).toBe("[object Object]");
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ runId: "run-1", error: "[object Object]" }),
      "Email notification failed",
    );
  });
});

describe("NotificationService - email title/requiredForExecution branches", () => {
  let logger: ReturnType<typeof makeLogger>;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    logger = makeLogger();
    fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, text: vi.fn() });
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("falls back to '(untitled)' in the email subject, HTML body, and plaintext body when title is null", async () => {
    const service = new NotificationService(
      makeConfig({ emailTo: "a@x.com", resendApiKey: "resend-key" }),
      logger as never,
    );

    await service.sendHumanRequest(
      makePayload({
        linearIssue: { id: "issue-1", identifier: "PRY-1", title: null, url: null },
      }),
    );

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string) as { subject: string; html: string; text: string };
    expect(body.subject).toContain("(untitled)");
    expect(body.html).toContain("(untitled)");
    expect(body.text).toContain("(untitled)");
  });

  it("renders both required and non-required open questions in the email HTML and plaintext bodies", async () => {
    const service = new NotificationService(
      makeConfig({ emailTo: "a@x.com", resendApiKey: "resend-key" }),
      logger as never,
    );

    await service.sendHumanRequest(
      makePayload({
        openQuestions: [
          { id: "q1", question: "Required question?", requiredForExecution: true },
          { id: "q2", question: "Optional question?", requiredForExecution: false },
        ],
      }),
    );

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string) as { html: string; text: string };

    expect(body.html).toContain("<strong>[required]</strong> Required question?");
    expect(body.html).toContain("Optional question?");
    expect(body.html).not.toContain("<strong>[required]</strong> Optional question?");

    expect(body.text).toContain("[required] Required question?");
    expect(body.text).toContain("Optional question?");
    expect(body.text).not.toContain("[required] Optional question?");
  });
});
