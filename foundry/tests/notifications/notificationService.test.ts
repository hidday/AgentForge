import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  NotificationService,
  type NotificationConfig,
  type NotificationPayload,
} from "../../src/notifications/notificationService.js";

function makePayload(overrides: Partial<NotificationPayload> = {}): NotificationPayload {
  return {
    runId: "run-1",
    reason: "plan_ambiguous",
    summary: "Needs human input",
    linearIssue: {
      id: "lin-1",
      identifier: "PRY-1",
      title: "Do the thing",
      url: "https://linear.app/team/issue/PRY-1",
    },
    runState: "AwaitingPlanApproval",
    runUrl: "https://foundry.example.com/runs/run-1",
    ...overrides,
  };
}

function makeLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
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
      makeConfig({ slackWebhookUrl: "https://hooks.slack.com/services/abc" }),
      makeLogger() as never,
    );
    expect(svc.isConfigured()).toBe(true);
  });

  it("returns true when email-to and resend API key are both set", () => {
    const svc = new NotificationService(
      makeConfig({ emailTo: "a@example.com", resendApiKey: "re_123" }),
      makeLogger() as never,
    );
    expect(svc.isConfigured()).toBe(true);
  });

  it("returns false when emailTo is set but resendApiKey is missing", () => {
    const svc = new NotificationService(
      makeConfig({ emailTo: "a@example.com" }),
      makeLogger() as never,
    );
    expect(svc.isConfigured()).toBe(false);
  });

  it("returns false when resendApiKey is set but emailTo is missing", () => {
    const svc = new NotificationService(
      makeConfig({ resendApiKey: "re_123" }),
      makeLogger() as never,
    );
    expect(svc.isConfigured()).toBe(false);
  });

  it("returns false when neither Slack nor email is configured", () => {
    const svc = new NotificationService(makeConfig(), makeLogger() as never);
    expect(svc.isConfigured()).toBe(false);
  });
});

describe("NotificationService.sendHumanRequest", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    global.fetch = vi.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("does not attempt any send when nothing is configured", async () => {
    const svc = new NotificationService(makeConfig(), makeLogger() as never);
    const result = await svc.sendHumanRequest(makePayload());

    expect(result).toEqual({
      slack: { attempted: false, ok: false },
      email: { attempted: false, ok: false },
    });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("sends a Slack webhook POST with the expected shape and marks it ok on success", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      text: vi.fn().mockResolvedValue(""),
    });

    const svc = new NotificationService(
      makeConfig({ slackWebhookUrl: "https://hooks.slack.com/services/abc" }),
      makeLogger() as never,
    );
    const payload = makePayload({
      planConfidence: 0.42,
      openQuestions: [
        { id: "q1", question: "What about auth?", requiredForExecution: true },
        { id: "q2", question: "Which env?", requiredForExecution: false },
      ],
      context: "some extra context",
    });

    const result = await svc.sendHumanRequest(payload);

    expect(result.slack).toEqual({ attempted: true, ok: true });
    expect(result.email).toEqual({ attempted: false, ok: false });
    expect(global.fetch).toHaveBeenCalledTimes(1);

    const [url, init] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe("https://hooks.slack.com/services/abc");
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({ "Content-Type": "application/json" });

    const body = JSON.parse(init.body as string);
    expect(body.text).toContain("PRY-1");
    expect(body.text).toContain("Do the thing");
    expect(Array.isArray(body.blocks)).toBe(true);
    // header block
    expect(body.blocks[0].type).toBe("header");
    // section with summary
    expect(body.blocks[1].text.text).toBe("Needs human input");
    // fields section should include plan confidence and open questions count
    const fieldsSection = body.blocks[2];
    const fieldTexts = fieldsSection.fields.map((f: { text: string }) => f.text);
    expect(fieldTexts.some((t: string) => t.includes("0.42"))).toBe(true);
    expect(fieldTexts.some((t: string) => t.includes("2 (1 required)"))).toBe(true);
    // actions block should include both "Open run" and "Open Linear issue" buttons
    const actionsBlock = body.blocks[body.blocks.length - 1];
    expect(actionsBlock.type).toBe("actions");
    expect(actionsBlock.elements).toHaveLength(2);
    expect(actionsBlock.elements[1].url).toBe("https://linear.app/team/issue/PRY-1");
  });

  it("omits the Linear issue button when linearIssue.url is not set", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      text: vi.fn().mockResolvedValue(""),
    });

    const svc = new NotificationService(
      makeConfig({ slackWebhookUrl: "https://hooks.slack.com/services/abc" }),
      makeLogger() as never,
    );
    const payload = makePayload({
      linearIssue: { id: "lin-1", title: null, url: null },
    });

    await svc.sendHumanRequest(payload);

    const [, init] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    const body = JSON.parse(init.body as string);
    const actionsBlock = body.blocks[body.blocks.length - 1];
    expect(actionsBlock.elements).toHaveLength(1);
    expect(body.text).toContain("(untitled)");
    // falls back to raw id when identifier is absent
    expect(body.text).toContain("lin-1");
  });

  it("marks Slack as failed and logs a warning when the webhook returns a non-ok response", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      status: 500,
      text: vi.fn().mockResolvedValue("internal error"),
    });

    const logger = makeLogger();
    const svc = new NotificationService(
      makeConfig({ slackWebhookUrl: "https://hooks.slack.com/services/abc" }),
      logger as never,
    );

    const result = await svc.sendHumanRequest(makePayload());

    expect(result.slack.attempted).toBe(true);
    expect(result.slack.ok).toBe(false);
    expect(result.slack.error).toContain("500");
    expect(result.slack.error).toContain("internal error");
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ runId: "run-1", error: expect.stringContaining("500") }),
      "Slack notification failed",
    );
  });

  it("marks Slack as failed when fetch itself rejects (network error)", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("network down"));

    const logger = makeLogger();
    const svc = new NotificationService(
      makeConfig({ slackWebhookUrl: "https://hooks.slack.com/services/abc" }),
      logger as never,
    );

    const result = await svc.sendHumanRequest(makePayload());

    expect(result.slack).toEqual({ attempted: true, ok: false, error: "network down" });
    expect(logger.warn).toHaveBeenCalledWith(
      { runId: "run-1", error: "network down" },
      "Slack notification failed",
    );
  });

  it("sends an email via the Resend API with the expected request shape", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      text: vi.fn().mockResolvedValue(""),
    });

    const svc = new NotificationService(
      makeConfig({
        emailTo: "a@example.com, b@example.com",
        resendApiKey: "re_secret",
      }),
      makeLogger() as never,
    );

    const payload = makePayload({
      planConfidence: 0.75,
      context: "Needs clarification on scope",
      openQuestions: [{ id: "q1", question: "Which repo?", requiredForExecution: true }],
    });

    const result = await svc.sendHumanRequest(payload);

    expect(result.email).toEqual({ attempted: true, ok: true });
    expect(global.fetch).toHaveBeenCalledTimes(1);

    const [url, init] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe("https://api.resend.com/emails");
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({
      Authorization: "Bearer re_secret",
      "Content-Type": "application/json",
    });

    const body = JSON.parse(init.body as string);
    expect(body.from).toBe("AgentForge <onboarding@resend.dev>");
    // comma separated recipients are split and trimmed
    expect(body.to).toEqual(["a@example.com", "b@example.com"]);
    expect(body.subject).toContain("PRY-1");
    expect(body.subject).toContain("Do the thing");
    expect(body.html).toContain("Needs human input");
    expect(body.html).toContain("0.75");
    expect(body.html).toContain("Needs clarification on scope");
    expect(body.html).toContain("Which repo?");
    expect(body.text).toContain("Needs human input");
    expect(body.text).toContain("Which repo?");
  });

  it("escapes HTML special characters in the rendered email body", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      text: vi.fn().mockResolvedValue(""),
    });

    const svc = new NotificationService(
      makeConfig({ emailTo: "a@example.com", resendApiKey: "re_secret" }),
      makeLogger() as never,
    );

    const payload = makePayload({
      summary: `<script>alert("xss")</script>`,
      linearIssue: { id: "lin-1", title: "A & B <tag>", url: null },
    });

    await svc.sendHumanRequest(payload);

    const [, init] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    const body = JSON.parse(init.body as string);
    expect(body.html).not.toContain("<script>");
    expect(body.html).toContain("&lt;script&gt;");
    expect(body.html).toContain("A &amp; B &lt;tag&gt;");
  });

  it("marks email as failed and logs a warning when Resend returns a non-ok response", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      status: 422,
      text: vi.fn().mockResolvedValue("invalid from address"),
    });

    const logger = makeLogger();
    const svc = new NotificationService(
      makeConfig({ emailTo: "a@example.com", resendApiKey: "re_secret" }),
      logger as never,
    );

    const result = await svc.sendHumanRequest(makePayload());

    expect(result.email.attempted).toBe(true);
    expect(result.email.ok).toBe(false);
    expect(result.email.error).toContain("422");
    expect(result.email.error).toContain("invalid from address");
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ runId: "run-1", error: expect.stringContaining("422") }),
      "Email notification failed",
    );
  });

  it("sends both Slack and email concurrently and reports independent results when one fails", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockImplementation((url: string) => {
      if (url === "https://hooks.slack.com/services/abc") {
        return Promise.resolve({ ok: true, status: 200, text: vi.fn().mockResolvedValue("") });
      }
      return Promise.resolve({
        ok: false,
        status: 500,
        text: vi.fn().mockResolvedValue("resend down"),
      });
    });

    const svc = new NotificationService(
      makeConfig({
        slackWebhookUrl: "https://hooks.slack.com/services/abc",
        emailTo: "a@example.com",
        resendApiKey: "re_secret",
      }),
      makeLogger() as never,
    );

    const result = await svc.sendHumanRequest(makePayload());

    expect(result.slack).toEqual({ attempted: true, ok: true });
    expect(result.email.attempted).toBe(true);
    expect(result.email.ok).toBe(false);
    expect(result.email.error).toContain("500");
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it("falls back to String(err) when a thrown error is not an Error instance", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockRejectedValue("just a string failure");

    const svc = new NotificationService(
      makeConfig({ slackWebhookUrl: "https://hooks.slack.com/services/abc" }),
      makeLogger() as never,
    );

    const result = await svc.sendHumanRequest(makePayload());

    expect(result.slack.ok).toBe(false);
    expect(result.slack.error).toBe("just a string failure");
  });

  it("produces every reason label without throwing for each HumanRequestReason value", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      text: vi.fn().mockResolvedValue(""),
    });

    const svc = new NotificationService(
      makeConfig({ slackWebhookUrl: "https://hooks.slack.com/services/abc" }),
      makeLogger() as never,
    );

    const reasons = [
      "plan_ambiguous",
      "plan_low_confidence",
      "impl_rejected",
      "impl_uncertain",
      "other",
    ] as const;

    for (const reason of reasons) {
      (global.fetch as ReturnType<typeof vi.fn>).mockClear();
      const result = await svc.sendHumanRequest(makePayload({ reason }));
      expect(result.slack.ok).toBe(true);
      const [, init] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
      const body = JSON.parse(init.body as string);
      expect(typeof body.text).toBe("string");
      expect(body.text.length).toBeGreaterThan(0);
    }
  });

  it("truncates long context in the Slack message", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      text: vi.fn().mockResolvedValue(""),
    });

    const svc = new NotificationService(
      makeConfig({ slackWebhookUrl: "https://hooks.slack.com/services/abc" }),
      makeLogger() as never,
    );

    const longContext = "x".repeat(2000);
    await svc.sendHumanRequest(makePayload({ context: longContext }));

    const [, init] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    const body = JSON.parse(init.body as string);
    const contextBlock = body.blocks.find((b: { text?: { text: string } }) =>
      b.text?.text?.includes("*Context:*"),
    );
    expect(contextBlock).toBeDefined();
    expect(contextBlock.text.text.length).toBeLessThan(longContext.length);
    expect(contextBlock.text.text).toContain("…");
  });
});
