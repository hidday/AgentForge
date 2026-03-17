# ai-dev-orchestrator-cli

A production-style sample repository demonstrating how to orchestrate AI development workflows using **Claude Code CLI** and **Codex CLI** as subprocess-based agent runtimes.

## Why CLI-Based Agents?

This project intentionally treats AI agents as **external CLI runtimes** rather than hosted API clients:

- **Claude Code CLI** (`claude`) is used for planning, implementation, and remediation stages
- **Codex CLI** (`codex`) is used for independent second-opinion code review
- **No direct Anthropic API** calls are made anywhere in the codebase
- **No Anthropic SDK** is listed as a dependency

The orchestrator spawns each agent as a child process, passes prompts via stdin, captures stdout/stderr, parses structured JSON output, and advances a deterministic state machine. This architecture mirrors how production systems would invoke local agent CLIs.

## Workflow

```
Linear Issue Created
    |
    v
[Planning] ---------- Claude Code CLI generates implementation plan
    |
    v
[Awaiting Plan Approval] ---- Human reviews and approves/rejects
    |
    v  (explicit approval recorded with approvedPlanVersion)
[Implementing] ------- Claude Code CLI implements the plan
    |
    v
[AI Review] ---------- Codex CLI provides second-opinion review
    |                          |
    | REVIEW_APPROVED          | REVIEW_CHANGES_REQUESTED
    |                          v
    |                  [Addressing Review] -- Claude Code CLI remediates
    |                          |
    |                          | REMEDIATION_FINISHED
    |                          v
    |                  [AI Review] (fresh review cycle)
    v
[Ready for Human Review] ---- PR marked ready, Linear updated
    |
    v
[Done] ---- Human merges
```

## State Machine

All state transitions are explicit and deterministic. No ad-hoc state mutations.

| From State | Event | To State |
|---|---|---|
| Todo | RUN_REQUESTED | Planning |
| Planning | PLAN_CREATED | AwaitingPlanApproval |
| Planning | BLOCKED | AIBlocked |
| Planning | NEEDS_HUMAN_CLARIFICATION | HumanClarificationNeeded |
| AwaitingPlanApproval | PLAN_APPROVED | Implementing |
| AwaitingPlanApproval | PLAN_REJECTED | Planning |
| AwaitingPlanApproval | BLOCKED | AIBlocked |
| AwaitingPlanApproval | NEEDS_HUMAN_CLARIFICATION | HumanClarificationNeeded |
| Implementing | EXECUTION_STARTED | Implementing |
| Implementing | EXECUTION_FINISHED | AIReview |
| Implementing | BLOCKED | AIBlocked |
| AIReview | REVIEW_APPROVED | ReadyForHumanReview |
| AIReview | REVIEW_CHANGES_REQUESTED | AddressingReview |
| AIReview | BLOCKED | AIBlocked |
| AddressingReview | REMEDIATION_FINISHED | AIReview |
| AddressingReview | BLOCKED | AIBlocked |
| ReadyForHumanReview | HUMAN_APPROVED | Done |
| AIBlocked | RESET_TO_TODO | Todo |
| HumanClarificationNeeded | RESET_TO_TODO | Todo |

## Artifact Model

Every agent stage produces two artifacts stored in PostgreSQL:

1. **Stage-specific Transcript** (e.g. `PlannerTranscript`, `ReviewerTranscript`) -- the full CLI stdout
2. **Structured Artifact** (e.g. `Plan`, `Review`) -- the parsed, Zod-validated JSON output

Artifact types: `Plan`, `ExecutionReport`, `Review`, `Remediation`, `PlannerTranscript`, `ExecutorTranscript`, `ReviewerTranscript`, `RemediationTranscript`.

All artifacts are versioned and linked to their parent run.

## Architecture

```
src/
  server.ts                    # Fastify server, dependency wiring
  config/env.ts                # Zod-validated environment config
  db/prisma.ts                 # Prisma client singleton

  domain/                      # Core enums and types
    runState.ts                # RunState enum
    runEvent.ts                # RunEvent enum (REVIEW_APPROVED, REVIEW_CHANGES_REQUESTED)
    types.ts                   # Domain interfaces (Run with approvedPlanVersion)

  schemas/                     # Zod schemas for all data structures
    taskBundle.ts              # Issue + repo + constraints bundle
    plan.ts                    # Planning output schema
    executionReport.ts         # Execution output schema
    review.ts                  # Review output schema
    remediation.ts             # Remediation output schema
    cliProtocol.ts             # Structured output protocol

  orchestrator/                # Core orchestration logic
    stateMachine.ts            # Explicit transition table
    policyEngine.ts            # Stage-gate policy assertions
    orchestratorService.ts     # Central coordinator (approval decoupled from execution)
    runRepository.ts           # Run persistence (with findActiveByIssueId)
    artifactRepository.ts      # Artifact persistence
    eventRepository.ts         # Event persistence
    idempotencyRepository.ts   # Webhook dedupe via processed_events table

  agents/                      # Agent stage implementations
    plannerAgent.ts            # Claude Code CLI planning
    executorAgent.ts           # Claude Code CLI implementation
    reviewerAgent.ts           # Codex CLI review
    remediationAgent.ts        # Claude Code CLI remediation
    promptRenderer.ts          # Template rendering for prompts

  runtime/                     # CLI subprocess execution layer
    processRunner.ts           # Subprocess spawn + timeout + stdin piping
    claudeCodeRunner.ts        # Claude Code CLI invocation (configurable args)
    codexRunner.ts             # Codex CLI invocation (configurable args)
    agentRunner.ts             # Runtime routing facade
    outputParser.ts            # Structured output extraction + Zod validation
    runnerTypes.ts             # Shared interfaces

  prompts/                     # Stage-specific prompt templates
  linear/                      # Linear integration (client, webhook, command parser)
  github/                      # GitHub integration (client, webhook)
  repo/                        # Repository management (path validation, working dirs)
  mocks/                       # Deterministic mock data (stateful reviewer mock)
  utils/                       # Shared utilities (logger, ids, time, errors)
```

## Operational Notes

### Review Event Model

The review stage uses explicit outcome events:
- `REVIEW_APPROVED` -- reviewer found no material issues, proceed to ReadyForHumanReview
- `REVIEW_CHANGES_REQUESTED` -- reviewer found blocker/important issues, proceed to AddressingReview

The orchestrator maps the `overallVerdict` field from the review artifact (`"approved"` or `"changes_requested"`) to the corresponding event. This replaces the earlier ambiguous `REVIEW_COMPLETED`/`REVIEW_FINDINGS_EXIST` model.

### Explicit Plan Approval

Plan approval is tracked via `approvedPlanVersion` on the `AiRun` record. The policy engine verifies that `approvedPlanVersion` is set and matches the plan artifact version before allowing execution. This prevents accidental execution of unapproved or stale plans after rejection and re-planning.

### Decoupled Approval and Execution

`approvePlan(runId)` and `runExecution(runId)` are separate orchestrator methods. Approval persists the `approvedPlanVersion` and transitions to Implementing. Execution loads the approved plan and invokes the executor. This separation supports retries, testing, and future async queueing.

### Webhook Idempotency

Duplicate webhook deliveries are handled via a `processed_events` table with a unique constraint on `(source, externalEventId)`. The Linear webhook handler derives a dedupe key from `{type}:{action}:{data.id}` and checks it before processing. Duplicates receive a 200 OK response without side effects.

### Concurrency Guard

Only one active (non-terminal) run is allowed per Linear issue. If `startRun()` is called for an issue that already has a non-Done run, it returns the existing run instead of creating a new one. This prevents duplicate runs from concurrent webhooks or repeated commands.

### CLI Invocation

CLI commands and base arguments are configurable via environment variables:
- `CLAUDE_CODE_COMMAND` / `CLAUDE_CODE_ARGS_BASE`
- `CODEX_COMMAND` / `CODEX_ARGS_BASE`

Prompts are passed via **stdin** rather than inline CLI arguments. This avoids shell-length limits, prevents prompt content from appearing in process listings, and improves debuggability.

### Artifact Types

Raw CLI transcripts are stored with stage-specific types (`PlannerTranscript`, `ExecutorTranscript`, `ReviewerTranscript`, `RemediationTranscript`) rather than a generic `RawTranscript`, making it straightforward to query transcripts for a specific stage.

### RESET_TO_TODO Limitation

`RESET_TO_TODO` always transitions to the `Todo` state regardless of prior state. Prior meaningful state is not preserved. This is a v1 simplification -- the orchestrator can re-trigger the appropriate stage after reset.

## Mock Mode vs Real Mode

### Mock Mode (default)

```
AGENT_RUNTIME_MODE=mock
```

- No real CLI installations required
- `ProcessRunner` returns deterministic canned outputs from `mockCliOutputs.ts`
- Mock reviewer is stateful: first call returns `changes_requested`, second call returns `approved`
- Linear and GitHub clients use in-memory mock implementations

### Real Mode

```
AGENT_RUNTIME_MODE=real
```

- `ProcessRunner` spawns actual child processes with stdin piping
- Requires `claude` (Claude Code CLI) and `codex` (Codex CLI) installed locally
- Linear and GitHub clients should be replaced with real API implementations

## Prerequisites

- Node.js >= 20
- pnpm
- PostgreSQL (local or Docker)

## Quick Start

### 1. Install

```bash
cd ai-dev-orchestrator-cli
pnpm install
```

### 2. Set up PostgreSQL

```bash
docker run -d --name ai-orch-pg \
  -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=ai_orchestrator \
  -p 5432:5432 \
  postgres:16
```

### 3. Configure

```bash
cp .env.example .env
```

### 4. Database setup

```bash
pnpm db:push
pnpm db:generate
```

### 5. Seed example data

```bash
pnpm db:seed
```

### 6. Start server

```bash
pnpm dev
```

### 7. Simulate full workflow

```bash
pnpm simulate:run
```

This walks through the corrected happy path:
1. Creates a run, Claude Code CLI (mocked) generates a plan
2. Explicit plan approval recorded (approvedPlanVersion set)
3. Claude Code CLI (mocked) implements the plan
4. Codex CLI (mocked) reviews -- returns changes_requested
5. Claude Code CLI (mocked) remediates findings
6. Codex CLI (mocked) re-reviews -- returns approved
7. Issue marked Ready for Human Review

## API Routes

| Method | Path | Description |
|---|---|---|
| GET | `/health` | Health check with mode info |
| POST | `/webhooks/linear` | Linear webhook receiver (with idempotency) |
| POST | `/webhooks/github` | GitHub webhook receiver |
| POST | `/simulate/run/:issueId` | Trigger simulated workflow |
| POST | `/simulate/comment-command` | Simulate a Linear command |

## Linear Commands

| Command | Action |
|---|---|
| `/ai-plan` | Start AI planning for the issue |
| `/approve-plan` | Approve the plan and start execution |
| `/reject-plan` | Reject the plan, trigger re-planning |
| `/run-ai` | Start or restart the AI workflow |
| `/re-review` | Request a new review |
| `/pause-ai` | Pause (transition to AIBlocked) |
| `/resume-ai` | Resume (reset to Todo) |

## Extending to Real Integrations

### Real CLI Agents

Set `AGENT_RUNTIME_MODE=real` and configure the CLI commands:

```bash
CLAUDE_CODE_COMMAND=claude
CLAUDE_CODE_ARGS_BASE=--print --output-format json
CODEX_COMMAND=codex
CODEX_ARGS_BASE=--approval-mode full-auto -q
```

Adjust `*_ARGS_BASE` to match your installed CLI versions. The `ProcessRunner` spawns these as real child processes with prompts piped via stdin.

### Real Linear / GitHub

Replace `MockLinearClient` / `MockGitHubClient` with implementations using the Linear SDK or Octokit. The interface contracts are stable -- no orchestration changes needed.

## Tech Stack

- **Runtime**: Node.js 20+
- **Language**: TypeScript (strict mode)
- **Server**: Fastify 5
- **Database**: PostgreSQL + Prisma ORM
- **Validation**: Zod
- **Logging**: pino
- **Package Manager**: pnpm

## Design Principles

- **Agents are runtimes, not API calls** -- all AI interaction via CLI subprocess
- **Explicit state machine** -- every transition in a static lookup table
- **Policy engine** -- stage gates enforce approval, version matching, and check status
- **Dependency injection** -- all services accept deps via constructor
- **Artifact-first** -- every agent output stored as a versioned, typed artifact
- **Mock-first development** -- full workflow runnable without external services
- **Idempotent webhooks** -- dedupe layer prevents duplicate processing
- **One active run per issue** -- concurrency guard prevents parallel runs
