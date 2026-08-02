# CLAUDE.md

Guidance for AI agents working in this repository.

## Project layout

Monorepo with two packages:

- `foundry/` — Node backend orchestrator (TypeScript, Fastify, Prisma). Package manager: **pnpm**. Tests in `foundry/tests/`.
- `ui/` — React + Vite frontend. Package manager: **npm**. Tests colocated in `ui/src/`.

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
