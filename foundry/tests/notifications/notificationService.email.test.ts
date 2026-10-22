import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  NotificationService,
  type NotificationConfig,
  type NotificationPayload,
} from "../../src/notifications/notificationService.js";

function makeLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
}

function makeConfig(overrides: Partial<NotificationConfig> = {}): NotificationConfig {
  return { emailFrom: "bot@example.com", emailTo: "team@example.com", resendApiKey: "key", ...overrides };
}

function makePayload(overrides: Partial<NotificationPayload> = {}): NotificationPayload {
  return {
    runId: "run-1",
    reason: "plan_ambiguous",
    summary: "Needs a human look",
    linearIssue: { id: "issue-1", identifier: "ENG-1", title: "Add feature" },
    runState: "AwaitingPlanApproval",
    runUrl: "https://app.example.com/runs/run-1",
    ...overrides,
  };
}

describe("NotificationService email rendering", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockReset();
    fetchMock.mockResolvedValue({ ok: true });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  async function sendAndGetEmailBody(payload: NotificationPayload) {
    const svc = new NotificationService(makeConfig(), makeLogger() as never);
    await svc.sendHumanRequest(payload);
    const call = fetchMock.mock.calls.find((c) => c[0] === "https://api.resend.com/emails");
    expect(call).toBeDefined();
    return JSON.parse(call![1].body as string) as {
      subject: string;
      html: string;
      text: string;
    };
  }

  it.each([
    ["plan_low_confidence", "Plan needs review (low confidence)"],
    ["impl_rejected", "Implementation needs review (rejected by agent)"],
    ["impl_uncertain", "Implementation needs review (uncertain)"],
    ["other", "Human intervention requested"],
  ] as const)("renders the correct label for reason=%s", async (reason, expectedLabel) => {
    const body = await sendAndGetEmailBody(makePayload({ reason }));
    expect(body.subject).toContain(expectedLabel);
    expect(body.html).toContain(expectedLabel);
    expect(body.text).toContain(expectedLabel);
  });

  it("includes open questions, context, plan confidence and the Linear link when all are present", async () => {
    const body = await sendAndGetEmailBody(
      makePayload({
        linearIssue: {
          id: "issue-1",
          identifier: "ENG-1",
          title: "Add feature",
          url: "https://linear.app/team/issue/ENG-1",
        },
        planConfidence: 0.42,
        context: "Extra <context> & details",
        openQuestions: [
          { id: "q1", question: "Which provider?", requiredForExecution: true },
          { id: "q2", question: "Rate limit?", requiredForExecution: false },
        ],
      }),
    );

    expect(body.html).toContain("Open questions:");
    expect(body.html).toContain("<strong>[required]</strong> Which provider?");
    expect(body.html).toContain("Rate limit?");
    expect(body.html).toContain("Plan confidence:</strong> 0.42");
    // HTML-escaped: the raw context string contains characters that must not appear unescaped.
    expect(body.html).toContain("Extra &lt;context&gt; &amp; details");
    expect(body.html).not.toContain("Extra <context>");
    expect(body.html).toContain('href="https://linear.app/team/issue/ENG-1"');

    expect(body.text).toContain("Plan confidence: 0.42");
    expect(body.text).toContain("Context:");
    expect(body.text).toContain("Extra <context> & details");
    expect(body.text).toContain("Open questions:");
    expect(body.text).toContain("[required] Which provider?");
    expect(body.text).toContain("Linear: https://linear.app/team/issue/ENG-1");
  });

  it("omits the open questions, context, confidence and Linear-link sections when none are provided", async () => {
    const body = await sendAndGetEmailBody(
      makePayload({
        linearIssue: { id: "issue-1", title: "Add feature" },
        planConfidence: undefined,
        context: undefined,
        openQuestions: undefined,
      }),
    );

    expect(body.html).not.toContain("Open questions:");
    expect(body.html).not.toContain("Plan confidence:");
    expect(body.html).not.toContain("Context:");
    expect(body.html).not.toContain("Open Linear issue");

    expect(body.text).not.toContain("Plan confidence:");
    expect(body.text).not.toContain("Open questions:");
    expect(body.text).not.toContain("Linear:");
  });

  it("uses the issue id as the label and '(untitled)' when identifier/title are absent", async () => {
    const body = await sendAndGetEmailBody(
      makePayload({ linearIssue: { id: "issue-1", title: null as unknown as string } }),
    );

    expect(body.subject).toContain("issue-1");
    expect(body.html).toContain("(untitled)");
    expect(body.text).toContain("(untitled)");
  });
});
