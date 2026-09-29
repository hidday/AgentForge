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
    summary: "Needs a decision",
    linearIssue: {
      id: "LIN-1",
      identifier: "ENG-42",
      title: "Fix the widget",
      url: "https://linear.app/team/issue/ENG-42",
    },
    runState: "AwaitingPlanApproval",
    runUrl: "https://dashboard.example.com/runs/run-1",
    ...overrides,
  };
}

function buildLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };
}

function okResponse(): Response {
  return { ok: true, status: 200, text: () => Promise.resolve("") } as unknown as Response;
}

function failResponse(status: number, body: string): Response {
  return { ok: false, status, text: () => Promise.resolve(body) } as unknown as Response;
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
    it("is true when a slack webhook is set", () => {
      const svc = new NotificationService(
        { emailFrom: "noreply@example.com", slackWebhookUrl: "https://hooks.slack.com/x" },
        buildLogger() as never,
      );
      expect(svc.isConfigured()).toBe(true);
    });

    it("is true when both emailTo and resendApiKey are set", () => {
      const svc = new NotificationService(
        { emailFrom: "noreply@example.com", emailTo: "a@b.com", resendApiKey: "key" },
        buildLogger() as never,
      );
      expect(svc.isConfigured()).toBe(true);
    });

    it("is false when neither channel is fully configured", () => {
      const svc = new NotificationService(
        { emailFrom: "noreply@example.com", emailTo: "a@b.com" },
        buildLogger() as never,
      );
      expect(svc.isConfigured()).toBe(false);
    });

    it("is false with an entirely empty config", () => {
      const svc = new NotificationService({ emailFrom: "noreply@example.com" }, buildLogger() as never);
      expect(svc.isConfigured()).toBe(false);
    });
  });

  describe("sendHumanRequest", () => {
    it("attempts neither channel when nothing is configured", async () => {
      const svc = new NotificationService({ emailFrom: "noreply@example.com" }, buildLogger() as never);
      const result = await svc.sendHumanRequest(makePayload());
      expect(result).toEqual({
        slack: { attempted: false, ok: false },
        email: { attempted: false, ok: false },
      });
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("sends both slack and email successfully when both are configured", async () => {
      fetchMock.mockResolvedValue(okResponse());
      const config: NotificationConfig = {
        emailFrom: "noreply@example.com",
        emailTo: "team@example.com",
        resendApiKey: "resend-key",
        slackWebhookUrl: "https://hooks.slack.com/services/x",
      };
      const svc = new NotificationService(config, buildLogger() as never);

      const result = await svc.sendHumanRequest(makePayload());

      expect(result.slack).toEqual({ attempted: true, ok: true });
      expect(result.email).toEqual({ attempted: true, ok: true });
      expect(fetchMock).toHaveBeenCalledTimes(2);

      const [slackUrl, slackInit] = fetchMock.mock.calls.find(
        (c) => c[0] === "https://hooks.slack.com/services/x",
      )!;
      expect(slackUrl).toBe("https://hooks.slack.com/services/x");
      expect((slackInit as RequestInit).method).toBe("POST");

      const [emailUrl, emailInit] = fetchMock.mock.calls.find(
        (c) => c[0] === "https://api.resend.com/emails",
      )!;
      expect(emailUrl).toBe("https://api.resend.com/emails");
      const emailHeaders = (emailInit as RequestInit).headers as Record<string, string>;
      expect(emailHeaders.Authorization).toBe("Bearer resend-key");
      const emailBody = JSON.parse((emailInit as RequestInit).body as string) as { to: string[] };
      expect(emailBody.to).toEqual(["team@example.com"]);
    });

    it("splits and trims a comma-separated email recipient list", async () => {
      fetchMock.mockResolvedValue(okResponse());
      const svc = new NotificationService(
        {
          emailFrom: "noreply@example.com",
          emailTo: " a@example.com ,b@example.com,, ",
          resendApiKey: "key",
        },
        buildLogger() as never,
      );
      await svc.sendHumanRequest(makePayload());
      const [, emailInit] = fetchMock.mock.calls[0];
      const emailBody = JSON.parse((emailInit as RequestInit).body as string) as { to: string[] };
      expect(emailBody.to).toEqual(["a@example.com", "b@example.com"]);
    });

    it("only attempts slack when only the slack webhook is configured", async () => {
      fetchMock.mockResolvedValue(okResponse());
      const svc = new NotificationService(
        { emailFrom: "noreply@example.com", slackWebhookUrl: "https://hooks.slack.com/x" },
        buildLogger() as never,
      );
      const result = await svc.sendHumanRequest(makePayload());
      expect(result.slack.attempted).toBe(true);
      expect(result.email.attempted).toBe(false);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("records a slack failure (non-ok response) and logs a warning without throwing", async () => {
      fetchMock.mockResolvedValue(failResponse(500, "server exploded"));
      const logger = buildLogger();
      const svc = new NotificationService(
        { emailFrom: "noreply@example.com", slackWebhookUrl: "https://hooks.slack.com/x" },
        logger as never,
      );

      const result = await svc.sendHumanRequest(makePayload());

      expect(result.slack.ok).toBe(false);
      expect(result.slack.error).toContain("Slack webhook returned 500");
      expect(result.slack.error).toContain("server exploded");
      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ runId: "run-1", error: expect.stringContaining("500") }),
        "Slack notification failed",
      );
    });

    it("records an email failure (non-ok response) and logs a warning", async () => {
      fetchMock.mockResolvedValue(failResponse(422, "bad request"));
      const logger = buildLogger();
      const svc = new NotificationService(
        { emailFrom: "noreply@example.com", emailTo: "a@b.com", resendApiKey: "key" },
        logger as never,
      );

      const result = await svc.sendHumanRequest(makePayload());

      expect(result.email.ok).toBe(false);
      expect(result.email.error).toContain("Resend returned 422");
      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ runId: "run-1", error: expect.stringContaining("422") }),
        "Email notification failed",
      );
    });

    it("captures a network-level throw (Error) as the failure message", async () => {
      fetchMock.mockRejectedValue(new Error("network down"));
      const svc = new NotificationService(
        { emailFrom: "noreply@example.com", slackWebhookUrl: "https://hooks.slack.com/x" },
        buildLogger() as never,
      );
      const result = await svc.sendHumanRequest(makePayload());
      expect(result.slack.error).toBe("network down");
    });

    it("stringifies a non-Error throw as the failure message", async () => {
      fetchMock.mockRejectedValue("weird rejection");
      const svc = new NotificationService(
        { emailFrom: "noreply@example.com", slackWebhookUrl: "https://hooks.slack.com/x" },
        buildLogger() as never,
      );
      const result = await svc.sendHumanRequest(makePayload());
      expect(result.slack.error).toBe("weird rejection");
    });

    it("stringifies a non-Error throw for the email channel as well", async () => {
      fetchMock.mockRejectedValue("weird email rejection");
      const svc = new NotificationService(
        { emailFrom: "noreply@example.com", emailTo: "a@b.com", resendApiKey: "key" },
        buildLogger() as never,
      );
      const result = await svc.sendHumanRequest(makePayload());
      expect(result.email.error).toBe("weird email rejection");
    });

    it("tolerates a failure response whose text() itself rejects", async () => {
      const resp = {
        ok: false,
        status: 503,
        text: () => Promise.reject(new Error("stream closed")),
      } as unknown as Response;
      fetchMock.mockResolvedValue(resp);
      const svc = new NotificationService(
        { emailFrom: "noreply@example.com", slackWebhookUrl: "https://hooks.slack.com/x" },
        buildLogger() as never,
      );
      const result = await svc.sendHumanRequest(makePayload());
      expect(result.slack.ok).toBe(false);
      expect(result.slack.error).toContain("Slack webhook returned 503");
    });

    it("sends both channels independently: one failing does not affect the other", async () => {
      fetchMock.mockImplementation((url: string) => {
        if (url.includes("slack")) return Promise.resolve(failResponse(500, "oops"));
        return Promise.resolve(okResponse());
      });
      const svc = new NotificationService(
        {
          emailFrom: "noreply@example.com",
          slackWebhookUrl: "https://hooks.slack.com/x",
          emailTo: "a@b.com",
          resendApiKey: "key",
        },
        buildLogger() as never,
      );
      const result = await svc.sendHumanRequest(makePayload());
      expect(result.slack.ok).toBe(false);
      expect(result.email.ok).toBe(true);
    });
  });

  describe("message formatting", () => {
    async function captureSlackBody(payload: NotificationPayload) {
      fetchMock.mockClear();
      fetchMock.mockResolvedValue(okResponse());
      const svc = new NotificationService(
        { emailFrom: "noreply@example.com", slackWebhookUrl: "https://hooks.slack.com/x" },
        buildLogger() as never,
      );
      await svc.sendHumanRequest(payload);
      const [, init] = fetchMock.mock.calls[0];
      return JSON.parse((init as RequestInit).body as string) as {
        text: string;
        blocks: unknown[];
      };
    }

    async function captureEmailBodies(payload: NotificationPayload) {
      fetchMock.mockClear();
      fetchMock.mockResolvedValue(okResponse());
      const svc = new NotificationService(
        { emailFrom: "noreply@example.com", emailTo: "a@b.com", resendApiKey: "key" },
        buildLogger() as never,
      );
      await svc.sendHumanRequest(payload);
      const [, init] = fetchMock.mock.calls[0];
      return JSON.parse((init as RequestInit).body as string) as {
        subject: string;
        html: string;
        text: string;
      };
    }

    it("falls back to the issue id and '(untitled)' when identifier/title are missing", async () => {
      const body = await captureSlackBody(
        makePayload({ linearIssue: { id: "LIN-9", title: null, url: null } }),
      );
      expect(body.text).toContain("LIN-9");
      expect(body.text).toContain("(untitled)");
    });

    it("includes plan confidence formatted to two decimals when present", async () => {
      const body = await captureSlackBody(makePayload({ planConfidence: 0.5 }));
      const json = JSON.stringify(body.blocks);
      expect(json).toContain("Plan confidence:");
      expect(json).toContain("0.50");
    });

    it("omits plan confidence field when not present", async () => {
      const body = await captureSlackBody(makePayload({ planConfidence: undefined }));
      const json = JSON.stringify(body.blocks);
      expect(json).not.toContain("Plan confidence:");
    });

    it("includes an open questions summary and up to 3 detailed questions in slack", async () => {
      const openQuestions = [
        { id: "q1", question: "Is this safe?", requiredForExecution: true },
        { id: "q2", question: "Do we need approval?", requiredForExecution: false },
        { id: "q3", question: "Third question", requiredForExecution: true },
        { id: "q4", question: "Fourth question, should be excluded", requiredForExecution: false },
      ];
      const body = await captureSlackBody(makePayload({ openQuestions }));
      const json = JSON.stringify(body.blocks);
      expect(json).toContain("4 (2 required)");
      expect(json).toContain("Is this safe?");
      expect(json).toContain("Third question");
      expect(json).not.toContain("Fourth question");
      expect(json).toContain("[required]");
    });

    it("omits open-questions blocks when the list is empty", async () => {
      const body = await captureSlackBody(makePayload({ openQuestions: [] }));
      const json = JSON.stringify(body.blocks);
      expect(json).not.toContain("Open questions:");
      expect(json).not.toContain("*Questions:*");
    });

    it("includes a context section truncated at 1500 chars for slack", async () => {
      const longContext = "x".repeat(2000);
      const body = await captureSlackBody(makePayload({ context: longContext }));
      const json = JSON.stringify(body.blocks);
      expect(json).toContain("*Context:*");
      expect(json).toContain("…");
      // truncate() slices to max-1 then appends the ellipsis char
      expect(json).toContain(`${"x".repeat(1499)}…`);
    });

    it("omits the context section when not provided", async () => {
      const body = await captureSlackBody(makePayload({ context: undefined }));
      const json = JSON.stringify(body.blocks);
      expect(json).not.toContain("*Context:*");
    });

    it("includes an 'Open Linear issue' button only when a linear url is present", async () => {
      const withUrl = await captureSlackBody(
        makePayload({ linearIssue: { id: "LIN-1", title: "T", url: "https://linear.app/x" } }),
      );
      expect(JSON.stringify(withUrl.blocks)).toContain("Open Linear issue");

      const withoutUrl = await captureSlackBody(
        makePayload({ linearIssue: { id: "LIN-1", title: "T", url: null } }),
      );
      expect(JSON.stringify(withoutUrl.blocks)).not.toContain("Open Linear issue");
    });

    it("produces the expected reason label for every HumanRequestReason", async () => {
      const cases: [NotificationPayload["reason"], string][] = [
        ["plan_ambiguous", "Plan needs review (ambiguous)"],
        ["plan_low_confidence", "Plan needs review (low confidence)"],
        ["impl_rejected", "Implementation needs review (rejected by agent)"],
        ["impl_uncertain", "Implementation needs review (uncertain)"],
        ["other", "Human intervention requested"],
      ];
      for (const [reason, label] of cases) {
        fetchMock.mockClear();
        const body = await captureSlackBody(makePayload({ reason }));
        expect(body.text).toContain(label);
      }
    });

    it("renders escaped HTML and all sections in the email body, and a matching plaintext version", async () => {
      const payload = makePayload({
        linearIssue: {
          id: "LIN-1",
          identifier: "ENG-1",
          title: "<script>alert('x')</script> & \"quoted\"",
          url: "https://linear.app/x",
        },
        planConfidence: 0.42,
        context: "some context",
        openQuestions: [{ id: "q1", question: "Ready?", requiredForExecution: true }],
      });
      const { subject, html, text } = await captureEmailBodies(payload);

      expect(subject).toContain("ENG-1");
      expect(html).not.toContain("<script>alert");
      expect(html).toContain("&lt;script&gt;");
      expect(html).toContain("&amp;");
      expect(html).toContain("&quot;quoted&quot;");
      expect(html).toContain("Plan confidence:</strong> 0.42");
      expect(html).toContain("some context");
      expect(html).toContain("Ready?");
      expect(html).toContain("Open Linear issue");

      expect(text).toContain("ENG-1");
      expect(text).toContain("Plan confidence: 0.42");
      expect(text).toContain("some context");
      expect(text).toContain("[required] Ready?");
      expect(text).toContain("Linear: https://linear.app/x");
    });

    it("omits optional email sections when absent and truncates long context at 2000 chars", async () => {
      const longContext = "y".repeat(2500);
      const payload = makePayload({
        linearIssue: { id: "LIN-2", title: null, url: null },
        planConfidence: undefined,
        context: longContext,
        openQuestions: undefined,
      });
      const { html, text } = await captureEmailBodies(payload);

      expect(html).not.toContain("Plan confidence:");
      expect(html).not.toContain("Open Linear issue");
      expect(html).toContain(`${"y".repeat(1999)}…`);
      expect(text).not.toContain("Plan confidence:");
      expect(text).not.toContain("Linear:");
      expect(text).toContain(`${"y".repeat(1999)}…`);
    });

    it("limits email open-questions rendering to the first 5", async () => {
      const openQuestions = Array.from({ length: 7 }, (_, i) => ({
        id: `q${String(i)}`,
        question: `Question number ${String(i)}`,
        requiredForExecution: false,
      }));
      const { html, text } = await captureEmailBodies(makePayload({ openQuestions }));
      expect(html).toContain("Question number 4");
      expect(html).not.toContain("Question number 5");
      expect(text).toContain("Question number 4");
      expect(text).not.toContain("Question number 5");
    });
  });
});
