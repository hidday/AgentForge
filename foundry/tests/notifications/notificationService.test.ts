import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  NotificationService,
  type NotificationConfig,
  type NotificationPayload,
  type HumanRequestReason,
} from "../../src/notifications/notificationService.js";
import type { Logger } from "../../src/utils/logger.js";

function makeMockLogger() {
  return {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  };
}

function makePayload(overrides: Partial<NotificationPayload> = {}): NotificationPayload {
  return {
    runId: "run-1",
    reason: "plan_ambiguous",
    summary: "Plan needs a human look before we proceed.",
    linearIssue: {
      id: "issue-uuid-1",
      identifier: "ENG-42",
      title: "Fix the widget",
      url: "https://linear.app/team/issue/ENG-42",
    },
    runState: "PlanReview",
    runUrl: "https://foundry.example.com/runs/run-1",
    ...overrides,
  };
}

function jsonResponse(ok: boolean, status = 200, body = "") {
  return {
    ok,
    status,
    text: vi.fn().mockResolvedValue(body),
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
    it("is true when a slack webhook is configured", () => {
      const config: NotificationConfig = { emailFrom: "a@b.com", slackWebhookUrl: "https://hooks/x" };
      const svc = new NotificationService(config, makeMockLogger() as unknown as Logger);
      expect(svc.isConfigured()).toBe(true);
    });

    it("is true when emailTo and resendApiKey are both configured", () => {
      const config: NotificationConfig = {
        emailFrom: "a@b.com",
        emailTo: "human@b.com",
        resendApiKey: "re_123",
      };
      const svc = new NotificationService(config, makeMockLogger() as unknown as Logger);
      expect(svc.isConfigured()).toBe(true);
    });

    it("is false when emailTo is set but resendApiKey is missing", () => {
      const config: NotificationConfig = { emailFrom: "a@b.com", emailTo: "human@b.com" };
      const svc = new NotificationService(config, makeMockLogger() as unknown as Logger);
      expect(svc.isConfigured()).toBe(false);
    });

    it("is false when nothing is configured", () => {
      const config: NotificationConfig = { emailFrom: "a@b.com" };
      const svc = new NotificationService(config, makeMockLogger() as unknown as Logger);
      expect(svc.isConfigured()).toBe(false);
    });
  });

  describe("sendHumanRequest with no channels configured", () => {
    it("attempts nothing and makes no network calls", async () => {
      const svc = new NotificationService(
        { emailFrom: "a@b.com" },
        makeMockLogger() as unknown as Logger,
      );
      const result = await svc.sendHumanRequest(makePayload());
      expect(result).toEqual({
        slack: { attempted: false, ok: false },
        email: { attempted: false, ok: false },
      });
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe("Slack notification", () => {
    const config: NotificationConfig = {
      emailFrom: "a@b.com",
      slackWebhookUrl: "https://hooks.slack.com/services/XXX",
    };

    it("posts the exact rendered payload to the webhook and marks ok on 2xx", async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse(true));
      const logger = makeMockLogger();
      const svc = new NotificationService(config, logger as unknown as Logger);

      const payload = makePayload({
        planConfidence: 0.42,
        openQuestions: [
          { id: "q1", question: "Which endpoint should this call?", requiredForExecution: true },
          { id: "q2", question: "Is caching required?", requiredForExecution: false },
        ],
        context: "some context",
      });

      const result = await svc.sendHumanRequest(payload);

      expect(result.slack).toEqual({ attempted: true, ok: true });
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe("https://hooks.slack.com/services/XXX");
      expect(init.method).toBe("POST");
      expect(init.headers).toEqual({ "Content-Type": "application/json" });

      const body = JSON.parse(init.body as string) as { text: string; blocks: unknown[] };
      expect(body.text).toBe(
        "Plan needs review (ambiguous) — ENG-42: Fix the widget",
      );
      expect(body.blocks).toEqual([
        { type: "header", text: { type: "plain_text", text: body.text } },
        { type: "section", text: { type: "mrkdwn", text: payload.summary } },
        {
          type: "section",
          fields: [
            { type: "mrkdwn", text: "*State:*\nPlanReview" },
            { type: "mrkdwn", text: "*Plan confidence:*\n0.42" },
            { type: "mrkdwn", text: "*Open questions:*\n2 (1 required)" },
          ],
        },
        {
          type: "section",
          text: { type: "mrkdwn", text: "*Context:*\nsome context" },
        },
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text:
              "*Questions:*\n• [required] Which endpoint should this call?\n• Is caching required?",
          },
        },
        {
          type: "actions",
          elements: [
            { type: "button", text: { type: "plain_text", text: "Open run" }, url: payload.runUrl },
            {
              type: "button",
              text: { type: "plain_text", text: "Open Linear issue" },
              url: payload.linearIssue.url,
            },
          ],
        },
      ]);
      expect(logger.warn).not.toHaveBeenCalled();
    });

    it("falls back to the raw linearIssue.id when identifier is missing, and '(untitled)' when title is null", async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse(true));
      const svc = new NotificationService(config, makeMockLogger() as unknown as Logger);
      const payload = makePayload({
        linearIssue: { id: "raw-id-9", title: null, url: null },
      });

      await svc.sendHumanRequest(payload);

      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(init.body as string) as { text: string; blocks: unknown[] };
      expect(body.text).toBe("Plan needs review (ambiguous) — raw-id-9: (untitled)");
      // No Linear issue url -> only the "Open run" action button.
      expect(body.blocks[body.blocks.length - 1]).toEqual({
        type: "actions",
        elements: [
          { type: "button", text: { type: "plain_text", text: "Open run" }, url: payload.runUrl },
        ],
      });
    });

    it("omits confidence, questions, and context blocks when not provided", async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse(true));
      const svc = new NotificationService(config, makeMockLogger() as unknown as Logger);
      await svc.sendHumanRequest(makePayload());

      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(init.body as string) as { blocks: { type: string; fields?: unknown[] }[] };
      const fieldsBlock = body.blocks.find((b) => b.fields) as { fields: unknown[] };
      expect(fieldsBlock.fields).toHaveLength(1); // only "State"
      // Only header, summary, fields, actions - no context/questions blocks.
      expect(body.blocks.map((b) => b.type)).toEqual(["header", "section", "section", "actions"]);
    });

    it("truncates long context to 1500 chars with an ellipsis", async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse(true));
      const svc = new NotificationService(config, makeMockLogger() as unknown as Logger);
      const longContext = "x".repeat(2000);
      await svc.sendHumanRequest(makePayload({ context: longContext }));

      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(init.body as string) as { blocks: { text?: { text: string } }[] };
      const contextBlock = body.blocks.find((b) => b.text?.text.startsWith("*Context:*"));
      const rendered = contextBlock!.text!.text.replace("*Context:*\n", "");
      expect(rendered).toHaveLength(1500);
      expect(rendered.endsWith("…")).toBe(true);
      expect(rendered.slice(0, 1499)).toBe("x".repeat(1499));
    });

    it("limits questions to the first 3 and truncates each to 200 chars", async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse(true));
      const svc = new NotificationService(config, makeMockLogger() as unknown as Logger);
      const openQuestions = [
        { id: "q1", question: "q1", requiredForExecution: false },
        { id: "q2", question: "q2", requiredForExecution: false },
        { id: "q3", question: "q3", requiredForExecution: false },
        { id: "q4", question: "q4", requiredForExecution: false },
      ];
      await svc.sendHumanRequest(makePayload({ openQuestions }));

      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(init.body as string) as { blocks: { text?: { text: string } }[] };
      const questionsBlock = body.blocks.find((b) => b.text?.text.startsWith("*Questions:*"));
      const lines = questionsBlock!.text!.text.split("\n").slice(1);
      expect(lines).toEqual(["• q1", "• q2", "• q3"]);
    });

    it.each<[HumanRequestReason, string]>([
      ["plan_ambiguous", "Plan needs review (ambiguous)"],
      ["plan_low_confidence", "Plan needs review (low confidence)"],
      ["impl_rejected", "Implementation needs review (rejected by agent)"],
      ["impl_uncertain", "Implementation needs review (uncertain)"],
      ["other", "Human intervention requested"],
    ])("renders the reason label for %s", async (reason, label) => {
      fetchMock.mockResolvedValueOnce(jsonResponse(true));
      const svc = new NotificationService(config, makeMockLogger() as unknown as Logger);
      await svc.sendHumanRequest(makePayload({ reason }));

      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(init.body as string) as { text: string };
      expect(body.text.startsWith(label)).toBe(true);
    });

    it("records ok=false and logs a warning with status and truncated body when the webhook returns non-2xx", async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse(false, 500, "a".repeat(300)));
      const logger = makeMockLogger();
      const svc = new NotificationService(config, logger as unknown as Logger);

      const result = await svc.sendHumanRequest(makePayload());

      expect(result.slack.ok).toBe(false);
      expect(result.slack.attempted).toBe(true);
      expect(result.slack.error).toBe(
        `Slack webhook returned 500: ${"a".repeat(200)}`,
      );
      expect(logger.warn).toHaveBeenCalledWith(
        { runId: "run-1", error: result.slack.error },
        "Slack notification failed",
      );
    });

    it("handles a body read failure on error response by using an empty body", async () => {
      fetchMock.mockResolvedValueOnce({
        ok: false,
        status: 502,
        text: vi.fn().mockRejectedValue(new Error("stream closed")),
      });
      const svc = new NotificationService(config, makeMockLogger() as unknown as Logger);

      const result = await svc.sendHumanRequest(makePayload());
      expect(result.slack.error).toBe("Slack webhook returned 502: ");
    });

    it("records ok=false and logs the error message when fetch throws", async () => {
      fetchMock.mockRejectedValueOnce(new Error("network unreachable"));
      const logger = makeMockLogger();
      const svc = new NotificationService(config, logger as unknown as Logger);

      const result = await svc.sendHumanRequest(makePayload());

      expect(result.slack).toEqual({ attempted: true, ok: false, error: "network unreachable" });
      expect(logger.warn).toHaveBeenCalledWith(
        { runId: "run-1", error: "network unreachable" },
        "Slack notification failed",
      );
    });

    it("stringifies a non-Error throw", async () => {
      fetchMock.mockRejectedValueOnce("plain string failure");
      const svc = new NotificationService(config, makeMockLogger() as unknown as Logger);

      const result = await svc.sendHumanRequest(makePayload());
      expect(result.slack.error).toBe("plain string failure");
    });
  });

  describe("Email notification", () => {
    const config: NotificationConfig = {
      emailFrom: "AgentForge <bot@agentforge.dev>",
      emailTo: " human1@b.com , human2@b.com ,,",
      resendApiKey: "re_secret",
    };

    it("posts to the Resend API with parsed recipients, subject, html, and text", async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse(true));
      const svc = new NotificationService(config, makeMockLogger() as unknown as Logger);
      const payload = makePayload({
        planConfidence: 0.75,
        context: "some <context>",
        openQuestions: [{ id: "q1", question: "ok?", requiredForExecution: true }],
      });

      const result = await svc.sendHumanRequest(payload);

      expect(result.email).toEqual({ attempted: true, ok: true });
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe("https://api.resend.com/emails");
      expect(init.method).toBe("POST");
      expect(init.headers).toEqual({
        Authorization: "Bearer re_secret",
        "Content-Type": "application/json",
      });

      const body = JSON.parse(init.body as string) as {
        from: string;
        to: string[];
        subject: string;
        html: string;
        text: string;
      };
      expect(body.from).toBe("AgentForge <bot@agentforge.dev>");
      expect(body.to).toEqual(["human1@b.com", "human2@b.com"]);
      expect(body.subject).toBe(
        "[AgentForge] Plan needs review (ambiguous) — ENG-42: Fix the widget",
      );
      expect(body.html).toContain("<h2 style=\"margin-top:0;\">Plan needs review (ambiguous)</h2>");
      expect(body.html).toContain("<strong>ENG-42:</strong> Fix the widget");
      expect(body.html).toContain("<strong>Plan confidence:</strong> 0.75");
      expect(body.html).toContain("some &lt;context&gt;");
      expect(body.html).toContain("<strong>[required]</strong> ok?");
      expect(body.html).toContain(`href="${payload.runUrl}"`);
      expect(body.html).toContain(`href="${payload.linearIssue.url}"`);

      expect(body.text).toBe(
        [
          "Plan needs review (ambiguous)",
          "ENG-42: Fix the widget",
          "State: PlanReview",
          "Plan confidence: 0.75",
          "",
          payload.summary,
          "",
          "Context:",
          "some <context>",
          "",
          "Open questions:",
          "- [required] ok?",
          "",
          `Run: ${payload.runUrl}`,
          `Linear: ${payload.linearIssue.url}`,
        ].join("\n"),
      );
    });

    it("escapes HTML special characters in title, summary and questions", async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse(true));
      const svc = new NotificationService(config, makeMockLogger() as unknown as Logger);
      await svc.sendHumanRequest(
        makePayload({
          summary: `<script>alert("x")</script> & 'quotes'`,
          linearIssue: { id: "i1", identifier: "E-1", title: `<b>bold</b> & "title"`, url: null },
        }),
      );

      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(init.body as string) as { html: string };
      expect(body.html).toContain("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; &#39;quotes&#39;");
      expect(body.html).toContain("&lt;b&gt;bold&lt;/b&gt; &amp; &quot;title&quot;");
      // No Linear issue link rendered when url is null.
      expect(body.html).not.toContain("Open Linear issue");
    });

    it("omits confidence/context/questions sections in html and text when absent", async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse(true));
      const svc = new NotificationService(config, makeMockLogger() as unknown as Logger);
      await svc.sendHumanRequest(makePayload());

      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(init.body as string) as { html: string; text: string };
      expect(body.html).not.toContain("Plan confidence");
      expect(body.html).not.toContain("Context:");
      expect(body.html).not.toContain("Open questions");
      expect(body.text).not.toContain("Plan confidence");
      expect(body.text).not.toContain("Context:");
      expect(body.text).not.toContain("Open questions");
    });

    it("limits html questions to 5 and truncates context to 2000 chars", async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse(true));
      const svc = new NotificationService(config, makeMockLogger() as unknown as Logger);
      const openQuestions = Array.from({ length: 7 }, (_, i) => ({
        id: `q${i}`,
        question: `question ${i}`,
        requiredForExecution: false,
      }));
      await svc.sendHumanRequest(
        makePayload({ openQuestions, context: "y".repeat(3000) }),
      );

      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(init.body as string) as { html: string; text: string };
      const liMatches = body.html.match(/<li>/g) ?? [];
      expect(liMatches).toHaveLength(5);
      expect(body.html).not.toContain("question 5");
      const textLines = body.text.match(/^- question \d+$/gm) ?? [];
      expect(textLines).toHaveLength(5);

      const truncatedMatch = body.html.match(/y{1999}…/);
      expect(truncatedMatch).not.toBeNull();
    });

    it("records ok=false and logs a warning when Resend returns non-2xx", async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse(false, 422, "invalid recipient"));
      const logger = makeMockLogger();
      const svc = new NotificationService(config, logger as unknown as Logger);

      const result = await svc.sendHumanRequest(makePayload());

      expect(result.email.ok).toBe(false);
      expect(result.email.error).toBe("Resend returned 422: invalid recipient");
      expect(logger.warn).toHaveBeenCalledWith(
        { runId: "run-1", error: result.email.error },
        "Email notification failed",
      );
    });

    it("records ok=false when the Resend call throws", async () => {
      fetchMock.mockRejectedValueOnce(new Error("dns failure"));
      const svc = new NotificationService(config, makeMockLogger() as unknown as Logger);

      const result = await svc.sendHumanRequest(makePayload());
      expect(result.email).toEqual({ attempted: true, ok: false, error: "dns failure" });
    });

    it("stringifies a non-Error throw from the Resend call", async () => {
      fetchMock.mockRejectedValueOnce("resend outage");
      const svc = new NotificationService(config, makeMockLogger() as unknown as Logger);

      const result = await svc.sendHumanRequest(makePayload());
      expect(result.email.error).toBe("resend outage");
    });

    it("falls back to the raw linearIssue.id and '(untitled)' in the subject, html, and text when identifier/title are missing", async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse(true));
      const svc = new NotificationService(config, makeMockLogger() as unknown as Logger);
      const payload = makePayload({
        linearIssue: { id: "raw-id-77", title: null, url: null },
      });

      await svc.sendHumanRequest(payload);

      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(init.body as string) as { subject: string; html: string; text: string };
      expect(body.subject).toBe("[AgentForge] Plan needs review (ambiguous) — raw-id-77: (untitled)");
      expect(body.html).toContain("<strong>raw-id-77:</strong> (untitled)");
      expect(body.text).toContain("raw-id-77: (untitled)");
    });
  });

  describe("both channels configured", () => {
    it("attempts both, running independently on mixed success/failure", async () => {
      const config: NotificationConfig = {
        emailFrom: "a@b.com",
        emailTo: "human@b.com",
        resendApiKey: "re_123",
        slackWebhookUrl: "https://hooks.slack.com/services/XXX",
      };
      // Order of calls: slack pushed first, then email (per source order).
      fetchMock
        .mockResolvedValueOnce(jsonResponse(true)) // slack ok
        .mockResolvedValueOnce(jsonResponse(false, 500, "boom")); // email fails
      const logger = makeMockLogger();
      const svc = new NotificationService(config, logger as unknown as Logger);

      const result = await svc.sendHumanRequest(makePayload());

      expect(result.slack).toEqual({ attempted: true, ok: true });
      expect(result.email).toEqual({
        attempted: true,
        ok: false,
        error: "Resend returned 500: boom",
      });
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(logger.warn).toHaveBeenCalledTimes(1);
    });
  });
});
