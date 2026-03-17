# ai-dev-orchestrator-cli

A production-style sample repository demonstrating how to orchestrate AI development workflows using **Claude Code CLI** and **Codex CLI** as subprocess-based agent runtimes.

## Why CLI-Based Agents?

This project intentionally treats AI agents as **external CLI runtimes** rather than hosted API clients:

- **Claude Code CLI** (`claude`) is used for planning, plan revision, implementation, and remediation
- **Codex CLI** (`codex`) is used for plan review and code review (second-opinion from a different model family)
- **No direct Anthropic API** calls are made anywhere in the codebase
- **No Anthropic SDK** is listed as a dependency

The orchestrator spawns each agent as a child process, passes prompts via stdin, captures stdout/stderr, parses structured JSON output, and advances a deterministic state machine.

## Workflow

```
Linear Issue Created
    |
    v
[Planning] ------------ Claude Code CLI generates plan (v1)
    |
    v
[PlanReview] ---------- Codex CLI reviews the plan
    |                          |
    | PLAN_REVIEW_APPROVED     | PLAN_REVIEW_CHANGES_REQUESTED
    |                          v
    |                  [PlanRevision] ---- Claude CLI revises plan (as "the boss")
    |                          |            accepts/dismisses each finding
    |                          | PLAN_REVISED
    |                          v
    +----------------> [Awaiting Plan Approval] ---- Human reviews
    |
    v  (PLAN_APPROVED, explicit approvedPlanVersion recorded)
[Implementing] ------- Claude Code CLI implements the plan
    |
    v
[AI Review] ---------- Codex CLI reviews the implementation
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

## AI Plan Review -- "The Boss" Pattern

After the planner creates an initial plan, Codex CLI reviews it as a second opinion. If changes are requested, Claude Code CLI revises the plan -- but it acts as **the lead engineer**, not a subordinate:

- **Accepts** findings that identify genuine gaps, missing requirements, or overlooked risks
- **Dismisses** findings that represent scope creep, stylistic preferences, or misalignment with the original requirements
- **Partially incorporates** findings where the concern is valid but the suggested fix is off-target

Each disposition includes a rationale visible to the human reviewer. After one revision cycle, the plan always proceeds to human approval -- no infinite review loops.

## State Machine

All state transitions are explicit and deterministic.

| From State | Event | To State |
|---|---|---|
| Todo | RUN_REQUESTED | Planning |
| Planning | PLAN_CREATED | PlanReview |
| PlanReview | PLAN_REVIEW_APPROVED | AwaitingPlanApproval |
| PlanReview | PLAN_REVIEW_CHANGES_REQUESTED | PlanRevision |
| PlanReview | BLOCKED | AIBlocked |
| PlanReview | NEEDS_HUMAN_CLARIFICATION | HumanClarificationNeeded |
| PlanRevision | PLAN_REVISED | AwaitingPlanApproval |
| PlanRevision | BLOCKED | AIBlocked |
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

Each stage produces a raw transcript and a structured artifact:

| Artifact Type | Description |
|---|---|
| `Plan` | Structured implementation plan (versioned) |
| `PlanReview` | Codex's review of the plan |
| `PlanRevision` | Dispositions from the planner's revision pass |
| `ExecutionReport` | Implementation results and check statuses |
| `Review` | Codex's code review with findings |
| `Remediation` | Resolution of code review findings |
| `PlannerTranscript` | Raw CLI output from planning |
| `PlanReviewerTranscript` | Raw CLI output from plan review |
| `PlanReviserTranscript` | Raw CLI output from plan revision |
| `ExecutorTranscript` | Raw CLI output from execution |
| `ReviewerTranscript` | Raw CLI output from code review |
| `RemediationTranscript` | Raw CLI output from remediation |

## Operational Notes

### Explicit Plan Approval

Plan approval is tracked via `approvedPlanVersion` on the run record. The policy engine verifies version match before execution.

### Webhook Idempotency

Duplicate webhook deliveries are handled via a `processed_events` table with a unique constraint.

### Concurrency Guard

Only one active (non-terminal) run per Linear issue. Duplicate `startRun()` calls return the existing run.

### CLI Invocation

CLI commands and base arguments are configurable via `CLAUDE_CODE_ARGS_BASE` / `CODEX_ARGS_BASE`. Prompts are passed via stdin.

### RESET_TO_TODO Limitation

`RESET_TO_TODO` always returns to Todo. Prior state is not preserved (v1 limitation).

## Mock Mode vs Real Mode

### Mock Mode (default)

```
AGENT_RUNTIME_MODE=mock
```

- No real CLI installations required
- Deterministic canned outputs for all 6 agent stages
- Plan reviewer returns `changes_requested`, triggering the revision flow
- Code reviewer: first call returns `changes_requested`, second returns `approved`

### Real Mode

```
AGENT_RUNTIME_MODE=real
```

- Spawns actual CLI child processes with stdin piping
- Requires `claude` and `codex` CLIs installed locally

## Quick Start

```bash
cd ai-dev-orchestrator-cli
pnpm install

# Set up PostgreSQL
docker run -d --name ai-orch-pg \
  -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=ai_orchestrator \
  -p 5432:5432 postgres:16

cp .env.example .env
pnpm db:push && pnpm db:generate

# Run full workflow simulation
pnpm simulate:run
```

The simulation walks through:
1. Planning (Claude) -> AI Plan Review (Codex) -> Plan Revision (Claude, boss mode) -> AwaitingPlanApproval
2. Human approval (explicit `approvedPlanVersion`)
3. Execution (Claude) -> Code Review (Codex, changes_requested) -> Remediation (Claude) -> Code Review (Codex, approved) -> Ready for Human Review

## API Routes

| Method | Path | Description |
|---|---|---|
| GET | `/health` | Health check |
| POST | `/webhooks/linear` | Linear webhook (with idempotency) |
| POST | `/webhooks/github` | GitHub webhook |
| POST | `/simulate/run/:issueId` | Trigger simulated workflow |
| POST | `/simulate/comment-command` | Simulate a Linear command |

## Tech Stack

Node.js 20+, TypeScript (strict), Fastify 5, PostgreSQL + Prisma, Zod, pino, pnpm

## Design Principles

- **Agents are runtimes, not API calls** -- all AI interaction via CLI subprocess
- **Explicit state machine** -- every transition in a static lookup table
- **Two-tier review** -- plan review (before approval) + code review (after implementation)
- **Boss planner pattern** -- plan reviser selectively incorporates feedback, not a subordinate
- **Policy engine** -- stage gates enforce approval, version matching, and check status
- **Dependency injection** -- all services accept deps via constructor
- **Artifact-first** -- every agent output stored as a versioned, typed artifact
- **Mock-first** -- full workflow runnable without external services
