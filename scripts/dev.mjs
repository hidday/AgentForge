// ── Runtime requirements ─────────────────────────────────────────────────────
//
// This dev script requires:
//   • Node.js >=22.12.0  — Vite requires Node 20.19+/22.12+ (see Vite 6 release notes)
//   • arm64 on macOS     — esbuild ships a darwin-arm64 native binary; running
//                          under Rosetta (x64) causes platform-mismatch errors.
//
// Both checks run before any imports or child-process spawns so the error is
// immediate and actionable.

(function checkNodeVersion() {
  const [major, minor, patch] = process.versions.node.split(".").map(Number);
  const required = [22, 12, 0];
  const current = [major, minor, patch];
  let tooOld = false;
  for (let i = 0; i < 3; i++) {
    if (current[i] < required[i]) { tooOld = true; break; }
    if (current[i] > required[i]) break;
  }
  if (tooOld) {
    console.error(
      `Error: Node.js >=22.12.0 is required (current: ${process.versions.node}).\n` +
      `Run: nvm install 22 && nvm use`
    );
    process.exit(1);
  }
})();

(function checkArchitecture() {
  if (process.platform === "darwin" && process.arch !== "arm64") {
    console.error(
      `Error: On Apple Silicon, Node.js must be the native arm64 build ` +
      `(current arch: ${process.arch}).\n` +
      `You may be running under Rosetta. Fix: open a native arm64 terminal ` +
      `and run nvm install 22 && nvm use`
    );
    process.exit(1);
  }
})();

import { spawn, execSync } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const BACKEND_DIR = resolve(ROOT, "foundry");
const UI_DIR = resolve(ROOT, "ui");

const colors = {
  backend: "\x1b[36m",   // cyan
  ui: "\x1b[35m",        // magenta
  system: "\x1b[33m",    // yellow
  reset: "\x1b[0m",
  dim: "\x1b[2m",
};

function log(tag, color, msg) {
  const ts = new Date().toLocaleTimeString("en-US", { hour12: false });
  console.log(`${colors.dim}${ts}${colors.reset} ${color}[${tag}]${colors.reset} ${msg}`);
}

function ensureDeps(dir, name, cmd) {
  if (!existsSync(resolve(dir, "node_modules"))) {
    log("setup", colors.system, `Installing ${name} dependencies...`);
    execSync(cmd, { cwd: dir, stdio: "inherit" });
  }
}

function startProcess(tag, color, cmd, args, cwd) {
  const proc = spawn(cmd, args, {
    cwd,
    stdio: ["ignore", "pipe", "pipe"],
    env: buildEnv(),
  });

  proc.stdout.on("data", (data) => {
    for (const line of data.toString().split("\n").filter(Boolean)) {
      log(tag, color, line);
    }
  });

  proc.stderr.on("data", (data) => {
    for (const line of data.toString().split("\n").filter(Boolean)) {
      log(tag, color, line);
    }
  });

  proc.on("exit", (code) => {
    log(tag, color, `exited with code ${code}`);
  });

  return proc;
}

/**
 * Build an env block for child processes.
 *
 * Problem: `npm exec` / `npx` prepend the nvm Node bin dir to PATH when they
 * launch sub-processes. That dir contains an *npm-installed* `claude` CLI
 * (older, incompatible version) which then shadows the native `~/.local/bin/claude`.
 *
 * Fix: inject ~/.local/bin at the very front of PATH so the native binary always
 * wins regardless of what npm / npx prepend later.
 */
function buildEnv() {
  const localBin = resolve(process.env.HOME ?? "/", ".local", "bin");
  const existing = process.env.PATH ?? "";
  // Only prepend if not already the first entry (idempotent on re-runs)
  const PATH = existing.startsWith(localBin) ? existing : `${localBin}:${existing}`;
  return { ...process.env, PATH };
}

// ── Main ────────────────────────────────────────────────────────────────

log("system", colors.system, "AgentForge Dev Environment");
log("system", colors.system, "─".repeat(40));

ensureDeps(BACKEND_DIR, "backend", "pnpm install");
ensureDeps(UI_DIR, "ui", "npm install");

log("system", colors.system, "Starting backend (Fastify) and frontend (Vite)...\n");

const backend = startProcess(
  "backend",
  colors.backend,
  "npx",
  ["tsx", "watch", "src/server.ts"],
  BACKEND_DIR,
);

// Small delay so backend port is bound before Vite tries to proxy
setTimeout(() => {
  const ui = startProcess(
    "ui",
    colors.ui,
    "npx",
    ["vite"],
    UI_DIR,
  );

  process.on("SIGINT", () => {
    log("system", colors.system, "Shutting down...");
    ui.kill("SIGTERM");
    backend.kill("SIGTERM");
    setTimeout(() => process.exit(0), 1000);
  });

  process.on("SIGTERM", () => {
    ui.kill("SIGTERM");
    backend.kill("SIGTERM");
    setTimeout(() => process.exit(0), 1000);
  });
}, 2000);
