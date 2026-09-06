import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  NotificationService,
  type NotificationConfig,
  type NotificationPayload,
} from "../../src/notifications/notificationService.js";
import type { Logger } from "../../src/utils/logger.js";

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
    reason: "plan_low_confidence",
    summary: "The plan is uncertain about scope.",
    linearIssue: {
      id: "lin-1",
      identifier: "ENG-1",
      title: "Add feature X",
      url: "https://linear.app/team/issue/ENG-1",
    },
    runState: "AwaitingPlanApproval",
    runUrl: "https://foundry.example.com/runs/run-1",
    ...overrides,
  };
}

function jsonResponse(ok: boolean, status = 200) {
  return {
    ok,
    status,
    text: vi.fn().mockResolvedValue(""),
  } as unknown as Response;
}

describe("NotificationService", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe("isConfigured", () => {
    it("is true when a slack webhook is configured", () => {
      const svc = new NotificationService(
        { emailFrom: "a@b.com", slackWebhookUrl: "https://hooks.slack.com/x" },
        makeLogger() as unknown as Logger,
      );
      expect(svc.isConfigured()).toBe(true);
    });

    it("is true when both emailTo and resendApiKey are configured", () => {
      const svc = new NotificationService(
        { emailFrom: "a@b.com", emailTo: "dev@b.com", resendApiKey: "key" },
        makeLogger() as unknown as Logger,
      );
      expect(svc.isConfigured()).toBe(true);
    });

    it("is false when emailTo is set without a resendApiKey", () => {
      const svc = new NotificationService(
        { emailFrom: "a@b.com", emailTo: "dev@b.com" },
        makeLogger() as unknown as Logger,
      );
      expect(svc.isConfigured()).toBe(false);
    });

    it("is false when resendApiKey is set without emailTo", () => {
      const svc = new NotificationService(
        { emailFrom: "a@b.com", resendApiKey: "key" },
        makeLogger() as unknown as Logger,
      );
      expect(svc.isConfigured()).toBe(false);
    });

    it("is false when nothing is configured", () => {
      const svc = new NotificationService({ emailFrom: "a@b.com" }, makeLogger() as unknown as Logger);
      expect(svc.isConfigured()).toBe(false);
    });
  });

  describe("sendHumanRequest", () => {
    it("attempts neither channel when neither is configured", async () => {
      const svc = new NotificationService({ emailFrom: "a@b.com" }, makeLogger() as unknown as Logger);
      const result = await svc.sendHumanRequest(makePayload());

      expect(fetchMock).not.toHaveBeenCalled();
      expect(result).toEqual({
        slack: { attempted: false, ok: false },
        email: { attempted: false, ok: false },
      });
    });

    it("posts to the slack webhook and marks ok on success", async () => {
      fetchMock.mockResolvedValue(jsonResponse(true));
      const config: NotificationConfig = {
        emailFrom: "a@b.com",
        slackWebhookUrl: "https://hooks.slack.com/services/x",
      };
      const svc = new NotificationService(config, makeLogger() as unknown as Logger);

      const result = await svc.sendHumanRequest(makePayload());

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe("https://hooks.slack.com/services/x");
      expect(init.method).toBe("POST");
      expect(init.headers).toEqual({ "Content-Type": "application/json" });

      const body = JSON.parse(init.body);
      expect(body.text).toContain("ENG-1");
      expect(body.text).toContain("Add feature X");
      expect(body.text).toContain("Plan needs review (low confidence)");
      expect(Array.isArray(body.blocks)).toBe(true);

      expect(result.slack).toEqual({ attempted: true, ok: true });
      expect(result.email).toEqual({ attempted: false, ok: false });
    });

    it("includes plan confidence and open questions fields/blocks when present", async () => {
      fetchMock.mockResolvedValue(jsonResponse(true));
      const svc = new NotificationService(
        { emailFrom: "a@b.com", slackWebhookUrl: "https://hooks.slack.com/x" },
        makeLogger() as unknown as Logger,
      );

      await svc.sendHumanRequest(
        makePayload({
          planConfidence: 0.42,
          openQuestions: [
            { id: "q1", question: "What auth method?", requiredForExecution: true },
            { id: "q2", question: "Which region?", requiredForExecution: false },
          ],
        }),
      );

      const body = JSON.parse(fetchMock.mock.calls[0][1].body);
      const sectionWithFields = body.blocks.find((b: { fields?: unknown[] }) => b.fields);
      const fieldTexts = sectionWithFields.fields.map((f: { text: string }) => f.text);
      expect(fieldTexts.some((t: string) => t.includes("0.42"))).toBe(true);
      expect(fieldTexts.some((t: string) => t.includes("2 (1 required)"))).toBe(true);

      const questionsBlock = body.blocks.find(
        (b: { text?: { text?: string } }) => b.text?.text?.includes("Questions:"),
      );
      expect(questionsBlock.text.text).toContain("[required] What auth method?");
      expect(questionsBlock.text.text).toContain("Which region?");
    });

    it("truncates long context in the slack context block", async () => {
      fetchMock.mockResolvedValue(jsonResponse(true));
      const svc = new NotificationService(
        { emailFrom: "a@b.com", slackWebhookUrl: "https://hooks.slack.com/x" },
        makeLogger() as unknown as Logger,
      );
      const longContext = "x".repeat(2000);

      await svc.sendHumanRequest(makePayload({ context: longContext }));

      const body = JSON.parse(fetchMock.mock.calls[0][1].body);
      const contextBlock = body.blocks.find(
        (b: { text?: { text?: string } }) => b.text?.text?.includes("*Context:*"),
      );
      expect(contextBlock).toBeDefined();
      // truncate(context, 1500) => 1500 chars total, last char is the ellipsis
      const textAfterLabel = contextBlock.text.text.split("*Context:*\n")[1];
      expect(textAfterLabel.length).toBe(1500);
      expect(textAfterLabel.endsWith("…")).toBe(true);
    });

    it("omits the linear-issue button when linearIssue.url is absent", async () => {
      fetchMock.mockResolvedValue(jsonResponse(true));
      const svc = new NotificationService(
        { emailFrom: "a@b.com", slackWebhookUrl: "https://hooks.slack.com/x" },
        makeLogger() as unknown as Logger,
      );

      await svc.sendHumanRequest(
        makePayload({ linearIssue: { id: "lin-1", title: null, url: null } }),
      );

      const body = JSON.parse(fetchMock.mock.calls[0][1].body);
      const actionsBlock = body.blocks.find((b: { type: string }) => b.type === "actions");
      expect(actionsBlock.elements).toHaveLength(1);
      expect(actionsBlock.elements[0].text.text).toBe("Open run");
      expect(body.text).toContain("(untitled)");
      // falls back to id when identifier is absent
      expect(body.text).toContain("lin-1");
    });

    it("marks slack failed and logs a warning when the webhook returns a non-ok response", async () => {
      fetchMock.mockResolvedValue({
        ok: false,
        status: 500,
        text: vi.fn().mockResolvedValue("server exploded"),
      });
      const logger = makeLogger();
      const svc = new NotificationService(
        { emailFrom: "a@b.com", slackWebhookUrl: "https://hooks.slack.com/x" },
        logger as unknown as Logger,
      );

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

    it("falls back to an empty body when reading the error response text fails", async () => {
      fetchMock.mockResolvedValue({
        ok: false,
        status: 503,
        text: vi.fn().mockRejectedValue(new Error("stream closed")),
      });
      const logger = makeLogger();
      const svc = new NotificationService(
        { emailFrom: "a@b.com", slackWebhookUrl: "https://hooks.slack.com/x" },
        logger as unknown as Logger,
      );

      const result = await svc.sendHumanRequest(makePayload());

      expect(result.slack.ok).toBe(false);
      expect(result.slack.error).toBe("Slack webhook returned 503: ");
    });

    it("marks slack failed and logs a warning when fetch rejects (network error)", async () => {
      fetchMock.mockRejectedValue(new Error("ECONNREFUSED"));
      const logger = makeLogger();
      const svc = new NotificationService(
        { emailFrom: "a@b.com", slackWebhookUrl: "https://hooks.slack.com/x" },
        logger as unknown as Logger,
      );

      const result = await svc.sendHumanRequest(makePayload());

      expect(result.slack.ok).toBe(false);
      expect(result.slack.error).toBe("ECONNREFUSED");
      expect(logger.warn).toHaveBeenCalledWith(
        { runId: "run-1", error: "ECONNREFUSED" },
        "Slack notification failed",
      );
    });

    it("stringifies a non-Error slack rejection", async () => {
      fetchMock.mockRejectedValue("weird failure");
      const svc = new NotificationService(
        { emailFrom: "a@b.com", slackWebhookUrl: "https://hooks.slack.com/x" },
        makeLogger() as unknown as Logger,
      );

      const result = await svc.sendHumanRequest(makePayload());
      expect(result.slack.error).toBe("weird failure");
    });

    it("posts to Resend with split/trimmed recipients and marks ok on success", async () => {
      fetchMock.mockResolvedValue(jsonResponse(true));
      const config: NotificationConfig = {
        emailFrom: "AgentForge <bot@agentforge.dev>",
        emailTo: " dev1@b.com, dev2@b.com ,,",
        resendApiKey: "resend-key-123",
      };
      const svc = new NotificationService(config, makeLogger() as unknown as Logger);

      const result = await svc.sendHumanRequest(makePayload());

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe("https://api.resend.com/emails");
      expect(init.method).toBe("POST");
      expect(init.headers).toEqual({
        Authorization: "Bearer resend-key-123",
        "Content-Type": "application/json",
      });

      const body = JSON.parse(init.body);
      expect(body.from).toBe("AgentForge <bot@agentforge.dev>");
      expect(body.to).toEqual(["dev1@b.com", "dev2@b.com"]);
      expect(body.subject).toContain("ENG-1");
      expect(body.html).toContain("<!doctype html>");
      expect(body.text).toContain("ENG-1");

      expect(result.email).toEqual({ attempted: true, ok: true });
      expect(result.slack).toEqual({ attempted: false, ok: false });
    });

    it("escapes HTML-significant characters from user content in the email HTML body", async () => {
      fetchMock.mockResolvedValue(jsonResponse(true));
      const svc = new NotificationService(
        { emailFrom: "a@b.com", emailTo: "dev@b.com", resendApiKey: "key" },
        makeLogger() as unknown as Logger,
      );

      await svc.sendHumanRequest(
        makePayload({
          summary: "<script>alert('xss')</script> & \"quoted\"",
          linearIssue: {
            id: "lin-1",
            identifier: "ENG-1",
            title: "<b>Bold</b> title",
            url: "https://linear.app/x",
          },
        }),
      );

      const body = JSON.parse(fetchMock.mock.calls[0][1].body);
      expect(body.html).not.toContain("<script>");
      expect(body.html).toContain("&lt;script&gt;");
      expect(body.html).toContain("&amp;");
      expect(body.html).toContain("&quot;quoted&quot;");
      expect(body.html).toContain("&lt;b&gt;Bold&lt;/b&gt; title");
      // plain text version is left unescaped
      expect(body.text).toContain("<b>Bold</b> title");
    });

    it("includes confidence, context, and open questions in both html and text email bodies", async () => {
      fetchMock.mockResolvedValue(jsonResponse(true));
      const svc = new NotificationService(
        { emailFrom: "a@b.com", emailTo: "dev@b.com", resendApiKey: "key" },
        makeLogger() as unknown as Logger,
      );
      const longContext = "y".repeat(3000);

      await svc.sendHumanRequest(
        makePayload({
          planConfidence: 0.77,
          context: longContext,
          openQuestions: [
            { id: "q1", question: "Which env?", requiredForExecution: true },
            { id: "q2", question: "Which region?", requiredForExecution: false },
          ],
        }),
      );

      const body = JSON.parse(fetchMock.mock.calls[0][1].body);
      expect(body.html).toContain("0.77");
      expect(body.html).toContain("<strong>[required]</strong> Which env?");
      expect(body.html).toContain("<li>Which region?</li>");
      expect(body.html).toContain("…"); // truncate(2000) applied to context
      expect(body.text).toContain("Plan confidence: 0.77");
      expect(body.text).toContain("- [required] Which env?");
      expect(body.text).toContain("- Which region?");
      expect(body.text).toContain("Context:");
    });

    it("stringifies a non-Error email rejection", async () => {
      fetchMock.mockRejectedValue({ reason: "weird email failure" });
      const svc = new NotificationService(
        { emailFrom: "a@b.com", emailTo: "dev@b.com", resendApiKey: "key" },
        makeLogger() as unknown as Logger,
      );

      const result = await svc.sendHumanRequest(makePayload());
      expect(result.email.ok).toBe(false);
      expect(result.email.error).toBe("[object Object]");
    });

    it("omits the linear-issue link from both html and text email bodies when linearIssue.url is absent", async () => {
      fetchMock.mockResolvedValue(jsonResponse(true));
      const svc = new NotificationService(
        { emailFrom: "a@b.com", emailTo: "dev@b.com", resendApiKey: "key" },
        makeLogger() as unknown as Logger,
      );

      await svc.sendHumanRequest(
        makePayload({ linearIssue: { id: "lin-1", title: null, url: null } }),
      );

      const body = JSON.parse(fetchMock.mock.calls[0][1].body);
      expect(body.html).not.toContain("Open Linear issue");
      expect(body.text).not.toContain("Linear:");
      expect(body.html).toContain("(untitled)");
    });

    it("marks email failed and logs a warning when Resend returns a non-ok response", async () => {
      fetchMock.mockResolvedValue({
        ok: false,
        status: 422,
        text: vi.fn().mockResolvedValue("invalid recipient"),
      });
      const logger = makeLogger();
      const svc = new NotificationService(
        { emailFrom: "a@b.com", emailTo: "dev@b.com", resendApiKey: "key" },
        logger as unknown as Logger,
      );

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

    it("marks email failed when the fetch call throws", async () => {
      fetchMock.mockRejectedValue(new Error("DNS failure"));
      const logger = makeLogger();
      const svc = new NotificationService(
        { emailFrom: "a@b.com", emailTo: "dev@b.com", resendApiKey: "key" },
        logger as unknown as Logger,
      );

      const result = await svc.sendHumanRequest(makePayload());

      expect(result.email.ok).toBe(false);
      expect(result.email.error).toBe("DNS failure");
    });

    it("attempts both channels concurrently and reports independent outcomes when both are configured", async () => {
      fetchMock.mockImplementation((url: string) => {
        if (url.includes("slack")) return Promise.resolve(jsonResponse(true));
        return Promise.resolve({ ok: false, status: 500, text: vi.fn().mockResolvedValue("oops") });
      });
      const logger = makeLogger();
      const svc = new NotificationService(
        {
          emailFrom: "a@b.com",
          slackWebhookUrl: "https://hooks.slack.com/x",
          emailTo: "dev@b.com",
          resendApiKey: "key",
        },
        logger as unknown as Logger,
      );

      const result = await svc.sendHumanRequest(makePayload());

      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(result.slack).toEqual({ attempted: true, ok: true });
      expect(result.email.attempted).toBe(true);
      expect(result.email.ok).toBe(false);
      expect(result.email.error).toContain("500");
    });

    it.each([
      ["plan_ambiguous", "Plan needs review (ambiguous)"],
      ["plan_low_confidence", "Plan needs review (low confidence)"],
      ["impl_rejected", "Implementation needs review (rejected by agent)"],
      ["impl_uncertain", "Implementation needs review (uncertain)"],
      ["other", "Human intervention requested"],
    ] as const)("labels reason %s as %s in the slack title", async (reason, label) => {
      fetchMock.mockResolvedValue(jsonResponse(true));
      const svc = new NotificationService(
        { emailFrom: "a@b.com", slackWebhookUrl: "https://hooks.slack.com/x" },
        makeLogger() as unknown as Logger,
      );

      await svc.sendHumanRequest(makePayload({ reason }));

      const body = JSON.parse(fetchMock.mock.calls[0][1].body);
      expect(body.text).toContain(label);
    });
  });
});
