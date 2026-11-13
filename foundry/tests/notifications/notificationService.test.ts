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
    summary: "The plan has ambiguous requirements.",
    runState: "HumanClarificationNeeded",
    runUrl: "https://foundry.example.com/runs/run-1",
    linearIssue: {
      id: "lin-1",
      identifier: "PRY-1",
      title: "Add validation",
      url: "https://linear.app/team/issue/PRY-1",
    },
    ...overrides,
  };
}

function makeLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
}

function okResponse(): Response {
  return { ok: true, status: 200, text: async () => "" } as unknown as Response;
}

function errorResponse(status: number, body: string): Response {
  return { ok: false, status, text: async () => body } as unknown as Response;
}

describe("NotificationService.isConfigured", () => {
  const logger = makeLogger();

  it("returns true when slackWebhookUrl is set", () => {
    const svc = new NotificationService(
      { emailFrom: "a@b.com", slackWebhookUrl: "https://hooks.example.com/x" },
      logger as never,
    );
    expect(svc.isConfigured()).toBe(true);
  });

  it("returns true when emailTo and resendApiKey are both set", () => {
    const svc = new NotificationService(
      { emailFrom: "a@b.com", emailTo: "team@b.com", resendApiKey: "key123" },
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
  let fetchSpy: ReturnType<typeof vi.spyOn>;
  let logger: ReturnType<typeof makeLogger>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, "fetch");
    logger = makeLogger();
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it("attempts neither channel and returns both unattempted when nothing is configured", async () => {
    const svc = new NotificationService({ emailFrom: "a@b.com" }, logger as never);
    const result = await svc.sendHumanRequest(makePayload());

    expect(result.slack).toEqual({ attempted: false, ok: false });
    expect(result.email).toEqual({ attempted: false, ok: false });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("sends a Slack webhook and marks it ok on success", async () => {
    fetchSpy.mockResolvedValue(okResponse());
    const config: NotificationConfig = {
      emailFrom: "a@b.com",
      slackWebhookUrl: "https://hooks.example.com/x",
    };
    const svc = new NotificationService(config, logger as never);

    const result = await svc.sendHumanRequest(makePayload());

    expect(result.slack).toEqual({ attempted: true, ok: true });
    expect(fetchSpy).toHaveBeenCalledWith(
      "https://hooks.example.com/x",
      expect.objectContaining({ method: "POST" }),
    );
    const [, options] = fetchSpy.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(options.body as string) as { text: string; blocks: unknown[] };
    expect(body.text).toContain("PRY-1");
  });

  it("marks Slack as failed and logs a warning when the webhook returns non-ok", async () => {
    fetchSpy.mockResolvedValue(errorResponse(500, "server error"));
    const config: NotificationConfig = {
      emailFrom: "a@b.com",
      slackWebhookUrl: "https://hooks.example.com/x",
    };
    const svc = new NotificationService(config, logger as never);

    const result = await svc.sendHumanRequest(makePayload());

    expect(result.slack.attempted).toBe(true);
    expect(result.slack.ok).toBe(false);
    expect(result.slack.error).toContain("500");
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ runId: "run-1" }),
      "Slack notification failed",
    );
  });

  it("marks Slack as failed when fetch itself rejects", async () => {
    fetchSpy.mockRejectedValue(new Error("network down"));
    const config: NotificationConfig = {
      emailFrom: "a@b.com",
      slackWebhookUrl: "https://hooks.example.com/x",
    };
    const svc = new NotificationService(config, logger as never);

    const result = await svc.sendHumanRequest(makePayload());

    expect(result.slack.ok).toBe(false);
    expect(result.slack.error).toBe("network down");
  });

  it("stringifies a non-Error rejection value for the Slack error field", async () => {
    fetchSpy.mockRejectedValue("plain string failure");
    const config: NotificationConfig = {
      emailFrom: "a@b.com",
      slackWebhookUrl: "https://hooks.example.com/x",
    };
    const svc = new NotificationService(config, logger as never);

    const result = await svc.sendHumanRequest(makePayload());

    expect(result.slack.ok).toBe(false);
    expect(result.slack.error).toBe("plain string failure");
  });

  it("stringifies a non-Error rejection value for the email error field", async () => {
    fetchSpy.mockRejectedValue("plain string failure");
    const config: NotificationConfig = {
      emailFrom: "a@b.com",
      emailTo: "team@b.com",
      resendApiKey: "resend-key",
    };
    const svc = new NotificationService(config, logger as never);

    const result = await svc.sendHumanRequest(makePayload());

    expect(result.email.ok).toBe(false);
    expect(result.email.error).toBe("plain string failure");
  });

  it("sends an email via Resend and marks it ok on success", async () => {
    fetchSpy.mockResolvedValue(okResponse());
    const config: NotificationConfig = {
      emailFrom: "AgentForge <noreply@example.com>",
      emailTo: "a@b.com, c@d.com",
      resendApiKey: "resend-key",
    };
    const svc = new NotificationService(config, logger as never);

    const result = await svc.sendHumanRequest(makePayload());

    expect(result.email).toEqual({ attempted: true, ok: true });
    expect(fetchSpy).toHaveBeenCalledWith(
      "https://api.resend.com/emails",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ Authorization: "Bearer resend-key" }),
      }),
    );
    const [, options] = fetchSpy.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(options.body as string) as { to: string[] };
    expect(body.to).toEqual(["a@b.com", "c@d.com"]);
  });

  it("marks email as failed and logs a warning when Resend returns non-ok", async () => {
    fetchSpy.mockResolvedValue(errorResponse(422, "invalid request"));
    const config: NotificationConfig = {
      emailFrom: "a@b.com",
      emailTo: "team@b.com",
      resendApiKey: "resend-key",
    };
    const svc = new NotificationService(config, logger as never);

    const result = await svc.sendHumanRequest(makePayload());

    expect(result.email.ok).toBe(false);
    expect(result.email.error).toContain("422");
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ runId: "run-1" }),
      "Email notification failed",
    );
  });

  it("sends both Slack and email concurrently when both are configured", async () => {
    fetchSpy.mockResolvedValue(okResponse());
    const config: NotificationConfig = {
      emailFrom: "a@b.com",
      emailTo: "team@b.com",
      resendApiKey: "resend-key",
      slackWebhookUrl: "https://hooks.example.com/x",
    };
    const svc = new NotificationService(config, logger as never);

    const result = await svc.sendHumanRequest(makePayload());

    expect(result.slack.ok).toBe(true);
    expect(result.email.ok).toBe(true);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("falls back to response.text() failure gracefully (empty body) when error text() throws", async () => {
    fetchSpy.mockResolvedValue({
      ok: false,
      status: 503,
      text: async () => {
        throw new Error("stream closed");
      },
    } as unknown as Response);
    const config: NotificationConfig = {
      emailFrom: "a@b.com",
      slackWebhookUrl: "https://hooks.example.com/x",
    };
    const svc = new NotificationService(config, logger as never);

    const result = await svc.sendHumanRequest(makePayload());

    expect(result.slack.ok).toBe(false);
    expect(result.slack.error).toContain("503");
  });

  it("includes plan confidence and open questions fields in the Slack payload when present", async () => {
    fetchSpy.mockResolvedValue(okResponse());
    const config: NotificationConfig = {
      emailFrom: "a@b.com",
      slackWebhookUrl: "https://hooks.example.com/x",
    };
    const svc = new NotificationService(config, logger as never);

    const payload = makePayload({
      planConfidence: 0.42,
      context: "Some long context ".repeat(200),
      openQuestions: [
        { id: "q1", question: "Is X required?", requiredForExecution: true },
        { id: "q2", question: "Is Y optional?", requiredForExecution: false },
        { id: "q3", question: "Extra question", requiredForExecution: false },
        { id: "q4", question: "Another one not shown", requiredForExecution: false },
      ],
    });

    await svc.sendHumanRequest(payload);

    const [, options] = fetchSpy.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(options.body as string) as { blocks: unknown[] };
    const serialized = JSON.stringify(body);
    expect(serialized).toContain("0.42");
    expect(serialized).toContain("required");
    expect(serialized).toContain("Is X required?");
    // Only first 3 questions are rendered in the question list.
    expect(serialized).not.toContain("Another one not shown");
    // Context is truncated with an ellipsis.
    expect(serialized).toContain("…");
  });

  it("renders the Slack title with '(untitled)' and the bare id when identifier/title are missing", async () => {
    fetchSpy.mockResolvedValue(okResponse());
    const config: NotificationConfig = {
      emailFrom: "a@b.com",
      slackWebhookUrl: "https://hooks.example.com/x",
    };
    const svc = new NotificationService(config, logger as never);

    const payload = makePayload({
      linearIssue: { id: "lin-raw-id", title: null, url: null },
    });

    await svc.sendHumanRequest(payload);

    const [, options] = fetchSpy.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(options.body as string) as { text: string };
    expect(body.text).toContain("lin-raw-id");
    expect(body.text).toContain("(untitled)");
  });

  it("omits the Linear issue button when linearIssue.url is not set", async () => {
    fetchSpy.mockResolvedValue(okResponse());
    const config: NotificationConfig = {
      emailFrom: "a@b.com",
      slackWebhookUrl: "https://hooks.example.com/x",
    };
    const svc = new NotificationService(config, logger as never);

    await svc.sendHumanRequest(
      makePayload({ linearIssue: { id: "lin-1", title: "T", url: null } }),
    );

    const [, options] = fetchSpy.mock.calls[0] as [string, RequestInit];
    const serialized = options.body as string;
    expect(serialized).not.toContain("Open Linear issue");
  });

  it("produces email html and text with escaped HTML special characters and all optional sections", async () => {
    fetchSpy.mockResolvedValue(okResponse());
    const config: NotificationConfig = {
      emailFrom: "a@b.com",
      emailTo: "team@b.com",
      resendApiKey: "resend-key",
    };
    const svc = new NotificationService(config, logger as never);

    const payload = makePayload({
      planConfidence: 0.75,
      context: "<script>alert('x')</script> & \"quoted\"",
      openQuestions: [
        { id: "q1", question: "Contains <b>markup</b>?", requiredForExecution: true },
        { id: "q2", question: "A non-required one", requiredForExecution: false },
      ],
    });

    await svc.sendHumanRequest(payload);

    const [, options] = fetchSpy.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(options.body as string) as { html: string; text: string };

    expect(body.html).toContain("&lt;script&gt;");
    expect(body.html).not.toContain("<script>alert");
    expect(body.html).toContain("Plan confidence");
    expect(body.html).toContain("[required]");
    expect(body.html).toContain("A non-required one");
    expect(body.html).toContain('href="https://linear.app/team/issue/PRY-1"');

    expect(body.text).toContain("Plan confidence: 0.75");
    expect(body.text).toContain("Context:");
    expect(body.text).toContain("Open questions:");
    expect(body.text).toContain("[required] Contains <b>markup</b>?");
    expect(body.text).toContain("- A non-required one");
    expect(body.text).toContain("Linear: https://linear.app/team/issue/PRY-1");
  });

  it("produces minimal email text/html when optional fields are absent", async () => {
    fetchSpy.mockResolvedValue(okResponse());
    const config: NotificationConfig = {
      emailFrom: "a@b.com",
      emailTo: "team@b.com",
      resendApiKey: "resend-key",
    };
    const svc = new NotificationService(config, logger as never);

    const payload = makePayload({
      linearIssue: { id: "lin-1", title: null, url: undefined },
      context: undefined,
      planConfidence: undefined,
      openQuestions: undefined,
    });

    await svc.sendHumanRequest(payload);

    const [, options] = fetchSpy.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(options.body as string) as { html: string; text: string };

    expect(body.html).not.toContain("Plan confidence");
    expect(body.html).not.toContain("Context:");
    expect(body.text).not.toContain("Linear:");
  });

  it("produces the correct reasonLabel for every HumanRequestReason value", async () => {
    fetchSpy.mockResolvedValue(okResponse());
    const config: NotificationConfig = {
      emailFrom: "a@b.com",
      slackWebhookUrl: "https://hooks.example.com/x",
    };
    const svc = new NotificationService(config, logger as never);

    const expectations: [NotificationPayload["reason"], string][] = [
      ["plan_ambiguous", "Plan needs review (ambiguous)"],
      ["plan_low_confidence", "Plan needs review (low confidence)"],
      ["impl_rejected", "Implementation needs review (rejected by agent)"],
      ["impl_uncertain", "Implementation needs review (uncertain)"],
      ["other", "Human intervention requested"],
    ];

    for (const [reason, label] of expectations) {
      fetchSpy.mockClear();
      await svc.sendHumanRequest(makePayload({ reason }));
      const [, options] = fetchSpy.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(options.body as string) as { text: string };
      expect(body.text).toContain(label);
    }
  });
});
