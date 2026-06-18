Run a retrospective inspection of the completed run below. Your goal is NOT to summarize it — it is to extract one durable, repository-scoped lesson and rewrite it so it benefits a future agent working on a **different** task in the same area of this codebase.

## Run Context

- **Repository**: {{repoSlug}}
- **Task Category Hint**: {{taskCategory_hint}}

## Plan Summary

{{planSummary}}

## Execution Outcome

{{executionOutcome}}

{{remediationSummary}}

## Existing Skills in Memory (for context)

{{existingSkillsSummary}}

## Instructions

The novelty pre-check has already passed — this run's task is sufficiently distinct from existing skills. Your job is to judge **generalizable confidence** and produce a generalized skill, not to re-verify novelty.

Work in two steps:

### Step 1 — Find the transferable lesson

Identify the single most valuable thing this run surfaced about the codebase. Then pressure-test it:

1. Is it non-obvious — something code alone would not tell a future agent?
2. Would it help a run working on a **different** feature/issue that merely touches the same files, subsystem, or constraint? (If only a continuation of *this* feature would benefit, it fails.)
3. Can it be stated as a present-tense rule about the repo, without naming this issue, feature, phase, or run?

If you cannot answer yes to all three, set `shouldPersist: false` and explain why in `reason`.

### Step 2 — Generalize and write it

If it passes, rewrite the lesson into reusable reference knowledge:

- Strip every run-specific reference: issue/ticket IDs, PR numbers, phase/milestone names, "this run", "the remediation", one-off counts, and any narration of what happened this time.
- Anchor it on durable things: file paths, module names, integrations, invariants, commands.
- Scope the labels to the **subsystem**, not the feature, so future unrelated runs retrieve it.

Then provide:

- `name`: a kebab-case subsystem slug (e.g. `cloudbuild-deploy-detection`) suitable for `.cursor/skills/<name>/SKILL.md`.
- `description`: a concise when-to-use trigger — which paths, commands, or task types should surface this skill for a future agent.
- `skillMarkdown`: the generalized skill body (under 500 words), written as standalone repo reference with no mention of the originating run.
- `taskCategory`: a short, durable subsystem/area label for retrieval.
- `reason`: 1-2 sentences, stated in generalized terms, on why this helps future runs in this area.

Respond with a single JSON block inside `BEGIN_STRUCTURED_OUTPUT` / `END_STRUCTURED_OUTPUT` delimiters.
