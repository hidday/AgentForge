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
    summary: "Needs human input",
    linearIssue: {
      id: "issue-1",
      identifier: "PRY-1",
      title: "Do the thing",
      url: "https://linear.app/team/issue/PRY-1",
    },
    runState: "AwaitingPlanApproval",
    runUrl: "https://app.example.com/runs/run-1",
    ...overrides,
  };
}

function okResponse(): Response {
  return { ok: true, status: 200, text: () => Promise.resolve("") } as unknown as Response;
}

function failResponse(status: number, body: string): Response {
  return { ok: false, status, text: () => Promise.resolve(body) } as unknown as Response;
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
    it("is false when nothing is configured", () => {
      const svc = new NotificationService(
        { emailFrom: "noreply@example.com" } as NotificationConfig,
        makeLogger() as never,
      );
      expect(svc.isConfigured()).toBe(false);
    });

    it("is true when a slack webhook is configured", () => {
      const svc = new NotificationService(
        { emailFrom: "noreply@example.com", slackWebhookUrl: "https://hooks.slack.example/x" },
        makeLogger() as never,
      );
      expect(svc.isConfigured()).toBe(true);
    });

    it("is true when both emailTo and resendApiKey are configured", () => {
      const svc = new NotificationService(
        { emailFrom: "noreply@example.com", emailTo: "a@example.com", resendApiKey: "key" },
        makeLogger() as never,
      );
      expect(svc.isConfigured()).toBe(true);
    });

    it("is false when only emailTo is set without an API key", () => {
      const svc = new NotificationService(
        { emailFrom: "noreply@example.com", emailTo: "a@example.com" },
        makeLogger() as never,
      );
      expect(svc.isConfigured()).toBe(false);
    });
  });

  describe("sendHumanRequest", () => {
    it("attempts neither channel when nothing is configured", async () => {
      const svc = new NotificationService(
        { emailFrom: "noreply@example.com" },
        makeLogger() as never,
      );

      const result = await svc.sendHumanRequest(makePayload());

      expect(result).toEqual({
        slack: { attempted: false, ok: false },
        email: { attempted: false, ok: false },
      });
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("sends a slack message and reports success", async () => {
      fetchMock.mockResolvedValue(okResponse());
      const svc = new NotificationService(
        { emailFrom: "noreply@example.com", slackWebhookUrl: "https://hooks.slack.example/x" },
        makeLogger() as never,
      );

      const result = await svc.sendHumanRequest(makePayload());

      expect(result.slack).toEqual({ attempted: true, ok: true });
      expect(result.email).toEqual({ attempted: false, ok: false });
      expect(fetchMock).toHaveBeenCalledWith(
        "https://hooks.slack.example/x",
        expect.objectContaining({ method: "POST" }),
      );
      const body = JSON.parse(fetchMock.mock.calls[0][1].body as string) as { blocks: unknown[] };
      expect(body.blocks.length).toBeGreaterThan(0);
    });

    it("records a slack failure without throwing, and logs a warning", async () => {
      fetchMock.mockResolvedValue(failResponse(500, "server exploded"));
      const logger = makeLogger();
      const svc = new NotificationService(
        { emailFrom: "noreply@example.com", slackWebhookUrl: "https://hooks.slack.example/x" },
        logger as never,
      );

      const result = await svc.sendHumanRequest(makePayload());

      expect(result.slack.attempted).toBe(true);
      expect(result.slack.ok).toBe(false);
      expect(result.slack.error).toContain("500");
      expect(logger.warn).toHaveBeenCalled();
    });

    it("records a slack network failure (fetch rejects)", async () => {
      fetchMock.mockRejectedValue(new Error("network down"));
      const svc = new NotificationService(
        { emailFrom: "noreply@example.com", slackWebhookUrl: "https://hooks.slack.example/x" },
        makeLogger() as never,
      );

      const result = await svc.sendHumanRequest(makePayload());

      expect(result.slack.ok).toBe(false);
      expect(result.slack.error).toBe("network down");
    });

    it("stringifies a non-Error slack rejection", async () => {
      fetchMock.mockRejectedValue("raw string rejection");
      const svc = new NotificationService(
        { emailFrom: "noreply@example.com", slackWebhookUrl: "https://hooks.slack.example/x" },
        makeLogger() as never,
      );

      const result = await svc.sendHumanRequest(makePayload());

      expect(result.slack.error).toBe("raw string rejection");
    });

    it("stringifies a non-Error email rejection", async () => {
      fetchMock.mockRejectedValue("raw string rejection");
      const svc = new NotificationService(
        { emailFrom: "noreply@example.com", emailTo: "a@example.com", resendApiKey: "key" },
        makeLogger() as never,
      );

      const result = await svc.sendHumanRequest(makePayload());

      expect(result.email.error).toBe("raw string rejection");
    });

    it("sends an email and reports success", async () => {
      fetchMock.mockResolvedValue(okResponse());
      const svc = new NotificationService(
        { emailFrom: "noreply@example.com", emailTo: "a@example.com,b@example.com", resendApiKey: "key" },
        makeLogger() as never,
      );

      const result = await svc.sendHumanRequest(makePayload());

      expect(result.email).toEqual({ attempted: true, ok: true });
      expect(fetchMock).toHaveBeenCalledWith(
        "https://api.resend.com/emails",
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({ Authorization: "Bearer key" }),
        }),
      );
      const body = JSON.parse(fetchMock.mock.calls[0][1].body as string) as { to: string[] };
      expect(body.to).toEqual(["a@example.com", "b@example.com"]);
    });

    it("records an email failure without throwing", async () => {
      fetchMock.mockResolvedValue(failResponse(422, "invalid recipient"));
      const logger = makeLogger();
      const svc = new NotificationService(
        { emailFrom: "noreply@example.com", emailTo: "a@example.com", resendApiKey: "key" },
        logger as never,
      );

      const result = await svc.sendHumanRequest(makePayload());

      expect(result.email.ok).toBe(false);
      expect(result.email.error).toContain("422");
      expect(logger.warn).toHaveBeenCalled();
    });

    it("sends both slack and email concurrently when both are configured", async () => {
      fetchMock.mockResolvedValue(okResponse());
      const svc = new NotificationService(
        {
          emailFrom: "noreply@example.com",
          emailTo: "a@example.com",
          resendApiKey: "key",
          slackWebhookUrl: "https://hooks.slack.example/x",
        },
        makeLogger() as never,
      );

      const result = await svc.sendHumanRequest(makePayload());

      expect(result.slack.ok).toBe(true);
      expect(result.email.ok).toBe(true);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it("includes plan confidence and open questions in the slack payload", async () => {
      fetchMock.mockResolvedValue(okResponse());
      const svc = new NotificationService(
        { emailFrom: "noreply@example.com", slackWebhookUrl: "https://hooks.slack.example/x" },
        makeLogger() as never,
      );

      await svc.sendHumanRequest(
        makePayload({
          planConfidence: 0.42,
          context: "x".repeat(2000),
          openQuestions: [
            { id: "q1", question: "y".repeat(300), requiredForExecution: true },
            { id: "q2", question: "Second question", requiredForExecution: false },
            { id: "q3", question: "Third question", requiredForExecution: false },
            { id: "q4", question: "Fourth question (should be dropped from list)", requiredForExecution: false },
          ],
        }),
      );

      const body = JSON.parse(fetchMock.mock.calls[0][1].body as string) as {
        blocks: { type: string; text?: { text: string }; fields?: { text: string }[] }[];
      };
      const serialized = JSON.stringify(body);
      expect(serialized).toContain("0.42");
      expect(serialized).toContain("[required]");
      // Long question text is truncated with an ellipsis.
      expect(serialized).toContain("…");
      // Only the first 3 open questions render as bullet lines.
      expect(serialized).not.toContain("Fourth question");
      // Long context is truncated to 1500 chars.
      const contextBlock = body.blocks.find((b) => b.text?.text.includes("*Context:*"));
      expect(contextBlock?.text?.text.length).toBeLessThan(1600);
    });

    it("omits the actions button for the Linear issue when no url is present", async () => {
      fetchMock.mockResolvedValue(okResponse());
      const svc = new NotificationService(
        { emailFrom: "noreply@example.com", slackWebhookUrl: "https://hooks.slack.example/x" },
        makeLogger() as never,
      );

      await svc.sendHumanRequest(
        makePayload({ linearIssue: { id: "issue-1", title: null, url: null } }),
      );

      const body = JSON.parse(fetchMock.mock.calls[0][1].body as string) as {
        blocks: { type: string; elements?: { text: { text: string } }[] }[];
      };
      const actionsBlock = body.blocks.find((b) => b.type === "actions");
      expect(actionsBlock?.elements).toHaveLength(1);
      expect(actionsBlock?.elements?.[0].text.text).toBe("Open run");
      expect(JSON.stringify(body)).toContain("(untitled)");
    });

    it("renders escaped HTML and truncated context/questions in the email body", async () => {
      fetchMock.mockResolvedValue(okResponse());
      const svc = new NotificationService(
        { emailFrom: "noreply@example.com", emailTo: "a@example.com", resendApiKey: "key" },
        makeLogger() as never,
      );

      await svc.sendHumanRequest(
        makePayload({
          reason: "impl_rejected",
          summary: "Rejected <script>alert(1)</script>",
          planConfidence: 0.5,
          context: "y".repeat(2500),
          linearIssue: {
            id: "issue-1",
            identifier: "PRY-2",
            title: `Title with "quotes" & <tags>`,
            url: "https://linear.app/x",
          },
          openQuestions: Array.from({ length: 6 }, (_, i) => ({
            id: `q${String(i)}`,
            question: `Question ${String(i)}`,
            requiredForExecution: i === 0,
          })),
        }),
      );

      const body = JSON.parse(fetchMock.mock.calls[0][1].body as string) as {
        html: string;
        text: string;
        subject: string;
      };
      expect(body.subject).toContain("Implementation needs review (rejected by agent)");
      expect(body.html).toContain("&lt;script&gt;");
      expect(body.html).not.toContain("<script>alert(1)</script>");
      expect(body.html).toContain("&quot;quotes&quot;");
      expect(body.html).toContain("Plan confidence");
      // Only the first 5 open questions are rendered in HTML.
      expect(body.html).toContain("Question 4");
      expect(body.html).not.toContain("Question 5");
      expect(body.html).toContain("…");
      expect(body.text).toContain("Open questions:");
      expect(body.text).toContain("[required]");
      expect(body.text).toContain("Linear: https://linear.app/x");
    });

    it("omits confidence/context/questions blocks and the linear link when absent from the email body", async () => {
      fetchMock.mockResolvedValue(okResponse());
      const svc = new NotificationService(
        { emailFrom: "noreply@example.com", emailTo: "a@example.com", resendApiKey: "key" },
        makeLogger() as never,
      );

      await svc.sendHumanRequest(
        makePayload({
          reason: "other",
          linearIssue: { id: "issue-1", title: null, url: null },
        }),
      );

      const body = JSON.parse(fetchMock.mock.calls[0][1].body as string) as {
        html: string;
        text: string;
      };
      expect(body.html).toContain("(untitled)");
      expect(body.html).not.toContain("Plan confidence");
      expect(body.text).not.toContain("Linear:");
    });

    it.each([
      ["plan_ambiguous", "Plan needs review (ambiguous)"],
      ["plan_low_confidence", "Plan needs review (low confidence)"],
      ["impl_rejected", "Implementation needs review (rejected by agent)"],
      ["impl_uncertain", "Implementation needs review (uncertain)"],
      ["other", "Human intervention requested"],
    ] as const)("maps reason %s to label %s in the slack title", async (reason, label) => {
      fetchMock.mockResolvedValue(okResponse());
      const svc = new NotificationService(
        { emailFrom: "noreply@example.com", slackWebhookUrl: "https://hooks.slack.example/x" },
        makeLogger() as never,
      );

      await svc.sendHumanRequest(makePayload({ reason }));

      const body = JSON.parse(fetchMock.mock.calls[0][1].body as string) as { text: string };
      expect(body.text).toContain(label);
    });
  });
});
