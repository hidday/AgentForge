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
    summary: "The plan is ambiguous about auth.",
    linearIssue: {
      id: "lin-1",
      identifier: "ENG-42",
      title: "Add login",
      url: "https://linear.app/team/issue/ENG-42",
    },
    runState: "AwaitingPlanApproval",
    runUrl: "https://foundry.example/runs/run-1",
    ...overrides,
  };
}

function baseConfig(overrides: Partial<NotificationConfig> = {}): NotificationConfig {
  return {
    emailFrom: "AgentForge <onboarding@resend.dev>",
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

  describe("isConfigured()", () => {
    it("is false when neither slack nor email is configured", () => {
      const svc = new NotificationService(baseConfig(), makeLogger() as never);
      expect(svc.isConfigured()).toBe(false);
    });

    it("is true when only slackWebhookUrl is set", () => {
      const svc = new NotificationService(
        baseConfig({ slackWebhookUrl: "https://hooks.slack.com/services/x" }),
        makeLogger() as never,
      );
      expect(svc.isConfigured()).toBe(true);
    });

    it("is true when emailTo and resendApiKey are both set", () => {
      const svc = new NotificationService(
        baseConfig({ emailTo: "a@test.com", resendApiKey: "re_123" }),
        makeLogger() as never,
      );
      expect(svc.isConfigured()).toBe(true);
    });

    it("is false when emailTo is set but resendApiKey is missing", () => {
      const svc = new NotificationService(
        baseConfig({ emailTo: "a@test.com" }),
        makeLogger() as never,
      );
      expect(svc.isConfigured()).toBe(false);
    });

    it("is false when resendApiKey is set but emailTo is missing", () => {
      const svc = new NotificationService(
        baseConfig({ resendApiKey: "re_123" }),
        makeLogger() as never,
      );
      expect(svc.isConfigured()).toBe(false);
    });
  });

  describe("sendHumanRequest() — no channels configured", () => {
    it("is a no-op: no fetch calls, both results unattempted", async () => {
      const svc = new NotificationService(baseConfig(), makeLogger() as never);
      const result = await svc.sendHumanRequest(makePayload());

      expect(fetchMock).not.toHaveBeenCalled();
      expect(result).toEqual({
        slack: { attempted: false, ok: false },
        email: { attempted: false, ok: false },
      });
    });
  });

  describe("sendHumanRequest() — slack only", () => {
    it("posts to the webhook and marks slack ok=true on a 200 response", async () => {
      fetchMock.mockResolvedValue({ ok: true, status: 200, text: async () => "" });
      const svc = new NotificationService(
        baseConfig({ slackWebhookUrl: "https://hooks.slack.com/services/x" }),
        makeLogger() as never,
      );

      const result = await svc.sendHumanRequest(makePayload());

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe("https://hooks.slack.com/services/x");
      expect(init.method).toBe("POST");
      const body = JSON.parse(init.body as string) as { text: string; blocks: unknown[] };
      expect(body.text).toContain("ENG-42");
      expect(body.text).toContain("Plan needs review (ambiguous)");

      expect(result.slack).toEqual({ attempted: true, ok: true });
      expect(result.email).toEqual({ attempted: false, ok: false });
    });

    it("includes plan confidence and open questions fields in the slack blocks", async () => {
      fetchMock.mockResolvedValue({ ok: true, status: 200, text: async () => "" });
      const svc = new NotificationService(
        baseConfig({ slackWebhookUrl: "https://hooks.slack.com/services/x" }),
        makeLogger() as never,
      );

      await svc.sendHumanRequest(
        makePayload({
          planConfidence: 0.42,
          openQuestions: [
            { id: "q1", question: "Use OAuth or API keys?", requiredForExecution: true },
            { id: "q2", question: "Which rate limit?", requiredForExecution: false },
          ],
          context: "Some long context about the ambiguity.",
        }),
      );

      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(init.body as string) as { blocks: Record<string, unknown>[] };
      const serialized = JSON.stringify(body.blocks);
      expect(serialized).toContain("0.42");
      expect(serialized).toContain("2 (1 required)");
      expect(serialized).toContain("[required]");
      expect(serialized).toContain("Use OAuth or API keys?");
      expect(serialized).toContain("Some long context about the ambiguity.");
    });

    it("truncates a very long context in the slack section", async () => {
      fetchMock.mockResolvedValue({ ok: true, status: 200, text: async () => "" });
      const svc = new NotificationService(
        baseConfig({ slackWebhookUrl: "https://hooks.slack.com/services/x" }),
        makeLogger() as never,
      );
      const longContext = "x".repeat(2000);

      await svc.sendHumanRequest(makePayload({ context: longContext }));

      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(init.body as string) as { blocks: Record<string, unknown>[] };
      const serialized = JSON.stringify(body.blocks);
      expect(serialized).toContain("…");
      expect(serialized).not.toContain("x".repeat(1600));
    });

    it("omits the Linear issue button when linearIssue.url is null", async () => {
      fetchMock.mockResolvedValue({ ok: true, status: 200, text: async () => "" });
      const svc = new NotificationService(
        baseConfig({ slackWebhookUrl: "https://hooks.slack.com/services/x" }),
        makeLogger() as never,
      );

      await svc.sendHumanRequest(
        makePayload({ linearIssue: { id: "lin-1", title: null, url: null } }),
      );

      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(init.body as string) as { blocks: Record<string, unknown>[] };
      const actions = body.blocks.find((b) => b.type === "actions") as {
        elements: { text: { text: string } }[];
      };
      expect(actions.elements).toHaveLength(1);
      expect(actions.elements[0].text.text).toBe("Open run");
      expect(body.text).toContain("lin-1");
      expect(body.text).toContain("(untitled)");
    });

    it("records an error without throwing when the slack webhook returns non-ok", async () => {
      fetchMock.mockResolvedValue({
        ok: false,
        status: 500,
        text: async () => "internal error",
      });
      const logger = makeLogger();
      const svc = new NotificationService(
        baseConfig({ slackWebhookUrl: "https://hooks.slack.com/services/x" }),
        logger as never,
      );

      const result = await svc.sendHumanRequest(makePayload());

      expect(result.slack.ok).toBe(false);
      expect(result.slack.error).toContain("500");
      expect(result.slack.error).toContain("internal error");
      expect(logger.warn).toHaveBeenCalledTimes(1);
      expect(logger.warn.mock.calls[0][1]).toBe("Slack notification failed");
    });

    it("records an error without throwing when fetch itself rejects", async () => {
      fetchMock.mockRejectedValue(new Error("network down"));
      const logger = makeLogger();
      const svc = new NotificationService(
        baseConfig({ slackWebhookUrl: "https://hooks.slack.com/services/x" }),
        logger as never,
      );

      const result = await svc.sendHumanRequest(makePayload());

      expect(result.slack.ok).toBe(false);
      expect(result.slack.error).toBe("network down");
      expect(logger.warn).toHaveBeenCalledTimes(1);
    });
  });

  describe("sendHumanRequest() — email only", () => {
    it("posts to the Resend API with bearer auth and marks email ok=true", async () => {
      fetchMock.mockResolvedValue({ ok: true, status: 200, text: async () => "" });
      const svc = new NotificationService(
        baseConfig({ emailTo: "a@test.com, b@test.com", resendApiKey: "re_123" }),
        makeLogger() as never,
      );

      const result = await svc.sendHumanRequest(makePayload());

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe("https://api.resend.com/emails");
      expect((init.headers as Record<string, string>).Authorization).toBe("Bearer re_123");
      const body = JSON.parse(init.body as string) as {
        from: string;
        to: string[];
        subject: string;
        html: string;
        text: string;
      };
      expect(body.from).toBe("AgentForge <onboarding@resend.dev>");
      expect(body.to).toEqual(["a@test.com", "b@test.com"]);
      expect(body.subject).toContain("[AgentForge]");
      expect(body.subject).toContain("ENG-42");
      expect(body.html).toContain("<html>");
      expect(body.text).toContain("Run: https://foundry.example/runs/run-1");

      expect(result.email).toEqual({ attempted: true, ok: true });
      expect(result.slack).toEqual({ attempted: false, ok: false });
    });

    it("escapes HTML-significant characters from issue title and summary", async () => {
      fetchMock.mockResolvedValue({ ok: true, status: 200, text: async () => "" });
      const svc = new NotificationService(
        baseConfig({ emailTo: "a@test.com", resendApiKey: "re_123" }),
        makeLogger() as never,
      );

      await svc.sendHumanRequest(
        makePayload({
          summary: `Risk: <script>alert("x")</script> & "quotes"`,
          linearIssue: {
            id: "lin-1",
            identifier: "ENG-1",
            title: `<b>bold</b> & 'quoted'`,
            url: "https://linear.app/issue/ENG-1",
          },
        }),
      );

      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(init.body as string) as { html: string };
      expect(body.html).not.toContain("<script>");
      expect(body.html).toContain("&lt;script&gt;");
      expect(body.html).toContain("&lt;b&gt;bold&lt;/b&gt;");
      expect(body.html).toContain("&amp;");
      expect(body.html).toContain("&#39;quoted&#39;");
    });

    it("includes plan confidence, context and open questions in html and text bodies", async () => {
      fetchMock.mockResolvedValue({ ok: true, status: 200, text: async () => "" });
      const svc = new NotificationService(
        baseConfig({ emailTo: "a@test.com", resendApiKey: "re_123" }),
        makeLogger() as never,
      );

      await svc.sendHumanRequest(
        makePayload({
          planConfidence: 0.33,
          context: "Detailed context for the reviewer.",
          openQuestions: [
            { id: "q1", question: "Which DB?", requiredForExecution: true },
          ],
        }),
      );

      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(init.body as string) as { html: string; text: string };
      expect(body.html).toContain("0.33");
      expect(body.html).toContain("Detailed context for the reviewer.");
      expect(body.html).toContain("[required]");
      expect(body.html).toContain("Which DB?");
      expect(body.text).toContain("Plan confidence: 0.33");
      expect(body.text).toContain("Context:");
      expect(body.text).toContain("[required] Which DB?");
    });

    it("omits the Linear issue link in the html body when linearIssue.url is null", async () => {
      fetchMock.mockResolvedValue({ ok: true, status: 200, text: async () => "" });
      const svc = new NotificationService(
        baseConfig({ emailTo: "a@test.com", resendApiKey: "re_123" }),
        makeLogger() as never,
      );

      await svc.sendHumanRequest(
        makePayload({ linearIssue: { id: "lin-1", title: "No link issue", url: null } }),
      );

      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(init.body as string) as { html: string };
      expect(body.html).not.toContain("Open Linear issue");
      expect(body.html).toContain("No link issue");
    });

    it("records an error without throwing when Resend returns non-ok", async () => {
      fetchMock.mockResolvedValue({ ok: false, status: 422, text: async () => "bad request" });
      const logger = makeLogger();
      const svc = new NotificationService(
        baseConfig({ emailTo: "a@test.com", resendApiKey: "re_123" }),
        logger as never,
      );

      const result = await svc.sendHumanRequest(makePayload());

      expect(result.email.ok).toBe(false);
      expect(result.email.error).toContain("422");
      expect(result.email.error).toContain("bad request");
      expect(logger.warn).toHaveBeenCalledTimes(1);
      expect(logger.warn.mock.calls[0][1]).toBe("Email notification failed");
    });

    it("records a non-Error rejection as a stringified error without throwing", async () => {
      fetchMock.mockRejectedValue("boom");
      const logger = makeLogger();
      const svc = new NotificationService(
        baseConfig({ emailTo: "a@test.com", resendApiKey: "re_123" }),
        logger as never,
      );

      const result = await svc.sendHumanRequest(makePayload());

      expect(result.email.ok).toBe(false);
      expect(result.email.error).toBe("boom");
    });
  });

  describe("sendHumanRequest() — both channels configured", () => {
    it("attempts both, aggregates independent results, and failure of one does not affect the other", async () => {
      fetchMock.mockImplementation((url: string) => {
        if (url.includes("slack")) {
          return Promise.resolve({ ok: false, status: 503, text: async () => "unavailable" });
        }
        return Promise.resolve({ ok: true, status: 200, text: async () => "" });
      });
      const logger = makeLogger();
      const svc = new NotificationService(
        baseConfig({
          slackWebhookUrl: "https://hooks.slack.com/services/x",
          emailTo: "a@test.com",
          resendApiKey: "re_123",
        }),
        logger as never,
      );

      const result = await svc.sendHumanRequest(makePayload());

      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(result.slack).toEqual({ attempted: true, ok: false, error: expect.stringContaining("503") });
      expect(result.email).toEqual({ attempted: true, ok: true });
      expect(logger.warn).toHaveBeenCalledTimes(1);
    });

    it("resolves all jobs concurrently via Promise.all even when both succeed", async () => {
      fetchMock.mockResolvedValue({ ok: true, status: 200, text: async () => "" });
      const svc = new NotificationService(
        baseConfig({
          slackWebhookUrl: "https://hooks.slack.com/services/x",
          emailTo: "a@test.com",
          resendApiKey: "re_123",
        }),
        makeLogger() as never,
      );

      const result = await svc.sendHumanRequest(makePayload());

      expect(result).toEqual({
        slack: { attempted: true, ok: true },
        email: { attempted: true, ok: true },
      });
    });
  });

  describe("reason labels", () => {
    it.each([
      ["plan_ambiguous", "Plan needs review (ambiguous)"],
      ["plan_low_confidence", "Plan needs review (low confidence)"],
      ["impl_rejected", "Implementation needs review (rejected by agent)"],
      ["impl_uncertain", "Implementation needs review (uncertain)"],
      ["other", "Human intervention requested"],
    ] as const)("renders the label for reason=%s", async (reason, expectedLabel) => {
      fetchMock.mockResolvedValue({ ok: true, status: 200, text: async () => "" });
      const svc = new NotificationService(
        baseConfig({ slackWebhookUrl: "https://hooks.slack.com/services/x" }),
        makeLogger() as never,
      );

      await svc.sendHumanRequest(makePayload({ reason }));

      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(init.body as string) as { text: string };
      expect(body.text).toContain(expectedLabel);
    });
  });
});
