import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  NotificationService,
  type NotificationConfig,
  type NotificationPayload,
} from "../../src/notifications/notificationService.js";

function makeLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };
}

function makePayload(overrides: Partial<NotificationPayload> = {}): NotificationPayload {
  return {
    runId: "run-1",
    reason: "plan_ambiguous",
    summary: "The plan has ambiguous requirements.",
    linearIssue: {
      id: "lin-1",
      identifier: "ENG-42",
      title: "Build the thing",
      url: "https://linear.app/issue/ENG-42",
    },
    runState: "AwaitingPlanApproval",
    runUrl: "https://foundry.local/runs/run-1",
    ...overrides,
  };
}

describe("NotificationService", () => {
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

  describe("isConfigured", () => {
    it("is true when a slack webhook url is configured", () => {
      const service = new NotificationService(
        { emailFrom: "a@b.com", slackWebhookUrl: "https://hooks.slack.com/x" },
        logger as never,
      );
      expect(service.isConfigured()).toBe(true);
    });

    it("is true when both emailTo and resendApiKey are configured", () => {
      const service = new NotificationService(
        { emailFrom: "a@b.com", emailTo: "to@b.com", resendApiKey: "key" },
        logger as never,
      );
      expect(service.isConfigured()).toBe(true);
    });

    it("is false when only emailTo is set without an api key", () => {
      const service = new NotificationService(
        { emailFrom: "a@b.com", emailTo: "to@b.com" },
        logger as never,
      );
      expect(service.isConfigured()).toBe(false);
    });

    it("is false when nothing is configured", () => {
      const service = new NotificationService({ emailFrom: "a@b.com" }, logger as never);
      expect(service.isConfigured()).toBe(false);
    });
  });

  describe("sendHumanRequest", () => {
    function makeConfig(overrides: Partial<NotificationConfig> = {}): NotificationConfig {
      return {
        emailFrom: "AgentForge <noreply@example.com>",
        slackWebhookUrl: "https://hooks.slack.com/services/x",
        emailTo: "human@example.com",
        resendApiKey: "resend-key",
        ...overrides,
      };
    }

    it("attempts neither channel when nothing is configured", async () => {
      const service = new NotificationService({ emailFrom: "a@b.com" }, logger as never);
      const result = await service.sendHumanRequest(makePayload());

      expect(result).toEqual({
        slack: { attempted: false, ok: false },
        email: { attempted: false, ok: false },
      });
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("sends both slack and email successfully when both are configured", async () => {
      fetchMock.mockResolvedValue({ ok: true, text: vi.fn().mockResolvedValue("") });
      const service = new NotificationService(makeConfig(), logger as never);

      const result = await service.sendHumanRequest(makePayload());

      expect(result.slack).toEqual({ attempted: true, ok: true });
      expect(result.email).toEqual({ attempted: true, ok: true });
      expect(fetchMock).toHaveBeenCalledTimes(2);

      const [slackUrl, slackInit] = fetchMock.mock.calls[0];
      expect(slackUrl).toBe("https://hooks.slack.com/services/x");
      expect(slackInit.method).toBe("POST");
      const slackBody = JSON.parse(slackInit.body);
      expect(slackBody.text).toContain("ENG-42");

      const [emailUrl, emailInit] = fetchMock.mock.calls[1];
      expect(emailUrl).toBe("https://api.resend.com/emails");
      expect(emailInit.headers.Authorization).toBe("Bearer resend-key");
      const emailBody = JSON.parse(emailInit.body);
      expect(emailBody.to).toEqual(["human@example.com"]);
      expect(emailBody.from).toBe("AgentForge <noreply@example.com>");
    });

    it("splits comma-separated email recipients and trims whitespace", async () => {
      fetchMock.mockResolvedValue({ ok: true, text: vi.fn().mockResolvedValue("") });
      const service = new NotificationService(
        makeConfig({ emailTo: "a@b.com, b@b.com ,, c@b.com" }),
        logger as never,
      );

      await service.sendHumanRequest(makePayload());

      const emailInit = fetchMock.mock.calls[1][1];
      const emailBody = JSON.parse(emailInit.body);
      expect(emailBody.to).toEqual(["a@b.com", "b@b.com", "c@b.com"]);
    });

    it("records a slack failure (non-ok response) and logs a warning, without failing email", async () => {
      fetchMock.mockImplementation((url: string) => {
        if (url.includes("hooks.slack.com")) {
          return Promise.resolve({ ok: false, status: 500, text: () => Promise.resolve("server error") });
        }
        return Promise.resolve({ ok: true, text: () => Promise.resolve("") });
      });
      const service = new NotificationService(makeConfig(), logger as never);

      const result = await service.sendHumanRequest(makePayload());

      expect(result.slack.ok).toBe(false);
      expect(result.slack.error).toContain("500");
      expect(result.email.ok).toBe(true);
      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ runId: "run-1" }),
        "Slack notification failed",
      );
    });

    it("records an email failure (non-ok response) and logs a warning", async () => {
      fetchMock.mockImplementation((url: string) => {
        if (url.includes("resend.com")) {
          return Promise.resolve({ ok: false, status: 422, text: () => Promise.resolve("bad request") });
        }
        return Promise.resolve({ ok: true, text: () => Promise.resolve("") });
      });
      const service = new NotificationService(makeConfig(), logger as never);

      const result = await service.sendHumanRequest(makePayload());

      expect(result.email.ok).toBe(false);
      expect(result.email.error).toContain("422");
      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ runId: "run-1" }),
        "Email notification failed",
      );
    });

    it("handles a failing response body read gracefully (text() rejects)", async () => {
      fetchMock.mockResolvedValue({ ok: false, status: 503, text: () => Promise.reject(new Error("no body")) });
      const service = new NotificationService(
        { emailFrom: "a@b.com", slackWebhookUrl: "https://hooks.slack.com/x" },
        logger as never,
      );

      const result = await service.sendHumanRequest(makePayload());
      expect(result.slack.ok).toBe(false);
      expect(result.slack.error).toContain("503");
    });

    it("records a thrown (network) error as the error message", async () => {
      fetchMock.mockRejectedValue(new Error("network down"));
      const service = new NotificationService(
        { emailFrom: "a@b.com", slackWebhookUrl: "https://hooks.slack.com/x" },
        logger as never,
      );

      const result = await service.sendHumanRequest(makePayload());
      expect(result.slack.ok).toBe(false);
      expect(result.slack.error).toBe("network down");
    });

    it("records a stringified non-Error thrown value", async () => {
      fetchMock.mockRejectedValue("some rejection string");
      const service = new NotificationService(
        { emailFrom: "a@b.com", slackWebhookUrl: "https://hooks.slack.com/x" },
        logger as never,
      );

      const result = await service.sendHumanRequest(makePayload());
      expect(result.slack.error).toBe("some rejection string");
    });

    it("includes plan confidence, open questions, and context fields in the slack payload when present", async () => {
      fetchMock.mockResolvedValue({ ok: true, text: vi.fn().mockResolvedValue("") });
      const service = new NotificationService(
        { emailFrom: "a@b.com", slackWebhookUrl: "https://hooks.slack.com/x" },
        logger as never,
      );

      await service.sendHumanRequest(
        makePayload({
          planConfidence: 0.42,
          context: "x".repeat(2000),
          openQuestions: [
            { id: "q1", question: "What about edge case A?", requiredForExecution: true },
            { id: "q2", question: "y".repeat(300), requiredForExecution: false },
            { id: "q3", question: "Extra question not shown", requiredForExecution: false },
            { id: "q4", question: "Another extra", requiredForExecution: false },
          ],
        }),
      );

      const slackBody = JSON.parse(fetchMock.mock.calls[0][1].body);
      const text = JSON.stringify(slackBody);
      expect(text).toContain("0.42");
      expect(text).toContain("required");
      // context should be truncated with an ellipsis
      expect(text).toContain("…");
    });

    it("omits the linear issue url button and uses issue id when identifier/url/title are absent", async () => {
      fetchMock.mockResolvedValue({ ok: true, text: vi.fn().mockResolvedValue("") });
      const service = new NotificationService(
        { emailFrom: "a@b.com", slackWebhookUrl: "https://hooks.slack.com/x" },
        logger as never,
      );

      await service.sendHumanRequest(
        makePayload({
          linearIssue: { id: "bare-id", identifier: undefined, title: null, url: null },
        }),
      );

      const slackBody = JSON.parse(fetchMock.mock.calls[0][1].body);
      expect(slackBody.text).toContain("bare-id");
      expect(slackBody.text).toContain("(untitled)");
      const actionsBlock = slackBody.blocks.find((b: { type: string }) => b.type === "actions");
      expect(actionsBlock.elements).toHaveLength(1);
    });
  });

  describe("sendHumanRequest email html/text rendering (all reason labels)", () => {
    const reasons: NotificationPayload["reason"][] = [
      "plan_ambiguous",
      "plan_low_confidence",
      "impl_rejected",
      "impl_uncertain",
      "other",
    ];

    it.each(reasons)("renders email content for reason '%s'", async (reason) => {
      fetchMock.mockResolvedValue({ ok: true, text: vi.fn().mockResolvedValue("") });
      const service = new NotificationService(
        { emailFrom: "a@b.com", emailTo: "to@b.com", resendApiKey: "key" },
        logger as never,
      );

      await service.sendHumanRequest(
        makePayload({
          reason,
          planConfidence: 0.9,
          context: "<script>alert('x')</script>",
          openQuestions: [{ id: "q1", question: "<b>bold?</b>", requiredForExecution: true }],
          linearIssue: {
            id: "lin-9",
            identifier: "ENG-9",
            title: "<Title & Co>",
            url: "https://linear.app/x",
          },
        }),
      );

      const emailInit = fetchMock.mock.calls[0][1];
      const emailBody = JSON.parse(emailInit.body);
      expect(emailBody.html).toContain("&lt;script&gt;");
      expect(emailBody.html).not.toContain("<script>alert");
      expect(emailBody.text).toContain("Open questions:");
      expect(emailBody.subject).toContain("ENG-9");
    });

    it("omits the Linear issue link in the email html when no issue url is present", async () => {
      fetchMock.mockResolvedValue({ ok: true, text: vi.fn().mockResolvedValue("") });
      const service = new NotificationService(
        { emailFrom: "a@b.com", emailTo: "to@b.com", resendApiKey: "key" },
        logger as never,
      );

      await service.sendHumanRequest(
        makePayload({
          linearIssue: { id: "lin-no-url", identifier: undefined, title: null, url: null },
        }),
      );

      const emailInit = fetchMock.mock.calls[0][1];
      const emailBody = JSON.parse(emailInit.body);
      expect(emailBody.html).not.toContain("Open Linear issue");
      expect(emailBody.text).not.toContain("Linear:");
    });

    it("renders non-required open questions without the [required] marker in both email html and text", async () => {
      fetchMock.mockResolvedValue({ ok: true, text: vi.fn().mockResolvedValue("") });
      const service = new NotificationService(
        { emailFrom: "a@b.com", emailTo: "to@b.com", resendApiKey: "key" },
        logger as never,
      );

      await service.sendHumanRequest(
        makePayload({
          openQuestions: [{ id: "q1", question: "Is this optional?", requiredForExecution: false }],
        }),
      );

      const emailInit = fetchMock.mock.calls[0][1];
      const emailBody = JSON.parse(emailInit.body);
      expect(emailBody.html).toContain("Is this optional?");
      expect(emailBody.html).not.toContain("[required]");
      expect(emailBody.text).toContain("- Is this optional?");
      expect(emailBody.text).not.toContain("[required] Is this optional?");
    });

    it("records a thrown Error during the email send as its message", async () => {
      fetchMock.mockImplementation((url: string) => {
        if (url.includes("resend.com")) {
          return Promise.reject(new Error("smtp relay unreachable"));
        }
        return Promise.resolve({ ok: true, text: () => Promise.resolve("") });
      });
      const service = new NotificationService(
        { emailFrom: "a@b.com", emailTo: "to@b.com", resendApiKey: "key" },
        logger as never,
      );

      const result = await service.sendHumanRequest(makePayload());
      expect(result.email.ok).toBe(false);
      expect(result.email.error).toBe("smtp relay unreachable");
    });

    it("records a stringified non-Error thrown during the email send", async () => {
      fetchMock.mockImplementation((url: string) => {
        if (url.includes("resend.com")) {
          return Promise.reject("email rejection string");
        }
        return Promise.resolve({ ok: true, text: () => Promise.resolve("") });
      });
      const service = new NotificationService(
        { emailFrom: "a@b.com", emailTo: "to@b.com", resendApiKey: "key" },
        logger as never,
      );

      const result = await service.sendHumanRequest(makePayload());
      expect(result.email.ok).toBe(false);
      expect(result.email.error).toBe("email rejection string");
    });
  });
});
