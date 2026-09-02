import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  NotificationService,
  type NotificationConfig,
  type NotificationPayload,
} from "../../src/notifications/notificationService.js";

function buildLogger() {
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
    summary: "The plan has an ambiguous requirement.",
    linearIssue: {
      id: "LIN-1",
      identifier: "ENG-1",
      title: "Build the widget",
      url: "https://linear.app/acme/issue/ENG-1",
    },
    runState: "AwaitingPlanApproval",
    runUrl: "https://foundry.acme.dev/runs/run-1",
    ...overrides,
  };
}

function okResponse(): Response {
  return { ok: true, text: () => Promise.resolve("") } as unknown as Response;
}

function failResponse(status: number, body = "error body"): Response {
  return {
    ok: false,
    status,
    text: () => Promise.resolve(body),
  } as unknown as Response;
}

describe("NotificationService.isConfigured", () => {
  const logger = buildLogger();

  it("is true when a Slack webhook URL is configured", () => {
    const svc = new NotificationService(
      { emailFrom: "noreply@acme.dev", slackWebhookUrl: "https://hooks.slack.com/x" },
      logger as never,
    );
    expect(svc.isConfigured()).toBe(true);
  });

  it("is true when both emailTo and resendApiKey are configured", () => {
    const svc = new NotificationService(
      { emailFrom: "noreply@acme.dev", emailTo: "team@acme.dev", resendApiKey: "key" },
      logger as never,
    );
    expect(svc.isConfigured()).toBe(true);
  });

  it("is false when emailTo is set but resendApiKey is missing", () => {
    const svc = new NotificationService(
      { emailFrom: "noreply@acme.dev", emailTo: "team@acme.dev" },
      logger as never,
    );
    expect(svc.isConfigured()).toBe(false);
  });

  it("is false when resendApiKey is set but emailTo is missing", () => {
    const svc = new NotificationService(
      { emailFrom: "noreply@acme.dev", resendApiKey: "key" },
      logger as never,
    );
    expect(svc.isConfigured()).toBe(false);
  });

  it("is false when no channel is configured", () => {
    const svc = new NotificationService({ emailFrom: "noreply@acme.dev" }, logger as never);
    expect(svc.isConfigured()).toBe(false);
  });
});

describe("NotificationService.sendHumanRequest", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let logger: ReturnType<typeof buildLogger>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    logger = buildLogger();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function fullConfig(overrides: Partial<NotificationConfig> = {}): NotificationConfig {
    return {
      emailFrom: "noreply@acme.dev",
      emailTo: "team@acme.dev",
      slackWebhookUrl: "https://hooks.slack.com/services/x",
      resendApiKey: "resend-key",
      ...overrides,
    };
  }

  it("attempts neither channel and returns all-false when nothing is configured", async () => {
    const svc = new NotificationService({ emailFrom: "noreply@acme.dev" }, logger as never);

    const result = await svc.sendHumanRequest(makePayload());

    expect(result).toEqual({
      slack: { attempted: false, ok: false },
      email: { attempted: false, ok: false },
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sends only Slack when only the Slack webhook is configured, and reports ok:true on success", async () => {
    fetchMock.mockResolvedValue(okResponse());
    const svc = new NotificationService(
      { emailFrom: "noreply@acme.dev", slackWebhookUrl: "https://hooks.slack.com/services/x" },
      logger as never,
    );

    const result = await svc.sendHumanRequest(makePayload());

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://hooks.slack.com/services/x",
      expect.objectContaining({ method: "POST" }),
    );
    expect(result.slack).toEqual({ attempted: true, ok: true });
    expect(result.email).toEqual({ attempted: false, ok: false });
  });

  it("sends only email when only email is configured, and reports ok:true on success", async () => {
    fetchMock.mockResolvedValue(okResponse());
    const svc = new NotificationService(
      { emailFrom: "noreply@acme.dev", emailTo: "team@acme.dev", resendApiKey: "resend-key" },
      logger as never,
    );

    const result = await svc.sendHumanRequest(makePayload());

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.resend.com/emails",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ Authorization: "Bearer resend-key" }),
      }),
    );
    expect(result.email).toEqual({ attempted: true, ok: true });
    expect(result.slack).toEqual({ attempted: false, ok: false });
  });

  it("sends both channels concurrently when both are configured", async () => {
    fetchMock.mockResolvedValue(okResponse());
    const svc = new NotificationService(fullConfig(), logger as never);

    const result = await svc.sendHumanRequest(makePayload());

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.slack.ok).toBe(true);
    expect(result.email.ok).toBe(true);
  });

  it("marks slack as failed with the response status/body when the webhook returns non-ok, and logs a warning", async () => {
    fetchMock.mockResolvedValue(failResponse(500, "server exploded"));
    const svc = new NotificationService(
      { emailFrom: "noreply@acme.dev", slackWebhookUrl: "https://hooks.slack.com/services/x" },
      logger as never,
    );

    const result = await svc.sendHumanRequest(makePayload({ runId: "run-7" }));

    expect(result.slack).toEqual({
      attempted: true,
      ok: false,
      error: "Slack webhook returned 500: server exploded",
    });
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ runId: "run-7", error: expect.stringContaining("500") }),
      "Slack notification failed",
    );
  });

  it("marks email as failed with the response status/body when Resend returns non-ok, and logs a warning", async () => {
    fetchMock.mockResolvedValue(failResponse(422, "invalid recipient"));
    const svc = new NotificationService(
      { emailFrom: "noreply@acme.dev", emailTo: "team@acme.dev", resendApiKey: "resend-key" },
      logger as never,
    );

    const result = await svc.sendHumanRequest(makePayload({ runId: "run-8" }));

    expect(result.email).toEqual({
      attempted: true,
      ok: false,
      error: "Resend returned 422: invalid recipient",
    });
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ runId: "run-8", error: expect.stringContaining("422") }),
      "Email notification failed",
    );
  });

  it("marks slack as failed when fetch itself rejects (network error)", async () => {
    fetchMock.mockRejectedValue(new TypeError("network down"));
    const svc = new NotificationService(
      { emailFrom: "noreply@acme.dev", slackWebhookUrl: "https://hooks.slack.com/services/x" },
      logger as never,
    );

    const result = await svc.sendHumanRequest(makePayload());

    expect(result.slack).toEqual({ attempted: true, ok: false, error: "network down" });
  });

  it("falls back to String(err) when the thrown value is not an Error instance", async () => {
    fetchMock.mockRejectedValue("raw string failure");
    const svc = new NotificationService(
      { emailFrom: "noreply@acme.dev", slackWebhookUrl: "https://hooks.slack.com/services/x" },
      logger as never,
    );

    const result = await svc.sendHumanRequest(makePayload());

    expect(result.slack.error).toBe("raw string failure");
  });

  it("falls back to String(err) for email when the thrown value is not an Error instance", async () => {
    fetchMock.mockRejectedValue({ weird: "non-error rejection" });
    const svc = new NotificationService(
      { emailFrom: "noreply@acme.dev", emailTo: "team@acme.dev", resendApiKey: "resend-key" },
      logger as never,
    );

    const result = await svc.sendHumanRequest(makePayload());

    expect(result.email.error).toBe(String({ weird: "non-error rejection" }));
  });

  it("does not let a Slack failure prevent the email result from being reported", async () => {
    fetchMock.mockImplementation((url: string) => {
      if (url.includes("slack")) return Promise.reject(new Error("slack down"));
      return Promise.resolve(okResponse());
    });
    const svc = new NotificationService(fullConfig(), logger as never);

    const result = await svc.sendHumanRequest(makePayload());

    expect(result.slack.ok).toBe(false);
    expect(result.email.ok).toBe(true);
  });

  it("truncates the response body used in the Slack error message to 200 characters", async () => {
    fetchMock.mockResolvedValue(failResponse(500, "x".repeat(500)));
    const svc = new NotificationService(
      { emailFrom: "noreply@acme.dev", slackWebhookUrl: "https://hooks.slack.com/services/x" },
      logger as never,
    );

    const result = await svc.sendHumanRequest(makePayload());

    // "Slack webhook returned 500: " (28 chars) + 200 x's
    expect(result.slack.error?.length).toBe(28 + 200);
  });

  it("splits and trims comma-separated recipients for email, dropping empty entries", async () => {
    fetchMock.mockResolvedValue(okResponse());
    const svc = new NotificationService(
      {
        emailFrom: "noreply@acme.dev",
        emailTo: " a@acme.dev , b@acme.dev,, c@acme.dev ",
        resendApiKey: "resend-key",
      },
      logger as never,
    );

    await svc.sendHumanRequest(makePayload());

    const [, init] = fetchMock.mock.calls[0] as [string, { body: string }];
    const body = JSON.parse(init.body) as { to: string[] };
    expect(body.to).toEqual(["a@acme.dev", "b@acme.dev", "c@acme.dev"]);
  });

  it("includes plan confidence and open questions in the Slack payload when present", async () => {
    fetchMock.mockResolvedValue(okResponse());
    const svc = new NotificationService(
      { emailFrom: "noreply@acme.dev", slackWebhookUrl: "https://hooks.slack.com/services/x" },
      logger as never,
    );

    await svc.sendHumanRequest(
      makePayload({
        reason: "plan_low_confidence",
        planConfidence: 0.42,
        context: "a".repeat(2000),
        openQuestions: [
          { id: "q1", question: "Which auth flow?", requiredForExecution: true },
          { id: "q2", question: "Which region?", requiredForExecution: false },
          { id: "q3", question: "Extra one", requiredForExecution: false },
          { id: "q4", question: "Overflow one", requiredForExecution: false },
        ],
      }),
    );

    const [, init] = fetchMock.mock.calls[0] as [string, { body: string }];
    const body = JSON.parse(init.body) as { text: string; blocks: unknown[] };
    expect(body.text).toContain("Plan needs review (low confidence)");
    const serialized = JSON.stringify(body.blocks);
    expect(serialized).toContain("Plan confidence");
    expect(serialized).toContain("0.42");
    expect(serialized).toContain("Open questions");
    expect(serialized).toContain("4 (1 required)");
    // Only the first 3 questions are rendered as detail lines.
    expect(serialized).toContain("Which auth flow?");
    expect(serialized).not.toContain("Overflow one");
    // Long context is truncated with an ellipsis.
    expect(serialized).toContain("…");
  });

  it("omits optional Slack blocks (confidence, questions, context, issue link) when absent", async () => {
    fetchMock.mockResolvedValue(okResponse());
    const svc = new NotificationService(
      { emailFrom: "noreply@acme.dev", slackWebhookUrl: "https://hooks.slack.com/services/x" },
      logger as never,
    );

    await svc.sendHumanRequest(
      makePayload({
        planConfidence: undefined,
        openQuestions: undefined,
        context: undefined,
        linearIssue: { id: "LIN-1", title: null, url: null },
      }),
    );

    const [, init] = fetchMock.mock.calls[0] as [string, { body: string }];
    const body = JSON.parse(init.body) as { text: string; blocks: unknown[] };
    expect(body.text).toContain("(untitled)");
    expect(body.text).toContain("LIN-1");
    const serialized = JSON.stringify(body.blocks);
    expect(serialized).not.toContain("Plan confidence");
    expect(serialized).not.toContain("Context:");
    expect(serialized).not.toContain("Open Linear issue");
    // Only one action button (Open run) when the issue has no URL.
    const actionsBlock = (body.blocks as { type: string; elements?: unknown[] }[]).find(
      (b) => b.type === "actions",
    );
    expect(actionsBlock?.elements).toHaveLength(1);
  });

  it("does not render an open-questions detail block when the array is empty", async () => {
    fetchMock.mockResolvedValue(okResponse());
    const svc = new NotificationService(
      { emailFrom: "noreply@acme.dev", slackWebhookUrl: "https://hooks.slack.com/services/x" },
      logger as never,
    );

    await svc.sendHumanRequest(makePayload({ openQuestions: [] }));

    const [, init] = fetchMock.mock.calls[0] as [string, { body: string }];
    const body = JSON.parse(init.body) as { blocks: unknown[] };
    expect(JSON.stringify(body.blocks)).not.toContain("Open questions");
  });

  it("renders every reason label distinctly in the Slack title", async () => {
    fetchMock.mockResolvedValue(okResponse());
    const svc = new NotificationService(
      { emailFrom: "noreply@acme.dev", slackWebhookUrl: "https://hooks.slack.com/services/x" },
      logger as never,
    );
    const reasons: NotificationPayload["reason"][] = [
      "plan_ambiguous",
      "plan_low_confidence",
      "impl_rejected",
      "impl_uncertain",
      "other",
    ];

    const seenTitles = new Set<string>();
    for (const reason of reasons) {
      fetchMock.mockClear();
      await svc.sendHumanRequest(makePayload({ reason }));
      const [, init] = fetchMock.mock.calls[0] as [string, { body: string }];
      const body = JSON.parse(init.body) as { text: string };
      seenTitles.add(body.text);
    }

    expect(seenTitles.size).toBe(reasons.length);
  });

  it("builds an HTML and text email body containing the issue, state, summary and links", async () => {
    fetchMock.mockResolvedValue(okResponse());
    const svc = new NotificationService(
      { emailFrom: "noreply@acme.dev", emailTo: "team@acme.dev", resendApiKey: "resend-key" },
      logger as never,
    );

    await svc.sendHumanRequest(
      makePayload({
        reason: "impl_rejected",
        planConfidence: 0.8,
        context: "Some <b>raw</b> context & \"quotes\"",
        openQuestions: [
          { id: "q1", question: "Q1?", requiredForExecution: true },
          { id: "q2", question: "Q2?", requiredForExecution: false },
        ],
      }),
    );

    const [, init] = fetchMock.mock.calls[0] as [string, { body: string }];
    const body = JSON.parse(init.body) as { html: string; text: string; subject: string };
    expect(body.subject).toContain("[AgentForge]");
    expect(body.subject).toContain("Implementation needs review (rejected by agent)");
    // HTML-escapes raw context to avoid injection.
    expect(body.html).toContain("&lt;b&gt;raw&lt;/b&gt;");
    expect(body.html).toContain("&amp;");
    expect(body.html).toContain("&quot;quotes&quot;");
    expect(body.html).toContain("Plan confidence");
    expect(body.html).toContain("0.80");
    expect(body.html).toContain(payloadRunUrlEscaped());
    expect(body.html).toContain("Open Linear issue");
    // Plain-text body includes the same substantive content, unescaped.
    expect(body.text).toContain("Q1?");
    expect(body.text).toContain("Q2?");
    expect(body.text).toContain("Plan confidence: 0.80");
    expect(body.text).toContain("Linear:");

    function payloadRunUrlEscaped(): string {
      return "https://foundry.acme.dev/runs/run-1";
    }
  });

  it("omits the email confidence line, context block and Linear link when absent", async () => {
    fetchMock.mockResolvedValue(okResponse());
    const svc = new NotificationService(
      { emailFrom: "noreply@acme.dev", emailTo: "team@acme.dev", resendApiKey: "resend-key" },
      logger as never,
    );

    await svc.sendHumanRequest(
      makePayload({
        planConfidence: undefined,
        context: undefined,
        linearIssue: { id: "LIN-1", title: null, url: null },
      }),
    );

    const [, init] = fetchMock.mock.calls[0] as [string, { body: string }];
    const body = JSON.parse(init.body) as { html: string; text: string };
    expect(body.html).not.toContain("Plan confidence");
    expect(body.html).not.toContain("Context:");
    expect(body.html).not.toContain("Open Linear issue");
    expect(body.text).not.toContain("Plan confidence");
    expect(body.text).not.toContain("Context:");
    expect(body.text).not.toContain("Linear:");
  });

  it("truncates long context in the email body to 2000 characters", async () => {
    fetchMock.mockResolvedValue(okResponse());
    const svc = new NotificationService(
      { emailFrom: "noreply@acme.dev", emailTo: "team@acme.dev", resendApiKey: "resend-key" },
      logger as never,
    );

    await svc.sendHumanRequest(makePayload({ context: "y".repeat(3000) }));

    const [, init] = fetchMock.mock.calls[0] as [string, { body: string }];
    const body = JSON.parse(init.body) as { text: string };
    const contextLineIndex = body.text.indexOf("Context:");
    const afterContext = body.text.slice(contextLineIndex);
    expect(afterContext).toContain("…");
  });
});
