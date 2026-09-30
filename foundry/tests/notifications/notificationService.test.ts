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
    reason: "plan_low_confidence",
    summary: "The plan needs a second look.",
    linearIssue: {
      id: "LIN-1",
      identifier: "ENG-1",
      title: "Add feature X",
      url: null,
    },
    runState: "AwaitingPlanApproval",
    runUrl: "https://dashboard.example.com/runs/run-1",
    ...overrides,
  };
}

function okResponse(): Response {
  return { ok: true, status: 200, text: () => Promise.resolve("") } as unknown as Response;
}

function failResponse(status: number, body = "bad request"): Response {
  return { ok: false, status, text: () => Promise.resolve(body) } as unknown as Response;
}

describe("NotificationService.isConfigured", () => {
  const logger = makeLogger();

  it("is false when neither slack nor email is configured", () => {
    const svc = new NotificationService(
      { emailFrom: "bot@example.com" } as NotificationConfig,
      logger as never,
    );
    expect(svc.isConfigured()).toBe(false);
  });

  it("is true when slackWebhookUrl is set", () => {
    const svc = new NotificationService(
      { emailFrom: "bot@example.com", slackWebhookUrl: "https://hooks.slack.com/x" },
      logger as never,
    );
    expect(svc.isConfigured()).toBe(true);
  });

  it("is true when both emailTo and resendApiKey are set", () => {
    const svc = new NotificationService(
      { emailFrom: "bot@example.com", emailTo: "a@example.com", resendApiKey: "key" },
      logger as never,
    );
    expect(svc.isConfigured()).toBe(true);
  });

  it("is false when only emailTo is set without resendApiKey", () => {
    const svc = new NotificationService(
      { emailFrom: "bot@example.com", emailTo: "a@example.com" },
      logger as never,
    );
    expect(svc.isConfigured()).toBe(false);
  });

  it("is false when only resendApiKey is set without emailTo", () => {
    const svc = new NotificationService(
      { emailFrom: "bot@example.com", resendApiKey: "key" },
      logger as never,
    );
    expect(svc.isConfigured()).toBe(false);
  });
});

describe("NotificationService.sendHumanRequest — no channels configured", () => {
  it("no-ops safely: neither channel attempted, no fetch calls, does not throw", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const logger = makeLogger();
    const svc = new NotificationService({ emailFrom: "bot@example.com" }, logger as never);

    const result = await svc.sendHumanRequest(makePayload());

    expect(result).toEqual({
      slack: { attempted: false, ok: false },
      email: { attempted: false, ok: false },
    });
    expect(fetchMock).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});

describe("NotificationService.sendHumanRequest — Slack channel", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let logger: ReturnType<typeof makeLogger>;
  let svc: NotificationService;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    logger = makeLogger();
    svc = new NotificationService(
      { emailFrom: "bot@example.com", slackWebhookUrl: "https://hooks.slack.com/services/x" },
      logger as never,
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("posts a well-formed payload to the webhook and reports ok on success", async () => {
    fetchMock.mockResolvedValue(okResponse());
    const payload = makePayload({
      planConfidence: 0.42,
      openQuestions: [
        { id: "q1", question: "What about edge case A?", requiredForExecution: true },
        { id: "q2", question: "What about edge case B?", requiredForExecution: false },
      ],
      context: "Some extra context",
      linearIssue: { id: "LIN-1", identifier: "ENG-1", title: "Add feature X", url: "https://linear.app/x" },
    });

    const result = await svc.sendHumanRequest(payload);

    expect(result.slack).toEqual({ attempted: true, ok: true });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://hooks.slack.com/services/x",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
      }),
    );

    const requestBody = JSON.parse(fetchMock.mock.calls[0][1].body as string) as {
      text: string;
      blocks: unknown[];
    };
    expect(requestBody.text).toContain("ENG-1");
    expect(requestBody.text).toContain("Add feature X");
    const asString = JSON.stringify(requestBody.blocks);
    expect(asString).toContain("Plan confidence");
    expect(asString).toContain("0.42");
    expect(asString).toContain("Open questions");
    expect(asString).toContain("2 (1 required)");
    expect(asString).toContain("Some extra context");
    expect(asString).toContain("Open run");
    expect(asString).toContain("Open Linear issue");
    expect(asString).toContain("https://linear.app/x");
  });

  it("omits optional blocks (confidence, questions, context, linear button) when absent", async () => {
    fetchMock.mockResolvedValue(okResponse());
    const payload = makePayload({ context: undefined, planConfidence: undefined, openQuestions: undefined });

    await svc.sendHumanRequest(payload);

    const requestBody = JSON.parse(fetchMock.mock.calls[0][1].body as string) as { blocks: unknown[] };
    const asString = JSON.stringify(requestBody.blocks);
    expect(asString).not.toContain("Plan confidence");
    expect(asString).not.toContain("Open questions");
    expect(asString).not.toContain("Context:");
    expect(asString).not.toContain("Open Linear issue");
  });

  it("truncates a long context string to 1500 characters with an ellipsis", async () => {
    fetchMock.mockResolvedValue(okResponse());
    const longContext = "x".repeat(2000);
    await svc.sendHumanRequest(makePayload({ context: longContext }));

    const requestBody = JSON.parse(fetchMock.mock.calls[0][1].body as string) as { blocks: unknown[] };
    const asString = JSON.stringify(requestBody.blocks);
    expect(asString).toContain("…");
    expect(asString).not.toContain("x".repeat(1600));
  });

  it("shows only the first 3 open questions in the questions block", async () => {
    fetchMock.mockResolvedValue(okResponse());
    const openQuestions = Array.from({ length: 5 }, (_, i) => ({
      id: `q${String(i)}`,
      question: `Question number ${String(i)}`,
      requiredForExecution: false,
    }));
    await svc.sendHumanRequest(makePayload({ openQuestions }));

    const requestBody = JSON.parse(fetchMock.mock.calls[0][1].body as string) as { blocks: unknown[] };
    const asString = JSON.stringify(requestBody.blocks);
    expect(asString).toContain("Question number 0");
    expect(asString).toContain("Question number 2");
    expect(asString).not.toContain("Question number 3");
    expect(asString).not.toContain("Question number 4");
  });

  it("marks ok:false and logs a warning with the status when the webhook responds non-ok", async () => {
    fetchMock.mockResolvedValue(failResponse(500, "server exploded"));

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

  it("catches a thrown fetch error (network failure), does not reject, and logs a warning", async () => {
    fetchMock.mockRejectedValue(new Error("network unreachable"));

    const result = await svc.sendHumanRequest(makePayload());

    expect(result.slack).toEqual({ attempted: true, ok: false, error: "network unreachable" });
    expect(logger.warn).toHaveBeenCalledWith(
      { runId: "run-1", error: "network unreachable" },
      "Slack notification failed",
    );
  });

  it("stringifies a non-Error throw from fetch", async () => {
    fetchMock.mockRejectedValue("weird failure");

    const result = await svc.sendHumanRequest(makePayload());

    expect(result.slack.error).toBe("weird failure");
  });

  it("renders every reasonLabel variant into the Slack title", async () => {
    fetchMock.mockResolvedValue(okResponse());
    const cases: [HumanRequestReason, string][] = [
      ["plan_ambiguous", "Plan needs review (ambiguous)"],
      ["plan_low_confidence", "Plan needs review (low confidence)"],
      ["impl_rejected", "Implementation needs review (rejected by agent)"],
      ["impl_uncertain", "Implementation needs review (uncertain)"],
      ["other", "Human intervention requested"],
    ];

    for (const [reason, label] of cases) {
      fetchMock.mockClear();
      await svc.sendHumanRequest(makePayload({ reason }));
      const requestBody = JSON.parse(fetchMock.mock.calls[0][1].body as string) as { text: string };
      expect(requestBody.text).toContain(label);
    }
  });

  it("falls back to the raw issue id and '(untitled)' when identifier/title are missing", async () => {
    fetchMock.mockResolvedValue(okResponse());
    await svc.sendHumanRequest(
      makePayload({ linearIssue: { id: "LIN-99", title: null, url: null } }),
    );

    const requestBody = JSON.parse(fetchMock.mock.calls[0][1].body as string) as { text: string };
    expect(requestBody.text).toContain("LIN-99");
    expect(requestBody.text).toContain("(untitled)");
  });
});

describe("NotificationService.sendHumanRequest — Email channel", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let logger: ReturnType<typeof makeLogger>;
  let svc: NotificationService;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    logger = makeLogger();
    svc = new NotificationService(
      {
        emailFrom: "bot@example.com",
        emailTo: "a@example.com, b@example.com",
        resendApiKey: "resend-key-123",
      },
      logger as never,
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("does not attempt email when only emailTo is set (resendApiKey missing)", async () => {
    const partialSvc = new NotificationService(
      { emailFrom: "bot@example.com", emailTo: "a@example.com" },
      logger as never,
    );
    const result = await partialSvc.sendHumanRequest(makePayload());
    expect(result.email).toEqual({ attempted: false, ok: false });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("posts to the Resend API with split/trimmed recipients and reports ok on success", async () => {
    fetchMock.mockResolvedValue(okResponse());

    const result = await svc.sendHumanRequest(makePayload());

    expect(result.email).toEqual({ attempted: true, ok: true });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.resend.com/emails",
      expect.objectContaining({
        method: "POST",
        headers: {
          Authorization: "Bearer resend-key-123",
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
    expect(body.from).toBe("bot@example.com");
    expect(body.to).toEqual(["a@example.com", "b@example.com"]);
    expect(body.subject).toContain("[AgentForge]");
    expect(body.subject).toContain("ENG-1");
    expect(body.html).toContain("<!doctype html>");
    expect(body.text).toContain("Run: https://dashboard.example.com/runs/run-1");
  });

  it("escapes HTML-significant characters in the rendered email HTML", async () => {
    fetchMock.mockResolvedValue(okResponse());
    await svc.sendHumanRequest(
      makePayload({
        summary: 'Danger <script>alert("x")</script> & "quotes" \'apos\'',
      }),
    );

    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string) as { html: string };
    expect(body.html).not.toContain("<script>");
    expect(body.html).toContain("&lt;script&gt;");
    expect(body.html).toContain("&amp;");
    expect(body.html).toContain("&quot;quotes&quot;");
    expect(body.html).toContain("&#39;apos&#39;");
  });

  it("includes plan confidence, context, open questions, and the Linear link in both html and text bodies when present", async () => {
    fetchMock.mockResolvedValue(okResponse());
    const payload = makePayload({
      planConfidence: 0.75,
      context: "Additional background",
      openQuestions: [
        { id: "q1", question: "First question?", requiredForExecution: true },
        { id: "q2", question: "Second question?", requiredForExecution: false },
      ],
      linearIssue: { id: "LIN-1", identifier: "ENG-1", title: "Add feature X", url: "https://linear.app/issue/1" },
    });

    await svc.sendHumanRequest(payload);

    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string) as {
      html: string;
      text: string;
    };
    expect(body.html).toContain("Plan confidence:</strong> 0.75");
    expect(body.html).toContain("Additional background");
    expect(body.html).toContain("First question?");
    expect(body.html).toContain("[required]");
    expect(body.html).toContain('href="https://linear.app/issue/1"');

    expect(body.text).toContain("Plan confidence: 0.75");
    expect(body.text).toContain("Additional background");
    expect(body.text).toContain("- [required] First question?");
    expect(body.text).toContain("Linear: https://linear.app/issue/1");
  });

  it("omits confidence, context, questions, and Linear link when absent from both bodies", async () => {
    fetchMock.mockResolvedValue(okResponse());
    await svc.sendHumanRequest(
      makePayload({
        planConfidence: undefined,
        context: undefined,
        openQuestions: undefined,
        linearIssue: { id: "LIN-1", title: "Add feature X", url: null },
      }),
    );

    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string) as {
      html: string;
      text: string;
    };
    expect(body.html).not.toContain("Plan confidence");
    expect(body.html).not.toContain("Context:");
    expect(body.html).not.toContain("Open questions");
    expect(body.text).not.toContain("Plan confidence");
    expect(body.text).not.toContain("Context:");
    expect(body.text).not.toContain("Open questions");
    expect(body.text).not.toContain("Linear:");
  });

  it("truncates long context to 2000 characters in the email bodies", async () => {
    fetchMock.mockResolvedValue(okResponse());
    const longContext = "y".repeat(3000);
    await svc.sendHumanRequest(makePayload({ context: longContext }));

    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string) as {
      html: string;
      text: string;
    };
    expect(body.text).toContain("…");
    expect(body.text).not.toContain("y".repeat(2100));
  });

  it("shows only the first 5 open questions in the email bodies", async () => {
    fetchMock.mockResolvedValue(okResponse());
    const openQuestions = Array.from({ length: 7 }, (_, i) => ({
      id: `q${String(i)}`,
      question: `Q${String(i)}`,
      requiredForExecution: false,
    }));
    await svc.sendHumanRequest(makePayload({ openQuestions }));

    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string) as {
      html: string;
      text: string;
    };
    expect(body.text).toContain("Q4");
    expect(body.text).not.toContain("Q5");
    expect(body.html).toContain("Q4");
    expect(body.html).not.toContain("Q5");
  });

  it("marks ok:false and logs a warning with the status when Resend responds non-ok", async () => {
    fetchMock.mockResolvedValue(failResponse(422, "invalid recipient"));

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

  it("catches a thrown fetch error, does not reject, and logs a warning", async () => {
    fetchMock.mockRejectedValue(new Error("dns failure"));

    const result = await svc.sendHumanRequest(makePayload());

    expect(result.email).toEqual({ attempted: true, ok: false, error: "dns failure" });
    expect(logger.warn).toHaveBeenCalledWith(
      { runId: "run-1", error: "dns failure" },
      "Email notification failed",
    );
  });

  it("stringifies a non-Error throw from fetch", async () => {
    fetchMock.mockRejectedValue("email boom");

    const result = await svc.sendHumanRequest(makePayload());

    expect(result.email).toEqual({ attempted: true, ok: false, error: "email boom" });
  });

  it("falls back to the raw issue id and '(untitled)' in the subject, html, and text bodies", async () => {
    fetchMock.mockResolvedValue(okResponse());
    await svc.sendHumanRequest(
      makePayload({ linearIssue: { id: "LIN-99", title: null, url: null } }),
    );

    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string) as {
      subject: string;
      html: string;
      text: string;
    };
    expect(body.subject).toContain("LIN-99");
    expect(body.subject).toContain("(untitled)");
    expect(body.html).toContain("LIN-99");
    expect(body.html).toContain("(untitled)");
    expect(body.text).toContain("LIN-99");
    expect(body.text).toContain("(untitled)");
  });

  it("falls back to reading the error body safely when response.text() itself rejects", async () => {
    const response = {
      ok: false,
      status: 503,
      text: () => Promise.reject(new Error("stream closed")),
    } as unknown as Response;
    fetchMock.mockResolvedValue(response);

    const result = await svc.sendHumanRequest(makePayload());

    expect(result.email.ok).toBe(false);
    expect(result.email.error).toContain("503");
  });
});

describe("NotificationService.sendHumanRequest — both channels configured", () => {
  it("attempts and resolves slack and email independently and concurrently", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockImplementation((url: string) =>
      Promise.resolve(
        url.includes("slack") ? okResponse() : failResponse(500, "resend down"),
      ),
    );
    const logger = makeLogger();
    const svc = new NotificationService(
      {
        emailFrom: "bot@example.com",
        slackWebhookUrl: "https://hooks.slack.com/services/x",
        emailTo: "a@example.com",
        resendApiKey: "key",
      },
      logger as never,
    );

    const result = await svc.sendHumanRequest(makePayload());

    expect(result.slack).toEqual({ attempted: true, ok: true });
    expect(result.email.attempted).toBe(true);
    expect(result.email.ok).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    vi.unstubAllGlobals();
  });
});
