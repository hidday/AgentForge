---
name: restart-service
description: Fully restart the AgentForge backend (Fastify) and UI (Vite) dev services. Use when the user says "restart the services", "restart dev", "/restart-service", or when the stack is stuck and needs a clean bounce.
disable-model-invocation: true
---

# Restart AgentForge Dev Services

Perform a clean bounce of the backend and UI. Follow the steps in order and stop if any mandatory step fails.

## Environment

- Use Node 22 via nvm: always prepend `PATH="$HOME/.nvm/versions/node/v22.22.1/bin:$PATH"` to shell commands (the script requires Node >=22.12 / arm64).
- Backend port: `3100`
- UI port: `5173`
- Postgres: Docker container named `agentforge-postgres` on `localhost:5432`.
- Tailscale hostname (must be reachable when requested): `macbook-pro-3.tail05bae6.ts.net`

## Steps

### 1. Kill all existing dev processes

Run these in parallel where possible:

```bash
pkill -9 -f "tsx watch" 2>/dev/null
pkill -9 -f "node.*vite" 2>/dev/null
pkill -9 -f "scripts/dev.mjs" 2>/dev/null
sleep 2
# also free the ports if anything stale is still holding them
lsof -tiTCP:3100 -sTCP:LISTEN | xargs -r kill -9 2>/dev/null
lsof -tiTCP:5173 -sTCP:LISTEN | xargs -r kill -9 2>/dev/null
```

Verify no dev processes remain:

```bash
ps aux | grep -E "tsx watch|node.*vite|dev\.mjs" | grep -v grep | wc -l
```

Must print `0`. If not, repeat `pkill -9` with the specific PIDs.

### 2. Ensure Postgres is running

```bash
docker ps --filter "name=agentforge-postgres" --format "{{.Status}}"
```

If empty or shows `Exited`:

```bash
docker start agentforge-postgres
sleep 3
```

If the container doesn't exist at all, create it:

```bash
docker run -d --name agentforge-postgres \
  -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=ai_orchestrator \
  -p 5432:5432 postgres:16-alpine
```

### 3. Verify backend prerequisites

Only run these if they would otherwise fail — check first, don't blindly reinstall.

- `foundry/.env` exists. If missing: `cp foundry/.env.example foundry/.env`
- `foundry/node_modules/` exists. If missing: `cd foundry && pnpm install --ignore-scripts`
- `foundry/src/generated/prisma/client.js` exists (Prisma client is generated). If missing OR if the schema changed recently: `cd foundry && npx prisma generate`

If the Prisma schema is ahead of the DB (e.g. new columns like `linearIssueTitle` causing `PrismaClientValidationError: Unknown argument`), sync the DB:

```bash
cd foundry && npx prisma db push && npx prisma generate
```

### 4. Start the dev server

Run in the background (it's long-running):

```bash
export PATH="$HOME/.nvm/versions/node/v22.22.1/bin:$PATH" && cd /Users/hiddaysaban/Code/AgentForge && npm run dev
```

Use `block_until_ms: 0` so the shell tool backgrounds it immediately and writes to the terminal log file.

### 5. Verify both services respond

Wait ~10 seconds, then:

```bash
curl -s -o /dev/null -w "backend: %{http_code}\n" http://localhost:3100/health
curl -s -o /dev/null -w "ui: %{http_code}\n" http://localhost:5173/
```

Both must return `200`. If either returns `000`, read the terminal log file, strip ANSI (`sed 's/\x1b\[[0-9;]*m//g'`), and diagnose.

### 6. (When requested) Verify Tailscale exposure

The UI is configured in `ui/vite.config.ts` with `server.host: true` and `allowedHosts: ["macbook-pro-3.tail05bae6.ts.net"]`. The backend binds to `0.0.0.0:3100` in `foundry/src/server.ts`. Confirm:

```bash
curl -s -o /dev/null -w "tailscale backend: %{http_code}\n" http://macbook-pro-3.tail05bae6.ts.net:3100/health
curl -s -o /dev/null -w "tailscale ui: %{http_code}\n" http://macbook-pro-3.tail05bae6.ts.net:5173/
```

Both must return `200`.

## Common failure modes and fixes

| Symptom | Fix |
|---|---|
| `EADDRINUSE :3100` on startup | A zombie tsx process is holding the port. Kill via `lsof -tiTCP:3100 -sTCP:LISTEN \| xargs kill -9`, then retry from step 4. |
| Backend proxy errors `ECONNREFUSED` in UI log | Transient during startup -- backend not ready yet. Ignore unless they persist >10s after backend logs "Server listening". |
| `PrismaClientValidationError: Unknown argument` | Schema/DB drift. Run `npx prisma db push && npx prisma generate`, then restart. |
| `P1001: Can't reach database server at localhost:5432` | Postgres container is down. See step 2. |
| `Cannot find module '.../tsx/dist/preflight.cjs'` | `node_modules` is corrupted (usually from an aborted `pnpm install`). Run `rm -rf foundry/node_modules && cd foundry && pnpm install --ignore-scripts`. |
| `error: 'Mock: Issue <id> not found'` at startup backfill | Benign. Only occurs in mock mode when DB has runs referencing Linear issue IDs the mock client doesn't know. Server continues normally. |

## Final report

When complete, report:
- Local URLs: `http://localhost:3100` (backend `/health`) and `http://localhost:5173/` (UI)
- Tailscale URLs if verified in step 6
- Any non-fatal warnings from the log
