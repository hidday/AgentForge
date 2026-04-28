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
3. Analyse scope — unless the user has explicitly requested a single issue, evaluate the heuristics in the Scope Analysis section to determine whether decomposition is warranted.
4. Look up the target team and project using `linear_get_teams` and `linear_search_projects`
5. Compose the title, description, priority, and labels following the format below
6. Call `linear_create_issue` via the Linear MCP server
7. Return the created issue ID and URL to the user

## Scope Analysis

Evaluate these heuristics whenever step 3 of the Workflow is reached (unless
the skip condition applies).

### Skip condition

If the user has explicitly asked for a single issue — e.g. "just one ticket",
"don't split", "single issue only" — skip this entire section and proceed
directly to step 4.

### Heuristic signals

The following signals, individually or in combination, warrant decomposition:

1. **Many acceptance criteria spanning different concerns** — more than ~5
   acceptance criteria that cut across different modules or concerns (e.g. one
   criterion touches auth, another touches persistence, a third touches the API
   surface).

2. **Multiple distinct system areas** — the requirements touch 3 or more
   distinct system areas. Count by domain, not by file count. Example domains:
   auth/identity, persistence/database, API surface, UI/frontend, logging/
   observability, background jobs, infrastructure/config.

3. **Implied sequential or independent work streams** — the description uses
   connectives suggesting parallel or additive work: "and also", "plus",
   "as well as", "in addition to"; or it contains multiple unrelated imperative
   verbs aimed at different subsystems (e.g. "add rate limiting **and** set up
   audit logging **and** implement OAuth").

### Decision rule

- **One strong signal** (any single heuristic clearly fires) → propose
  decomposition; proceed to the
  [Decomposition Confirmation Flow](#decomposition-confirmation-flow) section.
- **Two weak signals** (two heuristics partially fire) → propose decomposition;
  proceed to the
  [Decomposition Confirmation Flow](#decomposition-confirmation-flow) section.
- **Zero or one weak signal** → proceed as a single issue (continue to step 4
  of the Workflow).

### Escape hatch

When in doubt, ask the user rather than silently decomposing.

---

## Decomposition Confirmation Flow

When the decision rule in Scope Analysis indicates decomposition, follow these
steps before creating any issues:

1. **Synthesise a parent issue title** using the standard convention:
   `type(scope): summary encompassing all sub-streams`. The scope should be
   the broadest common area (e.g. `service`, `platform`).

2. **Identify sub-issues** — one per independent work stream. Each sub-issue
   gets a focused title and a one-sentence description of its scope.

3. **Present the breakdown to the user** in readable markdown:

   ```
   This request spans multiple distinct work streams. Here is my proposed breakdown:

   **Parent**: `feat(service): add auth, rate limiting, and audit logging`

   Sub-issues:
   1. `feat(auth): implement user authentication` — add JWT-based login and
      session management
   2. `feat(api): add request rate limiting` — enforce per-client limits with
      429 responses
   3. `feat(observability): add audit logging` — record security-relevant
      events to the audit log

   Shall I create a parent issue with these sub-issues, or would you prefer a
   single issue?
   ```

4. **If the user confirms decomposition**: proceed to the
   [Creating Parent and Sub-Issues](#creating-parent-and-sub-issues) section.

5. **If the user declines or requests a single issue**: skip the decomposition
   flow entirely. Return to step 5 of the Workflow (Compose title/description)
   and treat the full scope as one issue, creating it via `linear_create_issue`
   as normal.

---

## Creating Parent and Sub-Issues

This section applies only when the user has confirmed the decomposition
proposal. Use `save_issue` (on the same Linear MCP server as the rest of the
workflow) for every call in this sequence — **not** `linear_create_issue`.

### Step 1 — Create the parent issue

Call `save_issue` **without** a `parentId`. The parent description should be a
high-level summary that references the sub-issues by name.

```json
{
  "title": "feat(service): add auth, rate limiting, and audit logging",
  "description": "## Context\n\nThis parent issue tracks three related but independent improvements ...\n\n## Requirements\n\nSee sub-issues for detailed requirements.\n\n## Acceptance Criteria\n\n- [ ] All sub-issues completed and merged\n\n## Scope\n\n- **In scope**: Auth, rate limiting, audit logging (see sub-issues)\n- **Out of scope**: Anything not covered by the sub-issues",
  "team": "<team-name or team-id>",
  "project": "<project-name or project-id>",
  "priority": 2
}
```

Capture the returned issue ID — call it `PARENT_ID`.

**If the parent `save_issue` call fails**: abort the entire decomposition.
Report the error clearly. Do not attempt to create any sub-issues.

### Step 2 — Create each sub-issue

For each confirmed sub-issue (in the order presented to the user), call
`save_issue` with `parentId` set to `PARENT_ID`. Example:

```json
{
  "title": "feat(auth): implement user authentication",
  "description": "## Context\n\nThis is a sub-issue of PARENT_ID ...\n\n## Requirements\n\n1. ...\n\n## Technical Hints\n\n- ...\n\n## Acceptance Criteria\n\n- [ ] ...\n\n## Scope\n\n- **In scope**: ...\n- **Out of scope**: rate limiting, audit logging (covered by sibling issues)",
  "team": "<same team as parent>",
  "project": "<same project as parent>",
  "priority": 2,
  "parentId": "PARENT_ID"
}
```

**Each sub-issue MUST include a full five-section description** following the
Description Template (Context, Requirements, Technical Hints, Acceptance
Criteria, Scope). A title or one-liner is not sufficient. The Context section
should reference the parent issue ID. The Scope section must explicitly exclude
the concerns covered by sibling sub-issues.

Sub-issues inherit `team` and `project` from the parent — use the same values.

**If any sub-issue `save_issue` call fails**: stop immediately. Report:
- Which sub-issues were created successfully (with their IDs/URLs)
- Which sub-issue failed and the error
- The parent issue ID (`PARENT_ID`) so the user can manually create remaining
  sub-issues

Do not attempt to create further sub-issues in the sequence.

### Step 3 — Report success

On full success, return:
- The parent issue ID and URL
- Each sub-issue ID and URL

---

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
- `parentId` -- set when creating a sub-issue during the decomposition flow; use the ID returned from the parent issue `save_issue` call. When using the decomposition path, use `save_issue` (see [Creating Parent and Sub-Issues](#creating-parent-and-sub-issues)) rather than `linear_create_issue`, as `save_issue` supports `parentId`.

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

For more examples (bug fix, refactor, chore), see [create-linear-issue-examples.md](.agents/skills/create-linear-issue-examples.md).
