<!-- CANONICAL SOURCE for the create-linear-issue skill examples. Edit here, then
run `node scripts/sync-skill-copies.mjs` to propagate to the global copies. -->

# Structured Issue Examples

Reference examples for the `create-linear-issue` skill. Each example shows the
full set of fields passed to `save_issue`.

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
