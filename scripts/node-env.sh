# Sourced (not executed) by setup-pm2.sh and redeploy.sh to put a Node >=22.12
# toolchain first on PATH. Resolution order:
#   1. AGENTFORGE_NODE_BIN env var (a Node bin directory)
#   2. the newest Node >=22 installed under ~/.nvm/versions/node
#   3. whatever `node` is already on PATH, if it is >=22
# Exits (returns) non-zero if nothing suitable is found.

_forge_node_ok() {
  local major minor
  major="$("$1/node" -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
  minor="$("$1/node" -p 'process.versions.node.split(".")[1]' 2>/dev/null || echo 0)"
  [ "$major" -gt 22 ] || { [ "$major" -eq 22 ] && [ "$minor" -ge 12 ]; }
}

_forge_pick_node_bin() {
  if [ -n "${AGENTFORGE_NODE_BIN:-}" ] && _forge_node_ok "$AGENTFORGE_NODE_BIN"; then
    echo "$AGENTFORGE_NODE_BIN"
    return 0
  fi
  local nvm_dir="${NVM_DIR:-$HOME/.nvm}" candidate
  if [ -d "$nvm_dir/versions/node" ]; then
    candidate="$(ls -1 "$nvm_dir/versions/node" | sort -t. -k1.2,1n -k2,2n -k3,3n | tail -1)"
    if [ -n "$candidate" ] && _forge_node_ok "$nvm_dir/versions/node/$candidate/bin"; then
      echo "$nvm_dir/versions/node/$candidate/bin"
      return 0
    fi
  fi
  if command -v node >/dev/null 2>&1; then
    candidate="$(dirname "$(command -v node)")"
    if _forge_node_ok "$candidate"; then
      echo "$candidate"
      return 0
    fi
  fi
  return 1
}

FORGE_NODE_BIN="$(_forge_pick_node_bin)" || {
  echo "Error: no Node >=22.12 found. Install one (nvm install 22) or set AGENTFORGE_NODE_BIN." >&2
  return 1 2>/dev/null || exit 1
}
export PATH="$FORGE_NODE_BIN:$HOME/.local/bin:$PATH"
