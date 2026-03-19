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
    env: { ...process.env },
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
