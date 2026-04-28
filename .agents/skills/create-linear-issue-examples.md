# Structured Issue Examples

Reference examples for the `create-linear-issue` skill. Each example shows the
full set of fields passed to `linear_create_issue`.

---

## Example 1: Bug Fix

**Title**: `fix(sync): prevent duplicate runs when webhook races with poll`

**Priority**: 1 (Urgent)

**Labels**: `bug`, `sync`

**Description**:

```markdown
## Context

When a Linear webhook fires at the same time as a poll cycle discovers the
same issue, two concurrent `startRun` calls can both pass the "no active run"
check and create duplicate runs. This has been observed in production logs
(duplicate `RUN_REQUESTED` events for the same issue within 200ms).

## Requirements

1. At most one active run may exist per Linear issue at any point in time
2. Concurrent `startRun` calls for the same issue must be serialized or
   deduplicated
3. The second call should no-op and log a warning, not throw an error

## Technical Hints

- `orchestratorService.ts` `startRun()` checks for existing runs but without
  a transaction lock
- `runRepository.ts` `findActiveByIssueId()` is the current guard
- Consider a database-level unique partial index on `(linearIssueId)` where
  `state NOT IN ('completed', 'failed')`, or an application-level mutex

## Acceptance Criteria

- [ ] Concurrent startRun calls for the same issue produce exactly one run
- [ ] The deduplication mechanism is tested with a concurrent-call test
- [ ] Existing run lifecycle tests still pass
- [ ] Warning log emitted when a duplicate is suppressed

## Scope

- **In scope**: Deduplication of runs for the same issue
- **Out of scope**: General webhook idempotency, retry/backoff logic
```

---

## Example 2: Refactor

**Title**: `refactor(agents): extract prompt rendering into PromptService`

**Priority**: 3 (Medium)

**Labels**: `refactor`, `agents`

**Description**:

```markdown
## Context

Prompt rendering logic (template loading, variable interpolation) is currently
in `promptRenderer.ts` as bare functions. Multiple agents import and call
these directly. Extracting this into a `PromptService` class would allow
injecting it as a dependency, simplifying testing and enabling future features
like prompt versioning or caching.

## Requirements

1. Create a `PromptService` class that encapsulates `loadPromptTemplate` and
   `renderTemplate`
2. All agents receive `PromptService` via constructor injection
3. No behavioral changes -- all existing prompt outputs must remain identical
4. `promptRenderer.ts` functions are removed or re-exported from the service
   for backward compatibility

## Technical Hints

- `foundry/src/agents/promptRenderer.ts` has the current code
- Agents: `plannerAgent.ts`, `planReviewerAgent.ts`, `planReviserAgent.ts`,
  `executorAgent.ts`, `reviewerAgent.ts`, `remediationAgent.ts`
- DI wiring happens in `server.ts`

## Acceptance Criteria

- [ ] `PromptService` class exists with `loadTemplate(name)` and
      `render(template, vars)` methods
- [ ] All six agents use injected `PromptService` instead of direct imports
- [ ] Unit tests for `PromptService` cover template loading and rendering
- [ ] Existing agent tests pass without modification
- [ ] No direct imports of `promptRenderer.ts` functions remain outside the
      service module

## Scope

- **In scope**: Extracting prompt rendering into a service, updating DI wiring
- **Out of scope**: Prompt versioning, caching, or template format changes
```

---

## Example 3: Chore

**Title**: `chore(ci): add GitHub Actions workflow for PR checks`

**Priority**: 4 (Low)

**Labels**: `chore`, `ci`

**Description**:

```markdown
## Context

There is no CI pipeline. Lint, typecheck, and test commands exist in
`package.json` but only run manually. Adding a GitHub Actions workflow
ensures every PR is validated before merge.

## Requirements

1. GitHub Actions workflow triggers on pull requests to `main`
2. Runs lint, typecheck, and test in parallel jobs
3. Uses Node.js version from `.nvmrc`
4. Caches `node_modules` for faster runs
5. Workflow file lives at `.github/workflows/pr-checks.yml`

## Technical Hints

- Root `package.json` has `lint`, `typecheck`, and `test` scripts
- `.nvmrc` specifies the Node version
- Both `foundry` and `ui` have their own `package.json` --
  the root scripts orchestrate both

## Acceptance Criteria

- [ ] `.github/workflows/pr-checks.yml` exists and is valid YAML
- [ ] Workflow runs lint, typecheck, and test as separate parallel jobs
- [ ] Node version is read from `.nvmrc`
- [ ] `node_modules` caching is configured
- [ ] Workflow does not trigger on pushes to non-main branches

## Scope

- **In scope**: PR check workflow for lint, typecheck, test
- **Out of scope**: Deployment pipelines, release workflows, branch protection rules
```

---

## Example 4: Feature

**Title**: `feat(ui): add run detail page with live event stream`

**Priority**: 2 (High)

**Labels**: `feature`, `ui`

**Description**:

```markdown
## Context

The UI currently shows a list of runs but has no detail view. Users must check
Linear comments or server logs to understand what the orchestrator is doing.
A run detail page with a live event stream would give visibility into the
planning, execution, and review stages.

## Requirements

1. New route `/runs/:id` renders a run detail page
2. Page displays run metadata: issue title, state, repo, branch, timestamps
3. Events stream in real-time via the existing SSE endpoint (`/api/runs/:id/events/stream`)
4. Each event renders with timestamp, type, and payload summary
5. Action buttons (approve plan, reject plan, approve review) appear based on
   current run state
6. Page handles run-not-found with a clear error state

## Technical Hints

- SSE endpoint already exists in `foundry/src/api/routes.ts`
- Frontend API client in `ui/src/api/client.ts` has `getEvents` but no SSE helper
- Run states and transitions are in `foundry/src/domain/runState.ts`
- Use React Router for the new route; existing routes are in `ui/src/App.tsx`

## Acceptance Criteria

- [ ] `/runs/:id` route renders run metadata and events
- [ ] Events update in real-time without page refresh
- [ ] Action buttons are conditionally rendered based on run state
- [ ] Clicking an action button calls the correct API endpoint
- [ ] 404-style error state shown for nonexistent run IDs
- [ ] Page is responsive and matches existing UI style

## Scope

- **In scope**: Run detail page, live event stream, action buttons
- **Out of scope**: Artifact viewer, diff viewer, log download
```

---

## Example 5: Decomposed Feature (Parent + Sub-Issues)

### User request

> "Add user authentication, API rate limiting, and audit logging to the service"

---

### Agent scope analysis

Evaluating Workflow step 3 heuristics:

- **Heuristic 1 (many ACs spanning different concerns)**: Auth alone needs ≥3
  ACs (token issuance, refresh, expiry); rate limiting needs ≥3 (enforcement,
  headers, config); audit logging needs ≥3 (event capture, storage, query).
  Total: 9+ ACs across three unrelated modules. ✅ **Strong signal.**

- **Heuristic 2 (3+ distinct system areas)**: Auth/identity, API
  gateway/infrastructure, observability/logging — three independent domains.
  ✅ **Strong signal.**

- **Heuristic 3 (independent work streams)**: The description contains
  "authentication, **and** API rate limiting, **and** audit logging" — three
  separate imperative goals with no shared implementation dependency.
  ✅ **Strong signal.**

**Decision**: Three strong signals → propose decomposition.

---

### Confirmation dialogue presented to the user

```
This request spans multiple distinct work streams. Here is my proposed breakdown:

**Parent**: `feat(service): add user authentication, rate limiting, and audit logging`

Sub-issues:
1. `feat(auth): implement user authentication` — add JWT-based login, token
   refresh, and session management to the service
2. `feat(api): add request rate limiting` — enforce per-client request limits
   with 429 responses and configurable thresholds
3. `feat(observability): add audit logging` — record authentication and
   security-relevant events to a queryable audit log

Shall I create a parent issue with these sub-issues, or would you prefer a
single issue?
```

*User replies: "Yes, create the parent and sub-issues."*

---

### Parent issue spec

**Title**: `feat(service): add user authentication, rate limiting, and audit logging`

**Priority**: 2 (High)

**Labels**: `feature`, `service`

**Description**:

```markdown
## Context

The service currently has no authentication, no API rate limiting, and no audit
logging. These three capabilities are required before the service can be
considered production-ready. Each capability is an independent work stream and
is tracked as a sub-issue.

## Requirements

See sub-issues for detailed requirements:
- Sub-issue 1: feat(auth): implement user authentication
- Sub-issue 2: feat(api): add request rate limiting
- Sub-issue 3: feat(observability): add audit logging

## Technical Hints

- All three sub-issues target the same service codebase under `foundry/src/`
- Sub-issues can be implemented in parallel; there are no cross-dependencies
  between them at the implementation level

## Acceptance Criteria

- [ ] All three sub-issues are completed and merged
- [ ] Integration tests confirm the capabilities coexist without conflict

## Scope

- **In scope**: User authentication, API rate limiting, audit logging
- **Out of scope**: Authorization/RBAC, distributed rate limiting (Redis),
  log aggregation pipelines
```

---

### Sub-issue 1 spec

**Title**: `feat(auth): implement user authentication`

**Priority**: 2 (High)

**Labels**: `feature`, `auth`

**Description**:

```markdown
## Context

This is a sub-issue of feat(service): add user authentication, rate limiting,
and audit logging (PARENT_ID). The service currently has no authentication
layer; all API endpoints are unauthenticated. This sub-issue covers JWT-based
login and token lifecycle management only.

## Requirements

1. `POST /auth/login` accepts email + password and returns a signed JWT access
   token (15-minute expiry) and a refresh token (7-day expiry)
2. `POST /auth/refresh` accepts a valid refresh token and returns a new access
   token
3. `POST /auth/logout` invalidates the refresh token
4. All non-auth API endpoints require a valid JWT in the `Authorization: Bearer`
   header; return 401 for missing or invalid tokens
5. Passwords are stored as bcrypt hashes; plaintext passwords are never logged

## Technical Hints

- JWT signing key should be read from `AUTH_JWT_SECRET` environment variable
- Fastify plugin pattern: `foundry/src/api/routes.ts` shows how existing
  hooks are registered
- Use `@fastify/jwt` for token verification middleware
- Refresh tokens should be stored in the database with a revocation flag;
  `foundry/src/db/` has the existing repository pattern

## Acceptance Criteria

- [ ] `POST /auth/login` returns 200 with signed JWT and refresh token for
      valid credentials; 401 for invalid credentials
- [ ] `POST /auth/refresh` returns a new access token for a valid, non-revoked
      refresh token; 401 otherwise
- [ ] `POST /auth/logout` revokes the refresh token; subsequent refresh attempts
      return 401
- [ ] Protected endpoints return 401 for requests without a valid JWT
- [ ] Passwords are bcrypt-hashed in the database; no plaintext in logs
- [ ] Unit and integration tests cover the happy path and all error cases

## Scope

- **In scope**: JWT authentication, token refresh, logout, endpoint protection
- **Out of scope**: Rate limiting (feat/api sub-issue), audit logging
  (feat/observability sub-issue), role-based access control, OAuth/SSO
```

---

### Sub-issue 2 spec

**Title**: `feat(api): add request rate limiting`

**Priority**: 2 (High)

**Labels**: `feature`, `api`

**Description**:

```markdown
## Context

This is a sub-issue of feat(service): add user authentication, rate limiting,
and audit logging (PARENT_ID). The API currently has no rate limiting; any
client can make unlimited requests. This sub-issue covers per-client rate
limiting for all API endpoints.

## Requirements

1. All `/api/*` endpoints are subject to per-client rate limiting using a
   token bucket algorithm
2. Limits are configurable via `RATE_LIMIT_MAX` (requests per window) and
   `RATE_LIMIT_WINDOW_MS` (window duration in milliseconds) environment
   variables
3. Requests exceeding the limit receive a `429 Too Many Requests` response
   with a `Retry-After` header indicating when the client may retry
4. Rate limit state is stored in-memory (Redis upgrade is a separate issue)
5. Authenticated clients are identified by their JWT subject; unauthenticated
   clients are identified by IP address

## Technical Hints

- Fastify route plugin in `foundry/src/api/routes.ts`
- Consider `@fastify/rate-limit` plugin; it integrates with Fastify's plugin
  system and supports custom key functions
- The auth hook (to be added by the auth sub-issue) will make the JWT subject
  available on `request.user.id` — use that as the rate limit key for
  authenticated requests

## Acceptance Criteria

- [ ] All `/api/*` routes enforce the configured rate limit
- [ ] Exceeding the limit returns 429 with a correct `Retry-After` header
- [ ] Limits are configurable via `RATE_LIMIT_MAX` and `RATE_LIMIT_WINDOW_MS`
- [ ] Authenticated and unauthenticated clients are keyed separately
- [ ] Existing API tests still pass
- [ ] New tests cover rate limit enforcement, 429 response, and header
      correctness

## Scope

- **In scope**: Per-client in-memory rate limiting for API routes
- **Out of scope**: User authentication (feat/auth sub-issue), audit logging
  (feat/observability sub-issue), Redis-backed distributed rate limiting,
  WebSocket rate limiting
```

---

### Sub-issue 3 spec

**Title**: `feat(observability): add audit logging`

**Priority**: 2 (High)

**Labels**: `feature`, `observability`

**Description**:

```markdown
## Context

This is a sub-issue of feat(service): add user authentication, rate limiting,
and audit logging (PARENT_ID). There is currently no record of security-
relevant events (logins, logouts, permission denials, rate limit breaches).
This sub-issue adds a structured audit log to support compliance and incident
investigation.

## Requirements

1. The following events are recorded to the audit log: successful login,
   failed login attempt, logout, token refresh, 401 response on a protected
   endpoint, 429 rate limit breach
2. Each audit log entry includes: timestamp (UTC ISO-8601), event type,
   actor identity (user ID or IP for unauthenticated requests), target
   endpoint, HTTP status code, and a free-text detail field
3. Audit log entries are persisted to the database in an `audit_events` table
4. `GET /api/audit` returns a paginated list of audit events, accessible only
   to admin users
5. Audit log entries are never deleted (append-only); a retention policy is
   out of scope

## Technical Hints

- Add an `audit_events` table via a new Prisma migration; columns: `id`,
  `createdAt`, `eventType`, `actorId`, `targetEndpoint`, `statusCode`,
  `detail`
- Emit audit events from the relevant Fastify lifecycle hooks (onResponse or
  onError) to avoid cluttering route handlers
- The auth sub-issue's hooks will make actor identity available on the request
  object — coordinate on the interface

## Acceptance Criteria

- [ ] All six specified event types are recorded with the required fields
- [ ] `GET /api/audit` returns paginated entries and requires admin auth
- [ ] Audit entries persist across service restarts
- [ ] No audit entry is ever modified or deleted by the application
- [ ] Unit tests cover event emission for each event type
- [ ] Integration test confirms entries appear in the database after a
      simulated login/logout sequence

## Scope

- **In scope**: Audit event recording for auth and rate-limit events,
  `audit_events` table, admin query endpoint
- **Out of scope**: User authentication (feat/auth sub-issue), rate limiting
  (feat/api sub-issue), log aggregation pipelines, retention/archival policies,
  SIEM integration
```

---

### Creation sequence

**1. Create parent issue** (no `parentId`):

```json
{
  "title": "feat(service): add user authentication, rate limiting, and audit logging",
  "description": "...",
  "team": "AgentForge",
  "project": "AgentForge",
  "priority": 2
}
```

*Returns*: `{ "id": "abc-123", "identifier": "AF-42", "url": "https://linear.app/..." }`
`PARENT_ID = "abc-123"`

**2. Create sub-issue 1** (`parentId` = `PARENT_ID`):

```json
{
  "title": "feat(auth): implement user authentication",
  "description": "...",
  "team": "AgentForge",
  "project": "AgentForge",
  "priority": 2,
  "parentId": "abc-123"
}
```

*Returns*: `{ "id": "def-456", "identifier": "AF-43", "url": "https://linear.app/..." }`

**3. Create sub-issue 2** (`parentId` = `PARENT_ID`):

```json
{
  "title": "feat(api): add request rate limiting",
  "description": "...",
  "team": "AgentForge",
  "project": "AgentForge",
  "priority": 2,
  "parentId": "abc-123"
}
```

*Returns*: `{ "id": "ghi-789", "identifier": "AF-44", "url": "https://linear.app/..." }`

**4. Create sub-issue 3** (`parentId` = `PARENT_ID`):

```json
{
  "title": "feat(observability): add audit logging",
  "description": "...",
  "team": "AgentForge",
  "project": "AgentForge",
  "priority": 2,
  "parentId": "abc-123"
}
```

*Returns*: `{ "id": "jkl-012", "identifier": "AF-45", "url": "https://linear.app/..." }`

---

### Final output

| Issue | ID | URL |
|-------|----|-----|
| Parent: feat(service) | AF-42 | https://linear.app/agentforge/issue/AF-42 |
| Sub-issue 1: feat(auth) | AF-43 | https://linear.app/agentforge/issue/AF-43 |
| Sub-issue 2: feat(api) | AF-44 | https://linear.app/agentforge/issue/AF-44 |
| Sub-issue 3: feat(observability) | AF-45 | https://linear.app/agentforge/issue/AF-45 |
