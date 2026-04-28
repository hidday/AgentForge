import type { Run, Artifact } from "../domain/types.js";

const EXEC_REPORT_MAX_CHARS = 4000;

/**
 * Assembles a markdown system prompt for the chat advisor from run context.
 * Follows the section-building pattern used in plannerAgent.ts.
 */
export function buildChatSystemPrompt(run: Run, artifacts: Artifact[]): string {
  const sections: string[] = [];

  // 1. Identity / role header
  sections.push(
    `You are a helpful AI assistant for the AgentForge run \`${run.id}\`.\n` +
      `You have access to the full context of this run and can answer operator questions about it.`,
  );

  // 2. Run metadata
  const metaLines: string[] = [
    `**State:** ${run.state}`,
    `**Branch:** ${run.branchName ?? "(none)"}`,
    `**PR Number:** ${run.prNumber != null ? String(run.prNumber) : "(none)"}`,
    `**Plan Version:** ${String(run.planVersion)}`,
  ];
  sections.push(`## Run Metadata\n${metaLines.join("\n")}`);

  // 3. Linear issue
  if (run.linearIssueTitle || run.linearIssueIdentifier || run.linearIssueDescription) {
    const issueLines: string[] = [];
    if (run.linearIssueIdentifier) issueLines.push(`**Identifier:** ${run.linearIssueIdentifier}`);
    if (run.linearIssueTitle) issueLines.push(`**Title:** ${run.linearIssueTitle}`);
    if (run.linearIssueDescription)
      issueLines.push(`**Description:**\n${run.linearIssueDescription}`);
    sections.push(`## Linear Issue\n${issueLines.join("\n")}`);
  }

  // 4. Current plan (latest Plan artifact)
  const planArtifact = findLatest(artifacts, "Plan");
  if (planArtifact) {
    const plan = planArtifact.payloadJson as {
      summary?: string;
      steps?: { id?: string; title?: string; description?: string }[];
      risks?: unknown[];
      assumptions?: unknown[];
      openQuestions?: unknown[];
    };
    const planLines: string[] = [];
    if (plan.summary) planLines.push(`**Summary:** ${plan.summary}`);
    if (Array.isArray(plan.steps) && plan.steps.length > 0) {
      planLines.push(`**Steps:**`);
      for (const step of plan.steps) {
        planLines.push(`  - **${step.id ?? ""}** ${step.title ?? ""}: ${step.description ?? ""}`);
      }
    }
    if (Array.isArray(plan.risks) && plan.risks.length > 0) {
      planLines.push(`**Risks:**`);
      for (const risk of plan.risks) {
        planLines.push(`  - ${typeof risk === "string" ? risk : JSON.stringify(risk)}`);
      }
    }
    if (Array.isArray(plan.assumptions) && plan.assumptions.length > 0) {
      planLines.push(`**Assumptions:**`);
      for (const assumption of plan.assumptions) {
        planLines.push(
          `  - ${typeof assumption === "string" ? assumption : JSON.stringify(assumption)}`,
        );
      }
    }
    if (Array.isArray(plan.openQuestions) && plan.openQuestions.length > 0) {
      planLines.push(`**Open Questions:**`);
      for (const q of plan.openQuestions) {
        planLines.push(`  - ${typeof q === "string" ? q : JSON.stringify(q)}`);
      }
    }
    if (planLines.length > 0) {
      sections.push(`## Current Plan (v${String(planArtifact.version)})\n${planLines.join("\n")}`);
    }
  }

  // 5. Human answers (HumanAnswers artifact)
  const humanAnswersArtifact = findLatest(artifacts, "HumanAnswers");
  if (humanAnswersArtifact) {
    const payload = humanAnswersArtifact.payloadJson as {
      answers?: { questionId?: string; answer?: string }[];
    };
    if (Array.isArray(payload.answers) && payload.answers.length > 0) {
      const answerLines = payload.answers.map(
        (a) => `  - **[${a.questionId ?? ""}]:** ${a.answer ?? ""}`,
      );
      sections.push(`## Human Answers\n${answerLines.join("\n")}`);
    }
  }

  // 6. Plan review findings (latest PlanReview artifact)
  const planReviewArtifact = findLatest(artifacts, "PlanReview");
  if (planReviewArtifact) {
    const review = planReviewArtifact.payloadJson as {
      summary?: string;
      findings?: { id?: string; severity?: string; title?: string; details?: string }[];
    };
    const reviewLines: string[] = [];
    if (review.summary) reviewLines.push(`**Summary:** ${review.summary}`);
    if (Array.isArray(review.findings) && review.findings.length > 0) {
      for (const f of review.findings) {
        reviewLines.push(
          `  - **[${f.severity ?? ""}] ${f.title ?? ""}** (${f.id ?? ""}): ${f.details ?? ""}`,
        );
      }
    }
    if (reviewLines.length > 0) {
      sections.push(`## Plan Review Findings\n${reviewLines.join("\n")}`);
    }
  }

  // 7. Execution report (latest ExecutionReport artifact, truncated to 4000 chars)
  const execReportArtifact = findLatest(artifacts, "ExecutionReport");
  if (execReportArtifact) {
    let rawText = execReportArtifact.rawText ?? "";
    if (rawText.length > EXEC_REPORT_MAX_CHARS) {
      rawText = rawText.slice(0, EXEC_REPORT_MAX_CHARS) + "\n…(truncated)";
    }
    if (rawText.trim()) {
      sections.push(`## Execution Report\n${rawText}`);
    }
  }

  // 8. Code review findings (latest Review artifact)
  const reviewArtifact = findLatest(artifacts, "Review");
  if (reviewArtifact) {
    const review = reviewArtifact.payloadJson as {
      summary?: string;
      findings?: { id?: string; severity?: string; title?: string; details?: string }[];
    };
    const reviewLines: string[] = [];
    if (review.summary) reviewLines.push(`**Summary:** ${review.summary}`);
    if (Array.isArray(review.findings) && review.findings.length > 0) {
      for (const f of review.findings) {
        reviewLines.push(
          `  - **[${f.severity ?? ""}] ${f.title ?? ""}** (${f.id ?? ""}): ${f.details ?? ""}`,
        );
      }
    }
    if (reviewLines.length > 0) {
      sections.push(`## Code Review Findings\n${reviewLines.join("\n")}`);
    }
  }

  // 9. Rejection context(s) — all RejectionContext artifacts
  const rejectionArtifacts = artifacts.filter((a) => a.type === "RejectionContext");
  if (rejectionArtifacts.length > 0) {
    const rejLines: string[] = [];
    for (const r of rejectionArtifacts) {
      const payload = r.payloadJson as {
        planVersion?: number;
        feedback?: string;
        source?: string;
        mode?: string;
      };
      rejLines.push(
        `  - **Plan v${String(payload.planVersion ?? "?")}** (${payload.source ?? ""}, ${payload.mode ?? ""}): ${payload.feedback ?? ""}`,
      );
    }
    sections.push(`## Rejection Context(s)\n${rejLines.join("\n")}`);
  }

  // 10. Advisory footer
  sections.push(
    `---\nYou are in READ-ONLY advisory mode. Do not propose file modifications. ` +
      `Do not execute commands. Reason over the provided context to answer the operator's question.`,
  );

  return sections.join("\n\n");
}

/**
 * Returns the artifact with the highest version number for a given type.
 */
function findLatest(artifacts: Artifact[], type: string): Artifact | undefined {
  const matching = artifacts.filter((a) => a.type === type);
  if (matching.length === 0) return undefined;
  return matching.reduce((best, cur) => (cur.version > best.version ? cur : best));
}
