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
    summary: "Summary text",
    linearIssue: { id: "issue-1", identifier: "PRY-1", title: "Issue title", url: "https://linear.app/x" },
    runState: "AwaitingPlanApproval",
    runUrl: "https://app.example.com/runs/run-1",
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
    it("is false when neither slack nor email is set up", () => {
      const svc = new NotificationService({ emailFrom: "a@b.com" }, makeLogger() as never);
      expect(svc.isConfigured()).toBe(false);
    });

    it("is true when slackWebhookUrl is set", () => {
      const svc = new NotificationService(
        { emailFrom: "a@b.com", slackWebhookUrl: "https://hooks.slack.com/x" },
        makeLogger() as never,
      );
      expect(svc.isConfigured()).toBe(true);
    });

    it("is true when both emailTo and resendApiKey are set", () => {
      const svc = new NotificationService(
        { emailFrom: "a@b.com", emailTo: "c@d.com", resendApiKey: "key" },
        makeLogger() as never,
      );
      expect(svc.isConfigured()).toBe(true);
    });

    it("is false when only emailTo is set without an API key", () => {
      const svc = new NotificationService(
        { emailFrom: "a@b.com", emailTo: "c@d.com" },
        makeLogger() as never,
      );
      expect(svc.isConfigured()).toBe(false);
    });
  });

  describe("sendHumanRequest", () => {
    function buildConfig(overrides: Partial<NotificationConfig> = {}): NotificationConfig {
      return { emailFrom: "bot@example.com", ...overrides };
    }

    it("attempts neither channel when nothing is configured", async () => {
      const svc = new NotificationService(buildConfig(), makeLogger() as never);
      const result = await svc.sendHumanRequest(makePayload());

      expect(result).toEqual({
        slack: { attempted: false, ok: false },
        email: { attempted: false, ok: false },
      });
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("sends a Slack notification and reports ok on success", async () => {
      fetchMock.mockResolvedValue({ ok: true });
      const svc = new NotificationService(
        buildConfig({ slackWebhookUrl: "https://hooks.slack.com/x" }),
        makeLogger() as never,
      );

      const result = await svc.sendHumanRequest(
        makePayload({
          planConfidence: 0.42,
          openQuestions: [
            { id: "q1", question: "What now?", requiredForExecution: true },
            { id: "q2", question: "And then?", requiredForExecution: false },
          ],
          context: "x".repeat(2000),
        }),
      );

      expect(result.slack).toEqual({ attempted: true, ok: true });
      expect(fetchMock).toHaveBeenCalledWith(
        "https://hooks.slack.com/x",
        expect.objectContaining({ method: "POST" }),
      );
      const body = JSON.parse(fetchMock.mock.calls[0][1].body as string) as { blocks: unknown[] };
      expect(body.blocks.length).toBeGreaterThan(0);
    });

    it("records a Slack failure when the webhook returns a non-ok response", async () => {
      fetchMock.mockResolvedValue({ ok: false, status: 500, text: () => Promise.resolve("oops") });
      const logger = makeLogger();
      const svc = new NotificationService(
        buildConfig({ slackWebhookUrl: "https://hooks.slack.com/x" }),
        logger as never,
      );

      const result = await svc.sendHumanRequest(makePayload());

      expect(result.slack.attempted).toBe(true);
      expect(result.slack.ok).toBe(false);
      expect(result.slack.error).toContain("500");
      expect(logger.warn).toHaveBeenCalled();
    });

    it("records a Slack failure when fetch itself throws", async () => {
      fetchMock.mockRejectedValue(new Error("network down"));
      const svc = new NotificationService(
        buildConfig({ slackWebhookUrl: "https://hooks.slack.com/x" }),
        makeLogger() as never,
      );

      const result = await svc.sendHumanRequest(makePayload());

      expect(result.slack.ok).toBe(false);
      expect(result.slack.error).toBe("network down");
    });

    it("sends an email notification and reports ok on success", async () => {
      fetchMock.mockResolvedValue({ ok: true });
      const svc = new NotificationService(
        buildConfig({ emailTo: "a@b.com, c@d.com", resendApiKey: "resend-key" }),
        makeLogger() as never,
      );

      const result = await svc.sendHumanRequest(
        makePayload({ context: "some context", planConfidence: 0.9 }),
      );

      expect(result.email).toEqual({ attempted: true, ok: true });
      expect(fetchMock).toHaveBeenCalledWith(
        "https://api.resend.com/emails",
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({ Authorization: "Bearer resend-key" }),
        }),
      );
      const body = JSON.parse(fetchMock.mock.calls[0][1].body as string) as { to: string[] };
      expect(body.to).toEqual(["a@b.com", "c@d.com"]);
    });

    it("records an email failure when Resend returns a non-ok response", async () => {
      fetchMock.mockResolvedValue({ ok: false, status: 422, text: () => Promise.resolve("bad") });
      const logger = makeLogger();
      const svc = new NotificationService(
        buildConfig({ emailTo: "a@b.com", resendApiKey: "resend-key" }),
        logger as never,
      );

      const result = await svc.sendHumanRequest(makePayload());

      expect(result.email.ok).toBe(false);
      expect(result.email.error).toContain("422");
      expect(logger.warn).toHaveBeenCalled();
    });

    it("sends both channels concurrently when both are configured", async () => {
      fetchMock.mockResolvedValue({ ok: true });
      const svc = new NotificationService(
        buildConfig({
          slackWebhookUrl: "https://hooks.slack.com/x",
          emailTo: "a@b.com",
          resendApiKey: "resend-key",
        }),
        makeLogger() as never,
      );

      const result = await svc.sendHumanRequest(makePayload());

      expect(result.slack.ok).toBe(true);
      expect(result.email.ok).toBe(true);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it("renders the correct subject/title label for every HumanRequestReason", async () => {
      fetchMock.mockResolvedValue({ ok: true });
      const svc = new NotificationService(
        buildConfig({ slackWebhookUrl: "https://hooks.slack.com/x" }),
        makeLogger() as never,
      );

      const expected: Record<string, string> = {
        plan_ambiguous: "Plan needs review (ambiguous)",
        plan_low_confidence: "Plan needs review (low confidence)",
        impl_rejected: "Implementation needs review (rejected by agent)",
        impl_uncertain: "Implementation needs review (uncertain)",
        other: "Human intervention requested",
      };

      for (const [reason, label] of Object.entries(expected)) {
        fetchMock.mockClear();
        await svc.sendHumanRequest(makePayload({ reason: reason as NotificationPayload["reason"] }));
        const body = JSON.parse(fetchMock.mock.calls[0][1].body as string) as { text: string };
        expect(body.text).toContain(label);
      }
    });

    it("includes the open questions list in the email HTML and plain-text bodies", async () => {
      fetchMock.mockResolvedValue({ ok: true });
      const svc = new NotificationService(
        buildConfig({ emailTo: "a@b.com", resendApiKey: "resend-key" }),
        makeLogger() as never,
      );

      await svc.sendHumanRequest(
        makePayload({
          openQuestions: [
            { id: "q1", question: "Required one?", requiredForExecution: true },
            { id: "q2", question: "Optional one?", requiredForExecution: false },
          ],
        }),
      );

      const body = JSON.parse(fetchMock.mock.calls[0][1].body as string) as {
        html: string;
        text: string;
      };
      expect(body.html).toContain("Open questions");
      expect(body.html).toContain("Required one?");
      expect(body.html).toContain("<strong>[required]</strong>");
      expect(body.text).toContain("Open questions:");
      expect(body.text).toContain("[required] Required one?");
      expect(body.text).toContain("Optional one?");
    });

    it("handles an untitled issue and missing linear URL gracefully", async () => {
      fetchMock.mockResolvedValue({ ok: true });
      const svc = new NotificationService(
        buildConfig({ slackWebhookUrl: "https://hooks.slack.com/x" }),
        makeLogger() as never,
      );

      const result = await svc.sendHumanRequest(
        makePayload({
          linearIssue: { id: "issue-1", title: null, url: null },
        }),
      );

      expect(result.slack.ok).toBe(true);
    });

    it("falls back to issue id, '(untitled)' and no Linear link in the email subject/html/text when identifier/title/url are absent", async () => {
      fetchMock.mockResolvedValue({ ok: true });
      const svc = new NotificationService(
        buildConfig({ emailTo: "a@b.com", resendApiKey: "resend-key" }),
        makeLogger() as never,
      );

      await svc.sendHumanRequest(
        makePayload({
          linearIssue: { id: "issue-raw-id", title: null, url: null },
        }),
      );

      const body = JSON.parse(fetchMock.mock.calls[0][1].body as string) as {
        subject: string;
        html: string;
        text: string;
      };
      expect(body.subject).toContain("issue-raw-id");
      expect(body.subject).toContain("(untitled)");
      expect(body.html).toContain("issue-raw-id");
      expect(body.html).toContain("(untitled)");
      expect(body.html).not.toContain("Open Linear issue");
      expect(body.text).toContain("issue-raw-id: (untitled)");
      expect(body.text).not.toContain("Linear:");
    });

    it("records a Slack failure with a stringified error when fetch rejects with a non-Error value", async () => {
      fetchMock.mockRejectedValue("DNS lookup failed");
      const svc = new NotificationService(
        buildConfig({ slackWebhookUrl: "https://hooks.slack.com/x" }),
        makeLogger() as never,
      );

      const result = await svc.sendHumanRequest(makePayload());

      expect(result.slack.ok).toBe(false);
      expect(result.slack.error).toBe("DNS lookup failed");
    });

    it("records an email failure with a stringified error when fetch rejects with a non-Error value", async () => {
      fetchMock.mockRejectedValue("connection reset");
      const svc = new NotificationService(
        buildConfig({ emailTo: "a@b.com", resendApiKey: "resend-key" }),
        makeLogger() as never,
      );

      const result = await svc.sendHumanRequest(makePayload());

      expect(result.email.ok).toBe(false);
      expect(result.email.error).toBe("connection reset");
    });
  });
});
