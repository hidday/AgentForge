# Scheduled Task: Continuous AI Agent Innovation Research & AgentForge Enhancement Pipeline

> **Schedule**: Weekly (reduced from every 2-3 days after the 2026-08-01 backlog cleanup — the previous cadence + quota produced ~170 issues, of which ~93% were duplicates of a handful of themes)
> **Goal**: Keep AgentForge evolving by surfacing genuinely new, feasible enhancements — while keeping the open backlog small enough that a daily implementation agent can actually drain it. **Creating zero issues is a successful run.** The default outcome of a run is "nothing new worth adding"; an issue is the exception, not the deliverable.

## Task Overview

You are operating within the **AgentForge** project — a TypeScript/Fastify-based AI development orchestration system that drives Linear issues through a deterministic state machine, using CLI-based AI agents (Claude Code, Codex, Cursor) as subprocess runtimes.

This is a **recurring scheduled task**. Each run you must:

1. Load the research log to see what was already reviewed (avoid duplication)
2. **Check the open Linear backlog and the actual codebase** (Phase 0.5) — this gates everything else
3. Search for new innovations you haven't covered yet
4. Evaluate findings against AgentForge's architecture and current backlog
5. Select **at most 1** enhancement (zero is fine and expected on most runs)
6. Create a structured Linear issue only if it passes every gate in Phase 3
7. Update the research log with everything you reviewed this run

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

## Phase 0.5: Backlog & Codebase Reality Check (MANDATORY — this phase caused the 2026 backlog explosion when it didn't exist)

The research log dedupes by **source** (paper/repo URL). That is not enough: the same *capability theme* (e.g. "retry with backoff", "episodic memory", "cost telemetry") arrives from a new source every week and previously produced 20+ near-identical issues per theme. Dedup must happen at the **theme/capability level against the open backlog and the shipped code**, not just at the source level.

### 0.5.1 Backlog pressure valve (hard rule)

Call `list_issues` on the Linear MCP server filtered to the AgentForge project, states Todo + Backlog + In Progress.

- If **≥ 10 open issues** exist → **create NO new issues this run.** Do the research, update the log, and stop. The pipeline is already full; adding more only dilutes the daily implementation agent's focus.
- If < 10, you may create at most 1 issue (subject to the remaining gates).

### 0.5.2 Theme-level duplication gate (hard rule)

For every candidate enhancement, before scoring it:

1. Search the open issues (`list_issues` with `query`) for the candidate's capability keywords (e.g. "retry", "memory", "telemetry", "routing", "dispatch", "checkpoint").
2. If ANY open issue covers the same capability — even partially, even from a different research source — **do not create a new issue.** If the new source materially strengthens the existing issue, add a short comment on the existing issue instead (link + one paragraph on what it adds).
3. Also search recently canceled issues (`includeArchived`, canceled states). If the same theme was canceled in a triage as "premature" or "over-engineered", it needs *evidence the situation changed* (e.g. the prerequisite it lacked has now shipped) — a new paper on the same idea is NOT such evidence.

### 0.5.3 Codebase reality check (hard rule)

Do NOT trust the "Key Limitations" list in Phase 2 or your memory of the architecture — the codebase evolves between runs and stale limitation lists previously generated issues for already-shipped features (model routing, skill memory, SSE streaming were all proposed repeatedly after they shipped). Before proposing anything:

1. `git log --oneline -30` — scan recent commits for the capability area.
2. Grep/read the relevant module (e.g. `foundry/src/config/agentModels.ts`, `foundry/src/agents/distillationAgent.ts`, `foundry/src/api/runEventEmitter.ts`) to confirm the gap still exists.
3. If the capability exists (even partially), either skip the candidate or scope the issue strictly to the *verified missing part*, naming the existing code it builds on.

---

## Phase 1: Research — Innovations Worth Adopting

### 1.1 Primary Focus: Frontier Research (70% of effort)

Search for what cutting-edge AI researchers and builders are releasing. But calibrate: **a paper is a signal, not a mandate.** The bar for an issue is "AgentForge measurably needs this now and can ship it in 1-2 agent runs", not "this is the newest idea in the field". Prefer proven, boring patterns that close a verified gap over speculative architectures — the 2026 backlog audit canceled ~50 issues whose only justification was a fresh arXiv ID.

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

### Key Limitations (VERIFY BEFORE USE — see Phase 0.5.3)

⚠️ This list goes stale between runs. It is a starting hypothesis only; every entry MUST be re-verified against the code before being cited in an issue. Status as of 2026-08-01:

1. ~~No dynamic model routing~~ — **SHIPPED**: role-tier routing exists in `foundry/src/config/agentModels.ts` (lead/research/review tiers, env-configurable). Complexity-based dynamic routing was evaluated and deliberately rejected as premature.
2. **No parallel agent execution** — still true, deliberately deferred (sequential determinism is a design choice for now)
3. **No plan repair / partial retry** — tracked by open issue HID-186; do not create more issues on this theme
4. **No token/cost telemetry** — tracked by open issue HID-163; do not create more issues on this theme
5. **No automatic retry on subprocess failure** — tracked by open issue HID-167; do not create more issues on this theme
6. ~~No test-time compute scaling / token budgets~~ — deliberately deferred until HID-163 provides measurement data. Do not propose budget/timeout optimizers before telemetry exists.
7. **Single reviewer per review stage** — cross-family review exists (Codex reviews Claude's work); multi-model panels were evaluated and rejected as a cost multiplier. Adversarial plan critique is tracked by HID-93.
8. ~~No agent memory across runs~~ — **SHIPPED**: skill distillation + planner injection (`distillationAgent.ts`, `agentSkillRepository.ts`). Run-outcome episodic memory is tracked by HID-188. Known small gap: executor prompts don't receive skills yet.
9. ~~No streaming/incremental output~~ — **SHIPPED**: SSE streaming via `runEventEmitter.ts` + `useSSE.ts` with throttled process output.
10. **No speculative execution** — deliberately rejected (premature; sequential pipeline works)

### Tech Stack

Node.js 22+, TypeScript (strict), Fastify 5, PostgreSQL + Prisma 7, Zod, pino, `@linear/sdk`, `@octokit/rest`, Vitest

---

## Phase 3: Evaluate & Select AT MOST ONE Enhancement

### Evaluation Criteria

Score each candidate enhancement on these dimensions (1-5 scale):

| Criterion | Weight | Description |
|-----------|--------|-------------|
| **Impact** | 35% | How much does this improve orchestration quality, reliability, or cost — for the gaps that actually exist today? |
| **Feasibility** | 30% | Can this be implemented in 1-2 agent runs within the existing architecture, without new infrastructure (no new DBs, no new state machine rewrite)? |
| **Alignment** | 20% | Does this fit AgentForge's design principles (explicit state machine, CLI agents, artifact-first, DI) AND its current roadmap priorities? |
| **Evidence** | 10% | Is there production evidence supporting this approach? A single benchmark in one paper is weak evidence. |
| **Novelty** | 5% | Genuinely new capability vs. incremental. Novelty is a tiebreaker, never a justification. |

### Selection Rules

- Select **at most 1 enhancement per run — and only if it scores ≥ 4.0 weighted**. If nothing clears the bar, create nothing and say so in the summary. This is the expected outcome for most runs.
- It must pass ALL Phase 0.5 gates: backlog < 10 open issues, no theme overlap with open or triage-canceled issues, gap verified in the current code.
- It must be **implementable in 1-2 agent runs** (roughly: one Prisma migration max, a handful of files, no new external services).
- Prefer enhancements that leverage AgentForge's existing strengths (state machine, artifact model, skill memory, SSE) and reference the actual code they build on.
- **Prefer boring, proven patterns that close verified gaps** over bleeding-edge architectures. An unconventional idea needs *stronger* evidence, not weaker.
- Red flags that should disqualify a candidate (these patterns dominated the 2026 noise purge): RL training loops, speculative/parallel execution, prompt self-evolution, formal verification layers, "knapsack"/"water-filling" budget optimizers, provenance graphs, event-sourcing rewrites — unless a prerequisite explicitly changed.

### Document Your Reasoning

For each selected enhancement, write a 2-3 paragraph rationale explaining:
1. What specific innovation/repo/researcher inspired this
2. How it maps to AgentForge's architecture
3. What concrete improvement users would see

---

## Phase 4: Create Linear Issues

### Pre-Requisites

Before creating issues, you must discover the team and project IDs from your Linear workspace via your configured Linear MCP server (e.g. `plugin-linear-linear`, or any other MCP server you have authenticated against your workspace):

1. Call `list_teams` on the Linear MCP server to get available teams
2. Call `list_projects` on the same server to find the target project
3. Use these IDs when creating issues

If the Linear MCP server requires authentication, call `mcp_auth` on that server first.

### Issue Format

Each issue MUST follow the AgentForge structured issue format exactly. Use the `save_issue` tool on your configured Linear MCP server.

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

### Creating the Issue

If (and only if) a candidate passed every gate, call the `save_issue` tool on your configured Linear MCP server (see Pre-Requisites) with:

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
- The tool is `save_issue` on the Linear MCP server you have authenticated against your workspace
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

### Issue Created (if any)
State explicitly whether an issue was created this run. "No issue created — backlog full / nothing cleared the bar" is a first-class, successful outcome. If one was created:
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
- **Prioritize feasibility and verified need over novelty** — a boring pattern that closes a confirmed gap in the current codebase beats an exciting idea from this week's arXiv. Novelty without a verified gap is noise.
- **Always update the research log** — even if you find nothing worth creating issues for, log what you reviewed so the next run skips it. A run that creates zero issues but logs 10 reviewed sources is a good run.
- **Respect the backlog cap** — the 10-open-issue pressure valve (Phase 0.5.1) is a hard rule, not a suggestion.

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
