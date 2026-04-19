# /run-or-rerun

Idempotently (re)start the AgentForge dev services — backend (Fastify in `foundry/`) and frontend (Vite in `ui/`) — whether or not they are already running.

## What to do

1. Run `pnpm dev:restart` from the repo root in the **background** (it's a long-running process). This wraps `node scripts/run-or-rerun.mjs`, which:

   > Important: the project requires Node ≥22 (see `.nvmrc`). If your shell defaults to an older Node, prefix the command with nvm activation, e.g.:
   > `bash -lc 'export NVM_DIR="$HOME/.nvm"; source "$NVM_DIR/nvm.sh"; nvm use 22 >/dev/null; exec pnpm dev:restart'`
   > Do **not** name the npm script `restart` — `pnpm restart` is a reserved built-in (runs `stop` then `start`) and will shadow it.

   - Frees the backend port (`PORT` from `foundry/.env`, default `3100`) and the UI port (`UI_PORT` env, default `5173`) by `SIGTERM`-ing any current listeners and `SIGKILL`-ing anything stuck after ~3s.
   - Then execs `node scripts/dev.mjs`, which spawns the backend (`npx tsx watch src/server.ts`) and the UI (`npx vite`) with prefixed log streaming.

2. Wait for both services to come up by watching the streamed output for these signals:
   - Backend ready: a line containing `Server listening` or the configured port (e.g. `:3100`).
   - UI ready: a Vite line containing `Local:` and a URL (typically `http://localhost:5173/`).

3. If either service exits with a non-zero code or fails to bind within ~30 seconds, surface the relevant log lines and stop — do not silently retry.

4. Once both are healthy, report the URLs (backend port + Vite local URL) back to the user. Leave the process running in the background.

## Notes

- Do **not** run `pnpm dev` directly when the user invokes this command — `pnpm dev:restart` is the idempotent variant and is what we want for "run or rerun".
- The backend port is read from `foundry/.env`. If the user has changed `PORT`, the script will still pick it up automatically.
- To stop the services later, kill the backgrounded shell job (the script forwards `SIGINT`/`SIGTERM` to its children).
