import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  NotificationService,
  type NotificationPayload,
  type NotificationConfig,
} from "../../src/notifications/notificationService.js";

function makeLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
}

function makePayload(overrides: Partial<NotificationPayload> = {}): NotificationPayload {
  return {
    runId: "run-1",
    reason: "plan_ambiguous",
    summary: "The plan is ambiguous about scope.",
    linearIssue: {
      id: "lin-1",
      identifier: "LIN-1",
      title: "Add validation",
      url: "https://linear.app/team/issue/LIN-1",
    },
    runState: "AwaitingPlanApproval",
    runUrl: "https://app.example.com/runs/run-1",
    ...overrides,
  };
}

function okResponse(): Response {
  return { ok: true, status: 200, text: () => Promise.resolve("") } as unknown as Response;
}

function errorResponse(status: number, body = "server error"): Response {
  return { ok: false, status, text: () => Promise.resolve(body) } as unknown as Response;
}

describe("NotificationService.isConfigured", () => {
  it("is false when no channels are configured", () => {
    const service = new NotificationService(
      { emailFrom: "noreply@example.com" },
      makeLogger() as never,
    );
    expect(service.isConfigured()).toBe(false);
  });

  it("is true when a slack webhook url is set", () => {
    const service = new NotificationService(
      { emailFrom: "noreply@example.com", slackWebhookUrl: "https://hooks.slack.com/x" },
      makeLogger() as never,
    );
    expect(service.isConfigured()).toBe(true);
  });

  it("is true when emailTo and resendApiKey are both set", () => {
    const service = new NotificationService(
      { emailFrom: "noreply@example.com", emailTo: "team@example.com", resendApiKey: "key" },
      makeLogger() as never,
    );
    expect(service.isConfigured()).toBe(true);
  });

  it("is false when only emailTo is set without an API key", () => {
    const service = new NotificationService(
      { emailFrom: "noreply@example.com", emailTo: "team@example.com" },
      makeLogger() as never,
    );
    expect(service.isConfigured()).toBe(false);
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

  function makeService(config: Partial<NotificationConfig> = {}): NotificationService {
    return new NotificationService(
      { emailFrom: "noreply@example.com", ...config },
      logger as never,
    );
  }

  it("attempts no channels and makes no fetch calls when nothing is configured", async () => {
    const service = makeService();
    const result = await service.sendHumanRequest(makePayload());

    expect(result).toEqual({
      slack: { attempted: false, ok: false },
      email: { attempted: false, ok: false },
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sends a slack message and reports success", async () => {
    fetchMock.mockResolvedValue(okResponse());
    const service = makeService({ slackWebhookUrl: "https://hooks.slack.com/x" });

    const result = await service.sendHumanRequest(makePayload());

    expect(result.slack).toEqual({ attempted: true, ok: true });
    expect(result.email).toEqual({ attempted: false, ok: false });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://hooks.slack.com/x",
      expect.objectContaining({ method: "POST" }),
    );
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string) as { text: string; blocks: unknown[] };
    expect(body.text).toContain("LIN-1");
    expect(body.blocks).toBeInstanceOf(Array);
  });

  it("records a slack failure (non-ok response) without throwing", async () => {
    fetchMock.mockResolvedValue(errorResponse(500, "oops"));
    const service = makeService({ slackWebhookUrl: "https://hooks.slack.com/x" });

    const result = await service.sendHumanRequest(makePayload());

    expect(result.slack.attempted).toBe(true);
    expect(result.slack.ok).toBe(false);
    expect(result.slack.error).toContain("500");
    expect(logger.warn).toHaveBeenCalled();
  });

  it("records a slack failure when the response body cannot be read as text", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 503,
      text: () => Promise.reject(new Error("stream closed")),
    } as unknown as Response);
    const service = makeService({ slackWebhookUrl: "https://hooks.slack.com/x" });

    const result = await service.sendHumanRequest(makePayload());

    expect(result.slack.ok).toBe(false);
    expect(result.slack.error).toContain("503");
  });

  it("records a slack failure when fetch itself rejects", async () => {
    fetchMock.mockRejectedValue(new Error("network down"));
    const service = makeService({ slackWebhookUrl: "https://hooks.slack.com/x" });

    const result = await service.sendHumanRequest(makePayload());

    expect(result.slack.ok).toBe(false);
    expect(result.slack.error).toBe("network down");
  });

  it("records a slack failure with a stringified error for a non-Error rejection", async () => {
    fetchMock.mockRejectedValue("weird rejection");
    const service = makeService({ slackWebhookUrl: "https://hooks.slack.com/x" });

    const result = await service.sendHumanRequest(makePayload());

    expect(result.slack.error).toBe("weird rejection");
  });

  it("sends an email and reports success", async () => {
    fetchMock.mockResolvedValue(okResponse());
    const service = makeService({ emailTo: "team@example.com", resendApiKey: "key123" });

    const result = await service.sendHumanRequest(makePayload());

    expect(result.email).toEqual({ attempted: true, ok: true });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.resend.com/emails",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ Authorization: "Bearer key123" }),
      }),
    );
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string) as { to: string[]; subject: string };
    expect(body.to).toEqual(["team@example.com"]);
    expect(body.subject).toContain("LIN-1");
  });

  it("splits a comma-separated emailTo into multiple recipients", async () => {
    fetchMock.mockResolvedValue(okResponse());
    const service = makeService({
      emailTo: "a@example.com, b@example.com ,,",
      resendApiKey: "key123",
    });

    await service.sendHumanRequest(makePayload());

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string) as { to: string[] };
    expect(body.to).toEqual(["a@example.com", "b@example.com"]);
  });

  it("records an email failure (non-ok response) without throwing", async () => {
    fetchMock.mockResolvedValue(errorResponse(422, "bad request"));
    const service = makeService({ emailTo: "team@example.com", resendApiKey: "key123" });

    const result = await service.sendHumanRequest(makePayload());

    expect(result.email.ok).toBe(false);
    expect(result.email.error).toContain("422");
    expect(logger.warn).toHaveBeenCalled();
  });

  it("records an email failure when fetch rejects", async () => {
    fetchMock.mockRejectedValue(new Error("dns failure"));
    const service = makeService({ emailTo: "team@example.com", resendApiKey: "key123" });

    const result = await service.sendHumanRequest(makePayload());

    expect(result.email.ok).toBe(false);
    expect(result.email.error).toBe("dns failure");
  });

  it("records an email failure with a stringified error for a non-Error rejection", async () => {
    fetchMock.mockRejectedValue("weird email rejection");
    const service = makeService({ emailTo: "team@example.com", resendApiKey: "key123" });

    const result = await service.sendHumanRequest(makePayload());

    expect(result.email.ok).toBe(false);
    expect(result.email.error).toBe("weird email rejection");
  });

  it("sends both slack and email concurrently when both are configured", async () => {
    fetchMock.mockResolvedValue(okResponse());
    const service = makeService({
      slackWebhookUrl: "https://hooks.slack.com/x",
      emailTo: "team@example.com",
      resendApiKey: "key123",
    });

    const result = await service.sendHumanRequest(makePayload());

    expect(result.slack.ok).toBe(true);
    expect(result.email.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("includes planConfidence, openQuestions and context in the slack payload when present", async () => {
    fetchMock.mockResolvedValue(okResponse());
    const service = makeService({ slackWebhookUrl: "https://hooks.slack.com/x" });

    await service.sendHumanRequest(
      makePayload({
        planConfidence: 0.42,
        context: "x".repeat(2000),
        openQuestions: [
          { id: "q1", question: "Should we support OAuth?", requiredForExecution: true },
          { id: "q2", question: "y".repeat(300), requiredForExecution: false },
          { id: "q3", question: "Third question", requiredForExecution: false },
          { id: "q4", question: "Fourth question (should be truncated out)", requiredForExecution: false },
        ],
      }),
    );

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string) as { blocks: unknown[] };
    const serialized = JSON.stringify(body.blocks);
    expect(serialized).toContain("0.42");
    expect(serialized).toContain("Should we support OAuth?");
    expect(serialized).toContain("…"); // truncation ellipsis for long context/question
    expect(serialized).not.toContain("Fourth question"); // only first 3 questions shown
  });

  it("omits optional slack fields (confidence, questions, context, issue url) when absent", async () => {
    fetchMock.mockResolvedValue(okResponse());
    const service = makeService({ slackWebhookUrl: "https://hooks.slack.com/x" });

    await service.sendHumanRequest(
      makePayload({
        linearIssue: { id: "lin-1", title: null, url: null },
      }),
    );

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string) as { text: string; blocks: unknown[] };
    expect(body.text).toContain("(untitled)");
    expect(body.text).toContain("lin-1");
    const serialized = JSON.stringify(body.blocks);
    expect(serialized).not.toContain("Open Linear issue");
  });

  it("renders every reason label via the slack title", async () => {
    fetchMock.mockResolvedValue(okResponse());
    const service = makeService({ slackWebhookUrl: "https://hooks.slack.com/x" });
    const reasons: NotificationPayload["reason"][] = [
      "plan_ambiguous",
      "plan_low_confidence",
      "impl_rejected",
      "impl_uncertain",
      "other",
    ];

    for (const reason of reasons) {
      fetchMock.mockClear();
      await service.sendHumanRequest(makePayload({ reason }));
      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(init.body as string) as { text: string };
      expect(body.text.length).toBeGreaterThan(0);
    }
  });

  it("escapes HTML and includes all optional sections in the email body when present", async () => {
    fetchMock.mockResolvedValue(okResponse());
    const service = makeService({ emailTo: "team@example.com", resendApiKey: "key123" });

    await service.sendHumanRequest(
      makePayload({
        planConfidence: 0.9,
        context: "<script>alert('x')</script>" + "z".repeat(2000),
        openQuestions: [
          { id: "q1", question: "<b>Bold?</b>", requiredForExecution: true },
          { id: "q2", question: "Q2", requiredForExecution: false },
          { id: "q3", question: "Q3", requiredForExecution: false },
          { id: "q4", question: "Q4", requiredForExecution: false },
          { id: "q5", question: "Q5", requiredForExecution: false },
          { id: "q6", question: "Q6 (beyond slice(0,5), should not appear)", requiredForExecution: false },
        ],
        linearIssue: {
          id: "lin-1",
          identifier: "LIN-1",
          title: "Title with <tags> & \"quotes\"",
          url: "https://linear.app/team/issue/LIN-1",
        },
      }),
    );

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string) as { html: string; text: string };
    expect(body.html).toContain("&lt;script&gt;");
    expect(body.html).not.toContain("<script>");
    expect(body.html).toContain("&lt;tags&gt;");
    expect(body.html).toContain("&lt;b&gt;Bold?&lt;/b&gt;");
    expect(body.html).toContain("Open Linear issue");
    expect(body.html).toContain("…");
    expect(body.html).not.toContain("Q6 (beyond");
    expect(body.text).toContain("[required]");
    expect(body.text).toContain("<b>Bold?</b>");
  });

  it("omits optional text sections (confidence, context, questions, linear url) when absent", async () => {
    fetchMock.mockResolvedValue(okResponse());
    const service = makeService({ emailTo: "team@example.com", resendApiKey: "key123" });

    await service.sendHumanRequest(
      makePayload({
        linearIssue: { id: "lin-1", title: null, url: null },
      }),
    );

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string) as { text: string; html: string };
    expect(body.text).not.toContain("Plan confidence");
    expect(body.text).not.toContain("Linear:");
    expect(body.html).not.toContain("Plan confidence");
  });
});
