import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  NotificationService,
  type NotificationConfig,
  type NotificationPayload,
} from "../../src/notifications/notificationService.js";

function makeMockLogger() {
  return { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() };
}

function makePayload(overrides: Partial<NotificationPayload> = {}): NotificationPayload {
  return {
    runId: "run-1",
    reason: "plan_ambiguous",
    summary: "Plan confidence below threshold",
    linearIssue: {
      id: "issue-1",
      identifier: "ENG-42",
      title: "Add login",
      url: "https://linear.app/team/issue/ENG-42",
    },
    runState: "AwaitingPlanApproval",
    runUrl: "http://localhost:5173/runs/run-1",
    ...overrides,
  };
}

describe("NotificationService.isConfigured", () => {
  it("returns false when neither slack nor email is configured", () => {
    const service = new NotificationService({ emailFrom: "bot@example.com" }, makeMockLogger());
    expect(service.isConfigured()).toBe(false);
  });

  it("returns true when slackWebhookUrl is set", () => {
    const service = new NotificationService(
      { emailFrom: "bot@example.com", slackWebhookUrl: "https://hooks.slack.com/x" },
      makeMockLogger(),
    );
    expect(service.isConfigured()).toBe(true);
  });

  it("returns true when both emailTo and resendApiKey are set", () => {
    const service = new NotificationService(
      { emailFrom: "bot@example.com", emailTo: "ops@example.com", resendApiKey: "re_key" },
      makeMockLogger(),
    );
    expect(service.isConfigured()).toBe(true);
  });

  it("returns false when emailTo is set but resendApiKey is missing", () => {
    const service = new NotificationService(
      { emailFrom: "bot@example.com", emailTo: "ops@example.com" },
      makeMockLogger(),
    );
    expect(service.isConfigured()).toBe(false);
  });

  it("returns false when resendApiKey is set but emailTo is missing", () => {
    const service = new NotificationService(
      { emailFrom: "bot@example.com", resendApiKey: "re_key" },
      makeMockLogger(),
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

  it("attempts neither channel and makes no network call when nothing is configured", async () => {
    const logger = makeMockLogger();
    const service = new NotificationService({ emailFrom: "bot@example.com" }, logger);

    const result = await service.sendHumanRequest(makePayload());

    expect(result).toEqual({
      slack: { attempted: false, ok: false },
      email: { attempted: false, ok: false },
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sends a Slack webhook with header, summary, fields, context and action buttons", async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, text: async () => "" });
    const config: NotificationConfig = {
      emailFrom: "bot@example.com",
      slackWebhookUrl: "https://hooks.slack.com/services/x",
    };
    const service = new NotificationService(config, makeMockLogger());

    const payload = makePayload({
      context: "Linear issue mentions OAuth but plan proposes API keys",
      planConfidence: 0.42,
      openQuestions: [
        { id: "q1", question: "Which auth method?", requiredForExecution: true },
        { id: "q2", question: "Which provider?", requiredForExecution: false },
        { id: "q3", question: "Third question", requiredForExecution: false },
        { id: "q4", question: "Fourth question (should be sliced out)", requiredForExecution: false },
      ],
    });

    const result = await service.sendHumanRequest(payload);

    expect(result.slack).toEqual({ attempted: true, ok: true });
    expect(result.email).toEqual({ attempted: false, ok: false });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://hooks.slack.com/services/x");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)["Content-Type"]).toBe("application/json");

    const body = JSON.parse(init.body as string) as {
      text: string;
      blocks: Array<Record<string, unknown>>;
    };
    expect(body.text).toContain("ENG-42");
    expect(body.text).toContain("Add login");

    const serialized = JSON.stringify(body.blocks);
    expect(serialized).toContain("Plan confidence");
    expect(serialized).toContain("0.42");
    expect(serialized).toContain("Linear issue mentions OAuth");
    expect(serialized).toContain("Which auth method?");
    expect(serialized).toContain("[required]");
    expect(serialized).not.toContain("Fourth question");

    const actionsBlock = body.blocks.find((b) => b.type === "actions") as {
      elements: Array<{ url: string }>;
    };
    expect(actionsBlock.elements).toHaveLength(2);
    expect(actionsBlock.elements[0].url).toBe(payload.runUrl);
    expect(actionsBlock.elements[1].url).toBe(payload.linearIssue.url);
  });

  it("omits the Linear issue button when linearIssue.url is absent", async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, text: async () => "" });
    const service = new NotificationService(
      { emailFrom: "bot@example.com", slackWebhookUrl: "https://hooks.slack.com/x" },
      makeMockLogger(),
    );

    await service.sendHumanRequest(
      makePayload({ linearIssue: { id: "issue-1", title: "No url issue", url: null } }),
    );

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string) as { blocks: Array<Record<string, unknown>> };
    const actionsBlock = body.blocks.find((b) => b.type === "actions") as {
      elements: Array<{ url: string }>;
    };
    expect(actionsBlock.elements).toHaveLength(1);
  });

  it("records a slack failure and logs a warning when the webhook responds non-ok", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500, text: async () => "server error" });
    const logger = makeMockLogger();
    const service = new NotificationService(
      { emailFrom: "bot@example.com", slackWebhookUrl: "https://hooks.slack.com/x" },
      logger,
    );

    const result = await service.sendHumanRequest(makePayload());

    expect(result.slack.attempted).toBe(true);
    expect(result.slack.ok).toBe(false);
    expect(result.slack.error).toContain("500");
    expect(result.slack.error).toContain("server error");
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ runId: "run-1" }),
      "Slack notification failed",
    );
  });

  it("records a slack failure when fetch itself rejects (network error)", async () => {
    fetchMock.mockRejectedValue(new Error("ECONNRESET"));
    const logger = makeMockLogger();
    const service = new NotificationService(
      { emailFrom: "bot@example.com", slackWebhookUrl: "https://hooks.slack.com/x" },
      logger,
    );

    const result = await service.sendHumanRequest(makePayload());

    expect(result.slack.ok).toBe(false);
    expect(result.slack.error).toBe("ECONNRESET");
    expect(logger.warn).toHaveBeenCalledTimes(1);
  });

  it("sends an email via Resend with subject, html, text, Authorization header and recipients split/trimmed", async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, text: async () => "" });
    const service = new NotificationService(
      {
        emailFrom: "bot@example.com",
        emailTo: "ops@example.com, lead@example.com ,  ,extra@example.com",
        resendApiKey: "re_test_key",
      },
      makeMockLogger(),
    );

    const payload = makePayload({
      context: "<script>alert(1)</script> & stuff",
      planConfidence: 0.9,
      openQuestions: [{ id: "q1", question: "A & B <question>", requiredForExecution: true }],
    });

    const result = await service.sendHumanRequest(payload);

    expect(result.email).toEqual({ attempted: true, ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.resend.com/emails");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer re_test_key");
    expect((init.headers as Record<string, string>)["Content-Type"]).toBe("application/json");

    const body = JSON.parse(init.body as string) as {
      from: string;
      to: string[];
      subject: string;
      html: string;
      text: string;
    };
    expect(body.from).toBe("bot@example.com");
    expect(body.to).toEqual(["ops@example.com", "lead@example.com", "extra@example.com"]);
    expect(body.subject).toContain("ENG-42");
    expect(body.subject).toContain("Plan needs review (ambiguous)");

    // HTML must be escaped so raw markup from context/questions can't inject tags.
    expect(body.html).not.toContain("<script>alert(1)</script>");
    expect(body.html).toContain("&lt;script&gt;");
    expect(body.html).toContain("A &amp; B &lt;question&gt;");
    expect(body.html).toContain("[required]");
    expect(body.html).toContain("0.90");

    // Plain-text variant keeps the raw (unescaped) content.
    expect(body.text).toContain("<script>alert(1)</script>");
    expect(body.text).toContain("Plan needs review (ambiguous)");
    expect(body.text).toContain("Linear:");
  });

  it("records an email failure and logs a warning when Resend responds non-ok", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 422, text: async () => "bad request" });
    const logger = makeMockLogger();
    const service = new NotificationService(
      { emailFrom: "bot@example.com", emailTo: "ops@example.com", resendApiKey: "re_key" },
      logger,
    );

    const result = await service.sendHumanRequest(makePayload());

    expect(result.email.ok).toBe(false);
    expect(result.email.error).toContain("422");
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ runId: "run-1" }),
      "Email notification failed",
    );
  });

  it("records an email failure when fetch itself rejects", async () => {
    fetchMock.mockRejectedValue(new Error("DNS failure"));
    const logger = makeMockLogger();
    const service = new NotificationService(
      { emailFrom: "bot@example.com", emailTo: "ops@example.com", resendApiKey: "re_key" },
      logger,
    );

    const result = await service.sendHumanRequest(makePayload());

    expect(result.email.ok).toBe(false);
    expect(result.email.error).toBe("DNS failure");
  });

  it("sends both slack and email concurrently when both channels are configured", async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, text: async () => "" });
    const service = new NotificationService(
      {
        emailFrom: "bot@example.com",
        slackWebhookUrl: "https://hooks.slack.com/x",
        emailTo: "ops@example.com",
        resendApiKey: "re_key",
      },
      makeMockLogger(),
    );

    const result = await service.sendHumanRequest(makePayload());

    expect(result.slack).toEqual({ attempted: true, ok: true });
    expect(result.email).toEqual({ attempted: true, ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("omits the plan-confidence field/line when planConfidence is undefined", async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, text: async () => "" });
    const service = new NotificationService(
      { emailFrom: "bot@example.com", slackWebhookUrl: "https://hooks.slack.com/x" },
      makeMockLogger(),
    );

    await service.sendHumanRequest(makePayload({ planConfidence: undefined, openQuestions: [] }));

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string) as { blocks: Array<Record<string, unknown>> };
    expect(JSON.stringify(body.blocks)).not.toContain("*Plan confidence:*");
  });

  it("maps every HumanRequestReason to a distinct, non-empty label", async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, text: async () => "" });
    const service = new NotificationService(
      { emailFrom: "bot@example.com", slackWebhookUrl: "https://hooks.slack.com/x" },
      makeMockLogger(),
    );

    const reasons = [
      "plan_ambiguous",
      "plan_low_confidence",
      "impl_rejected",
      "impl_uncertain",
      "other",
    ] as const;

    const labels = new Set<string>();
    for (const reason of reasons) {
      fetchMock.mockClear();
      await service.sendHumanRequest(makePayload({ reason }));
      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(init.body as string) as { text: string };
      expect(body.text.length).toBeGreaterThan(0);
      labels.add(body.text.split(" — ")[0]);
    }
    expect(labels.size).toBe(reasons.length);
  });
});
