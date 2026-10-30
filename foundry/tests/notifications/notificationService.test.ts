import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  NotificationService,
  type NotificationConfig,
  type NotificationPayload,
} from "../../src/notifications/notificationService.js";

function makeLogger() {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

function makeConfig(overrides: Partial<NotificationConfig> = {}): NotificationConfig {
  return {
    emailFrom: "bot@example.com",
    ...overrides,
  };
}

function makePayload(overrides: Partial<NotificationPayload> = {}): NotificationPayload {
  return {
    runId: "run-1",
    reason: "plan_ambiguous",
    summary: "The plan needs a human look",
    linearIssue: { id: "issue-1", title: "Fix the bug", url: "https://linear.app/issue-1" },
    runState: "AwaitingPlanApproval",
    runUrl: "https://app.example.com/runs/run-1",
    ...overrides,
  };
}

function mockFetchOk() {
  return vi.fn().mockResolvedValue({ ok: true, status: 200, text: vi.fn() });
}

function mockFetchFail(status: number, bodyText = "server error") {
  return vi.fn().mockResolvedValue({
    ok: false,
    status,
    text: vi.fn().mockResolvedValue(bodyText),
  });
}

describe("NotificationService", () => {
  let logger: ReturnType<typeof makeLogger>;

  beforeEach(() => {
    logger = makeLogger();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe("isConfigured", () => {
    it("is false when nothing is configured", () => {
      const svc = new NotificationService(makeConfig(), logger as never);
      expect(svc.isConfigured()).toBe(false);
    });

    it("is true when a slack webhook is configured", () => {
      const svc = new NotificationService(
        makeConfig({ slackWebhookUrl: "https://hooks.slack.com/x" }),
        logger as never,
      );
      expect(svc.isConfigured()).toBe(true);
    });

    it("is true when both emailTo and resendApiKey are configured", () => {
      const svc = new NotificationService(
        makeConfig({ emailTo: "a@b.com", resendApiKey: "key" }),
        logger as never,
      );
      expect(svc.isConfigured()).toBe(true);
    });

    it("is false when only emailTo is set without a resend key", () => {
      const svc = new NotificationService(makeConfig({ emailTo: "a@b.com" }), logger as never);
      expect(svc.isConfigured()).toBe(false);
    });
  });

  describe("sendHumanRequest", () => {
    it("attempts neither channel when nothing is configured", async () => {
      const svc = new NotificationService(makeConfig(), logger as never);
      const result = await svc.sendHumanRequest(makePayload());
      expect(result).toEqual({
        slack: { attempted: false, ok: false },
        email: { attempted: false, ok: false },
      });
    });

    it("sends a Slack notification and reports ok on success", async () => {
      const fetchMock = mockFetchOk();
      vi.stubGlobal("fetch", fetchMock);
      const svc = new NotificationService(
        makeConfig({ slackWebhookUrl: "https://hooks.slack.com/x" }),
        logger as never,
      );

      const result = await svc.sendHumanRequest(makePayload());

      expect(result.slack).toEqual({ attempted: true, ok: true });
      expect(result.email).toEqual({ attempted: false, ok: false });
      expect(fetchMock).toHaveBeenCalledWith(
        "https://hooks.slack.com/x",
        expect.objectContaining({ method: "POST" }),
      );
      const body = JSON.parse(fetchMock.mock.calls[0]![1].body as string);
      expect(body.text).toContain("issue-1");
    });

    it("records a Slack failure and logs a warning when the webhook returns a non-ok response", async () => {
      vi.stubGlobal("fetch", mockFetchFail(500, "boom"));
      const svc = new NotificationService(
        makeConfig({ slackWebhookUrl: "https://hooks.slack.com/x" }),
        logger as never,
      );

      const result = await svc.sendHumanRequest(makePayload());

      expect(result.slack.attempted).toBe(true);
      expect(result.slack.ok).toBe(false);
      expect(result.slack.error).toContain("500");
      expect(logger.warn).toHaveBeenCalled();
    });

    it("sends an email and reports ok on success, splitting multiple recipients", async () => {
      const fetchMock = mockFetchOk();
      vi.stubGlobal("fetch", fetchMock);
      const svc = new NotificationService(
        makeConfig({ emailTo: "a@b.com, c@d.com", resendApiKey: "key" }),
        logger as never,
      );

      const result = await svc.sendHumanRequest(makePayload());

      expect(result.email).toEqual({ attempted: true, ok: true });
      expect(fetchMock).toHaveBeenCalledWith(
        "https://api.resend.com/emails",
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({ Authorization: "Bearer key" }),
        }),
      );
      const body = JSON.parse(fetchMock.mock.calls[0]![1].body as string);
      expect(body.to).toEqual(["a@b.com", "c@d.com"]);
    });

    it("records an email failure and logs a warning on a non-ok response", async () => {
      vi.stubGlobal("fetch", mockFetchFail(401, "unauthorized"));
      const svc = new NotificationService(
        makeConfig({ emailTo: "a@b.com", resendApiKey: "key" }),
        logger as never,
      );

      const result = await svc.sendHumanRequest(makePayload());

      expect(result.email.ok).toBe(false);
      expect(result.email.error).toContain("401");
      expect(logger.warn).toHaveBeenCalled();
    });

    it("sends both channels concurrently when both are configured", async () => {
      vi.stubGlobal("fetch", mockFetchOk());
      const svc = new NotificationService(
        makeConfig({
          slackWebhookUrl: "https://hooks.slack.com/x",
          emailTo: "a@b.com",
          resendApiKey: "key",
        }),
        logger as never,
      );

      const result = await svc.sendHumanRequest(makePayload());

      expect(result.slack.ok).toBe(true);
      expect(result.email.ok).toBe(true);
    });

    it("surfaces a non-Error fetch rejection message via String(err)", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockRejectedValue("network down"),
      );
      const svc = new NotificationService(
        makeConfig({ slackWebhookUrl: "https://hooks.slack.com/x" }),
        logger as never,
      );

      const result = await svc.sendHumanRequest(makePayload());

      expect(result.slack.error).toBe("network down");
    });

    it("surfaces a non-Error email rejection message via String(err)", async () => {
      vi.stubGlobal("fetch", vi.fn().mockRejectedValue("smtp down"));
      const svc = new NotificationService(
        makeConfig({ emailTo: "a@b.com", resendApiKey: "key" }),
        logger as never,
      );

      const result = await svc.sendHumanRequest(makePayload());

      expect(result.email.error).toBe("smtp down");
    });

    it("renders the identifier, confidence, context, and open questions into the Slack message", async () => {
      const fetchMock = mockFetchOk();
      vi.stubGlobal("fetch", fetchMock);
      const svc = new NotificationService(
        makeConfig({ slackWebhookUrl: "https://hooks.slack.com/x" }),
        logger as never,
      );

      await svc.sendHumanRequest(
        makePayload({
          linearIssue: { id: "issue-1", identifier: "ENG-42", title: null, url: null },
          planConfidence: 0.42,
          context: "x".repeat(2000),
          openQuestions: [
            { id: "q1", question: "What env?", requiredForExecution: true },
            { id: "q2", question: "Which flag?", requiredForExecution: false },
          ],
        }),
      );

      const body = JSON.parse(fetchMock.mock.calls[0]![1].body as string);
      expect(body.text).toContain("ENG-42");
      expect(body.text).toContain("(untitled)");
      const blocksJson = JSON.stringify(body.blocks);
      expect(blocksJson).toContain("0.42");
      expect(blocksJson).toContain("2 (1 required)");
      expect(blocksJson).toContain("…"); // truncated context
      // No "Open Linear issue" button when linearIssue.url is absent.
      expect(blocksJson).not.toContain("Open Linear issue");
    });

    it("includes the open-Linear-issue button when a URL is present and omits optional fields otherwise", async () => {
      const fetchMock = mockFetchOk();
      vi.stubGlobal("fetch", fetchMock);
      const svc = new NotificationService(
        makeConfig({ slackWebhookUrl: "https://hooks.slack.com/x" }),
        logger as never,
      );

      await svc.sendHumanRequest(makePayload());

      const body = JSON.parse(fetchMock.mock.calls[0]![1].body as string);
      const blocksJson = JSON.stringify(body.blocks);
      expect(blocksJson).toContain("Open Linear issue");
    });

    it("renders every reason label and both HTML/text email bodies with optional fields", async () => {
      const fetchMock = mockFetchOk();
      vi.stubGlobal("fetch", fetchMock);

      const reasons: NotificationPayload["reason"][] = [
        "plan_ambiguous",
        "plan_low_confidence",
        "impl_rejected",
        "impl_uncertain",
        "other",
      ];

      for (const reason of reasons) {
        fetchMock.mockClear();
        const svc = new NotificationService(
          makeConfig({ emailTo: "a@b.com", resendApiKey: "key" }),
          logger as never,
        );
        await svc.sendHumanRequest(
          makePayload({
            reason,
            linearIssue: { id: "issue-1", identifier: "ENG-1", title: "<script>XSS</script>", url: "https://x" },
            planConfidence: 0.75,
            context: "some <b>context</b>",
            openQuestions: [
              { id: "q1", question: "Q & A?", requiredForExecution: true },
              { id: "q2", question: "Optional one?", requiredForExecution: false },
            ],
          }),
        );
        const body = JSON.parse(fetchMock.mock.calls[0]![1].body as string);
        expect(body.html).toContain("&lt;script&gt;");
        expect(body.text).toContain("Q & A?");
        expect(body.text).toContain("[required] Q & A?");
        expect(body.text).toContain("Optional one?");
        expect(body.text).not.toContain("[required] Optional one?");
        expect(body.html).toContain("<strong>[required]</strong> Q &amp; A?");
        expect(body.html).toContain(">Optional one?<");
      }
    });

    it("omits the untitled/url/context/questions branches in the email body when absent", async () => {
      const fetchMock = mockFetchOk();
      vi.stubGlobal("fetch", fetchMock);
      const svc = new NotificationService(
        makeConfig({ emailTo: "a@b.com", resendApiKey: "key" }),
        logger as never,
      );

      await svc.sendHumanRequest(
        makePayload({
          linearIssue: { id: "issue-1", title: null, url: null },
        }),
      );

      const body = JSON.parse(fetchMock.mock.calls[0]![1].body as string);
      expect(body.html).toContain("(untitled)");
      expect(body.text).not.toContain("Linear:");
    });
  });
});
