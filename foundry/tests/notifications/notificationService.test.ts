import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  NotificationService,
  type NotificationConfig,
  type NotificationPayload,
} from "../../src/notifications/notificationService.js";

function makeLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
}

function makePayload(overrides: Partial<NotificationPayload> = {}): NotificationPayload {
  return {
    runId: "run-1",
    reason: "plan_ambiguous",
    summary: "The plan has ambiguous requirements.",
    linearIssue: {
      id: "lin-1",
      identifier: "ENG-42",
      title: "Implement feature X",
      url: "https://linear.app/team/issue/ENG-42",
    },
    runState: "AwaitingPlanApproval",
    runUrl: "https://agentforge.example.com/runs/run-1",
    ...overrides,
  };
}

describe("NotificationService.isConfigured", () => {
  it("returns true when slackWebhookUrl is set", () => {
    const service = new NotificationService(
      { emailFrom: "noreply@example.com", slackWebhookUrl: "https://hooks.slack.com/x" },
      makeLogger() as never,
    );
    expect(service.isConfigured()).toBe(true);
  });

  it("returns true when emailTo and resendApiKey are both set", () => {
    const service = new NotificationService(
      { emailFrom: "noreply@example.com", emailTo: "ops@example.com", resendApiKey: "key-1" },
      makeLogger() as never,
    );
    expect(service.isConfigured()).toBe(true);
  });

  it("returns false when emailTo is set but resendApiKey is missing", () => {
    const service = new NotificationService(
      { emailFrom: "noreply@example.com", emailTo: "ops@example.com" },
      makeLogger() as never,
    );
    expect(service.isConfigured()).toBe(false);
  });

  it("returns false when nothing is configured", () => {
    const service = new NotificationService(
      { emailFrom: "noreply@example.com" },
      makeLogger() as never,
    );
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

  it("does not attempt slack or email when neither is configured", async () => {
    const config: NotificationConfig = { emailFrom: "noreply@example.com" };
    const service = new NotificationService(config, makeLogger() as never);

    const result = await service.sendHumanRequest(makePayload());

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result).toEqual({
      slack: { attempted: false, ok: false },
      email: { attempted: false, ok: false },
    });
  });

  it("sends a successful slack notification and reports ok=true", async () => {
    fetchMock.mockResolvedValue({ ok: true });
    const config: NotificationConfig = {
      emailFrom: "noreply@example.com",
      slackWebhookUrl: "https://hooks.slack.com/x",
    };
    const service = new NotificationService(config, makeLogger() as never);

    const result = await service.sendHumanRequest(makePayload());

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://hooks.slack.com/x");
    expect(init.method).toBe("POST");
    const body = JSON.parse(init.body as string);
    expect(body.text).toContain("ENG-42");
    expect(body.text).toContain("Implement feature X");
    expect(result.slack).toEqual({ attempted: true, ok: true });
    expect(result.email).toEqual({ attempted: false, ok: false });
  });

  it("records a slack failure with error message on non-ok response", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500, text: () => Promise.resolve("boom") });
    const logger = makeLogger();
    const config: NotificationConfig = {
      emailFrom: "noreply@example.com",
      slackWebhookUrl: "https://hooks.slack.com/x",
    };
    const service = new NotificationService(config, logger as never);

    const result = await service.sendHumanRequest(makePayload());

    expect(result.slack.attempted).toBe(true);
    expect(result.slack.ok).toBe(false);
    expect(result.slack.error).toContain("500");
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ runId: "run-1" }),
      "Slack notification failed",
    );
  });

  it("records a slack failure when fetch itself rejects (network error)", async () => {
    fetchMock.mockRejectedValue(new Error("network down"));
    const config: NotificationConfig = {
      emailFrom: "noreply@example.com",
      slackWebhookUrl: "https://hooks.slack.com/x",
    };
    const service = new NotificationService(config, makeLogger() as never);

    const result = await service.sendHumanRequest(makePayload());

    expect(result.slack.ok).toBe(false);
    expect(result.slack.error).toBe("network down");
  });

  it("sends a successful email notification and reports ok=true", async () => {
    fetchMock.mockResolvedValue({ ok: true });
    const config: NotificationConfig = {
      emailFrom: "noreply@example.com",
      emailTo: "a@example.com, b@example.com",
      resendApiKey: "key-123",
    };
    const service = new NotificationService(config, makeLogger() as never);

    const result = await service.sendHumanRequest(makePayload());

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.resend.com/emails");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer key-123");
    const body = JSON.parse(init.body as string);
    expect(body.to).toEqual(["a@example.com", "b@example.com"]);
    expect(body.from).toBe("noreply@example.com");
    expect(result.email).toEqual({ attempted: true, ok: true });
  });

  it("records an email failure with error message on non-ok response", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 422,
      text: () => Promise.resolve("invalid recipient"),
    });
    const logger = makeLogger();
    const config: NotificationConfig = {
      emailFrom: "noreply@example.com",
      emailTo: "a@example.com",
      resendApiKey: "key-123",
    };
    const service = new NotificationService(config, logger as never);

    const result = await service.sendHumanRequest(makePayload());

    expect(result.email.ok).toBe(false);
    expect(result.email.error).toContain("422");
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ runId: "run-1" }),
      "Email notification failed",
    );
  });

  it("sends both slack and email concurrently when both are configured", async () => {
    fetchMock.mockResolvedValue({ ok: true });
    const config: NotificationConfig = {
      emailFrom: "noreply@example.com",
      slackWebhookUrl: "https://hooks.slack.com/x",
      emailTo: "a@example.com",
      resendApiKey: "key-123",
    };
    const service = new NotificationService(config, makeLogger() as never);

    const result = await service.sendHumanRequest(makePayload());

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.slack.ok).toBe(true);
    expect(result.email.ok).toBe(true);
  });

  it("handles response.text() itself rejecting without throwing (falls back to empty body)", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 503,
      text: () => Promise.reject(new Error("stream closed")),
    });
    const config: NotificationConfig = {
      emailFrom: "noreply@example.com",
      slackWebhookUrl: "https://hooks.slack.com/x",
    };
    const service = new NotificationService(config, makeLogger() as never);

    const result = await service.sendHumanRequest(makePayload());

    expect(result.slack.ok).toBe(false);
    expect(result.slack.error).toContain("503");
  });

  it("includes plan confidence and open questions fields in the slack payload when present", async () => {
    fetchMock.mockResolvedValue({ ok: true });
    const config: NotificationConfig = {
      emailFrom: "noreply@example.com",
      slackWebhookUrl: "https://hooks.slack.com/x",
    };
    const service = new NotificationService(config, makeLogger() as never);

    await service.sendHumanRequest(
      makePayload({
        planConfidence: 0.42,
        context: "Some long context ".repeat(200),
        openQuestions: [
          { id: "q1", question: "Should we use OAuth?", requiredForExecution: true },
          { id: "q2", question: "Naming convention?", requiredForExecution: false },
        ],
      }),
    );

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    const flattened = JSON.stringify(body);
    expect(flattened).toContain("0.42");
    expect(flattened).toContain("[required]");
    expect(flattened).toContain("Should we use OAuth?");
    expect(flattened).toContain("Naming convention?");
    expect(flattened).toContain("2 (1 required)");
  });

  it("includes plan confidence and questions in the email body when present, and omits them when absent", async () => {
    fetchMock.mockResolvedValue({ ok: true });
    const config: NotificationConfig = {
      emailFrom: "noreply@example.com",
      emailTo: "a@example.com",
      resendApiKey: "key-123",
    };
    const service = new NotificationService(config, makeLogger() as never);

    await service.sendHumanRequest(
      makePayload({
        planConfidence: 0.75,
        context: "Context details here",
        openQuestions: [{ id: "q1", question: "Use REST or GraphQL?", requiredForExecution: true }],
      }),
    );

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.html).toContain("0.75");
    expect(body.html).toContain("Use REST or GraphQL?");
    expect(body.text).toContain("0.75");
    expect(body.text).toContain("Use REST or GraphQL?");
    expect(body.html).toContain("Context details here");
  });

  it("omits confidence, context, and questions blocks from email when absent", async () => {
    fetchMock.mockResolvedValue({ ok: true });
    const config: NotificationConfig = {
      emailFrom: "noreply@example.com",
      emailTo: "a@example.com",
      resendApiKey: "key-123",
    };
    const service = new NotificationService(config, makeLogger() as never);

    await service.sendHumanRequest(makePayload());

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.html).not.toContain("Plan confidence");
    expect(body.html).not.toContain("Open questions");
    expect(body.text).not.toContain("Plan confidence");
  });

  it("escapes HTML special characters in the email body", async () => {
    fetchMock.mockResolvedValue({ ok: true });
    const config: NotificationConfig = {
      emailFrom: "noreply@example.com",
      emailTo: "a@example.com",
      resendApiKey: "key-123",
    };
    const service = new NotificationService(config, makeLogger() as never);

    await service.sendHumanRequest(
      makePayload({ summary: `<script>alert("xss")</script> & 'quotes'` }),
    );

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.html).not.toContain("<script>");
    expect(body.html).toContain("&lt;script&gt;");
    expect(body.html).toContain("&amp;");
    expect(body.html).toContain("&#39;quotes&#39;");
  });

  it("falls back to '(untitled)' when the linear issue has no title, and uses id when no identifier", async () => {
    fetchMock.mockResolvedValue({ ok: true });
    const config: NotificationConfig = {
      emailFrom: "noreply@example.com",
      slackWebhookUrl: "https://hooks.slack.com/x",
      emailTo: "a@example.com",
      resendApiKey: "key-123",
    };
    const service = new NotificationService(config, makeLogger() as never);

    await service.sendHumanRequest(
      makePayload({
        linearIssue: { id: "lin-99", title: null, url: null },
      }),
    );

    const [slackUrl, slackInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(slackUrl).toBe("https://hooks.slack.com/x");
    const slackBody = JSON.parse(slackInit.body as string);
    expect(slackBody.text).toContain("lin-99");
    expect(slackBody.text).toContain("(untitled)");

    const [, emailInit] = fetchMock.mock.calls[1] as [string, RequestInit];
    const emailBody = JSON.parse(emailInit.body as string);
    expect(emailBody.subject).toContain("lin-99");
    expect(emailBody.subject).toContain("(untitled)");
  });

  it("does not render a Linear issue button/link in slack or email when the issue has no url", async () => {
    fetchMock.mockResolvedValue({ ok: true });
    const config: NotificationConfig = {
      emailFrom: "noreply@example.com",
      slackWebhookUrl: "https://hooks.slack.com/x",
      emailTo: "a@example.com",
      resendApiKey: "key-123",
    };
    const service = new NotificationService(config, makeLogger() as never);

    await service.sendHumanRequest(
      makePayload({ linearIssue: { id: "lin-1", title: "T", url: null } }),
    );

    const [, slackInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    const slackBody = JSON.parse(slackInit.body as string);
    const actionsBlock = slackBody.blocks.find((b: { type: string }) => b.type === "actions");
    expect(actionsBlock.elements).toHaveLength(1);

    const [, emailInit] = fetchMock.mock.calls[1] as [string, RequestInit];
    const emailBody = JSON.parse(emailInit.body as string);
    expect(emailBody.html).not.toContain("Open Linear issue");
  });

  it.each([
    ["plan_ambiguous", "Plan needs review (ambiguous)"],
    ["plan_low_confidence", "Plan needs review (low confidence)"],
    ["impl_rejected", "Implementation needs review (rejected by agent)"],
    ["impl_uncertain", "Implementation needs review (uncertain)"],
    ["other", "Human intervention requested"],
  ] as const)("renders the correct reason label for reason=%s", async (reason, expectedLabel) => {
    fetchMock.mockResolvedValue({ ok: true });
    const config: NotificationConfig = {
      emailFrom: "noreply@example.com",
      slackWebhookUrl: "https://hooks.slack.com/x",
    };
    const service = new NotificationService(config, makeLogger() as never);

    await service.sendHumanRequest(makePayload({ reason }));

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.text).toContain(expectedLabel);
  });

  it("truncates a very long context field in both slack and email bodies", async () => {
    fetchMock.mockResolvedValue({ ok: true });
    const longContext = "y".repeat(5000);
    const config: NotificationConfig = {
      emailFrom: "noreply@example.com",
      slackWebhookUrl: "https://hooks.slack.com/x",
      emailTo: "a@example.com",
      resendApiKey: "key-123",
    };
    const service = new NotificationService(config, makeLogger() as never);

    await service.sendHumanRequest(makePayload({ context: longContext }));

    const [, slackInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    const slackBody = JSON.parse(slackInit.body as string);
    const flattenedSlack = JSON.stringify(slackBody);
    expect(flattenedSlack).not.toContain("y".repeat(1500));
    expect(flattenedSlack).toContain("…");

    const [, emailInit] = fetchMock.mock.calls[1] as [string, RequestInit];
    const emailBody = JSON.parse(emailInit.body as string);
    expect(emailBody.text).not.toContain("y".repeat(2000));
  });

  it("caps rendered open questions at 3 in slack and 5 in email", async () => {
    fetchMock.mockResolvedValue({ ok: true });
    const questions = Array.from({ length: 8 }, (_, i) => ({
      id: `q${i}`,
      question: `Question number ${i}`,
      requiredForExecution: false,
    }));
    const config: NotificationConfig = {
      emailFrom: "noreply@example.com",
      slackWebhookUrl: "https://hooks.slack.com/x",
      emailTo: "a@example.com",
      resendApiKey: "key-123",
    };
    const service = new NotificationService(config, makeLogger() as never);

    await service.sendHumanRequest(makePayload({ openQuestions: questions }));

    const [, slackInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    const slackBody = JSON.parse(slackInit.body as string);
    const flattenedSlack = JSON.stringify(slackBody);
    expect(flattenedSlack).toContain("Question number 2");
    expect(flattenedSlack).not.toContain("Question number 3");

    const [, emailInit] = fetchMock.mock.calls[1] as [string, RequestInit];
    const emailBody = JSON.parse(emailInit.body as string);
    expect(emailBody.html).toContain("Question number 4");
    expect(emailBody.html).not.toContain("Question number 5");
  });
});
