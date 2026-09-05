import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  NotificationService,
  type NotificationConfig,
  type NotificationPayload,
} from "../../src/notifications/notificationService.js";

function makeMockLogger() {
  return { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() };
}

function makePayload(overrides: Partial<NotificationPayload> = {}): NotificationPayload {
  return {
    runId: "run-1",
    reason: "plan_ambiguous",
    summary: "The plan is unclear on which auth provider to use.",
    linearIssue: {
      id: "issue-1",
      identifier: "ENG-42",
      title: "Add OAuth support",
      url: "https://linear.app/team/issue/ENG-42",
    },
    runState: "AwaitingPlanApproval",
    runUrl: "https://app.example.com/runs/run-1",
    ...overrides,
  };
}

function jsonResponse(ok: boolean, status = 200, textBody = ""): Response {
  return {
    ok,
    status,
    text: vi.fn().mockResolvedValue(textBody),
  } as unknown as Response;
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
    it("returns false when nothing is configured", () => {
      const svc = new NotificationService({ emailFrom: "a@b.com" }, makeMockLogger() as never);
      expect(svc.isConfigured()).toBe(false);
    });

    it("returns true when slackWebhookUrl is set", () => {
      const svc = new NotificationService(
        { emailFrom: "a@b.com", slackWebhookUrl: "https://hooks.slack.com/x" },
        makeMockLogger() as never,
      );
      expect(svc.isConfigured()).toBe(true);
    });

    it("returns true when emailTo and resendApiKey are both set", () => {
      const svc = new NotificationService(
        { emailFrom: "a@b.com", emailTo: "x@y.com", resendApiKey: "key" },
        makeMockLogger() as never,
      );
      expect(svc.isConfigured()).toBe(true);
    });

    it("returns false when only emailTo is set without resendApiKey", () => {
      const svc = new NotificationService(
        { emailFrom: "a@b.com", emailTo: "x@y.com" },
        makeMockLogger() as never,
      );
      expect(svc.isConfigured()).toBe(false);
    });

    it("returns false when only resendApiKey is set without emailTo", () => {
      const svc = new NotificationService(
        { emailFrom: "a@b.com", resendApiKey: "key" },
        makeMockLogger() as never,
      );
      expect(svc.isConfigured()).toBe(false);
    });
  });

  describe("sendHumanRequest", () => {
    it("attempts neither channel and calls fetch zero times when nothing configured", async () => {
      const svc = new NotificationService({ emailFrom: "a@b.com" }, makeMockLogger() as never);
      const result = await svc.sendHumanRequest(makePayload());
      expect(result).toEqual({
        slack: { attempted: false, ok: false },
        email: { attempted: false, ok: false },
      });
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("sends a slack webhook successfully", async () => {
      fetchMock.mockResolvedValue(jsonResponse(true));
      const svc = new NotificationService(
        { emailFrom: "a@b.com", slackWebhookUrl: "https://hooks.slack.com/x" },
        makeMockLogger() as never,
      );
      const result = await svc.sendHumanRequest(makePayload());

      expect(result.slack).toEqual({ attempted: true, ok: true });
      expect(result.email).toEqual({ attempted: false, ok: false });
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe("https://hooks.slack.com/x");
      expect(init.method).toBe("POST");
      const body = JSON.parse(init.body);
      expect(body.text).toContain("ENG-42");
      expect(body.text).toContain("Add OAuth support");
      expect(body.text).toContain("Plan needs review (ambiguous)");
    });

    it("records a slack failure when the webhook responds not-ok", async () => {
      fetchMock.mockResolvedValue(jsonResponse(false, 500, "server exploded"));
      const logger = makeMockLogger();
      const svc = new NotificationService(
        { emailFrom: "a@b.com", slackWebhookUrl: "https://hooks.slack.com/x" },
        logger as never,
      );
      const result = await svc.sendHumanRequest(makePayload());

      expect(result.slack.attempted).toBe(true);
      expect(result.slack.ok).toBe(false);
      expect(result.slack.error).toContain("500");
      expect(result.slack.error).toContain("server exploded");
      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ runId: "run-1" }),
        "Slack notification failed",
      );
    });

    it("handles a slack response whose text() also rejects", async () => {
      const resp = {
        ok: false,
        status: 502,
        text: vi.fn().mockRejectedValue(new Error("boom")),
      } as unknown as Response;
      fetchMock.mockResolvedValue(resp);
      const svc = new NotificationService(
        { emailFrom: "a@b.com", slackWebhookUrl: "https://hooks.slack.com/x" },
        makeMockLogger() as never,
      );
      const result = await svc.sendHumanRequest(makePayload());
      expect(result.slack.ok).toBe(false);
      expect(result.slack.error).toContain("502");
    });

    it("records a slack failure when fetch throws a non-Error value", async () => {
      fetchMock.mockRejectedValue("network down");
      const svc = new NotificationService(
        { emailFrom: "a@b.com", slackWebhookUrl: "https://hooks.slack.com/x" },
        makeMockLogger() as never,
      );
      const result = await svc.sendHumanRequest(makePayload());
      expect(result.slack.ok).toBe(false);
      expect(result.slack.error).toBe("network down");
    });

    it("sends an email successfully with recipients parsed and trimmed", async () => {
      fetchMock.mockResolvedValue(jsonResponse(true));
      const svc = new NotificationService(
        { emailFrom: "from@x.com", emailTo: " a@x.com , b@x.com ,,", resendApiKey: "key" },
        makeMockLogger() as never,
      );
      const result = await svc.sendHumanRequest(makePayload());

      expect(result.email).toEqual({ attempted: true, ok: true });
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe("https://api.resend.com/emails");
      expect(init.headers.Authorization).toBe("Bearer key");
      const body = JSON.parse(init.body);
      expect(body.to).toEqual(["a@x.com", "b@x.com"]);
      expect(body.from).toBe("from@x.com");
      expect(body.subject).toContain("ENG-42");
      expect(body.html).toContain("Add OAuth support");
      expect(body.text).toContain("Add OAuth support");
    });

    it("records an email failure when resend responds not-ok", async () => {
      fetchMock.mockResolvedValue(jsonResponse(false, 422, "invalid recipient"));
      const logger = makeMockLogger();
      const svc = new NotificationService(
        { emailFrom: "from@x.com", emailTo: "a@x.com", resendApiKey: "key" },
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

    it("records an email failure when fetch throws a non-Error value", async () => {
      fetchMock.mockRejectedValue(42);
      const svc = new NotificationService(
        { emailFrom: "from@x.com", emailTo: "a@x.com", resendApiKey: "key" },
        makeMockLogger() as never,
      );
      const result = await svc.sendHumanRequest(makePayload());
      expect(result.email.ok).toBe(false);
      expect(result.email.error).toBe("42");
    });

    it("sends both slack and email concurrently when both are configured", async () => {
      fetchMock.mockResolvedValue(jsonResponse(true));
      const svc = new NotificationService(
        {
          emailFrom: "from@x.com",
          emailTo: "a@x.com",
          resendApiKey: "key",
          slackWebhookUrl: "https://hooks.slack.com/x",
        },
        makeMockLogger() as never,
      );
      const result = await svc.sendHumanRequest(makePayload());
      expect(result.slack.ok).toBe(true);
      expect(result.email.ok).toBe(true);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it("includes plan confidence, open questions (capped), context, and required markers", async () => {
      fetchMock.mockResolvedValue(jsonResponse(true));
      const svc = new NotificationService(
        {
          emailFrom: "from@x.com",
          emailTo: "a@x.com",
          resendApiKey: "key",
          slackWebhookUrl: "https://hooks.slack.com/x",
        },
        makeMockLogger() as never,
      );
      const longContext = "x".repeat(3000);
      const payload = makePayload({
        planConfidence: 0.5,
        context: longContext,
        openQuestions: [
          { id: "q1", question: "Which provider?", requiredForExecution: true },
          { id: "q2", question: "Which region?", requiredForExecution: false },
          { id: "q3", question: "Which env?", requiredForExecution: false },
          { id: "q4", question: "Extra one that should be truncated from slack view", requiredForExecution: false },
        ],
      });
      await svc.sendHumanRequest(payload);

      expect(fetchMock).toHaveBeenCalledTimes(2);
      const slackCall = fetchMock.mock.calls.find(([url]) => url === "https://hooks.slack.com/x")!;
      const slackBody = JSON.parse(slackCall[1].body);
      const serialized = JSON.stringify(slackBody);
      expect(serialized).toContain("0.50");
      expect(serialized).toContain("4 (1 required)");
      expect(serialized).toContain("[required]");
      // only first 3 questions included in the detail block
      expect(serialized).not.toContain("Extra one that should be truncated");
      expect(serialized).toContain("…");

      const emailCall = fetchMock.mock.calls.find(([url]) => url === "https://api.resend.com/emails")!;
      const emailBody = JSON.parse(emailCall[1].body);
      expect(emailBody.html).toContain("0.50");
      expect(emailBody.html).toContain("Which provider?");
      expect(emailBody.text).toContain("Plan confidence: 0.50");
      expect(emailBody.text).toContain("[required] Which provider?");
    });

    it("omits optional slack sections and uses defaults for minimal payloads", async () => {
      fetchMock.mockResolvedValue(jsonResponse(true));
      const svc = new NotificationService(
        { emailFrom: "from@x.com", slackWebhookUrl: "https://hooks.slack.com/x" },
        makeMockLogger() as never,
      );
      const payload = makePayload({
        linearIssue: { id: "issue-2", title: null, url: null },
        openQuestions: [],
      });
      await svc.sendHumanRequest(payload);

      const [, init] = fetchMock.mock.calls[0];
      const body = JSON.parse(init.body);
      const serialized = JSON.stringify(body);
      expect(serialized).toContain("(untitled)");
      expect(serialized).toContain("issue-2");
      // no "Open Linear issue" button when url is absent
      expect(serialized).not.toContain("Open Linear issue");
    });

    it("escapes HTML special characters in the email body", async () => {
      fetchMock.mockResolvedValue(jsonResponse(true));
      const svc = new NotificationService(
        { emailFrom: "from@x.com", emailTo: "a@x.com", resendApiKey: "key" },
        makeMockLogger() as never,
      );
      const payload = makePayload({
        summary: `<script>alert("x")</script> & 'quotes'`,
        linearIssue: { id: "issue-3", title: "<b>bold</b>", url: null },
      });
      await svc.sendHumanRequest(payload);

      const [, init] = fetchMock.mock.calls[0];
      const body = JSON.parse(init.body);
      expect(body.html).not.toContain("<script>");
      expect(body.html).toContain("&lt;script&gt;");
      expect(body.html).toContain("&amp;");
      expect(body.html).toContain("&#39;quotes&#39;");
      expect(body.html).toContain("&lt;b&gt;bold&lt;/b&gt;");
    });

    it("falls back to issue id and '(untitled)' in the email subject, html, and text when absent", async () => {
      fetchMock.mockResolvedValue(jsonResponse(true));
      const svc = new NotificationService(
        { emailFrom: "from@x.com", emailTo: "a@x.com", resendApiKey: "key" },
        makeMockLogger() as never,
      );
      const payload = makePayload({
        linearIssue: { id: "issue-9", title: null, url: null },
      });
      await svc.sendHumanRequest(payload);

      const [, init] = fetchMock.mock.calls[0];
      const body = JSON.parse(init.body);
      expect(body.subject).toContain("issue-9");
      expect(body.subject).toContain("(untitled)");
      expect(body.html).toContain("issue-9");
      expect(body.html).toContain("(untitled)");
      expect(body.html).not.toContain("Open Linear issue");
      expect(body.text).toContain("issue-9: (untitled)");
    });

    it.each([
      ["plan_ambiguous", "Plan needs review (ambiguous)"],
      ["plan_low_confidence", "Plan needs review (low confidence)"],
      ["impl_rejected", "Implementation needs review (rejected by agent)"],
      ["impl_uncertain", "Implementation needs review (uncertain)"],
      ["other", "Human intervention requested"],
    ] as const)("maps reason %s to label", async (reason, label) => {
      fetchMock.mockResolvedValue(jsonResponse(true));
      const svc = new NotificationService(
        { emailFrom: "from@x.com", slackWebhookUrl: "https://hooks.slack.com/x" },
        makeMockLogger() as never,
      );
      await svc.sendHumanRequest(makePayload({ reason }));
      const [, init] = fetchMock.mock.calls[0];
      const body = JSON.parse(init.body);
      expect(body.text).toContain(label);
    });
  });
});
