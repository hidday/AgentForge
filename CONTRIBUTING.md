# Contributing to AgentForge

Thanks for taking the time to contribute. This guide covers everything you need to get a change from idea to merged PR.

For the project overview, see the [README](README.md).

## Code of Conduct

By participating, you agree to uphold the [Code of Conduct](CODE_OF_CONDUCT.md). Report unacceptable behavior by following the instructions in [SECURITY.md](SECURITY.md).

## Ground rules

- Be specific. A failing test, a stack trace, or a screenshot beats prose.
- Keep PRs small and focused. One feature or fix per PR.
- Match the existing style. The codebase is opinionated -- follow it.
- AI-generated commits are welcome (this repo eats its own dog food), but every commit should still be sensible to a human reading the diff.

## Getting set up

You only need to do this once.

```bash
git clone https://github.com/hidday/AgentForge.git
cd AgentForge

nvm use            # picks up Node 22 from .nvmrc
pnpm setup         # installs foundry/ + ui/

cp foundry/.env.example foundry/.env
# (optional) cp foundry/repos.config.example.json foundry/repos.config.json

# Postgres in a named volume that survives `docker volume prune` mishaps:
docker volume create agentforge_pg_data
docker run -d --name agentforge-postgres --restart unless-stopped \
  -e POSTGRES_USER=postgres \
  -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=ai_orchestrator \
  -p 5433:5432 \
  -v agentforge_pg_data:/var/lib/postgresql/data \
  postgres:16

cd foundry && pnpm db:push && pnpm db:generate && cd ..
```

Run the stack:

```bash
npm run dev        # backend on :3100, UI on :5173, shared logging
```

The default `AGENT_RUNTIME_MODE=mock` returns canned outputs from every agent stage, so you can develop without `claude` / `codex` installed.

## Branching and commits

- Base your work off `master`. Branch names are free-form; `feat/<scope>-<short-description>` and `fix/<scope>-<short-description>` are good defaults.
- Use [Conventional Commits](https://www.conventionalcommits.org/) for the commit subject. The history follows `feat(scope): ...`, `fix(scope): ...`, `chore(scope): ...`, `refactor(scope): ...`, `perf(scope): ...`, `docs(scope): ...`, `test(scope): ...`, `style(scope): ...`. Common scopes: `foundry`, `ui`, `orchestrator`, `agents`, `runtime`, `api`, `db`.
- One logical change per commit when reasonable. Squash noise (typo fixes, `wip:` checkpoints) before opening the PR.

## The CI bar

CI on `master` and on every PR runs:

**`foundry/`**
- `pnpm install --frozen-lockfile`
- `pnpm typecheck` (`tsc --noEmit`, strict)
- `pnpm lint` (ESLint flat config + Prettier)
- `pnpm test` (Vitest)

**`ui/`**
- `npm ci`
- `npm run lint`
- `npm run build` (TypeScript build + Vite build)
- `npm test` (Vitest + jsdom)

Run the same commands locally before pushing. The full check from the repo root is:

```bash
cd foundry && pnpm typecheck && pnpm lint && pnpm test && cd ..
cd ui && npm run lint && npm run build && npm test && cd ..
```

If you're touching agent prompts, also run a mock-mode `pnpm simulate:run` from `foundry/` to make sure the canned outputs still parse.

## Style

- Prettier and ESLint are the source of truth. `pnpm lint:fix` and `pnpm format` will resolve most of it.
- TypeScript is strict (`tsc --noEmit` is part of CI). Prefer `unknown` + Zod parsing over `any`.
- Avoid narrative comments that just restate what the code does. Comments should explain non-obvious intent, trade-offs, or constraints.
- Public functions, exported services, and Zod schemas should be self-documenting (names + types + a short JSDoc when it helps).

## Database changes

The DB schema lives in [`foundry/prisma/schema.prisma`](foundry/prisma/schema.prisma).

- For local iteration, `pnpm db:push` keeps the dev DB in sync without creating migration files.
- For changes that ship, generate a real migration: `pnpm db:migrate -- --name <short-description>`. Migrations are append-only -- never edit a committed migration after it lands.
- Touching `prisma/migrations/` is treated as protected by the orchestrator's executor; reviewers should expect manual scrutiny.

## Pull request checklist

Before requesting review:

- [ ] PR title follows Conventional Commits (`feat(scope): ...`).
- [ ] CI is green (or the failure is explained).
- [ ] You've described the *why*, not just the *what*. Link the Linear issue or GitHub issue if there is one.
- [ ] Tests added/updated for new behavior.
- [ ] Docs updated for any user-visible change (README, foundry/README, ui/README, env.example).
- [ ] No secrets, customer data, or absolute personal paths in the diff. Run `git diff master | rg -i 'lin_api_|ghp_|github_pat_|/Users/'` if in doubt.

## Reporting issues

Open an issue using one of the templates in [`.github/ISSUE_TEMPLATE/`](.github/ISSUE_TEMPLATE/). For security issues, **don't** open a public issue -- follow [SECURITY.md](SECURITY.md).

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).
