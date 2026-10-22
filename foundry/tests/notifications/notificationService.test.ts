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
    summary: "Needs a human look",
    linearIssue: { id: "issue-1", identifier: "ENG-1", title: "Add feature", url: "https://linear.app/x" },
    runState: "AwaitingPlanApproval",
    runUrl: "https://app.example.com/runs/run-1",
    ...overrides,
  };
}

describe("NotificationService", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe("isConfigured", () => {
    it("is true when a slack webhook is set", () => {
      const svc = new NotificationService(
        { emailFrom: "a@b.com", slackWebhookUrl: "https://hooks.slack.com/x" },
        makeLogger() as never,
      );
      expect(svc.isConfigured()).toBe(true);
    });

    it("is true when both emailTo and resendApiKey are set", () => {
      const svc = new NotificationService(
        { emailFrom: "a@b.com", emailTo: "team@b.com", resendApiKey: "key" },
        makeLogger() as never,
      );
      expect(svc.isConfigured()).toBe(true);
    });

    it("is false when neither slack nor a complete email config is set", () => {
      const svc = new NotificationService({ emailFrom: "a@b.com" }, makeLogger() as never);
      expect(svc.isConfigured()).toBe(false);
    });

    it("is false when emailTo is set but resendApiKey is missing", () => {
      const svc = new NotificationService(
        { emailFrom: "a@b.com", emailTo: "team@b.com" },
        makeLogger() as never,
      );
      expect(svc.isConfigured()).toBe(false);
    });
  });

  describe("sendHumanRequest", () => {
    function makeConfig(overrides: Partial<NotificationConfig> = {}): NotificationConfig {
      return { emailFrom: "bot@example.com", ...overrides };
    }

    it("attempts neither channel and returns both ok:false when unconfigured", async () => {
      const svc = new NotificationService(makeConfig(), makeLogger() as never);
      const result = await svc.sendHumanRequest(makePayload());
      expect(result).toEqual({
        slack: { attempted: false, ok: false },
        email: { attempted: false, ok: false },
      });
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("sends a slack webhook and marks it ok on a successful response", async () => {
      fetchMock.mockResolvedValue({ ok: true });
      const svc = new NotificationService(
        makeConfig({ slackWebhookUrl: "https://hooks.slack.com/x" }),
        makeLogger() as never,
      );

      const result = await svc.sendHumanRequest(makePayload());

      expect(result.slack).toEqual({ attempted: true, ok: true });
      expect(fetchMock).toHaveBeenCalledWith(
        "https://hooks.slack.com/x",
        expect.objectContaining({ method: "POST" }),
      );
      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(init.body as string) as { text: string };
      expect(body.text).toContain("ENG-1");
    });

    it("records a slack error without throwing when the webhook returns non-ok", async () => {
      fetchMock.mockResolvedValue({ ok: false, status: 500, text: () => Promise.resolve("oops") });
      const logger = makeLogger();
      const svc = new NotificationService(
        makeConfig({ slackWebhookUrl: "https://hooks.slack.com/x" }),
        logger as never,
      );

      const result = await svc.sendHumanRequest(makePayload());

      expect(result.slack.ok).toBe(false);
      expect(result.slack.error).toContain("500");
      expect(logger.warn).toHaveBeenCalled();
    });

    it("sends email via Resend when emailTo/resendApiKey configured, splitting multiple recipients", async () => {
      fetchMock.mockResolvedValue({ ok: true });
      const svc = new NotificationService(
        makeConfig({ emailTo: "a@b.com, c@d.com", resendApiKey: "resend-key" }),
        makeLogger() as never,
      );

      const result = await svc.sendHumanRequest(makePayload());

      expect(result.email).toEqual({ attempted: true, ok: true });
      expect(fetchMock).toHaveBeenCalledWith(
        "https://api.resend.com/emails",
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({ Authorization: "Bearer resend-key" }),
        }),
      );
      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(init.body as string) as { to: string[] };
      expect(body.to).toEqual(["a@b.com", "c@d.com"]);
    });

    it("records an email error without throwing when Resend returns non-ok", async () => {
      fetchMock.mockResolvedValue({ ok: false, status: 401, text: () => Promise.resolve("bad key") });
      const logger = makeLogger();
      const svc = new NotificationService(
        makeConfig({ emailTo: "a@b.com", resendApiKey: "bad-key" }),
        logger as never,
      );

      const result = await svc.sendHumanRequest(makePayload());

      expect(result.email.ok).toBe(false);
      expect(result.email.error).toContain("401");
      expect(logger.warn).toHaveBeenCalled();
    });

    it("sends both channels concurrently when both are configured", async () => {
      fetchMock.mockResolvedValue({ ok: true });
      const svc = new NotificationService(
        makeConfig({
          slackWebhookUrl: "https://hooks.slack.com/x",
          emailTo: "a@b.com",
          resendApiKey: "key",
        }),
        makeLogger() as never,
      );

      const result = await svc.sendHumanRequest(makePayload());

      expect(result.slack.attempted).toBe(true);
      expect(result.email.attempted).toBe(true);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it("includes plan confidence and open questions fields in the slack message when present", async () => {
      fetchMock.mockResolvedValue({ ok: true });
      const svc = new NotificationService(
        makeConfig({ slackWebhookUrl: "https://hooks.slack.com/x" }),
        makeLogger() as never,
      );

      await svc.sendHumanRequest(
        makePayload({
          planConfidence: 0.42,
          context: "Some long context ".repeat(200),
          openQuestions: [
            { id: "q1", question: "Should we do X?", requiredForExecution: true },
            { id: "q2", question: "Or Y?", requiredForExecution: false },
          ],
        }),
      );

      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(init.body as string) as { blocks: unknown[] };
      const serialized = JSON.stringify(body.blocks);
      expect(serialized).toContain("0.42");
      expect(serialized).toContain("required");
    });

    it("falls back to an unknown-reason label and (untitled) when linearIssue has no identifier/title", async () => {
      fetchMock.mockResolvedValue({ ok: true });
      const svc = new NotificationService(
        makeConfig({ slackWebhookUrl: "https://hooks.slack.com/x" }),
        makeLogger() as never,
      );

      await svc.sendHumanRequest(
        makePayload({
          reason: "other",
          linearIssue: { id: "issue-99", title: null, url: null },
        }),
      );

      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(init.body as string) as { text: string };
      expect(body.text).toContain("issue-99");
      expect(body.text).toContain("(untitled)");
      expect(body.text).toContain("Human intervention requested");
    });
  });
});
