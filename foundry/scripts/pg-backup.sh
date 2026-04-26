#!/usr/bin/env bash
# Dump the AgentForge Postgres DB to a timestamped file in foundry/backups/.
# Defaults assume the local dev container `agentforge-postgres` from README.
#
# Usage:
#   ./scripts/pg-backup.sh                    # dump to backups/ai_orchestrator-YYYYMMDD-HHMMSS.sql.gz
#   RETAIN=14 ./scripts/pg-backup.sh          # keep only the 14 most recent dumps
#   CONTAINER=ai-orch-pg ./scripts/pg-backup.sh
#
# Restore (manual):
#   gunzip -c backups/ai_orchestrator-*.sql.gz | \
#     docker exec -i agentforge-postgres psql -U postgres -d ai_orchestrator

set -euo pipefail

CONTAINER="${CONTAINER:-agentforge-postgres}"
DB_NAME="${DB_NAME:-ai_orchestrator}"
DB_USER="${DB_USER:-postgres}"
RETAIN="${RETAIN:-7}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKUP_DIR="${BACKUP_DIR:-${SCRIPT_DIR}/../backups}"
mkdir -p "$BACKUP_DIR"

if ! docker inspect "$CONTAINER" >/dev/null 2>&1; then
  echo "error: docker container '$CONTAINER' not found" >&2
  exit 1
fi

STATE="$(docker inspect -f '{{.State.Status}}' "$CONTAINER")"
if [ "$STATE" != "running" ]; then
  echo "error: container '$CONTAINER' is not running (state=$STATE)" >&2
  exit 1
fi

TS="$(date -u +%Y%m%d-%H%M%SZ)"
OUT="${BACKUP_DIR}/${DB_NAME}-${TS}.sql.gz"

echo "Dumping ${DB_NAME} from ${CONTAINER} -> ${OUT}"
docker exec -t "$CONTAINER" pg_dump \
  --username="$DB_USER" \
  --dbname="$DB_NAME" \
  --format=plain \
  --no-owner \
  --no-privileges \
  | gzip -9 > "$OUT"

SIZE="$(du -h "$OUT" | cut -f1)"
echo "OK: ${OUT} (${SIZE})"

# Retention: keep the most recent $RETAIN, delete older dumps.
if [ "$RETAIN" -gt 0 ]; then
  cd "$BACKUP_DIR"
  # shellcheck disable=SC2012
  mapfile -t OLD < <(ls -1t "${DB_NAME}-"*.sql.gz 2>/dev/null | tail -n +"$((RETAIN + 1))")
  for f in "${OLD[@]:-}"; do
    [ -n "$f" ] || continue
    echo "Pruning old backup: $f"
    rm -f -- "$f"
  done
fi
