// ── Runtime requirements ─────────────────────────────────────────────────────
// • Node.js >=22.12.0 is required: Vite requires Node 20.19+ or 22.12+, and
//   the backend uses esbuild compiled for the native platform (darwin-arm64 on
//   Apple Silicon Macs).  Running an older Node or an x64/Rosetta Node on
//   Apple Silicon will produce platform-mismatch errors from esbuild.
// ─────────────────────────────────────────────────────────────────────────────

const _nodeVer = process.versions.node.split(".").map(Number);
const [_nodeMajor, _nodeMinor, _nodePatch] = _nodeVer;
const _meetsVersion =
  _nodeMajor > 22 ||
  (_nodeMajor === 22 && _nodeMinor > 12) ||
  (_nodeMajor === 22 && _nodeMinor === 12 && _nodePatch >= 0);

if (!_meetsVersion) {
  console.error(
    `Error: Node.js >=22.12.0 is required (current: ${process.versions.node}).\n` +
    `Run: nvm install 22 && nvm use`
  );
  process.exit(1);
}

if (process.platform === "darwin" && process.arch !== "arm64") {
  console.error(
    `Error: On Apple Silicon, Node.js must be the native arm64 build (current arch: ${process.arch}).\n` +
    `You may be running under Rosetta.\n` +
    `Fix: open a native arm64 terminal and run nvm install 22 && nvm use`
  );
  process.exit(1);
}

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
 * Two goals:
 *  1. Derive the Node bin directory from process.execPath so child processes
 *     (npx tsx, npx vite) resolve the exact same Node binary that already passed
 *     the >=22.12.0 / arm64 checks above — not whatever `node` happens to appear
 *     first on the ambient PATH.
 *  2. Inject ~/.local/bin ahead of any npm-prepended paths so the native
 *     `~/.local/bin/claude` CLI always wins over any npm-installed claude shim
 *     that `npx` might shadow it with.
 */
function buildEnv() {
  // Derive the Node bin directory from the currently-running executable so child
  // processes inherit the validated Node binary (>=22.12.0, arm64 on macOS).
  const nodeBin = dirname(process.execPath);
  const localBin = resolve(process.env.HOME ?? "/", ".local", "bin");
  const existing = process.env.PATH ?? "";
  // Order: nodeBin first (correct node binary), then localBin (native claude CLI),
  // then the existing PATH.  Duplicate entries in PATH are harmless.
  const PATH = [nodeBin, localBin, existing].join(":");
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
