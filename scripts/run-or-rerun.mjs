// ── runOrRerun ───────────────────────────────────────────────────────────────
// Idempotently (re)start the AgentForge backend (Fastify, foundry/) and
// frontend (Vite, ui/) dev servers.
//
// Behavior:
//   • Detects anything listening on the backend port (foundry/.env → PORT, or
//     3100 by default) and the Vite dev port (5173 by default, override with
//     UI_PORT) and terminates it (SIGTERM, then SIGKILL after a grace period).
//   • Then execs `node scripts/dev.mjs`, replacing this process so Ctrl-C and
//     log streaming behave exactly like `pnpm dev` / `npm run dev`.
//
// Usage:
//   node scripts/run-or-rerun.mjs
//   pnpm restart          (or `npm run restart`)
// ─────────────────────────────────────────────────────────────────────────────

import { spawnSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const BACKEND_ENV = resolve(ROOT, "foundry", ".env");
const DEV_SCRIPT = resolve(ROOT, "scripts", "dev.mjs");

const colors = {
  system: "\x1b[33m",
  ok: "\x1b[32m",
  warn: "\x1b[31m",
  reset: "\x1b[0m",
  dim: "\x1b[2m",
};

function log(msg, color = colors.system) {
  const ts = new Date().toLocaleTimeString("en-US", { hour12: false });
  console.log(`${colors.dim}${ts}${colors.reset} ${color}[run-or-rerun]${colors.reset} ${msg}`);
}

function readBackendPort() {
  if (!existsSync(BACKEND_ENV)) return 3100;
  for (const line of readFileSync(BACKEND_ENV, "utf8").split("\n")) {
    const m = line.match(/^\s*PORT\s*=\s*(\d+)\s*$/);
    if (m) return Number(m[1]);
  }
  return 3100;
}

function pidsOnPort(port) {
  const res = spawnSync("lsof", ["-ti", `tcp:${port}`, "-sTCP:LISTEN"], {
    encoding: "utf8",
  });
  if (res.status !== 0 || !res.stdout) return [];
  return [...new Set(res.stdout.trim().split("\n").filter(Boolean).map(Number))];
}

function killPid(pid, signal) {
  try {
    process.kill(pid, signal);
    return true;
  } catch (err) {
    // ESRCH = process already gone; treat as success.
    if (err && err.code === "ESRCH") return true;
    return false;
  }
}

async function freePort(port, label) {
  const pids = pidsOnPort(port);
  if (pids.length === 0) {
    log(`${label} port ${port} is free`, colors.ok);
    return;
  }
  log(`Stopping existing ${label} on port ${port} (pid ${pids.join(", ")})`);
  for (const pid of pids) killPid(pid, "SIGTERM");

  // Wait up to ~3s for graceful shutdown, then SIGKILL anything left.
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 100));
    if (pidsOnPort(port).length === 0) {
      log(`${label} port ${port} freed`, colors.ok);
      return;
    }
  }

  const stuck = pidsOnPort(port);
  if (stuck.length > 0) {
    log(`Force-killing stuck ${label} pid ${stuck.join(", ")}`, colors.warn);
    for (const pid of stuck) killPid(pid, "SIGKILL");
    await new Promise((r) => setTimeout(r, 200));
  }
}

const backendPort = readBackendPort();
const uiPort = Number(process.env.UI_PORT ?? 5173);

log(`Backend port: ${backendPort}, UI port: ${uiPort}`);
await freePort(backendPort, "backend");
await freePort(uiPort, "ui");

log("Starting dev servers via scripts/dev.mjs", colors.ok);

// Replace this process so signals & stdio passthrough match `node scripts/dev.mjs` directly.
const child = spawnSync(process.execPath, [DEV_SCRIPT], {
  cwd: ROOT,
  stdio: "inherit",
});
process.exit(child.status ?? 0);
