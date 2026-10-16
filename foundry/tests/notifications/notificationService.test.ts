import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  NotificationService,
  type NotificationConfig,
  type NotificationPayload,
  type HumanRequestReason,
} from "../../src/notifications/notificationService.js";

function makePayload(overrides: Partial<NotificationPayload> = {}): NotificationPayload {
  return {
    runId: "run-1",
    reason: "plan_ambiguous",
    summary: "The plan has an ambiguous step.",
    linearIssue: {
      id: "issue-db-1",
      identifier: "ENG-123",
      title: "Fix the thing",
      url: "https://linear.app/team/issue/ENG-123",
    },
    runState: "awaiting_human",
    runUrl: "https://app.example.com/runs/run-1",
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

function okResponse() {
  return {
    ok: true,
    status: 200,
    text: vi.fn().mockResolvedValue(""),
  } as unknown as Response;
}

function errorResponse(status: number, body: string) {
  return {
    ok: false,
    status,
    text: vi.fn().mockResolvedValue(body),
  } as unknown as Response;
}

describe("NotificationService.isConfigured()", () => {
  const logger = makeLogger();

  it("returns true when slackWebhookUrl is set, regardless of email config", () => {
    const svc = new NotificationService(
      { emailFrom: "bot@example.com", slackWebhookUrl: "https://hooks.slack.com/x" },
      logger as never,
    );
    expect(svc.isConfigured()).toBe(true);
  });

  it("returns true when emailTo and resendApiKey are both set", () => {
    const svc = new NotificationService(
      { emailFrom: "bot@example.com", emailTo: "human@example.com", resendApiKey: "re_123" },
      logger as never,
    );
    expect(svc.isConfigured()).toBe(true);
  });

  it("returns false when emailTo is set but resendApiKey is missing", () => {
    const svc = new NotificationService(
      { emailFrom: "bot@example.com", emailTo: "human@example.com" },
      logger as never,
    );
    expect(svc.isConfigured()).toBe(false);
  });

  it("returns false when resendApiKey is set but emailTo is missing", () => {
    const svc = new NotificationService(
      { emailFrom: "bot@example.com", resendApiKey: "re_123" },
      logger as never,
    );
    expect(svc.isConfigured()).toBe(false);
  });

  it("returns false when nothing is configured", () => {
    const svc = new NotificationService({ emailFrom: "bot@example.com" }, logger as never);
    expect(svc.isConfigured()).toBe(false);
  });
});

describe("NotificationService.sendHumanRequest() — channel gating", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue(okResponse());
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("attempts neither channel when nothing is configured, and makes no network calls", async () => {
    const logger = makeLogger();
    const svc = new NotificationService({ emailFrom: "bot@example.com" }, logger as never);

    const result = await svc.sendHumanRequest(makePayload());

    expect(result).toEqual({
      slack: { attempted: false, ok: false },
      email: { attempted: false, ok: false },
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("attempts only slack when only slackWebhookUrl is configured", async () => {
    const logger = makeLogger();
    const svc = new NotificationService(
      { emailFrom: "bot@example.com", slackWebhookUrl: "https://hooks.slack.com/x" },
      logger as never,
    );

    const result = await svc.sendHumanRequest(makePayload());

    expect(result.slack.attempted).toBe(true);
    expect(result.slack.ok).toBe(true);
    expect(result.email).toEqual({ attempted: false, ok: false });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://hooks.slack.com/x",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("attempts only email when emailTo and resendApiKey are configured (no slack url)", async () => {
    const logger = makeLogger();
    const svc = new NotificationService(
      {
        emailFrom: "bot@example.com",
        emailTo: "human@example.com",
        resendApiKey: "re_123",
      },
      logger as never,
    );

    const result = await svc.sendHumanRequest(makePayload());

    expect(result.email.attempted).toBe(true);
    expect(result.email.ok).toBe(true);
    expect(result.slack).toEqual({ attempted: false, ok: false });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.resend.com/emails",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("does not attempt email when emailTo is set but resendApiKey is missing", async () => {
    const logger = makeLogger();
    const svc = new NotificationService(
      { emailFrom: "bot@example.com", emailTo: "human@example.com" },
      logger as never,
    );

    const result = await svc.sendHumanRequest(makePayload());

    expect(result.email).toEqual({ attempted: false, ok: false });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not attempt email when resendApiKey is set but emailTo is missing", async () => {
    const logger = makeLogger();
    const svc = new NotificationService(
      { emailFrom: "bot@example.com", resendApiKey: "re_123" },
      logger as never,
    );

    const result = await svc.sendHumanRequest(makePayload());

    expect(result.email).toEqual({ attempted: false, ok: false });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("attempts and sends both channels when both are configured", async () => {
    const logger = makeLogger();
    const svc = new NotificationService(
      {
        emailFrom: "bot@example.com",
        emailTo: "human@example.com",
        resendApiKey: "re_123",
        slackWebhookUrl: "https://hooks.slack.com/x",
      },
      logger as never,
    );

    const result = await svc.sendHumanRequest(makePayload());

    expect(result.slack).toEqual({ attempted: true, ok: true });
    expect(result.email).toEqual({ attempted: true, ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const urls = fetchMock.mock.calls.map((c) => c[0]);
    expect(urls).toContain("https://hooks.slack.com/x");
    expect(urls).toContain("https://api.resend.com/emails");
  });
});

describe("NotificationService.sendHumanRequest() — slack content", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let logger: ReturnType<typeof makeLogger>;
  let svc: NotificationService;

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue(okResponse());
    vi.stubGlobal("fetch", fetchMock);
    logger = makeLogger();
    svc = new NotificationService(
      { emailFrom: "bot@example.com", slackWebhookUrl: "https://hooks.slack.com/x" },
      logger as never,
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function slackBody() {
    const call = fetchMock.mock.calls[0];
    return JSON.parse(call[1].body as string) as {
      text: string;
      blocks: Array<Record<string, unknown>>;
    };
  }

  const reasonExpectations: [HumanRequestReason, string][] = [
    ["plan_ambiguous", "Plan needs review (ambiguous)"],
    ["plan_low_confidence", "Plan needs review (low confidence)"],
    ["impl_rejected", "Implementation needs review (rejected by agent)"],
    ["impl_uncertain", "Implementation needs review (uncertain)"],
    ["other", "Human intervention requested"],
  ];

  for (const [reason, label] of reasonExpectations) {
    it(`renders a distinct title for reason="${reason}"`, async () => {
      await svc.sendHumanRequest(makePayload({ reason }));
      const body = slackBody();
      expect(body.text).toBe(`${label} — ENG-123: Fix the thing`);
      const header = body.blocks[0] as { type: string; text: { text: string } };
      expect(header.type).toBe("header");
      expect(header.text.text).toBe(`${label} — ENG-123: Fix the thing`);
    });
  }

  it("falls back to linearIssue.id when identifier is absent, and '(untitled)' when title is null", async () => {
    await svc.sendHumanRequest(
      makePayload({
        linearIssue: { id: "raw-id-9", title: null, url: null },
      }),
    );
    const body = slackBody();
    expect(body.text).toBe("Plan needs review (ambiguous) — raw-id-9: (untitled)");
  });

  it("puts the summary in the second block verbatim", async () => {
    await svc.sendHumanRequest(makePayload({ summary: "Needs a human look." }));
    const body = slackBody();
    const section = body.blocks[1] as { type: string; text: { text: string } };
    expect(section.type).toBe("section");
    expect(section.text.text).toBe("Needs a human look.");
  });

  it("always includes the run state field, and omits confidence/questions fields when absent", async () => {
    await svc.sendHumanRequest(makePayload());
    const body = slackBody();
    const fieldsBlock = body.blocks[2] as { type: string; fields: { text: string }[] };
    expect(fieldsBlock.type).toBe("section");
    expect(fieldsBlock.fields).toHaveLength(1);
    expect(fieldsBlock.fields[0].text).toBe("*State:*\nawaiting_human");
  });

  it("includes a plan-confidence field formatted to two decimals when planConfidence is set", async () => {
    await svc.sendHumanRequest(makePayload({ planConfidence: 0.4 }));
    const body = slackBody();
    const fieldsBlock = body.blocks[2] as { type: string; fields: { text: string }[] };
    expect(fieldsBlock.fields.map((f) => f.text)).toContain("*Plan confidence:*\n0.40");
  });

  it("includes an open-questions count field with the required-count breakdown", async () => {
    await svc.sendHumanRequest(
      makePayload({
        openQuestions: [
          { id: "q1", question: "Which API?", requiredForExecution: true },
          { id: "q2", question: "Which color?", requiredForExecution: false },
          { id: "q3", question: "Which env?", requiredForExecution: true },
        ],
      }),
    );
    const body = slackBody();
    const fieldsBlock = body.blocks[2] as { type: string; fields: { text: string }[] };
    expect(fieldsBlock.fields.map((f) => f.text)).toContain("*Open questions:*\n3 (2 required)");
  });

  it("omits the open-questions field entirely when openQuestions is an empty array", async () => {
    await svc.sendHumanRequest(makePayload({ openQuestions: [] }));
    const body = slackBody();
    const fieldsBlock = body.blocks[2] as { type: string; fields: { text: string }[] };
    expect(fieldsBlock.fields).toHaveLength(1);
  });

  it("omits the context block when context is absent", async () => {
    await svc.sendHumanRequest(makePayload());
    const body = slackBody();
    const hasContext = body.blocks.some(
      (b) => (b as { text?: { text: string } }).text?.text?.startsWith("*Context:*"),
    );
    expect(hasContext).toBe(false);
  });

  it("includes a context block, truncated at 1500 chars with an ellipsis, when context is long", async () => {
    const longContext = "x".repeat(2000);
    await svc.sendHumanRequest(makePayload({ context: longContext }));
    const body = slackBody();
    const contextBlock = body.blocks.find((b) =>
      (b as { text?: { text: string } }).text?.text?.startsWith("*Context:*"),
    ) as { text: { text: string } };
    expect(contextBlock).toBeDefined();
    const rendered = contextBlock.text.text.replace("*Context:*\n", "");
    expect(rendered).toHaveLength(1500);
    expect(rendered.endsWith("…")).toBe(true);
    expect(rendered.startsWith("x".repeat(1499))).toBe(true);
  });

  it("does not truncate context shorter than the 1500 char limit", async () => {
    const shortContext = "short context";
    await svc.sendHumanRequest(makePayload({ context: shortContext }));
    const body = slackBody();
    const contextBlock = body.blocks.find((b) =>
      (b as { text?: { text: string } }).text?.text?.startsWith("*Context:*"),
    ) as { text: { text: string } };
    expect(contextBlock.text.text).toBe(`*Context:*\n${shortContext}`);
  });

  it("renders at most the first 3 open questions, marking required ones and truncating long question text at 200 chars", async () => {
    const longQuestion = "q".repeat(250);
    await svc.sendHumanRequest(
      makePayload({
        openQuestions: [
          { id: "q1", question: "First?", requiredForExecution: true },
          { id: "q2", question: "Second?", requiredForExecution: false },
          { id: "q3", question: "Third?", requiredForExecution: false },
          { id: "q4", question: longQuestion, requiredForExecution: true },
        ],
      }),
    );
    const body = slackBody();
    const questionsBlock = body.blocks.find((b) =>
      (b as { text?: { text: string } }).text?.text?.startsWith("*Questions:*"),
    ) as { text: { text: string } };
    expect(questionsBlock).toBeDefined();
    const text = questionsBlock.text.text;
    expect(text).toContain("• [required] First?");
    expect(text).toContain("• Second?");
    expect(text).toContain("• Third?");
    // 4th question is excluded by the slice(0, 3)
    expect(text).not.toContain("q4");
    // "*Questions:*" header line plus exactly 3 question lines (4th is excluded by slice(0, 3))
    expect(text.split("\n")).toHaveLength(4);
  });

  it("includes only the 'Open run' button when linearIssue.url is absent", async () => {
    await svc.sendHumanRequest(
      makePayload({ linearIssue: { id: "i1", title: "t", url: null } }),
    );
    const body = slackBody();
    const actionsBlock = body.blocks.at(-1) as {
      type: string;
      elements: { text: { text: string }; url: string }[];
    };
    expect(actionsBlock.type).toBe("actions");
    expect(actionsBlock.elements).toHaveLength(1);
    expect(actionsBlock.elements[0].text.text).toBe("Open run");
    expect(actionsBlock.elements[0].url).toBe("https://app.example.com/runs/run-1");
  });

  it("includes both buttons, with the Linear button pointing at linearIssue.url, when it is set", async () => {
    await svc.sendHumanRequest(makePayload());
    const body = slackBody();
    const actionsBlock = body.blocks.at(-1) as {
      type: string;
      elements: { text: { text: string }; url: string }[];
    };
    expect(actionsBlock.elements).toHaveLength(2);
    expect(actionsBlock.elements[1].text.text).toBe("Open Linear issue");
    expect(actionsBlock.elements[1].url).toBe("https://linear.app/team/issue/ENG-123");
  });

  it("sends the slack payload as POST JSON with the content-type header", async () => {
    await svc.sendHumanRequest(makePayload());
    const call = fetchMock.mock.calls[0];
    expect(call[1].method).toBe("POST");
    expect(call[1].headers).toEqual({ "Content-Type": "application/json" });
  });
});

describe("NotificationService.sendHumanRequest() — slack failure handling", () => {
  let logger: ReturnType<typeof makeLogger>;
  let svc: NotificationService;

  beforeEach(() => {
    logger = makeLogger();
    svc = new NotificationService(
      { emailFrom: "bot@example.com", slackWebhookUrl: "https://hooks.slack.com/x" },
      logger as never,
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("records a non-ok response as a failure with the status and truncated body in the error message, and logs a warning", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(errorResponse(500, "internal slack error")),
    );

    const result = await svc.sendHumanRequest(makePayload());

    expect(result.slack.attempted).toBe(true);
    expect(result.slack.ok).toBe(false);
    expect(result.slack.error).toBe(
      "Slack webhook returned 500: internal slack error",
    );
    expect(logger.warn).toHaveBeenCalledWith(
      { runId: "run-1", error: "Slack webhook returned 500: internal slack error" },
      "Slack notification failed",
    );
  });

  it("truncates an overly long error body to 200 chars in the error message", async () => {
    const longBody = "e".repeat(400);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(errorResponse(502, longBody)));

    const result = await svc.sendHumanRequest(makePayload());

    expect(result.slack.error).toBe(`Slack webhook returned 502: ${"e".repeat(200)}`);
  });

  it("falls back to an empty body when response.text() itself rejects", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 503,
        text: vi.fn().mockRejectedValue(new Error("stream closed")),
      }),
    );

    const result = await svc.sendHumanRequest(makePayload());

    expect(result.slack.error).toBe("Slack webhook returned 503: ");
  });

  it("records a thrown Error (e.g. network failure) as a failure using its message", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNREFUSED")));

    const result = await svc.sendHumanRequest(makePayload());

    expect(result.slack.ok).toBe(false);
    expect(result.slack.error).toBe("ECONNREFUSED");
    expect(logger.warn).toHaveBeenCalledWith(
      { runId: "run-1", error: "ECONNREFUSED" },
      "Slack notification failed",
    );
  });

  it("stringifies a thrown non-Error value as the error message", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue("just a string rejection"));

    const result = await svc.sendHumanRequest(makePayload());

    expect(result.slack.ok).toBe(false);
    expect(result.slack.error).toBe("just a string rejection");
  });

  it("does not throw out of sendHumanRequest when slack fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("boom")));
    await expect(svc.sendHumanRequest(makePayload())).resolves.toBeDefined();
  });
});

describe("NotificationService.sendHumanRequest() — email content", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let logger: ReturnType<typeof makeLogger>;
  let svc: NotificationService;

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue(okResponse());
    vi.stubGlobal("fetch", fetchMock);
    logger = makeLogger();
    svc = new NotificationService(
      {
        emailFrom: "bot@example.com",
        emailTo: "human@example.com, second@example.com ,,",
        resendApiKey: "re_secret_key",
      },
      logger as never,
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function emailCall() {
    const call = fetchMock.mock.calls[0];
    return {
      url: call[0] as string,
      init: call[1] as { method: string; headers: Record<string, string>; body: string },
      body: JSON.parse(call[1].body as string) as {
        from: string;
        to: string[];
        subject: string;
        html: string;
        text: string;
      },
    };
  }

  it("posts to the Resend API with bearer auth and JSON content-type", async () => {
    await svc.sendHumanRequest(makePayload());
    const { url, init } = emailCall();
    expect(url).toBe("https://api.resend.com/emails");
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({
      Authorization: "Bearer re_secret_key",
      "Content-Type": "application/json",
    });
  });

  it("splits, trims, and drops empty entries from a comma-separated emailTo list", async () => {
    await svc.sendHumanRequest(makePayload());
    const { body } = emailCall();
    expect(body.to).toEqual(["human@example.com", "second@example.com"]);
    expect(body.from).toBe("bot@example.com");
  });

  const reasonExpectations: [HumanRequestReason, string][] = [
    ["plan_ambiguous", "Plan needs review (ambiguous)"],
    ["plan_low_confidence", "Plan needs review (low confidence)"],
    ["impl_rejected", "Implementation needs review (rejected by agent)"],
    ["impl_uncertain", "Implementation needs review (uncertain)"],
    ["other", "Human intervention requested"],
  ];

  for (const [reason, label] of reasonExpectations) {
    it(`renders a distinct subject and matching html heading for reason="${reason}"`, async () => {
      await svc.sendHumanRequest(makePayload({ reason }));
      const { body } = emailCall();
      expect(body.subject).toBe(`[AgentForge] ${label} — ENG-123: Fix the thing`);
      expect(body.html).toContain(`<h2 style="margin-top:0;">${label}</h2>`);
      expect(body.text.split("\n")[0]).toBe(label);
    });
  }

  it("falls back to linearIssue.id and '(untitled)' in subject, html, and text when identifier/title are absent", async () => {
    await svc.sendHumanRequest(
      makePayload({ linearIssue: { id: "raw-id-9", title: null, url: null } }),
    );
    const { body } = emailCall();
    expect(body.subject).toBe(
      "[AgentForge] Plan needs review (ambiguous) — raw-id-9: (untitled)",
    );
    expect(body.html).toContain("raw-id-9:</strong> (untitled)");
    expect(body.text).toContain("raw-id-9: (untitled)");
  });

  it("escapes HTML-significant characters from untrusted fields in the html body", async () => {
    await svc.sendHumanRequest(
      makePayload({
        summary: `<script>alert("x")</script> & 'quoted'`,
        linearIssue: {
          id: "i1",
          identifier: "ENG-<1>",
          title: `Title & "quote"`,
          url: "https://example.com/x",
        },
      }),
    );
    const { body } = emailCall();
    expect(body.html).not.toContain("<script>alert");
    expect(body.html).toContain(
      "&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; &#39;quoted&#39;",
    );
    expect(body.html).toContain("ENG-&lt;1&gt;");
    expect(body.html).toContain("Title &amp; &quot;quote&quot;");
  });

  it("does not escape the plain-text body (summary/title appear verbatim)", async () => {
    await svc.sendHumanRequest(makePayload({ summary: `<b>raw</b> & stuff` }));
    const { body } = emailCall();
    expect(body.text).toContain("<b>raw</b> & stuff");
  });

  it("omits the plan-confidence line when planConfidence is absent, in both html and text", async () => {
    await svc.sendHumanRequest(makePayload());
    const { body } = emailCall();
    expect(body.html).not.toContain("Plan confidence:");
    expect(body.text).not.toContain("Plan confidence:");
  });

  it("includes the plan-confidence line formatted to two decimals when set, in both html and text", async () => {
    await svc.sendHumanRequest(makePayload({ planConfidence: 0.333 }));
    const { body } = emailCall();
    expect(body.html).toContain("<strong>Plan confidence:</strong> 0.33");
    expect(body.text).toContain("Plan confidence: 0.33");
  });

  it("omits the context block/lines when context is absent", async () => {
    await svc.sendHumanRequest(makePayload());
    const { body } = emailCall();
    expect(body.html).not.toContain("Context:");
    expect(body.text).not.toContain("Context:");
  });

  it("includes context truncated at 2000 chars with an ellipsis, escaped in html, raw in text", async () => {
    const longContext = "y".repeat(2500);
    await svc.sendHumanRequest(makePayload({ context: longContext }));
    const { body } = emailCall();
    expect(body.html).toContain("y".repeat(1999) + "…</pre>");
    expect(body.text).toContain("y".repeat(1999) + "…");
    expect(body.text).not.toContain("y".repeat(2001));
  });

  it("omits the open-questions section when there are none", async () => {
    await svc.sendHumanRequest(makePayload());
    const { body } = emailCall();
    expect(body.html).not.toContain("Open questions:");
    expect(body.text).not.toContain("Open questions:");
  });

  it("renders at most the first 5 open questions, marking required ones, in both html and text", async () => {
    const questions = Array.from({ length: 7 }, (_, i) => ({
      id: `q${i}`,
      question: `Question ${i}?`,
      requiredForExecution: i % 2 === 0,
    }));
    await svc.sendHumanRequest(makePayload({ openQuestions: questions }));
    const { body } = emailCall();

    expect(body.html).toContain("<strong>[required]</strong> Question 0?");
    expect(body.html).toContain("Question 1?");
    expect(body.html).toContain("Question 4?");
    expect(body.html).not.toContain("Question 5?");
    expect(body.html).not.toContain("Question 6?");

    expect(body.text).toContain("- [required] Question 0?");
    expect(body.text).toContain("- Question 1?");
    expect(body.text).not.toContain("Question 5?");
  });

  it("includes the run link in html and the Run: line in text", async () => {
    await svc.sendHumanRequest(makePayload());
    const { body } = emailCall();
    expect(body.html).toContain('href="https://app.example.com/runs/run-1"');
    expect(body.text).toContain("Run: https://app.example.com/runs/run-1");
  });

  it("includes the Linear link/line only when linearIssue.url is set", async () => {
    await svc.sendHumanRequest(makePayload());
    let { body } = emailCall();
    expect(body.html).toContain('href="https://linear.app/team/issue/ENG-123"');
    expect(body.text).toContain("Linear: https://linear.app/team/issue/ENG-123");

    fetchMock.mockClear();
    await svc.sendHumanRequest(
      makePayload({ linearIssue: { id: "i1", title: "t", url: null } }),
    );
    ({ body } = emailCall());
    expect(body.html).not.toContain("Open Linear issue");
    expect(body.text).not.toContain("Linear:");
  });
});

describe("NotificationService.sendHumanRequest() — email failure handling", () => {
  let logger: ReturnType<typeof makeLogger>;
  let svc: NotificationService;

  beforeEach(() => {
    logger = makeLogger();
    svc = new NotificationService(
      {
        emailFrom: "bot@example.com",
        emailTo: "human@example.com",
        resendApiKey: "re_secret_key",
      },
      logger as never,
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("records a non-ok response as a failure with status and truncated body, and logs a warning", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(errorResponse(401, "invalid api key")));

    const result = await svc.sendHumanRequest(makePayload());

    expect(result.email.attempted).toBe(true);
    expect(result.email.ok).toBe(false);
    expect(result.email.error).toBe("Resend returned 401: invalid api key");
    expect(logger.warn).toHaveBeenCalledWith(
      { runId: "run-1", error: "Resend returned 401: invalid api key" },
      "Email notification failed",
    );
  });

  it("truncates an overly long error body to 200 chars", async () => {
    const longBody = "f".repeat(300);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(errorResponse(500, longBody)));

    const result = await svc.sendHumanRequest(makePayload());

    expect(result.email.error).toBe(`Resend returned 500: ${"f".repeat(200)}`);
  });

  it("falls back to an empty body when response.text() rejects", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 429,
        text: vi.fn().mockRejectedValue(new Error("stream closed")),
      }),
    );

    const result = await svc.sendHumanRequest(makePayload());

    expect(result.email.error).toBe("Resend returned 429: ");
  });

  it("records a thrown Error as a failure using its message", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("DNS lookup failed")));

    const result = await svc.sendHumanRequest(makePayload());

    expect(result.email.ok).toBe(false);
    expect(result.email.error).toBe("DNS lookup failed");
    expect(logger.warn).toHaveBeenCalledWith(
      { runId: "run-1", error: "DNS lookup failed" },
      "Email notification failed",
    );
  });

  it("stringifies a thrown non-Error value as the error message", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue({ weird: "object" }));

    const result = await svc.sendHumanRequest(makePayload());

    expect(result.email.ok).toBe(false);
    expect(result.email.error).toBe("[object Object]");
  });
});

describe("NotificationService.sendHumanRequest() — independent channel outcomes", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reports slack failure and email success independently when both are configured", async () => {
    const logger = makeLogger();
    const svc = new NotificationService(
      {
        emailFrom: "bot@example.com",
        emailTo: "human@example.com",
        resendApiKey: "re_123",
        slackWebhookUrl: "https://hooks.slack.com/x",
      },
      logger as never,
    );

    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async (url: string) => {
        if (url === "https://hooks.slack.com/x") {
          return errorResponse(500, "slack down");
        }
        return okResponse();
      }),
    );

    const result = await svc.sendHumanRequest(makePayload());

    expect(result.slack).toEqual({
      attempted: true,
      ok: false,
      error: "Slack webhook returned 500: slack down",
    });
    expect(result.email).toEqual({ attempted: true, ok: true });
  });

  it("reports email failure and slack success independently when both are configured", async () => {
    const logger = makeLogger();
    const svc = new NotificationService(
      {
        emailFrom: "bot@example.com",
        emailTo: "human@example.com",
        resendApiKey: "re_123",
        slackWebhookUrl: "https://hooks.slack.com/x",
      },
      logger as never,
    );

    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async (url: string) => {
        if (url === "https://api.resend.com/emails") {
          return errorResponse(502, "resend down");
        }
        return okResponse();
      }),
    );

    const result = await svc.sendHumanRequest(makePayload());

    expect(result.slack).toEqual({ attempted: true, ok: true });
    expect(result.email).toEqual({
      attempted: true,
      ok: false,
      error: "Resend returned 502: resend down",
    });
  });
});
