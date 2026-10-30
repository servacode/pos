#!/usr/bin/env bash
# Extra assertions for the local-server CI job (.github/workflows/local-server.yml). Each exits
# non-zero on failure. Can also be run by hand against a running local server.
#   ci-checks.sh hardening       ports, users, read-only file systems, no secrets in git
#   ci-checks.sh seed            loads scripts/local/ci-fixture.sql
#   ci-checks.sh negative <file> a damaged backup, a wrong passphrase and a manifest that does not
#                                match the data must all FAIL the restore drill
#   ci-checks.sh fixture-present the fixture rows are in the live database (after --replace-live)
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/local/lib.sh
source "$SCRIPT_DIR/lib.sh"
load_env

psql_live() { dc exec -T -u postgres postgres psql --no-psqlrc -X -tA -v ON_ERROR_STOP=1 -d serva "$@"; }

hardening() {
  local port
  port="$(dc port postgres 5432)"
  [[ "$port" == 127.0.0.1:* ]] || die "PostgreSQL is published on $port, not on 127.0.0.1 only"
  ok "PostgreSQL published on $port only"

  local service uid ro
  for service in api web; do
    uid="$(dc exec -T "$service" id -u)"
    [[ "$uid" != 0 ]] || die "$service runs as root"
    ro="$(docker inspect --format '{{.HostConfig.ReadonlyRootfs}}' "$(dc ps -q "$service")")"
    [[ "$ro" == true ]] || die "$service does not have a read-only file system"
    ok "$service runs as uid $uid on a read-only file system"
  done
  if dc exec -T api sh -c 'echo x > /app/apps/api/dist/x.js' 2> /dev/null; then die "api can write its own code"; fi
  ok "api cannot change its own code"

  [[ "$(stat -c %a "$ENV_FILE")" == 600 ]] || die "$ENV_FILE is readable by other users"
  ok "$ENV_FILE is private (600)"
  if git -C "$ROOT_DIR" ls-files --error-unmatch "$ENV_FILE" > /dev/null 2>&1; then die ".env is tracked by git"; fi
  [[ -z "$(git -C "$ROOT_DIR" status --porcelain --untracked-files=all -- deploy/local)" ]] ||
    die "The local server left files git would pick up: $(git -C "$ROOT_DIR" status --porcelain -- deploy/local)"
  ok "No secret or generated file is visible to git"

  # The API refuses development defaults: it must be running in production mode with real secrets
  [[ "$(dc exec -T api printenv NODE_ENV)" == production ]] || die "The API is not in production mode"
  ok "API runs with NODE_ENV=production (development passwords and OTP logging are refused)"
}

seed() {
  dc exec -T postgres psql -U postgres -d serva < "$SCRIPT_DIR/ci-fixture.sql"
  ok "Fixture loaded"
}

expect_drill_failure() { # expect_drill_failure <what> <file> [env…]
  local what="$1" file="$2"
  shift 2
  if env "$@" bash "$SCRIPT_DIR/restore.sh" "$file" > "$work/out" 2>&1; then
    cat "$work/out"
    die "The restore drill PASSED for $what; it must fail"
  fi
  grep -q 'RESTORE DRILL FAILED' "$work/out" || {
    cat "$work/out"
    die "The drill failed for $what, but without its FAIL report"
  }
  ok "Drill correctly FAILS for $what: $(grep -m1 '^FAIL' "$work/out" | cut -c7-)"
}

negative() {
  local source="${1:?usage: ci-checks.sh negative <backup.dump.enc>}"
  source="${source%.dump.enc}"
  local name
  name="$(basename "$source")"
  work="$(mktemp -d)"
  trap 'rm -rf "$work"' RETURN

  # A damaged file (one byte changed in the middle)
  mkdir "$work/damaged"
  cp "$source".* "$work/damaged/"
  printf '\xff' | dd of="$work/damaged/$name.dump.enc" bs=1 seek=4096 conv=notrunc status=none
  expect_drill_failure "a damaged file" "$work/damaged/$name.dump.enc"

  # A damaged file whose checksum files were updated to match: decryption or the dump checksum stops it
  mkdir "$work/rehashed"
  cp "$source".* "$work/rehashed/"
  printf '\xff' | dd of="$work/rehashed/$name.dump.enc" bs=1 seek=4096 conv=notrunc status=none
  local new_sha
  new_sha="$(sha256sum < "$work/rehashed/$name.dump.enc" | cut -d' ' -f1)"
  printf '%s  %s\n' "$new_sha" "$name.dump.enc" > "$work/rehashed/$name.dump.enc.sha256"
  sed -i "s/^encrypted_sha256=.*/encrypted_sha256=$new_sha/" "$work/rehashed/$name.manifest"
  expect_drill_failure "a damaged file with forged checksums" "$work/rehashed/$name.dump.enc"

  # The wrong passphrase
  expect_drill_failure "a wrong passphrase" "$source.dump.enc" SERVA_BACKUP_PASSPHRASE=0000000000000000wrongpassphrase

  # Data that does not match what was recorded (one table's row count changed in the manifest)
  mkdir "$work/mismatch"
  cp "$source".* "$work/mismatch/"
  sed -i -E '0,/^public\.tenants\|/s/^(public\.tenants)\|([0-9]+)\|/\1|999999|/' "$work/mismatch/$name.manifest"
  grep -q '^public.tenants|999999|' "$work/mismatch/$name.manifest" || die "Could not prepare the mismatch case"
  expect_drill_failure "data that differs from the manifest" "$work/mismatch/$name.dump.enc"
}

fixture_present() {
  local count
  count="$(psql_live -c "select count(*) from branches b join tenants t on t.id = b.tenant_id where t.name like 'متجر الاختبار %'")"
  [[ "$count" == 100 ]] || die "Expected the 100 fixture branches in the live database, found $count"
  ok "The fixture data is in the live database ($count branches)"
}

case "${1:-}" in
  hardening) hardening ;;
  seed) seed ;;
  negative) negative "${2:-}" ;;
  fixture-present) fixture_present ;;
  *) die "Usage: ci-checks.sh hardening | seed | negative <backup.dump.enc> | fixture-present" ;;
esac
