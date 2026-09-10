import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  NotificationService,
  type NotificationConfig,
  type NotificationPayload,
  type HumanRequestReason,
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
    summary: "Something needs your attention",
    linearIssue: {
      id: "issue-id-1",
      identifier: "LIN-42",
      title: "Fix the thing",
      url: "https://linear.app/issue/LIN-42",
    },
    runState: "AWAITING_HUMAN",
    runUrl: "https://foundry.example.com/runs/run-1",
    ...overrides,
  };
}

function okResponse() {
  return { ok: true, status: 200, text: async () => "" };
}

function failResponse(status = 500, body = "server error") {
  return { ok: false, status, text: async () => body };
}

describe("NotificationService", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe("isConfigured", () => {
    it("is true when slackWebhookUrl is set", () => {
      const svc = new NotificationService(
        { slackWebhookUrl: "https://hooks.slack.com/x", emailFrom: "a@b.com" },
        makeLogger() as never,
      );
      expect(svc.isConfigured()).toBe(true);
    });

    it("is true when both emailTo and resendApiKey are set", () => {
      const svc = new NotificationService(
        { emailTo: "a@b.com", resendApiKey: "key", emailFrom: "from@b.com" },
        makeLogger() as never,
      );
      expect(svc.isConfigured()).toBe(true);
    });

    it("is false when only emailTo is set without resendApiKey", () => {
      const svc = new NotificationService(
        { emailTo: "a@b.com", emailFrom: "from@b.com" },
        makeLogger() as never,
      );
      expect(svc.isConfigured()).toBe(false);
    });

    it("is false when neither slack nor email is configured", () => {
      const svc = new NotificationService({ emailFrom: "from@b.com" }, makeLogger() as never);
      expect(svc.isConfigured()).toBe(false);
    });
  });

  describe("sendHumanRequest — dispatch behavior", () => {
    it("only sends slack when only slack is configured", async () => {
      const fetchMock = vi.mocked(fetch);
      fetchMock.mockResolvedValue(okResponse() as never);
      const svc = new NotificationService(
        { slackWebhookUrl: "https://hooks.slack.com/x", emailFrom: "from@b.com" },
        makeLogger() as never,
      );

      const result = await svc.sendHumanRequest(makePayload());

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(result.slack.attempted).toBe(true);
      expect(result.slack.ok).toBe(true);
      expect(result.email.attempted).toBe(false);
      expect(result.email.ok).toBe(false);
    });

    it("only sends email when only email is configured", async () => {
      const fetchMock = vi.mocked(fetch);
      fetchMock.mockResolvedValue(okResponse() as never);
      const svc = new NotificationService(
        { emailTo: "a@b.com", resendApiKey: "key", emailFrom: "from@b.com" },
        makeLogger() as never,
      );

      const result = await svc.sendHumanRequest(makePayload());

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(result.email.attempted).toBe(true);
      expect(result.email.ok).toBe(true);
      expect(result.slack.attempted).toBe(false);
      expect(result.slack.ok).toBe(false);
    });

    it("sends both concurrently when both are configured, hitting the two distinct URLs", async () => {
      const fetchMock = vi.mocked(fetch);
      fetchMock.mockResolvedValue(okResponse() as never);
      const svc = new NotificationService(
        {
          slackWebhookUrl: "https://hooks.slack.com/x",
          emailTo: "a@b.com",
          resendApiKey: "key",
          emailFrom: "from@b.com",
        },
        makeLogger() as never,
      );

      const result = await svc.sendHumanRequest(makePayload());

      expect(fetchMock).toHaveBeenCalledTimes(2);
      const urls = fetchMock.mock.calls.map((c) => c[0]);
      expect(urls).toContain("https://hooks.slack.com/x");
      expect(urls).toContain("https://api.resend.com/emails");
      expect(result.slack.ok).toBe(true);
      expect(result.email.ok).toBe(true);
    });

    it("does not call fetch and leaves both attempted false when neither is configured", async () => {
      const fetchMock = vi.mocked(fetch);
      const svc = new NotificationService({ emailFrom: "from@b.com" }, makeLogger() as never);

      const result = await svc.sendHumanRequest(makePayload());

      expect(fetchMock).not.toHaveBeenCalled();
      expect(result.slack.attempted).toBe(false);
      expect(result.email.attempted).toBe(false);
    });
  });

  describe("sendHumanRequest — slack failure / success", () => {
    it("records failure, error message, and warns the logger on non-ok slack response", async () => {
      const fetchMock = vi.mocked(fetch);
      fetchMock.mockResolvedValue(failResponse(500, "server error") as never);
      const logger = makeLogger();
      const svc = new NotificationService(
        { slackWebhookUrl: "https://hooks.slack.com/x", emailFrom: "from@b.com" },
        logger as never,
      );

      const result = await svc.sendHumanRequest(makePayload());

      expect(result.slack.ok).toBe(false);
      expect(result.slack.error).toContain("500");
      expect(result.slack.error).toContain("server error");
      expect(logger.warn).toHaveBeenCalledTimes(1);
      expect(logger.warn.mock.calls[0]?.[1]).toBe("Slack notification failed");
    });

    it("stringifies a non-Error rejection from fetch for slack", async () => {
      const fetchMock = vi.mocked(fetch);
      fetchMock.mockRejectedValue("boom, not an Error instance");
      const svc = new NotificationService(
        { slackWebhookUrl: "https://hooks.slack.com/x", emailFrom: "from@b.com" },
        makeLogger() as never,
      );

      const result = await svc.sendHumanRequest(makePayload());

      expect(result.slack.ok).toBe(false);
      expect(result.slack.error).toBe("boom, not an Error instance");
    });

    it("renders the slack title with '(untitled)' when linearIssue.title is null", async () => {
      const fetchMock = vi.mocked(fetch);
      fetchMock.mockResolvedValue(okResponse() as never);
      const svc = new NotificationService(
        { slackWebhookUrl: "https://hooks.slack.com/x", emailFrom: "from@b.com" },
        makeLogger() as never,
      );

      await svc.sendHumanRequest(
        makePayload({ linearIssue: { id: "iss-1", identifier: "LIN-1", title: null, url: null } }),
      );

      const call = fetchMock.mock.calls[0];
      const body = JSON.parse(call?.[1]?.body as string) as { text: string };
      expect(body.text).toContain("(untitled)");
    });

    it("marks slack ok on a successful response", async () => {
      const fetchMock = vi.mocked(fetch);
      fetchMock.mockResolvedValue(okResponse() as never);
      const svc = new NotificationService(
        { slackWebhookUrl: "https://hooks.slack.com/x", emailFrom: "from@b.com" },
        makeLogger() as never,
      );

      const result = await svc.sendHumanRequest(makePayload());

      expect(result.slack.ok).toBe(true);
      expect(result.slack.error).toBeUndefined();
    });
  });

  describe("sendHumanRequest — email failure / success", () => {
    it("records failure, error message, and warns the logger on non-ok resend response", async () => {
      const fetchMock = vi.mocked(fetch);
      fetchMock.mockResolvedValue(failResponse(422, "bad payload") as never);
      const logger = makeLogger();
      const svc = new NotificationService(
        { emailTo: "a@b.com", resendApiKey: "key", emailFrom: "from@b.com" },
        logger as never,
      );

      const result = await svc.sendHumanRequest(makePayload());

      expect(result.email.ok).toBe(false);
      expect(result.email.error).toContain("422");
      expect(result.email.error).toContain("bad payload");
      expect(logger.warn).toHaveBeenCalledTimes(1);
      expect(logger.warn.mock.calls[0]?.[1]).toBe("Email notification failed");
    });

    it("stringifies a non-Error rejection from fetch for email", async () => {
      const fetchMock = vi.mocked(fetch);
      fetchMock.mockRejectedValue({ some: "object", not: "an Error" });
      const svc = new NotificationService(
        { emailTo: "a@b.com", resendApiKey: "key", emailFrom: "from@b.com" },
        makeLogger() as never,
      );

      const result = await svc.sendHumanRequest(makePayload());

      expect(result.email.ok).toBe(false);
      expect(result.email.error).toBe(String({ some: "object", not: "an Error" }));
    });

    it("marks email ok on a successful response", async () => {
      const fetchMock = vi.mocked(fetch);
      fetchMock.mockResolvedValue(okResponse() as never);
      const svc = new NotificationService(
        { emailTo: "a@b.com", resendApiKey: "key", emailFrom: "from@b.com" },
        makeLogger() as never,
      );

      const result = await svc.sendHumanRequest(makePayload());

      expect(result.email.ok).toBe(true);
      expect(result.email.error).toBeUndefined();
    });
  });

  describe("slack payload shape", () => {
    it("includes confidence and open-questions summary fields, omits context section, when no context given", async () => {
      const fetchMock = vi.mocked(fetch);
      fetchMock.mockResolvedValue(okResponse() as never);
      const svc = new NotificationService(
        { slackWebhookUrl: "https://hooks.slack.com/x", emailFrom: "from@b.com" },
        makeLogger() as never,
      );

      await svc.sendHumanRequest(
        makePayload({
          planConfidence: 0.42,
          openQuestions: [
            { id: "q1", question: "Is this ok?", requiredForExecution: true },
            { id: "q2", question: "What about that?", requiredForExecution: false },
          ],
          context: undefined,
        }),
      );

      const call = fetchMock.mock.calls[0];
      const body = JSON.parse(call?.[1]?.body as string) as {
        blocks: { type: string; fields?: { text: string }[]; text?: { text: string } }[];
      };

      const fieldsSection = body.blocks.find((b) => b.type === "section" && b.fields);
      expect(fieldsSection).toBeDefined();
      const fieldTexts = fieldsSection?.fields?.map((f) => f.text) ?? [];
      expect(fieldTexts.some((t) => t.includes("Plan confidence"))).toBe(true);
      expect(fieldTexts.some((t) => t.includes("Open questions"))).toBe(true);
      expect(fieldTexts.some((t) => t.includes("2 (1 required)"))).toBe(true);

      const contextSection = body.blocks.find(
        (b) => b.type === "section" && b.text?.text.includes("*Context:*"),
      );
      expect(contextSection).toBeUndefined();

      const questionsSection = body.blocks.find(
        (b) => b.type === "section" && b.text?.text.includes("*Questions:*"),
      );
      expect(questionsSection).toBeDefined();
      expect(questionsSection?.text?.text).toContain("[required] Is this ok?");
      expect(questionsSection?.text?.text).toContain("What about that?");
      expect(questionsSection?.text?.text).not.toContain("[required] What about that?");

      const actionsBlock = body.blocks.find(
        (b) => b.type === "actions",
      ) as unknown as { elements: { text: { text: string } }[] };
      const buttonTexts = actionsBlock.elements.map((e) => e.text.text);
      expect(buttonTexts).toContain("Open run");
      expect(buttonTexts).toContain("Open Linear issue");
    });

    it("omits the confidence field, includes truncated context, and omits Linear button when no linearIssue.url or planConfidence", async () => {
      const fetchMock = vi.mocked(fetch);
      fetchMock.mockResolvedValue(okResponse() as never);
      const svc = new NotificationService(
        { slackWebhookUrl: "https://hooks.slack.com/x", emailFrom: "from@b.com" },
        makeLogger() as never,
      );

      const longContext = "x".repeat(1600);
      await svc.sendHumanRequest(
        makePayload({
          planConfidence: undefined,
          openQuestions: undefined,
          context: longContext,
          linearIssue: { id: "iss-1", identifier: undefined, title: "T", url: null },
        }),
      );

      const call = fetchMock.mock.calls[0];
      const body = JSON.parse(call?.[1]?.body as string) as {
        blocks: { type: string; fields?: { text: string }[]; text?: { text: string } }[];
      };

      const fieldsSection = body.blocks.find((b) => b.type === "section" && b.fields);
      const fieldTexts = fieldsSection?.fields?.map((f) => f.text) ?? [];
      expect(fieldTexts.some((t) => t.includes("Plan confidence"))).toBe(false);
      expect(fieldTexts.some((t) => t.includes("Open questions"))).toBe(false);

      const contextSection = body.blocks.find(
        (b) => b.type === "section" && b.text?.text.includes("*Context:*"),
      );
      expect(contextSection).toBeDefined();
      const contextText = contextSection?.text?.text ?? "";
      expect(contextText.endsWith("…")).toBe(true);
      expect(contextText.length).toBeLessThan(longContext.length + 20);

      const questionsSection = body.blocks.find(
        (b) => b.type === "section" && b.text?.text.includes("*Questions:*"),
      );
      expect(questionsSection).toBeUndefined();

      const actionsBlock = body.blocks.find(
        (b) => b.type === "actions",
      ) as unknown as { elements: { text: { text: string } }[] };
      const buttonTexts = actionsBlock.elements.map((e) => e.text.text);
      expect(buttonTexts).toContain("Open run");
      expect(buttonTexts).not.toContain("Open Linear issue");
    });

    it("limits questions block to first 3 and truncates long questions", async () => {
      const fetchMock = vi.mocked(fetch);
      fetchMock.mockResolvedValue(okResponse() as never);
      const svc = new NotificationService(
        { slackWebhookUrl: "https://hooks.slack.com/x", emailFrom: "from@b.com" },
        makeLogger() as never,
      );

      const longQuestion = "q".repeat(250);
      await svc.sendHumanRequest(
        makePayload({
          openQuestions: [
            { id: "q1", question: "one", requiredForExecution: false },
            { id: "q2", question: "two", requiredForExecution: false },
            { id: "q3", question: "three", requiredForExecution: false },
            { id: "q4", question: longQuestion, requiredForExecution: false },
          ],
        }),
      );

      const call = fetchMock.mock.calls[0];
      const body = JSON.parse(call?.[1]?.body as string) as {
        blocks: { type: string; text?: { text: string } }[];
      };
      const questionsSection = body.blocks.find(
        (b) => b.type === "section" && b.text?.text.includes("*Questions:*"),
      );
      const text = questionsSection?.text?.text ?? "";
      expect(text).toContain("one");
      expect(text).toContain("two");
      expect(text).toContain("three");
      expect(text).not.toContain(longQuestion);
      expect(text.split("\n").length).toBe(4); // header line consumed into same text plus 3 bullet lines
    });
  });

  describe("email content", () => {
    it("uses identifier when present and title fallback when null; splits/trims recipients", async () => {
      const fetchMock = vi.mocked(fetch);
      fetchMock.mockResolvedValue(okResponse() as never);
      const svc = new NotificationService(
        { emailTo: "a@x.com, b@x.com", resendApiKey: "key", emailFrom: "from@b.com" },
        makeLogger() as never,
      );

      await svc.sendHumanRequest(
        makePayload({
          linearIssue: { id: "iss-1", identifier: "LIN-42", title: null, url: null },
        }),
      );

      const call = fetchMock.mock.calls[0];
      const body = JSON.parse(call?.[1]?.body as string) as {
        to: string[];
        subject: string;
        html: string;
        text: string;
      };

      expect(body.to).toEqual(["a@x.com", "b@x.com"]);
      expect(body.subject).toContain("LIN-42");
      expect(body.subject).toContain("(untitled)");
      expect(body.html).toContain("(untitled)");
      expect(body.text).toContain("(untitled)");
    });

    it("includes the plan confidence line in both html and text when planConfidence is set", async () => {
      const fetchMock = vi.mocked(fetch);
      fetchMock.mockResolvedValue(okResponse() as never);
      const svc = new NotificationService(
        { emailTo: "a@x.com", resendApiKey: "key", emailFrom: "from@b.com" },
        makeLogger() as never,
      );

      await svc.sendHumanRequest(makePayload({ planConfidence: 0.73 }));

      const call = fetchMock.mock.calls[0];
      const body = JSON.parse(call?.[1]?.body as string) as { html: string; text: string };
      expect(body.html).toContain("<strong>Plan confidence:</strong> 0.73");
      expect(body.text).toContain("Plan confidence: 0.73");
    });

    it("falls back to id when identifier is absent", async () => {
      const fetchMock = vi.mocked(fetch);
      fetchMock.mockResolvedValue(okResponse() as never);
      const svc = new NotificationService(
        { emailTo: "a@x.com", resendApiKey: "key", emailFrom: "from@b.com" },
        makeLogger() as never,
      );

      await svc.sendHumanRequest(
        makePayload({
          linearIssue: { id: "raw-issue-id", identifier: undefined, title: "Has title", url: null },
        }),
      );

      const call = fetchMock.mock.calls[0];
      const body = JSON.parse(call?.[1]?.body as string) as { subject: string; html: string };
      expect(body.subject).toContain("raw-issue-id");
      expect(body.html).toContain("raw-issue-id");
    });

    it("HTML-escapes special characters in summary and title", async () => {
      const fetchMock = vi.mocked(fetch);
      fetchMock.mockResolvedValue(okResponse() as never);
      const svc = new NotificationService(
        { emailTo: "a@x.com", resendApiKey: "key", emailFrom: "from@b.com" },
        makeLogger() as never,
      );

      const dangerous = `Tom & Jerry <script>"quoted" 'single'</script>`;
      await svc.sendHumanRequest(
        makePayload({
          summary: dangerous,
          linearIssue: { id: "iss-1", identifier: "LIN-1", title: dangerous, url: null },
        }),
      );

      const call = fetchMock.mock.calls[0];
      const body = JSON.parse(call?.[1]?.body as string) as { html: string };
      expect(body.html).toContain("&amp;");
      expect(body.html).toContain("&lt;");
      expect(body.html).toContain("&gt;");
      expect(body.html).toContain("&quot;");
      expect(body.html).toContain("&#39;");
      expect(body.html).not.toContain("<script>");
    });

    it("truncates long context in both html (<pre>) and text (2000-char limit)", async () => {
      const fetchMock = vi.mocked(fetch);
      fetchMock.mockResolvedValue(okResponse() as never);
      const svc = new NotificationService(
        { emailTo: "a@x.com", resendApiKey: "key", emailFrom: "from@b.com" },
        makeLogger() as never,
      );

      const longContext = "c".repeat(2500);
      await svc.sendHumanRequest(makePayload({ context: longContext }));

      const call = fetchMock.mock.calls[0];
      const body = JSON.parse(call?.[1]?.body as string) as { html: string; text: string };
      expect(body.html).toContain("<pre");
      expect(body.html).toContain("…");
      expect(body.html).not.toContain("c".repeat(2001));
      expect(body.text).toContain("Context:");
      expect(body.text).toContain("…");
      expect(body.text).not.toContain("c".repeat(2001));
    });

    it("renders open questions as a <ul> limited to 5 items with [required] markers, and text has line-by-line structure", async () => {
      const fetchMock = vi.mocked(fetch);
      fetchMock.mockResolvedValue(okResponse() as never);
      const svc = new NotificationService(
        { emailTo: "a@x.com", resendApiKey: "key", emailFrom: "from@b.com" },
        makeLogger() as never,
      );

      const questions = Array.from({ length: 7 }, (_, i) => ({
        id: `q${i}`,
        question: `Question number ${i}`,
        requiredForExecution: i % 2 === 0,
      }));
      await svc.sendHumanRequest(makePayload({ openQuestions: questions }));

      const call = fetchMock.mock.calls[0];
      const body = JSON.parse(call?.[1]?.body as string) as { html: string; text: string };

      expect(body.html).toContain("<ul>");
      const liMatches = body.html.match(/<li>/g) ?? [];
      expect(liMatches.length).toBe(5);
      expect(body.html).toContain("<strong>[required]</strong>");
      expect(body.html).toContain("Question number 0");
      expect(body.html).not.toContain("Question number 6");

      expect(body.text).toContain("Open questions:");
      expect(body.text).toContain("- [required] Question number 0");
      expect(body.text).toContain("- Question number 1");
      const lines = body.text.split("\n");
      expect(lines).toContain(`Run: ${body.text.match(/Run: (\S+)/)?.[1] ?? ""}`);
    });

    it("omits questions/context blocks in html and text when absent", async () => {
      const fetchMock = vi.mocked(fetch);
      fetchMock.mockResolvedValue(okResponse() as never);
      const svc = new NotificationService(
        { emailTo: "a@x.com", resendApiKey: "key", emailFrom: "from@b.com" },
        makeLogger() as never,
      );

      await svc.sendHumanRequest(
        makePayload({ context: undefined, openQuestions: undefined, planConfidence: undefined }),
      );

      const call = fetchMock.mock.calls[0];
      const body = JSON.parse(call?.[1]?.body as string) as { html: string; text: string };
      expect(body.html).not.toContain("<ul>");
      expect(body.html).not.toContain("<pre");
      expect(body.html).not.toContain("Plan confidence");
      expect(body.text).not.toContain("Open questions:");
      expect(body.text).not.toContain("Context:");
      expect(body.text).not.toContain("Plan confidence");
    });

    it("includes a Linear link line in text and href in html when linearIssue.url is set", async () => {
      const fetchMock = vi.mocked(fetch);
      fetchMock.mockResolvedValue(okResponse() as never);
      const svc = new NotificationService(
        { emailTo: "a@x.com", resendApiKey: "key", emailFrom: "from@b.com" },
        makeLogger() as never,
      );

      await svc.sendHumanRequest(
        makePayload({
          linearIssue: {
            id: "iss-1",
            identifier: "LIN-1",
            title: "T",
            url: "https://linear.app/issue/LIN-1",
          },
        }),
      );

      const call = fetchMock.mock.calls[0];
      const body = JSON.parse(call?.[1]?.body as string) as { html: string; text: string };
      expect(body.html).toContain('href="https://linear.app/issue/LIN-1"');
      expect(body.text).toContain("Linear: https://linear.app/issue/LIN-1");
    });
  });

  describe("reasonLabel coverage across all HumanRequestReason values", () => {
    const cases: [HumanRequestReason, string][] = [
      ["plan_ambiguous", "Plan needs review (ambiguous)"],
      ["plan_low_confidence", "Plan needs review (low confidence)"],
      ["impl_rejected", "Implementation needs review (rejected by agent)"],
      ["impl_uncertain", "Implementation needs review (uncertain)"],
      ["other", "Human intervention requested"],
    ];

    it.each(cases)("renders the correct label for reason=%s", async (reason, expectedLabel) => {
      const fetchMock = vi.mocked(fetch);
      fetchMock.mockResolvedValue(okResponse() as never);
      const config: NotificationConfig = {
        slackWebhookUrl: "https://hooks.slack.com/x",
        emailTo: "a@x.com",
        resendApiKey: "key",
        emailFrom: "from@b.com",
      };
      const svc = new NotificationService(config, makeLogger() as never);

      await svc.sendHumanRequest(makePayload({ reason }));

      const calls = fetchMock.mock.calls;
      const slackCall = calls.find((c) => c[0] === "https://hooks.slack.com/x");
      const emailCall = calls.find((c) => c[0] === "https://api.resend.com/emails");
      const slackBody = JSON.parse(slackCall?.[1]?.body as string) as { text: string };
      const emailBody = JSON.parse(emailCall?.[1]?.body as string) as { subject: string };

      expect(slackBody.text).toContain(expectedLabel);
      expect(emailBody.subject).toContain(expectedLabel);
    });
  });
});
