#!/usr/bin/env bash
# Immich Postgres on-demand dump. Keeps the newest $KEEP verified dumps.
set -euo pipefail

DEST=/srv/immich/db-backups
CONTAINER=immich_postgres
DB=immich
DBUSER=postgres
KEEP=14

STAMP=$(date +%Y-%m-%d-%H%M)
TMP="${DEST}/.partial-${STAMP}.sql.gz"
OUT="${DEST}/manual-db-${STAMP}.sql.gz"

mkdir -p "$DEST"

# pipefail is load-bearing: without it a failed pg_dump still produces a
# perfectly valid gzip of nothing, and rotation would then delete 14 good
# backups to make room for 14 empty ones.
docker exec "$CONTAINER" pg_dump --clean --if-exists \
  --dbname="$DB" --username="$DBUSER" | gzip > "$TMP"

gzip -t "$TMP"
mv "$TMP" "$OUT"

# Rotate only after a verified good dump exists.
ls -1t "${DEST}"/manual-db-*.sql.gz | tail -n +$((KEEP + 1)) | xargs -r rm -f

echo "immich-db-backup: wrote $OUT ($(du -h "$OUT" | cut -f1))"
