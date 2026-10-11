import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  NotificationService,
  type NotificationConfig,
  type NotificationPayload,
  type HumanRequestReason,
} from "../../src/notifications/notificationService.js";

// Closes gaps left by notificationService.test.ts: reasonLabel's switch only
// ever saw "plan_ambiguous" (the other four case branches were dead), and the
// email renderers' optional-field branches (planConfidence/context/
// openQuestions present) were only ever exercised on the Slack side, never on
// the email HTML/text bodies.

function makeLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
}

function makePayload(overrides: Partial<NotificationPayload> = {}): NotificationPayload {
  return {
    runId: "run-1",
    reason: "plan_ambiguous",
    summary: "The plan has ambiguous requirements.",
    runState: "AwaitingPlanApproval",
    runUrl: "https://foundry.example.com/runs/run-1",
    linearIssue: {
      id: "lin-1",
      identifier: "PRY-1",
      title: "Do the thing",
      url: "https://linear.app/team/issue/PRY-1",
    },
    ...overrides,
  };
}

function makeConfig(overrides: Partial<NotificationConfig> = {}): NotificationConfig {
  return {
    emailFrom: "AgentForge <onboarding@resend.dev>",
    ...overrides,
  };
}

describe("NotificationService reasonLabel branches (via email subject)", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, text: () => Promise.resolve("") });
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const cases: { reason: HumanRequestReason; expectedLabel: string }[] = [
    { reason: "plan_low_confidence", expectedLabel: "Plan needs review (low confidence)" },
    { reason: "impl_rejected", expectedLabel: "Implementation needs review (rejected by agent)" },
    { reason: "impl_uncertain", expectedLabel: "Implementation needs review (uncertain)" },
    { reason: "other", expectedLabel: "Human intervention requested" },
  ];

  it.each(cases)("renders the correct label for reason=$reason", async ({ reason, expectedLabel }) => {
    const svc = new NotificationService(
      makeConfig({ emailTo: "a@b.com", resendApiKey: "key" }),
      makeLogger() as never,
    );

    await svc.sendHumanRequest(makePayload({ reason }));

    const init = fetchMock.mock.calls[0][1];
    const body = JSON.parse(init.body as string) as { subject: string; html: string; text: string };
    expect(body.subject).toContain(expectedLabel);
    expect(body.html).toContain(expectedLabel);
    expect(body.text).toContain(expectedLabel);
  });
});

describe("NotificationService: non-Error rejection stringification", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("stringifies a non-Error Slack rejection value via String(err)", async () => {
    fetchMock.mockRejectedValue("raw slack failure string");
    const svc = new NotificationService(
      makeConfig({ slackWebhookUrl: "https://hooks.slack.com/x" }),
      makeLogger() as never,
    );

    const result = await svc.sendHumanRequest(makePayload());

    expect(result.slack.error).toBe("raw slack failure string");
  });

  it("stringifies a non-Error email rejection value via String(err)", async () => {
    fetchMock.mockRejectedValue("raw email failure string");
    const svc = new NotificationService(
      makeConfig({ emailTo: "a@b.com", resendApiKey: "key" }),
      makeLogger() as never,
    );

    const result = await svc.sendHumanRequest(makePayload());

    expect(result.email.error).toBe("raw email failure string");
  });
});

describe("NotificationService email rendering: optional-field branches", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, text: () => Promise.resolve("") });
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("includes plan confidence, context and open questions in both the HTML and text email bodies", async () => {
    const svc = new NotificationService(
      makeConfig({ emailTo: "a@b.com", resendApiKey: "key" }),
      makeLogger() as never,
    );

    await svc.sendHumanRequest(
      makePayload({
        planConfidence: 0.37,
        context: "Here is some extra context the operator should see.",
        openQuestions: [
          { id: "q1", question: "Which auth method?", requiredForExecution: true },
          { id: "q2", question: "Which environment?", requiredForExecution: false },
        ],
      }),
    );

    const init = fetchMock.mock.calls[0][1];
    const body = JSON.parse(init.body as string) as { html: string; text: string };

    expect(body.html).toContain("Plan confidence:</strong> 0.37");
    expect(body.html).toContain("Here is some extra context the operator should see.");
    expect(body.html).toContain("Open questions:");
    expect(body.html).toContain("<strong>[required]</strong>");
    expect(body.html).toContain("Which auth method?");

    expect(body.text).toContain("Plan confidence: 0.37");
    expect(body.text).toContain("Context:");
    expect(body.text).toContain("Here is some extra context the operator should see.");
    expect(body.text).toContain("Open questions:");
    expect(body.text).toContain("[required] Which auth method?");
    expect(body.text).toContain("- Which environment?");
  });

  it("caps open questions at 5 entries in the email HTML and text bodies", async () => {
    const svc = new NotificationService(
      makeConfig({ emailTo: "a@b.com", resendApiKey: "key" }),
      makeLogger() as never,
    );
    const openQuestions = Array.from({ length: 7 }, (_, i) => ({
      id: `q${i}`,
      question: `Question number ${i}`,
      requiredForExecution: false,
    }));

    await svc.sendHumanRequest(makePayload({ openQuestions }));

    const init = fetchMock.mock.calls[0][1];
    const body = JSON.parse(init.body as string) as { html: string; text: string };
    expect(body.html).toContain("Question number 4");
    expect(body.html).not.toContain("Question number 5");
    expect(body.text).toContain("Question number 4");
    expect(body.text).not.toContain("Question number 5");
  });

  it("uses '(untitled)' in the email subject, HTML and text bodies when the Linear issue has no title", async () => {
    const svc = new NotificationService(
      makeConfig({ emailTo: "a@b.com", resendApiKey: "key" }),
      makeLogger() as never,
    );

    await svc.sendHumanRequest(
      makePayload({ linearIssue: { id: "lin-1", identifier: "PRY-1", title: null, url: null } }),
    );

    const init = fetchMock.mock.calls[0][1];
    const body = JSON.parse(init.body as string) as { subject: string; html: string; text: string };
    expect(body.subject).toContain("(untitled)");
    expect(body.html).toContain("(untitled)");
    expect(body.text).toContain("(untitled)");
  });

  it("truncates an overlong context string with an ellipsis in both email and Slack bodies", async () => {
    const longContext = "y".repeat(2500);
    const svc = new NotificationService(
      makeConfig({
        emailTo: "a@b.com",
        resendApiKey: "key",
        slackWebhookUrl: "https://hooks.slack.com/x",
      }),
      makeLogger() as never,
    );

    await svc.sendHumanRequest(makePayload({ context: longContext }));

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [slackCall, emailCall] = fetchMock.mock.calls;
    const slackBody = JSON.parse((slackCall[1] as { body: string }).body) as { blocks: unknown[] };
    const slackSerialized = JSON.stringify(slackBody);
    expect(slackSerialized).toContain("y".repeat(1499) + "…");
    expect(slackSerialized).not.toContain("y".repeat(1500) + "y");

    const emailBody = JSON.parse((emailCall[1] as { body: string }).body) as {
      html: string;
      text: string;
    };
    expect(emailBody.text).toContain("y".repeat(1999) + "…");
    expect(emailBody.html).toContain("y".repeat(1999) + "…");
  });

  it("omits the Linear issue link line in the email body when linearIssue.url is absent", async () => {
    const svc = new NotificationService(
      makeConfig({ emailTo: "a@b.com", resendApiKey: "key" }),
      makeLogger() as never,
    );

    await svc.sendHumanRequest(
      makePayload({ linearIssue: { id: "lin-1", title: "T", url: null } }),
    );

    const init = fetchMock.mock.calls[0][1];
    const body = JSON.parse(init.body as string) as { html: string; text: string };
    expect(body.html).not.toContain("Open Linear issue");
    expect(body.text).not.toContain("Linear:");
  });
});
