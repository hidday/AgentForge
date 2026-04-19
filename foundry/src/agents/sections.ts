import type { RelatedContext, RelatedIssue } from "../schemas/taskBundle.js";

/**
 * Explicit fence markers that wrap the Related Linear Context block in the
 * rendered prompt. They are literal sentinels (uppercase, distinctive) so the
 * agent can unambiguously distinguish background context from the focus issue
 * — especially in re-plan / resume flows where rejection feedback, plan-review
 * findings, previous plans, and human answers are all stacked in the same
 * prompt and could otherwise be misread as part of the same context.
 *
 * If you change these strings, also update the system prompts that reference
 * them by name (planner / plan-reviewer / plan-reviser).
 */
export const RELATED_CONTEXT_BEGIN_FENCE =
  "===== BEGIN BACKGROUND CONTEXT (NOT THE FOCUS ISSUE — DO NOT PLAN/REVIEW WORK FOR THESE ITEMS) =====";
export const RELATED_CONTEXT_END_FENCE =
  "===== END BACKGROUND CONTEXT — RESUME WORK ON THE FOCUS ISSUE DESCRIBED ABOVE =====";

/**
 * Render a "Related Linear Context" markdown section for the focus issue's
 * parent and direct blockers. Returned as a single block to be substituted
 * into the planner / plan-reviewer / plan-reviser user prompts.
 *
 * The block is wrapped in explicit `BEGIN BACKGROUND CONTEXT` /
 * `END BACKGROUND CONTEXT` fences and every nested heading is prefixed with
 * `Background:` so the agent cannot mistake parent/blocker content for the
 * focus issue, even on re-plans where this section is interleaved with other
 * dynamic sections (rejection feedback, plan-review findings, etc.).
 *
 * Returns an empty string when no related context is available so the
 * placeholder collapses cleanly and the section is omitted from the prompt.
 */
export function renderRelatedContextSection(relatedContext: RelatedContext | undefined): string {
  if (!relatedContext) return "";
  const { parent, blockers } = relatedContext;
  if (!parent && (!blockers || blockers.length === 0)) return "";

  const parts: string[] = [
    RELATED_CONTEXT_BEGIN_FENCE,
    "",
    "## Background: Related Linear Context (NOT the focus issue)",
    "",
    "> **STRICTLY ADDITIONAL BACKGROUND.** The issues below are provided ONLY so you can understand the higher-level effort (parent) and prerequisites (blockers) surrounding the focus issue. They are NOT part of the work to plan, review, or implement.",
    ">",
    "> Rules:",
    "> - Do NOT add plan steps, review findings, or revisions targeting these issues.",
    "> - Do NOT treat their descriptions, acceptance criteria, or open questions as requirements of the focus issue.",
    "> - Do NOT let this background expand the scope established by the focus issue's description.",
    "> - On re-plans / resumed runs: this block is unchanged background — it does NOT supersede or modify rejection feedback, plan-review findings, human answers, or the focus issue itself.",
    "> - You MAY use it to inform sequencing, assumptions, and risks for the focus issue, and you MAY cite a related issue's identifier when justifying such a decision.",
  ];

  if (parent) {
    parts.push("", "### Background: Parent Issue", renderRelatedIssueDetails(parent));
  }

  if (blockers && blockers.length > 0) {
    parts.push(
      "",
      "### Background: Blocker Issues (must be understood before the focus issue can ship)",
    );
    blockers.forEach((blocker, i) => {
      parts.push("", `#### Background: Blocker ${i + 1}`, renderRelatedIssueDetails(blocker));
    });
  }

  parts.push("", RELATED_CONTEXT_END_FENCE);

  return parts.join("\n") + "\n";
}

function renderRelatedIssueDetails(issue: RelatedIssue): string {
  const labels = issue.labels.length > 0 ? issue.labels.join(", ") : "(none)";
  const url = issue.url ?? "(no URL)";
  const identifierLine = issue.identifier
    ? `- **Identifier**: ${issue.identifier}`
    : `- **Identifier**: (unknown)`;
  const description = issue.description.trim().length > 0 ? issue.description : "(no description)";

  return [
    identifierLine,
    `- **ID**: ${issue.id}`,
    `- **Title**: ${issue.title}`,
    `- **State**: ${issue.state}`,
    `- **Labels**: ${labels}`,
    `- **Priority**: ${issue.priority}`,
    `- **URL**: ${url}`,
    "",
    "**Description**:",
    description,
  ].join("\n");
}
