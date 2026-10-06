import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  NotificationService,
  type NotificationConfig,
  type NotificationPayload,
} from "../../src/notifications/notificationService.js";
import type { Logger } from "../../src/utils/logger.js";

function makeLogger(): Logger {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  } as unknown as Logger;
}

function makePayload(overrides: Partial<NotificationPayload> = {}): NotificationPayload {
  return {
    runId: "run-1",
    reason: "plan_ambiguous",
    summary: "Needs human review",
    linearIssue: {
      id: "lin-1",
      identifier: "AGF-1",
      title: "Fix the thing",
      url: "https://linear.app/team/issue/AGF-1",
    },
    runState: "AwaitingPlanApproval",
    runUrl: "https://foundry.example.com/runs/run-1",
    ...overrides,
  };
}

describe("NotificationService.isConfigured", () => {
  it("returns true when a slack webhook url is set", () => {
    const svc = new NotificationService(
      { emailFrom: "a@b.com", slackWebhookUrl: "https://hooks.slack.com/x" },
      makeLogger(),
    );
    expect(svc.isConfigured()).toBe(true);
  });

  it("returns true when emailTo and resendApiKey are both set", () => {
    const svc = new NotificationService(
      { emailFrom: "a@b.com", emailTo: "dev@b.com", resendApiKey: "key" },
      makeLogger(),
    );
    expect(svc.isConfigured()).toBe(true);
  });

  it("returns false when emailTo is set but resendApiKey is missing", () => {
    const svc = new NotificationService(
      { emailFrom: "a@b.com", emailTo: "dev@b.com" },
      makeLogger(),
    );
    expect(svc.isConfigured()).toBe(false);
  });

  it("returns false when nothing is configured", () => {
    const svc = new NotificationService({ emailFrom: "a@b.com" }, makeLogger());
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

  it("attempts neither channel and returns an all-unattempted result when unconfigured", async () => {
    const svc = new NotificationService({ emailFrom: "a@b.com" }, makeLogger());
    const result = await svc.sendHumanRequest(makePayload());

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result).toEqual({
      slack: { attempted: false, ok: false },
      email: { attempted: false, ok: false },
    });
  });

  it("sends a slack webhook with the expected shape and marks it ok on success", async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, text: vi.fn() });

    const config: NotificationConfig = {
      emailFrom: "a@b.com",
      slackWebhookUrl: "https://hooks.slack.com/services/x",
    };
    const svc = new NotificationService(config, makeLogger());
    const payload = makePayload({
      planConfidence: 0.42,
      context: "some context",
      openQuestions: [
        { id: "q1", question: "What about X?", requiredForExecution: true },
        { id: "q2", question: "What about Y?", requiredForExecution: false },
      ],
    });

    const result = await svc.sendHumanRequest(payload);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://hooks.slack.com/services/x");
    expect(init.method).toBe("POST");
    expect(init.headers["Content-Type"]).toBe("application/json");

    const body = JSON.parse(init.body);
    expect(body.text).toContain("AGF-1");
    expect(body.text).toContain("Fix the thing");
    expect(JSON.stringify(body.blocks)).toContain("Plan needs review (ambiguous)");
    expect(JSON.stringify(body.blocks)).toContain("0.42");
    expect(JSON.stringify(body.blocks)).toContain("some context");
    expect(JSON.stringify(body.blocks)).toContain("required");

    expect(result.slack).toEqual({ attempted: true, ok: true });
    expect(result.email).toEqual({ attempted: false, ok: false });
  });

  it("marks slack failed and logs a warning when the webhook responds with a non-ok status", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 500,
      text: vi.fn().mockResolvedValue("server error"),
    });

    const logger = makeLogger();
    const svc = new NotificationService(
      { emailFrom: "a@b.com", slackWebhookUrl: "https://hooks.slack.com/x" },
      logger,
    );
    const result = await svc.sendHumanRequest(makePayload());

    expect(result.slack.attempted).toBe(true);
    expect(result.slack.ok).toBe(false);
    expect(result.slack.error).toContain("500");
    expect(result.slack.error).toContain("server error");
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ runId: "run-1", error: expect.stringContaining("500") }),
      "Slack notification failed",
    );
  });

  it("marks slack failed when response.text() itself rejects, falling back to empty body", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 503,
      text: vi.fn().mockRejectedValue(new Error("stream closed")),
    });

    const svc = new NotificationService(
      { emailFrom: "a@b.com", slackWebhookUrl: "https://hooks.slack.com/x" },
      makeLogger(),
    );
    const result = await svc.sendHumanRequest(makePayload());

    expect(result.slack.ok).toBe(false);
    expect(result.slack.error).toContain("503");
  });

  it("marks slack failed when fetch itself throws a network error", async () => {
    fetchMock.mockRejectedValue(new Error("network down"));

    const logger = makeLogger();
    const svc = new NotificationService(
      { emailFrom: "a@b.com", slackWebhookUrl: "https://hooks.slack.com/x" },
      logger,
    );
    const result = await svc.sendHumanRequest(makePayload());

    expect(result.slack.ok).toBe(false);
    expect(result.slack.error).toBe("network down");
    expect(logger.warn).toHaveBeenCalled();
  });

  it("marks slack failed with stringified error when a non-Error is thrown", async () => {
    fetchMock.mockRejectedValue("weird failure");

    const svc = new NotificationService(
      { emailFrom: "a@b.com", slackWebhookUrl: "https://hooks.slack.com/x" },
      makeLogger(),
    );
    const result = await svc.sendHumanRequest(makePayload());

    expect(result.slack.error).toBe("weird failure");
  });

  it("sends an email via Resend with recipients split/trimmed from a comma list, and marks it ok", async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, text: vi.fn() });

    const config: NotificationConfig = {
      emailFrom: "AgentForge <noreply@example.com>",
      emailTo: "a@b.com, c@d.com ,",
      resendApiKey: "resend-key-123",
    };
    const svc = new NotificationService(config, makeLogger());
    const payload = makePayload({
      reason: "impl_rejected",
      context: "diff context here",
      planConfidence: 0.75,
      openQuestions: [{ id: "q1", question: "Is this right?", requiredForExecution: true }],
    });

    const result = await svc.sendHumanRequest(payload);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.resend.com/emails");
    expect(init.headers.Authorization).toBe("Bearer resend-key-123");

    const body = JSON.parse(init.body);
    expect(body.from).toBe("AgentForge <noreply@example.com>");
    expect(body.to).toEqual(["a@b.com", "c@d.com"]);
    expect(body.subject).toContain("AGF-1");
    expect(body.subject).toContain("Implementation needs review (rejected by agent)");
    expect(body.html).toContain("diff context here");
    expect(body.html).toContain("0.75");
    expect(body.html).toContain("Is this right?");
    expect(body.html).toContain("[required]");
    expect(body.text).toContain("diff context here");
    expect(body.text).toContain("Run: https://foundry.example.com/runs/run-1");
    expect(body.text).toContain("Linear: https://linear.app/team/issue/AGF-1");

    expect(result.email).toEqual({ attempted: true, ok: true });
  });

  it("marks email failed and logs a warning when Resend responds with a non-ok status", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 422,
      text: vi.fn().mockResolvedValue("invalid recipient"),
    });

    const logger = makeLogger();
    const svc = new NotificationService(
      { emailFrom: "a@b.com", emailTo: "dev@b.com", resendApiKey: "key" },
      logger,
    );
    const result = await svc.sendHumanRequest(makePayload());

    expect(result.email.attempted).toBe(true);
    expect(result.email.ok).toBe(false);
    expect(result.email.error).toContain("422");
    expect(result.email.error).toContain("invalid recipient");
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ runId: "run-1", error: expect.stringContaining("422") }),
      "Email notification failed",
    );
  });

  it("marks email failed when fetch throws", async () => {
    fetchMock.mockRejectedValue(new Error("DNS failure"));

    const svc = new NotificationService(
      { emailFrom: "a@b.com", emailTo: "dev@b.com", resendApiKey: "key" },
      makeLogger(),
    );
    const result = await svc.sendHumanRequest(makePayload());

    expect(result.email.ok).toBe(false);
    expect(result.email.error).toBe("DNS failure");
  });

  it("attempts both slack and email concurrently when both are configured, independently of each other's outcome", async () => {
    fetchMock.mockImplementation((url: string) => {
      if (url.includes("slack")) {
        return Promise.resolve({ ok: false, status: 500, text: vi.fn().mockResolvedValue("x") });
      }
      return Promise.resolve({ ok: true, status: 200, text: vi.fn() });
    });

    const svc = new NotificationService(
      {
        emailFrom: "a@b.com",
        slackWebhookUrl: "https://hooks.slack.com/x",
        emailTo: "dev@b.com",
        resendApiKey: "key",
      },
      makeLogger(),
    );
    const result = await svc.sendHumanRequest(makePayload());

    expect(result.slack).toEqual({ attempted: true, ok: false, error: expect.any(String) });
    expect(result.email).toEqual({ attempted: true, ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("renders fallback labels for untitled issues and uses the raw id when no identifier is present", async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, text: vi.fn() });

    const svc = new NotificationService(
      { emailFrom: "a@b.com", slackWebhookUrl: "https://hooks.slack.com/x" },
      makeLogger(),
    );
    const payload = makePayload({
      reason: "other",
      linearIssue: { id: "raw-id-1", title: null, url: null },
    });

    await svc.sendHumanRequest(payload);

    const [, init] = fetchMock.mock.calls[0];
    const body = JSON.parse(init.body);
    expect(body.text).toContain("raw-id-1");
    expect(body.text).toContain("(untitled)");
    expect(body.text).toContain("Human intervention requested");
    // no Linear issue button when url is missing
    const actionsBlock = body.blocks.find((b: { type: string }) => b.type === "actions");
    expect(actionsBlock.elements).toHaveLength(1);
  });

  it("omits the Linear issue link from the email HTML body when linearIssue.url is absent", async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, text: vi.fn() });

    const svc = new NotificationService(
      { emailFrom: "a@b.com", emailTo: "dev@b.com", resendApiKey: "key" },
      makeLogger(),
    );
    const payload = makePayload({
      linearIssue: { id: "raw-id-2", title: "No link issue", url: null },
    });

    await svc.sendHumanRequest(payload);

    const [, init] = fetchMock.mock.calls[0];
    const body = JSON.parse(init.body);
    expect(body.html).not.toContain("Open Linear issue");
    expect(body.html).toContain("Open run");
    expect(body.text).not.toContain("Linear:");
  });

  it("maps every HumanRequestReason to a distinct label via the email subject", async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, text: vi.fn() });
    const svc = new NotificationService(
      { emailFrom: "a@b.com", emailTo: "dev@b.com", resendApiKey: "key" },
      makeLogger(),
    );

    const reasons: NotificationPayload["reason"][] = [
      "plan_ambiguous",
      "plan_low_confidence",
      "impl_rejected",
      "impl_uncertain",
      "other",
    ];
    const labels = new Set<string>();
    for (const reason of reasons) {
      fetchMock.mockClear();
      await svc.sendHumanRequest(makePayload({ reason }));
      const [, init] = fetchMock.mock.calls[0];
      const body = JSON.parse(init.body);
      labels.add(body.subject as string);
    }
    expect(labels.size).toBe(reasons.length);
  });
});
