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
    summary: "The plan has ambiguous requirements.",
    linearIssue: {
      id: "lin-1",
      identifier: "PRY-42",
      title: "Add validation",
      url: "https://linear.app/team/issue/PRY-42",
    },
    runState: "AwaitingPlanApproval",
    runUrl: "https://app.example.com/runs/run-1",
    ...overrides,
  };
}

function okResponse(): Response {
  return { ok: true, status: 200, text: () => Promise.resolve("") } as unknown as Response;
}

function errorResponse(status: number, body: string): Response {
  return { ok: false, status, text: () => Promise.resolve(body) } as unknown as Response;
}

describe("NotificationService", () => {
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

  describe("isConfigured", () => {
    it("is false with no config at all", () => {
      const svc = new NotificationService({ emailFrom: "bot@example.com" }, logger as never);
      expect(svc.isConfigured()).toBe(false);
    });

    it("is true when a slack webhook url is set", () => {
      const svc = new NotificationService(
        { emailFrom: "bot@example.com", slackWebhookUrl: "https://hooks.slack.com/x" },
        logger as never,
      );
      expect(svc.isConfigured()).toBe(true);
    });

    it("is true when both emailTo and resendApiKey are set", () => {
      const svc = new NotificationService(
        { emailFrom: "bot@example.com", emailTo: "a@b.com", resendApiKey: "key" },
        logger as never,
      );
      expect(svc.isConfigured()).toBe(true);
    });

    it("is false when only emailTo is set without an API key", () => {
      const svc = new NotificationService(
        { emailFrom: "bot@example.com", emailTo: "a@b.com" },
        logger as never,
      );
      expect(svc.isConfigured()).toBe(false);
    });
  });

  describe("sendHumanRequest", () => {
    function configFull(): NotificationConfig {
      return {
        emailFrom: "bot@example.com",
        emailTo: "dev@example.com, lead@example.com,",
        resendApiKey: "resend-key",
        slackWebhookUrl: "https://hooks.slack.com/services/x",
      };
    }

    it("does nothing (no fetch calls) when no channels are configured", async () => {
      const svc = new NotificationService({ emailFrom: "bot@example.com" }, logger as never);
      const result = await svc.sendHumanRequest(makePayload());
      expect(result).toEqual({
        slack: { attempted: false, ok: false },
        email: { attempted: false, ok: false },
      });
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("sends a Slack message with the expected URL, method, headers and blocks", async () => {
      fetchMock.mockResolvedValue(okResponse());
      const svc = new NotificationService(
        { emailFrom: "bot@example.com", slackWebhookUrl: "https://hooks.slack.com/services/x" },
        logger as never,
      );

      const result = await svc.sendHumanRequest(
        makePayload({
          planConfidence: 0.42,
          context: "Some extra context",
          openQuestions: [
            { id: "q1", question: "Is this required?", requiredForExecution: true },
            { id: "q2", question: "Optional detail?", requiredForExecution: false },
          ],
        }),
      );

      expect(result.slack).toEqual({ attempted: true, ok: true });
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe("https://hooks.slack.com/services/x");
      expect(init.method).toBe("POST");
      expect(init.headers).toEqual({ "Content-Type": "application/json" });

      const body = JSON.parse(init.body as string);
      expect(body.text).toContain("PRY-42");
      expect(body.text).toContain("Plan needs review (ambiguous)");

      const header = body.blocks.find((b: { type: string }) => b.type === "header");
      expect(header.text.text).toBe(body.text);

      const fieldsSection = body.blocks.find(
        (b: { type: string; fields?: unknown }) => b.type === "section" && b.fields,
      );
      const fieldTexts = fieldsSection.fields.map((f: { text: string }) => f.text);
      expect(fieldTexts).toContain("*State:*\nAwaitingPlanApproval");
      expect(fieldTexts).toContain("*Plan confidence:*\n0.42");
      expect(fieldTexts.some((t: string) => t.includes("*Open questions:*\n2 (1 required)"))).toBe(
        true,
      );

      const contextSection = body.blocks.find(
        (b: { text?: { text: string } }) => b.text?.text.includes("*Context:*"),
      );
      expect(contextSection.text.text).toContain("Some extra context");

      const questionsSection = body.blocks.find((b: { text?: { text: string } }) =>
        b.text?.text.startsWith("*Questions:*"),
      );
      expect(questionsSection.text.text).toContain("[required] Is this required?");
      expect(questionsSection.text.text).toContain("Optional detail?");

      const actions = body.blocks.find((b: { type: string }) => b.type === "actions");
      expect(actions.elements).toHaveLength(2);
      expect(actions.elements[1].url).toBe("https://linear.app/team/issue/PRY-42");
    });

    it("omits the Linear button and optional sections when fields are absent", async () => {
      fetchMock.mockResolvedValue(okResponse());
      const svc = new NotificationService(
        { emailFrom: "bot@example.com", slackWebhookUrl: "https://hooks.slack.com/services/x" },
        logger as never,
      );

      await svc.sendHumanRequest(
        makePayload({ linearIssue: { id: "lin-1", title: null, url: null } }),
      );

      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(init.body as string);
      const actions = body.blocks.find((b: { type: string }) => b.type === "actions");
      expect(actions.elements).toHaveLength(1);
      expect(body.text).toContain("(untitled)");
      expect(body.text).toContain("lin-1");
    });

    it("records a Slack failure (non-2xx response) without throwing, and logs a warning", async () => {
      fetchMock.mockResolvedValue(errorResponse(500, "server exploded"));
      const svc = new NotificationService(
        { emailFrom: "bot@example.com", slackWebhookUrl: "https://hooks.slack.com/services/x" },
        logger as never,
      );

      const result = await svc.sendHumanRequest(makePayload());

      expect(result.slack.ok).toBe(false);
      expect(result.slack.error).toContain("Slack webhook returned 500");
      expect(result.slack.error).toContain("server exploded");
      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ runId: "run-1" }),
        "Slack notification failed",
      );
    });

    it("records a Slack failure when fetch itself rejects (network error)", async () => {
      fetchMock.mockRejectedValue(new Error("network unreachable"));
      const svc = new NotificationService(
        { emailFrom: "bot@example.com", slackWebhookUrl: "https://hooks.slack.com/services/x" },
        logger as never,
      );

      const result = await svc.sendHumanRequest(makePayload());

      expect(result.slack.ok).toBe(false);
      expect(result.slack.error).toBe("network unreachable");
    });

    it("stringifies a non-Error Slack rejection", async () => {
      fetchMock.mockRejectedValue("DNS lookup failed");
      const svc = new NotificationService(
        { emailFrom: "bot@example.com", slackWebhookUrl: "https://hooks.slack.com/services/x" },
        logger as never,
      );

      const result = await svc.sendHumanRequest(makePayload());

      expect(result.slack.ok).toBe(false);
      expect(result.slack.error).toBe("DNS lookup failed");
      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ error: "DNS lookup failed" }),
        "Slack notification failed",
      );
    });

    it("stringifies a non-Error email rejection", async () => {
      fetchMock.mockImplementation((url: string) => {
        if (url === "https://api.resend.com/emails") {
          return Promise.reject("resend unreachable");
        }
        return Promise.resolve(okResponse());
      });
      const svc = new NotificationService(configFull(), logger as never);

      const result = await svc.sendHumanRequest(makePayload());

      expect(result.email.ok).toBe(false);
      expect(result.email.error).toBe("resend unreachable");
      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ error: "resend unreachable" }),
        "Email notification failed",
      );
    });

    it("sends an email via the Resend API with the expected URL, headers, body and recipients", async () => {
      fetchMock.mockResolvedValue(okResponse());
      const svc = new NotificationService(configFull(), logger as never);

      const result = await svc.sendHumanRequest(makePayload());

      // Slack + email: two fetch calls.
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(result.email).toEqual({ attempted: true, ok: true });

      const emailCall = fetchMock.mock.calls.find(
        (c) => c[0] === "https://api.resend.com/emails",
      ) as [string, RequestInit];
      expect(emailCall).toBeDefined();
      const [, init] = emailCall;
      expect(init.method).toBe("POST");
      expect(init.headers).toEqual({
        Authorization: "Bearer resend-key",
        "Content-Type": "application/json",
      });

      const body = JSON.parse(init.body as string);
      expect(body.from).toBe("bot@example.com");
      // Trailing empty entry from the comma-separated list must be filtered out.
      expect(body.to).toEqual(["dev@example.com", "lead@example.com"]);
      expect(body.subject).toContain("PRY-42");
      expect(body.html).toContain("Add validation");
      expect(body.text).toContain("Add validation");
    });

    it("includes plan confidence, context and open questions in the plain-text email body", async () => {
      fetchMock.mockResolvedValue(okResponse());
      const svc = new NotificationService(configFull(), logger as never);

      await svc.sendHumanRequest(
        makePayload({
          planConfidence: 0.65,
          context: "Extra background for reviewers",
          openQuestions: [
            { id: "q1", question: "Should we use OAuth?", requiredForExecution: true },
            { id: "q2", question: "Rate limit needed?", requiredForExecution: false },
          ],
        }),
      );

      const emailCall = fetchMock.mock.calls.find(
        (c) => c[0] === "https://api.resend.com/emails",
      ) as [string, RequestInit];
      const body = JSON.parse(emailCall[1].body as string);

      expect(body.text).toContain("Plan confidence: 0.65");
      expect(body.text).toContain("Context:");
      expect(body.text).toContain("Extra background for reviewers");
      expect(body.text).toContain("Open questions:");
      expect(body.text).toContain("- [required] Should we use OAuth?");
      expect(body.text).toContain("- Rate limit needed?");
      expect(body.text).toContain("Linear: https://linear.app/team/issue/PRY-42");

      expect(body.html).toContain("Plan confidence:");
      expect(body.html).toContain("Extra background for reviewers");
      expect(body.html).toContain("[required]");
    });

    it("omits plan confidence, context, open-questions and the Linear link from the text body when absent", async () => {
      fetchMock.mockResolvedValue(okResponse());
      const svc = new NotificationService(configFull(), logger as never);

      await svc.sendHumanRequest(makePayload({ linearIssue: { id: "lin-1", title: "T", url: undefined } }));

      const emailCall = fetchMock.mock.calls.find(
        (c) => c[0] === "https://api.resend.com/emails",
      ) as [string, RequestInit];
      const body = JSON.parse(emailCall[1].body as string);

      expect(body.text).not.toContain("Plan confidence:");
      expect(body.text).not.toContain("Context:");
      expect(body.text).not.toContain("Open questions:");
      expect(body.text).not.toContain("Linear:");
    });

    it("escapes HTML-significant characters in the rendered email body", async () => {
      fetchMock.mockResolvedValue(okResponse());
      const svc = new NotificationService(configFull(), logger as never);

      await svc.sendHumanRequest(
        makePayload({ summary: "<script>alert('x')</script> & more" }),
      );

      const emailCall = fetchMock.mock.calls.find(
        (c) => c[0] === "https://api.resend.com/emails",
      ) as [string, RequestInit];
      const body = JSON.parse(emailCall[1].body as string);
      expect(body.html).not.toContain("<script>alert");
      expect(body.html).toContain("&lt;script&gt;");
      expect(body.html).toContain("&amp;");
    });

    it("falls back to '(untitled)' in the subject/html/text and truncates very long context", async () => {
      fetchMock.mockResolvedValue(okResponse());
      const svc = new NotificationService(configFull(), logger as never);
      const longContext = "x".repeat(2100);

      await svc.sendHumanRequest(
        makePayload({
          linearIssue: { id: "lin-1", identifier: "PRY-42", title: null, url: null },
          context: longContext,
        }),
      );

      const emailCall = fetchMock.mock.calls.find(
        (c) => c[0] === "https://api.resend.com/emails",
      ) as [string, RequestInit];
      const body = JSON.parse(emailCall[1].body as string);

      expect(body.subject).toContain("(untitled)");
      expect(body.html).toContain("(untitled)");
      expect(body.text).toContain("(untitled)");

      // Truncated to max-1 (1999) chars plus an ellipsis in both renderings.
      expect(body.html).not.toContain(longContext);
      expect(body.html).toContain("x".repeat(1999) + "…");
      expect(body.text).not.toContain(longContext);
      expect(body.text).toContain("x".repeat(1999) + "…");
    });

    it("records an email failure (non-2xx response) without throwing, independent of Slack", async () => {
      fetchMock.mockImplementation((url: string) => {
        if (url === "https://api.resend.com/emails") {
          return Promise.resolve(errorResponse(422, "invalid recipient"));
        }
        return Promise.resolve(okResponse());
      });
      const svc = new NotificationService(configFull(), logger as never);

      const result = await svc.sendHumanRequest(makePayload());

      expect(result.slack.ok).toBe(true);
      expect(result.email.ok).toBe(false);
      expect(result.email.error).toContain("Resend returned 422");
      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ runId: "run-1" }),
        "Email notification failed",
      );
    });

    it("falls back to an empty error body when response.text() itself rejects", async () => {
      const response = {
        ok: false,
        status: 500,
        text: () => Promise.reject(new Error("stream closed")),
      } as unknown as Response;
      fetchMock.mockResolvedValue(response);
      const svc = new NotificationService(
        { emailFrom: "bot@example.com", slackWebhookUrl: "https://hooks.slack.com/services/x" },
        logger as never,
      );

      const result = await svc.sendHumanRequest(makePayload());

      expect(result.slack.error).toBe("Slack webhook returned 500: ");
    });

    it("reflects every reason into a distinct, human-readable label", async () => {
      fetchMock.mockResolvedValue(okResponse());
      const svc = new NotificationService(configFull(), logger as never);

      const expectations: Record<NotificationPayload["reason"], string> = {
        plan_ambiguous: "Plan needs review (ambiguous)",
        plan_low_confidence: "Plan needs review (low confidence)",
        impl_rejected: "Implementation needs review (rejected by agent)",
        impl_uncertain: "Implementation needs review (uncertain)",
        other: "Human intervention requested",
      };

      for (const [reason, label] of Object.entries(expectations)) {
        fetchMock.mockClear();
        await svc.sendHumanRequest(makePayload({ reason: reason as NotificationPayload["reason"] }));
        const emailCall = fetchMock.mock.calls.find(
          (c) => c[0] === "https://api.resend.com/emails",
        ) as [string, RequestInit];
        const body = JSON.parse(emailCall[1].body as string);
        expect(body.subject).toContain(label);
      }
    });
  });
});
