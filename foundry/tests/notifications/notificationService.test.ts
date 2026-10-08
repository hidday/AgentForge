import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NotificationService, type NotificationPayload } from "../../src/notifications/notificationService.js";

function makeLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
}

function makePayload(overrides: Partial<NotificationPayload> = {}): NotificationPayload {
  return {
    runId: "run-1",
    reason: "plan_ambiguous",
    summary: "The plan is missing key details",
    linearIssue: { id: "issue-1", identifier: "LIN-1", title: "Add login", url: "https://linear.app/x/LIN-1" },
    runState: "AwaitingPlanApproval",
    runUrl: "http://localhost:5173/runs/run-1",
    ...overrides,
  };
}

describe("NotificationService", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue({ ok: true, text: async () => "" });
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe("isConfigured()", () => {
    it("is true when a Slack webhook URL is set", () => {
      const svc = new NotificationService({ slackWebhookUrl: "https://hooks.slack.com/x", emailFrom: "a@b.com" }, makeLogger() as never);
      expect(svc.isConfigured()).toBe(true);
    });

    it("is true when both emailTo and resendApiKey are set", () => {
      const svc = new NotificationService(
        { emailTo: "a@b.com", emailFrom: "from@b.com", resendApiKey: "key" },
        makeLogger() as never,
      );
      expect(svc.isConfigured()).toBe(true);
    });

    it("is false when emailTo is set but resendApiKey is missing", () => {
      const svc = new NotificationService({ emailTo: "a@b.com", emailFrom: "from@b.com" }, makeLogger() as never);
      expect(svc.isConfigured()).toBe(false);
    });

    it("is false when no channel is configured", () => {
      const svc = new NotificationService({ emailFrom: "from@b.com" }, makeLogger() as never);
      expect(svc.isConfigured()).toBe(false);
    });
  });

  describe("sendHumanRequest()", () => {
    it("attempts nothing and returns all-false when no channel is configured", async () => {
      const svc = new NotificationService({ emailFrom: "from@b.com" }, makeLogger() as never);

      const result = await svc.sendHumanRequest(makePayload());

      expect(result).toEqual({
        slack: { attempted: false, ok: false },
        email: { attempted: false, ok: false },
      });
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("posts to the Slack webhook and reports ok:true on success", async () => {
      const svc = new NotificationService(
        { slackWebhookUrl: "https://hooks.slack.com/x", emailFrom: "from@b.com" },
        makeLogger() as never,
      );

      const result = await svc.sendHumanRequest(makePayload());

      expect(result.slack).toEqual({ attempted: true, ok: true });
      expect(fetchMock).toHaveBeenCalledWith(
        "https://hooks.slack.com/x",
        expect.objectContaining({ method: "POST" }),
      );
      const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
      expect(body.text).toContain("LIN-1");
      expect(body.text).toContain("Add login");
    });

    it("includes plan confidence and open questions in the Slack payload when present", async () => {
      const svc = new NotificationService(
        { slackWebhookUrl: "https://hooks.slack.com/x", emailFrom: "from@b.com" },
        makeLogger() as never,
      );

      await svc.sendHumanRequest(
        makePayload({
          planConfidence: 0.42,
          context: "Some extra background",
          openQuestions: [
            { id: "q1", question: "What auth provider?", requiredForExecution: true },
            { id: "q2", question: "Which region?", requiredForExecution: false },
          ],
        }),
      );

      const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
      const serialized = JSON.stringify(body);
      expect(serialized).toContain("0.42");
      expect(serialized).toContain("Some extra background");
      expect(serialized).toContain("What auth provider?");
      expect(serialized).toContain("required");
    });

    it("reports slack.ok:false with the error message when the webhook responds non-ok", async () => {
      fetchMock.mockResolvedValue({ ok: false, status: 500, text: async () => "server error" });
      const logger = makeLogger();
      const svc = new NotificationService(
        { slackWebhookUrl: "https://hooks.slack.com/x", emailFrom: "from@b.com" },
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

    it("reports slack.ok:false when fetch itself rejects (network error)", async () => {
      fetchMock.mockRejectedValue(new Error("network down"));
      const svc = new NotificationService(
        { slackWebhookUrl: "https://hooks.slack.com/x", emailFrom: "from@b.com" },
        makeLogger() as never,
      );

      const result = await svc.sendHumanRequest(makePayload());

      expect(result.slack.ok).toBe(false);
      expect(result.slack.error).toBe("network down");
    });

    it("posts to Resend and reports email.ok:true on success, splitting multiple recipients", async () => {
      const svc = new NotificationService(
        { emailTo: "a@b.com, c@d.com", emailFrom: "from@b.com", resendApiKey: "key-123" },
        makeLogger() as never,
      );

      const result = await svc.sendHumanRequest(makePayload());

      expect(result.email).toEqual({ attempted: true, ok: true });
      expect(fetchMock).toHaveBeenCalledWith(
        "https://api.resend.com/emails",
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({ Authorization: "Bearer key-123" }),
        }),
      );
      const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
      expect(body.to).toEqual(["a@b.com", "c@d.com"]);
      expect(body.subject).toContain("LIN-1");
      expect(body.html).toContain("Add login");
      expect(body.text).toContain("Add login");
    });

    it("reports email.ok:false with the error message when Resend responds non-ok", async () => {
      fetchMock.mockResolvedValue({ ok: false, status: 422, text: async () => "bad request" });
      const logger = makeLogger();
      const svc = new NotificationService(
        { emailTo: "a@b.com", emailFrom: "from@b.com", resendApiKey: "key-123" },
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

    it("sends both Slack and email concurrently when both are configured", async () => {
      const svc = new NotificationService(
        {
          slackWebhookUrl: "https://hooks.slack.com/x",
          emailTo: "a@b.com",
          emailFrom: "from@b.com",
          resendApiKey: "key-123",
        },
        makeLogger() as never,
      );

      const result = await svc.sendHumanRequest(makePayload());

      expect(result.slack).toEqual({ attempted: true, ok: true });
      expect(result.email).toEqual({ attempted: true, ok: true });
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it("escapes HTML-significant characters in the email body", async () => {
      const svc = new NotificationService(
        { emailTo: "a@b.com", emailFrom: "from@b.com", resendApiKey: "key-123" },
        makeLogger() as never,
      );

      await svc.sendHumanRequest(
        makePayload({ summary: `<script>alert("x")</script>` }),
      );

      const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
      expect(body.html).not.toContain("<script>");
      expect(body.html).toContain("&lt;script&gt;");
    });

    it("truncates a long context block in both Slack and email bodies", async () => {
      const svc = new NotificationService(
        {
          slackWebhookUrl: "https://hooks.slack.com/x",
          emailTo: "a@b.com",
          emailFrom: "from@b.com",
          resendApiKey: "key-123",
        },
        makeLogger() as never,
      );
      const longContext = "x".repeat(3000);

      await svc.sendHumanRequest(makePayload({ context: longContext }));

      const slackBody = JSON.parse(fetchMock.mock.calls[0][1].body as string);
      expect(JSON.stringify(slackBody).length).toBeLessThan(longContext.length + 2000);
      const emailBody = JSON.parse(fetchMock.mock.calls[1][1].body as string);
      expect(emailBody.text).toContain("…");
    });

    it("falls back to issue id and '(untitled)' when identifier/title are absent", async () => {
      const svc = new NotificationService(
        { slackWebhookUrl: "https://hooks.slack.com/x", emailFrom: "from@b.com" },
        makeLogger() as never,
      );

      await svc.sendHumanRequest(
        makePayload({ linearIssue: { id: "issue-raw-id", title: null, url: null } }),
      );

      const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
      expect(body.text).toContain("issue-raw-id");
      expect(body.text).toContain("(untitled)");
    });
  });
});
