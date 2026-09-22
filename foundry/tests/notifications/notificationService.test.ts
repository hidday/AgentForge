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
    summary: "The plan needs review.",
    linearIssue: {
      id: "lin-1",
      identifier: "ENG-42",
      title: "Add feature",
      url: "https://linear.app/team/issue/ENG-42",
    },
    runState: "PlanReview",
    runUrl: "https://agentforge.example.com/runs/run-1",
    ...overrides,
  };
}

describe("NotificationService", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe("isConfigured", () => {
    const base: NotificationConfig = { emailFrom: "bot@agentforge.dev" };

    it("is true when a slackWebhookUrl is set", () => {
      const svc = new NotificationService(
        { ...base, slackWebhookUrl: "https://hooks.slack.com/x" },
        makeLogger() as never,
      );
      expect(svc.isConfigured()).toBe(true);
    });

    it("is true when both emailTo and resendApiKey are set", () => {
      const svc = new NotificationService(
        { ...base, emailTo: "team@example.com", resendApiKey: "key" },
        makeLogger() as never,
      );
      expect(svc.isConfigured()).toBe(true);
    });

    it("is false when only emailTo is set without an API key", () => {
      const svc = new NotificationService(
        { ...base, emailTo: "team@example.com" },
        makeLogger() as never,
      );
      expect(svc.isConfigured()).toBe(false);
    });

    it("is false when only resendApiKey is set without a recipient", () => {
      const svc = new NotificationService({ ...base, resendApiKey: "key" }, makeLogger() as never);
      expect(svc.isConfigured()).toBe(false);
    });

    it("is false when nothing is configured", () => {
      const svc = new NotificationService(base, makeLogger() as never);
      expect(svc.isConfigured()).toBe(false);
    });
  });

  describe("sendHumanRequest", () => {
    it("attempts nothing and returns all-false when unconfigured", async () => {
      const svc = new NotificationService({ emailFrom: "bot@agentforge.dev" }, makeLogger() as never);

      const result = await svc.sendHumanRequest(makePayload());

      expect(result).toEqual({
        slack: { attempted: false, ok: false },
        email: { attempted: false, ok: false },
      });
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("posts to the Slack webhook with the expected URL, method, headers and JSON body", async () => {
      fetchMock.mockResolvedValue({ ok: true, status: 200 });
      const svc = new NotificationService(
        { emailFrom: "bot@agentforge.dev", slackWebhookUrl: "https://hooks.slack.com/services/x" },
        makeLogger() as never,
      );

      const result = await svc.sendHumanRequest(
        makePayload({ planConfidence: 0.42, openQuestions: [
          { id: "q1", question: "Which auth flow?", requiredForExecution: true },
        ] }),
      );

      expect(result.slack).toEqual({ attempted: true, ok: true });
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe("https://hooks.slack.com/services/x");
      expect(init.method).toBe("POST");
      expect(init.headers).toEqual({ "Content-Type": "application/json" });

      const body = JSON.parse(init.body as string) as { text: string; blocks: unknown[] };
      expect(body.text).toContain("Plan needs review (ambiguous)");
      expect(body.text).toContain("ENG-42: Add feature");
      const flat = JSON.stringify(body.blocks);
      expect(flat).toContain("Plan confidence:");
      expect(flat).toContain("0.42");
      expect(flat).toContain("Which auth flow?");
      expect(flat).toContain("Open run");
      expect(flat).toContain("Open Linear issue");
    });

    it("omits the Linear issue button when the issue has no url", async () => {
      fetchMock.mockResolvedValue({ ok: true, status: 200 });
      const svc = new NotificationService(
        { emailFrom: "bot@agentforge.dev", slackWebhookUrl: "https://hooks.slack.com/x" },
        makeLogger() as never,
      );

      await svc.sendHumanRequest(
        makePayload({ linearIssue: { id: "lin-1", title: "Untitled work", url: null } }),
      );

      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(init.body as string) as { blocks: unknown[] };
      const flat = JSON.stringify(body.blocks);
      expect(flat).not.toContain("Open Linear issue");
      expect(flat).toContain("Untitled work");
    });

    it("includes a context block, truncated, when context is provided", async () => {
      fetchMock.mockResolvedValue({ ok: true, status: 200 });
      const svc = new NotificationService(
        { emailFrom: "bot@agentforge.dev", slackWebhookUrl: "https://hooks.slack.com/x" },
        makeLogger() as never,
      );
      const longContext = "x".repeat(2000);

      await svc.sendHumanRequest(makePayload({ context: longContext }));

      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(init.body as string) as { blocks: unknown[] };
      const flat = JSON.stringify(body.blocks);
      expect(flat).toContain("Context:");
      // Truncated to 1500 chars plus an ellipsis, so the full 2000-char run should not appear.
      expect(flat).not.toContain("x".repeat(1600));
    });

    it("shows only the first 3 open questions in the Slack message", async () => {
      fetchMock.mockResolvedValue({ ok: true, status: 200 });
      const svc = new NotificationService(
        { emailFrom: "bot@agentforge.dev", slackWebhookUrl: "https://hooks.slack.com/x" },
        makeLogger() as never,
      );
      const openQuestions = Array.from({ length: 5 }, (_, i) => ({
        id: `q${String(i)}`,
        question: `Question number ${String(i)}?`,
        requiredForExecution: i === 0,
      }));

      await svc.sendHumanRequest(makePayload({ openQuestions }));

      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(init.body as string) as { blocks: unknown[] };
      const flat = JSON.stringify(body.blocks);
      expect(flat).toContain("Question number 0?");
      expect(flat).toContain("Question number 2?");
      expect(flat).not.toContain("Question number 3?");
      expect(flat).toContain("[required]");
      expect(flat).toContain("5 (1 required)");
    });

    it("renders the correct label for every HumanRequestReason", async () => {
      fetchMock.mockResolvedValue({ ok: true, status: 200 });
      const svc = new NotificationService(
        { emailFrom: "bot@agentforge.dev", slackWebhookUrl: "https://hooks.slack.com/x" },
        makeLogger() as never,
      );
      const expected: Record<NotificationPayload["reason"], string> = {
        plan_ambiguous: "Plan needs review (ambiguous)",
        plan_low_confidence: "Plan needs review (low confidence)",
        impl_rejected: "Implementation needs review (rejected by agent)",
        impl_uncertain: "Implementation needs review (uncertain)",
        other: "Human intervention requested",
      };

      for (const [reason, label] of Object.entries(expected) as [
        NotificationPayload["reason"],
        string,
      ][]) {
        fetchMock.mockClear();
        await svc.sendHumanRequest(makePayload({ reason }));
        const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
        const body = JSON.parse(init.body as string) as { text: string };
        expect(body.text).toContain(label);
      }
    });

    it("marks slack as failed and logs a warning on a non-ok response", async () => {
      fetchMock.mockResolvedValue({
        ok: false,
        status: 500,
        text: () => Promise.resolve("Internal error"),
      });
      const logger = makeLogger();
      const svc = new NotificationService(
        { emailFrom: "bot@agentforge.dev", slackWebhookUrl: "https://hooks.slack.com/x" },
        logger as never,
      );

      const result = await svc.sendHumanRequest(makePayload());

      expect(result.slack).toEqual({
        attempted: true,
        ok: false,
        error: "Slack webhook returned 500: Internal error",
      });
      expect(logger.warn).toHaveBeenCalledWith(
        { runId: "run-1", error: "Slack webhook returned 500: Internal error" },
        "Slack notification failed",
      );
    });

    it("marks slack as failed when response.text() itself rejects", async () => {
      fetchMock.mockResolvedValue({
        ok: false,
        status: 503,
        text: () => Promise.reject(new Error("stream closed")),
      });
      const svc = new NotificationService(
        { emailFrom: "bot@agentforge.dev", slackWebhookUrl: "https://hooks.slack.com/x" },
        makeLogger() as never,
      );

      const result = await svc.sendHumanRequest(makePayload());

      expect(result.slack.ok).toBe(false);
      expect(result.slack.error).toBe("Slack webhook returned 503: ");
    });

    it("marks slack as failed on a network error (fetch rejects)", async () => {
      fetchMock.mockRejectedValue(new Error("ECONNREFUSED"));
      const svc = new NotificationService(
        { emailFrom: "bot@agentforge.dev", slackWebhookUrl: "https://hooks.slack.com/x" },
        makeLogger() as never,
      );

      const result = await svc.sendHumanRequest(makePayload());

      expect(result.slack).toEqual({ attempted: true, ok: false, error: "ECONNREFUSED" });
    });

    it("stringifies a non-Error rejection from the slack fetch call", async () => {
      // eslint-disable-next-line @typescript-eslint/only-throw-error, prefer-promise-reject-errors
      fetchMock.mockRejectedValue("offline");
      const svc = new NotificationService(
        { emailFrom: "bot@agentforge.dev", slackWebhookUrl: "https://hooks.slack.com/x" },
        makeLogger() as never,
      );

      const result = await svc.sendHumanRequest(makePayload());

      expect(result.slack).toEqual({ attempted: true, ok: false, error: "offline" });
    });

    it("posts to the Resend API with the expected URL, auth header and JSON body", async () => {
      fetchMock.mockResolvedValue({ ok: true, status: 200 });
      const svc = new NotificationService(
        {
          emailFrom: "bot@agentforge.dev",
          emailTo: "a@example.com, b@example.com",
          resendApiKey: "re_123",
        },
        makeLogger() as never,
      );

      const result = await svc.sendHumanRequest(makePayload());

      expect(result.email).toEqual({ attempted: true, ok: true });
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe("https://api.resend.com/emails");
      expect(init.method).toBe("POST");
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
      expect(body.from).toBe("bot@agentforge.dev");
      expect(body.to).toEqual(["a@example.com", "b@example.com"]);
      expect(body.subject).toContain("[AgentForge]");
      expect(body.subject).toContain("ENG-42: Add feature");
      expect(body.html).toContain("<html>");
      expect(body.html).toContain("Add feature");
      expect(body.text).toContain("ENG-42: Add feature");
    });

    it("includes plan confidence and open questions in both the HTML and plain-text email bodies", async () => {
      fetchMock.mockResolvedValue({ ok: true, status: 200 });
      const svc = new NotificationService(
        { emailFrom: "bot@agentforge.dev", emailTo: "a@example.com", resendApiKey: "re_123" },
        makeLogger() as never,
      );
      const openQuestions = Array.from({ length: 6 }, (_, i) => ({
        id: `q${String(i)}`,
        question: `Question ${String(i)}?`,
        requiredForExecution: i === 0,
      }));

      await svc.sendHumanRequest(makePayload({ planConfidence: 0.87, openQuestions, context: "some ctx" }));

      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(init.body as string) as { html: string; text: string };

      expect(body.html).toContain("Plan confidence:</strong> 0.87");
      expect(body.html).toContain("Open questions:");
      expect(body.html).toContain("<strong>[required]</strong> Question 0?");
      expect(body.html).toContain("Question 4?");
      expect(body.html).not.toContain("Question 5?"); // sliced to first 5
      expect(body.html).toContain("Context:");

      expect(body.text).toContain("Plan confidence: 0.87");
      expect(body.text).toContain("Open questions:");
      expect(body.text).toContain("- [required] Question 0?");
      expect(body.text).toContain("Question 4?");
      expect(body.text).not.toContain("Question 5?");
      expect(body.text).toContain("Context:");
      expect(body.text).toContain("some ctx");
      expect(body.text).toContain("Linear: https://linear.app/team/issue/ENG-42");
    });

    it("filters blank entries out of a comma-separated recipient list", async () => {
      fetchMock.mockResolvedValue({ ok: true, status: 200 });
      const svc = new NotificationService(
        { emailFrom: "bot@agentforge.dev", emailTo: "a@example.com, , b@example.com,", resendApiKey: "re_123" },
        makeLogger() as never,
      );

      await svc.sendHumanRequest(makePayload());

      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(init.body as string) as { to: string[] };
      expect(body.to).toEqual(["a@example.com", "b@example.com"]);
    });

    it("marks email as failed and logs a warning on a non-ok response", async () => {
      fetchMock.mockResolvedValue({
        ok: false,
        status: 422,
        text: () => Promise.resolve("Invalid `to` field"),
      });
      const logger = makeLogger();
      const svc = new NotificationService(
        { emailFrom: "bot@agentforge.dev", emailTo: "a@example.com", resendApiKey: "re_123" },
        logger as never,
      );

      const result = await svc.sendHumanRequest(makePayload());

      expect(result.email).toEqual({
        attempted: true,
        ok: false,
        error: "Resend returned 422: Invalid `to` field",
      });
      expect(logger.warn).toHaveBeenCalledWith(
        { runId: "run-1", error: "Resend returned 422: Invalid `to` field" },
        "Email notification failed",
      );
    });

    it("marks email as failed on a network error (fetch rejects)", async () => {
      fetchMock.mockRejectedValue(new Error("DNS lookup failed"));
      const svc = new NotificationService(
        { emailFrom: "bot@agentforge.dev", emailTo: "a@example.com", resendApiKey: "re_123" },
        makeLogger() as never,
      );

      const result = await svc.sendHumanRequest(makePayload());

      expect(result.email).toEqual({ attempted: true, ok: false, error: "DNS lookup failed" });
    });

    it("stringifies a non-Error rejection from the email fetch call", async () => {
      // eslint-disable-next-line @typescript-eslint/only-throw-error, prefer-promise-reject-errors
      fetchMock.mockRejectedValue("offline");
      const svc = new NotificationService(
        { emailFrom: "bot@agentforge.dev", emailTo: "a@example.com", resendApiKey: "re_123" },
        makeLogger() as never,
      );

      const result = await svc.sendHumanRequest(makePayload());

      expect(result.email).toEqual({ attempted: true, ok: false, error: "offline" });
    });

    it("attempts and reports both slack and email independently when both are configured", async () => {
      fetchMock
        .mockResolvedValueOnce({ ok: true, status: 200 }) // slack
        .mockResolvedValueOnce({ ok: false, status: 500, text: () => Promise.resolve("err") }); // email
      const svc = new NotificationService(
        {
          emailFrom: "bot@agentforge.dev",
          slackWebhookUrl: "https://hooks.slack.com/x",
          emailTo: "a@example.com",
          resendApiKey: "re_123",
        },
        makeLogger() as never,
      );

      const result = await svc.sendHumanRequest(makePayload());

      expect(result.slack).toEqual({ attempted: true, ok: true });
      expect(result.email).toEqual({
        attempted: true,
        ok: false,
        error: "Resend returned 500: err",
      });
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it("renders the 'other' reason label and an untitled/missing-url issue in Slack and email bodies", async () => {
      fetchMock.mockResolvedValue({ ok: true, status: 200 });
      const svc = new NotificationService(
        {
          emailFrom: "bot@agentforge.dev",
          slackWebhookUrl: "https://hooks.slack.com/x",
          emailTo: "a@example.com",
          resendApiKey: "re_123",
        },
        makeLogger() as never,
      );

      await svc.sendHumanRequest(
        makePayload({
          reason: "other",
          linearIssue: { id: "lin-9", title: null, url: null },
        }),
      );

      const [slackUrl, slackInit] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(slackUrl).toContain("hooks.slack.com");
      const slackBody = JSON.parse(slackInit.body as string) as { text: string };
      expect(slackBody.text).toContain("Human intervention requested");
      expect(slackBody.text).toContain("lin-9: (untitled)");

      const [, emailInit] = fetchMock.mock.calls[1] as [string, RequestInit];
      const emailBody = JSON.parse(emailInit.body as string) as { subject: string; html: string };
      expect(emailBody.subject).toContain("lin-9: (untitled)");
      expect(emailBody.html).toContain("(untitled)");
    });

    it("escapes HTML-significant characters in the email body", async () => {
      fetchMock.mockResolvedValue({ ok: true, status: 200 });
      const svc = new NotificationService(
        { emailFrom: "bot@agentforge.dev", emailTo: "a@example.com", resendApiKey: "re_123" },
        makeLogger() as never,
      );

      await svc.sendHumanRequest(
        makePayload({
          summary: `<script>alert("x")</script> & 'quote'`,
          linearIssue: { id: "lin-1", title: "A & B <C>", url: "https://x.test/?a=1&b=2" },
        }),
      );

      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(init.body as string) as { html: string };
      expect(body.html).not.toContain("<script>");
      expect(body.html).toContain("&lt;script&gt;");
      expect(body.html).toContain("&amp;");
      expect(body.html).toContain("&#39;quote&#39;");
      expect(body.html).toContain("A &amp; B &lt;C&gt;");
    });
  });
});
