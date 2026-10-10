import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  NotificationService,
  type NotificationConfig,
  type NotificationPayload,
  type HumanRequestReason,
} from "../../src/notifications/notificationService.js";

function buildLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
}

function makeConfig(overrides: Partial<NotificationConfig> = {}): NotificationConfig {
  return {
    emailFrom: "bot@agentforge.dev",
    ...overrides,
  };
}

function makePayload(overrides: Partial<NotificationPayload> = {}): NotificationPayload {
  return {
    runId: "run-1",
    reason: "other",
    summary: "Needs a human look",
    linearIssue: {
      id: "LIN-1",
      identifier: "ENG-42",
      title: "Fix the thing",
      url: "https://linear.app/team/issue/ENG-42",
    },
    runState: "AwaitingPlanApproval",
    runUrl: "https://agentforge.dev/runs/run-1",
    ...overrides,
  };
}

function okResponse(): Response {
  return { ok: true, status: 200, text: () => Promise.resolve("") } as unknown as Response;
}

function errorResponse(status: number, body: string): Response {
  return { ok: false, status, text: () => Promise.resolve(body) } as unknown as Response;
}

describe("NotificationService.isConfigured", () => {
  it("returns true when slackWebhookUrl is set", () => {
    const logger = buildLogger();
    const svc = new NotificationService(
      makeConfig({ slackWebhookUrl: "https://hooks.slack.com/x" }),
      logger as never,
    );
    expect(svc.isConfigured()).toBe(true);
  });

  it("returns true when emailTo and resendApiKey are both set (no slack)", () => {
    const logger = buildLogger();
    const svc = new NotificationService(
      makeConfig({ emailTo: "me@x.com", resendApiKey: "re_123" }),
      logger as never,
    );
    expect(svc.isConfigured()).toBe(true);
  });

  it("returns false when neither slack nor complete email config is set", () => {
    const logger = buildLogger();
    const svc = new NotificationService(makeConfig(), logger as never);
    expect(svc.isConfigured()).toBe(false);
  });

  it("returns false when only emailTo is set without resendApiKey", () => {
    const logger = buildLogger();
    const svc = new NotificationService(makeConfig({ emailTo: "me@x.com" }), logger as never);
    expect(svc.isConfigured()).toBe(false);
  });
});

describe("NotificationService.sendHumanRequest", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("resolves immediately with no attempts when neither slack nor email is configured", async () => {
    const logger = buildLogger();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const svc = new NotificationService(makeConfig(), logger as never);
    const result = await svc.sendHumanRequest(makePayload());

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result).toEqual({
      slack: { attempted: false, ok: false },
      email: { attempted: false, ok: false },
    });
  });

  it("succeeds for slack webhook", async () => {
    const logger = buildLogger();
    const fetchMock = vi.fn().mockResolvedValue(okResponse());
    vi.stubGlobal("fetch", fetchMock);

    const svc = new NotificationService(
      makeConfig({ slackWebhookUrl: "https://hooks.slack.com/x" }),
      logger as never,
    );
    const result = await svc.sendHumanRequest(makePayload());

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://hooks.slack.com/x",
      expect.objectContaining({ method: "POST" }),
    );
    expect(result.slack).toEqual({ attempted: true, ok: true });
    expect(result.email).toEqual({ attempted: false, ok: false });
  });

  it("records an error and warns when the slack webhook responds with ok:false", async () => {
    const logger = buildLogger();
    const fetchMock = vi.fn().mockResolvedValue(errorResponse(500, "server exploded"));
    vi.stubGlobal("fetch", fetchMock);

    const svc = new NotificationService(
      makeConfig({ slackWebhookUrl: "https://hooks.slack.com/x" }),
      logger as never,
    );
    const result = await svc.sendHumanRequest(makePayload());

    expect(result.slack.attempted).toBe(true);
    expect(result.slack.ok).toBe(false);
    expect(result.slack.error).toBe("Slack webhook returned 500: server exploded");
    expect(logger.warn).toHaveBeenCalledWith(
      { runId: "run-1", error: "Slack webhook returned 500: server exploded" },
      "Slack notification failed",
    );
  });

  it("records an error and warns when the slack fetch throws", async () => {
    const logger = buildLogger();
    const fetchMock = vi.fn().mockRejectedValue(new Error("network down"));
    vi.stubGlobal("fetch", fetchMock);

    const svc = new NotificationService(
      makeConfig({ slackWebhookUrl: "https://hooks.slack.com/x" }),
      logger as never,
    );
    const result = await svc.sendHumanRequest(makePayload());

    expect(result.slack.ok).toBe(false);
    expect(result.slack.error).toBe("network down");
    expect(logger.warn).toHaveBeenCalledWith(
      { runId: "run-1", error: "network down" },
      "Slack notification failed",
    );
  });

  it("succeeds for email via resend", async () => {
    const logger = buildLogger();
    const fetchMock = vi.fn().mockResolvedValue(okResponse());
    vi.stubGlobal("fetch", fetchMock);

    const svc = new NotificationService(
      makeConfig({ emailTo: "me@x.com", resendApiKey: "re_123" }),
      logger as never,
    );
    const result = await svc.sendHumanRequest(makePayload());

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.resend.com/emails",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ Authorization: "Bearer re_123" }),
      }),
    );
    expect(result.email).toEqual({ attempted: true, ok: true });
    expect(result.slack).toEqual({ attempted: false, ok: false });
  });

  it("records an error and warns when the resend response is ok:false", async () => {
    const logger = buildLogger();
    const fetchMock = vi.fn().mockResolvedValue(errorResponse(422, "bad payload"));
    vi.stubGlobal("fetch", fetchMock);

    const svc = new NotificationService(
      makeConfig({ emailTo: "me@x.com", resendApiKey: "re_123" }),
      logger as never,
    );
    const result = await svc.sendHumanRequest(makePayload());

    expect(result.email.ok).toBe(false);
    expect(result.email.error).toBe("Resend returned 422: bad payload");
    expect(logger.warn).toHaveBeenCalledWith(
      { runId: "run-1", error: "Resend returned 422: bad payload" },
      "Email notification failed",
    );
  });

  it("records an error and warns when the email fetch throws a non-Error value", async () => {
    const logger = buildLogger();
    const fetchMock = vi.fn().mockRejectedValue("raw-string-rejection");
    vi.stubGlobal("fetch", fetchMock);

    const svc = new NotificationService(
      makeConfig({ emailTo: "me@x.com", resendApiKey: "re_123" }),
      logger as never,
    );
    const result = await svc.sendHumanRequest(makePayload());

    expect(result.email.ok).toBe(false);
    expect(result.email.error).toBe("raw-string-rejection");
    expect(logger.warn).toHaveBeenCalledWith(
      { runId: "run-1", error: "raw-string-rejection" },
      "Email notification failed",
    );
  });

  it("attempts both slack and email when both are configured", async () => {
    const logger = buildLogger();
    const fetchMock = vi.fn().mockResolvedValue(okResponse());
    vi.stubGlobal("fetch", fetchMock);

    const svc = new NotificationService(
      makeConfig({
        slackWebhookUrl: "https://hooks.slack.com/x",
        emailTo: "me@x.com",
        resendApiKey: "re_123",
      }),
      logger as never,
    );
    const result = await svc.sendHumanRequest(makePayload());

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.slack).toEqual({ attempted: true, ok: true });
    expect(result.email).toEqual({ attempted: true, ok: true });
  });

  it("includes planConfidence, openQuestions, and context fields in the slack payload when present", async () => {
    const logger = buildLogger();
    const fetchMock = vi.fn().mockResolvedValue(okResponse());
    vi.stubGlobal("fetch", fetchMock);

    const svc = new NotificationService(
      makeConfig({ slackWebhookUrl: "https://hooks.slack.com/x" }),
      logger as never,
    );

    const payload = makePayload({
      reason: "plan_low_confidence",
      planConfidence: 0.42,
      context: "Some important <context> & \"quoted\" text",
      openQuestions: [
        { id: "q1", question: "What about edge case A?", requiredForExecution: true },
        { id: "q2", question: "What about edge case B?", requiredForExecution: false },
      ],
    });

    await svc.sendHumanRequest(payload);

    const call = fetchMock.mock.calls[0] as [string, { body: string }];
    const bodyJson = JSON.parse(call[1].body) as { text: string; blocks: unknown[] };

    expect(bodyJson.text).toContain("Plan needs review (low confidence)");
    expect(bodyJson.text).toContain("ENG-42");
    expect(bodyJson.text).toContain("Fix the thing");

    const bodyStr = call[1].body;
    expect(bodyStr).toContain("*Plan confidence:*\\n0.42");
    expect(bodyStr).toContain("*Open questions:*\\n2 (1 required)");
    expect(bodyStr).toContain("[required]");
    expect(bodyStr).toContain("What about edge case A?");
    expect(bodyStr).toContain("Some important <context> & \\\"quoted\\\" text");
    expect(bodyStr).toContain("Open Linear issue");
  });

  it("omits planConfidence, openQuestions, and context fields from the slack payload when absent", async () => {
    const logger = buildLogger();
    const fetchMock = vi.fn().mockResolvedValue(okResponse());
    vi.stubGlobal("fetch", fetchMock);

    const svc = new NotificationService(
      makeConfig({ slackWebhookUrl: "https://hooks.slack.com/x" }),
      logger as never,
    );

    const payload = makePayload({
      linearIssue: { id: "LIN-2", title: null, url: null },
    });

    await svc.sendHumanRequest(payload);

    const call = fetchMock.mock.calls[0] as [string, { body: string }];
    const bodyStr = call[1].body;

    expect(bodyStr).not.toContain("Plan confidence");
    expect(bodyStr).not.toContain("Open questions");
    expect(bodyStr).not.toContain("Context:");
    expect(bodyStr).not.toContain("Open Linear issue");
    expect(bodyStr).toContain("(untitled)");
    expect(bodyStr).toContain("LIN-2");
  });

  it("sends an email with html and text bodies reflecting the payload", async () => {
    const logger = buildLogger();
    const fetchMock = vi.fn().mockResolvedValue(okResponse());
    vi.stubGlobal("fetch", fetchMock);

    const svc = new NotificationService(
      makeConfig({ emailTo: "a@x.com, b@x.com", resendApiKey: "re_123" }),
      logger as never,
    );

    const payload = makePayload({
      reason: "impl_rejected",
      planConfidence: 0.8,
      context: "Some context",
      openQuestions: [{ id: "q1", question: "Why?", requiredForExecution: true }],
    });

    await svc.sendHumanRequest(payload);

    const call = fetchMock.mock.calls[0] as [string, { body: string }];
    const bodyJson = JSON.parse(call[1].body) as {
      from: string;
      to: string[];
      subject: string;
      html: string;
      text: string;
    };

    expect(bodyJson.to).toEqual(["a@x.com", "b@x.com"]);
    expect(bodyJson.subject).toContain("Implementation needs review (rejected by agent)");
    expect(bodyJson.html).toContain("<strong>Plan confidence:</strong> 0.80");
    expect(bodyJson.html).toContain("Open questions");
    expect(bodyJson.html).toContain("[required]");
    expect(bodyJson.text).toContain("Plan confidence: 0.80");
    expect(bodyJson.text).toContain("Open questions:");
    expect(bodyJson.text).toContain("- [required] Why?");
  });

  it("truncates an overly long context in both the slack and email bodies", async () => {
    const logger = buildLogger();
    const fetchMock = vi.fn().mockResolvedValue(okResponse());
    vi.stubGlobal("fetch", fetchMock);

    const longContext = "x".repeat(2500);

    const slackSvc = new NotificationService(
      makeConfig({ slackWebhookUrl: "https://hooks.slack.com/x" }),
      logger as never,
    );
    await slackSvc.sendHumanRequest(makePayload({ context: longContext }));
    const slackCall = fetchMock.mock.calls[0] as [string, { body: string }];
    const slackBody = JSON.parse(slackCall[1].body) as { blocks: { text?: { text: string } }[] };
    const slackContextBlock = slackBody.blocks.find((b) => b.text?.text.includes("*Context:*"));
    expect(slackContextBlock?.text?.text).toContain("…");
    expect(slackContextBlock?.text?.text.length).toBeLessThan(longContext.length);

    fetchMock.mockClear();
    const emailSvc = new NotificationService(
      makeConfig({ emailTo: "me@x.com", resendApiKey: "re_123" }),
      logger as never,
    );
    await emailSvc.sendHumanRequest(makePayload({ context: longContext }));
    const emailCall = fetchMock.mock.calls[0] as [string, { body: string }];
    const emailBodyJson = JSON.parse(emailCall[1].body) as { html: string; text: string };
    expect(emailBodyJson.html).toContain("…");
    expect(emailBodyJson.text).toContain("…");
  });

  it("omits the Linear issue link from both the email html and text bodies when linearIssue.url is absent", async () => {
    const logger = buildLogger();
    const fetchMock = vi.fn().mockResolvedValue(okResponse());
    vi.stubGlobal("fetch", fetchMock);

    const svc = new NotificationService(
      makeConfig({ emailTo: "me@x.com", resendApiKey: "re_123" }),
      logger as never,
    );

    const payload = makePayload({ linearIssue: { id: "LIN-3", title: "No url here", url: undefined } });
    await svc.sendHumanRequest(payload);

    const call = fetchMock.mock.calls[0] as [string, { body: string }];
    const bodyJson = JSON.parse(call[1].body) as { html: string; text: string };

    expect(bodyJson.html).not.toContain("Open Linear issue");
    expect(bodyJson.text).not.toContain("Linear:");
  });

  it("exercises all five reasonLabel branches across different payloads", async () => {
    const logger = buildLogger();
    const fetchMock = vi.fn().mockResolvedValue(okResponse());
    vi.stubGlobal("fetch", fetchMock);

    const svc = new NotificationService(
      makeConfig({ slackWebhookUrl: "https://hooks.slack.com/x" }),
      logger as never,
    );

    const cases: { reason: HumanRequestReason; expected: string }[] = [
      { reason: "plan_ambiguous", expected: "Plan needs review (ambiguous)" },
      { reason: "plan_low_confidence", expected: "Plan needs review (low confidence)" },
      { reason: "impl_rejected", expected: "Implementation needs review (rejected by agent)" },
      { reason: "impl_uncertain", expected: "Implementation needs review (uncertain)" },
      { reason: "other", expected: "Human intervention requested" },
    ];

    for (const { reason, expected } of cases) {
      fetchMock.mockClear();
      await svc.sendHumanRequest(makePayload({ reason }));
      const call = fetchMock.mock.calls[0] as [string, { body: string }];
      expect(call[1].body).toContain(expected);
    }
  });
});
