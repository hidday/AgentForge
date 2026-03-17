# ai-dev-orchestrator-cli

A production-style sample repository demonstrating how to orchestrate AI development workflows using **Claude Code CLI** and **Codex CLI** as subprocess-based agent runtimes.

## Why CLI-Based Agents?

This project intentionally treats AI agents as **external CLI runtimes** rather than hosted API clients:

- **Claude Code CLI** (`claude`) is used for planning, implementation, and remediation stages
- **Codex CLI** (`codex`) is used for independent second-opinion code review
- **No direct Anthropic API** calls are made anywhere in the codebase
- **No Anthropic SDK** is listed as a dependency

The orchestrator spawns each agent as a child process, passes prompts via CLI arguments, captures stdout/stderr, parses structured JSON output, and advances a deterministic state machine. This architecture mirrors how production systems would invoke local agent CLIs.

## Workflow

```
Linear Issue Created
    |
    v
[Planning] ---- Claude Code CLI generates implementation plan
    |
    v
[Awaiting Plan Approval] ---- Human reviews and approves/rejects
    |
    v
[Implementing] ---- Claude Code CLI implements the plan
    |
    v
[AI Review] ---- Codex CLI provides second-opinion review
    |               |
    |               v (if findings exist)
    |           [Addressing Review] ---- Claude Code CLI remediates
    |               |
    |               v (loops back to AI Review)
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
| Implementing | EXECUTION_STARTED | Implementing |
| Implementing | EXECUTION_FINISHED | AIReview |
| Implementing | BLOCKED | AIBlocked |
| AIReview | REVIEW_COMPLETED | ReadyForHumanReview |
| AIReview | REVIEW_FINDINGS_EXIST | AddressingReview |
| AIReview | BLOCKED | AIBlocked |
| AddressingReview | REMEDIATION_FINISHED | AIReview |
| AddressingReview | BLOCKED | AIBlocked |
| ReadyForHumanReview | HUMAN_APPROVED | Done |
| AIBlocked | RESET_TO_TODO | Todo |
| HumanClarificationNeeded | RESET_TO_TODO | Todo |

## Artifact Model

Every agent stage produces two types of artifacts stored in PostgreSQL:

1. **Raw Transcript** -- the full CLI stdout captured during execution
2. **Structured Artifact** -- the parsed, Zod-validated JSON output (Plan, ExecutionReport, Review, or Remediation)

All artifacts are versioned and linked to their parent run.

## Architecture

```
src/
  server.ts                    # Fastify server, dependency wiring
  config/env.ts                # Zod-validated environment config
  db/prisma.ts                 # Prisma client singleton

  domain/                      # Core enums and types
    runState.ts                # RunState enum
    runEvent.ts                # RunEvent enum
    types.ts                   # Domain interfaces

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
    orchestratorService.ts     # Central coordinator
    runRepository.ts           # Run persistence
    artifactRepository.ts      # Artifact persistence
    eventRepository.ts         # Event persistence

  agents/                      # Agent stage implementations
    plannerAgent.ts            # Claude Code CLI planning
    executorAgent.ts           # Claude Code CLI implementation
    reviewerAgent.ts           # Codex CLI review
    remediationAgent.ts        # Claude Code CLI remediation
    promptRenderer.ts          # Template rendering for prompts

  runtime/                     # CLI subprocess execution layer
    processRunner.ts           # Subprocess spawn + timeout + capture
    claudeCodeRunner.ts        # Claude Code CLI invocation
    codexRunner.ts             # Codex CLI invocation
    agentRunner.ts             # Runtime routing facade
    outputParser.ts            # Structured output extraction + Zod validation
    runnerTypes.ts             # Shared interfaces

  prompts/                     # Stage-specific prompt templates
    planner.system.md
    planner.user.md
    executor.system.md
    executor.user.md
    reviewer.system.md
    reviewer.user.md
    remediation.system.md
    remediation.user.md

  linear/                      # Linear integration
    linearClient.ts            # Interface + mock implementation
    linearWebhook.ts           # Fastify webhook route
    linearCommandParser.ts     # /ai-plan, /approve-plan, etc.

  github/                      # GitHub integration
    githubClient.ts            # Interface + mock implementation
    githubWebhook.ts           # Fastify webhook route

  repo/                        # Repository management
    repoRunner.ts              # Working directory setup
    repoPolicies.ts            # Path and diff validation

  mocks/                       # Deterministic mock data
    mockLinearData.ts          # Sample Linear issues
    mockGitHubData.ts          # Sample diffs and PR data
    mockCliOutputs.ts          # Canned CLI outputs per stage

  utils/                       # Shared utilities
    logger.ts                  # pino logger
    ids.ts                     # UUID generation
    time.ts                    # Timer utility
    errors.ts                  # Custom error classes
```

## Mock Mode vs Real Mode

The repo supports two runtime modes controlled by the `AGENT_RUNTIME_MODE` environment variable:

### Mock Mode (default)

```
AGENT_RUNTIME_MODE=mock
```

- No real CLI installations required
- `ProcessRunner` returns deterministic canned outputs from `mockCliOutputs.ts`
- Linear and GitHub clients use in-memory mock implementations
- Ideal for local development, demos, and testing

### Real Mode

```
AGENT_RUNTIME_MODE=real
```

- `ProcessRunner` spawns actual child processes
- Requires `claude` (Claude Code CLI) and `codex` (Codex CLI) installed locally
- Linear and GitHub clients should be replaced with real API implementations
- Prompts are sent to the real CLIs which invoke their respective AI models

## Prerequisites

- Node.js >= 20
- pnpm
- PostgreSQL (local or Docker)

## Quick Start

### 1. Clone and install

```bash
cd ai-dev-orchestrator-cli
pnpm install
```

### 2. Set up PostgreSQL

```bash
# Using Docker:
docker run -d --name ai-orch-pg \
  -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=ai_orchestrator \
  -p 5432:5432 \
  postgres:16

# Or use an existing PostgreSQL instance
```

### 3. Configure environment

```bash
cp .env.example .env
# Edit .env with your DATABASE_URL if needed
```

### 4. Run database migrations

```bash
pnpm db:push
pnpm db:generate
```

### 5. Seed example data

```bash
pnpm db:seed
```

### 6. Start the server

```bash
pnpm dev
```

### 7. Simulate a full workflow

In a separate terminal:

```bash
pnpm simulate:run
```

This walks through the complete happy path:
1. Creates a run from a mock Linear issue
2. Claude Code CLI (mocked) generates a plan
3. Plan is auto-approved
4. Claude Code CLI (mocked) implements the plan
5. Codex CLI (mocked) reviews the implementation
6. Claude Code CLI (mocked) remediates review findings
7. Issue marked Ready for Human Review

## API Routes

| Method | Path | Description |
|---|---|---|
| GET | `/health` | Health check with mode info |
| POST | `/webhooks/linear` | Linear webhook receiver |
| POST | `/webhooks/github` | GitHub webhook receiver |
| POST | `/simulate/run/:issueId` | Trigger simulated workflow |
| POST | `/simulate/comment-command` | Simulate a Linear command |

## Linear Commands

When integrated with real Linear webhooks, these comment commands control the workflow:

| Command | Action |
|---|---|
| `/ai-plan` | Start AI planning for the issue |
| `/approve-plan` | Approve the generated plan, start implementation |
| `/reject-plan` | Reject the plan, trigger re-planning |
| `/run-ai` | Start or restart the AI workflow |
| `/re-review` | Request a new review |
| `/pause-ai` | Pause the AI workflow (transition to AIBlocked) |
| `/resume-ai` | Resume a paused workflow (reset to Todo) |

## Structured Output Protocol

Every agent stage ends with a machine-parseable JSON block delimited by:

```
BEGIN_STRUCTURED_OUTPUT
{ ... validated JSON ... }
END_STRUCTURED_OUTPUT
```

The `OutputParser` finds the last delimited block, parses the JSON, and validates it against the stage-specific Zod schema. Both raw output and parsed artifacts are stored.

## Extending to Real Integrations

### Real Linear

Replace `MockLinearClient` with a real implementation using the Linear SDK:

```typescript
import { LinearClient as LinearSDK } from "@linear/sdk";

export class RealLinearClient implements LinearClient {
  private sdk: LinearSDK;
  constructor(apiKey: string) {
    this.sdk = new LinearSDK({ apiKey });
  }
  // Implement interface methods using this.sdk
}
```

### Real GitHub

Replace `MockGitHubClient` with a real implementation using Octokit:

```typescript
import { Octokit } from "@octokit/rest";

export class RealGitHubClient implements GitHubClient {
  private octokit: Octokit;
  constructor(token: string) {
    this.octokit = new Octokit({ auth: token });
  }
  // Implement interface methods using this.octokit
}
```

### Real CLI Agents

Set `AGENT_RUNTIME_MODE=real` and ensure the CLIs are installed:

```bash
# Claude Code CLI
npm install -g @anthropic-ai/claude-code

# Codex CLI
npm install -g @openai/codex
```

The `ProcessRunner` will spawn these as real child processes. No code changes needed beyond the environment variable.

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
- **Explicit state machine** -- every transition defined in a lookup table
- **Policy engine** -- stage gates prevent invalid workflow progression
- **Dependency injection** -- all services accept deps via constructor
- **Artifact-first** -- every agent output is stored as a versioned artifact
- **Mock-first development** -- full workflow runnable without external services
