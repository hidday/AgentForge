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
    summary: "The plan is ambiguous about the auth flow.",
    linearIssue: {
      id: "issue-1",
      identifier: "PRY-42",
      title: "Add OAuth support",
      url: "https://linear.app/team/issue/PRY-42",
    },
    runState: "AwaitingPlanApproval",
    runUrl: "https://dashboard.example.com/runs/run-1",
    ...overrides,
  };
}

describe("NotificationService.isConfigured", () => {
  const logger = makeLogger();

  it("returns true when a slack webhook url is set", () => {
    const svc = new NotificationService(
      { emailFrom: "a@b.com", slackWebhookUrl: "https://hooks.slack.com/x" },
      logger as never,
    );
    expect(svc.isConfigured()).toBe(true);
  });

  it("returns true when both emailTo and resendApiKey are set", () => {
    const svc = new NotificationService(
      { emailFrom: "a@b.com", emailTo: "team@b.com", resendApiKey: "key" },
      logger as never,
    );
    expect(svc.isConfigured()).toBe(true);
  });

  it("returns false when emailTo is set but resendApiKey is missing", () => {
    const svc = new NotificationService(
      { emailFrom: "a@b.com", emailTo: "team@b.com" },
      logger as never,
    );
    expect(svc.isConfigured()).toBe(false);
  });

  it("returns false when nothing is configured", () => {
    const svc = new NotificationService({ emailFrom: "a@b.com" }, logger as never);
    expect(svc.isConfigured()).toBe(false);
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
    return { emailFrom: "noreply@example.com", ...overrides };
  }

  it("marks slack and email both unattempted when neither is configured", async () => {
    const svc = new NotificationService(makeConfig(), logger as never);

    const result = await svc.sendHumanRequest(makePayload());

    expect(result).toEqual({
      slack: { attempted: false, ok: false },
      email: { attempted: false, ok: false },
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("posts to the slack webhook url with a JSON body containing the summary and buttons", async () => {
    fetchMock.mockResolvedValue({ ok: true, text: () => Promise.resolve("") });
    const svc = new NotificationService(
      makeConfig({ slackWebhookUrl: "https://hooks.slack.com/services/x" }),
      logger as never,
    );

    const result = await svc.sendHumanRequest(
      makePayload({
        planConfidence: 0.42,
        openQuestions: [
          { id: "q1", question: "Which provider?", requiredForExecution: true },
          { id: "q2", question: "Which scopes?", requiredForExecution: false },
        ],
      }),
    );

    expect(result.slack).toEqual({ attempted: true, ok: true });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://hooks.slack.com/services/x",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
      }),
    );
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string) as {
      text: string;
      blocks: unknown[];
    };
    expect(body.text).toContain("PRY-42");
    expect(body.text).toContain("Add OAuth support");
    expect(JSON.stringify(body.blocks)).toContain("Which provider?");
    expect(JSON.stringify(body.blocks)).toContain("0.42");
  });

  it("marks slack failed and logs a warning when the slack webhook returns a non-ok response", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 500,
      text: () => Promise.resolve("server exploded"),
    });
    const svc = new NotificationService(
      makeConfig({ slackWebhookUrl: "https://hooks.slack.com/services/x" }),
      logger as never,
    );

    const result = await svc.sendHumanRequest(makePayload());

    expect(result.slack.attempted).toBe(true);
    expect(result.slack.ok).toBe(false);
    expect(result.slack.error).toContain("500");
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ runId: "run-1" }),
      "Slack notification failed",
    );
  });

  it("marks slack failed with the network error message when fetch rejects", async () => {
    fetchMock.mockRejectedValue(new Error("ECONNREFUSED"));
    const svc = new NotificationService(
      makeConfig({ slackWebhookUrl: "https://hooks.slack.com/services/x" }),
      logger as never,
    );

    const result = await svc.sendHumanRequest(makePayload());

    expect(result.slack.ok).toBe(false);
    expect(result.slack.error).toBe("ECONNREFUSED");
  });

  it("sends an email via the Resend API with parsed comma-separated recipients", async () => {
    fetchMock.mockResolvedValue({ ok: true, text: () => Promise.resolve("") });
    const svc = new NotificationService(
      makeConfig({ emailTo: "a@x.com, b@x.com", resendApiKey: "resend-key" }),
      logger as never,
    );

    const result = await svc.sendHumanRequest(makePayload());

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
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string) as {
      from: string;
      to: string[];
      subject: string;
      html: string;
      text: string;
    };
    expect(body.from).toBe("noreply@example.com");
    expect(body.to).toEqual(["a@x.com", "b@x.com"]);
    expect(body.subject).toContain("PRY-42");
    expect(body.html).toContain("Add OAuth support");
    expect(body.text).toContain("Add OAuth support");
  });

  it("marks email failed and logs a warning when Resend returns a non-ok response", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 401,
      text: () => Promise.resolve("unauthorized"),
    });
    const svc = new NotificationService(
      makeConfig({ emailTo: "a@x.com", resendApiKey: "bad-key" }),
      logger as never,
    );

    const result = await svc.sendHumanRequest(makePayload());

    expect(result.email.ok).toBe(false);
    expect(result.email.error).toContain("401");
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ runId: "run-1" }),
      "Email notification failed",
    );
  });

  it("attempts both slack and email concurrently when both are configured", async () => {
    fetchMock.mockResolvedValue({ ok: true, text: () => Promise.resolve("") });
    const svc = new NotificationService(
      makeConfig({
        slackWebhookUrl: "https://hooks.slack.com/services/x",
        emailTo: "a@x.com",
        resendApiKey: "key",
      }),
      logger as never,
    );

    const result = await svc.sendHumanRequest(makePayload());

    expect(result).toEqual({
      slack: { attempted: true, ok: true },
      email: { attempted: true, ok: true },
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("renders context and email HTML-escapes special characters in the title", async () => {
    fetchMock.mockResolvedValue({ ok: true, text: () => Promise.resolve("") });
    const svc = new NotificationService(
      makeConfig({ emailTo: "a@x.com", resendApiKey: "key" }),
      logger as never,
    );

    await svc.sendHumanRequest(
      makePayload({
        context: "Some <script>alert(1)</script> context",
        linearIssue: {
          id: "issue-1",
          identifier: "PRY-42",
          title: '<b>"quoted" & special</b>',
          url: null,
        },
      }),
    );

    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string) as { html: string };
    expect(body.html).not.toContain("<script>");
    expect(body.html).toContain("&lt;script&gt;");
    expect(body.html).toContain("&lt;b&gt;&quot;quoted&quot; &amp; special&lt;/b&gt;");
  });

  it("includes plan confidence, context, open questions, and the Linear link in the plain-text email body", async () => {
    fetchMock.mockResolvedValue({ ok: true, text: () => Promise.resolve("") });
    const svc = new NotificationService(
      makeConfig({ emailTo: "a@x.com", resendApiKey: "key" }),
      logger as never,
    );

    await svc.sendHumanRequest(
      makePayload({
        planConfidence: 0.55,
        context: "some extra context",
        openQuestions: [
          { id: "q1", question: "Which provider?", requiredForExecution: true },
          { id: "q2", question: "Which scopes?", requiredForExecution: false },
        ],
      }),
    );

    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string) as { text: string };
    expect(body.text).toContain("Plan confidence: 0.55");
    expect(body.text).toContain("Context:");
    expect(body.text).toContain("some extra context");
    expect(body.text).toContain("Open questions:");
    expect(body.text).toContain("[required] Which provider?");
    expect(body.text).toContain("- Which scopes?");
    expect(body.text).toContain("Linear: https://linear.app/team/issue/PRY-42");
  });

  it("falls back to '(untitled)' and the raw id when title/identifier are missing", async () => {
    fetchMock.mockResolvedValue({ ok: true, text: () => Promise.resolve("") });
    const svc = new NotificationService(
      makeConfig({ slackWebhookUrl: "https://hooks.slack.com/services/x" }),
      logger as never,
    );

    await svc.sendHumanRequest(
      makePayload({
        linearIssue: { id: "raw-id-1", title: null, url: null },
      }),
    );

    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string) as { text: string };
    expect(body.text).toContain("raw-id-1");
    expect(body.text).toContain("(untitled)");
  });
});
