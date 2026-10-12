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
      id: "LIN-1",
      identifier: "LIN-1",
      title: "Add feature X",
      url: "https://linear.app/team/issue/LIN-1",
    },
    runState: "AwaitingHumanInput",
    runUrl: "https://foundry.example.com/runs/run-1",
    ...overrides,
  };
}

function makeLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };
}

function okResponse(): Response {
  return {
    ok: true,
    status: 200,
    text: async () => "",
  } as unknown as Response;
}

function errorResponse(status: number, body: string): Response {
  return {
    ok: false,
    status,
    text: async () => body,
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

  describe("isConfigured()", () => {
    it("returns true when only a Slack webhook URL is configured", () => {
      const svc = new NotificationService(
        { emailFrom: "from@example.com", slackWebhookUrl: "https://hooks.slack.com/x" },
        makeLogger() as never,
      );
      expect(svc.isConfigured()).toBe(true);
    });

    it("returns true when emailTo and resendApiKey are both configured", () => {
      const svc = new NotificationService(
        { emailFrom: "from@example.com", emailTo: "to@example.com", resendApiKey: "re_123" },
        makeLogger() as never,
      );
      expect(svc.isConfigured()).toBe(true);
    });

    it("returns false when emailTo is set but resendApiKey is missing", () => {
      const svc = new NotificationService(
        { emailFrom: "from@example.com", emailTo: "to@example.com" },
        makeLogger() as never,
      );
      expect(svc.isConfigured()).toBe(false);
    });

    it("returns false when nothing is configured", () => {
      const svc = new NotificationService(
        { emailFrom: "from@example.com" },
        makeLogger() as never,
      );
      expect(svc.isConfigured()).toBe(false);
    });
  });

  describe("sendHumanRequest()", () => {
    it("no-ops (neither attempted) when no destination is configured", async () => {
      const svc = new NotificationService(
        { emailFrom: "from@example.com" },
        makeLogger() as never,
      );

      const result = await svc.sendHumanRequest(makePayload());

      expect(result.slack.attempted).toBe(false);
      expect(result.email.attempted).toBe(false);
      expect(result.slack.ok).toBe(false);
      expect(result.email.ok).toBe(false);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("sends a successful Slack notification", async () => {
      fetchMock.mockResolvedValue(okResponse());
      const config: NotificationConfig = {
        emailFrom: "from@example.com",
        slackWebhookUrl: "https://hooks.slack.com/services/x",
      };
      const svc = new NotificationService(config, makeLogger() as never);

      const result = await svc.sendHumanRequest(makePayload());

      expect(result.slack.attempted).toBe(true);
      expect(result.slack.ok).toBe(true);
      expect(result.slack.error).toBeUndefined();
      expect(fetchMock).toHaveBeenCalledWith(
        "https://hooks.slack.com/services/x",
        expect.objectContaining({ method: "POST" }),
      );
      const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
      expect(body.text).toContain("Plan needs review (ambiguous)");
      expect(body.text).toContain("LIN-1");
    });

    it("records a Slack failure (non-ok response) without throwing, and logs a warning", async () => {
      fetchMock.mockResolvedValue(errorResponse(500, "server exploded"));
      const logger = makeLogger();
      const config: NotificationConfig = {
        emailFrom: "from@example.com",
        slackWebhookUrl: "https://hooks.slack.com/services/x",
      };
      const svc = new NotificationService(config, logger as never);

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

    it("records a Slack failure when fetch itself rejects (network error)", async () => {
      fetchMock.mockRejectedValue(new Error("ECONNREFUSED"));
      const config: NotificationConfig = {
        emailFrom: "from@example.com",
        slackWebhookUrl: "https://hooks.slack.com/services/x",
      };
      const svc = new NotificationService(config, makeLogger() as never);

      const result = await svc.sendHumanRequest(makePayload());

      expect(result.slack.ok).toBe(false);
      expect(result.slack.error).toBe("ECONNREFUSED");
    });

    it("stringifies a non-Error rejection from fetch for both Slack and email", async () => {
      fetchMock.mockRejectedValue("raw string failure");
      const config: NotificationConfig = {
        emailFrom: "from@example.com",
        emailTo: "to@example.com",
        resendApiKey: "re_abc",
        slackWebhookUrl: "https://hooks.slack.com/services/x",
      };
      const svc = new NotificationService(config, makeLogger() as never);

      const result = await svc.sendHumanRequest(makePayload());

      expect(result.slack.error).toBe("raw string failure");
      expect(result.email.error).toBe("raw string failure");
    });

    it("sends a successful email notification via Resend", async () => {
      fetchMock.mockResolvedValue(okResponse());
      const config: NotificationConfig = {
        emailFrom: "AgentForge <bot@example.com>",
        emailTo: "ops@example.com, lead@example.com",
        resendApiKey: "re_abc123",
      };
      const svc = new NotificationService(config, makeLogger() as never);

      const result = await svc.sendHumanRequest(makePayload());

      expect(result.email.attempted).toBe(true);
      expect(result.email.ok).toBe(true);
      expect(fetchMock).toHaveBeenCalledWith(
        "https://api.resend.com/emails",
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({ Authorization: "Bearer re_abc123" }),
        }),
      );
      const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
      expect(body.to).toEqual(["ops@example.com", "lead@example.com"]);
      expect(body.from).toBe("AgentForge <bot@example.com>");
      expect(body.subject).toContain("LIN-1");
      expect(body.html).toContain("<!doctype html>");
      expect(body.text).toContain("Run:");
    });

    it("records an email failure (non-ok response) without throwing, and logs a warning", async () => {
      fetchMock.mockResolvedValue(errorResponse(422, "invalid from address"));
      const logger = makeLogger();
      const config: NotificationConfig = {
        emailFrom: "from@example.com",
        emailTo: "to@example.com",
        resendApiKey: "re_abc",
      };
      const svc = new NotificationService(config, logger as never);

      const result = await svc.sendHumanRequest(makePayload());

      expect(result.email.attempted).toBe(true);
      expect(result.email.ok).toBe(false);
      expect(result.email.error).toContain("422");
      expect(result.email.error).toContain("invalid from address");
      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ runId: "run-1" }),
        "Email notification failed",
      );
    });

    it("sends both Slack and email concurrently when both are configured", async () => {
      fetchMock.mockResolvedValue(okResponse());
      const config: NotificationConfig = {
        emailFrom: "from@example.com",
        emailTo: "to@example.com",
        resendApiKey: "re_abc",
        slackWebhookUrl: "https://hooks.slack.com/services/x",
      };
      const svc = new NotificationService(config, makeLogger() as never);

      const result = await svc.sendHumanRequest(makePayload());

      expect(result.slack.attempted).toBe(true);
      expect(result.slack.ok).toBe(true);
      expect(result.email.attempted).toBe(true);
      expect(result.email.ok).toBe(true);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it("includes planConfidence and openQuestions (with required markers) in the Slack payload", async () => {
      fetchMock.mockResolvedValue(okResponse());
      const config: NotificationConfig = {
        emailFrom: "from@example.com",
        slackWebhookUrl: "https://hooks.slack.com/services/x",
      };
      const svc = new NotificationService(config, makeLogger() as never);

      const payload = makePayload({
        planConfidence: 0.42,
        context: "Some long context ".repeat(200),
        openQuestions: [
          { id: "q1", question: "Should we use OAuth?", requiredForExecution: true },
          { id: "q2", question: "Naming convention?", requiredForExecution: false },
        ],
      });

      await svc.sendHumanRequest(payload);

      const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
      const serialized = JSON.stringify(body);
      expect(serialized).toContain("0.42");
      expect(serialized).toContain("required");
      expect(serialized).toContain("Should we use OAuth?");
      // Context over 1500 chars should be truncated with an ellipsis.
      expect(serialized).toContain("…");
    });

    it("includes planConfidence, context and open questions in the email HTML/text", async () => {
      fetchMock.mockResolvedValue(okResponse());
      const config: NotificationConfig = {
        emailFrom: "from@example.com",
        emailTo: "to@example.com",
        resendApiKey: "re_abc",
      };
      const svc = new NotificationService(config, makeLogger() as never);

      const payload = makePayload({
        planConfidence: 0.77,
        context: "<script>alert(1)</script>",
        openQuestions: [{ id: "q1", question: "Use Postgres?", requiredForExecution: true }],
      });

      await svc.sendHumanRequest(payload);

      const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
      expect(body.html).toContain("0.77");
      // HTML must be escaped, not raw script tags.
      expect(body.html).not.toContain("<script>alert(1)</script>");
      expect(body.html).toContain("&lt;script&gt;");
      expect(body.text).toContain("0.77");
      expect(body.text).toContain("[required]");
      expect(body.text).toContain("Use Postgres?");
    });

    it("falls back to the issue id and '(untitled)' when identifier/title are missing", async () => {
      fetchMock.mockResolvedValue(okResponse());
      const config: NotificationConfig = {
        emailFrom: "from@example.com",
        slackWebhookUrl: "https://hooks.slack.com/services/x",
      };
      const svc = new NotificationService(config, makeLogger() as never);

      const payload = makePayload({
        linearIssue: { id: "LIN-999", title: null, url: null },
        reason: "other",
      });

      await svc.sendHumanRequest(payload);

      const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
      expect(body.text).toContain("LIN-999");
      expect(body.text).toContain("(untitled)");
      expect(body.text).toContain("Human intervention requested");
    });

    it("uses '(untitled)' in the email subject/HTML/text and renders non-required open questions without the [required] marker", async () => {
      fetchMock.mockResolvedValue(okResponse());
      const config: NotificationConfig = {
        emailFrom: "from@example.com",
        emailTo: "to@example.com",
        resendApiKey: "re_abc",
      };
      const svc = new NotificationService(config, makeLogger() as never);

      const payload = makePayload({
        linearIssue: { id: "LIN-999", title: null, url: null },
        openQuestions: [
          { id: "q1", question: "Non-blocking question?", requiredForExecution: false },
        ],
      });

      await svc.sendHumanRequest(payload);

      const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
      expect(body.subject).toContain("(untitled)");
      expect(body.html).toContain("(untitled)");
      expect(body.html).toContain("Non-blocking question?");
      expect(body.html).not.toContain("<strong>[required]</strong>");
      expect(body.text).toContain("(untitled)");
      expect(body.text).toContain("Non-blocking question?");
      expect(body.text).not.toContain("[required]");
    });

    it("omits the Linear issue link in the email HTML when linearIssue.url is absent", async () => {
      fetchMock.mockResolvedValue(okResponse());
      const config: NotificationConfig = {
        emailFrom: "from@example.com",
        emailTo: "to@example.com",
        resendApiKey: "re_abc",
      };
      const svc = new NotificationService(config, makeLogger() as never);

      const payload = makePayload({
        linearIssue: { id: "LIN-999", title: "No URL issue", url: null },
      });

      await svc.sendHumanRequest(payload);

      const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
      expect(body.html).not.toContain("Open Linear issue");
      expect(body.html).toContain("No URL issue");
    });

    it("handles each HumanRequestReason label distinctly", async () => {
      fetchMock.mockResolvedValue(okResponse());
      const config: NotificationConfig = {
        emailFrom: "from@example.com",
        slackWebhookUrl: "https://hooks.slack.com/services/x",
      };
      const svc = new NotificationService(config, makeLogger() as never);

      const reasons = [
        ["plan_ambiguous", "Plan needs review (ambiguous)"],
        ["plan_low_confidence", "Plan needs review (low confidence)"],
        ["impl_rejected", "Implementation needs review (rejected by agent)"],
        ["impl_uncertain", "Implementation needs review (uncertain)"],
        ["other", "Human intervention requested"],
      ] as const;

      for (const [reason, label] of reasons) {
        fetchMock.mockClear();
        await svc.sendHumanRequest(makePayload({ reason }));
        const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
        expect(body.text).toContain(label);
      }
    });
  });
});
