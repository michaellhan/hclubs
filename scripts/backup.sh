#!/usr/bin/env bash
# Back up everything that can't be rebuilt (ADR 0039): the database (logical, one gzipped
# NDJSON file per table + checksummed manifest) and the content-addressed snapshot archive.
# Zero cost, no network. Code, curated lists and migrations are in git; .env is never copied.
#
#   scripts/backup.sh [destination]      default: data/backups (inside the repo, gitignored)
#
# Point it at an external drive or a synced folder to survive losing this laptop:
#   scripts/backup.sh /Volumes/Backup/hclubs
# Restore (into an empty, migrated database): docs/runbook.md "Backup and restore".
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
dest="${1:-$root/data/backups}"
stamp="$(date -u +%Y-%m-%dT%H%M%S)"
mkdir -p "$dest"

cd "$root"
# The snapshot store must be intact before it is copied anywhere.
pnpm --silent hci snapshots verify
pnpm --silent hci backup --out="$dest/$stamp/db"

# Snapshots are immutable and named by their hash: copy only new files, never delete.
snap_dir="$(sed -n 's/^SNAPSHOT_DIR=//p' .env 2>/dev/null | tail -1)"
snap_dir="${snap_dir:-data/snapshots}"
case "$snap_dir" in /*) ;; *) snap_dir="$root/$snap_dir" ;; esac
mkdir -p "$dest/snapshots"
rsync -a --ignore-existing "$snap_dir/" "$dest/snapshots/"

git rev-parse HEAD > "$dest/$stamp/git-sha.txt"
echo "Backup: $dest/$stamp (database) + $dest/snapshots (archive, incremental)"
