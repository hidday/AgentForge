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
    summary: "Needs human input",
    runState: "AwaitingPlanApproval",
    runUrl: "https://app.example.com/runs/run-1",
    linearIssue: { id: "issue-1", identifier: "ENG-1", title: "Add login", url: "https://linear.app/x" },
    ...overrides,
  };
}

describe("NotificationService", () => {
  const originalFetch = global.fetch;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  describe("isConfigured", () => {
    it("is true when a Slack webhook URL is set", () => {
      const svc = new NotificationService(
        { slackWebhookUrl: "https://hooks.slack.com/x", emailFrom: "a@b.com" },
        makeLogger() as never,
      );
      expect(svc.isConfigured()).toBe(true);
    });

    it("is true when both emailTo and resendApiKey are set", () => {
      const svc = new NotificationService(
        { emailFrom: "a@b.com", emailTo: "x@y.com", resendApiKey: "key" },
        makeLogger() as never,
      );
      expect(svc.isConfigured()).toBe(true);
    });

    it("is false when only emailTo is set without an API key", () => {
      const svc = new NotificationService(
        { emailFrom: "a@b.com", emailTo: "x@y.com" },
        makeLogger() as never,
      );
      expect(svc.isConfigured()).toBe(false);
    });

    it("is false when nothing is configured", () => {
      const svc = new NotificationService({ emailFrom: "a@b.com" }, makeLogger() as never);
      expect(svc.isConfigured()).toBe(false);
    });
  });

  describe("sendHumanRequest", () => {
    function configFor(overrides: Partial<NotificationConfig> = {}): NotificationConfig {
      return { emailFrom: "bot@example.com", ...overrides };
    }

    it("attempts nothing and resolves both as not-attempted when unconfigured", async () => {
      const svc = new NotificationService(configFor(), makeLogger() as never);
      const result = await svc.sendHumanRequest(makePayload());
      expect(result).toEqual({
        slack: { attempted: false, ok: false },
        email: { attempted: false, ok: false },
      });
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("posts to the Slack webhook and reports ok:true on success", async () => {
      fetchMock.mockResolvedValue({ ok: true });
      const svc = new NotificationService(
        configFor({ slackWebhookUrl: "https://hooks.slack.com/x" }),
        makeLogger() as never,
      );
      const result = await svc.sendHumanRequest(makePayload());
      expect(result.slack).toEqual({ attempted: true, ok: true });
      expect(fetchMock).toHaveBeenCalledWith(
        "https://hooks.slack.com/x",
        expect.objectContaining({ method: "POST" }),
      );
      const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
      expect(body.text).toContain("ENG-1");
    });

    it("includes plan confidence and open questions fields in the Slack message when present", async () => {
      fetchMock.mockResolvedValue({ ok: true });
      const svc = new NotificationService(
        configFor({ slackWebhookUrl: "https://hooks.slack.com/x" }),
        makeLogger() as never,
      );
      await svc.sendHumanRequest(
        makePayload({
          planConfidence: 0.42,
          context: "Some long context ".repeat(200),
          openQuestions: [
            { id: "q1", question: "Which auth provider?", requiredForExecution: true },
            { id: "q2", question: "Optional detail?", requiredForExecution: false },
          ],
        }),
      );
      const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
      const serialized = JSON.stringify(body);
      expect(serialized).toContain("0.42");
      expect(serialized).toContain("Which auth provider?");
      expect(serialized).toContain("[required]");
    });

    it("reports ok:false with an error message when the Slack webhook responds non-ok", async () => {
      fetchMock.mockResolvedValue({ ok: false, status: 500, text: () => Promise.resolve("oops") });
      const svc = new NotificationService(
        configFor({ slackWebhookUrl: "https://hooks.slack.com/x" }),
        makeLogger() as never,
      );
      const result = await svc.sendHumanRequest(makePayload());
      expect(result.slack.attempted).toBe(true);
      expect(result.slack.ok).toBe(false);
      expect(result.slack.error).toContain("500");
    });

    it("sends an email via Resend and reports ok:true on success", async () => {
      fetchMock.mockResolvedValue({ ok: true });
      const svc = new NotificationService(
        configFor({ emailTo: "a@b.com, c@d.com", resendApiKey: "resend-key" }),
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
      const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
      expect(body.to).toEqual(["a@b.com", "c@d.com"]);
      expect(body.html).toContain("Add login");
      expect(body.text).toContain("Add login");
    });

    it("reports ok:false with an error message when Resend responds non-ok", async () => {
      fetchMock.mockResolvedValue({ ok: false, status: 422, text: () => Promise.resolve("bad") });
      const svc = new NotificationService(
        configFor({ emailTo: "a@b.com", resendApiKey: "resend-key" }),
        makeLogger() as never,
      );
      const result = await svc.sendHumanRequest(makePayload());
      expect(result.email.ok).toBe(false);
      expect(result.email.error).toContain("422");
    });

    it("attempts both channels concurrently when both are configured", async () => {
      fetchMock.mockResolvedValue({ ok: true });
      const svc = new NotificationService(
        configFor({
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

    it("renders email and Slack bodies correctly when the linear issue title/url are null/absent", async () => {
      fetchMock.mockResolvedValue({ ok: true });
      const svc = new NotificationService(
        configFor({ slackWebhookUrl: "https://hooks.slack.com/x" }),
        makeLogger() as never,
      );
      const result = await svc.sendHumanRequest(
        makePayload({
          linearIssue: { id: "issue-9", title: null, url: null },
        }),
      );
      expect(result.slack.ok).toBe(true);
      const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
      expect(JSON.stringify(body)).toContain("(untitled)");
    });

    it("escapes HTML-significant characters in the rendered email body", async () => {
      fetchMock.mockResolvedValue({ ok: true });
      const svc = new NotificationService(
        configFor({ emailTo: "a@b.com", resendApiKey: "resend-key" }),
        makeLogger() as never,
      );
      await svc.sendHumanRequest(
        makePayload({ summary: "<script>alert(1)</script> & \"quoted\" 'text'" }),
      );
      const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
      expect(body.html).not.toContain("<script>alert(1)</script>");
      expect(body.html).toContain("&lt;script&gt;");
    });

    it("maps each HumanRequestReason to a distinct human-readable label", async () => {
      fetchMock.mockResolvedValue({ ok: true });
      const svc = new NotificationService(
        configFor({ slackWebhookUrl: "https://hooks.slack.com/x" }),
        makeLogger() as never,
      );
      const reasons = [
        "plan_ambiguous",
        "plan_low_confidence",
        "impl_rejected",
        "impl_uncertain",
        "other",
      ] as const;
      const labels = new Set<string>();
      for (const reason of reasons) {
        await svc.sendHumanRequest(makePayload({ reason }));
        const body = JSON.parse(
          (fetchMock.mock.calls[fetchMock.mock.calls.length - 1][1] as RequestInit).body as string,
        );
        labels.add(body.text as string);
      }
      expect(labels.size).toBe(reasons.length);
    });
  });
});
