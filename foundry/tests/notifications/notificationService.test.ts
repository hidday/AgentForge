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
    summary: "The plan is ambiguous about auth",
    linearIssue: {
      id: "issue-1",
      identifier: "PRY-1",
      title: "Add auth",
      url: "https://linear.app/team/issue/PRY-1",
    },
    runState: "AwaitingPlanApproval",
    runUrl: "https://app.example.com/runs/run-1",
    ...overrides,
  };
}

function mockFetchResponse(ok: boolean, status = 200, text = "") {
  return {
    ok,
    status,
    text: vi.fn().mockResolvedValue(text),
  };
}

describe("NotificationService.isConfigured", () => {
  const logger = makeLogger();

  it("returns false when no channels are configured", () => {
    const service = new NotificationService({ emailFrom: "bot@x.com" }, logger as never);
    expect(service.isConfigured()).toBe(false);
  });

  it("returns true when a Slack webhook URL is set", () => {
    const service = new NotificationService(
      { emailFrom: "bot@x.com", slackWebhookUrl: "https://hooks.slack.com/x" },
      logger as never,
    );
    expect(service.isConfigured()).toBe(true);
  });

  it("returns true when both emailTo and resendApiKey are set", () => {
    const service = new NotificationService(
      { emailFrom: "bot@x.com", emailTo: "a@x.com", resendApiKey: "key" },
      logger as never,
    );
    expect(service.isConfigured()).toBe(true);
  });

  it("returns false when only emailTo is set without a resend API key", () => {
    const service = new NotificationService(
      { emailFrom: "bot@x.com", emailTo: "a@x.com" },
      logger as never,
    );
    expect(service.isConfigured()).toBe(false);
  });

  it("returns false when only resendApiKey is set without emailTo", () => {
    const service = new NotificationService(
      { emailFrom: "bot@x.com", resendApiKey: "key" },
      logger as never,
    );
    expect(service.isConfigured()).toBe(false);
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

  function makeConfig(overrides: Partial<NotificationConfig> = {}): NotificationConfig {
    return { emailFrom: "bot@x.com", ...overrides };
  }

  it("attempts neither channel when nothing is configured", async () => {
    const service = new NotificationService(makeConfig(), logger as never);

    const result = await service.sendHumanRequest(makePayload());

    expect(result).toEqual({
      slack: { attempted: false, ok: false },
      email: { attempted: false, ok: false },
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sends a Slack message and reports ok:true on success", async () => {
    fetchMock.mockResolvedValue(mockFetchResponse(true));
    const service = new NotificationService(
      makeConfig({ slackWebhookUrl: "https://hooks.slack.com/x" }),
      logger as never,
    );

    const result = await service.sendHumanRequest(makePayload());

    expect(result.slack).toEqual({ attempted: true, ok: true });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://hooks.slack.com/x",
      expect.objectContaining({ method: "POST" }),
    );
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string) as { text: string; blocks: unknown[] };
    expect(body.text).toContain("PRY-1");
    expect(body.text).toContain("Add auth");
  });

  it("records a Slack failure (non-ok response) without throwing", async () => {
    fetchMock.mockResolvedValue(mockFetchResponse(false, 500, "server error"));
    const service = new NotificationService(
      makeConfig({ slackWebhookUrl: "https://hooks.slack.com/x" }),
      logger as never,
    );

    const result = await service.sendHumanRequest(makePayload());

    expect(result.slack.attempted).toBe(true);
    expect(result.slack.ok).toBe(false);
    expect(result.slack.error).toContain("Slack webhook returned 500");
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ runId: "run-1" }),
      "Slack notification failed",
    );
  });

  it("records a Slack failure when fetch itself throws", async () => {
    fetchMock.mockRejectedValue(new Error("network down"));
    const service = new NotificationService(
      makeConfig({ slackWebhookUrl: "https://hooks.slack.com/x" }),
      logger as never,
    );

    const result = await service.sendHumanRequest(makePayload());

    expect(result.slack.ok).toBe(false);
    expect(result.slack.error).toBe("network down");
  });

  it("sends an email and reports ok:true on success", async () => {
    fetchMock.mockResolvedValue(mockFetchResponse(true));
    const service = new NotificationService(
      makeConfig({ emailTo: "a@x.com, b@x.com", resendApiKey: "resend-key" }),
      logger as never,
    );

    const result = await service.sendHumanRequest(makePayload());

    expect(result.email).toEqual({ attempted: true, ok: true });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.resend.com/emails",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ Authorization: "Bearer resend-key" }),
      }),
    );
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string) as { to: string[]; from: string; subject: string };
    expect(body.to).toEqual(["a@x.com", "b@x.com"]);
    expect(body.from).toBe("bot@x.com");
    expect(body.subject).toContain("PRY-1");
  });

  it("records an email failure (non-ok response) without throwing", async () => {
    fetchMock.mockResolvedValue(mockFetchResponse(false, 422, "invalid recipient"));
    const service = new NotificationService(
      makeConfig({ emailTo: "a@x.com", resendApiKey: "resend-key" }),
      logger as never,
    );

    const result = await service.sendHumanRequest(makePayload());

    expect(result.email.ok).toBe(false);
    expect(result.email.error).toContain("Resend returned 422");
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ runId: "run-1" }),
      "Email notification failed",
    );
  });

  it("sends both Slack and email concurrently, succeeding independently", async () => {
    fetchMock.mockImplementation((url: string) =>
      Promise.resolve(
        url.includes("slack.com") ? mockFetchResponse(true) : mockFetchResponse(false, 500),
      ),
    );
    const service = new NotificationService(
      makeConfig({
        slackWebhookUrl: "https://hooks.slack.com/x",
        emailTo: "a@x.com",
        resendApiKey: "resend-key",
      }),
      logger as never,
    );

    const result = await service.sendHumanRequest(makePayload());

    expect(result.slack.ok).toBe(true);
    expect(result.email.ok).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("includes plan confidence and open questions in the Slack payload when present", async () => {
    fetchMock.mockResolvedValue(mockFetchResponse(true));
    const service = new NotificationService(
      makeConfig({ slackWebhookUrl: "https://hooks.slack.com/x" }),
      logger as never,
    );

    await service.sendHumanRequest(
      makePayload({
        planConfidence: 0.42,
        openQuestions: [
          { id: "q1", question: "Which OAuth provider?", requiredForExecution: true },
          { id: "q2", question: "Should we log PII?", requiredForExecution: false },
          { id: "q3", question: "Third question", requiredForExecution: true },
          { id: "q4", question: "Fourth question (should be sliced off)", requiredForExecution: false },
        ],
      }),
    );

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string) as {
      blocks: { type: string; fields?: { text: string }[]; text?: { text: string } }[];
    };
    const serialized = JSON.stringify(body.blocks);
    expect(serialized).toContain("0.42");
    expect(serialized).toContain("4 (2 required)");
    expect(serialized).toContain("Which OAuth provider?");
    expect(serialized).not.toContain("Fourth question");
  });

  it("includes a context block in Slack when context is present, truncated beyond 1500 chars", async () => {
    fetchMock.mockResolvedValue(mockFetchResponse(true));
    const service = new NotificationService(
      makeConfig({ slackWebhookUrl: "https://hooks.slack.com/x" }),
      logger as never,
    );
    const longContext = "x".repeat(2000);

    await service.sendHumanRequest(makePayload({ context: longContext }));

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string) as { blocks: unknown[] };
    const serialized = JSON.stringify(body.blocks);
    expect(serialized).toContain("…");
    expect(serialized.length).toBeLessThan(longContext.length + 500);
  });

  it("omits optional Slack sections (confidence, questions, context) when absent", async () => {
    fetchMock.mockResolvedValue(mockFetchResponse(true));
    const service = new NotificationService(
      makeConfig({ slackWebhookUrl: "https://hooks.slack.com/x" }),
      logger as never,
    );

    await service.sendHumanRequest(makePayload());

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string) as { blocks: unknown[] };
    const serialized = JSON.stringify(body.blocks);
    expect(serialized).not.toContain("Plan confidence");
    expect(serialized).not.toContain("Open questions");
    expect(serialized).not.toContain("Context:");
  });

  it("falls back to the issue id and '(untitled)' when identifier/title are absent", async () => {
    fetchMock.mockResolvedValue(mockFetchResponse(true));
    const service = new NotificationService(
      makeConfig({ slackWebhookUrl: "https://hooks.slack.com/x" }),
      logger as never,
    );

    await service.sendHumanRequest(
      makePayload({
        linearIssue: { id: "raw-issue-id", title: null, url: null },
      }),
    );

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string) as { text: string; blocks: unknown[] };
    expect(body.text).toContain("raw-issue-id");
    expect(body.text).toContain("(untitled)");
    // No Linear issue URL -- only the "Open run" action button should exist.
    const serialized = JSON.stringify(body.blocks);
    expect(serialized).not.toContain("Open Linear issue");
  });

  it("produces distinct titles for every human-request reason", async () => {
    fetchMock.mockResolvedValue(mockFetchResponse(true));
    const service = new NotificationService(
      makeConfig({ slackWebhookUrl: "https://hooks.slack.com/x" }),
      logger as never,
    );
    const reasons: NotificationPayload["reason"][] = [
      "plan_ambiguous",
      "plan_low_confidence",
      "impl_rejected",
      "impl_uncertain",
      "other",
    ];

    const titles: string[] = [];
    for (const reason of reasons) {
      fetchMock.mockClear();
      await service.sendHumanRequest(makePayload({ reason }));
      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(init.body as string) as { text: string };
      titles.push(body.text);
    }

    expect(new Set(titles).size).toBe(reasons.length);
  });

  it("escapes HTML special characters and includes context/questions in the email body", async () => {
    fetchMock.mockResolvedValue(mockFetchResponse(true));
    const service = new NotificationService(
      makeConfig({ emailTo: "a@x.com", resendApiKey: "resend-key" }),
      logger as never,
    );

    await service.sendHumanRequest(
      makePayload({
        summary: "<script>alert('x')</script>",
        context: "some 'quoted' & <b>context</b>",
        planConfidence: 0.9,
        openQuestions: [{ id: "q1", question: "A & B?", requiredForExecution: true }],
      }),
    );

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string) as { html: string; text: string };
    expect(body.html).not.toContain("<script>alert");
    expect(body.html).toContain("&lt;script&gt;");
    expect(body.html).toContain("Plan confidence");
    expect(body.html).toContain("Context:");
    expect(body.html).toContain("Open questions");
    expect(body.html).toContain("A &amp; B?");
    // Plaintext body carries the same info, unescaped.
    expect(body.text).toContain("A & B?");
    expect(body.text).toContain("Plan confidence: 0.90");
  });

  it("omits optional email sections and the Linear link when absent", async () => {
    fetchMock.mockResolvedValue(mockFetchResponse(true));
    const service = new NotificationService(
      makeConfig({ emailTo: "a@x.com", resendApiKey: "resend-key" }),
      logger as never,
    );

    await service.sendHumanRequest(
      makePayload({ linearIssue: { id: "issue-1", title: "Add auth", url: undefined } }),
    );

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string) as { html: string; text: string };
    expect(body.html).not.toContain("Plan confidence");
    expect(body.html).not.toContain("Context:");
    expect(body.html).not.toContain("Open Linear issue");
    expect(body.text).not.toContain("Linear:");
  });
});
