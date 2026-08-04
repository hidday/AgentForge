#!/usr/bin/env bash
# Bring the running pm2-managed AgentForge services in line with the current
# checkout: install dependencies, regenerate the Prisma client, then reload
# both pm2 apps. Safe to run any time; installed as a git post-merge hook by
# scripts/setup-pm2.sh so `git pull` triggers it automatically.
set -euo pipefail

SELF_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ROOT="${AGENTFORGE_ROOT:-$SELF_ROOT}"
export AGENTFORGE_ROOT="$ROOT"

# Ensure a Node >=22.12 toolchain is on PATH (shared with setup-pm2.sh).
# shellcheck source=node-env.sh
source "$SELF_ROOT/scripts/node-env.sh"

echo "[redeploy] repo root: $ROOT"
echo "[redeploy] node: $(node --version) ($(command -v node))"

echo "[redeploy] installing foundry dependencies (pnpm)..."
(cd "$ROOT/foundry" && pnpm install --frozen-lockfile 2>/dev/null || (cd "$ROOT/foundry" && pnpm install))

echo "[redeploy] installing ui dependencies (npm)..."
(cd "$ROOT/ui" && npm install --no-audit --no-fund)

echo "[redeploy] regenerating prisma client..."
(cd "$ROOT/foundry" && npx prisma generate)

if command -v pm2 >/dev/null 2>&1; then
  echo "[redeploy] reloading pm2 apps..."
  pm2 startOrReload "$SELF_ROOT/ecosystem.config.cjs"
  pm2 save
  echo "[redeploy] done."
else
  echo "[redeploy] pm2 not found on PATH — run scripts/setup-pm2.sh first." >&2
  exit 1
fi
