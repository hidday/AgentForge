# AgentForge — Developer Guide

## Cursor Cloud specific instructions

### Architecture

AgentForge is a two-package project (not a monorepo workspace):

- **foundry** (backend): Fastify API server + orchestrator engine, uses **pnpm**
- **ui** (frontend): React SPA dashboard, uses **npm**

See `foundry/README.md` for the full state-machine, API routes, and design principles.

### Prerequisites

- **Node.js >=22.12.0** (`.nvmrc` at repo root)
- **PostgreSQL 16** on port 5432 (database: `ai_orchestrator`, user: `postgres`, password: `postgres`)
- pnpm 9.x for `foundry/`, npm for `ui/`

### Database setup (one-time after first install)

```bash
cp foundry/.env.example foundry/.env          # adjust REPOS_ROOT_PATH as needed
cd foundry && npx prisma db push              # creates tables from schema
```

`prisma generate` runs automatically via `postinstall` in `foundry/package.json`.

### Running the dev servers

From the repo root: `node scripts/dev.mjs` starts both the Fastify backend (port 3100) and Vite frontend (port 5173) concurrently. The Vite dev server proxies `/api` requests to the backend.

### Key scripts

| Package | Command | Purpose |
|---------|---------|---------|
| root | `npm run dev` | Start both services (`scripts/dev.mjs`) |
| foundry | `pnpm test` | Vitest unit tests (68 tests) |
| foundry | `pnpm lint` | ESLint + Prettier |
| foundry | `pnpm run typecheck` | `tsc --noEmit` |
| foundry | `pnpm simulate:run` | Full mock workflow simulation |
| ui | `npm test` | Vitest + React Testing Library (52 tests) |
| ui | `npm run lint` | ESLint |
| ui | `npm run build` | Production build |

### Gotchas

- **`prisma generate` requires `DATABASE_URL`**: The `postinstall` hook in `foundry/package.json` runs `prisma generate`, which reads `DATABASE_URL` from `foundry/.env`. If the `.env` file doesn't exist yet, `pnpm install` will fail at the postinstall step. Create `foundry/.env` (from `.env.example`) before running `pnpm install`, or re-run `npx prisma generate` afterward.
- **Mock mode (default)**: `AGENT_RUNTIME_MODE=mock` in `.env` means no real CLI tools (claude, codex) are needed. All agent stages return deterministic canned output.
- **Mock issue project mismatch**: The built-in mock issue (`LIN-1042`) uses `project: "Backend Platform"`, which is not mapped in `repos.config.json`. The `simulate:run` script and `/simulate/run/:issueId` API will fail unless you either add a `"linearProject": "Backend Platform"` entry to a repo in `repos.config.json`, or modify the mock data.
- **PostgreSQL must be running** before starting the backend. The backend connects on startup and will crash if Postgres is unavailable.
- **`.env` changes require restart**: `tsx watch` does not auto-reload when `.env` changes. Stop and restart `node scripts/dev.mjs` after editing `foundry/.env`.
