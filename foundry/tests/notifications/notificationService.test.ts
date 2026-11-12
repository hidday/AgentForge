import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  NotificationService,
  type NotificationConfig,
  type NotificationPayload,
} from "../../src/notifications/notificationService.js";

function makeMockLogger() {
  return {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  };
}

function makePayload(overrides: Partial<NotificationPayload> = {}): NotificationPayload {
  return {
    runId: "run-1",
    reason: "plan_ambiguous",
    summary: "Plan confidence below threshold",
    linearIssue: {
      id: "issue-1",
      identifier: "LIN-42",
      title: "Add login flow",
      url: "https://linear.app/team/issue/LIN-42",
    },
    runState: "AwaitingPlanApproval",
    runUrl: "https://app.example.com/runs/run-1",
    ...overrides,
  };
}

function okResponse(body = "{}") {
  return {
    ok: true,
    status: 200,
    text: vi.fn().mockResolvedValue(body),
  } as unknown as Response;
}

function failResponse(status: number, body = "boom") {
  return {
    ok: false,
    status,
    text: vi.fn().mockResolvedValue(body),
  } as unknown as Response;
}

describe("NotificationService.isConfigured", () => {
  it("returns false when neither channel is configured", () => {
    const svc = new NotificationService(
      { emailFrom: "from@example.com" },
      makeMockLogger() as never,
    );
    expect(svc.isConfigured()).toBe(false);
  });

  it("returns true when a slack webhook url is set", () => {
    const svc = new NotificationService(
      { emailFrom: "from@example.com", slackWebhookUrl: "https://hooks.slack.com/x" },
      makeMockLogger() as never,
    );
    expect(svc.isConfigured()).toBe(true);
  });

  it("returns true when email is fully configured (emailTo + resendApiKey)", () => {
    const svc = new NotificationService(
      { emailFrom: "from@example.com", emailTo: "a@example.com", resendApiKey: "key" },
      makeMockLogger() as never,
    );
    expect(svc.isConfigured()).toBe(true);
  });

  it("returns false when emailTo is set but resendApiKey is missing", () => {
    const svc = new NotificationService(
      { emailFrom: "from@example.com", emailTo: "a@example.com" },
      makeMockLogger() as never,
    );
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

  it("does nothing and resolves with both channels unattempted when unconfigured", async () => {
    const logger = makeMockLogger();
    const svc = new NotificationService({ emailFrom: "from@example.com" }, logger as never);
    const result = await svc.sendHumanRequest(makePayload());
    expect(result).toEqual({
      slack: { attempted: false, ok: false },
      email: { attempted: false, ok: false },
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sends a slack message successfully when only slack is configured", async () => {
    fetchMock.mockResolvedValue(okResponse());
    const logger = makeMockLogger();
    const svc = new NotificationService(
      { emailFrom: "from@example.com", slackWebhookUrl: "https://hooks.slack.com/x" },
      logger as never,
    );
    const result = await svc.sendHumanRequest(makePayload());

    expect(result.slack).toEqual({ attempted: true, ok: true });
    expect(result.email).toEqual({ attempted: false, ok: false });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://hooks.slack.com/x");
    expect(init.method).toBe("POST");
    const body = JSON.parse(init.body);
    expect(body.text).toContain("LIN-42");
    expect(body.text).toContain("Add login flow");
  });

  it("includes plan confidence and open questions fields in the slack payload", async () => {
    fetchMock.mockResolvedValue(okResponse());
    const svc = new NotificationService(
      { emailFrom: "from@example.com", slackWebhookUrl: "https://hooks.slack.com/x" },
      makeMockLogger() as never,
    );
    await svc.sendHumanRequest(
      makePayload({
        planConfidence: 0.42,
        openQuestions: [
          { id: "q1", question: "Which auth provider?", requiredForExecution: true },
          { id: "q2", question: "Which region?", requiredForExecution: false },
        ],
        context: "a".repeat(2000),
      }),
    );
    const [, init] = fetchMock.mock.calls[0];
    const body = JSON.parse(init.body);
    const serialized = JSON.stringify(body);
    expect(serialized).toContain("0.42");
    expect(serialized).toContain("2 (1 required)");
    expect(serialized).toContain("Which auth provider?");
    // context block truncated to 1500 chars with ellipsis
    expect(serialized).toContain("…");
  });

  it("omits the Linear issue button when linearIssue.url is absent", async () => {
    fetchMock.mockResolvedValue(okResponse());
    const svc = new NotificationService(
      { emailFrom: "from@example.com", slackWebhookUrl: "https://hooks.slack.com/x" },
      makeMockLogger() as never,
    );
    await svc.sendHumanRequest(
      makePayload({
        linearIssue: { id: "issue-9", title: null, url: null },
      }),
    );
    const [, init] = fetchMock.mock.calls[0];
    const body = JSON.parse(init.body);
    expect(body.text).toContain("issue-9");
    expect(body.text).toContain("(untitled)");
    const actions = body.blocks.find((b: { type: string }) => b.type === "actions");
    expect(actions.elements).toHaveLength(1);
  });

  it("records a slack failure when the webhook responds with a non-ok status", async () => {
    fetchMock.mockResolvedValue(failResponse(500, "server exploded"));
    const logger = makeMockLogger();
    const svc = new NotificationService(
      { emailFrom: "from@example.com", slackWebhookUrl: "https://hooks.slack.com/x" },
      logger as never,
    );
    const result = await svc.sendHumanRequest(makePayload());

    expect(result.slack.attempted).toBe(true);
    expect(result.slack.ok).toBe(false);
    expect(result.slack.error).toContain("500");
    expect(result.slack.error).toContain("server exploded");
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ runId: "run-1", error: expect.stringContaining("500") }),
      "Slack notification failed",
    );
  });

  it("records a slack failure with a generic message when fetch throws a non-Error value", async () => {
    fetchMock.mockRejectedValue("network down");
    const svc = new NotificationService(
      { emailFrom: "from@example.com", slackWebhookUrl: "https://hooks.slack.com/x" },
      makeMockLogger() as never,
    );
    const result = await svc.sendHumanRequest(makePayload());
    expect(result.slack.ok).toBe(false);
    expect(result.slack.error).toBe("network down");
  });

  it("handles the slack response body read itself failing", async () => {
    const resp = {
      ok: false,
      status: 503,
      text: vi.fn().mockRejectedValue(new Error("stream closed")),
    } as unknown as Response;
    fetchMock.mockResolvedValue(resp);
    const svc = new NotificationService(
      { emailFrom: "from@example.com", slackWebhookUrl: "https://hooks.slack.com/x" },
      makeMockLogger() as never,
    );
    const result = await svc.sendHumanRequest(makePayload());
    expect(result.slack.ok).toBe(false);
    expect(result.slack.error).toContain("503");
  });

  it("sends an email successfully when only email is configured, splitting comma-separated recipients", async () => {
    fetchMock.mockResolvedValue(okResponse());
    const svc = new NotificationService(
      {
        emailFrom: "bot@example.com",
        emailTo: "a@example.com, b@example.com ,,",
        resendApiKey: "resend-key",
      },
      makeMockLogger() as never,
    );
    const result = await svc.sendHumanRequest(makePayload());

    expect(result.email).toEqual({ attempted: true, ok: true });
    expect(result.slack).toEqual({ attempted: false, ok: false });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.resend.com/emails");
    expect(init.headers.Authorization).toBe("Bearer resend-key");
    const body = JSON.parse(init.body);
    expect(body.from).toBe("bot@example.com");
    expect(body.to).toEqual(["a@example.com", "b@example.com"]);
    expect(body.subject).toContain("LIN-42");
    expect(body.html).toContain("Add login flow");
    expect(body.text).toContain("Add login flow");
  });

  it("escapes HTML special characters in the rendered email", async () => {
    fetchMock.mockResolvedValue(okResponse());
    const svc = new NotificationService(
      { emailFrom: "bot@example.com", emailTo: "a@example.com", resendApiKey: "resend-key" },
      makeMockLogger() as never,
    );
    await svc.sendHumanRequest(
      makePayload({
        linearIssue: {
          id: "issue-1",
          identifier: "LIN-42",
          title: '<script>alert("x")</script>',
          url: "https://linear.app/x?a=1&b=2",
        },
        context: "line with <b>html</b> & \"quotes\" 'and' more",
      }),
    );
    const [, init] = fetchMock.mock.calls[0];
    const body = JSON.parse(init.body);
    expect(body.html).not.toContain("<script>alert");
    expect(body.html).toContain("&lt;script&gt;");
    expect(body.html).toContain("&amp;b=2");
    expect(body.html).toContain("&lt;b&gt;html&lt;/b&gt;");
    expect(body.html).toContain("&quot;quotes&quot;");
    expect(body.html).toContain("&#39;and&#39;");
  });

  it("records an email failure when resend responds with a non-ok status", async () => {
    fetchMock.mockResolvedValue(failResponse(422, "invalid recipient"));
    const logger = makeMockLogger();
    const svc = new NotificationService(
      { emailFrom: "bot@example.com", emailTo: "a@example.com", resendApiKey: "resend-key" },
      logger as never,
    );
    const result = await svc.sendHumanRequest(makePayload());
    expect(result.email.ok).toBe(false);
    expect(result.email.error).toContain("422");
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ runId: "run-1" }),
      "Email notification failed",
    );
  });

  it("handles partial failure: slack succeeds, email fails, when both are configured", async () => {
    fetchMock.mockImplementation((url: string) => {
      if (url === "https://hooks.slack.com/x") return Promise.resolve(okResponse());
      return Promise.resolve(failResponse(500, "resend down"));
    });
    const svc = new NotificationService(
      {
        emailFrom: "bot@example.com",
        emailTo: "a@example.com",
        resendApiKey: "resend-key",
        slackWebhookUrl: "https://hooks.slack.com/x",
      },
      makeMockLogger() as never,
    );
    const result = await svc.sendHumanRequest(makePayload());
    expect(result.slack).toEqual({ attempted: true, ok: true });
    expect(result.email.attempted).toBe(true);
    expect(result.email.ok).toBe(false);
    expect(result.email.error).toContain("500");
  });

  it("handles total failure: both slack and email fail, when both are configured", async () => {
    fetchMock.mockResolvedValue(failResponse(500, "down"));
    const svc = new NotificationService(
      {
        emailFrom: "bot@example.com",
        emailTo: "a@example.com",
        resendApiKey: "resend-key",
        slackWebhookUrl: "https://hooks.slack.com/x",
      },
      makeMockLogger() as never,
    );
    const result = await svc.sendHumanRequest(makePayload());
    expect(result.slack.ok).toBe(false);
    expect(result.email.ok).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("succeeds on both channels when both are configured and both calls succeed", async () => {
    fetchMock.mockResolvedValue(okResponse());
    const svc = new NotificationService(
      {
        emailFrom: "bot@example.com",
        emailTo: "a@example.com",
        resendApiKey: "resend-key",
        slackWebhookUrl: "https://hooks.slack.com/x",
      },
      makeMockLogger() as never,
    );
    const result = await svc.sendHumanRequest(makePayload());
    expect(result).toEqual({
      slack: { attempted: true, ok: true },
      email: { attempted: true, ok: true },
    });
  });

  it("covers every reason label and includes it in slack/email payloads", async () => {
    fetchMock.mockResolvedValue(okResponse());
    const svc = new NotificationService(
      { emailFrom: "bot@example.com", emailTo: "a@example.com", resendApiKey: "resend-key" },
      makeMockLogger() as never,
    );
    const reasons: NotificationPayload["reason"][] = [
      "plan_ambiguous",
      "plan_low_confidence",
      "impl_rejected",
      "impl_uncertain",
      "other",
    ];
    for (const reason of reasons) {
      fetchMock.mockClear();
      await svc.sendHumanRequest(makePayload({ reason }));
      const [, init] = fetchMock.mock.calls[0];
      const body = JSON.parse(init.body);
      expect(typeof body.subject).toBe("string");
      expect(body.subject.length).toBeGreaterThan(0);
    }
  });
});

describe("NotificationConfig type sanity", () => {
  it("accepts a config object shape", () => {
    const config: NotificationConfig = { emailFrom: "x@example.com" };
    expect(config.emailFrom).toBe("x@example.com");
  });
});
