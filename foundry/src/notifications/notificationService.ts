import type { Logger } from "../utils/logger.js";

export type HumanRequestReason =
  | "plan_ambiguous"
  | "plan_low_confidence"
  | "impl_rejected"
  | "impl_uncertain"
  | "other";

export interface NotificationPayload {
  runId: string;
  reason: HumanRequestReason;
  summary: string;
  context?: string;
  linearIssue: {
    id: string;
    identifier?: string;
    title: string | null;
    url: string | null;
  };
  runState: string;
  runUrl: string;
  planConfidence?: number;
  openQuestions?: { id: string; question: string; requiredForExecution: boolean }[];
}

export interface NotificationConfig {
  emailTo?: string;
  emailFrom: string;
  slackWebhookUrl?: string;
  resendApiKey?: string;
}

export interface NotificationResult {
  slack: { attempted: boolean; ok: boolean; error?: string };
  email: { attempted: boolean; ok: boolean; error?: string };
}

export class NotificationService {
  constructor(
    private readonly config: NotificationConfig,
    private readonly logger: Logger,
  ) {}

  isConfigured(): boolean {
    return Boolean(
      this.config.slackWebhookUrl || (this.config.emailTo && this.config.resendApiKey),
    );
  }

  async sendHumanRequest(payload: NotificationPayload): Promise<NotificationResult> {
    const result: NotificationResult = {
      slack: { attempted: false, ok: false },
      email: { attempted: false, ok: false },
    };

    const jobs: Promise<void>[] = [];

    if (this.config.slackWebhookUrl) {
      result.slack.attempted = true;
      jobs.push(
        this.sendSlack(this.config.slackWebhookUrl, payload)
          .then(() => {
            result.slack.ok = true;
          })
          .catch((err: unknown) => {
            result.slack.error = err instanceof Error ? err.message : String(err);
            this.logger.warn(
              { runId: payload.runId, error: result.slack.error },
              "Slack notification failed",
            );
          }),
      );
    }

    if (this.config.emailTo && this.config.resendApiKey) {
      result.email.attempted = true;
      jobs.push(
        this.sendEmail(
          this.config.resendApiKey,
          this.config.emailFrom,
          this.config.emailTo,
          payload,
        )
          .then(() => {
            result.email.ok = true;
          })
          .catch((err: unknown) => {
            result.email.error = err instanceof Error ? err.message : String(err);
            this.logger.warn(
              { runId: payload.runId, error: result.email.error },
              "Email notification failed",
            );
          }),
      );
    }

    await Promise.all(jobs);
    return result;
  }

  private async sendSlack(webhookUrl: string, payload: NotificationPayload): Promise<void> {
    const issueLabel = payload.linearIssue.identifier ?? payload.linearIssue.id;
    const title = `${reasonLabel(payload.reason)} — ${issueLabel}: ${payload.linearIssue.title ?? "(untitled)"}`;

    const fields: { type: "mrkdwn"; text: string }[] = [
      { type: "mrkdwn", text: `*State:*\n${payload.runState}` },
    ];
    if (payload.planConfidence !== undefined) {
      fields.push({
        type: "mrkdwn",
        text: `*Plan confidence:*\n${payload.planConfidence.toFixed(2)}`,
      });
    }
    if (payload.openQuestions && payload.openQuestions.length > 0) {
      const required = payload.openQuestions.filter((q) => q.requiredForExecution).length;
      fields.push({
        type: "mrkdwn",
        text: `*Open questions:*\n${payload.openQuestions.length} (${required} required)`,
      });
    }

    const blocks: unknown[] = [
      { type: "header", text: { type: "plain_text", text: title } },
      { type: "section", text: { type: "mrkdwn", text: payload.summary } },
      { type: "section", fields },
    ];

    if (payload.context) {
      blocks.push({
        type: "section",
        text: { type: "mrkdwn", text: `*Context:*\n${truncate(payload.context, 1500)}` },
      });
    }

    if (payload.openQuestions && payload.openQuestions.length > 0) {
      const lines = payload.openQuestions
        .slice(0, 3)
        .map(
          (q) => `• ${q.requiredForExecution ? "[required] " : ""}${truncate(q.question, 200)}`,
        )
        .join("\n");
      blocks.push({
        type: "section",
        text: { type: "mrkdwn", text: `*Questions:*\n${lines}` },
      });
    }

    const actionElements: unknown[] = [
      {
        type: "button",
        text: { type: "plain_text", text: "Open run" },
        url: payload.runUrl,
      },
    ];
    if (payload.linearIssue.url) {
      actionElements.push({
        type: "button",
        text: { type: "plain_text", text: "Open Linear issue" },
        url: payload.linearIssue.url,
      });
    }
    blocks.push({ type: "actions", elements: actionElements });

    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: title, blocks }),
    });
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(`Slack webhook returned ${response.status}: ${body.slice(0, 200)}`);
    }
  }

  private async sendEmail(
    apiKey: string,
    from: string,
    to: string,
    payload: NotificationPayload,
  ): Promise<void> {
    const issueLabel = payload.linearIssue.identifier ?? payload.linearIssue.id;
    const subject = `[AgentForge] ${reasonLabel(payload.reason)} — ${issueLabel}: ${payload.linearIssue.title ?? "(untitled)"}`;
    const html = renderEmailHtml(payload);
    const text = renderEmailText(payload);

    const recipients = to
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ from, to: recipients, subject, html, text }),
    });
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(`Resend returned ${response.status}: ${body.slice(0, 200)}`);
    }
  }
}

function reasonLabel(reason: HumanRequestReason): string {
  switch (reason) {
    case "plan_ambiguous":
      return "Plan needs review (ambiguous)";
    case "plan_low_confidence":
      return "Plan needs review (low confidence)";
    case "impl_rejected":
      return "Implementation needs review (rejected by agent)";
    case "impl_uncertain":
      return "Implementation needs review (uncertain)";
    case "other":
      return "Human intervention requested";
  }
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max - 1)}…`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderEmailHtml(p: NotificationPayload): string {
  const issueLabel = p.linearIssue.identifier ?? p.linearIssue.id;
  const questionsBlock =
    p.openQuestions && p.openQuestions.length > 0
      ? `<p><strong>Open questions:</strong></p><ul>${p.openQuestions
          .slice(0, 5)
          .map(
            (q) =>
              `<li>${q.requiredForExecution ? "<strong>[required]</strong> " : ""}${escapeHtml(q.question)}</li>`,
          )
          .join("")}</ul>`
      : "";
  const contextBlock = p.context
    ? `<p><strong>Context:</strong></p><pre style="white-space:pre-wrap;background:#f6f6f6;padding:12px;border-radius:6px;">${escapeHtml(truncate(p.context, 2000))}</pre>`
    : "";
  const confidenceLine =
    p.planConfidence !== undefined
      ? `<p><strong>Plan confidence:</strong> ${p.planConfidence.toFixed(2)}</p>`
      : "";
  const linearLink = p.linearIssue.url
    ? `<a href="${escapeHtml(p.linearIssue.url)}">Open Linear issue</a>`
    : "";
  return `<!doctype html>
<html><body style="font-family:-apple-system,Segoe UI,sans-serif;color:#222;max-width:640px;margin:0 auto;padding:24px;">
  <h2 style="margin-top:0;">${escapeHtml(reasonLabel(p.reason))}</h2>
  <p><strong>${escapeHtml(issueLabel)}:</strong> ${escapeHtml(p.linearIssue.title ?? "(untitled)")}</p>
  <p><strong>State:</strong> ${escapeHtml(p.runState)}</p>
  ${confidenceLine}
  <p>${escapeHtml(p.summary)}</p>
  ${contextBlock}
  ${questionsBlock}
  <p style="margin-top:24px;">
    <a href="${escapeHtml(p.runUrl)}" style="background:#2563eb;color:white;padding:10px 16px;border-radius:6px;text-decoration:none;">Open run</a>
    ${linearLink ? `&nbsp;&nbsp;${linearLink}` : ""}
  </p>
</body></html>`;
}

function renderEmailText(p: NotificationPayload): string {
  const issueLabel = p.linearIssue.identifier ?? p.linearIssue.id;
  const lines = [
    reasonLabel(p.reason),
    `${issueLabel}: ${p.linearIssue.title ?? "(untitled)"}`,
    `State: ${p.runState}`,
  ];
  if (p.planConfidence !== undefined) {
    lines.push(`Plan confidence: ${p.planConfidence.toFixed(2)}`);
  }
  lines.push("", p.summary);
  if (p.context) {
    lines.push("", "Context:", truncate(p.context, 2000));
  }
  if (p.openQuestions && p.openQuestions.length > 0) {
    lines.push("", "Open questions:");
    for (const q of p.openQuestions.slice(0, 5)) {
      lines.push(`- ${q.requiredForExecution ? "[required] " : ""}${q.question}`);
    }
  }
  lines.push("", `Run: ${p.runUrl}`);
  if (p.linearIssue.url) lines.push(`Linear: ${p.linearIssue.url}`);
  return lines.join("\n");
}
