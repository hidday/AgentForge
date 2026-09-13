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
    reason: "other",
    summary: "Something needs a human",
    linearIssue: {
      id: "issue-1",
      identifier: "ENG-42",
      title: "Fix the widget",
      url: "https://linear.app/team/issue/ENG-42",
    },
    runState: "AIBlocked",
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

function jsonResponse(ok: boolean, status = 200): { ok: boolean; status: number; text: () => Promise<string> } {
  return { ok, status, text: () => Promise.resolve(ok ? "" : "error body from server") };
}

describe("NotificationService.isConfigured", () => {
  it("is false when neither slack nor email is configured", () => {
    const config: NotificationConfig = { emailFrom: "bot@example.com" };
    const svc = new NotificationService(config, buildLogger() as never);
    expect(svc.isConfigured()).toBe(false);
  });

  it("is true when a slack webhook url is configured", () => {
    const config: NotificationConfig = {
      emailFrom: "bot@example.com",
      slackWebhookUrl: "https://hooks.slack.com/x",
    };
    const svc = new NotificationService(config, buildLogger() as never);
    expect(svc.isConfigured()).toBe(true);
  });

  it("is true when both emailTo and resendApiKey are configured", () => {
    const config: NotificationConfig = {
      emailFrom: "bot@example.com",
      emailTo: "human@example.com",
      resendApiKey: "key-123",
    };
    const svc = new NotificationService(config, buildLogger() as never);
    expect(svc.isConfigured()).toBe(true);
  });

  it("is false when only emailTo is configured without a resendApiKey", () => {
    const config: NotificationConfig = { emailFrom: "bot@example.com", emailTo: "human@example.com" };
    const svc = new NotificationService(config, buildLogger() as never);
    expect(svc.isConfigured()).toBe(false);
  });

  it("is false when only resendApiKey is configured without an emailTo", () => {
    const config: NotificationConfig = { emailFrom: "bot@example.com", resendApiKey: "key-123" };
    const svc = new NotificationService(config, buildLogger() as never);
    expect(svc.isConfigured()).toBe(false);
  });
});

describe("NotificationService.sendHumanRequest", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("attempts neither channel when nothing is configured, and makes no network calls", async () => {
    const config: NotificationConfig = { emailFrom: "bot@example.com" };
    const logger = buildLogger();
    const svc = new NotificationService(config, logger as never);

    const result = await svc.sendHumanRequest(makePayload());

    expect(result).toEqual({
      slack: { attempted: false, ok: false },
      email: { attempted: false, ok: false },
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("sends a well-formed Slack payload and marks it ok on success", async () => {
    fetchMock.mockResolvedValue(jsonResponse(true));
    const config: NotificationConfig = {
      emailFrom: "bot@example.com",
      slackWebhookUrl: "https://hooks.slack.com/services/x",
    };
    const svc = new NotificationService(config, buildLogger() as never);

    const payload = makePayload({
      reason: "plan_low_confidence",
      planConfidence: 0.42,
      context: "Some extra context",
      openQuestions: [
        { id: "q1", question: "Is this right?", requiredForExecution: true },
        { id: "q2", question: "What about that?", requiredForExecution: false },
      ],
    });

    const result = await svc.sendHumanRequest(payload);

    expect(result.slack).toEqual({ attempted: true, ok: true });
    expect(result.email).toEqual({ attempted: false, ok: false });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://hooks.slack.com/services/x");
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({ "Content-Type": "application/json" });

    const body = JSON.parse(init.body as string) as {
      text: string;
      blocks: Array<Record<string, unknown>>;
    };
    expect(body.text).toBe("Plan needs review (low confidence) — ENG-42: Fix the widget");

    const sectionWithFields = body.blocks.find(
      (b) => b.type === "section" && Array.isArray((b as { fields?: unknown[] }).fields),
    ) as { fields: { text: string }[] };
    expect(sectionWithFields.fields.map((f) => f.text)).toEqual([
      "*State:*\nAIBlocked",
      "*Plan confidence:*\n0.42",
      "*Open questions:*\n2 (1 required)",
    ]);

    const contextBlock = body.blocks.find(
      (b) =>
        b.type === "section" &&
        typeof (b as { text?: { text?: string } }).text?.text === "string" &&
        (b as { text: { text: string } }).text.text.startsWith("*Context:*"),
    ) as { text: { text: string } };
    expect(contextBlock.text.text).toBe("*Context:*\nSome extra context");

    const questionsBlock = body.blocks.find(
      (b) =>
        b.type === "section" &&
        typeof (b as { text?: { text?: string } }).text?.text === "string" &&
        (b as { text: { text: string } }).text.text.startsWith("*Questions:*"),
    ) as { text: { text: string } };
    expect(questionsBlock.text.text).toContain("[required] Is this right?");
    expect(questionsBlock.text.text).toContain("What about that?");

    const actionsBlock = body.blocks.find((b) => b.type === "actions") as {
      elements: { url: string }[];
    };
    expect(actionsBlock.elements).toHaveLength(2);
    expect(actionsBlock.elements[0].url).toBe(payload.runUrl);
    expect(actionsBlock.elements[1].url).toBe(payload.linearIssue.url);
  });

  it("omits optional Slack fields/blocks when confidence, context, and open questions are absent", async () => {
    fetchMock.mockResolvedValue(jsonResponse(true));
    const config: NotificationConfig = {
      emailFrom: "bot@example.com",
      slackWebhookUrl: "https://hooks.slack.com/services/x",
    };
    const svc = new NotificationService(config, buildLogger() as never);

    const payload = makePayload({
      linearIssue: { id: "issue-2", title: null, url: null },
      openQuestions: [],
    });
    await svc.sendHumanRequest(payload);

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string) as {
      text: string;
      blocks: Array<Record<string, unknown>>;
    };

    // Falls back to id (no identifier) and "(untitled)" (no title).
    expect(body.text).toBe("Human intervention requested — issue-2: (untitled)");

    const sectionWithFields = body.blocks.find(
      (b) => b.type === "section" && Array.isArray((b as { fields?: unknown[] }).fields),
    ) as { fields: { text: string }[] };
    expect(sectionWithFields.fields).toHaveLength(1);
    expect(sectionWithFields.fields[0].text).toBe("*State:*\nAIBlocked");

    const hasContextBlock = body.blocks.some(
      (b) =>
        typeof (b as { text?: { text?: string } }).text?.text === "string" &&
        (b as { text: { text: string } }).text.text.startsWith("*Context:*"),
    );
    expect(hasContextBlock).toBe(false);

    const hasQuestionsBlock = body.blocks.some(
      (b) =>
        typeof (b as { text?: { text?: string } }).text?.text === "string" &&
        (b as { text: { text: string } }).text.text.startsWith("*Questions:*"),
    );
    expect(hasQuestionsBlock).toBe(false);

    const actionsBlock = body.blocks.find((b) => b.type === "actions") as {
      elements: unknown[];
    };
    // No linearIssue.url means only the "Open run" button.
    expect(actionsBlock.elements).toHaveLength(1);
  });

  it("truncates a long context block and long questions in the Slack payload", async () => {
    fetchMock.mockResolvedValue(jsonResponse(true));
    const config: NotificationConfig = {
      emailFrom: "bot@example.com",
      slackWebhookUrl: "https://hooks.slack.com/services/x",
    };
    const svc = new NotificationService(config, buildLogger() as never);

    const longContext = "x".repeat(2000);
    const longQuestion = "y".repeat(300);
    const payload = makePayload({
      context: longContext,
      openQuestions: [
        { id: "q1", question: longQuestion, requiredForExecution: false },
        { id: "q2", question: "second", requiredForExecution: false },
        { id: "q3", question: "third", requiredForExecution: false },
        { id: "q4", question: "fourth - should be sliced out", requiredForExecution: false },
      ],
    });

    await svc.sendHumanRequest(payload);

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string) as { blocks: Array<Record<string, unknown>> };

    const contextBlock = body.blocks.find(
      (b) =>
        typeof (b as { text?: { text?: string } }).text?.text === "string" &&
        (b as { text: { text: string } }).text.text.startsWith("*Context:*"),
    ) as { text: { text: string } };
    // "*Context:*\n" + 1499 chars + ellipsis
    expect(contextBlock.text.text.length).toBe("*Context:*\n".length + 1500);
    expect(contextBlock.text.text.endsWith("…")).toBe(true);

    const questionsBlock = body.blocks.find(
      (b) =>
        typeof (b as { text?: { text?: string } }).text?.text === "string" &&
        (b as { text: { text: string } }).text.text.startsWith("*Questions:*"),
    ) as { text: { text: string } };
    expect(questionsBlock.text.text).not.toContain("fourth - should be sliced out");
    expect(questionsBlock.text.text).toContain("…");
  });

  it("catches a Slack failure response, records the error, and logs a warning", async () => {
    fetchMock.mockResolvedValue(jsonResponse(false, 500));
    const config: NotificationConfig = {
      emailFrom: "bot@example.com",
      slackWebhookUrl: "https://hooks.slack.com/services/x",
    };
    const logger = buildLogger();
    const svc = new NotificationService(config, logger as never);

    const result = await svc.sendHumanRequest(makePayload());

    expect(result.slack.attempted).toBe(true);
    expect(result.slack.ok).toBe(false);
    expect(result.slack.error).toBe("Slack webhook returned 500: error body from server");
    expect(logger.warn).toHaveBeenCalledWith(
      { runId: "run-1", error: "Slack webhook returned 500: error body from server" },
      "Slack notification failed",
    );
  });

  it("catches a non-Error thrown from the Slack fetch and stringifies it", async () => {
    fetchMock.mockRejectedValue("network exploded");
    const config: NotificationConfig = {
      emailFrom: "bot@example.com",
      slackWebhookUrl: "https://hooks.slack.com/services/x",
    };
    const logger = buildLogger();
    const svc = new NotificationService(config, logger as never);

    const result = await svc.sendHumanRequest(makePayload());

    expect(result.slack.ok).toBe(false);
    expect(result.slack.error).toBe("network exploded");
    expect(logger.warn).toHaveBeenCalledWith(
      { runId: "run-1", error: "network exploded" },
      "Slack notification failed",
    );
  });

  it("sends an email via Resend to trimmed, filtered recipients and marks it ok on success", async () => {
    fetchMock.mockResolvedValue(jsonResponse(true));
    const config: NotificationConfig = {
      emailFrom: "bot@example.com",
      emailTo: " human@example.com , other@example.com ,, ",
      resendApiKey: "key-123",
    };
    const svc = new NotificationService(config, buildLogger() as never);

    const payload = makePayload({ reason: "impl_rejected", planConfidence: 0.9 });
    const result = await svc.sendHumanRequest(payload);

    expect(result.email).toEqual({ attempted: true, ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.resend.com/emails");
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({
      Authorization: "Bearer key-123",
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
    expect(body.to).toEqual(["human@example.com", "other@example.com"]);
    expect(body.subject).toBe(
      "[AgentForge] Implementation needs review (rejected by agent) — ENG-42: Fix the widget",
    );
    expect(body.html).toContain("Plan confidence:</strong> 0.90");
    expect(body.text).toContain("Plan confidence: 0.90");
  });

  it("catches an email failure response, records the error, and logs a warning", async () => {
    fetchMock.mockResolvedValue(jsonResponse(false, 422));
    const config: NotificationConfig = {
      emailFrom: "bot@example.com",
      emailTo: "human@example.com",
      resendApiKey: "key-123",
    };
    const logger = buildLogger();
    const svc = new NotificationService(config, logger as never);

    const result = await svc.sendHumanRequest(makePayload({ reason: "impl_uncertain" }));

    expect(result.email.ok).toBe(false);
    expect(result.email.error).toBe("Resend returned 422: error body from server");
    expect(logger.warn).toHaveBeenCalledWith(
      { runId: "run-1", error: "Resend returned 422: error body from server" },
      "Email notification failed",
    );
  });

  it("catches a non-Error thrown from the email fetch and stringifies it", async () => {
    fetchMock.mockRejectedValue(1234);
    const config: NotificationConfig = {
      emailFrom: "bot@example.com",
      emailTo: "human@example.com",
      resendApiKey: "key-123",
    };
    const logger = buildLogger();
    const svc = new NotificationService(config, logger as never);

    const result = await svc.sendHumanRequest(makePayload());

    expect(result.email.ok).toBe(false);
    expect(result.email.error).toBe("1234");
    expect(logger.warn).toHaveBeenCalledWith(
      { runId: "run-1", error: "1234" },
      "Email notification failed",
    );
  });

  it("attempts and succeeds at both Slack and email when both are configured", async () => {
    fetchMock.mockResolvedValue(jsonResponse(true));
    const config: NotificationConfig = {
      emailFrom: "bot@example.com",
      emailTo: "human@example.com",
      resendApiKey: "key-123",
      slackWebhookUrl: "https://hooks.slack.com/services/x",
    };
    const svc = new NotificationService(config, buildLogger() as never);

    const result = await svc.sendHumanRequest(makePayload({ reason: "plan_ambiguous" }));

    expect(result).toEqual({
      slack: { attempted: true, ok: true },
      email: { attempted: true, ok: true },
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("handles a response.text() rejection by falling back to an empty error body", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 503,
      text: () => Promise.reject(new Error("stream closed")),
    });
    const config: NotificationConfig = {
      emailFrom: "bot@example.com",
      slackWebhookUrl: "https://hooks.slack.com/services/x",
    };
    const logger = buildLogger();
    const svc = new NotificationService(config, logger as never);

    const result = await svc.sendHumanRequest(makePayload());

    expect(result.slack.error).toBe("Slack webhook returned 503: ");
  });
});

describe("NotificationService reason labels via email subject", () => {
  const reasons: [HumanRequestReason, string][] = [
    ["plan_ambiguous", "Plan needs review (ambiguous)"],
    ["plan_low_confidence", "Plan needs review (low confidence)"],
    ["impl_rejected", "Implementation needs review (rejected by agent)"],
    ["impl_uncertain", "Implementation needs review (uncertain)"],
    ["other", "Human intervention requested"],
  ];

  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue(jsonResponse(true));
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.each(reasons)("maps reason %s to the expected label", async (reason, expectedLabel) => {
    const config: NotificationConfig = {
      emailFrom: "bot@example.com",
      emailTo: "human@example.com",
      resendApiKey: "key-123",
    };
    const svc = new NotificationService(config, buildLogger() as never);

    await svc.sendHumanRequest(makePayload({ reason }));

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string) as { subject: string };
    expect(body.subject).toContain(expectedLabel);
  });
});

describe("NotificationService email rendering branches", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue(jsonResponse(true));
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function configWithEmail(): NotificationConfig {
    return {
      emailFrom: "bot@example.com",
      emailTo: "human@example.com",
      resendApiKey: "key-123",
    };
  }

  it("renders questions, context, confidence, and the Linear link when all are present, escaping HTML", async () => {
    const svc = new NotificationService(configWithEmail(), buildLogger() as never);

    const payload = makePayload({
      planConfidence: 0.5,
      context: "line one <script>alert('x')</script>",
      linearIssue: {
        id: "issue-3",
        identifier: "ENG-7",
        title: "<b>Bold</b> title & stuff",
        url: "https://linear.app/team/issue/ENG-7",
      },
      openQuestions: [
        { id: "q1", question: "Required one?", requiredForExecution: true },
        { id: "q2", question: "Optional one?", requiredForExecution: false },
      ],
    });

    await svc.sendHumanRequest(payload);

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string) as { html: string; text: string };

    expect(body.html).toContain("&lt;b&gt;Bold&lt;/b&gt; title &amp; stuff");
    expect(body.html).toContain("&lt;script&gt;alert(&#39;x&#39;)&lt;/script&gt;");
    expect(body.html).toContain("<strong>[required]</strong> Required one?");
    expect(body.html).toContain("Optional one?");
    expect(body.html).toContain("Plan confidence:</strong> 0.50");
    expect(body.html).toContain('<a href="https://linear.app/team/issue/ENG-7">Open Linear issue</a>');

    expect(body.text).toContain("[required] Required one?");
    expect(body.text).toContain("- Optional one?");
    expect(body.text).toContain("Plan confidence: 0.50");
    expect(body.text).toContain("Linear: https://linear.app/team/issue/ENG-7");
    expect(body.text).toContain("Context:");
  });

  it("omits questions, context, confidence, and the Linear link blocks when absent", async () => {
    const svc = new NotificationService(configWithEmail(), buildLogger() as never);

    const payload = makePayload({
      linearIssue: { id: "issue-4", title: null, url: null },
      openQuestions: [],
    });

    await svc.sendHumanRequest(payload);

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string) as { html: string; text: string };

    expect(body.html).not.toContain("Open Linear issue");
    expect(body.html).not.toContain("Plan confidence");
    expect(body.html).not.toContain("Context:");
    expect(body.html).not.toContain("Open questions");
    expect(body.html).toContain("(untitled)");

    expect(body.text).not.toContain("Linear:");
    expect(body.text).not.toContain("Plan confidence");
    expect(body.text).not.toContain("Context:");
    expect(body.text).not.toContain("Open questions:");
  });

  it("truncates a very long context in the email body", async () => {
    const svc = new NotificationService(configWithEmail(), buildLogger() as never);

    const longContext = "z".repeat(3000);
    await svc.sendHumanRequest(makePayload({ context: longContext }));

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string) as { html: string; text: string };

    expect(body.html).toContain("…");
    expect(body.text).toContain("…");
    expect(body.html).not.toContain("z".repeat(2000));
  });

  it("caps the rendered open questions list at 5 entries", async () => {
    const svc = new NotificationService(configWithEmail(), buildLogger() as never);

    const openQuestions = Array.from({ length: 7 }, (_, i) => ({
      id: `q${String(i)}`,
      question: `Question number ${String(i)}`,
      requiredForExecution: false,
    }));

    await svc.sendHumanRequest(makePayload({ openQuestions }));

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string) as { html: string; text: string };

    expect(body.html).toContain("Question number 4");
    expect(body.html).not.toContain("Question number 5");
    expect(body.text).toContain("Question number 4");
    expect(body.text).not.toContain("Question number 5");
  });
});
