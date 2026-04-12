# Scheduled Task: Continuous AI Agent Innovation Research & AgentForge Enhancement Pipeline

> **Schedule**: Every 2-3 days
> **Goal**: Keep AgentForge perpetually evolving by surfacing bleeding-edge AI agent innovations and converting the best ones into actionable Linear issues.

## Task Overview

You are operating within the **AgentForge** project — a TypeScript/Fastify-based AI development orchestration system that drives Linear issues through a deterministic state machine, using CLI-based AI agents (Claude Code, Codex, Cursor) as subprocess runtimes.

This is a **recurring scheduled task**. Each run you must:

1. Load the research log to see what was already reviewed (avoid duplication)
2. Search for **new, bleeding-edge** innovations you haven't covered yet
3. Evaluate findings against AgentForge's architecture
4. Select the top 3 novel enhancements
5. Create structured Linear issues for each
6. Update the research log with everything you reviewed this run

---

## Phase 0: Load Research Memory

**Before doing ANY research**, read the research log file:

```
.prompts/research-log.jsonl
```

This is a JSONL file (one JSON object per line). Each entry looks like:

```json
{
  "date": "2026-04-09",
  "source": "Hermes Agent by Jovanovic",
  "sourceType": "repo|paper|blog|tweet|release",
  "url": "https://github.com/...",
  "summary": "Self-improving agent loop with reflection-based plan repair",
  "relevanceToAgentForge": "High — maps directly to our plan repair gap",
  "disposition": "issue_created|considered_not_selected|too_early|already_exists|out_of_scope",
  "linearIssueId": "AF-42 or null",
  "expiresAt": "2026-04-23",
  "tags": ["self-improvement", "plan-repair", "reflection"]
}
```

### Deduplication Rules

- **Skip** any source whose `expiresAt` is in the future (it was recently reviewed)
- **Re-review** sources whose `expiresAt` has passed (they may have significant updates)
- **Never** create a duplicate Linear issue for a source that already has a `linearIssueId`
- If a previously "considered_not_selected" source has major new developments, it can be reconsidered

If the file does not exist, create it. If it exists, read all entries and build your "already reviewed" set before proceeding.

---

## Phase 1: Research — Bleeding-Edge Innovations

### 1.1 Primary Focus: Frontier & "Hipster" Research (70% of effort)

This is your **main research vector**. Search for what the cutting-edge AI researchers and builders are releasing RIGHT NOW. Do NOT just look at established frameworks with 10k+ stars.

**Search strategies** (use web search for all of these):

#### A. Researcher-Driven Innovation
Search for recent work by key figures pushing the boundaries:
- **Andrej Karpathy** — new publications, tweets, repos on agent architectures, memory, LLM training patterns
- **Jovanovic et al.** — Hermes agent, self-improving loops, reflection mechanisms
- **Jim Fan / NVIDIA** — Voyager-style agents, embodied AI, open-ended agent learning
- **Harrison Chase / LangChain** — latest LangGraph patterns, agent memory, tool-use innovations
- **Shunyu Yao** — ReAct, Tree of Thoughts, new reasoning-action patterns
- **Lilian Weng / OpenAI** — agent systems surveys, planning mechanisms
- Any other researchers publishing on agent orchestration this week

Search queries like: `"[researcher name]" AI agent 2026`, `"[researcher name]" new release`, `"[researcher name]" github`

#### B. Paradigm-Shifting Concepts
Search for emerging paradigms that could reshape agent orchestration:
- **Agent memory architectures** — MemPaLAs, MemGPT evolution, episodic/semantic memory for agents, long-term context persistence across runs
- **Self-improving agent loops** — Agents that learn from their own execution traces, meta-learning from failures, Hermes-style reflection
- **Cognitive architectures for coding agents** — Beyond simple prompt→response; inner monologue, world models, predictive planning
- **Agent-to-agent communication protocols** — Novel ways agents negotiate, delegate, and share context (not just supervisor→worker)
- **Reinforcement learning from execution** — RL-based optimization of agent orchestration policies (NVIDIA ProRL patterns)
- **Speculative execution for agents** — Running multiple plan branches in parallel, picking the best result
- **Streaming / incremental artifacts** — Agents that produce usable partial outputs as they work, not just final results
- **Token-budget-aware planning** — Plans that adapt granularity based on available token budget and cost constraints

Search queries like: `AI agent memory architecture 2026 new`, `self-improving coding agent`, `agent reflection loop open source`, `cognitive architecture LLM agent`, `speculative execution AI agent`

#### C. Fresh GitHub Discoveries
Search GitHub specifically for **new** repos (created in the last 2-4 weeks) related to agent orchestration:
- `github trending AI agent orchestration` (check what's new this week)
- `github "agent" "orchestration" created:>2026-03-15` style searches
- Look for repos under 1000 stars that show novel approaches (the next big thing before it's big)

### 1.2 Secondary Focus: Established Framework Updates (30% of effort)

Check for **significant new releases or breaking updates** from known frameworks. Only flag these if they introduce a genuinely new capability, not just version bumps:

- Google Scion, OpenAI Symphony/Swarm, Shannon, AgentFlow, Alphora
- LangGraph, CrewAI, AutoGen, Magentic-One
- RuFlow, SkillOrchestra, AI21 Maestro

Search: `"[framework name]" new release 2026 April`, `"[framework name]" changelog`

### 1.3 Filtering Against Research Memory

After gathering candidates, cross-reference every finding against the loaded research log:
- If a source appears in the log with a future `expiresAt` → **skip entirely**
- If a source appears with an expired `expiresAt` → **re-evaluate only if there are notable changes**
- If a source is genuinely new → **full evaluation**

---

## Phase 2: AgentForge Architecture Context

You MUST understand these aspects of AgentForge before evaluating enhancements.

### Core Architecture

AgentForge is a **two-part monorepo**:
- **`foundry/`** — Fastify 5 backend: orchestrator, agents, DB (PostgreSQL + Prisma 7), webhooks, sync
- **`ui/`** — Vite + React 19 dashboard with SSE live updates

### Agent Orchestration Model

- **Agents are CLI subprocesses**, not API clients. `ProcessRunner` spawns `claude` (Claude Code CLI) and `codex` (Codex CLI) as child processes, passes prompts via stdin, parses structured JSON output wrapped in `BEGIN_STRUCTURED_OUTPUT` / `END_STRUCTURED_OUTPUT`.
- **Static agent-to-stage mapping**: Claude Code handles planning, plan revision, implementation, and remediation. Codex handles plan review and code review. This is a fixed configuration — **there is no dynamic model routing**.
- **Single-agent-per-stage execution**: Each stage runs exactly one agent sequentially. There is no parallel agent execution within or across stages.

### State Machine

All transitions are explicit and deterministic (defined in `stateMachine.ts`):

```
Linear Issue → Planning (Claude) → PlanReview (Codex) → [optional PlanRevision (Claude)] →
AwaitingPlanApproval (Human) → Implementing (Claude) → AIReview (Codex) →
[optional AddressingReview (Claude) → AIReview loop] → ReadyForHumanReview → Done
```

Failure states: `AIBlocked`, `HumanClarificationNeeded`, `Failed`. `RESET_TO_TODO` returns to the beginning (no partial retry).

### Policy Engine

`policyEngine.ts` enforces stage gates: plan version matching before execution, PR + execution report before review, green checks before ready state, allowed/protected path constraints for the executor.

### Key Limitations (Enhancement Opportunities)

1. **No dynamic model routing** — Agent-to-model mapping is hardcoded per stage
2. **No parallel agent execution** — Everything runs sequentially, one agent at a time
3. **No plan repair** — If implementation fails partway, the run blocks or resets to Todo
4. **No agent performance tracking** — No historical data on agent success rates, duration, or cost per stage/task type
5. **No graceful degradation** — If an agent process times out or crashes, the run enters `AIBlocked` with no automatic retry or fallback
6. **No test-time compute scaling** — Same timeout and resource allocation regardless of task complexity
7. **Single review cycle** — Plan review gets one revision cycle; code review allows remediation loops but no escalation to different/stronger models
8. **No agent memory across runs** — Each run starts from scratch; agents don't learn from prior successes/failures on similar tasks
9. **No streaming/incremental output** — Agents produce output only at the end; no visibility into intermediate progress
10. **No speculative execution** — Cannot try multiple approaches in parallel and pick the best

### Tech Stack

Node.js 22+, TypeScript (strict), Fastify 5, PostgreSQL + Prisma 7, Zod, pino, `@linear/sdk`, `@octokit/rest`, Vitest

---

## Phase 3: Evaluate & Select Top 3 Enhancements

### Evaluation Criteria

Score each candidate enhancement on these dimensions (1-5 scale):

| Criterion | Weight | Description |
|-----------|--------|-------------|
| **Impact** | 30% | How much does this improve orchestration quality, reliability, or cost? |
| **Feasibility** | 25% | Can this be implemented within the existing architecture without a rewrite? |
| **Alignment** | 20% | Does this fit AgentForge's design principles (explicit state machine, CLI agents, artifact-first, DI)? |
| **Novelty** | 15% | Does this bring a genuinely new capability vs. incremental improvement? |
| **Evidence** | 10% | Is there production evidence or benchmarks supporting this approach? |

### Selection Rules

- Select exactly **3 enhancements**
- They must be **complementary** (not overlapping in scope)
- Each must be **implementable as a distinct feature** (not a vague "improve everything")
- Prefer enhancements that leverage AgentForge's existing strengths (state machine, artifact model, multi-repo support)
- At least one enhancement should address **reliability/fault tolerance**
- At least one should address **performance/cost optimization**
- **Strongly prefer bleeding-edge innovations** over incremental improvements to existing patterns
- **Do NOT propose enhancements that were already created as Linear issues** (check the research log)

### Document Your Reasoning

For each selected enhancement, write a 2-3 paragraph rationale explaining:
1. What specific innovation/repo/researcher inspired this
2. How it maps to AgentForge's architecture
3. What concrete improvement users would see

---

## Phase 4: Create Linear Issues

### Pre-Requisites

Before creating issues, you must discover the team and project IDs using the correct MCP server:

- **AgentForge / Hidday workspace** — use the `user-hidday-linear` MCP server (private workspace).
- **Prysmic workspace** — use the `plugin-linear-linear` MCP server (OAuth-routed to Prysmic).

1. Call `list_teams` on the appropriate MCP server to get available teams
2. Call `list_projects` on the same server to find the target project
3. Use these IDs when creating issues

If the Linear MCP server requires authentication, call `mcp_auth` on that server first (e.g. `plugin-linear-linear` for Prysmic).

### Issue Format

Each issue MUST follow the AgentForge structured issue format exactly. Use the `save_issue` tool on the appropriate MCP server (`user-hidday-linear` for AgentForge/Hidday, `plugin-linear-linear` for Prysmic).

#### Title Convention

Format: `<type>(<scope>): <imperative summary>`

Types: `feat` (new functionality), `fix` (bug fix), `refactor` (restructuring), `chore` (build/CI/deps), `perf` (performance improvement)

Rules:
- Imperative mood ("add", not "added" or "adds")
- Scope is the module or area affected (e.g. `orchestrator`, `agents`, `runtime`, `api`)
- Under 80 characters total
- No trailing period

#### Description Template

Every issue description MUST use this exact structure:

```markdown
## Context

[1-3 sentences: why this work is needed. Reference the specific innovation/repo that inspired this and how it applies to AgentForge. Include a URL to the source.]

## Requirements

1. [Concrete, testable requirement]
2. [Another requirement]
3. [...]

## Technical Hints

- [Relevant files, APIs, patterns in the AgentForge codebase]
- [Known constraints or integration points]

## Acceptance Criteria

- [ ] [Specific, verifiable checklist item]
- [ ] [Another checklist item]
- [ ] [Tests pass, lint clean, etc.]

## Scope

- **In scope**: [What this issue covers]
- **Out of scope**: [What this issue explicitly does NOT cover]
```

#### Priority

Use Linear priority scale:
- 1 = Urgent (blocking production)
- 2 = High (needed this cycle)
- 3 = Medium (important but not time-sensitive)
- 4 = Low (nice-to-have)

Most enhancement issues should be priority **2** or **3**.

#### Labels

Apply appropriate labels:
- **Type labels**: `feature`, `refactor`, `perf` (match the title type)
- **Scope labels**: Match the `(<scope>)` from the title
- Do NOT set `ai:*` labels — the orchestrator manages those automatically

### Creating Each Issue

For each of the 3 enhancements, call the `save_issue` tool on the appropriate MCP server (see Pre-Requisites) with:

```json
{
  "title": "<formatted title>",
  "description": "<full markdown description following template>",
  "team": "<team name or ID from list_teams>",
  "project": "<project name or ID from list_projects>",
  "priority": <2 or 3>
}
```

Important MCP notes:
- The tool is `save_issue` on the correct Linear MCP server (`user-hidday-linear` for AgentForge/Hidday, `plugin-linear-linear` for Prysmic)
- When passing the description, use real newlines in the markdown content, NOT escaped `\n` characters
- The `team` parameter accepts team name, key, or UUID
- The `project` parameter accepts project name, ID, or slug

---

## Phase 5: Update Research Log

**This phase is CRITICAL for deduplication across runs.**

After completing all research and issue creation, append entries to `.prompts/research-log.jsonl` for **every source you reviewed this run** — not just the ones that became issues.

### Entry Format

One JSON object per line, appended to the file:

```json
{
  "date": "<today's date, YYYY-MM-DD>",
  "source": "<human-readable name>",
  "sourceType": "<repo|paper|blog|tweet|release>",
  "url": "<URL to the source>",
  "summary": "<1-2 sentence summary of the innovation>",
  "relevanceToAgentForge": "<High|Medium|Low — brief explanation>",
  "disposition": "<issue_created|considered_not_selected|too_early|already_exists|out_of_scope>",
  "linearIssueId": "<issue identifier like AF-42, or null if no issue created>",
  "expiresAt": "<date when this entry should be re-evaluated, YYYY-MM-DD>",
  "tags": ["<tag1>", "<tag2>"]
}
```

### Expiration Policy

Set `expiresAt` based on disposition:

| Disposition | Expiration | Rationale |
|-------------|------------|-----------|
| `issue_created` | +30 days | Don't revisit; the issue tracks the work now |
| `considered_not_selected` | +14 days | Re-check in ~2 weeks for significant updates |
| `too_early` | +7 days | Promising but immature; check again soon |
| `already_exists` | +30 days | AgentForge already has this; long cooldown |
| `out_of_scope` | +30 days | Not relevant; long cooldown |

### Writing the Log

Read the existing file contents, then append your new entries. Do NOT overwrite existing entries. If the file doesn't exist, create it with your entries.

Use a shell command to append:
```bash
echo '<json line>' >> .prompts/research-log.jsonl
```

Or write the full file if creating for the first time.

### Committing the Log Back to the Repo

**This step is mandatory.** After writing all entries, commit and push the updated log so the next scheduled run can read it:

```bash
git add .prompts/research-log.jsonl
git commit -m "chore(research-log): update from scheduled run <today's date>"
git push
```

If the push fails due to a conflict (another run pushed first), pull and rebase before pushing:
```bash
git pull --rebase && git push
```

**Without this step, the deduplication memory is lost and every run will re-review the same sources.**

---

## Phase 6: Output Summary

After completing all phases, produce a summary report.

### Run Metadata
- **Run date**: today's date
- **Sources reviewed this run**: count
- **Sources skipped (already in log)**: count
- **New sources discovered**: count

### Research Highlights
For the most interesting 3-5 discoveries this run:
- Name and URL
- Why it's interesting for agent orchestration broadly
- Specific relevance to AgentForge

### Issues Created
For each of the 3 issues:
1. **Linear Issue ID & URL**
2. **Title**
3. **Inspiration source** (researcher, repo, paper)
4. **Evaluation scores** (Impact, Feasibility, Alignment, Novelty, Evidence)
5. **Weighted total score**
6. **Brief rationale** (2-3 sentences)

### Rejected Candidates
List 2-3 candidates you seriously considered but didn't select, with reasoning.

### Signals for Next Run
Note any emerging trends or sources worth watching that weren't mature enough for an issue yet (these will appear in the log as `too_early`).

---

## Constraints & Guidelines

- **Do NOT modify any code** in this task. This is research + issue creation only.
- **Do NOT create issues for things AgentForge already has** (e.g., git worktrees, idempotency, artifact storage).
- **Do NOT re-create issues that already exist in the research log** with a `linearIssueId`.
- **Be specific in Technical Hints** — reference actual file paths in the AgentForge codebase (e.g., `foundry/src/orchestrator/stateMachine.ts`, `foundry/src/runtime/AgentRunner.ts`).
- **Keep scope realistic** — each issue should be implementable in 1-2 sprints, not a multi-month rewrite.
- **Use web search liberally** — your training data may not reflect papers and repos from this week.
- **Prioritize novelty** — an unconventional idea from a 50-star repo by a sharp researcher is more valuable than a well-known pattern from a 10k-star framework.
- **Always update the research log** — even if you find nothing worth creating issues for, log what you reviewed so the next run skips it.

---

## Key File Paths for Reference

| File | Purpose |
|------|---------|
| `foundry/src/orchestrator/orchestratorService.ts` | Central coordinator |
| `foundry/src/orchestrator/stateMachine.ts` | State transition table |
| `foundry/src/orchestrator/policyEngine.ts` | Stage gate enforcement |
| `foundry/src/runtime/AgentRunner.ts` | Agent dispatch |
| `foundry/src/runtime/ProcessRunner.ts` | CLI subprocess execution |
| `foundry/src/runtime/ClaudeCodeRunner.ts` | Claude Code CLI wrapper |
| `foundry/src/runtime/CodexRunner.ts` | Codex CLI wrapper |
| `foundry/src/agents/promptRenderer.ts` | Prompt template rendering |
| `foundry/src/domain/types.ts` | AGENT_STAGES mapping |
| `foundry/src/config/env.ts` | Environment configuration |
| `foundry/src/config/repoRegistry.ts` | Multi-repo routing |
| `foundry/prisma/schema.prisma` | Database schema |
| `foundry/repos.config.json` | Repository configuration |
| `foundry/README.md` | Architecture documentation |
| `.prompts/research-log.jsonl` | **Research memory — READ THIS FIRST** |
