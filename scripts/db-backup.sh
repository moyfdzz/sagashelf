#!/usr/bin/env bash
# Makes one encrypted copy of the database (SAG-135, ADR-036).
#
# Reads three values from the environment and never prints them:
#   BACKUP_DATABASE_URL    a direct (not pooled) connection of a read-only role
#   BACKUP_GPG_PUBLIC_KEY  the public key (armored) that the copy is encrypted to
#   BACKUP_OUT_DIR         where the file is written (default: the current folder)
#
# Writes sagashelf-<UTC time>.dump.gpg. Only the owner holds the private key.
# pg_dump runs in the postgres:18 image, so nothing has to be installed.
set -euo pipefail

: "${BACKUP_DATABASE_URL:?BACKUP_DATABASE_URL is not set}"
: "${BACKUP_GPG_PUBLIC_KEY:?BACKUP_GPG_PUBLIC_KEY is not set}"
out_dir="${BACKUP_OUT_DIR:-.}"
mkdir -p "$out_dir"

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
export GNUPGHOME="$work/gnupg"
mkdir "$GNUPGHOME"
chmod 700 "$GNUPGHOME" || true

# 1. The key first: if it is wrong, stop before the database is touched.
printf '%s\n' "$BACKUP_GPG_PUBLIC_KEY" | gpg --batch --quiet --import 2>/dev/null
fingerprint="$(gpg --batch --with-colons --list-keys | awk -F: '/^fpr/ { print $10; exit }')"
[ -n "$fingerprint" ] || { echo "backup: the public key could not be read" >&2; exit 1; }

# 2. The copy. The address reaches the container as an environment variable,
#    so it is not on any command line.
dump="$work/database.dump"
docker run --rm --env BACKUP_DATABASE_URL postgres:18 \
  sh -c 'pg_dump --format=custom --no-owner --no-privileges --dbname "$BACKUP_DATABASE_URL"' \
  > "$dump"

# 3. Look inside before trusting it: a real archive that holds the users table.
docker run --rm --interactive postgres:18 pg_restore --list < "$dump" \
  | grep -q 'TABLE DATA public users ' \
  || { echo "backup: the copy has no data of the users table" >&2; exit 1; }

# 4. Encrypt. Without the private key the file cannot be read.
stamp="$(date -u +%Y-%m-%dT%H%M%SZ)"
gpg --batch --quiet --trust-model always --recipient "$fingerprint" \
  --output "$out_dir/sagashelf-$stamp.dump.gpg" --encrypt "$dump"

echo "backup: wrote sagashelf-$stamp.dump.gpg"
