// PM2 process definitions for AgentForge (local, persistent serving).
//
// Both apps run in watch mode, so source changes pulled from git are picked up
// automatically (tsx restarts the backend, Vite hot-reloads the UI). For
// changes that watch mode can't absorb — new dependencies, Prisma schema
// changes — run scripts/redeploy.sh (installed as a git post-merge hook by
// scripts/setup-pm2.sh, so a plain `git pull` handles it too).
//
// Usage:
//   pm2 start ecosystem.config.cjs        # start / register both apps
//   pm2 startOrReload ecosystem.config.cjs
//
// AGENTFORGE_ROOT overrides the repo root (useful when starting from a git
// worktree while serving the main checkout).

const path = require("path");
const os = require("os");

const ROOT = process.env.AGENTFORGE_ROOT || __dirname;

// The pm2 daemon must run under Node >=22.12 (see scripts/setup-pm2.sh).
// Derive the Node bin dir from the daemon's own executable so child processes
// (npx tsx, npx vite) resolve that exact Node, not whatever `node` is first on
// the ambient PATH. ~/.local/bin is injected so the native claude CLI wins
// over any npm shim (same rationale as scripts/dev.mjs).
const nodeBin = path.dirname(process.execPath);
const localBin = path.join(os.homedir(), ".local", "bin");
const PATH = [nodeBin, localBin, process.env.PATH || ""].join(":");

const common = {
  interpreter: "none",
  autorestart: true,
  min_uptime: "10s",
  max_restarts: 10,
  restart_delay: 2000,
  kill_timeout: 8000,
  time: true, // prefix pm2 log lines with timestamps
};

module.exports = {
  apps: [
    {
      ...common,
      name: "forge-foundry",
      cwd: path.join(ROOT, "foundry"),
      script: "npx",
      args: ["tsx", "watch", "src/server.ts"],
      env: { PATH },
    },
    {
      ...common,
      name: "forge-ui",
      cwd: path.join(ROOT, "ui"),
      script: "npx",
      args: ["vite"],
      env: { PATH },
    },
  ],
};
