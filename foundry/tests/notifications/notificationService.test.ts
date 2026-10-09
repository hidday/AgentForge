import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  NotificationService,
  type NotificationConfig,
  type NotificationPayload,
  type HumanRequestReason,
} from "../../src/notifications/notificationService.js";

function makeLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
}

function makePayload(overrides: Partial<NotificationPayload> = {}): NotificationPayload {
  return {
    runId: "run-1",
    reason: "plan_ambiguous",
    summary: "Needs a human look",
    runState: "AwaitingPlanApproval",
    runUrl: "https://app.example.com/runs/run-1",
    linearIssue: { id: "lin-1", identifier: "ENG-1", title: "Add feature", url: null },
    ...overrides,
  };
}

function okResponse(body = ""): Response {
  return {
    ok: true,
    status: 200,
    text: () => Promise.resolve(body),
  } as unknown as Response;
}

function errorResponse(status: number, body = "failure body"): Response {
  return {
    ok: false,
    status,
    text: () => Promise.resolve(body),
  } as unknown as Response;
}

describe("NotificationService.isConfigured", () => {
  const logger = makeLogger();

  it("is true when a slack webhook is configured", () => {
    const svc = new NotificationService(
      { emailFrom: "a@b.com", slackWebhookUrl: "https://hooks.slack.com/x" },
      logger as never,
    );
    expect(svc.isConfigured()).toBe(true);
  });

  it("is true when both emailTo and resendApiKey are configured", () => {
    const svc = new NotificationService(
      { emailFrom: "a@b.com", emailTo: "x@y.com", resendApiKey: "key" },
      logger as never,
    );
    expect(svc.isConfigured()).toBe(true);
  });

  it("is false when only emailTo is set without resendApiKey", () => {
    const svc = new NotificationService({ emailFrom: "a@b.com", emailTo: "x@y.com" }, logger as never);
    expect(svc.isConfigured()).toBe(false);
  });

  it("is false when only resendApiKey is set without emailTo", () => {
    const svc = new NotificationService({ emailFrom: "a@b.com", resendApiKey: "key" }, logger as never);
    expect(svc.isConfigured()).toBe(false);
  });

  it("is false when nothing is configured", () => {
    const svc = new NotificationService({ emailFrom: "a@b.com" }, logger as never);
    expect(svc.isConfigured()).toBe(false);
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

  function config(overrides: Partial<NotificationConfig> = {}): NotificationConfig {
    return { emailFrom: "bot@example.com", ...overrides };
  }

  it("does nothing and attempts neither channel when unconfigured", async () => {
    const svc = new NotificationService(config(), logger as never);
    const result = await svc.sendHumanRequest(makePayload());

    expect(result).toEqual({
      slack: { attempted: false, ok: false },
      email: { attempted: false, ok: false },
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("posts to the slack webhook and reports ok on success", async () => {
    fetchMock.mockResolvedValue(okResponse());
    const svc = new NotificationService(
      config({ slackWebhookUrl: "https://hooks.slack.com/x" }),
      logger as never,
    );

    const result = await svc.sendHumanRequest(makePayload());

    expect(result.slack).toEqual({ attempted: true, ok: true });
    expect(result.email).toEqual({ attempted: false, ok: false });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://hooks.slack.com/x",
      expect.objectContaining({ method: "POST" }),
    );
    const call = fetchMock.mock.calls[0][1] as { body: string };
    const body = JSON.parse(call.body) as { text: string; blocks: unknown[] };
    expect(body.text).toContain("ENG-1");
    expect(body.text).toContain("Add feature");
  });

  it("records a slack failure (non-ok response) without throwing", async () => {
    fetchMock.mockResolvedValue(errorResponse(500, "server error"));
    const svc = new NotificationService(
      config({ slackWebhookUrl: "https://hooks.slack.com/x" }),
      logger as never,
    );

    const result = await svc.sendHumanRequest(makePayload());

    expect(result.slack.ok).toBe(false);
    expect(result.slack.error).toContain("Slack webhook returned 500");
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ runId: "run-1" }),
      "Slack notification failed",
    );
  });

  it("falls back to an empty body when reading the error response text fails", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 503,
      text: () => Promise.reject(new Error("stream closed")),
    } as unknown as Response);
    const svc = new NotificationService(
      config({ slackWebhookUrl: "https://hooks.slack.com/x" }),
      logger as never,
    );

    const result = await svc.sendHumanRequest(makePayload());
    expect(result.slack.error).toContain("Slack webhook returned 503");
  });

  it("records a slack failure when fetch itself rejects", async () => {
    fetchMock.mockRejectedValue(new Error("network down"));
    const svc = new NotificationService(
      config({ slackWebhookUrl: "https://hooks.slack.com/x" }),
      logger as never,
    );

    const result = await svc.sendHumanRequest(makePayload());
    expect(result.slack.ok).toBe(false);
    expect(result.slack.error).toBe("network down");
  });

  it("stringifies a non-Error slack rejection", async () => {
    fetchMock.mockRejectedValue("dns failure");
    const svc = new NotificationService(
      config({ slackWebhookUrl: "https://hooks.slack.com/x" }),
      logger as never,
    );

    const result = await svc.sendHumanRequest(makePayload());
    expect(result.slack.ok).toBe(false);
    expect(result.slack.error).toBe("dns failure");
  });

  it("stringifies a non-Error email rejection", async () => {
    fetchMock.mockRejectedValue({ reason: "timeout" });
    const svc = new NotificationService(
      config({ emailTo: "a@x.com", resendApiKey: "resend-key" }),
      logger as never,
    );

    const result = await svc.sendHumanRequest(makePayload());
    expect(result.email.ok).toBe(false);
    expect(result.email.error).toBe("[object Object]");
  });

  it("posts to Resend and reports ok on success, splitting/trimming recipients", async () => {
    fetchMock.mockResolvedValue(okResponse());
    const svc = new NotificationService(
      config({ emailTo: "a@x.com, b@y.com", resendApiKey: "resend-key" }),
      logger as never,
    );

    const result = await svc.sendHumanRequest(makePayload());

    expect(result.email).toEqual({ attempted: true, ok: true });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.resend.com/emails",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ Authorization: "Bearer resend-key" }),
      }),
    );
    const call = fetchMock.mock.calls[0][1] as { body: string };
    const body = JSON.parse(call.body) as { to: string[]; from: string; subject: string };
    expect(body.to).toEqual(["a@x.com", "b@y.com"]);
    expect(body.from).toBe("bot@example.com");
    expect(body.subject).toContain("ENG-1");
  });

  it("records an email failure (non-ok response) without throwing", async () => {
    fetchMock.mockResolvedValue(errorResponse(422, "bad request"));
    const svc = new NotificationService(
      config({ emailTo: "a@x.com", resendApiKey: "resend-key" }),
      logger as never,
    );

    const result = await svc.sendHumanRequest(makePayload());
    expect(result.email.ok).toBe(false);
    expect(result.email.error).toContain("Resend returned 422");
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ runId: "run-1" }),
      "Email notification failed",
    );
  });

  it("sends both channels in parallel when both are configured", async () => {
    fetchMock.mockResolvedValue(okResponse());
    const svc = new NotificationService(
      config({
        slackWebhookUrl: "https://hooks.slack.com/x",
        emailTo: "a@x.com",
        resendApiKey: "resend-key",
      }),
      logger as never,
    );

    const result = await svc.sendHumanRequest(makePayload());

    expect(result.slack).toEqual({ attempted: true, ok: true });
    expect(result.email).toEqual({ attempted: true, ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("includes plan confidence and open questions in the slack message when present", async () => {
    fetchMock.mockResolvedValue(okResponse());
    const svc = new NotificationService(
      config({ slackWebhookUrl: "https://hooks.slack.com/x" }),
      logger as never,
    );

    const longContext = "x".repeat(1600);
    const manyQuestions = Array.from({ length: 5 }, (_, i) => ({
      id: `q${String(i)}`,
      question: `Question number ${String(i)} ${"y".repeat(250)}`,
      requiredForExecution: i % 2 === 0,
    }));

    await svc.sendHumanRequest(
      makePayload({
        planConfidence: 0.42,
        context: longContext,
        openQuestions: manyQuestions,
        linearIssue: { id: "lin-1", identifier: "ENG-1", title: "Add feature", url: "https://linear.app/i/1" },
      }),
    );

    const call = fetchMock.mock.calls[0][1] as { body: string };
    const body = JSON.parse(call.body) as { blocks: unknown[] };
    const serialized = JSON.stringify(body.blocks);
    expect(serialized).toContain("Plan confidence");
    expect(serialized).toContain("0.42");
    expect(serialized).toContain("Open questions");
    expect(serialized).toContain("5 (3 required)");
    // context should be truncated with an ellipsis (max 1500 chars)
    expect(serialized).toContain("…");
    // only the first 3 open questions are rendered inline
    expect(serialized).toContain("Question number 0");
    expect(serialized).toContain("Question number 2");
    expect(serialized).not.toContain("Question number 3");
    // Linear issue button included since url is present
    expect(serialized).toContain("https://linear.app/i/1");
  });

  it("includes a short context verbatim (no truncation) when under the length limit", async () => {
    fetchMock.mockResolvedValue(okResponse());
    const svc = new NotificationService(
      config({ slackWebhookUrl: "https://hooks.slack.com/x" }),
      logger as never,
    );

    await svc.sendHumanRequest(makePayload({ context: "short context" }));

    const call = fetchMock.mock.calls[0][1] as { body: string };
    const body = JSON.parse(call.body) as { blocks: unknown[] };
    const serialized = JSON.stringify(body.blocks);
    expect(serialized).toContain("short context");
    expect(serialized).not.toContain("…");
  });

  it("omits optional slack sections when planConfidence/context/openQuestions/url are absent", async () => {
    fetchMock.mockResolvedValue(okResponse());
    const svc = new NotificationService(
      config({ slackWebhookUrl: "https://hooks.slack.com/x" }),
      logger as never,
    );

    await svc.sendHumanRequest(
      makePayload({ linearIssue: { id: "lin-1", identifier: undefined, title: null, url: null } }),
    );

    const call = fetchMock.mock.calls[0][1] as { body: string };
    const body = JSON.parse(call.body) as { text: string; blocks: unknown[] };
    expect(body.text).toContain("lin-1");
    expect(body.text).toContain("(untitled)");
    const serialized = JSON.stringify(body.blocks);
    expect(serialized).not.toContain("Plan confidence");
    expect(serialized).not.toContain("Context:");
    expect(serialized).not.toContain("Open questions");
  });

  it("renders every human request reason label distinctly", async () => {
    fetchMock.mockResolvedValue(okResponse());
    const svc = new NotificationService(
      config({ slackWebhookUrl: "https://hooks.slack.com/x" }),
      logger as never,
    );

    const reasons: HumanRequestReason[] = [
      "plan_ambiguous",
      "plan_low_confidence",
      "impl_rejected",
      "impl_uncertain",
      "other",
    ];
    const titles: string[] = [];
    for (const reason of reasons) {
      fetchMock.mockClear();
      await svc.sendHumanRequest(makePayload({ reason }));
      const call = fetchMock.mock.calls[0][1] as { body: string };
      const body = JSON.parse(call.body) as { text: string };
      titles.push(body.text);
    }

    expect(new Set(titles).size).toBe(reasons.length);
    expect(titles[0]).toContain("ambiguous");
    expect(titles[1]).toContain("low confidence");
    expect(titles[2]).toContain("rejected by agent");
    expect(titles[3]).toContain("uncertain");
    expect(titles[4]).toContain("Human intervention requested");
  });

  it("includes context, confidence, truncated/sliced open questions and the linear link in the email body", async () => {
    fetchMock.mockResolvedValue(okResponse());
    const svc = new NotificationService(
      config({ emailTo: "a@x.com", resendApiKey: "resend-key" }),
      logger as never,
    );

    const longContext = "z".repeat(2200);
    const manyQuestions = Array.from({ length: 6 }, (_, i) => ({
      id: `q${String(i)}`,
      question: `Q${String(i)}`,
      requiredForExecution: i === 0,
    }));

    await svc.sendHumanRequest(
      makePayload({
        planConfidence: 0.75,
        context: longContext,
        openQuestions: manyQuestions,
        linearIssue: { id: "lin-1", identifier: "ENG-9", title: "Fix bug", url: "https://linear.app/i/9" },
      }),
    );

    const call = fetchMock.mock.calls[0][1] as { body: string };
    const body = JSON.parse(call.body) as { html: string; text: string };

    expect(body.html).toContain("Plan confidence");
    expect(body.html).toContain("0.75");
    expect(body.html).toContain("Open questions");
    expect(body.html).toContain("[required]");
    expect(body.html).toContain("https://linear.app/i/9");
    expect(body.html).toContain("…");
    // only first 5 questions rendered
    expect(body.html).toContain("Q4");
    expect(body.html).not.toContain("Q5");

    expect(body.text).toContain("Plan confidence: 0.75");
    expect(body.text).toContain("Open questions:");
    expect(body.text).toContain("[required]");
    expect(body.text).toContain("Linear: https://linear.app/i/9");
  });

  it("omits optional email sections and the linear link when absent", async () => {
    fetchMock.mockResolvedValue(okResponse());
    const svc = new NotificationService(
      config({ emailTo: "a@x.com", resendApiKey: "resend-key" }),
      logger as never,
    );

    await svc.sendHumanRequest(
      makePayload({ linearIssue: { id: "lin-1", identifier: undefined, title: null, url: null } }),
    );

    const call = fetchMock.mock.calls[0][1] as { body: string };
    const body = JSON.parse(call.body) as { html: string; text: string };
    expect(body.html).not.toContain("Plan confidence");
    expect(body.html).not.toContain("Open questions");
    expect(body.text).not.toContain("Linear:");
  });

  it("escapes HTML-significant characters in the email body", async () => {
    fetchMock.mockResolvedValue(okResponse());
    const svc = new NotificationService(
      config({ emailTo: "a@x.com", resendApiKey: "resend-key" }),
      logger as never,
    );

    await svc.sendHumanRequest(
      makePayload({
        summary: `<script>alert("x")</script> & 'quoted'`,
        linearIssue: { id: "lin-1", identifier: "ENG-1", title: "<b>Title</b>", url: null },
      }),
    );

    const call = fetchMock.mock.calls[0][1] as { body: string };
    const body = JSON.parse(call.body) as { html: string };
    expect(body.html).not.toContain("<script>");
    expect(body.html).toContain("&lt;script&gt;");
    expect(body.html).toContain("&amp;");
    expect(body.html).toContain("&#39;quoted&#39;");
    expect(body.html).toContain("&lt;b&gt;Title&lt;/b&gt;");
  });
});
