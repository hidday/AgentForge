import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  NotificationService,
  type NotificationConfig,
  type NotificationPayload,
} from "../../src/notifications/notificationService.js";

function makePayload(overrides: Partial<NotificationPayload> = {}): NotificationPayload {
  return {
    runId: "run-1",
    reason: "plan_ambiguous",
    summary: "The plan has ambiguous requirements.",
    linearIssue: {
      id: "issue-1",
      identifier: "LIN-1",
      title: "Add feature X",
      url: "https://linear.app/team/issue/LIN-1",
    },
    runState: "HumanClarificationNeeded",
    runUrl: "https://dashboard.example.com/runs/run-1",
    ...overrides,
  };
}

function makeLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
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
    it("returns true when a slackWebhookUrl is set", () => {
      const svc = new NotificationService(
        { emailFrom: "noreply@example.com", slackWebhookUrl: "https://hooks.slack.com/x" },
        makeLogger(),
      );
      expect(svc.isConfigured()).toBe(true);
    });

    it("returns true when both emailTo and resendApiKey are set", () => {
      const svc = new NotificationService(
        { emailFrom: "noreply@example.com", emailTo: "a@b.com", resendApiKey: "key" },
        makeLogger(),
      );
      expect(svc.isConfigured()).toBe(true);
    });

    it("returns false when only emailTo is set (missing resendApiKey)", () => {
      const svc = new NotificationService(
        { emailFrom: "noreply@example.com", emailTo: "a@b.com" },
        makeLogger(),
      );
      expect(svc.isConfigured()).toBe(false);
    });

    it("returns false when nothing is configured", () => {
      const svc = new NotificationService({ emailFrom: "noreply@example.com" }, makeLogger());
      expect(svc.isConfigured()).toBe(false);
    });
  });

  describe("sendHumanRequest", () => {
    it("does nothing (no attempts) when no channel is configured", async () => {
      const svc = new NotificationService({ emailFrom: "noreply@example.com" }, makeLogger());

      const result = await svc.sendHumanRequest(makePayload());

      expect(result).toEqual({
        slack: { attempted: false, ok: false },
        email: { attempted: false, ok: false },
      });
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("sends a Slack notification and marks it ok on a successful response", async () => {
      fetchMock.mockResolvedValue({ ok: true });
      const config: NotificationConfig = {
        emailFrom: "noreply@example.com",
        slackWebhookUrl: "https://hooks.slack.com/x",
      };
      const svc = new NotificationService(config, makeLogger());

      const result = await svc.sendHumanRequest(
        makePayload({
          planConfidence: 0.42,
          context: "Some extra context",
          openQuestions: [
            { id: "q1", question: "What auth method?", requiredForExecution: true },
            { id: "q2", question: "Which region?", requiredForExecution: false },
          ],
        }),
      );

      expect(result.slack).toEqual({ attempted: true, ok: true });
      expect(fetchMock).toHaveBeenCalledWith(
        "https://hooks.slack.com/x",
        expect.objectContaining({ method: "POST" }),
      );
      const [, init] = fetchMock.mock.calls[0];
      const body = JSON.parse((init as { body: string }).body);
      expect(body.text).toContain("LIN-1");
      const sectionWithFields = body.blocks.find(
        (b: { fields?: unknown[] }) => Array.isArray(b.fields),
      );
      expect(sectionWithFields.fields.some((f: { text: string }) => f.text.includes("0.42"))).toBe(true);
      expect(sectionWithFields.fields.some((f: { text: string }) => f.text.includes("2 (1 required)"))).toBe(true);
    });

    it("records a slack failure and logs a warning when the webhook returns a non-ok response", async () => {
      fetchMock.mockResolvedValue({ ok: false, status: 500, text: () => Promise.resolve("server error") });
      const logger = makeLogger();
      const config: NotificationConfig = {
        emailFrom: "noreply@example.com",
        slackWebhookUrl: "https://hooks.slack.com/x",
      };
      const svc = new NotificationService(config, logger);

      const result = await svc.sendHumanRequest(makePayload());

      expect(result.slack.attempted).toBe(true);
      expect(result.slack.ok).toBe(false);
      expect(result.slack.error).toContain("500");
      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ runId: "run-1" }),
        "Slack notification failed",
      );
    });

    it("handles a slack response whose text() itself rejects (falls back to empty body)", async () => {
      fetchMock.mockResolvedValue({ ok: false, status: 503, text: () => Promise.reject(new Error("stream closed")) });
      const svc = new NotificationService(
        { emailFrom: "noreply@example.com", slackWebhookUrl: "https://hooks.slack.com/x" },
        makeLogger(),
      );

      const result = await svc.sendHumanRequest(makePayload());

      expect(result.slack.ok).toBe(false);
      expect(result.slack.error).toContain("503");
    });

    it("records a slack failure when fetch itself rejects (network error)", async () => {
      fetchMock.mockRejectedValue(new Error("network down"));
      const svc = new NotificationService(
        { emailFrom: "noreply@example.com", slackWebhookUrl: "https://hooks.slack.com/x" },
        makeLogger(),
      );

      const result = await svc.sendHumanRequest(makePayload());

      expect(result.slack.ok).toBe(false);
      expect(result.slack.error).toBe("network down");
    });

    it("records a slack failure with a stringified error when a non-Error is thrown", async () => {
      fetchMock.mockRejectedValue("weird failure");
      const svc = new NotificationService(
        { emailFrom: "noreply@example.com", slackWebhookUrl: "https://hooks.slack.com/x" },
        makeLogger(),
      );

      const result = await svc.sendHumanRequest(makePayload());

      expect(result.slack.error).toBe("weird failure");
    });

    it("sends an email via Resend and marks it ok on a successful response", async () => {
      fetchMock.mockResolvedValue({ ok: true });
      const config: NotificationConfig = {
        emailFrom: "noreply@example.com",
        emailTo: "a@b.com, c@d.com",
        resendApiKey: "resend-key",
      };
      const svc = new NotificationService(config, makeLogger());

      const result = await svc.sendHumanRequest(
        makePayload({
          context: "some context",
          planConfidence: 0.75,
          openQuestions: [{ id: "q1", question: "Which env?", requiredForExecution: true }],
          linearIssue: { id: "issue-1", title: null, url: null },
        }),
      );

      expect(result.email).toEqual({ attempted: true, ok: true });
      expect(fetchMock).toHaveBeenCalledWith(
        "https://api.resend.com/emails",
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({ Authorization: "Bearer resend-key" }),
        }),
      );
      const [, init] = fetchMock.mock.calls[0];
      const body = JSON.parse((init as { body: string }).body);
      expect(body.to).toEqual(["a@b.com", "c@d.com"]);
      expect(body.html).toContain("(untitled)");
      expect(body.text).toContain("(untitled)");
    });

    it("records an email failure and logs a warning on a non-ok Resend response", async () => {
      fetchMock.mockResolvedValue({ ok: false, status: 422, text: () => Promise.resolve("bad request") });
      const logger = makeLogger();
      const config: NotificationConfig = {
        emailFrom: "noreply@example.com",
        emailTo: "a@b.com",
        resendApiKey: "resend-key",
      };
      const svc = new NotificationService(config, logger);

      const result = await svc.sendHumanRequest(makePayload());

      expect(result.email.attempted).toBe(true);
      expect(result.email.ok).toBe(false);
      expect(result.email.error).toContain("422");
      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ runId: "run-1" }),
        "Email notification failed",
      );
    });

    it("truncates a long context with an ellipsis in both the Slack and email bodies", async () => {
      fetchMock.mockResolvedValue({ ok: true });
      const config: NotificationConfig = {
        emailFrom: "noreply@example.com",
        slackWebhookUrl: "https://hooks.slack.com/x",
        emailTo: "a@b.com",
        resendApiKey: "resend-key",
      };
      const svc = new NotificationService(config, makeLogger());
      const longContext = "x".repeat(3000);

      await svc.sendHumanRequest(makePayload({ context: longContext }));

      const [slackCall, emailCall] = fetchMock.mock.calls;
      const slackBody = JSON.parse((slackCall[1] as { body: string }).body);
      const slackContextBlock = slackBody.blocks.find((b: { text?: { text: string } }) =>
        b.text?.text?.includes("*Context:*"),
      );
      expect(slackContextBlock.text.text).toContain("…");
      // Slack truncates to 1500 chars (plus the ellipsis char).
      expect(slackContextBlock.text.text.length).toBeLessThan(longContext.length);

      const emailBody = JSON.parse((emailCall[1] as { body: string }).body);
      expect(emailBody.html).toContain("…");
      expect(emailBody.text).toContain("…");
    });

    it("sends both Slack and email concurrently when both are configured", async () => {
      fetchMock.mockResolvedValue({ ok: true });
      const config: NotificationConfig = {
        emailFrom: "noreply@example.com",
        slackWebhookUrl: "https://hooks.slack.com/x",
        emailTo: "a@b.com",
        resendApiKey: "resend-key",
      };
      const svc = new NotificationService(config, makeLogger());

      const result = await svc.sendHumanRequest(makePayload());

      expect(result.slack).toEqual({ attempted: true, ok: true });
      expect(result.email).toEqual({ attempted: true, ok: true });
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });
  });

  describe("reason label coverage via Slack title / email subject", () => {
    it.each([
      ["plan_ambiguous", "Plan needs review (ambiguous)"],
      ["plan_low_confidence", "Plan needs review (low confidence)"],
      ["impl_rejected", "Implementation needs review (rejected by agent)"],
      ["impl_uncertain", "Implementation needs review (uncertain)"],
      ["other", "Human intervention requested"],
    ] as const)("reason '%s' maps to label '%s'", async (reason, label) => {
      fetchMock.mockResolvedValue({ ok: true });
      const svc = new NotificationService(
        { emailFrom: "noreply@example.com", slackWebhookUrl: "https://hooks.slack.com/x" },
        makeLogger(),
      );

      await svc.sendHumanRequest(makePayload({ reason }));

      const [, init] = fetchMock.mock.calls[0];
      const body = JSON.parse((init as { body: string }).body);
      expect(body.text).toContain(label);
    });
  });
});
