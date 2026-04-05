# Adapt Existing Linear Issue

This skill takes an existing Linear issue -- typically from a customer's project
that was not written for AI agent consumption -- and creates a normalized
sub-issue underneath it. The sub-issue follows the same structured format used
by `create-linear-issue`, making it directly consumable by the AgentForge Dev
Orchestrator's planner agent.

Use this skill when the user provides an existing Linear issue identifier
(e.g. `CUS-42`) and wants AgentForge to work on it.

## Quick Reference

The orchestrator consumes these fields from every issue:

| Field | Used by | Notes |
|-------|---------|-------|
| `title` | Planner, PlanReviewer, PlanReviser, Reviewer | Concise imperative summary |
| `description` | Planner, PlanReviewer, PlanReviser, Reviewer | Structured markdown (see template below) |
| `labels` | Planner, PlanReviewer | Type + scope tags |
| `priority` | Planner, PlanReviewer | Linear 0-4 scale |
| `project` | RepoRegistry | Maps issue to target repository |
| `parentId` | Traceability | Links the sub-issue back to the original |

## Workflow

1. **Receive the source issue identifier** from the user (e.g. `CUS-42` or a UUID).
2. Call `get_issue` on the `plugin-linear-linear` MCP server to fetch the
   issue's title, description, state, priority, project, team, labels, and
   relations.
3. Call `list_comments` to gather the full discussion thread -- comments often
   contain critical context, decisions, and clarifications not present in the
   description. Always do this step.
4. **Analyze** the original title, description, and comments to infer:
   - Issue type (`feat`, `fix`, `refactor`, `chore`, `docs`, `test`, `perf`)
   - Scope (module or area affected)
   - Priority (keep the original value unless the user overrides it)
5. **Compose the normalized title** following the `<type>(<scope>): <imperative summary>` convention.
6. **Compose the structured description** with all five sections (Context,
   Requirements, Technical Hints, Acceptance Criteria, Scope), synthesized from
   the original issue's content and comments.
7. If requirements are ambiguous or too vague to produce concrete acceptance
   criteria, ask the user clarifying questions before proceeding.
8. Call `save_issue` to create the sub-issue with:
   - `title` -- normalized title
   - `description` -- structured markdown
   - `team` -- inherited from the parent issue
   - `parentId` -- set to the original issue's identifier
   - `project` -- inherited from the parent issue
   - `priority` -- inherited or overridden by the user
   - `labels` -- type + scope labels
9. Call `save_comment` on the **original** issue with a short note linking to
   the newly created sub-issue for traceability.
10. Return the new sub-issue's identifier and URL to the user.

## Fetching the Source Issue

### Getting the issue

Call `get_issue` on the `plugin-linear-linear` MCP server:

```json
{
  "id": "CUS-42",
  "includeRelations": true
}
```

Set `includeRelations` to `true` so you can see blocking/related issues that
may inform scope boundaries.

### Getting comments

Always call `list_comments` immediately after:

```json
{
  "issueId": "CUS-42",
  "orderBy": "createdAt",
  "limit": 250
}
```

Use `limit: 250` (the maximum) to ensure you capture the entire discussion.
Paginate with the `cursor` field if the response indicates more pages.

## Title Convention

Format: `<type>(<scope>): <imperative summary>`

| Type | When to use |
|------|-------------|
| `feat` | New functionality |
| `fix` | Bug fix |
| `refactor` | Restructuring without behavior change |
| `chore` | Build, CI, deps, config |
| `docs` | Documentation only |
| `test` | Adding or fixing tests |
| `perf` | Performance improvement |

Rules:
- Imperative mood ("add", not "added" or "adds")
- Scope is the module or area affected (e.g. `auth`, `api`, `ui`, `db`)
- Under 80 characters total
- No trailing period

### Inferring Type and Scope from Existing Issues

Customer issues rarely follow conventional-commit conventions. Use these
heuristics:

- **Bug indicators**: words like "broken", "crash", "error", "doesn't work",
  "regression", issue labels containing "bug" --> `fix`
- **Feature indicators**: "add", "new", "implement", "support", "as a user I
  want" --> `feat`
- **Refactor indicators**: "clean up", "restructure", "extract", "move",
  "technical debt" --> `refactor`
- **Chore indicators**: "upgrade", "update dependency", "CI", "pipeline",
  "config" --> `chore`
- **Scope**: Look at which files, modules, or systems are mentioned. If the
  issue references "the API", scope is `api`. If it mentions "the dashboard",
  scope is `ui`. If unclear, use the broadest applicable area or ask the user.

## Description Template

Use this exact structure for the sub-issue's `description` field. Every section
except Technical Hints is required. Use markdown.

```
## Context

[1-3 sentences: why this work is needed. Link to the parent issue and any prior
decisions mentioned in comments.]

## Requirements

1. [Concrete, testable acceptance criterion]
2. [Another criterion]
3. [...]

## Technical Hints

- [Optional: relevant files, APIs, patterns, or prior art]
- [Optional: known constraints or gotchas]

## Acceptance Criteria

- [ ] [Checklist item that defines "done" for this issue]
- [ ] [Another checklist item]
- [ ] [Tests pass, lint clean, etc.]

## Scope

- **In scope**: [What this issue covers]
- **Out of scope**: [What this issue explicitly does NOT cover]
```

### Synthesizing Each Section from Raw Content

**Context**: Derive from the original issue's title and the first paragraph of
its description. Include any "why" reasoning found in comments. Always reference
the parent issue identifier (e.g. "Adapted from CUS-42").

**Requirements**: Scan the description and comments for actionable statements.
Convert vague asks into concrete, testable criteria. If the original says "make
the search faster", translate to something like "Reduce p95 search latency to
under 200ms" -- or ask the user for a target if none is implied.

**Technical Hints**: Extract any file paths, API endpoints, library names, or
architectural references mentioned in the description or comments. If the
original issue links to PRs or other issues, note those here.

**Acceptance Criteria**: Derive from Requirements but phrase as a checklist.
Each item should be verifiable by code review or automated test. Always include
"Existing tests still pass" as a baseline item.

**Scope**: Identify what the original issue explicitly asks for (in scope) and
note related work that is mentioned but should be handled separately (out of
scope). If comments contain scope-creep discussions, use those to set boundaries.

## Handling Ambiguity

Customer issues are often vague. Follow these rules:

1. **If the issue has enough content to infer all five description sections**:
   proceed without asking questions.
2. **If the issue is a one-liner with no description or comments**: ask the user
   to provide additional context before creating the sub-issue.
3. **If some sections can be inferred but others cannot**: fill in what you can,
   ask targeted questions only for the gaps (e.g. "The original issue mentions
   improving search but doesn't specify a performance target. What latency
   threshold should we target?").
4. **When in doubt, be conservative with scope**: it is better to create a
   narrowly scoped sub-issue and let the user expand it than to over-scope.

## Priority Mapping

Default to the parent issue's priority. Override only if the user requests it.

| Linear Value | Meaning | Use when |
|--------------|---------|----------|
| 0 | No priority | Not yet triaged |
| 1 | Urgent | Blocking production or other work |
| 2 | High | Needed this cycle |
| 3 | Medium | Important but not time-sensitive |
| 4 | Low | Nice-to-have, backlog |

## Labels

Apply labels that help the planner understand the nature of the work:

- **Type labels**: `feature`, `bug`, `refactor`, `chore`, `docs`, `test`
- **Scope labels**: Match the `(<scope>)` from the title -- e.g. `auth`, `api`, `ui`
- **AI labels**: The orchestrator manages `ai:*` labels automatically; do NOT set them manually

## Creating the Sub-Issue via MCP

Call the `save_issue` tool on the `plugin-linear-linear` MCP server:

```json
{
  "title": "fix(search): reduce p95 latency below 200ms",
  "description": "## Context\n\nAdapted from CUS-42. The search endpoint...\n\n## Requirements\n\n1. ...",
  "team": "<team name or ID from parent issue>",
  "parentId": "CUS-42",
  "project": "<project name or ID from parent issue>",
  "priority": 2,
  "labels": ["bug", "search"]
}
```

Required parameters:
- `title` -- formatted per the title convention above
- `description` -- formatted per the description template above
- `team` -- inherited from the parent issue
- `parentId` -- the original issue's identifier (this makes it a sub-issue)

Optional but recommended:
- `project` -- the orchestrator uses the Linear project name to resolve the target repository; always set this
- `priority` -- defaults to the parent's priority if omitted
- `labels` -- type + scope labels

## Posting the Back-Link Comment

After creating the sub-issue, call `save_comment` on the `plugin-linear-linear`
MCP server to post a traceability note on the original issue:

```json
{
  "issueId": "CUS-42",
  "body": "Created AI-digestible sub-issue **<NEW-ID>** for AgentForge orchestration.\n\nThe sub-issue contains a normalized description with structured context, requirements, acceptance criteria, and scope boundaries derived from this issue and its discussion thread."
}
```

Replace `<NEW-ID>` with the identifier returned by `save_issue`.

## Inline Example

**Source issue fetched via `get_issue`**:

- **Identifier**: `CUS-42`
- **Title**: `Search is too slow`
- **Priority**: 2 (High)
- **Description**: `Users are complaining that search takes forever. We need to fix this ASAP.`
- **Project**: `Backend Platform`
- **Team**: `Platform`

**Comments fetched via `list_comments`**:

1. *Alice*: "The p95 is around 1.2s right now. Most of the time is spent in the
   full-text query against the documents table."
2. *Bob*: "We should add an index on the search_vector column. Also the query
   isn't using pagination so it loads all results into memory."
3. *Alice*: "Agreed. Let's also add a LIMIT to the query. 50 results per page
   should be fine for now."

**Normalized sub-issue created via `save_issue`**:

- **Title**: `fix(search): reduce p95 latency below 200ms`
- **Parent**: `CUS-42`
- **Priority**: 2 (High)
- **Labels**: `bug`, `search`
- **Description**:

```markdown
## Context

Adapted from CUS-42. Users report that search is unacceptably slow. Current p95
latency is ~1.2s, primarily caused by an unindexed full-text query on the
documents table that loads all results into memory without pagination.

## Requirements

1. Add a GIN index on the `search_vector` column of the `documents` table
2. Add server-side pagination to the search query with a default limit of 50
   results per page
3. Reduce p95 search latency to under 200ms

## Technical Hints

- The full-text query runs against the `documents` table
- The `search_vector` column is the target for indexing
- Comments from the team suggest GIN index + LIMIT as the approach
- Pagination offset/limit should be accepted as query parameters

## Acceptance Criteria

- [ ] GIN index exists on `documents.search_vector`
- [ ] Search endpoint accepts `limit` and `offset` query parameters
- [ ] Default page size is 50 results
- [ ] p95 search latency is under 200ms (measured against representative dataset)
- [ ] Existing tests still pass
- [ ] New tests cover paginated search and edge cases (empty results, last page)

## Scope

- **In scope**: Indexing, query pagination, and latency reduction for the search endpoint
- **Out of scope**: Full-text search relevance tuning, UI search component changes, search analytics
```

**Back-link comment posted on CUS-42**:

> Created AI-digestible sub-issue **CUS-43** for AgentForge orchestration.
>
> The sub-issue contains a normalized description with structured context,
> requirements, acceptance criteria, and scope boundaries derived from this
> issue and its discussion thread.

For more examples (vague one-liner, unstructured description, bug without repro
steps, feature with scattered comment context), see
[adapt-linear-issue-examples.md](.agents/skills/adapt-linear-issue-examples.md).
