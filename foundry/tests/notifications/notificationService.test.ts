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
    debug: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
    child: vi.fn(),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

function makePayload(overrides: Partial<NotificationPayload> = {}): NotificationPayload {
  return {
    runId: "run-123",
    reason: "plan_ambiguous",
    summary: "The plan has ambiguous requirements.",
    linearIssue: {
      id: "lin-1",
      identifier: "ENG-42",
      title: "Fix the thing",
      url: "https://linear.app/team/issue/ENG-42",
    },
    runState: "awaiting_human",
    runUrl: "https://foundry.example.com/runs/run-123",
    ...overrides,
  };
}

describe("NotificationService.isConfigured", () => {
  const logger = makeLogger();

  it("returns true when a Slack webhook URL is set", () => {
    const svc = new NotificationService(
      { emailFrom: "a@b.com", slackWebhookUrl: "https://hooks.slack.com/x" },
      logger,
    );
    expect(svc.isConfigured()).toBe(true);
  });

  it("returns true when both emailTo and resendApiKey are set", () => {
    const svc = new NotificationService(
      { emailFrom: "a@b.com", emailTo: "to@b.com", resendApiKey: "key" },
      logger,
    );
    expect(svc.isConfigured()).toBe(true);
  });

  it("returns false when only emailTo is set without a resendApiKey", () => {
    const svc = new NotificationService({ emailFrom: "a@b.com", emailTo: "to@b.com" }, logger);
    expect(svc.isConfigured()).toBe(false);
  });

  it("returns false when only resendApiKey is set without emailTo", () => {
    const svc = new NotificationService({ emailFrom: "a@b.com", resendApiKey: "key" }, logger);
    expect(svc.isConfigured()).toBe(false);
  });

  it("returns false when nothing is configured", () => {
    const svc = new NotificationService({ emailFrom: "a@b.com" }, logger);
    expect(svc.isConfigured()).toBe(false);
  });
});

describe("NotificationService.sendHumanRequest", () => {
  let logger: ReturnType<typeof makeLogger>;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    logger = makeLogger();
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("attempts neither channel when nothing is configured", async () => {
    const svc = new NotificationService({ emailFrom: "a@b.com" }, logger);
    const result = await svc.sendHumanRequest(makePayload());

    expect(result).toEqual({
      slack: { attempted: false, ok: false },
      email: { attempted: false, ok: false },
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sends a Slack webhook and reports ok:true on a 2xx response", async () => {
    fetchMock.mockResolvedValue({ ok: true });
    const config: NotificationConfig = {
      emailFrom: "a@b.com",
      slackWebhookUrl: "https://hooks.slack.com/x",
    };
    const svc = new NotificationService(config, logger);

    const result = await svc.sendHumanRequest(makePayload());

    expect(result.slack).toEqual({ attempted: true, ok: true });
    expect(result.email).toEqual({ attempted: false, ok: false });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://hooks.slack.com/x");
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({ "Content-Type": "application/json" });

    const body = JSON.parse(init.body as string);
    expect(body.text).toContain("ENG-42");
    expect(body.text).toContain("Fix the thing");
    expect(body.blocks).toBeInstanceOf(Array);
    // header, summary section, fields section, actions
    const types = body.blocks.map((b: { type: string }) => b.type);
    expect(types).toContain("header");
    expect(types).toContain("actions");
  });

  it("records slack ok:false and logs a warning when the webhook returns a non-2xx status", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 500,
      text: () => Promise.resolve("internal error"),
    });
    const config: NotificationConfig = {
      emailFrom: "a@b.com",
      slackWebhookUrl: "https://hooks.slack.com/x",
    };
    const svc = new NotificationService(config, logger);

    const result = await svc.sendHumanRequest(makePayload());

    expect(result.slack.attempted).toBe(true);
    expect(result.slack.ok).toBe(false);
    expect(result.slack.error).toContain("Slack webhook returned 500");
    expect(result.slack.error).toContain("internal error");
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ runId: "run-123" }),
      "Slack notification failed",
    );
  });

  it("records slack ok:false when the webhook body is unreadable (fetch body.text() rejects)", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 503,
      text: () => Promise.reject(new Error("stream closed")),
    });
    const config: NotificationConfig = {
      emailFrom: "a@b.com",
      slackWebhookUrl: "https://hooks.slack.com/x",
    };
    const svc = new NotificationService(config, logger);

    const result = await svc.sendHumanRequest(makePayload());
    expect(result.slack.ok).toBe(false);
    expect(result.slack.error).toContain("Slack webhook returned 503");
  });

  it("records slack ok:false and a message when fetch itself rejects (network error)", async () => {
    fetchMock.mockRejectedValue(new Error("ECONNREFUSED"));
    const config: NotificationConfig = {
      emailFrom: "a@b.com",
      slackWebhookUrl: "https://hooks.slack.com/x",
    };
    const svc = new NotificationService(config, logger);

    const result = await svc.sendHumanRequest(makePayload());
    expect(result.slack.ok).toBe(false);
    expect(result.slack.error).toBe("ECONNREFUSED");
  });

  it("stringifies a non-Error rejection reason", async () => {
    fetchMock.mockRejectedValue("some string failure");
    const config: NotificationConfig = {
      emailFrom: "a@b.com",
      slackWebhookUrl: "https://hooks.slack.com/x",
    };
    const svc = new NotificationService(config, logger);

    const result = await svc.sendHumanRequest(makePayload());
    expect(result.slack.error).toBe("some string failure");
  });

  it("sends an email via Resend and reports ok:true on a 2xx response", async () => {
    fetchMock.mockResolvedValue({ ok: true });
    const config: NotificationConfig = {
      emailFrom: "AgentForge <noreply@example.com>",
      emailTo: "human@example.com, second@example.com",
      resendApiKey: "re_test_key",
    };
    const svc = new NotificationService(config, logger);

    const result = await svc.sendHumanRequest(makePayload());

    expect(result.email).toEqual({ attempted: true, ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://api.resend.com/emails");
    expect(init.headers.Authorization).toBe("Bearer re_test_key");
    expect(init.headers["Content-Type"]).toBe("application/json");

    const body = JSON.parse(init.body as string);
    expect(body.from).toBe("AgentForge <noreply@example.com>");
    expect(body.to).toEqual(["human@example.com", "second@example.com"]);
    expect(body.subject).toContain("ENG-42");
    expect(body.html).toContain("Fix the thing");
    expect(body.text).toContain("Fix the thing");
  });

  it("trims and filters blank entries when splitting a comma-separated recipient list", async () => {
    fetchMock.mockResolvedValue({ ok: true });
    const config: NotificationConfig = {
      emailFrom: "a@b.com",
      emailTo: " one@example.com ,, two@example.com ,",
      resendApiKey: "key",
    };
    const svc = new NotificationService(config, logger);

    await svc.sendHumanRequest(makePayload());

    const [, init] = fetchMock.mock.calls[0]!;
    const body = JSON.parse(init.body as string);
    expect(body.to).toEqual(["one@example.com", "two@example.com"]);
  });

  it("records email ok:false and logs a warning when Resend returns a non-2xx status", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 422,
      text: () => Promise.resolve("invalid from address"),
    });
    const config: NotificationConfig = {
      emailFrom: "a@b.com",
      emailTo: "to@b.com",
      resendApiKey: "key",
    };
    const svc = new NotificationService(config, logger);

    const result = await svc.sendHumanRequest(makePayload());

    expect(result.email.ok).toBe(false);
    expect(result.email.error).toContain("Resend returned 422");
    expect(result.email.error).toContain("invalid from address");
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ runId: "run-123" }),
      "Email notification failed",
    );
  });

  it("sends both channels concurrently when both are configured", async () => {
    fetchMock.mockResolvedValue({ ok: true });
    const config: NotificationConfig = {
      emailFrom: "a@b.com",
      emailTo: "to@b.com",
      resendApiKey: "key",
      slackWebhookUrl: "https://hooks.slack.com/x",
    };
    const svc = new NotificationService(config, logger);

    const result = await svc.sendHumanRequest(makePayload());

    expect(result.slack).toEqual({ attempted: true, ok: true });
    expect(result.email).toEqual({ attempted: true, ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("one channel failing does not prevent the other from succeeding", async () => {
    fetchMock.mockImplementation((url: string) => {
      if (url.includes("resend.com")) {
        return Promise.resolve({ ok: false, status: 500, text: () => Promise.resolve("boom") });
      }
      return Promise.resolve({ ok: true });
    });
    const config: NotificationConfig = {
      emailFrom: "a@b.com",
      emailTo: "to@b.com",
      resendApiKey: "key",
      slackWebhookUrl: "https://hooks.slack.com/x",
    };
    const svc = new NotificationService(config, logger);

    const result = await svc.sendHumanRequest(makePayload());

    expect(result.slack.ok).toBe(true);
    expect(result.email.ok).toBe(false);
  });

  describe("payload rendering branches", () => {
    it("includes the plan confidence field when provided", async () => {
      fetchMock.mockResolvedValue({ ok: true });
      const svc = new NotificationService(
        { emailFrom: "a@b.com", slackWebhookUrl: "https://hooks.slack.com/x" },
        logger,
      );
      await svc.sendHumanRequest(makePayload({ planConfidence: 0.42 }));

      const [, init] = fetchMock.mock.calls[0]!;
      const body = JSON.parse(init.body as string);
      const fieldsBlock = body.blocks.find((b: { type: string }) => b.type === "section" && b.fields);
      const text = fieldsBlock.fields.map((f: { text: string }) => f.text).join("\n");
      expect(text).toContain("Plan confidence:");
      expect(text).toContain("0.42");
    });

    it("omits the plan confidence field when not provided", async () => {
      fetchMock.mockResolvedValue({ ok: true });
      const svc = new NotificationService(
        { emailFrom: "a@b.com", slackWebhookUrl: "https://hooks.slack.com/x" },
        logger,
      );
      await svc.sendHumanRequest(makePayload());

      const [, init] = fetchMock.mock.calls[0]!;
      const body = JSON.parse(init.body as string);
      const fieldsBlock = body.blocks.find((b: { type: string }) => b.type === "section" && b.fields);
      const text = fieldsBlock.fields.map((f: { text: string }) => f.text).join("\n");
      expect(text).not.toContain("Plan confidence");
    });

    it("includes an open-questions summary field and counts required ones", async () => {
      fetchMock.mockResolvedValue({ ok: true });
      const svc = new NotificationService(
        { emailFrom: "a@b.com", slackWebhookUrl: "https://hooks.slack.com/x" },
        logger,
      );
      await svc.sendHumanRequest(
        makePayload({
          openQuestions: [
            { id: "q1", question: "Should we strip unknown fields?", requiredForExecution: true },
            { id: "q2", question: "Do we need rate limiting first?", requiredForExecution: false },
          ],
        }),
      );

      const [, init] = fetchMock.mock.calls[0]!;
      const body = JSON.parse(init.body as string);
      const fieldsBlock = body.blocks.find((b: { type: string }) => b.type === "section" && b.fields);
      const summaryText = fieldsBlock.fields.map((f: { text: string }) => f.text).join("\n");
      expect(summaryText).toContain("Open questions:");
      expect(summaryText).toContain("2 (1 required)");

      const questionsBlock = body.blocks.find(
        (b: { text?: { text: string } }) => b.text?.text?.includes("Questions:"),
      );
      expect(questionsBlock.text.text).toContain("[required]");
      expect(questionsBlock.text.text).toContain("Should we strip unknown fields?");
    });

    it("omits the open-questions field and block when the array is empty", async () => {
      fetchMock.mockResolvedValue({ ok: true });
      const svc = new NotificationService(
        { emailFrom: "a@b.com", slackWebhookUrl: "https://hooks.slack.com/x" },
        logger,
      );
      await svc.sendHumanRequest(makePayload({ openQuestions: [] }));

      const [, init] = fetchMock.mock.calls[0]!;
      const body = JSON.parse(init.body as string);
      const questionsBlock = body.blocks.find(
        (b: { text?: { text: string } }) => b.text?.text?.includes("Questions:"),
      );
      expect(questionsBlock).toBeUndefined();
    });

    it("truncates more than 3 open questions in the Slack questions block", async () => {
      fetchMock.mockResolvedValue({ ok: true });
      const svc = new NotificationService(
        { emailFrom: "a@b.com", slackWebhookUrl: "https://hooks.slack.com/x" },
        logger,
      );
      const openQuestions = Array.from({ length: 5 }, (_, i) => ({
        id: `q${i}`,
        question: `Question number ${i}?`,
        requiredForExecution: false,
      }));
      await svc.sendHumanRequest(makePayload({ openQuestions }));

      const [, init] = fetchMock.mock.calls[0]!;
      const body = JSON.parse(init.body as string);
      const questionsBlock = body.blocks.find(
        (b: { text?: { text: string } }) => b.text?.text?.includes("Questions:"),
      );
      expect(questionsBlock.text.text).toContain("Question number 0?");
      expect(questionsBlock.text.text).toContain("Question number 2?");
      expect(questionsBlock.text.text).not.toContain("Question number 3?");
    });

    it("includes a context block when context is provided, truncated past 1500 chars for Slack", async () => {
      fetchMock.mockResolvedValue({ ok: true });
      const svc = new NotificationService(
        { emailFrom: "a@b.com", slackWebhookUrl: "https://hooks.slack.com/x" },
        logger,
      );
      const longContext = "x".repeat(2000);
      await svc.sendHumanRequest(makePayload({ context: longContext }));

      const [, init] = fetchMock.mock.calls[0]!;
      const body = JSON.parse(init.body as string);
      const contextBlock = body.blocks.find(
        (b: { text?: { text: string } }) => b.text?.text?.includes("Context:"),
      );
      expect(contextBlock).toBeDefined();
      // 1500-char truncation plus the ellipsis character.
      expect(contextBlock.text.text.length).toBeLessThan(longContext.length);
      expect(contextBlock.text.text).toContain("…");
    });

    it("omits the context block when context is not provided", async () => {
      fetchMock.mockResolvedValue({ ok: true });
      const svc = new NotificationService(
        { emailFrom: "a@b.com", slackWebhookUrl: "https://hooks.slack.com/x" },
        logger,
      );
      await svc.sendHumanRequest(makePayload());

      const [, init] = fetchMock.mock.calls[0]!;
      const body = JSON.parse(init.body as string);
      const contextBlock = body.blocks.find(
        (b: { text?: { text: string } }) => b.text?.text?.includes("Context:"),
      );
      expect(contextBlock).toBeUndefined();
    });

    it("includes an 'Open Linear issue' action button when the issue has a URL, and omits it otherwise", async () => {
      fetchMock.mockResolvedValue({ ok: true });
      const svc = new NotificationService(
        { emailFrom: "a@b.com", slackWebhookUrl: "https://hooks.slack.com/x" },
        logger,
      );

      await svc.sendHumanRequest(makePayload());
      let [, init] = fetchMock.mock.calls[0]!;
      let body = JSON.parse(init.body as string);
      let actionsBlock = body.blocks.find((b: { type: string }) => b.type === "actions");
      expect(actionsBlock.elements).toHaveLength(2);

      fetchMock.mockClear();
      await svc.sendHumanRequest(
        makePayload({ linearIssue: { id: "lin-1", title: "Fix the thing", url: null } }),
      );
      [, init] = fetchMock.mock.calls[0]!;
      body = JSON.parse(init.body as string);
      actionsBlock = body.blocks.find((b: { type: string }) => b.type === "actions");
      expect(actionsBlock.elements).toHaveLength(1);
    });

    it("falls back to the issue id and '(untitled)' when identifier/title are missing", async () => {
      fetchMock.mockResolvedValue({ ok: true });
      const svc = new NotificationService(
        { emailFrom: "a@b.com", slackWebhookUrl: "https://hooks.slack.com/x" },
        logger,
      );
      await svc.sendHumanRequest(
        makePayload({ linearIssue: { id: "lin-raw-id", title: null, url: null } }),
      );

      const [, init] = fetchMock.mock.calls[0]!;
      const body = JSON.parse(init.body as string);
      expect(body.text).toContain("lin-raw-id");
      expect(body.text).toContain("(untitled)");
    });

    it("renders each HumanRequestReason to a distinct human-readable label", async () => {
      fetchMock.mockResolvedValue({ ok: true });
      const svc = new NotificationService(
        { emailFrom: "a@b.com", slackWebhookUrl: "https://hooks.slack.com/x" },
        logger,
      );

      const expectations: [NotificationPayload["reason"], string][] = [
        ["plan_ambiguous", "Plan needs review (ambiguous)"],
        ["plan_low_confidence", "Plan needs review (low confidence)"],
        ["impl_rejected", "Implementation needs review (rejected by agent)"],
        ["impl_uncertain", "Implementation needs review (uncertain)"],
        ["other", "Human intervention requested"],
      ];

      for (const [reason, expectedLabel] of expectations) {
        fetchMock.mockClear();
        await svc.sendHumanRequest(makePayload({ reason }));
        const [, init] = fetchMock.mock.calls[0]!;
        const body = JSON.parse(init.body as string);
        expect(body.text).toContain(expectedLabel);
      }
    });

    it("escapes HTML special characters in the rendered email body", async () => {
      fetchMock.mockResolvedValue({ ok: true });
      const svc = new NotificationService(
        { emailFrom: "a@b.com", emailTo: "to@b.com", resendApiKey: "key" },
        logger,
      );
      await svc.sendHumanRequest(
        makePayload({
          summary: `Risk: <script>alert("x")</script> & "quoted"`,
          linearIssue: {
            id: "lin-1",
            identifier: "ENG-42",
            title: `Title with <tags> & "quotes"`,
            url: "https://linear.app/team/issue/ENG-42",
          },
        }),
      );

      const [, init] = fetchMock.mock.calls[0]!;
      const body = JSON.parse(init.body as string);
      expect(body.html).not.toContain("<script>");
      expect(body.html).toContain("&lt;script&gt;");
      expect(body.html).toContain("&amp;");
      expect(body.html).toContain("&quot;quoted&quot;");
    });

    it("includes the open-questions and context sections in the plain-text email body", async () => {
      fetchMock.mockResolvedValue({ ok: true });
      const svc = new NotificationService(
        { emailFrom: "a@b.com", emailTo: "to@b.com", resendApiKey: "key" },
        logger,
      );
      await svc.sendHumanRequest(
        makePayload({
          context: "Some additional context",
          planConfidence: 0.6,
          openQuestions: [{ id: "q1", question: "Which approach?", requiredForExecution: true }],
        }),
      );

      const [, init] = fetchMock.mock.calls[0]!;
      const body = JSON.parse(init.body as string);
      expect(body.text).toContain("Plan confidence: 0.60");
      expect(body.text).toContain("Context:");
      expect(body.text).toContain("Some additional context");
      expect(body.text).toContain("Open questions:");
      expect(body.text).toContain("[required] Which approach?");
      expect(body.text).toContain(`Run: ${makePayload().runUrl}`);
      expect(body.text).toContain("Linear: https://linear.app/team/issue/ENG-42");
    });

    it("omits the Linear line in plain-text email when the issue has no URL", async () => {
      fetchMock.mockResolvedValue({ ok: true });
      const svc = new NotificationService(
        { emailFrom: "a@b.com", emailTo: "to@b.com", resendApiKey: "key" },
        logger,
      );
      await svc.sendHumanRequest(
        makePayload({ linearIssue: { id: "lin-1", title: "T", url: null } }),
      );

      const [, init] = fetchMock.mock.calls[0]!;
      const body = JSON.parse(init.body as string);
      expect(body.text).not.toContain("Linear:");
    });
  });
});
