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
    summary: "Something needs a human look",
    linearIssue: {
      id: "issue-1",
      identifier: "ENG-42",
      title: "Fix the thing",
      url: "https://linear.app/team/issue/ENG-42",
    },
    runState: "AwaitingPlanApproval",
    runUrl: "http://localhost:5173/runs/run-1",
    ...overrides,
  };
}

function okResponse(): Response {
  return new Response("{}", { status: 200 });
}

function failResponse(status: number, body = "server error"): Response {
  return new Response(body, { status });
}

describe("NotificationService.isConfigured", () => {
  const logger = makeLogger();

  it("returns false when neither slack nor email is configured", () => {
    const svc = new NotificationService({ emailFrom: "a@b.com" }, logger as never);
    expect(svc.isConfigured()).toBe(false);
  });

  it("returns true when slackWebhookUrl is set alone", () => {
    const svc = new NotificationService(
      { emailFrom: "a@b.com", slackWebhookUrl: "https://hooks.slack.com/x" },
      logger as never,
    );
    expect(svc.isConfigured()).toBe(true);
  });

  it("returns false when only emailTo is set without resendApiKey", () => {
    const svc = new NotificationService(
      { emailFrom: "a@b.com", emailTo: "ops@b.com" },
      logger as never,
    );
    expect(svc.isConfigured()).toBe(false);
  });

  it("returns false when only resendApiKey is set without emailTo", () => {
    const svc = new NotificationService(
      { emailFrom: "a@b.com", resendApiKey: "key" },
      logger as never,
    );
    expect(svc.isConfigured()).toBe(false);
  });

  it("returns true when both emailTo and resendApiKey are set", () => {
    const svc = new NotificationService(
      { emailFrom: "a@b.com", emailTo: "ops@b.com", resendApiKey: "key" },
      logger as never,
    );
    expect(svc.isConfigured()).toBe(true);
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

  it("attempts neither channel when nothing is configured", async () => {
    const svc = new NotificationService({ emailFrom: "a@b.com" }, logger as never);
    const result = await svc.sendHumanRequest(makePayload());

    expect(result).toEqual({
      slack: { attempted: false, ok: false },
      email: { attempted: false, ok: false },
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  describe("slack channel", () => {
    const config: NotificationConfig = {
      emailFrom: "a@b.com",
      slackWebhookUrl: "https://hooks.slack.com/services/x",
    };

    it("posts to the webhook and marks ok:true on a 2xx response", async () => {
      fetchMock.mockResolvedValue(okResponse());
      const svc = new NotificationService(config, logger as never);

      const result = await svc.sendHumanRequest(makePayload());

      expect(result.slack).toEqual({ attempted: true, ok: true });
      expect(fetchMock).toHaveBeenCalledOnce();
      const [url, init] = fetchMock.mock.calls[0]!;
      expect(url).toBe(config.slackWebhookUrl);
      expect(init.method).toBe("POST");
      expect(init.headers["Content-Type"]).toBe("application/json");
      const body = JSON.parse(init.body as string);
      expect(body.text).toContain("Plan needs review (ambiguous)");
      expect(body.text).toContain("ENG-42");
      expect(body.text).toContain("Fix the thing");
    });

    it("includes plan confidence and open-questions fields/blocks when present", async () => {
      fetchMock.mockResolvedValue(okResponse());
      const svc = new NotificationService(config, logger as never);

      await svc.sendHumanRequest(
        makePayload({
          planConfidence: 0.567,
          openQuestions: [
            { id: "q1", question: "Which env?", requiredForExecution: true },
            { id: "q2", question: "Which team?", requiredForExecution: false },
          ],
        }),
      );

      const [, init] = fetchMock.mock.calls[0]!;
      const body = JSON.parse(init.body as string);
      const allText = JSON.stringify(body);
      expect(allText).toContain("0.57");
      expect(allText).toContain("2 (1 required)");
      expect(allText).toContain("Which env?");
    });

    it("includes a Context block, truncated at 1500 chars, when context is present", async () => {
      fetchMock.mockResolvedValue(okResponse());
      const svc = new NotificationService(config, logger as never);
      const longContext = "x".repeat(2000);

      await svc.sendHumanRequest(makePayload({ context: longContext }));

      const [, init] = fetchMock.mock.calls[0]!;
      const body = JSON.parse(init.body as string);
      const contextBlock = body.blocks.find(
        (b: { text?: { text?: string } }) => b.text?.text?.includes("*Context:*"),
      );
      expect(contextBlock).toBeDefined();
      expect(contextBlock.text.text).toContain("…");
      expect(contextBlock.text.text.length).toBeLessThan(1520);
    });

    it("omits the Linear issue button when linearIssue.url is null", async () => {
      fetchMock.mockResolvedValue(okResponse());
      const svc = new NotificationService(config, logger as never);

      await svc.sendHumanRequest(
        makePayload({ linearIssue: { id: "issue-1", title: "T", url: null } }),
      );

      const [, init] = fetchMock.mock.calls[0]!;
      const body = JSON.parse(init.body as string);
      const actionsBlock = body.blocks.find((b: { type?: string }) => b.type === "actions");
      expect(actionsBlock.elements).toHaveLength(1);
      expect(actionsBlock.elements[0].text.text).toBe("Open run");
    });

    it("falls back to the issue id and '(untitled)' when identifier/title are absent", async () => {
      fetchMock.mockResolvedValue(okResponse());
      const svc = new NotificationService(config, logger as never);

      await svc.sendHumanRequest(
        makePayload({ linearIssue: { id: "raw-issue-id", title: null, url: null } }),
      );

      const [, init] = fetchMock.mock.calls[0]!;
      const body = JSON.parse(init.body as string);
      expect(body.text).toContain("raw-issue-id");
      expect(body.text).toContain("(untitled)");
    });

    it("marks ok:false and records the error message on a non-2xx response", async () => {
      fetchMock.mockResolvedValue(failResponse(500, "invalid_payload"));
      const svc = new NotificationService(config, logger as never);

      const result = await svc.sendHumanRequest(makePayload());

      expect(result.slack.ok).toBe(false);
      expect(result.slack.error).toContain("Slack webhook returned 500");
      expect(result.slack.error).toContain("invalid_payload");
      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ runId: "run-1", error: result.slack.error }),
        "Slack notification failed",
      );
    });

    it("marks ok:false with a stringified error when fetch rejects with a non-Error", async () => {
      fetchMock.mockRejectedValue("network down");
      const svc = new NotificationService(config, logger as never);

      const result = await svc.sendHumanRequest(makePayload());

      expect(result.slack.ok).toBe(false);
      expect(result.slack.error).toBe("network down");
    });

    it("marks ok:false when fetch rejects with a real Error", async () => {
      fetchMock.mockRejectedValue(new Error("DNS failure"));
      const svc = new NotificationService(config, logger as never);

      const result = await svc.sendHumanRequest(makePayload());

      expect(result.slack.ok).toBe(false);
      expect(result.slack.error).toBe("DNS failure");
    });
  });

  describe("email channel", () => {
    const config: NotificationConfig = {
      emailFrom: "bot@agentforge.dev",
      emailTo: "ops@team.com, oncall@team.com",
      resendApiKey: "re_test_key",
    };

    it("posts to Resend with Bearer auth and comma-split recipients, marks ok:true on 2xx", async () => {
      fetchMock.mockResolvedValue(okResponse());
      const svc = new NotificationService(config, logger as never);

      const result = await svc.sendHumanRequest(makePayload());

      expect(result.email).toEqual({ attempted: true, ok: true });
      const [url, init] = fetchMock.mock.calls[0]!;
      expect(url).toBe("https://api.resend.com/emails");
      expect(init.headers.Authorization).toBe("Bearer re_test_key");
      const body = JSON.parse(init.body as string);
      expect(body.from).toBe("bot@agentforge.dev");
      expect(body.to).toEqual(["ops@team.com", "oncall@team.com"]);
      expect(body.subject).toContain("ENG-42");
      expect(body.html).toContain("Fix the thing");
      expect(body.text).toContain("Fix the thing");
    });

    it("escapes HTML-significant characters from user-controlled fields", async () => {
      fetchMock.mockResolvedValue(okResponse());
      const svc = new NotificationService(config, logger as never);

      await svc.sendHumanRequest(
        makePayload({
          summary: `<script>alert("xss")</script> & 'quotes'`,
        }),
      );

      const [, init] = fetchMock.mock.calls[0]!;
      const body = JSON.parse(init.body as string);
      expect(body.html).not.toContain("<script>alert");
      expect(body.html).toContain("&lt;script&gt;");
      expect(body.html).toContain("&amp;");
      expect(body.html).toContain("&#39;quotes&#39;");
    });

    it("includes plan confidence, context (truncated to 2000 chars), and open questions in html+text", async () => {
      fetchMock.mockResolvedValue(okResponse());
      const svc = new NotificationService(config, logger as never);
      const longContext = "y".repeat(2500);

      await svc.sendHumanRequest(
        makePayload({
          planConfidence: 0.9,
          context: longContext,
          openQuestions: [
            { id: "q1", question: "A?", requiredForExecution: true },
            { id: "q2", question: "B?", requiredForExecution: false },
            { id: "q3", question: "C?", requiredForExecution: false },
            { id: "q4", question: "D?", requiredForExecution: false },
            { id: "q5", question: "E?", requiredForExecution: false },
            { id: "q6", question: "F? (should be dropped, only 5 shown)", requiredForExecution: false },
          ],
        }),
      );

      const [, init] = fetchMock.mock.calls[0]!;
      const body = JSON.parse(init.body as string);
      expect(body.html).toContain("0.90");
      expect(body.html).toContain("…");
      expect(body.html).not.toContain("F? (should be dropped");
      expect(body.text).toContain("Plan confidence: 0.90");
      expect(body.text).toContain("[required] A?");
      expect(body.text).not.toContain("F? (should be dropped");
    });

    it("omits context/questions/confidence blocks and the Linear link when absent", async () => {
      fetchMock.mockResolvedValue(okResponse());
      const svc = new NotificationService(config, logger as never);

      await svc.sendHumanRequest(
        makePayload({ linearIssue: { id: "issue-1", title: "T", url: null } }),
      );

      const [, init] = fetchMock.mock.calls[0]!;
      const body = JSON.parse(init.body as string);
      expect(body.html).not.toContain("Open Linear issue");
      expect(body.text).not.toContain("Linear:");
    });

    it("falls back to '(untitled)' in the subject, html and text when linearIssue.title is null", async () => {
      fetchMock.mockResolvedValue(okResponse());
      const svc = new NotificationService(config, logger as never);

      await svc.sendHumanRequest(
        makePayload({ linearIssue: { id: "issue-1", title: null, url: null } }),
      );

      const [, init] = fetchMock.mock.calls[0]!;
      const body = JSON.parse(init.body as string);
      expect(body.subject).toContain("(untitled)");
      expect(body.html).toContain("(untitled)");
      expect(body.text).toContain("(untitled)");
    });

    it("marks ok:false and logs a warning on a non-2xx response", async () => {
      fetchMock.mockResolvedValue(failResponse(422, "invalid_recipient"));
      const svc = new NotificationService(config, logger as never);

      const result = await svc.sendHumanRequest(makePayload());

      expect(result.email.ok).toBe(false);
      expect(result.email.error).toContain("Resend returned 422");
      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ runId: "run-1", error: result.email.error }),
        "Email notification failed",
      );
    });

    it("marks ok:false with a stringified error when fetch rejects with a non-Error", async () => {
      fetchMock.mockRejectedValue(503);
      const svc = new NotificationService(config, logger as never);

      const result = await svc.sendHumanRequest(makePayload());

      expect(result.email.ok).toBe(false);
      expect(result.email.error).toBe("503");
    });
  });

  it("attempts and reports both channels independently when both are configured", async () => {
    fetchMock
      .mockResolvedValueOnce(okResponse()) // slack
      .mockResolvedValueOnce(failResponse(500)); // email
    const svc = new NotificationService(
      {
        emailFrom: "a@b.com",
        emailTo: "ops@b.com",
        resendApiKey: "key",
        slackWebhookUrl: "https://hooks.slack.com/x",
      },
      logger as never,
    );

    const result = await svc.sendHumanRequest(makePayload());

    expect(result.slack.attempted).toBe(true);
    expect(result.slack.ok).toBe(true);
    expect(result.email.attempted).toBe(true);
    expect(result.email.ok).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("produces the correct reasonLabel for every HumanRequestReason value", async () => {
    fetchMock.mockResolvedValue(okResponse());
    const svc = new NotificationService(
      { emailFrom: "a@b.com", slackWebhookUrl: "https://hooks.slack.com/x" },
      logger as never,
    );

    const expectations: [NotificationPayload["reason"], string][] = [
      ["plan_ambiguous", "Plan needs review (ambiguous)"],
      ["plan_low_confidence", "Plan needs review (low confidence)"],
      ["impl_rejected", "Implementation needs review (rejected by agent)"],
      ["impl_uncertain", "Implementation needs review (uncertain)"],
      ["other", "Human intervention requested"],
    ];

    for (const [reason, label] of expectations) {
      fetchMock.mockClear();
      await svc.sendHumanRequest(makePayload({ reason }));
      const [, init] = fetchMock.mock.calls[0]!;
      const body = JSON.parse(init.body as string);
      expect(body.text).toContain(label);
    }
  });
});
