import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  NotificationService,
  type NotificationConfig,
  type NotificationPayload,
  type HumanRequestReason,
} from "../../src/notifications/notificationService.js";

function makeLogger() {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

function makePayload(overrides: Partial<NotificationPayload> = {}): NotificationPayload {
  return {
    runId: "run-1",
    reason: "plan_ambiguous",
    summary: "The plan has an unresolved ambiguity around auth scopes.",
    linearIssue: {
      id: "issue-1",
      identifier: "ENG-42",
      title: "Add SSO support",
      url: "https://linear.app/acme/issue/ENG-42",
    },
    runState: "HumanClarificationNeeded",
    runUrl: "https://dashboard.example.com/runs/run-1",
    ...overrides,
  };
}

function jsonResponse(ok: boolean, status = 200, textBody = "") {
  return {
    ok,
    status,
    text: vi.fn().mockResolvedValue(textBody),
  };
}

describe("NotificationService", () => {
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

  describe("isConfigured", () => {
    it("is false when nothing is configured", () => {
      const service = new NotificationService(
        { emailFrom: "noreply@example.com" },
        logger as never,
      );
      expect(service.isConfigured()).toBe(false);
    });

    it("is true when a slack webhook is configured", () => {
      const service = new NotificationService(
        { emailFrom: "noreply@example.com", slackWebhookUrl: "https://hooks.slack.test/abc" },
        logger as never,
      );
      expect(service.isConfigured()).toBe(true);
    });

    it("is true when both emailTo and resendApiKey are configured", () => {
      const service = new NotificationService(
        {
          emailFrom: "noreply@example.com",
          emailTo: "team@example.com",
          resendApiKey: "re_123",
        },
        logger as never,
      );
      expect(service.isConfigured()).toBe(true);
    });

    it("is false when only emailTo is configured without an api key", () => {
      const service = new NotificationService(
        { emailFrom: "noreply@example.com", emailTo: "team@example.com" },
        logger as never,
      );
      expect(service.isConfigured()).toBe(false);
    });

    it("is false when only resendApiKey is configured without a recipient", () => {
      const service = new NotificationService(
        { emailFrom: "noreply@example.com", resendApiKey: "re_123" },
        logger as never,
      );
      expect(service.isConfigured()).toBe(false);
    });
  });

  describe("sendHumanRequest", () => {
    it("attempts nothing and makes no network calls when unconfigured", async () => {
      const service = new NotificationService(
        { emailFrom: "noreply@example.com" },
        logger as never,
      );
      const result = await service.sendHumanRequest(makePayload());

      expect(fetchMock).not.toHaveBeenCalled();
      expect(result).toEqual({
        slack: { attempted: false, ok: false },
        email: { attempted: false, ok: false },
      });
    });

    it("posts to the slack webhook and reports success", async () => {
      fetchMock.mockResolvedValue(jsonResponse(true));
      const config: NotificationConfig = {
        emailFrom: "noreply@example.com",
        slackWebhookUrl: "https://hooks.slack.test/abc",
      };
      const service = new NotificationService(config, logger as never);

      const result = await service.sendHumanRequest(makePayload());

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe("https://hooks.slack.test/abc");
      expect(init.method).toBe("POST");
      expect(init.headers).toEqual({ "Content-Type": "application/json" });
      const body = JSON.parse(init.body as string) as { text: string; blocks: unknown[] };
      expect(body.text).toContain("Plan needs review (ambiguous)");
      expect(body.text).toContain("ENG-42: Add SSO support");

      expect(result.slack).toEqual({ attempted: true, ok: true });
      expect(result.email).toEqual({ attempted: false, ok: false });
    });

    it("records a slack failure with the response status and logs a warning", async () => {
      fetchMock.mockResolvedValue(jsonResponse(false, 500, "internal error"));
      const config: NotificationConfig = {
        emailFrom: "noreply@example.com",
        slackWebhookUrl: "https://hooks.slack.test/abc",
      };
      const service = new NotificationService(config, logger as never);

      const result = await service.sendHumanRequest(makePayload());

      expect(result.slack.attempted).toBe(true);
      expect(result.slack.ok).toBe(false);
      expect(result.slack.error).toContain("Slack webhook returned 500");
      expect(result.slack.error).toContain("internal error");
      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ runId: "run-1", error: result.slack.error }),
        "Slack notification failed",
      );
    });

    it("falls back to an empty body when reading the error response text fails", async () => {
      const response = {
        ok: false,
        status: 503,
        text: vi.fn().mockRejectedValue(new Error("stream closed")),
      };
      fetchMock.mockResolvedValue(response);
      const config: NotificationConfig = {
        emailFrom: "noreply@example.com",
        slackWebhookUrl: "https://hooks.slack.test/abc",
      };
      const service = new NotificationService(config, logger as never);

      const result = await service.sendHumanRequest(makePayload());

      expect(result.slack.error).toBe("Slack webhook returned 503: ");
    });

    it("handles a slack fetch rejection that is not an Error instance", async () => {
      fetchMock.mockRejectedValue("network down");
      const config: NotificationConfig = {
        emailFrom: "noreply@example.com",
        slackWebhookUrl: "https://hooks.slack.test/abc",
      };
      const service = new NotificationService(config, logger as never);

      const result = await service.sendHumanRequest(makePayload());

      expect(result.slack.error).toBe("network down");
    });

    it("handles an email fetch rejection that is not an Error instance", async () => {
      fetchMock.mockRejectedValue("smtp gateway down");
      const config: NotificationConfig = {
        emailFrom: "noreply@example.com",
        emailTo: "a@example.com",
        resendApiKey: "re_123",
      };
      const service = new NotificationService(config, logger as never);

      const result = await service.sendHumanRequest(makePayload());

      expect(result.email.ok).toBe(false);
      expect(result.email.error).toBe("smtp gateway down");
      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ runId: "run-1", error: "smtp gateway down" }),
        "Email notification failed",
      );
    });

    it("posts to Resend and reports success when email is configured", async () => {
      fetchMock.mockResolvedValue(jsonResponse(true));
      const config: NotificationConfig = {
        emailFrom: "noreply@example.com",
        emailTo: "a@example.com, , b@example.com",
        resendApiKey: "re_123",
      };
      const service = new NotificationService(config, logger as never);

      const result = await service.sendHumanRequest(makePayload());

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe("https://api.resend.com/emails");
      expect(init.headers).toEqual({
        Authorization: "Bearer re_123",
        "Content-Type": "application/json",
      });
      const body = JSON.parse(init.body as string) as {
        from: string;
        to: string[];
        subject: string;
        html: string;
        text: string;
      };
      expect(body.from).toBe("noreply@example.com");
      expect(body.to).toEqual(["a@example.com", "b@example.com"]);
      expect(body.subject).toContain("[AgentForge] Plan needs review (ambiguous)");
      expect(body.html).toContain("Add SSO support");
      expect(body.text).toContain("ENG-42: Add SSO support");

      expect(result.email).toEqual({ attempted: true, ok: true });
    });

    it("records an email failure and logs a warning", async () => {
      fetchMock.mockResolvedValue(jsonResponse(false, 422, "bad request"));
      const config: NotificationConfig = {
        emailFrom: "noreply@example.com",
        emailTo: "a@example.com",
        resendApiKey: "re_123",
      };
      const service = new NotificationService(config, logger as never);

      const result = await service.sendHumanRequest(makePayload());

      expect(result.email.ok).toBe(false);
      expect(result.email.error).toContain("Resend returned 422");
      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ runId: "run-1", error: result.email.error }),
        "Email notification failed",
      );
    });

    it("sends both slack and email concurrently when both are configured", async () => {
      fetchMock.mockResolvedValue(jsonResponse(true));
      const config: NotificationConfig = {
        emailFrom: "noreply@example.com",
        slackWebhookUrl: "https://hooks.slack.test/abc",
        emailTo: "a@example.com",
        resendApiKey: "re_123",
      };
      const service = new NotificationService(config, logger as never);

      const result = await service.sendHumanRequest(makePayload());

      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(result.slack).toEqual({ attempted: true, ok: true });
      expect(result.email).toEqual({ attempted: true, ok: true });
    });

    it.each<[HumanRequestReason, string]>([
      ["plan_ambiguous", "Plan needs review (ambiguous)"],
      ["plan_low_confidence", "Plan needs review (low confidence)"],
      ["impl_rejected", "Implementation needs review (rejected by agent)"],
      ["impl_uncertain", "Implementation needs review (uncertain)"],
      ["other", "Human intervention requested"],
    ])("formats the %s reason as %s", async (reason, label) => {
      fetchMock.mockResolvedValue(jsonResponse(true));
      const config: NotificationConfig = {
        emailFrom: "noreply@example.com",
        slackWebhookUrl: "https://hooks.slack.test/abc",
      };
      const service = new NotificationService(config, logger as never);

      await service.sendHumanRequest(makePayload({ reason }));

      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(init.body as string) as { text: string };
      expect(body.text).toContain(label);
    });

    it("includes plan confidence, open questions, and context fields when present", async () => {
      fetchMock.mockResolvedValue(jsonResponse(true));
      const config: NotificationConfig = {
        emailFrom: "noreply@example.com",
        slackWebhookUrl: "https://hooks.slack.test/abc",
      };
      const service = new NotificationService(config, logger as never);

      const payload = makePayload({
        planConfidence: 0.42,
        context: "Some long context about the ambiguity.",
        openQuestions: [
          { id: "q1", question: "Which auth provider?", requiredForExecution: true },
          { id: "q2", question: "Which region?", requiredForExecution: false },
        ],
      });

      await service.sendHumanRequest(payload);

      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(init.body as string) as { blocks: unknown[] };
      const serialized = JSON.stringify(body.blocks);
      expect(serialized).toContain("0.42");
      expect(serialized).toContain("Open questions:");
      expect(serialized).toContain("2 (1 required)");
      expect(serialized).toContain("Some long context about the ambiguity.");
      expect(serialized).toContain("[required] Which auth provider?");
      expect(serialized).toContain("Which region?");
    });

    it("omits optional slack fields and the Linear button when absent", async () => {
      fetchMock.mockResolvedValue(jsonResponse(true));
      const config: NotificationConfig = {
        emailFrom: "noreply@example.com",
        slackWebhookUrl: "https://hooks.slack.test/abc",
      };
      const service = new NotificationService(config, logger as never);

      const payload = makePayload({
        planConfidence: undefined,
        context: undefined,
        openQuestions: undefined,
        linearIssue: { id: "issue-1", title: null, url: null },
      });

      await service.sendHumanRequest(payload);

      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(init.body as string) as {
        text: string;
        blocks: { type: string; elements?: { text: { text: string } }[] }[];
      };
      expect(body.text).toContain("issue-1: (untitled)");
      const serialized = JSON.stringify(body.blocks);
      expect(serialized).not.toContain("Plan confidence");
      expect(serialized).not.toContain("Context:");
      expect(serialized).not.toContain("Questions:");

      const actionsBlock = body.blocks.find((b) => b.type === "actions");
      expect(actionsBlock?.elements).toHaveLength(1);
      expect(actionsBlock?.elements?.[0]?.text.text).toBe("Open run");
    });

    it("truncates a long slack context to 1500 characters", async () => {
      fetchMock.mockResolvedValue(jsonResponse(true));
      const config: NotificationConfig = {
        emailFrom: "noreply@example.com",
        slackWebhookUrl: "https://hooks.slack.test/abc",
      };
      const service = new NotificationService(config, logger as never);

      const longContext = "x".repeat(2000);
      await service.sendHumanRequest(makePayload({ context: longContext }));

      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      const serialized = init.body as string;
      expect(serialized).toContain("x".repeat(1499) + "…");
      expect(serialized).not.toContain("x".repeat(1500) + "x");
    });

    it("renders email html and text with escaping, confidence, context, and questions", async () => {
      fetchMock.mockResolvedValue(jsonResponse(true));
      const config: NotificationConfig = {
        emailFrom: "noreply@example.com",
        emailTo: "a@example.com",
        resendApiKey: "re_123",
      };
      const service = new NotificationService(config, logger as never);

      const payload = makePayload({
        planConfidence: 0.8,
        context: "Some <b>raw</b> & \"quoted\" context",
        openQuestions: [
          { id: "q1", question: "A & B?", requiredForExecution: true },
          { id: "q2", question: "Optional one?", requiredForExecution: false },
        ],
        linearIssue: {
          id: "issue-1",
          identifier: "ENG-42",
          title: "SSO <support>",
          url: "https://linear.app/acme/issue/ENG-42",
        },
      });

      await service.sendHumanRequest(payload);

      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(init.body as string) as { html: string; text: string };
      expect(body.html).toContain("SSO &lt;support&gt;");
      expect(body.html).toContain("Some &lt;b&gt;raw&lt;/b&gt; &amp; &quot;quoted&quot; context");
      expect(body.html).toContain("Plan confidence:</strong> 0.80");
      expect(body.html).toContain("<strong>[required]</strong> A &amp; B?");
      expect(body.html).toContain("<li>Optional one?</li>");
      expect(body.html).toContain('href="https://linear.app/acme/issue/ENG-42"');

      expect(body.text).toContain("Plan confidence: 0.80");
      expect(body.text).toContain("[required] A & B?");
      expect(body.text).toContain("- Optional one?");
      expect(body.text).toContain("Linear: https://linear.app/acme/issue/ENG-42");
    });

    it("omits optional email sections when absent and handles an untitled/no-url issue", async () => {
      fetchMock.mockResolvedValue(jsonResponse(true));
      const config: NotificationConfig = {
        emailFrom: "noreply@example.com",
        emailTo: "a@example.com",
        resendApiKey: "re_123",
      };
      const service = new NotificationService(config, logger as never);

      const payload = makePayload({
        planConfidence: undefined,
        context: undefined,
        openQuestions: undefined,
        linearIssue: { id: "issue-1", title: null, url: null },
      });

      await service.sendHumanRequest(payload);

      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(init.body as string) as { html: string; text: string; subject: string };
      expect(body.subject).toContain("issue-1: (untitled)");
      expect(body.html).not.toContain("Plan confidence");
      expect(body.html).not.toContain("Context:");
      expect(body.html).not.toContain("Open questions:");
      expect(body.html).not.toContain('href="https://linear.app');
      expect(body.text).not.toContain("Plan confidence");
      expect(body.text).not.toContain("Context:");
      expect(body.text).not.toContain("Open questions:");
      expect(body.text).not.toContain("Linear:");
    });
  });
});
