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
    runState: "AwaitingPlanApproval",
    runUrl: "https://foundry.example.com/runs/run-1",
    linearIssue: {
      id: "lin-1",
      identifier: "PRY-1",
      title: "Do the thing",
      url: "https://linear.app/team/issue/PRY-1",
    },
    ...overrides,
  };
}

function makeConfig(overrides: Partial<NotificationConfig> = {}): NotificationConfig {
  return {
    emailFrom: "AgentForge <onboarding@resend.dev>",
    ...overrides,
  };
}

describe("NotificationService.isConfigured", () => {
  it("returns true when a Slack webhook URL is set", () => {
    const svc = new NotificationService(
      makeConfig({ slackWebhookUrl: "https://hooks.slack.com/x" }),
      makeLogger() as never,
    );
    expect(svc.isConfigured()).toBe(true);
  });

  it("returns true when both emailTo and resendApiKey are set", () => {
    const svc = new NotificationService(
      makeConfig({ emailTo: "a@b.com", resendApiKey: "key" }),
      makeLogger() as never,
    );
    expect(svc.isConfigured()).toBe(true);
  });

  it("returns false when emailTo is set but resendApiKey is missing", () => {
    const svc = new NotificationService(makeConfig({ emailTo: "a@b.com" }), makeLogger() as never);
    expect(svc.isConfigured()).toBe(false);
  });

  it("returns false when resendApiKey is set but emailTo is missing", () => {
    const svc = new NotificationService(makeConfig({ resendApiKey: "key" }), makeLogger() as never);
    expect(svc.isConfigured()).toBe(false);
  });

  it("returns false when nothing is configured", () => {
    const svc = new NotificationService(makeConfig(), makeLogger() as never);
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

  it("does not attempt slack or email, and does not call fetch, when nothing is configured", async () => {
    const svc = new NotificationService(makeConfig(), makeLogger() as never);

    const result = await svc.sendHumanRequest(makePayload());

    expect(result).toEqual({
      slack: { attempted: false, ok: false },
      email: { attempted: false, ok: false },
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sends a Slack message with the expected webhook URL and JSON body when configured", async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, text: () => Promise.resolve("") });
    const svc = new NotificationService(
      makeConfig({ slackWebhookUrl: "https://hooks.slack.com/x" }),
      makeLogger() as never,
    );

    const result = await svc.sendHumanRequest(makePayload());

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://hooks.slack.com/x");
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({ "Content-Type": "application/json" });
    const body = JSON.parse(init.body as string) as { text: string; blocks: unknown[] };
    expect(body.text).toContain("PRY-1");
    expect(body.text).toContain("Do the thing");
    expect(result.slack).toEqual({ attempted: true, ok: true });
    expect(result.email).toEqual({ attempted: false, ok: false });
  });

  it("includes plan confidence and open questions fields in the Slack payload when present", async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, text: () => Promise.resolve("") });
    const svc = new NotificationService(
      makeConfig({ slackWebhookUrl: "https://hooks.slack.com/x" }),
      makeLogger() as never,
    );

    await svc.sendHumanRequest(
      makePayload({
        planConfidence: 0.42,
        context: "Some extra context",
        openQuestions: [
          { id: "q1", question: "Which auth method?", requiredForExecution: true },
          { id: "q2", question: "Which env?", requiredForExecution: false },
        ],
      }),
    );

    const init = fetchMock.mock.calls[0][1];
    const body = JSON.parse(init.body as string) as { blocks: Record<string, unknown>[] };
    const serialized = JSON.stringify(body);
    expect(serialized).toContain("0.42");
    expect(serialized).toContain("Some extra context");
    expect(serialized).toContain("Which auth method?");
    expect(serialized).toContain("required");
  });

  it("marks slack as attempted but not ok, and records the error, when the webhook responds non-OK", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 500,
      text: () => Promise.resolve("server error"),
    });
    const logger = makeLogger();
    const svc = new NotificationService(
      makeConfig({ slackWebhookUrl: "https://hooks.slack.com/x" }),
      logger as never,
    );

    const result = await svc.sendHumanRequest(makePayload());

    expect(result.slack.attempted).toBe(true);
    expect(result.slack.ok).toBe(false);
    expect(result.slack.error).toContain("Slack webhook returned 500");
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ runId: "run-1" }),
      "Slack notification failed",
    );
  });

  it("marks slack as failed when fetch itself rejects (network error)", async () => {
    fetchMock.mockRejectedValue(new Error("network unreachable"));
    const svc = new NotificationService(
      makeConfig({ slackWebhookUrl: "https://hooks.slack.com/x" }),
      makeLogger() as never,
    );

    const result = await svc.sendHumanRequest(makePayload());

    expect(result.slack.ok).toBe(false);
    expect(result.slack.error).toBe("network unreachable");
  });

  it("sends an email via the Resend API with the expected auth header and recipients", async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, text: () => Promise.resolve("") });
    const svc = new NotificationService(
      makeConfig({ emailTo: "a@b.com, c@d.com", resendApiKey: "resend-key" }),
      makeLogger() as never,
    );

    const result = await svc.sendHumanRequest(makePayload());

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.resend.com/emails");
    expect(init.headers).toEqual({
      Authorization: "Bearer resend-key",
      "Content-Type": "application/json",
    });
    const body = JSON.parse(init.body as string) as {
      from: string;
      to: string[];
      subject: string;
      html: string;
      text: string;
    };
    expect(body.to).toEqual(["a@b.com", "c@d.com"]);
    expect(body.subject).toContain("PRY-1");
    expect(body.html).toContain("Do the thing");
    expect(result.email).toEqual({ attempted: true, ok: true });
  });

  it("escapes HTML special characters in the email body", async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, text: () => Promise.resolve("") });
    const svc = new NotificationService(
      makeConfig({ emailTo: "a@b.com", resendApiKey: "key" }),
      makeLogger() as never,
    );

    await svc.sendHumanRequest(
      makePayload({
        linearIssue: {
          id: "lin-1",
          identifier: "PRY-1",
          title: "<script>alert(1)</script>",
          url: null,
        },
      }),
    );

    const init = fetchMock.mock.calls[0][1];
    const body = JSON.parse(init.body as string) as { html: string };
    expect(body.html).not.toContain("<script>alert(1)</script>");
    expect(body.html).toContain("&lt;script&gt;");
  });

  it("marks email as failed and records the error when Resend responds non-OK", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 422,
      text: () => Promise.resolve("invalid request"),
    });
    const logger = makeLogger();
    const svc = new NotificationService(
      makeConfig({ emailTo: "a@b.com", resendApiKey: "key" }),
      logger as never,
    );

    const result = await svc.sendHumanRequest(makePayload());

    expect(result.email.attempted).toBe(true);
    expect(result.email.ok).toBe(false);
    expect(result.email.error).toContain("Resend returned 422");
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ runId: "run-1" }),
      "Email notification failed",
    );
  });

  it("sends both slack and email concurrently when both are configured", async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, text: () => Promise.resolve("") });
    const svc = new NotificationService(
      makeConfig({
        slackWebhookUrl: "https://hooks.slack.com/x",
        emailTo: "a@b.com",
        resendApiKey: "key",
      }),
      makeLogger() as never,
    );

    const result = await svc.sendHumanRequest(makePayload());

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.slack.ok).toBe(true);
    expect(result.email.ok).toBe(true);
  });

  it("uses the issue id as the label when identifier is absent, and '(untitled)' when title is null", async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, text: () => Promise.resolve("") });
    const svc = new NotificationService(
      makeConfig({ slackWebhookUrl: "https://hooks.slack.com/x" }),
      makeLogger() as never,
    );

    await svc.sendHumanRequest(
      makePayload({
        linearIssue: { id: "lin-raw-id", identifier: undefined, title: null, url: null },
      }),
    );

    const init = fetchMock.mock.calls[0][1];
    const body = JSON.parse(init.body as string) as { text: string };
    expect(body.text).toContain("lin-raw-id");
    expect(body.text).toContain("(untitled)");
  });
});
