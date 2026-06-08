Evaluate the following completed run and decide whether its key insight should be persisted as a reusable skill.

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

The novelty pre-check has already passed — the trigram similarity between this run's task and all existing skills was below the threshold. So this run is sufficiently novel. Your job is to judge **confidence**: is this insight genuinely useful for future runs on this repository?

Ask yourself:
1. Does this run reveal something non-obvious about this codebase or its constraints?
2. Would a future agent benefit from knowing this before starting a similar task?
3. Is the insight specific enough to be actionable (not just "write good tests")?

If yes to all three, set `shouldPersist: true` and provide:
- `name`: a kebab-case slug (e.g. `dev-env-pause-resume-footguns`) suitable for exporting to `.cursor/skills/<name>/SKILL.md`
- `description`: a concise when-to-use blurb for SKILL.md frontmatter (what paths, commands, or task types should trigger it)
- `skillMarkdown`: the skill body (under 500 words) capturing the key insight
- `taskCategory`: a short retrieval label

If no, set `shouldPersist: false` and explain why in `reason`.

Respond with a single JSON block inside `BEGIN_STRUCTURED_OUTPUT` / `END_STRUCTURED_OUTPUT` delimiters.
