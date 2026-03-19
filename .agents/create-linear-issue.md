# Create Structured Linear Issue

This skill creates Linear issues formatted for the AgentForge Dev Orchestrator's
planner agent. The structured format minimizes open questions and maximizes the
planner's confidence score.

## Quick Reference

The orchestrator consumes these fields from every issue:

| Field | Used by | Notes |
|-------|---------|-------|
| `title` | Planner, PlanReviewer, PlanReviser, Reviewer | Concise imperative summary |
| `description` | Planner, PlanReviewer, PlanReviser, Reviewer | Structured markdown (see template below) |
| `labels` | Planner, PlanReviewer | Type + scope tags |
| `priority` | Planner, PlanReviewer | Linear 0-4 scale |
| `project` | RepoRegistry | Maps issue to target repository |

## Workflow

1. Gather the user's intent (what they want built/fixed/changed)
2. Ask clarifying questions if requirements are ambiguous
3. Look up the target team and project using `linear_get_teams` and `linear_search_projects`
4. Compose the title, description, priority, and labels following the format below
5. Call `linear_create_issue` via the Linear MCP server
6. Return the created issue ID and URL to the user

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

Examples:
- `feat(auth): add JWT refresh token rotation`
- `fix(api): prevent duplicate webhook processing`
- `refactor(db): extract query builder from repository classes`

## Description Template

Use this exact structure for the `description` field. Every section except
Technical Hints is required. Use markdown.

```
## Context

[1-3 sentences: why this work is needed. Link to prior decisions or context.]

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

### Section Guidance

**Context**: Give the planner enough background to form correct assumptions
without re-reading the entire codebase. Reference specific prior decisions or
issues if relevant.

**Requirements**: Numbered, testable criteria. Each should be verifiable by
code review or automated test. The planner uses these to break work into steps.

**Technical Hints**: Point to specific files, functions, or patterns. This
directly reduces the planner's open questions. Omit if the task is
self-explanatory.

**Acceptance Criteria**: Checklist items that the reviewer agent checks the
implementation against. Be specific -- "works correctly" is not useful;
"returns 401 for expired tokens" is.

**Scope**: Explicit boundaries prevent the planner from over-scoping or
under-scoping the plan. Always state what is out of scope.

## Priority Mapping

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

## Creating the Issue via MCP

Call the `linear_create_issue` tool on the `user-linear` MCP server:

```json
{
  "title": "feat(auth): add JWT refresh token rotation",
  "description": "## Context\n\nRefresh tokens currently never expire...\n\n## Requirements\n\n1. ...",
  "teamId": "<team-id from linear_get_teams>",
  "projectId": "<project-id from linear_search_projects>",
  "priority": 2
}
```

Required parameters:
- `title` -- formatted per the title convention above
- `description` -- formatted per the description template above
- `teamId` -- look up with `linear_get_teams` if not known

Optional but recommended:
- `projectId` -- the orchestrator uses the Linear project name to resolve the target repository; always set this
- `priority` -- defaults to 0 (no priority) if omitted

### Discovering teamId and projectId

If the user hasn't specified these, look them up:

1. Call `linear_get_teams` to list available teams
2. Call `linear_search_projects` with the project name to get the project ID
3. Use the IDs in the `linear_create_issue` call

## Inline Example

**User says**: "We need to add rate limiting to the API"

**Structured issue**:

- **Title**: `feat(api): add request rate limiting`
- **Priority**: 2 (High)
- **Labels**: `feature`, `api`
- **Description**:

```markdown
## Context

The API currently has no rate limiting. Any client can make unlimited requests,
which risks resource exhaustion and abuse. This was flagged during the security
review.

## Requirements

1. Add per-client rate limiting using a token bucket algorithm
2. Rate limit applies to all authenticated API endpoints
3. Return 429 Too Many Requests with Retry-After header when limit exceeded
4. Rate limit configuration (requests/window) is read from environment variables
5. Rate limit state is stored in-memory (Redis upgrade is a separate issue)

## Technical Hints

- Fastify route plugin in `foundry/src/api/routes.ts`
- Existing auth hook extracts client identity from the request
- Consider `@fastify/rate-limit` plugin

## Acceptance Criteria

- [ ] Rate limiting middleware is applied to all `/api/*` routes
- [ ] Exceeding the limit returns 429 with correct Retry-After header
- [ ] Limits are configurable via `RATE_LIMIT_MAX` and `RATE_LIMIT_WINDOW_MS` env vars
- [ ] Existing tests still pass
- [ ] New tests cover rate limit enforcement and header correctness

## Scope

- **In scope**: Per-client in-memory rate limiting for API routes
- **Out of scope**: Redis-backed distributed rate limiting, WebSocket rate limiting
```

For more examples (bug fix, refactor, chore), see [create-linear-issue-examples.md](.agents/create-linear-issue-examples.md).
