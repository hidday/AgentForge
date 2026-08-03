# CLAUDE.md

Guidance for AI agents working in this repository.

**What this project is:** AgentForge is an orchestration framework that delivers high-quality code through a semi-rigorous methodology — heavy investment in the plan phase, explicit review cycles, and multiple specialized agent personas driven by a deterministic state machine. Work on this repo the way the product itself works: plan before implementing, keep diffs small and reviewable, and only move to the next step with high confidence in the current one.

> **Scope note — orchestrated stage agents:** if you are running as a stage agent inside an AgentForge run (planner / plan reviewer / executor / reviewer / remediation — you were launched with a stage system prompt, and for implementation you hold an approved plan), **your stage prompt and the approved plan govern your workflow and take precedence over this file.** Skip the "How to work here (interactive sessions)" section entirely — it addresses humans and interactive agents contributing to this repo directly, and following it would duplicate work your pipeline already did (e.g. re-planning an already-approved plan, or restructuring your changes across PRs). The testing policy, design invariants, and gotchas below apply to everyone.

## Project layout

Monorepo with two packages:

- `foundry/` — Node backend orchestrator (TypeScript, Fastify, Prisma). Package manager: **pnpm**. Tests in `foundry/tests/`.
- `ui/` — React + Vite frontend. Package manager: **npm**. Tests colocated in `ui/src/`.

## Architecture in 30 seconds

A Linear issue flows through: `Planning → PlanReview → (PlanRevision) → AwaitingPlanApproval (human) → Implementing → AIReview → (AddressingReview loop) → ReadyForHumanReview → Done`, with `AIBlocked` / `HumanClarificationNeeded` / `Failed` as side states. Full details in `foundry/README.md`.

| Where | What |
|---|---|
| `foundry/src/orchestrator/stateMachine.ts` | The single source of truth for states and transitions |
| `foundry/src/orchestrator/policyEngine.ts` | All stage gates (plan-version match, allowed paths, diff limits) |
| `foundry/src/orchestrator/orchestratorService.ts` | Central coordinator wiring stages, agents, and Linear |
| `foundry/src/prompts/*.md` | Agent personas (planner, reviewers, executor, remediation…) — prompt files ARE behavior |
| `foundry/src/domain/types.ts` | `AGENT_STAGES` mapping, artifact types |
| `foundry/src/config/agentModels.ts` | Role-tier model routing (lead / research / review) |
| `foundry/src/runtime/` | CLI subprocess execution (Claude Code, Codex) and output parsing |

## Design invariants (do not violate)

- **The state machine stays explicit and deterministic.** Every transition lives in the `stateMachine.ts` table. Never add implicit transitions, side-channel state changes, or transitions triggered outside `transitionAndRecord`.
- **Gates live in the policy engine.** Preconditions for running or advancing a stage belong in `policyEngine.ts`, not scattered as ad-hoc checks in the orchestrator or runners.
- **Artifact-first.** Every stage's output is persisted as a typed artifact before the state advances. New stage outputs mean a new `ArtifactType`, not loose JSON on the run row.
- **Agents are CLI subprocesses** communicating via the `BEGIN_STRUCTURED_OUTPUT` / `END_STRUCTURED_OUTPUT` protocol with Zod-validated schemas. Don't switch a stage to direct API calls or loosen a schema to make parsing pass.
- **Each persona is one prompt pair** (`*.system.md` + `*.user.md`). Changing a prompt changes production behavior — treat prompt edits with the same rigor as code, and keep persona boundaries clean (a reviewer reviews; it doesn't fix).
- **New knobs go through `foundry/src/config/env.ts`** with Zod validation and a safe default that preserves current behavior. New risky features default **off**.

## How to work here (interactive sessions)

*Skip this section if you are an orchestrated stage agent — see the scope note at the top.*

- For anything non-trivial, write out a short plan (steps, files touched, risks) before editing — this repo's whole thesis is that plan quality determines implementation quality.
- Keep changes narrowly scoped and reviewable; one concern per PR. The orchestrator enforces `maxFilesChanged` / `maxDiffLines` on its own runs — hold manual changes to the same spirit.
- State machine or schema changes require updating the transition/enum tests in the same change, plus a Prisma migration for schema changes (additive and nullable unless there's a strong reason).

## Testing policy (required)

**Every implementation change must include tests as part of the same cycle.** Writing the tests is not a follow-up task — a change is not complete until it ships with tests covering the new or modified behavior.

- All added or modified tests must pass before the work is considered done. Run the relevant suite and confirm it is green; never hand off with failing tests.
- Tests must assert meaningful outcomes, failure paths, and boundary conditions — not merely execute lines.
- Never weaken or delete existing tests, lower coverage thresholds, or add coverage exclusions to make a change pass. Coverage exclusions are only for genuinely untestable entrypoint/generated code, each with a justifying comment in the vitest config.

### Running tests

```bash
# foundry (requires Node >= 22.12; DATABASE_URL must be set — a dummy value
# works, tests use mocks and never contact a real database)
cd foundry && DATABASE_URL="postgresql://test:test@localhost:5432/test" pnpm test

# foundry with coverage
cd foundry && DATABASE_URL="postgresql://test:test@localhost:5432/test" pnpm run test:coverage

# ui
cd ui && npm test

# ui with coverage
cd ui && npm run test:coverage
```

The configured coverage reports (v8 provider, settings in each package's `vitest.config.ts`) are the source of truth for coverage. The project's target is 100% coverage in both packages.

## Before committing

In `foundry/`, also run `pnpm typecheck` and `pnpm lint` — CI enforces both.
In `ui/`, also run `npm run lint` and `npm run build`.

## Gotchas

- **Skill files exist in triplicate** (`.claude/skills/`, `.agents/skills/`, `.cursor/skills/`). Never edit one copy directly — edit the source and run `node scripts/sync-skill-copies.mjs` so all copies stay identical.
- **`ai:*` Linear labels are orchestrator-managed.** Never set or remove them manually (in code, skills, or when touching Linear).
- **`prisma.config.ts` resolves `DATABASE_URL` at load time**, so `pnpm install` in `foundry/` fails without it — export a dummy value (see the test commands above).
