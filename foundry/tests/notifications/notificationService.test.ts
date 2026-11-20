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
    summary: "The plan has an open question that needs a human decision.",
    runState: "AwaitingPlanApproval",
    runUrl: "https://dashboard.example.com/runs/run-1",
    linearIssue: {
      id: "issue-1",
      identifier: "ENG-1",
      title: "Add validation",
      url: "https://linear.app/team/issue/ENG-1",
    },
    ...overrides,
  };
}

function okResponse(): Response {
  return { ok: true, status: 200, text: () => Promise.resolve("") } as unknown as Response;
}

function failResponse(status: number, body: string): Response {
  return { ok: false, status, text: () => Promise.resolve(body) } as unknown as Response;
}

describe("NotificationService.isConfigured", () => {
  it("is false when neither Slack nor email is configured", () => {
    const service = new NotificationService(
      { emailFrom: "bot@example.com" },
      makeLogger() as never,
    );
    expect(service.isConfigured()).toBe(false);
  });

  it("is true when a Slack webhook URL is set", () => {
    const service = new NotificationService(
      { emailFrom: "bot@example.com", slackWebhookUrl: "https://hooks.slack.com/x" },
      makeLogger() as never,
    );
    expect(service.isConfigured()).toBe(true);
  });

  it("is true when both emailTo and resendApiKey are set", () => {
    const service = new NotificationService(
      { emailFrom: "bot@example.com", emailTo: "a@example.com", resendApiKey: "key" },
      makeLogger() as never,
    );
    expect(service.isConfigured()).toBe(true);
  });

  it("is false when only emailTo is set without an API key", () => {
    const service = new NotificationService(
      { emailFrom: "bot@example.com", emailTo: "a@example.com" },
      makeLogger() as never,
    );
    expect(service.isConfigured()).toBe(false);
  });

  it("is false when only resendApiKey is set without a recipient", () => {
    const service = new NotificationService(
      { emailFrom: "bot@example.com", resendApiKey: "key" },
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
      { emailFrom: "bot@example.com", ...config },
      logger as never,
    );
  }

  it("attempts neither channel and makes no fetch calls when nothing is configured", async () => {
    const service = makeService();

    const result = await service.sendHumanRequest(makePayload());

    expect(result).toEqual({
      slack: { attempted: false, ok: false },
      email: { attempted: false, ok: false },
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sends only a Slack notification when only Slack is configured", async () => {
    fetchMock.mockResolvedValue(okResponse());
    const service = makeService({ slackWebhookUrl: "https://hooks.slack.com/x" });

    const result = await service.sendHumanRequest(makePayload());

    expect(result.slack).toEqual({ attempted: true, ok: true });
    expect(result.email).toEqual({ attempted: false, ok: false });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://hooks.slack.com/x",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("includes plan confidence and open questions in the Slack payload when present", async () => {
    fetchMock.mockResolvedValue(okResponse());
    const service = makeService({ slackWebhookUrl: "https://hooks.slack.com/x" });

    await service.sendHumanRequest(
      makePayload({
        planConfidence: 0.42,
        openQuestions: [
          { id: "q1", question: "Should we support X?", requiredForExecution: true },
          { id: "q2", question: "What about Y?", requiredForExecution: false },
        ],
      }),
    );

    const call = fetchMock.mock.calls[0] as [string, { body: string }];
    const body = JSON.parse(call[1].body) as { blocks: unknown[] };
    const serialized = JSON.stringify(body);
    expect(serialized).toContain("Plan confidence");
    expect(serialized).toContain("0.42");
    expect(serialized).toContain("required");
    expect(serialized).toContain("Should we support X?");
  });

  it("omits the context block from Slack when no context is given, includes it truncated when given", async () => {
    fetchMock.mockResolvedValue(okResponse());
    const service = makeService({ slackWebhookUrl: "https://hooks.slack.com/x" });

    await service.sendHumanRequest(makePayload({ context: undefined }));
    let body = JSON.parse((fetchMock.mock.calls[0] as [string, { body: string }])[1].body) as {
      blocks: unknown[];
    };
    expect(JSON.stringify(body)).not.toContain("*Context:*");

    fetchMock.mockClear();
    const longContext = "x".repeat(2000);
    await service.sendHumanRequest(makePayload({ context: longContext }));
    body = JSON.parse((fetchMock.mock.calls[0] as [string, { body: string }])[1].body) as {
      blocks: unknown[];
    };
    const serialized = JSON.stringify(body);
    expect(serialized).toContain("*Context:*");
    // Truncated to 1500 chars plus an ellipsis marker, so the full 2000-char
    // string should not appear verbatim.
    expect(serialized).not.toContain(longContext);
  });

  it("omits the Linear issue button when the issue has no url", async () => {
    fetchMock.mockResolvedValue(okResponse());
    const service = makeService({ slackWebhookUrl: "https://hooks.slack.com/x" });

    await service.sendHumanRequest(
      makePayload({ linearIssue: { id: "issue-1", title: "T", url: null } }),
    );

    const body = JSON.parse((fetchMock.mock.calls[0] as [string, { body: string }])[1].body) as {
      blocks: unknown[];
    };
    expect(JSON.stringify(body)).not.toContain("Open Linear issue");
  });

  it("records a Slack failure with the response status and does not throw", async () => {
    fetchMock.mockResolvedValue(failResponse(500, "server error"));
    const service = makeService({ slackWebhookUrl: "https://hooks.slack.com/x" });

    const result = await service.sendHumanRequest(makePayload());

    expect(result.slack.ok).toBe(false);
    expect(result.slack.error).toContain("Slack webhook returned 500");
    expect(logger.warn).toHaveBeenCalled();
  });

  it("records a Slack failure when fetch itself rejects (network error)", async () => {
    fetchMock.mockRejectedValue(new Error("network down"));
    const service = makeService({ slackWebhookUrl: "https://hooks.slack.com/x" });

    const result = await service.sendHumanRequest(makePayload());

    expect(result.slack.ok).toBe(false);
    expect(result.slack.error).toBe("network down");
  });

  it("sends only email when only email is configured, splitting and trimming recipients", async () => {
    fetchMock.mockResolvedValue(okResponse());
    const service = makeService({
      emailTo: " a@example.com, b@example.com ,,",
      resendApiKey: "resend-key",
    });

    const result = await service.sendHumanRequest(makePayload());

    expect(result.email).toEqual({ attempted: true, ok: true });
    expect(result.slack).toEqual({ attempted: false, ok: false });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.resend.com/emails",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ Authorization: "Bearer resend-key" }),
      }),
    );
    const call = fetchMock.mock.calls[0] as [string, { body: string }];
    const body = JSON.parse(call[1].body) as { to: string[]; from: string; html: string; text: string };
    expect(body.to).toEqual(["a@example.com", "b@example.com"]);
    expect(body.from).toBe("bot@example.com");
    expect(body.html).toContain("Add validation");
    expect(body.text).toContain("Add validation");
  });

  it("escapes HTML special characters in the email body", async () => {
    fetchMock.mockResolvedValue(okResponse());
    const service = makeService({ emailTo: "a@example.com", resendApiKey: "key" });

    await service.sendHumanRequest(
      makePayload({
        summary: "<script>alert('x')</script>",
        linearIssue: { id: "issue-1", title: "Title & <b>bold</b>", url: null },
      }),
    );

    const call = fetchMock.mock.calls[0] as [string, { body: string }];
    const body = JSON.parse(call[1].body) as { html: string };
    expect(body.html).not.toContain("<script>");
    expect(body.html).toContain("&lt;script&gt;");
    expect(body.html).toContain("&amp;");
  });

  it("includes plan confidence, context, and open questions in both the html and text email bodies", async () => {
    fetchMock.mockResolvedValue(okResponse());
    const service = makeService({ emailTo: "a@example.com", resendApiKey: "key" });

    await service.sendHumanRequest(
      makePayload({
        planConfidence: 0.75,
        context: "Some extra context about the decision.",
        openQuestions: [
          { id: "q1", question: "Should we ship now?", requiredForExecution: true },
          { id: "q2", question: "Any style nits?", requiredForExecution: false },
        ],
      }),
    );

    const call = fetchMock.mock.calls[0] as [string, { body: string }];
    const body = JSON.parse(call[1].body) as { html: string; text: string };

    for (const content of [body.html, body.text]) {
      expect(content).toContain("0.75");
      expect(content).toContain("Some extra context about the decision.");
      expect(content).toContain("Should we ship now?");
      expect(content).toContain("Any style nits?");
    }
    expect(body.text).toContain("[required] Should we ship now?");
    expect(body.text).not.toContain("[required] Any style nits?");
  });

  it("records an email failure with the response status", async () => {
    fetchMock.mockResolvedValue(failResponse(422, "invalid recipient"));
    const service = makeService({ emailTo: "a@example.com", resendApiKey: "key" });

    const result = await service.sendHumanRequest(makePayload());

    expect(result.email.ok).toBe(false);
    expect(result.email.error).toContain("Resend returned 422");
    expect(logger.warn).toHaveBeenCalled();
  });

  it("sends both Slack and email concurrently when both are configured", async () => {
    fetchMock.mockResolvedValue(okResponse());
    const service = makeService({
      slackWebhookUrl: "https://hooks.slack.com/x",
      emailTo: "a@example.com",
      resendApiKey: "key",
    });

    const result = await service.sendHumanRequest(makePayload());

    expect(result.slack.ok).toBe(true);
    expect(result.email.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("varies the subject/title text by reason", async () => {
    fetchMock.mockResolvedValue(okResponse());
    const service = makeService({ slackWebhookUrl: "https://hooks.slack.com/x" });

    await service.sendHumanRequest(makePayload({ reason: "impl_rejected" }));
    const body = JSON.parse((fetchMock.mock.calls[0] as [string, { body: string }])[1].body) as {
      text: string;
    };
    expect(body.text).toContain("rejected by agent");
  });
});
