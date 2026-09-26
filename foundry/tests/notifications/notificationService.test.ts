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
    summary: "The plan is ambiguous about auth.",
    runState: "AwaitingPlanApproval",
    runUrl: "https://agentforge.example/runs/run-1",
    linearIssue: {
      id: "issue-1",
      identifier: "PRY-1",
      title: "Add auth",
      url: "https://linear.app/team/issue/PRY-1",
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
  it("is false when no channel is configured", () => {
    const service = new NotificationService({ emailFrom: "bot@example.com" }, makeLogger() as never);
    expect(service.isConfigured()).toBe(false);
  });

  it("is true when a Slack webhook URL is set", () => {
    const service = new NotificationService(
      { emailFrom: "bot@example.com", slackWebhookUrl: "https://hooks.slack.test/x" },
      makeLogger() as never,
    );
    expect(service.isConfigured()).toBe(true);
  });

  it("is true only when both emailTo and resendApiKey are set", () => {
    const withOnlyTo = new NotificationService(
      { emailFrom: "bot@example.com", emailTo: "a@example.com" },
      makeLogger() as never,
    );
    expect(withOnlyTo.isConfigured()).toBe(false);

    const withBoth = new NotificationService(
      { emailFrom: "bot@example.com", emailTo: "a@example.com", resendApiKey: "key" },
      makeLogger() as never,
    );
    expect(withBoth.isConfigured()).toBe(true);
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

  it("attempts neither channel and makes no requests when nothing is configured", async () => {
    const service = new NotificationService({ emailFrom: "bot@example.com" }, makeLogger() as never);

    const result = await service.sendHumanRequest(makePayload());

    expect(result).toEqual({
      slack: { attempted: false, ok: false },
      email: { attempted: false, ok: false },
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("posts to the Slack webhook and reports ok:true on success", async () => {
    fetchMock.mockResolvedValue(okResponse());
    const config: NotificationConfig = {
      emailFrom: "bot@example.com",
      slackWebhookUrl: "https://hooks.slack.test/x",
    };
    const service = new NotificationService(config, makeLogger() as never);

    const result = await service.sendHumanRequest(makePayload());

    expect(result.slack).toEqual({ attempted: true, ok: true });
    expect(result.email).toEqual({ attempted: false, ok: false });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://hooks.slack.test/x");
    expect(init.method).toBe("POST");
    const body = JSON.parse(init.body as string) as { text: string; blocks: unknown[] };
    expect(body.text).toContain("Plan needs review (ambiguous)");
    expect(body.text).toContain("PRY-1");
    expect(body.text).toContain("Add auth");
  });

  it("includes plan confidence and open questions in the Slack payload when present", async () => {
    fetchMock.mockResolvedValue(okResponse());
    const config: NotificationConfig = {
      emailFrom: "bot@example.com",
      slackWebhookUrl: "https://hooks.slack.test/x",
    };
    const service = new NotificationService(config, makeLogger() as never);

    await service.sendHumanRequest(
      makePayload({
        planConfidence: 0.42,
        openQuestions: [
          { id: "q1", question: "Which OAuth provider?", requiredForExecution: true },
          { id: "q2", question: "Optional detail", requiredForExecution: false },
        ],
      }),
    );

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string) as { blocks: { text?: { text: string }; fields?: { text: string }[] }[] };
    const flatText = JSON.stringify(body.blocks);
    expect(flatText).toContain("0.42");
    expect(flatText).toContain("Which OAuth provider?");
    expect(flatText).toContain("[required]");
    expect(flatText).toContain("2 (1 required)");
  });

  it("includes a truncated context block in Slack payload when context is provided", async () => {
    fetchMock.mockResolvedValue(okResponse());
    const config: NotificationConfig = {
      emailFrom: "bot@example.com",
      slackWebhookUrl: "https://hooks.slack.test/x",
    };
    const service = new NotificationService(config, makeLogger() as never);
    const longContext = "x".repeat(2000);

    await service.sendHumanRequest(makePayload({ context: longContext }));

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string) as { blocks: unknown[] };
    const flatText = JSON.stringify(body.blocks);
    expect(flatText).toContain("…");
    // The raw 2000-char string should not appear verbatim (it must be truncated to 1500).
    expect(flatText).not.toContain(longContext);
  });

  it("omits the Linear issue button when linearIssue.url is null", async () => {
    fetchMock.mockResolvedValue(okResponse());
    const config: NotificationConfig = {
      emailFrom: "bot@example.com",
      slackWebhookUrl: "https://hooks.slack.test/x",
    };
    const service = new NotificationService(config, makeLogger() as never);

    await service.sendHumanRequest(
      makePayload({ linearIssue: { id: "issue-1", title: "Add auth", url: null } }),
    );

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string) as {
      blocks: { type: string; elements?: { text: { text: string } }[] }[];
    };
    const actionsBlock = body.blocks.find((b) => b.type === "actions");
    expect(actionsBlock?.elements).toHaveLength(1);
    expect(actionsBlock?.elements?.[0]?.text.text).toBe("Open run");
  });

  it("reports ok:false and logs a warning when the Slack webhook returns a non-2xx status", async () => {
    fetchMock.mockResolvedValue(failResponse(500, "server error"));
    const logger = makeLogger();
    const config: NotificationConfig = {
      emailFrom: "bot@example.com",
      slackWebhookUrl: "https://hooks.slack.test/x",
    };
    const service = new NotificationService(config, logger as never);

    const result = await service.sendHumanRequest(makePayload());

    expect(result.slack.ok).toBe(false);
    expect(result.slack.error).toContain("Slack webhook returned 500");
    expect(result.slack.error).toContain("server error");
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ runId: "run-1" }),
      "Slack notification failed",
    );
  });

  it("reports ok:false when the fetch call itself throws (network error)", async () => {
    fetchMock.mockRejectedValue(new Error("ECONNREFUSED"));
    const config: NotificationConfig = {
      emailFrom: "bot@example.com",
      slackWebhookUrl: "https://hooks.slack.test/x",
    };
    const service = new NotificationService(config, makeLogger() as never);

    const result = await service.sendHumanRequest(makePayload());

    expect(result.slack).toEqual({ attempted: true, ok: false, error: "ECONNREFUSED" });
  });

  it("posts to Resend and reports ok:true on success, splitting/trimming comma-separated recipients", async () => {
    fetchMock.mockResolvedValue(okResponse());
    const config: NotificationConfig = {
      emailFrom: "bot@example.com",
      emailTo: "a@example.com, b@example.com",
      resendApiKey: "resend-key",
    };
    const service = new NotificationService(config, makeLogger() as never);

    const result = await service.sendHumanRequest(makePayload());

    expect(result.email).toEqual({ attempted: true, ok: true });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.resend.com/emails");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer resend-key");
    const body = JSON.parse(init.body as string) as {
      from: string;
      to: string[];
      subject: string;
      html: string;
      text: string;
    };
    expect(body.from).toBe("bot@example.com");
    expect(body.to).toEqual(["a@example.com", "b@example.com"]);
    expect(body.subject).toContain("[AgentForge]");
    expect(body.subject).toContain("PRY-1");
    expect(body.html).toContain("Add auth");
    expect(body.text).toContain("Add auth");
  });

  it("escapes HTML special characters in the rendered email", async () => {
    fetchMock.mockResolvedValue(okResponse());
    const config: NotificationConfig = {
      emailFrom: "bot@example.com",
      emailTo: "a@example.com",
      resendApiKey: "resend-key",
    };
    const service = new NotificationService(config, makeLogger() as never);

    await service.sendHumanRequest(
      makePayload({
        summary: "<script>alert('x')</script>",
        linearIssue: { id: "issue-1", title: "A & B <tag>", url: null },
      }),
    );

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string) as { html: string };
    expect(body.html).not.toContain("<script>");
    expect(body.html).toContain("&lt;script&gt;");
    expect(body.html).toContain("A &amp; B &lt;tag&gt;");
  });

  it("renders confidence, context, open questions, and an untitled fallback in both the HTML and text email bodies", async () => {
    fetchMock.mockResolvedValue(okResponse());
    const config: NotificationConfig = {
      emailFrom: "bot@example.com",
      emailTo: "a@example.com",
      resendApiKey: "resend-key",
    };
    const service = new NotificationService(config, makeLogger() as never);

    await service.sendHumanRequest(
      makePayload({
        linearIssue: { id: "issue-1", title: null, url: null },
        planConfidence: 0.75,
        context: "Some helpful context",
        openQuestions: [
          { id: "q1", question: "Which provider?", requiredForExecution: true },
          { id: "q2", question: "Optional detail", requiredForExecution: false },
        ],
      }),
    );

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string) as { subject: string; html: string; text: string };

    expect(body.subject).toContain("(untitled)");

    expect(body.html).toContain("(untitled)");
    expect(body.html).toContain("Plan confidence:</strong> 0.75");
    expect(body.html).toContain("Some helpful context");
    expect(body.html).toContain("Open questions:");
    expect(body.html).toContain("<strong>[required]</strong> Which provider?");
    expect(body.html).toContain("Optional detail");

    expect(body.text).toContain("(untitled)");
    expect(body.text).toContain("Plan confidence: 0.75");
    expect(body.text).toContain("Context:");
    expect(body.text).toContain("Some helpful context");
    expect(body.text).toContain("Open questions:");
    expect(body.text).toContain("[required] Which provider?");
    expect(body.text).toContain("- Optional detail");
  });

  it("reports ok:false with a stringified non-Error rejection when the Slack fetch throws a non-Error value", async () => {
    fetchMock.mockRejectedValue("network blip");
    const config: NotificationConfig = {
      emailFrom: "bot@example.com",
      slackWebhookUrl: "https://hooks.slack.test/x",
    };
    const service = new NotificationService(config, makeLogger() as never);

    const result = await service.sendHumanRequest(makePayload());

    expect(result.slack).toEqual({ attempted: true, ok: false, error: "network blip" });
  });

  it("reports ok:false with a stringified non-Error rejection when the email fetch throws a non-Error value", async () => {
    fetchMock.mockRejectedValue({ code: "ECONNRESET" });
    const config: NotificationConfig = {
      emailFrom: "bot@example.com",
      emailTo: "a@example.com",
      resendApiKey: "resend-key",
    };
    const service = new NotificationService(config, makeLogger() as never);

    const result = await service.sendHumanRequest(makePayload());

    expect(result.email.ok).toBe(false);
    expect(result.email.error).toBe("[object Object]");
  });

  it("reports ok:false and logs a warning when Resend returns a non-2xx status", async () => {
    fetchMock.mockResolvedValue(failResponse(422, "invalid recipient"));
    const logger = makeLogger();
    const config: NotificationConfig = {
      emailFrom: "bot@example.com",
      emailTo: "a@example.com",
      resendApiKey: "resend-key",
    };
    const service = new NotificationService(config, logger as never);

    const result = await service.sendHumanRequest(makePayload());

    expect(result.email.ok).toBe(false);
    expect(result.email.error).toContain("Resend returned 422");
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ runId: "run-1" }),
      "Email notification failed",
    );
  });

  it("attempts both Slack and email concurrently when both are configured", async () => {
    fetchMock.mockResolvedValue(okResponse());
    const config: NotificationConfig = {
      emailFrom: "bot@example.com",
      slackWebhookUrl: "https://hooks.slack.test/x",
      emailTo: "a@example.com",
      resendApiKey: "resend-key",
    };
    const service = new NotificationService(config, makeLogger() as never);

    const result = await service.sendHumanRequest(makePayload());

    expect(result.slack).toEqual({ attempted: true, ok: true });
    expect(result.email).toEqual({ attempted: true, ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("falls back to '(untitled)' when the Linear issue has no title, and to the raw id when no identifier", async () => {
    fetchMock.mockResolvedValue(okResponse());
    const config: NotificationConfig = {
      emailFrom: "bot@example.com",
      slackWebhookUrl: "https://hooks.slack.test/x",
    };
    const service = new NotificationService(config, makeLogger() as never);

    await service.sendHumanRequest(
      makePayload({ linearIssue: { id: "issue-99", title: null, url: null } }),
    );

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string) as { text: string };
    expect(body.text).toContain("issue-99");
    expect(body.text).toContain("(untitled)");
  });

  it("produces the correct reason label for every HumanRequestReason value", async () => {
    fetchMock.mockResolvedValue(okResponse());
    const config: NotificationConfig = {
      emailFrom: "bot@example.com",
      slackWebhookUrl: "https://hooks.slack.test/x",
    };
    const service = new NotificationService(config, makeLogger() as never);

    const expectations: [NotificationPayload["reason"], string][] = [
      ["plan_ambiguous", "Plan needs review (ambiguous)"],
      ["plan_low_confidence", "Plan needs review (low confidence)"],
      ["impl_rejected", "Implementation needs review (rejected by agent)"],
      ["impl_uncertain", "Implementation needs review (uncertain)"],
      ["other", "Human intervention requested"],
    ];

    for (const [reason, label] of expectations) {
      fetchMock.mockClear();
      await service.sendHumanRequest(makePayload({ reason }));
      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(init.body as string) as { text: string };
      expect(body.text).toContain(label);
    }
  });
});
