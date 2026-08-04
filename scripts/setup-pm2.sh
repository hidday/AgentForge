#!/usr/bin/env bash
# One-shot setup for persistent local serving of AgentForge under pm2.
#
#   - ensures a Node >=22.12 toolchain and installs pm2 under it if missing
#   - installs dependencies for both packages
#   - starts (or reloads) forge-foundry + forge-ui via ecosystem.config.cjs
#   - saves the pm2 process list so `pm2 resurrect` restores it
#   - installs the git post-merge hook so `git pull` redeploys automatically
#
# Idempotent: safe to re-run at any time.
set -euo pipefail

# SELF_ROOT is where this script (and its siblings) live; ROOT is the checkout
# being served. They differ only when running from a git worktree with
# AGENTFORGE_ROOT pointing at the main checkout.
SELF_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ROOT="${AGENTFORGE_ROOT:-$SELF_ROOT}"
export AGENTFORGE_ROOT="$ROOT"

# shellcheck source=node-env.sh
source "$SELF_ROOT/scripts/node-env.sh"
echo "[setup] using node $(node --version) from $FORGE_NODE_BIN"

if ! command -v pm2 >/dev/null 2>&1; then
  echo "[setup] installing pm2 globally (under $FORGE_NODE_BIN)..."
  npm install -g pm2
fi
echo "[setup] pm2 $(pm2 --version) at $(command -v pm2)"

echo "[setup] installing dependencies..."
(cd "$ROOT/foundry" && pnpm install)
(cd "$ROOT/ui" && npm install --no-audit --no-fund)

echo "[setup] starting services..."
pm2 startOrReload "$SELF_ROOT/ecosystem.config.cjs"
pm2 save

# Install the post-merge hook into the repo's shared hooks dir so `git pull`
# in any worktree triggers a redeploy.
HOOKS_DIR="$(git -C "$ROOT" rev-parse --path-format=absolute --git-common-dir)/hooks"
mkdir -p "$HOOKS_DIR"
cp "$SELF_ROOT/scripts/git-hooks/post-merge" "$HOOKS_DIR/post-merge"
chmod +x "$HOOKS_DIR/post-merge"
echo "[setup] installed post-merge hook -> $HOOKS_DIR/post-merge"

echo
echo "[setup] done. Services:"
pm2 ls
echo
echo "To start pm2 automatically at login, run once:"
echo "  pm2 startup"
echo "and execute the sudo command it prints, then: pm2 save"
