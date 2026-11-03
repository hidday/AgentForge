import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  NotificationService,
  type NotificationConfig,
  type NotificationPayload,
} from "../../src/notifications/notificationService.js";
import type { Logger } from "../../src/utils/logger.js";

function makeLogger(): Logger {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
    trace: vi.fn(),
    child: () => makeLogger(),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

function makePayload(overrides: Partial<NotificationPayload> = {}): NotificationPayload {
  return {
    runId: "run-1",
    reason: "plan_ambiguous",
    summary: "Needs a human decision",
    linearIssue: {
      id: "lin-1",
      identifier: "ENG-1",
      title: "Add feature",
      url: "https://linear.app/team/issue/ENG-1",
    },
    runState: "AwaitingPlanApproval",
    runUrl: "https://app.example.com/runs/run-1",
    ...overrides,
  };
}

function mockFetchResponse(ok: boolean, status = 200, text = ""): Response {
  return {
    ok,
    status,
    text: vi.fn().mockResolvedValue(text),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

describe("NotificationService", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let logger: Logger;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    logger = makeLogger();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe("isConfigured", () => {
    it("is true when a Slack webhook URL is set", () => {
      const svc = new NotificationService({ emailFrom: "a@b.com", slackWebhookUrl: "https://hooks.slack.com/x" }, logger);
      expect(svc.isConfigured()).toBe(true);
    });

    it("is true when both emailTo and resendApiKey are set", () => {
      const svc = new NotificationService(
        { emailFrom: "a@b.com", emailTo: "to@b.com", resendApiKey: "key" },
        logger,
      );
      expect(svc.isConfigured()).toBe(true);
    });

    it("is false when emailTo is set but resendApiKey is missing", () => {
      const svc = new NotificationService({ emailFrom: "a@b.com", emailTo: "to@b.com" }, logger);
      expect(svc.isConfigured()).toBe(false);
    });

    it("is false when neither channel is configured", () => {
      const svc = new NotificationService({ emailFrom: "a@b.com" }, logger);
      expect(svc.isConfigured()).toBe(false);
    });
  });

  describe("sendHumanRequest", () => {
    it("attempts nothing when no channel is configured", async () => {
      const svc = new NotificationService({ emailFrom: "a@b.com" }, logger);

      const result = await svc.sendHumanRequest(makePayload());

      expect(result).toEqual({
        slack: { attempted: false, ok: false },
        email: { attempted: false, ok: false },
      });
      expect(fetchMock).not.toHaveBeenCalled();
    });

    describe("slack channel", () => {
      function slackConfig(overrides: Partial<NotificationConfig> = {}): NotificationConfig {
        return {
          emailFrom: "a@b.com",
          slackWebhookUrl: "https://hooks.slack.com/services/x",
          ...overrides,
        };
      }

      it("posts to the webhook and marks ok=true on success", async () => {
        fetchMock.mockResolvedValue(mockFetchResponse(true));
        const svc = new NotificationService(slackConfig(), logger);

        const result = await svc.sendHumanRequest(makePayload());

        expect(result.slack).toEqual({ attempted: true, ok: true });
        expect(fetchMock).toHaveBeenCalledWith(
          "https://hooks.slack.com/services/x",
          expect.objectContaining({ method: "POST" }),
        );
        const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
        expect(body.text).toContain("ENG-1");
      });

      it("records an error and logs a warning when the webhook responds non-ok", async () => {
        fetchMock.mockResolvedValue(mockFetchResponse(false, 500, "server error"));
        const svc = new NotificationService(slackConfig(), logger);

        const result = await svc.sendHumanRequest(makePayload());

        expect(result.slack.ok).toBe(false);
        expect(result.slack.error).toContain("500");
        expect(logger.warn).toHaveBeenCalled();
      });

      it("handles a thrown network error", async () => {
        fetchMock.mockRejectedValue(new Error("network down"));
        const svc = new NotificationService(slackConfig(), logger);

        const result = await svc.sendHumanRequest(makePayload());

        expect(result.slack.ok).toBe(false);
        expect(result.slack.error).toBe("network down");
      });

      it("stringifies a non-Error thrown value", async () => {
        fetchMock.mockRejectedValue("totally broken");
        const svc = new NotificationService(slackConfig(), logger);

        const result = await svc.sendHumanRequest(makePayload());

        expect(result.slack.error).toBe("totally broken");
      });

      it("includes a Plan confidence field only when planConfidence is set", async () => {
        fetchMock.mockResolvedValue(mockFetchResponse(true));
        const svc = new NotificationService(slackConfig(), logger);

        await svc.sendHumanRequest(makePayload({ planConfidence: 0.42 }));
        let body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
        let sectionFields = body.blocks[2].fields as { text: string }[];
        expect(sectionFields.some((f) => f.text.includes("0.42"))).toBe(true);

        fetchMock.mockClear();
        await svc.sendHumanRequest(makePayload({ planConfidence: undefined }));
        body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
        sectionFields = body.blocks[2].fields as { text: string }[];
        expect(sectionFields.some((f) => f.text.includes("Plan confidence"))).toBe(false);
      });

      it("includes an open-questions summary field and a capped questions block", async () => {
        fetchMock.mockResolvedValue(mockFetchResponse(true));
        const svc = new NotificationService(slackConfig(), logger);
        const openQuestions = [
          { id: "q1", question: "What auth method?", requiredForExecution: true },
          { id: "q2", question: "Which region?", requiredForExecution: false },
          { id: "q3", question: "Rate limit?", requiredForExecution: true },
          { id: "q4", question: "Extra one not shown", requiredForExecution: false },
        ];

        await svc.sendHumanRequest(makePayload({ openQuestions }));

        const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
        const fields = body.blocks[2].fields as { text: string }[];
        expect(fields.some((f) => f.text.includes("4 (2 required)"))).toBe(true);
        const questionsBlock = body.blocks.find(
          (b: { text?: { text: string } }) => b.text?.text.includes("*Questions:*"),
        ) as { text: { text: string } };
        expect(questionsBlock.text.text).toContain("What auth method?");
        expect(questionsBlock.text.text).not.toContain("Extra one not shown");
      });

      it("omits the open-questions blocks entirely when the list is empty", async () => {
        fetchMock.mockResolvedValue(mockFetchResponse(true));
        const svc = new NotificationService(slackConfig(), logger);

        await svc.sendHumanRequest(makePayload({ openQuestions: [] }));

        const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
        const hasQuestionsBlock = body.blocks.some((b: { text?: { text: string } }) =>
          b.text?.text.includes("*Questions:*"),
        );
        expect(hasQuestionsBlock).toBe(false);
      });

      it("includes a context block only when context is provided, truncated at 1500 chars", async () => {
        fetchMock.mockResolvedValue(mockFetchResponse(true));
        const svc = new NotificationService(slackConfig(), logger);
        const longContext = "x".repeat(2000);

        await svc.sendHumanRequest(makePayload({ context: longContext }));

        const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
        const contextBlock = body.blocks.find((b: { text?: { text: string } }) =>
          b.text?.text.includes("*Context:*"),
        ) as { text: { text: string } };
        expect(contextBlock.text.text).toContain("…");
        expect(contextBlock.text.text.length).toBeLessThan(longContext.length);
      });

      it("adds a second action button only when the Linear issue has a url", async () => {
        fetchMock.mockResolvedValue(mockFetchResponse(true));
        const svc = new NotificationService(slackConfig(), logger);

        await svc.sendHumanRequest(
          makePayload({ linearIssue: { id: "lin-1", title: "T", url: null } }),
        );
        let body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
        let actions = body.blocks.at(-1).elements as unknown[];
        expect(actions).toHaveLength(1);

        fetchMock.mockClear();
        await svc.sendHumanRequest(makePayload());
        body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
        actions = body.blocks.at(-1).elements as unknown[];
        expect(actions).toHaveLength(2);
      });

      it("falls back to the issue id when identifier is missing, and '(untitled)' when title is null", async () => {
        fetchMock.mockResolvedValue(mockFetchResponse(true));
        const svc = new NotificationService(slackConfig(), logger);

        await svc.sendHumanRequest(
          makePayload({ linearIssue: { id: "raw-id-1", title: null, url: null } }),
        );

        const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
        expect(body.text).toContain("raw-id-1");
        expect(body.text).toContain("(untitled)");
      });

      it("uses the correct reason label text for every HumanRequestReason value", async () => {
        fetchMock.mockResolvedValue(mockFetchResponse(true));
        const svc = new NotificationService(slackConfig(), logger);
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
          const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
          expect(body.text).toContain(label);
        }
      });

      it("handles response.text() itself rejecting by falling back to an empty body", async () => {
        fetchMock.mockResolvedValue({
          ok: false,
          status: 503,
          text: vi.fn().mockRejectedValue(new Error("stream closed")),
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any);
        const svc = new NotificationService(slackConfig(), logger);

        const result = await svc.sendHumanRequest(makePayload());

        expect(result.slack.ok).toBe(false);
        expect(result.slack.error).toContain("503");
      });
    });

    describe("email channel", () => {
      function emailConfig(overrides: Partial<NotificationConfig> = {}): NotificationConfig {
        return {
          emailFrom: "bot@example.com",
          emailTo: "a@example.com, b@example.com",
          resendApiKey: "resend-key",
          ...overrides,
        };
      }

      it("posts to the Resend API with trimmed, split recipients on success", async () => {
        fetchMock.mockResolvedValue(mockFetchResponse(true));
        const svc = new NotificationService(emailConfig(), logger);

        const result = await svc.sendHumanRequest(makePayload());

        expect(result.email).toEqual({ attempted: true, ok: true });
        expect(fetchMock).toHaveBeenCalledWith(
          "https://api.resend.com/emails",
          expect.objectContaining({
            method: "POST",
            headers: expect.objectContaining({ Authorization: "Bearer resend-key" }),
          }),
        );
        const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
        expect(body.to).toEqual(["a@example.com", "b@example.com"]);
        expect(body.from).toBe("bot@example.com");
        expect(body.subject).toContain("[AgentForge]");
        expect(body.html).toContain("<html>");
        expect(body.text).not.toContain("<html>");
      });

      it("drops empty entries when splitting the recipient list", async () => {
        fetchMock.mockResolvedValue(mockFetchResponse(true));
        const svc = new NotificationService(emailConfig({ emailTo: "a@example.com, ,  " }), logger);

        await svc.sendHumanRequest(makePayload());

        const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
        expect(body.to).toEqual(["a@example.com"]);
      });

      it("records an error and logs a warning when Resend responds non-ok", async () => {
        fetchMock.mockResolvedValue(mockFetchResponse(false, 422, "invalid from address"));
        const svc = new NotificationService(emailConfig(), logger);

        const result = await svc.sendHumanRequest(makePayload());

        expect(result.email.ok).toBe(false);
        expect(result.email.error).toContain("422");
        expect(logger.warn).toHaveBeenCalled();
      });

      it("handles a thrown network error", async () => {
        fetchMock.mockRejectedValue(new Error("DNS failure"));
        const svc = new NotificationService(emailConfig(), logger);

        const result = await svc.sendHumanRequest(makePayload());

        expect(result.email.ok).toBe(false);
        expect(result.email.error).toBe("DNS failure");
      });

      it("stringifies a non-Error thrown value", async () => {
        fetchMock.mockRejectedValue("totally broken");
        const svc = new NotificationService(emailConfig(), logger);

        const result = await svc.sendHumanRequest(makePayload());

        expect(result.email.error).toBe("totally broken");
      });

      it("escapes HTML-significant characters in summary/title/context", async () => {
        fetchMock.mockResolvedValue(mockFetchResponse(true));
        const svc = new NotificationService(emailConfig(), logger);

        await svc.sendHumanRequest(
          makePayload({
            summary: `<script>alert("x")</script>`,
            linearIssue: { id: "lin-1", title: "A & B <tag>", url: null },
          }),
        );

        const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
        expect(body.html).not.toContain("<script>alert");
        expect(body.html).toContain("&lt;script&gt;");
        expect(body.html).toContain("A &amp; B &lt;tag&gt;");
      });

      it("includes plan confidence, context, open questions, and the Linear link when present", async () => {
        fetchMock.mockResolvedValue(mockFetchResponse(true));
        const svc = new NotificationService(emailConfig(), logger);

        await svc.sendHumanRequest(
          makePayload({
            planConfidence: 0.83,
            context: "some context",
            openQuestions: [
              { id: "q1", question: "Which env?", requiredForExecution: true },
              { id: "q2", question: "Optional detail?", requiredForExecution: false },
            ],
            linearIssue: {
              id: "lin-1",
              title: "T",
              url: "https://linear.app/team/issue/ENG-1",
            },
          }),
        );

        const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
        expect(body.html).toContain("0.83");
        expect(body.html).toContain("some context");
        expect(body.html).toContain("Which env?");
        expect(body.html).toContain("Optional detail?");
        expect(body.html).toContain("<strong>[required]</strong>");
        expect(body.html).toContain("linear.app/team/issue/ENG-1");
        expect(body.text).toContain("0.83");
        expect(body.text).toContain("some context");
        expect(body.text).toContain("[required] Which env?");
        expect(body.text).toContain("Optional detail?");
        expect(body.text).not.toContain("[required] Optional detail?");
        expect(body.text).toContain("linear.app/team/issue/ENG-1");
      });

      it("omits optional sections from both html and text when absent", async () => {
        fetchMock.mockResolvedValue(mockFetchResponse(true));
        const svc = new NotificationService(emailConfig(), logger);

        await svc.sendHumanRequest(
          makePayload({
            planConfidence: undefined,
            context: undefined,
            openQuestions: undefined,
            linearIssue: { id: "lin-1", title: null, url: null },
          }),
        );

        const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
        expect(body.html).not.toContain("Plan confidence:");
        expect(body.text).not.toContain("Plan confidence:");
        expect(body.text).not.toContain("Linear:");
      });
    });

    it("attempts and sends both channels concurrently when both are configured", async () => {
      fetchMock.mockResolvedValue(mockFetchResponse(true));
      const svc = new NotificationService(
        {
          emailFrom: "bot@example.com",
          emailTo: "a@example.com",
          resendApiKey: "key",
          slackWebhookUrl: "https://hooks.slack.com/x",
        },
        logger,
      );

      const result = await svc.sendHumanRequest(makePayload());

      expect(result).toEqual({
        slack: { attempted: true, ok: true },
        email: { attempted: true, ok: true },
      });
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });
  });
});
