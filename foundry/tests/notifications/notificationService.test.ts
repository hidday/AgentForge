import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NotificationService, type NotificationPayload } from "../../src/notifications/notificationService.js";

function makeLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
}

function makePayload(overrides: Partial<NotificationPayload> = {}): NotificationPayload {
  return {
    runId: "run-1",
    reason: "plan_ambiguous",
    summary: "Needs a human decision",
    runState: "AwaitingPlanApproval",
    runUrl: "https://agentforge.example/runs/run-1",
    linearIssue: { id: "lin-1", identifier: "ENG-1", title: "Build the thing", url: null },
    ...overrides,
  };
}

describe("NotificationService.isConfigured", () => {
  it("is false when neither slack nor email is configured", () => {
    const service = new NotificationService({ emailFrom: "bot@example.com" }, makeLogger() as never);
    expect(service.isConfigured()).toBe(false);
  });

  it("is true when a slack webhook url is set", () => {
    const service = new NotificationService(
      { emailFrom: "bot@example.com", slackWebhookUrl: "https://hooks.slack.com/x" },
      makeLogger() as never,
    );
    expect(service.isConfigured()).toBe(true);
  });

  it("is true when both emailTo and resendApiKey are set", () => {
    const service = new NotificationService(
      { emailFrom: "bot@example.com", emailTo: "me@example.com", resendApiKey: "key" },
      makeLogger() as never,
    );
    expect(service.isConfigured()).toBe(true);
  });

  it("is false when only emailTo is set without an API key", () => {
    const service = new NotificationService(
      { emailFrom: "bot@example.com", emailTo: "me@example.com" },
      makeLogger() as never,
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

  it("attempts neither channel when nothing is configured", async () => {
    const service = new NotificationService({ emailFrom: "bot@example.com" }, makeLogger() as never);

    const result = await service.sendHumanRequest(makePayload());

    expect(result).toEqual({
      slack: { attempted: false, ok: false },
      email: { attempted: false, ok: false },
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sends a Slack notification and reports ok on success", async () => {
    fetchMock.mockResolvedValue({ ok: true });
    const service = new NotificationService(
      { emailFrom: "bot@example.com", slackWebhookUrl: "https://hooks.slack.com/x" },
      makeLogger() as never,
    );

    const result = await service.sendHumanRequest(makePayload());

    expect(result.slack).toEqual({ attempted: true, ok: true });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://hooks.slack.com/x",
      expect.objectContaining({ method: "POST" }),
    );
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.text).toContain("ENG-1");
  });

  it("records a Slack failure (non-ok response) without throwing", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500, text: () => Promise.resolve("oops") });
    const logger = makeLogger();
    const service = new NotificationService(
      { emailFrom: "bot@example.com", slackWebhookUrl: "https://hooks.slack.com/x" },
      logger as never,
    );

    const result = await service.sendHumanRequest(makePayload());

    expect(result.slack.ok).toBe(false);
    expect(result.slack.error).toContain("500");
    expect(logger.warn).toHaveBeenCalled();
  });

  it("includes plan confidence, open questions, and context in the Slack payload when present", async () => {
    fetchMock.mockResolvedValue({ ok: true });
    const service = new NotificationService(
      { emailFrom: "bot@example.com", slackWebhookUrl: "https://hooks.slack.com/x" },
      makeLogger() as never,
    );

    await service.sendHumanRequest(
      makePayload({
        planConfidence: 0.42,
        context: "x".repeat(2000),
        linearIssue: { id: "lin-1", identifier: "ENG-1", title: "Thing", url: "https://linear.app/x" },
        openQuestions: [
          { id: "q1", question: "Which env?", requiredForExecution: true },
          { id: "q2", question: "Which repo?", requiredForExecution: false },
          { id: "q3", question: "Which branch?", requiredForExecution: false },
          { id: "q4", question: "Extra, dropped by slice(0,3)", requiredForExecution: false },
        ],
      }),
    );

    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    const serialized = JSON.stringify(body);
    expect(serialized).toContain("0.42");
    expect(serialized).toContain("Which env?");
    expect(serialized).not.toContain("Extra, dropped");
    expect(serialized).toContain("Open Linear issue");
  });

  it("uses the id and a placeholder title when identifier and title are missing", async () => {
    fetchMock.mockResolvedValue({ ok: true });
    const service = new NotificationService(
      { emailFrom: "bot@example.com", slackWebhookUrl: "https://hooks.slack.com/x" },
      makeLogger() as never,
    );

    await service.sendHumanRequest(
      makePayload({ linearIssue: { id: "lin-1", title: null, url: null } }),
    );

    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.text).toContain("lin-1");
    expect(body.text).toContain("(untitled)");
  });

  it("sends an email and reports ok on success, splitting multiple recipients", async () => {
    fetchMock.mockResolvedValue({ ok: true });
    const service = new NotificationService(
      { emailFrom: "bot@example.com", emailTo: "a@example.com, b@example.com", resendApiKey: "key" },
      makeLogger() as never,
    );

    const result = await service.sendHumanRequest(makePayload());

    expect(result.email).toEqual({ attempted: true, ok: true });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.resend.com/emails",
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: "Bearer key" }),
      }),
    );
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.to).toEqual(["a@example.com", "b@example.com"]);
  });

  it("records an email failure without throwing", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 422, text: () => Promise.resolve("bad request") });
    const logger = makeLogger();
    const service = new NotificationService(
      { emailFrom: "bot@example.com", emailTo: "a@example.com", resendApiKey: "key" },
      logger as never,
    );

    const result = await service.sendHumanRequest(makePayload());

    expect(result.email.ok).toBe(false);
    expect(result.email.error).toContain("422");
    expect(logger.warn).toHaveBeenCalled();
  });

  it("sends both channels concurrently when both are configured", async () => {
    fetchMock.mockResolvedValue({ ok: true });
    const service = new NotificationService(
      {
        emailFrom: "bot@example.com",
        emailTo: "a@example.com",
        resendApiKey: "key",
        slackWebhookUrl: "https://hooks.slack.com/x",
      },
      makeLogger() as never,
    );

    const result = await service.sendHumanRequest(makePayload());

    expect(result.slack.ok).toBe(true);
    expect(result.email.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("escapes HTML special characters and includes open questions/context in the email body", async () => {
    fetchMock.mockResolvedValue({ ok: true });
    const service = new NotificationService(
      { emailFrom: "bot@example.com", emailTo: "a@example.com", resendApiKey: "key" },
      makeLogger() as never,
    );

    await service.sendHumanRequest(
      makePayload({
        reason: "impl_rejected",
        context: "some <b>context</b> & \"quotes\" 'here'",
        planConfidence: 0.75,
        linearIssue: { id: "lin-1", identifier: "ENG-1", title: "<script>bad</script>", url: "https://linear.app/x" },
        openQuestions: [
          { id: "q1", question: "A?", requiredForExecution: true },
          { id: "q2", question: "B?", requiredForExecution: false },
        ],
      }),
    );

    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.html).toContain("&lt;script&gt;bad&lt;/script&gt;");
    expect(body.html).not.toContain("<script>bad</script>");
    expect(body.html).toContain("&amp;");
    expect(body.html).toContain("&quot;quotes&quot;");
    expect(body.html).toContain("&#39;here&#39;");
    expect(body.text).toContain("A?");
    expect(body.text).toContain("Implementation needs review (rejected by agent)");
  });

  it("renders every reason label without throwing", async () => {
    fetchMock.mockResolvedValue({ ok: true });
    const service = new NotificationService(
      { emailFrom: "bot@example.com", emailTo: "a@example.com", resendApiKey: "key" },
      makeLogger() as never,
    );

    const reasons: NotificationPayload["reason"][] = [
      "plan_ambiguous",
      "plan_low_confidence",
      "impl_rejected",
      "impl_uncertain",
      "other",
    ];

    for (const reason of reasons) {
      await service.sendHumanRequest(makePayload({ reason }));
    }

    expect(fetchMock).toHaveBeenCalledTimes(reasons.length);
  });

  it("falls back to the linear issue id when identifier is missing, in both email and slack", async () => {
    fetchMock.mockResolvedValue({ ok: true });
    const service = new NotificationService(
      {
        emailFrom: "bot@example.com",
        emailTo: "a@example.com",
        resendApiKey: "key",
        slackWebhookUrl: "https://hooks.slack.com/x",
      },
      makeLogger() as never,
    );

    await service.sendHumanRequest(
      makePayload({ linearIssue: { id: "lin-no-identifier", title: "No identifier", url: null } }),
    );

    const [slackCall, emailCall] = fetchMock.mock.calls;
    const slackBody = JSON.parse(slackCall[1].body as string);
    const emailBody = JSON.parse(emailCall[1].body as string);
    expect(slackBody.text).toContain("lin-no-identifier");
    expect(emailBody.subject).toContain("lin-no-identifier");
    expect(emailBody.text).toContain("lin-no-identifier");
    expect(emailBody.html).toContain("lin-no-identifier");
  });

  it("truncates a very long context in the email body", async () => {
    fetchMock.mockResolvedValue({ ok: true });
    const service = new NotificationService(
      { emailFrom: "bot@example.com", emailTo: "a@example.com", resendApiKey: "key" },
      makeLogger() as never,
    );

    await service.sendHumanRequest(makePayload({ context: "y".repeat(3000) }));

    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.text).toContain("…");
    expect(body.text.length).toBeLessThan(3000);
  });
});
