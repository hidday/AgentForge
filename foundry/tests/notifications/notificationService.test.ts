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
    summary: "Needs human input",
    linearIssue: {
      id: "issue-1",
      identifier: "PRY-1",
      title: "Some issue",
      url: "https://linear.app/team/issue/PRY-1",
    },
    runState: "AwaitingPlanApproval",
    runUrl: "https://app.example.com/runs/run-1",
    ...overrides,
  };
}

function jsonResponse(ok: boolean, status = 200, text = "") {
  return {
    ok,
    status,
    text: vi.fn().mockResolvedValue(text),
  };
}

describe("NotificationService.isConfigured", () => {
  const logger = makeLogger();

  it("returns true when a slack webhook url is configured", () => {
    const service = new NotificationService(
      { emailFrom: "from@example.com", slackWebhookUrl: "https://hooks.slack.com/x" },
      logger as never,
    );
    expect(service.isConfigured()).toBe(true);
  });

  it("returns true when emailTo and resendApiKey are both configured", () => {
    const service = new NotificationService(
      { emailFrom: "from@example.com", emailTo: "to@example.com", resendApiKey: "key" },
      logger as never,
    );
    expect(service.isConfigured()).toBe(true);
  });

  it("returns false when emailTo is set but resendApiKey is missing", () => {
    const service = new NotificationService(
      { emailFrom: "from@example.com", emailTo: "to@example.com" },
      logger as never,
    );
    expect(service.isConfigured()).toBe(false);
  });

  it("returns false when neither slack nor email is configured", () => {
    const service = new NotificationService({ emailFrom: "from@example.com" }, logger as never);
    expect(service.isConfigured()).toBe(false);
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

  it("returns both attempted=false when no channels are configured, and calls no fetch", async () => {
    const service = new NotificationService({ emailFrom: "from@example.com" }, makeLogger() as never);

    const result = await service.sendHumanRequest(makePayload());

    expect(result).toEqual({
      slack: { attempted: false, ok: false },
      email: { attempted: false, ok: false },
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sends a slack notification and reports ok:true on success", async () => {
    fetchMock.mockResolvedValue(jsonResponse(true));
    const config: NotificationConfig = {
      emailFrom: "from@example.com",
      slackWebhookUrl: "https://hooks.slack.com/x",
    };
    const service = new NotificationService(config, makeLogger() as never);

    const result = await service.sendHumanRequest(makePayload());

    expect(result.slack).toEqual({ attempted: true, ok: true });
    expect(result.email).toEqual({ attempted: false, ok: false });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://hooks.slack.com/x",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
      }),
    );
    const body = JSON.parse((fetchMock.mock.calls[0][1] as { body: string }).body);
    expect(body.text).toContain("PRY-1");
    expect(body.blocks[0].text.text).toContain("Plan needs review (ambiguous)");
  });

  it("reports ok:false with an error message and logs a warning when slack responds non-ok", async () => {
    fetchMock.mockResolvedValue(jsonResponse(false, 500, "server exploded"));
    const logger = makeLogger();
    const config: NotificationConfig = {
      emailFrom: "from@example.com",
      slackWebhookUrl: "https://hooks.slack.com/x",
    };
    const service = new NotificationService(config, logger as never);

    const result = await service.sendHumanRequest(makePayload());

    expect(result.slack.ok).toBe(false);
    expect(result.slack.error).toContain("Slack webhook returned 500");
    expect(result.slack.error).toContain("server exploded");
    expect(logger.warn).toHaveBeenCalledWith(
      { runId: "run-1", error: result.slack.error },
      "Slack notification failed",
    );
  });

  it("swallows a slack response.text() failure and still reports the status code", async () => {
    const response = {
      ok: false,
      status: 502,
      text: vi.fn().mockRejectedValue(new Error("stream closed")),
    };
    fetchMock.mockResolvedValue(response);
    const config: NotificationConfig = {
      emailFrom: "from@example.com",
      slackWebhookUrl: "https://hooks.slack.com/x",
    };
    const service = new NotificationService(config, makeLogger() as never);

    const result = await service.sendHumanRequest(makePayload());

    expect(result.slack.ok).toBe(false);
    expect(result.slack.error).toContain("Slack webhook returned 502");
  });

  it("reports ok:false when the slack fetch call itself throws", async () => {
    fetchMock.mockRejectedValue(new Error("network down"));
    const config: NotificationConfig = {
      emailFrom: "from@example.com",
      slackWebhookUrl: "https://hooks.slack.com/x",
    };
    const service = new NotificationService(config, makeLogger() as never);

    const result = await service.sendHumanRequest(makePayload());

    expect(result.slack.ok).toBe(false);
    expect(result.slack.error).toBe("network down");
  });

  it("handles a non-Error slack rejection by stringifying it", async () => {
    fetchMock.mockRejectedValue("weird failure");
    const config: NotificationConfig = {
      emailFrom: "from@example.com",
      slackWebhookUrl: "https://hooks.slack.com/x",
    };
    const service = new NotificationService(config, makeLogger() as never);

    const result = await service.sendHumanRequest(makePayload());

    expect(result.slack.error).toBe("weird failure");
  });

  it("includes plan confidence, context, and open questions in the slack payload", async () => {
    fetchMock.mockResolvedValue(jsonResponse(true));
    const config: NotificationConfig = {
      emailFrom: "from@example.com",
      slackWebhookUrl: "https://hooks.slack.com/x",
    };
    const service = new NotificationService(config, makeLogger() as never);

    const longContext = "x".repeat(2000);
    await service.sendHumanRequest(
      makePayload({
        planConfidence: 0.42,
        context: longContext,
        openQuestions: [
          { id: "q1", question: "Is this required?", requiredForExecution: true },
          { id: "q2", question: "Optional question", requiredForExecution: false },
          { id: "q3", question: "Third question", requiredForExecution: false },
          { id: "q4", question: "Fourth question, should be excluded from the 3-item slice", requiredForExecution: false },
        ],
      }),
    );

    const body = JSON.parse((fetchMock.mock.calls[0][1] as { body: string }).body);
    const allText = JSON.stringify(body);
    expect(allText).toContain("0.42");
    expect(allText).toContain("Open questions:");
    // The summary count reflects all open questions (4), not just the
    // 3-item slice rendered in the "Questions:" detail section below.
    expect(allText).toContain("4 (1 required)");
    expect(allText).toContain("[required] Is this required?");
    // Context should be truncated to 1500 chars with an ellipsis.
    const contextSection = body.blocks.find((b: { text?: { text: string } }) =>
      b.text?.text?.includes("*Context:*"),
    );
    expect(contextSection.text.text.length).toBeLessThan(longContext.length);
    expect(contextSection.text.text).toContain("…");
    // Only first 3 questions should be listed.
    expect(allText).not.toContain("Fourth question");
  });

  it("omits the Linear issue button when linearIssue.url is absent", async () => {
    fetchMock.mockResolvedValue(jsonResponse(true));
    const config: NotificationConfig = {
      emailFrom: "from@example.com",
      slackWebhookUrl: "https://hooks.slack.com/x",
    };
    const service = new NotificationService(config, makeLogger() as never);

    await service.sendHumanRequest(
      makePayload({ linearIssue: { id: "issue-2", title: null, url: null } }),
    );

    const body = JSON.parse((fetchMock.mock.calls[0][1] as { body: string }).body);
    const actions = body.blocks.find((b: { type: string }) => b.type === "actions");
    expect(actions.elements).toHaveLength(1);
    expect(actions.elements[0].text.text).toBe("Open run");
    expect(body.text).toContain("(untitled)");
  });

  it("sends an email notification and reports ok:true on success", async () => {
    fetchMock.mockResolvedValue(jsonResponse(true));
    const config: NotificationConfig = {
      emailFrom: "from@example.com",
      emailTo: "a@example.com, b@example.com",
      resendApiKey: "resend-key",
    };
    const service = new NotificationService(config, makeLogger() as never);

    const result = await service.sendHumanRequest(makePayload());

    expect(result.email).toEqual({ attempted: true, ok: true });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.resend.com/emails",
      expect.objectContaining({
        method: "POST",
        headers: {
          Authorization: "Bearer resend-key",
          "Content-Type": "application/json",
        },
      }),
    );
    const body = JSON.parse((fetchMock.mock.calls[0][1] as { body: string }).body);
    expect(body.to).toEqual(["a@example.com", "b@example.com"]);
    expect(body.from).toBe("from@example.com");
    expect(body.subject).toContain("[AgentForge]");
    expect(body.html).toContain("<html>");
    expect(body.text).toContain("PRY-1");
  });

  it("reports ok:false with an error and logs a warning when resend responds non-ok", async () => {
    fetchMock.mockResolvedValue(jsonResponse(false, 422, "invalid recipient"));
    const logger = makeLogger();
    const config: NotificationConfig = {
      emailFrom: "from@example.com",
      emailTo: "a@example.com",
      resendApiKey: "resend-key",
    };
    const service = new NotificationService(config, logger as never);

    const result = await service.sendHumanRequest(makePayload());

    expect(result.email.ok).toBe(false);
    expect(result.email.error).toContain("Resend returned 422");
    expect(result.email.error).toContain("invalid recipient");
    expect(logger.warn).toHaveBeenCalledWith(
      { runId: "run-1", error: result.email.error },
      "Email notification failed",
    );
  });

  it("reports ok:false when the email fetch call throws", async () => {
    fetchMock.mockRejectedValue(new Error("dns failure"));
    const config: NotificationConfig = {
      emailFrom: "from@example.com",
      emailTo: "a@example.com",
      resendApiKey: "resend-key",
    };
    const service = new NotificationService(config, makeLogger() as never);

    const result = await service.sendHumanRequest(makePayload());

    expect(result.email.ok).toBe(false);
    expect(result.email.error).toBe("dns failure");
  });

  it("handles a non-Error email rejection by stringifying it", async () => {
    fetchMock.mockRejectedValue("email transport exploded");
    const config: NotificationConfig = {
      emailFrom: "from@example.com",
      emailTo: "a@example.com",
      resendApiKey: "resend-key",
    };
    const service = new NotificationService(config, makeLogger() as never);

    const result = await service.sendHumanRequest(makePayload());

    expect(result.email.ok).toBe(false);
    expect(result.email.error).toBe("email transport exploded");
  });

  it("sends both slack and email concurrently when both are configured", async () => {
    fetchMock.mockResolvedValue(jsonResponse(true));
    const config: NotificationConfig = {
      emailFrom: "from@example.com",
      slackWebhookUrl: "https://hooks.slack.com/x",
      emailTo: "a@example.com",
      resendApiKey: "resend-key",
    };
    const service = new NotificationService(config, makeLogger() as never);

    const result = await service.sendHumanRequest(makePayload());

    expect(result.slack.ok).toBe(true);
    expect(result.email.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it.each([
    ["plan_ambiguous", "Plan needs review (ambiguous)"],
    ["plan_low_confidence", "Plan needs review (low confidence)"],
    ["impl_rejected", "Implementation needs review (rejected by agent)"],
    ["impl_uncertain", "Implementation needs review (uncertain)"],
    ["other", "Human intervention requested"],
  ] as const)("renders the correct label for reason=%s", async (reason, expectedLabel) => {
    fetchMock.mockResolvedValue(jsonResponse(true));
    const config: NotificationConfig = {
      emailFrom: "from@example.com",
      slackWebhookUrl: "https://hooks.slack.com/x",
    };
    const service = new NotificationService(config, makeLogger() as never);

    await service.sendHumanRequest(makePayload({ reason }));

    const body = JSON.parse((fetchMock.mock.calls[0][1] as { body: string }).body);
    expect(body.text).toContain(expectedLabel);
  });

  it("escapes HTML-sensitive characters in the rendered email body", async () => {
    fetchMock.mockResolvedValue(jsonResponse(true));
    const config: NotificationConfig = {
      emailFrom: "from@example.com",
      emailTo: "a@example.com",
      resendApiKey: "resend-key",
    };
    const service = new NotificationService(config, makeLogger() as never);

    await service.sendHumanRequest(
      makePayload({
        summary: `<script>alert("xss")</script> & 'quoted'`,
        linearIssue: {
          id: "issue-1",
          identifier: "PRY-1",
          title: `Title with <b>tags</b> & "quotes"`,
          url: "https://linear.app/team/issue/PRY-1",
        },
      }),
    );

    const body = JSON.parse((fetchMock.mock.calls[0][1] as { body: string }).body);
    expect(body.html).not.toContain("<script>alert(\"xss\")</script>");
    expect(body.html).toContain("&lt;script&gt;");
    expect(body.html).toContain("&amp;");
    expect(body.html).toContain("&#39;quoted&#39;");
    expect(body.html).toContain("&lt;b&gt;tags&lt;/b&gt;");
    expect(body.html).toContain("&quot;quotes&quot;");
  });

  it("renders email open questions, context, and confidence blocks when present", async () => {
    fetchMock.mockResolvedValue(jsonResponse(true));
    const config: NotificationConfig = {
      emailFrom: "from@example.com",
      emailTo: "a@example.com",
      resendApiKey: "resend-key",
    };
    const service = new NotificationService(config, makeLogger() as never);
    const longContext = "y".repeat(3000);

    await service.sendHumanRequest(
      makePayload({
        planConfidence: 0.85,
        context: longContext,
        openQuestions: [
          { id: "q1", question: "Required one", requiredForExecution: true },
          { id: "q2", question: "Not required", requiredForExecution: false },
        ],
      }),
    );

    const body = JSON.parse((fetchMock.mock.calls[0][1] as { body: string }).body);
    expect(body.html).toContain("Plan confidence:</strong> 0.85");
    expect(body.html).toContain("<strong>[required]</strong> Required one");
    expect(body.html).toContain("Not required");
    expect(body.html).toContain("…");
    expect(body.text).toContain("Plan confidence: 0.85");
    expect(body.text).toContain("[required] Required one");
    expect(body.text).toContain("- Not required");
  });

  it("omits confidence, context, and questions blocks from the email when absent", async () => {
    fetchMock.mockResolvedValue(jsonResponse(true));
    const config: NotificationConfig = {
      emailFrom: "from@example.com",
      emailTo: "a@example.com",
      resendApiKey: "resend-key",
    };
    const service = new NotificationService(config, makeLogger() as never);

    await service.sendHumanRequest(
      makePayload({ linearIssue: { id: "issue-1", title: null, url: null } }),
    );

    const body = JSON.parse((fetchMock.mock.calls[0][1] as { body: string }).body);
    expect(body.html).not.toContain("Plan confidence");
    expect(body.html).not.toContain("Open questions");
    expect(body.html).not.toContain("Context:");
    expect(body.text).not.toContain("Linear:");
  });
});
