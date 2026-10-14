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
    summary: "The plan needs a human look.",
    linearIssue: {
      id: "lin-1",
      identifier: "ENG-7",
      title: "Add retries",
      url: "https://linear.app/team/issue/ENG-7",
    },
    runState: "AwaitingPlanApproval",
    runUrl: "https://dashboard.example.com/runs/run-1",
    ...overrides,
  };
}

function okResponse(): Response {
  return { ok: true, status: 200, text: async () => "" } as unknown as Response;
}

function failResponse(status: number, body: string): Response {
  return { ok: false, status, text: async () => body } as unknown as Response;
}

describe("NotificationService.isConfigured", () => {
  it("is false when nothing is configured", () => {
    const svc = new NotificationService({ emailFrom: "bot@example.com" }, makeLogger() as never);
    expect(svc.isConfigured()).toBe(false);
  });

  it("is true when a slack webhook url is set", () => {
    const svc = new NotificationService(
      { emailFrom: "bot@example.com", slackWebhookUrl: "https://hooks.slack.com/x" },
      makeLogger() as never,
    );
    expect(svc.isConfigured()).toBe(true);
  });

  it("is true when emailTo and resendApiKey are both set", () => {
    const svc = new NotificationService(
      { emailFrom: "bot@example.com", emailTo: "a@b.com", resendApiKey: "key" },
      makeLogger() as never,
    );
    expect(svc.isConfigured()).toBe(true);
  });

  it("is false when only emailTo is set without an api key", () => {
    const svc = new NotificationService(
      { emailFrom: "bot@example.com", emailTo: "a@b.com" },
      makeLogger() as never,
    );
    expect(svc.isConfigured()).toBe(false);
  });

  it("is false when only resendApiKey is set without a recipient", () => {
    const svc = new NotificationService(
      { emailFrom: "bot@example.com", resendApiKey: "key" },
      makeLogger() as never,
    );
    expect(svc.isConfigured()).toBe(false);
  });
});

describe("NotificationService.sendHumanRequest", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let logger: ReturnType<typeof makeLogger>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    logger = makeLogger();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("attempts neither channel and makes no network calls when nothing is configured", async () => {
    const config: NotificationConfig = { emailFrom: "bot@example.com" };
    const svc = new NotificationService(config, logger as never);

    const result = await svc.sendHumanRequest(makePayload());

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result).toEqual({
      slack: { attempted: false, ok: false },
      email: { attempted: false, ok: false },
    });
  });

  it("renders the impl_uncertain reason label", async () => {
    fetchMock.mockResolvedValue(okResponse());
    const config: NotificationConfig = {
      emailFrom: "bot@example.com",
      slackWebhookUrl: "https://hooks.slack.com/services/x",
    };
    const svc = new NotificationService(config, logger as never);

    await svc.sendHumanRequest(makePayload({ reason: "impl_uncertain" }));

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string) as { text: string };
    expect(body.text).toBe("Implementation needs review (uncertain) — ENG-7: Add retries");
  });

  describe("slack channel", () => {
    it("posts the exact Slack block payload for a fully-populated notification", async () => {
      fetchMock.mockResolvedValue(okResponse());
      const config: NotificationConfig = {
        emailFrom: "bot@example.com",
        slackWebhookUrl: "https://hooks.slack.com/services/x",
      };
      const svc = new NotificationService(config, logger as never);

      const payload = makePayload({
        reason: "plan_low_confidence",
        planConfidence: 0.42,
        context: "Some helpful context for the reviewer.",
        openQuestions: [
          { id: "q1", question: "Question one", requiredForExecution: true },
          { id: "q2", question: "Question two", requiredForExecution: false },
          { id: "q3", question: "Question three", requiredForExecution: true },
          { id: "q4", question: "Question four (not shown)", requiredForExecution: false },
        ],
      });

      const result = await svc.sendHumanRequest(payload);

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe("https://hooks.slack.com/services/x");
      expect(init.method).toBe("POST");
      expect(init.headers).toEqual({ "Content-Type": "application/json" });

      const body = JSON.parse(init.body as string) as { text: string; blocks: unknown[] };
      const expectedTitle = "Plan needs review (low confidence) — ENG-7: Add retries";
      expect(body.text).toBe(expectedTitle);
      expect(body.blocks).toEqual([
        { type: "header", text: { type: "plain_text", text: expectedTitle } },
        { type: "section", text: { type: "mrkdwn", text: "The plan needs a human look." } },
        {
          type: "section",
          fields: [
            { type: "mrkdwn", text: "*State:*\nAwaitingPlanApproval" },
            { type: "mrkdwn", text: "*Plan confidence:*\n0.42" },
            { type: "mrkdwn", text: "*Open questions:*\n4 (2 required)" },
          ],
        },
        {
          type: "section",
          text: { type: "mrkdwn", text: "*Context:*\nSome helpful context for the reviewer." },
        },
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: "*Questions:*\n• [required] Question one\n• Question two\n• [required] Question three",
          },
        },
        {
          type: "actions",
          elements: [
            {
              type: "button",
              text: { type: "plain_text", text: "Open run" },
              url: "https://dashboard.example.com/runs/run-1",
            },
            {
              type: "button",
              text: { type: "plain_text", text: "Open Linear issue" },
              url: "https://linear.app/team/issue/ENG-7",
            },
          ],
        },
      ]);

      expect(result.slack).toEqual({ attempted: true, ok: true });
      expect(result.email).toEqual({ attempted: false, ok: false });
    });

    it("omits confidence, questions, context blocks and the Linear button when absent", async () => {
      fetchMock.mockResolvedValue(okResponse());
      const config: NotificationConfig = {
        emailFrom: "bot@example.com",
        slackWebhookUrl: "https://hooks.slack.com/services/x",
      };
      const svc = new NotificationService(config, logger as never);

      const payload = makePayload({
        reason: "other",
        linearIssue: { id: "lin-2", title: null, url: null },
      });

      await svc.sendHumanRequest(payload);

      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(init.body as string) as { text: string; blocks: unknown[] };

      expect(body.text).toBe("Human intervention requested — lin-2: (untitled)");
      expect(body.blocks).toHaveLength(4);
      expect(body.blocks[2]).toEqual({
        type: "section",
        fields: [{ type: "mrkdwn", text: "*State:*\nAwaitingPlanApproval" }],
      });
      expect(body.blocks[3]).toEqual({
        type: "actions",
        elements: [
          {
            type: "button",
            text: { type: "plain_text", text: "Open run" },
            url: "https://dashboard.example.com/runs/run-1",
          },
        ],
      });
    });

    it("truncates long context to 1500 characters with an ellipsis", async () => {
      fetchMock.mockResolvedValue(okResponse());
      const config: NotificationConfig = {
        emailFrom: "bot@example.com",
        slackWebhookUrl: "https://hooks.slack.com/services/x",
      };
      const svc = new NotificationService(config, logger as never);

      const longContext = "a".repeat(1600);
      await svc.sendHumanRequest(makePayload({ context: longContext }));

      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(init.body as string) as { blocks: { text?: { text: string } }[] };
      const contextBlock = body.blocks.find((b) => b.text?.text.startsWith("*Context:*"));
      expect(contextBlock).toBeDefined();
      const rendered = contextBlock!.text!.text.replace("*Context:*\n", "");
      expect(rendered).toHaveLength(1500);
      expect(rendered.endsWith("…")).toBe(true);
      expect(rendered.startsWith("a".repeat(1499))).toBe(true);
    });

    it("leaves short context untouched (no truncation at or under the limit)", async () => {
      fetchMock.mockResolvedValue(okResponse());
      const config: NotificationConfig = {
        emailFrom: "bot@example.com",
        slackWebhookUrl: "https://hooks.slack.com/services/x",
      };
      const svc = new NotificationService(config, logger as never);

      const exactContext = "b".repeat(1500);
      await svc.sendHumanRequest(makePayload({ context: exactContext }));

      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(init.body as string) as { blocks: { text?: { text: string } }[] };
      const contextBlock = body.blocks.find((b) => b.text?.text.startsWith("*Context:*"));
      expect(contextBlock!.text!.text).toBe(`*Context:*\n${exactContext}`);
    });

    it("records a delivery failure without throwing when Slack responds with a non-ok status", async () => {
      fetchMock.mockResolvedValue(failResponse(500, "server exploded"));
      const config: NotificationConfig = {
        emailFrom: "bot@example.com",
        slackWebhookUrl: "https://hooks.slack.com/services/x",
      };
      const svc = new NotificationService(config, logger as never);

      const result = await svc.sendHumanRequest(makePayload());

      expect(result.slack).toEqual({
        attempted: true,
        ok: false,
        error: "Slack webhook returned 500: server exploded",
      });
      expect(logger.warn).toHaveBeenCalledWith(
        { runId: "run-1", error: "Slack webhook returned 500: server exploded" },
        "Slack notification failed",
      );
    });

    it("records a delivery failure without throwing when fetch itself rejects", async () => {
      fetchMock.mockRejectedValue(new Error("network unreachable"));
      const config: NotificationConfig = {
        emailFrom: "bot@example.com",
        slackWebhookUrl: "https://hooks.slack.com/services/x",
      };
      const svc = new NotificationService(config, logger as never);

      const result = await expect(svc.sendHumanRequest(makePayload())).resolves.toEqual(
        expect.objectContaining({
          slack: { attempted: true, ok: false, error: "network unreachable" },
        }),
      );
      void result;
      expect(logger.warn).toHaveBeenCalledWith(
        { runId: "run-1", error: "network unreachable" },
        "Slack notification failed",
      );
    });

    it("stringifies a non-Error value thrown by fetch", async () => {
      fetchMock.mockRejectedValue("connection reset");
      const config: NotificationConfig = {
        emailFrom: "bot@example.com",
        slackWebhookUrl: "https://hooks.slack.com/services/x",
      };
      const svc = new NotificationService(config, logger as never);

      const result = await svc.sendHumanRequest(makePayload());

      expect(result.slack).toEqual({
        attempted: true,
        ok: false,
        error: "connection reset",
      });
      expect(logger.warn).toHaveBeenCalledWith(
        { runId: "run-1", error: "connection reset" },
        "Slack notification failed",
      );
    });
  });

  describe("email channel", () => {
    function emailConfig(overrides: Partial<NotificationConfig> = {}): NotificationConfig {
      return {
        emailFrom: "bot@example.com",
        emailTo: "a@example.com, b@example.com",
        resendApiKey: "re_test_key",
        ...overrides,
      };
    }

    it("posts to the Resend API with auth header, trimmed/split recipients, subject, html and text", async () => {
      fetchMock.mockResolvedValue(okResponse());
      const svc = new NotificationService(emailConfig(), logger as never);

      const payload = makePayload({
        reason: "impl_rejected",
        planConfidence: 0.6,
        context: "Context body",
        openQuestions: [
          { id: "q1", question: "Why?", requiredForExecution: true },
          { id: "q2", question: "What about rollback?", requiredForExecution: false },
        ],
      });

      const result = await svc.sendHumanRequest(payload);

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe("https://api.resend.com/emails");
      expect(init.method).toBe("POST");
      expect(init.headers).toEqual({
        Authorization: "Bearer re_test_key",
        "Content-Type": "application/json",
      });

      const body = JSON.parse(init.body as string) as {
        from: string;
        to: string[];
        subject: string;
        html: string;
        text: string;
      };

      expect(body.from).toBe("bot@example.com");
      expect(body.to).toEqual(["a@example.com", "b@example.com"]);
      expect(body.subject).toBe(
        "[AgentForge] Implementation needs review (rejected by agent) — ENG-7: Add retries",
      );

      expect(body.text).toBe(
        [
          "Implementation needs review (rejected by agent)",
          "ENG-7: Add retries",
          "State: AwaitingPlanApproval",
          "Plan confidence: 0.60",
          "",
          "The plan needs a human look.",
          "",
          "Context:",
          "Context body",
          "",
          "Open questions:",
          "- [required] Why?",
          "- What about rollback?",
          "",
          "Run: https://dashboard.example.com/runs/run-1",
          "Linear: https://linear.app/team/issue/ENG-7",
        ].join("\n"),
      );

      expect(body.html).toContain("<h2 style=\"margin-top:0;\">Implementation needs review (rejected by agent)</h2>");
      expect(body.html).toContain("<strong>ENG-7:</strong> Add retries");
      expect(body.html).toContain("<strong>Plan confidence:</strong> 0.60");
      expect(body.html).toContain("Context body");
      expect(body.html).toContain("<strong>[required]</strong> Why?");
      expect(body.html).toContain("<li>What about rollback?</li>");
      expect(body.html).toContain('href="https://dashboard.example.com/runs/run-1"');
      expect(body.html).toContain('href="https://linear.app/team/issue/ENG-7"');

      expect(result.email).toEqual({ attempted: true, ok: true });
      expect(result.slack).toEqual({ attempted: false, ok: false });
    });

    it("drops blank entries when splitting multiple comma-separated recipients", async () => {
      fetchMock.mockResolvedValue(okResponse());
      const svc = new NotificationService(
        emailConfig({ emailTo: "a@example.com, , b@example.com ," }),
        logger as never,
      );

      await svc.sendHumanRequest(makePayload());

      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(init.body as string) as { to: string[] };
      expect(body.to).toEqual(["a@example.com", "b@example.com"]);
    });

    it("escapes HTML special characters in user-provided content", async () => {
      fetchMock.mockResolvedValue(okResponse());
      const svc = new NotificationService(emailConfig(), logger as never);

      const payload = makePayload({
        summary: "Needs <review> & \"approval\"",
        linearIssue: { id: "lin-3", identifier: "ENG-9", title: "A <script>alert(1)</script> title", url: null },
      });

      await svc.sendHumanRequest(payload);

      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(init.body as string) as { html: string };

      expect(body.html).toContain("Needs &lt;review&gt; &amp; &quot;approval&quot;");
      expect(body.html).toContain("A &lt;script&gt;alert(1)&lt;/script&gt; title");
      expect(body.html).not.toContain("<script>alert(1)</script>");
    });

    it("falls back to (untitled) in both html and text when the issue has no title", async () => {
      fetchMock.mockResolvedValue(okResponse());
      const svc = new NotificationService(emailConfig(), logger as never);

      await svc.sendHumanRequest(
        makePayload({ linearIssue: { id: "lin-5", identifier: "ENG-5", title: null, url: null } }),
      );

      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(init.body as string) as { html: string; text: string };
      expect(body.html).toContain("<strong>ENG-5:</strong> (untitled)");
      expect(body.text).toContain("ENG-5: (untitled)");
    });

    it("omits the Linear link and open-questions block from the html when absent", async () => {
      fetchMock.mockResolvedValue(okResponse());
      const svc = new NotificationService(emailConfig(), logger as never);

      await svc.sendHumanRequest(
        makePayload({ linearIssue: { id: "lin-4", title: "No link issue", url: null } }),
      );

      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(init.body as string) as { html: string };
      expect(body.html).not.toContain("Open Linear issue");
      expect(body.html).not.toContain("Open questions");
    });

    it("truncates long context to 2000 characters with an ellipsis in both html and text", async () => {
      fetchMock.mockResolvedValue(okResponse());
      const svc = new NotificationService(emailConfig(), logger as never);

      const longContext = "c".repeat(2200);
      await svc.sendHumanRequest(makePayload({ context: longContext }));

      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(init.body as string) as { html: string; text: string };

      expect(body.text).toContain(`${"c".repeat(1999)}…`);
      expect(body.text).not.toContain("c".repeat(2001));
      expect(body.html).toContain(`${"c".repeat(1999)}…`);
    });

    it("records a delivery failure without throwing when Resend responds with a non-ok status", async () => {
      fetchMock.mockResolvedValue(failResponse(422, "invalid recipient"));
      const svc = new NotificationService(emailConfig(), logger as never);

      const result = await svc.sendHumanRequest(makePayload());

      expect(result.email).toEqual({
        attempted: true,
        ok: false,
        error: "Resend returned 422: invalid recipient",
      });
      expect(logger.warn).toHaveBeenCalledWith(
        { runId: "run-1", error: "Resend returned 422: invalid recipient" },
        "Email notification failed",
      );
    });

    it("records a delivery failure without throwing when fetch itself rejects", async () => {
      fetchMock.mockRejectedValue(new Error("DNS failure"));
      const svc = new NotificationService(emailConfig(), logger as never);

      const result = await svc.sendHumanRequest(makePayload());

      expect(result.email).toEqual({ attempted: true, ok: false, error: "DNS failure" });
    });

    it("stringifies a non-Error value thrown by fetch", async () => {
      fetchMock.mockRejectedValue("connection reset");
      const svc = new NotificationService(emailConfig(), logger as never);

      const result = await svc.sendHumanRequest(makePayload());

      expect(result.email).toEqual({ attempted: true, ok: false, error: "connection reset" });
      expect(logger.warn).toHaveBeenCalledWith(
        { runId: "run-1", error: "connection reset" },
        "Email notification failed",
      );
    });

    it("falls back to a generic error message when a non-Error value is thrown or returned by response.text()", async () => {
      fetchMock.mockResolvedValue({
        ok: false,
        status: 500,
        text: () => Promise.reject(new Error("text read failed")),
      } as unknown as Response);
      const svc = new NotificationService(emailConfig(), logger as never);

      const result = await svc.sendHumanRequest(makePayload());

      expect(result.email.ok).toBe(false);
      expect(result.email.error).toBe("Resend returned 500: ");
    });
  });

  describe("both channels configured", () => {
    it("attempts and delivers slack and email concurrently and independently", async () => {
      fetchMock.mockResolvedValue(okResponse());
      const config: NotificationConfig = {
        emailFrom: "bot@example.com",
        slackWebhookUrl: "https://hooks.slack.com/services/x",
        emailTo: "a@example.com",
        resendApiKey: "re_test_key",
      };
      const svc = new NotificationService(config, logger as never);

      const result = await svc.sendHumanRequest(makePayload());

      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(result).toEqual({
        slack: { attempted: true, ok: true },
        email: { attempted: true, ok: true },
      });
    });

    it("reports independent failures when slack fails but email succeeds", async () => {
      fetchMock.mockImplementation((url: string) => {
        if (url.includes("slack")) return Promise.resolve(failResponse(503, "unavailable"));
        return Promise.resolve(okResponse());
      });
      const config: NotificationConfig = {
        emailFrom: "bot@example.com",
        slackWebhookUrl: "https://hooks.slack.com/services/x",
        emailTo: "a@example.com",
        resendApiKey: "re_test_key",
      };
      const svc = new NotificationService(config, logger as never);

      const result = await svc.sendHumanRequest(makePayload());

      expect(result.slack).toEqual({
        attempted: true,
        ok: false,
        error: "Slack webhook returned 503: unavailable",
      });
      expect(result.email).toEqual({ attempted: true, ok: true });
    });
  });
});
