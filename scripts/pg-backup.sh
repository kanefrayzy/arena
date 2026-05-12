#!/usr/bin/env bash
# =============================================================================
# pg-backup.sh — Daily Postgres dump for arena1v1.
# Run from cron on the Docker host (see install snippet below).
#
# Cron install (run once as root on the production host):
#   cp /opt/arena1v1/scripts/pg-backup.sh /usr/local/bin/arena-pg-backup
#   chmod +x /usr/local/bin/arena-pg-backup
#   mkdir -p /opt/backups/postgres
#   ( crontab -l 2>/dev/null | grep -v arena-pg-backup ; \
#     echo "15 3 * * * /usr/local/bin/arena-pg-backup >> /var/log/arena-pg-backup.log 2>&1" ) | crontab -
# =============================================================================
set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-/opt/backups/postgres}"
CONTAINER="${CONTAINER:-arena1v1-postgres-1}"
DB_USER="${DB_USER:-app}"
DB_NAME="${DB_NAME:-arena}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"

mkdir -p "$BACKUP_DIR"
STAMP="$(date -u +%Y%m%d-%H%M%S)"
OUT="$BACKUP_DIR/arena-${STAMP}.sql.gz"

echo "[$(date -Is)] starting backup -> $OUT"
docker exec -i "$CONTAINER" pg_dump -U "$DB_USER" -d "$DB_NAME" --no-owner --clean --if-exists \
  | gzip -9 > "$OUT.tmp"
mv "$OUT.tmp" "$OUT"

SIZE=$(du -h "$OUT" | cut -f1)
echo "[$(date -Is)] backup ok ($SIZE)"

# Retention
find "$BACKUP_DIR" -maxdepth 1 -type f -name 'arena-*.sql.gz' -mtime "+${RETENTION_DAYS}" -print -delete \
  || true

echo "[$(date -Is)] done"
