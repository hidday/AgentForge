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
    summary: "The plan has an ambiguous step",
    runState: "AwaitingPlanApproval",
    runUrl: "https://agentforge.example/runs/run-1",
    linearIssue: {
      id: "issue-1",
      identifier: "PRY-1",
      title: "Do the thing",
      url: "https://linear.app/team/issue/PRY-1",
    },
    ...overrides,
  };
}

function okResponse(): Response {
  return { ok: true, status: 200, text: () => Promise.resolve("") } as Response;
}

function failResponse(status: number, body = "error body"): Response {
  return { ok: false, status, text: () => Promise.resolve(body) } as Response;
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
    it("is true when a Slack webhook URL is set", () => {
      const service = new NotificationService(
        { emailFrom: "from@example.com", slackWebhookUrl: "https://hooks.slack.com/x" },
        logger as never,
      );
      expect(service.isConfigured()).toBe(true);
    });

    it("is true when both emailTo and resendApiKey are set", () => {
      const service = new NotificationService(
        { emailFrom: "from@example.com", emailTo: "to@example.com", resendApiKey: "key" },
        logger as never,
      );
      expect(service.isConfigured()).toBe(true);
    });

    it("is false when emailTo is set but resendApiKey is missing", () => {
      const service = new NotificationService(
        { emailFrom: "from@example.com", emailTo: "to@example.com" },
        logger as never,
      );
      expect(service.isConfigured()).toBe(false);
    });

    it("is false when nothing is configured", () => {
      const service = new NotificationService({ emailFrom: "from@example.com" }, logger as never);
      expect(service.isConfigured()).toBe(false);
    });
  });

  describe("sendHumanRequest", () => {
    it("attempts neither channel when nothing is configured", async () => {
      const service = new NotificationService({ emailFrom: "from@example.com" }, logger as never);

      const result = await service.sendHumanRequest(makePayload());

      expect(result).toEqual({
        slack: { attempted: false, ok: false },
        email: { attempted: false, ok: false },
      });
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("sends a Slack notification successfully", async () => {
      fetchMock.mockResolvedValue(okResponse());
      const config: NotificationConfig = {
        emailFrom: "from@example.com",
        slackWebhookUrl: "https://hooks.slack.com/x",
      };
      const service = new NotificationService(config, logger as never);

      const result = await service.sendHumanRequest(makePayload());

      expect(result.slack).toEqual({ attempted: true, ok: true });
      expect(result.email).toEqual({ attempted: false, ok: false });
      expect(fetchMock).toHaveBeenCalledWith(
        "https://hooks.slack.com/x",
        expect.objectContaining({
          method: "POST",
          headers: { "Content-Type": "application/json" },
        }),
      );
      const body = JSON.parse(fetchMock.mock.calls[0][1].body as string) as { text: string };
      expect(body.text).toContain("PRY-1");
    });

    it("records a Slack failure without throwing, and logs a warning", async () => {
      fetchMock.mockResolvedValue(failResponse(500, "internal error"));
      const config: NotificationConfig = {
        emailFrom: "from@example.com",
        slackWebhookUrl: "https://hooks.slack.com/x",
      };
      const service = new NotificationService(config, logger as never);

      const result = await service.sendHumanRequest(makePayload());

      expect(result.slack.attempted).toBe(true);
      expect(result.slack.ok).toBe(false);
      expect(result.slack.error).toContain("Slack webhook returned 500");
      expect(logger.warn).toHaveBeenCalled();
    });

    it("sends an email successfully via Resend", async () => {
      fetchMock.mockResolvedValue(okResponse());
      const config: NotificationConfig = {
        emailFrom: "from@example.com",
        emailTo: "a@example.com, b@example.com",
        resendApiKey: "key-123",
      };
      const service = new NotificationService(config, logger as never);

      const result = await service.sendHumanRequest(makePayload());

      expect(result.email).toEqual({ attempted: true, ok: true });
      expect(fetchMock).toHaveBeenCalledWith(
        "https://api.resend.com/emails",
        expect.objectContaining({
          method: "POST",
          headers: {
            Authorization: "Bearer key-123",
            "Content-Type": "application/json",
          },
        }),
      );
      const body = JSON.parse(fetchMock.mock.calls[0][1].body as string) as { to: string[] };
      expect(body.to).toEqual(["a@example.com", "b@example.com"]);
    });

    it("stringifies a non-Error rejection from the Slack fetch call", async () => {
      fetchMock.mockRejectedValue("network exploded");
      const config: NotificationConfig = {
        emailFrom: "from@example.com",
        slackWebhookUrl: "https://hooks.slack.com/x",
      };
      const service = new NotificationService(config, logger as never);

      const result = await service.sendHumanRequest(makePayload());

      expect(result.slack.ok).toBe(false);
      expect(result.slack.error).toBe("network exploded");
      expect(logger.warn).toHaveBeenCalledWith(
        { runId: "run-1", error: "network exploded" },
        "Slack notification failed",
      );
    });

    it("stringifies a non-Error rejection from the email fetch call", async () => {
      fetchMock.mockRejectedValue("network exploded");
      const config: NotificationConfig = {
        emailFrom: "from@example.com",
        emailTo: "a@example.com",
        resendApiKey: "key-123",
      };
      const service = new NotificationService(config, logger as never);

      const result = await service.sendHumanRequest(makePayload());

      expect(result.email.ok).toBe(false);
      expect(result.email.error).toBe("network exploded");
      expect(logger.warn).toHaveBeenCalledWith(
        { runId: "run-1", error: "network exploded" },
        "Email notification failed",
      );
    });

    it("records an email failure without throwing, and logs a warning", async () => {
      fetchMock.mockResolvedValue(failResponse(403, "forbidden"));
      const config: NotificationConfig = {
        emailFrom: "from@example.com",
        emailTo: "a@example.com",
        resendApiKey: "key-123",
      };
      const service = new NotificationService(config, logger as never);

      const result = await service.sendHumanRequest(makePayload());

      expect(result.email.ok).toBe(false);
      expect(result.email.error).toContain("Resend returned 403");
      expect(logger.warn).toHaveBeenCalled();
    });

    it("sends both channels concurrently when both are configured", async () => {
      fetchMock.mockResolvedValue(okResponse());
      const config: NotificationConfig = {
        emailFrom: "from@example.com",
        emailTo: "a@example.com",
        resendApiKey: "key-123",
        slackWebhookUrl: "https://hooks.slack.com/x",
      };
      const service = new NotificationService(config, logger as never);

      const result = await service.sendHumanRequest(makePayload());

      expect(result.slack.ok).toBe(true);
      expect(result.email.ok).toBe(true);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it("handles a response.text() rejection when building the Slack error message", async () => {
      const badResponse = {
        ok: false,
        status: 502,
        text: () => Promise.reject(new Error("stream closed")),
      } as unknown as Response;
      fetchMock.mockResolvedValue(badResponse);
      const config: NotificationConfig = {
        emailFrom: "from@example.com",
        slackWebhookUrl: "https://hooks.slack.com/x",
      };
      const service = new NotificationService(config, logger as never);

      const result = await service.sendHumanRequest(makePayload());

      expect(result.slack.ok).toBe(false);
      expect(result.slack.error).toContain("Slack webhook returned 502");
    });

    it("includes planConfidence and openQuestions fields in the Slack payload", async () => {
      fetchMock.mockResolvedValue(okResponse());
      const config: NotificationConfig = {
        emailFrom: "from@example.com",
        slackWebhookUrl: "https://hooks.slack.com/x",
      };
      const service = new NotificationService(config, logger as never);

      const payload = makePayload({
        context: "x".repeat(2000),
        planConfidence: 0.42,
        openQuestions: [
          { id: "q1", question: "y".repeat(300), requiredForExecution: true },
          { id: "q2", question: "Another question", requiredForExecution: false },
          { id: "q3", question: "Third question", requiredForExecution: false },
          { id: "q4", question: "Fourth question (should be truncated from Slack list)", requiredForExecution: false },
        ],
      });

      await service.sendHumanRequest(payload);

      const body = JSON.parse(fetchMock.mock.calls[0][1].body as string) as {
        blocks: unknown[];
      };
      const serialized = JSON.stringify(body.blocks);
      expect(serialized).toContain("Plan confidence");
      expect(serialized).toContain("0.42");
      expect(serialized).toContain("Open questions");
      expect(serialized).toContain("4 (1 required)");
      expect(serialized).toContain("Context:");
      // Long context is truncated with an ellipsis.
      expect(serialized).toContain("…");
    });

    it("omits linearIssue.url button and uses id fallback when identifier/title/url are absent", async () => {
      fetchMock.mockResolvedValue(okResponse());
      const config: NotificationConfig = {
        emailFrom: "from@example.com",
        slackWebhookUrl: "https://hooks.slack.com/x",
      };
      const service = new NotificationService(config, logger as never);

      const payload = makePayload({
        linearIssue: { id: "issue-only-id", identifier: undefined, title: null, url: null },
      });

      await service.sendHumanRequest(payload);

      const body = JSON.parse(fetchMock.mock.calls[0][1].body as string) as { text: string };
      expect(body.text).toContain("issue-only-id");
      expect(body.text).toContain("(untitled)");
    });

    it("treats an empty (but defined) openQuestions array the same as absent", async () => {
      fetchMock.mockResolvedValue(okResponse());
      const config: NotificationConfig = {
        emailFrom: "from@example.com",
        emailTo: "a@example.com",
        resendApiKey: "key-123",
        slackWebhookUrl: "https://hooks.slack.com/x",
      };
      const service = new NotificationService(config, logger as never);

      await service.sendHumanRequest(makePayload({ openQuestions: [] }));

      const slackBody = JSON.parse(fetchMock.mock.calls[0][1].body as string) as {
        blocks: unknown[];
      };
      expect(JSON.stringify(slackBody.blocks)).not.toContain("Open questions");

      const emailBody = JSON.parse(fetchMock.mock.calls[1][1].body as string) as {
        html: string;
        text: string;
      };
      expect(emailBody.html).not.toContain("Open questions");
      expect(emailBody.text).not.toContain("Open questions");
    });

    it("covers every HumanRequestReason label", async () => {
      fetchMock.mockResolvedValue(okResponse());
      const config: NotificationConfig = {
        emailFrom: "from@example.com",
        slackWebhookUrl: "https://hooks.slack.com/x",
      };
      const service = new NotificationService(config, logger as never);

      const reasons: NotificationPayload["reason"][] = [
        "plan_ambiguous",
        "plan_low_confidence",
        "impl_rejected",
        "impl_uncertain",
        "other",
      ];

      for (const reason of reasons) {
        fetchMock.mockClear();
        await service.sendHumanRequest(makePayload({ reason }));
        expect(fetchMock).toHaveBeenCalled();
      }
    });

    it("renders full email html/text including context, confidence, and open questions", async () => {
      fetchMock.mockResolvedValue(okResponse());
      const config: NotificationConfig = {
        emailFrom: "from@example.com",
        emailTo: "a@example.com",
        resendApiKey: "key-123",
      };
      const service = new NotificationService(config, logger as never);

      const payload = makePayload({
        context: "some <b>raw</b> & \"quoted\" context",
        planConfidence: 0.75,
        openQuestions: [
          { id: "q1", question: "Required question", requiredForExecution: true },
          { id: "q2", question: "Optional question", requiredForExecution: false },
        ],
      });

      await service.sendHumanRequest(payload);

      const body = JSON.parse(fetchMock.mock.calls[0][1].body as string) as {
        html: string;
        text: string;
        subject: string;
      };
      expect(body.subject).toContain("PRY-1");
      expect(body.html).toContain("&lt;b&gt;raw&lt;/b&gt;");
      expect(body.html).toContain("Plan confidence");
      expect(body.html).toContain("[required]");
      expect(body.html).toContain("Open Linear issue");
      expect(body.text).toContain("Plan confidence: 0.75");
      expect(body.text).toContain("[required] Required question");
      expect(body.text).toContain("Linear: https://linear.app/team/issue/PRY-1");
    });

    it("omits html linearLink and confidence line when url and planConfidence are absent", async () => {
      fetchMock.mockResolvedValue(okResponse());
      const config: NotificationConfig = {
        emailFrom: "from@example.com",
        emailTo: "a@example.com",
        resendApiKey: "key-123",
      };
      const service = new NotificationService(config, logger as never);

      const payload = makePayload({
        linearIssue: { id: "issue-1", identifier: undefined, title: null, url: null },
      });

      await service.sendHumanRequest(payload);

      const body = JSON.parse(fetchMock.mock.calls[0][1].body as string) as {
        html: string;
        text: string;
      };
      expect(body.html).not.toContain("Open Linear issue");
      expect(body.html).not.toContain("Plan confidence");
      expect(body.text).not.toContain("Linear:");
    });
  });
});
