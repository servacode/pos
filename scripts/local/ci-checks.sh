#!/usr/bin/env bash
# Extra assertions for the local-server CI job (.github/workflows/local-server.yml). Each exits
# non-zero on failure. Can also be run by hand against a running local server.
#   ci-checks.sh hardening       ports, users, read-only file systems, no secrets in git
#   ci-checks.sh seed            loads scripts/local/ci-fixture.sql
#   ci-checks.sh negative <file> a damaged backup, a wrong passphrase and a manifest that does not
#                                match the data must all FAIL the restore drill
#   ci-checks.sh fixture-present the fixture rows are in the live database (after --replace-live)
#   ci-checks.sh signup          opens a store through the real two-step sign-up, typing the code the
#                                test mode shows on screen; a registered number gets a code that fails
#   ci-checks.sh day <step>      the working day of the restore drill (task M0-7), through the API:
#                                seed | after-backup | resend (apps/api/test/drill/restore-drill.ts)
#   ci-checks.sh books <name>    runs the integrity check on the live database (it must pass) and
#                                keeps its fingerprints as <name>
#   ci-checks.sh same-books <a> <b> | other-books <a> <b>
#                                the drill store's ledger and stock fingerprints match, or differ
#   ci-checks.sh numbers <name>  keeps the drill store's entry numbers and what each one posts
#   ci-checks.sh no-reused-numbers <a> <b>
#                                no entry number posts one document in <a> and another in <b> (M0-8)
#   ci-checks.sh offsite-and-key a backup copied off-site and verified there; the key split in
#                                three; each pair of parts restores the off-site copy, one part
#                                alone cannot open it (M0-6, ADR-0014)
#   ci-checks.sh schedule        the daily backup line goes into crontab once, and out again
#   ci-checks.sh cleanup         pnpm local:cleanup deletes an expired session and keeps a live one
#   ci-checks.sh alerts          a failed backup, a stale-backup check and the test command each
#                                reach a webhook (a local listener stands in for Slack/Telegram)
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/local/lib.sh
source "$SCRIPT_DIR/lib.sh"
load_env

# Invert one byte in place. Writing a fixed value could leave the file unchanged
# when that byte already had the value (about 1 run in 256 for a random file).
flip_byte() {
  local file="$1" offset="$2" byte
  byte="$(dd if="$file" bs=1 skip="$offset" count=1 status=none | od -An -tu1 | tr -d ' ')"
  local octal
  octal="$(printf '%03o' $((byte ^ 255)))"
  printf '%b' "\\0$octal" | dd of="$file" bs=1 seek="$offset" conv=notrunc status=none
}

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
  flip_byte "$work/damaged/$name.dump.enc" 4096
  expect_drill_failure "a damaged file" "$work/damaged/$name.dump.enc"

  # A damaged file whose checksum files were updated to match: decryption or the dump checksum stops it
  mkdir "$work/rehashed"
  cp "$source".* "$work/rehashed/"
  flip_byte "$work/rehashed/$name.dump.enc" 4096
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

api_post() { # api_post <path> <json>: body in $work/out, prints the status
  curl --noproxy '*' -sS --max-time 20 --cacert "$CA_EXPORT" -o "$work/out" -w '%{http_code}' \
    -H 'Content-Type: application/json' --data-binary "$2" "$API_BASE$1"
}

json_field() { # json_field <name>: a string field of $work/out
  sed -n "s/.*\"$1\":\"\([^\"]*\)\".*/\1/p" "$work/out"
}

signup() {
  [[ -s "$CA_EXPORT" ]] || export_ca
  API_BASE="https://localhost:${SERVA_HTTPS_PORT:-443}"
  work="$(mktemp -d)"
  trap 'rm -rf "$work"' RETURN

  local terms phone status registration code token
  terms="$(sed -n "s/^export const TERMS_VERSION = '\([^']*\)';/\1/p" "$ROOT_DIR/packages/core/src/contracts/auth.ts")"
  [[ -n "$terms" ]] || die "Cannot read TERMS_VERSION from packages/core"
  # A fresh number on every run: 093 then 7 random digits
  phone="093$(printf '%07d' $(($(od -An -N4 -tu4 /dev/urandom | tr -d ' ') % 10000000)))"

  local start
  start="$(printf '{"phone":"%s","fullName":"متجر فحص التشغيل","password":"ci-signup-pass-1","termsVersion":"%s"}' "$phone" "$terms")"
  status="$(api_post /v1/auth/register "$start")"
  [[ "$status" == 202 ]] || die "Sign-up step 1 answered $status: $(head -c 300 "$work/out")"
  registration="$(json_field registrationId)"
  code="$(json_field testCode)"
  [[ -n "$registration" && "$code" =~ ^[0-9]{6}$ ]] ||
    die "Sign-up step 1 shows no test code (is SERVA_OTP_DELIVERY=screen?): $(head -c 300 "$work/out")"
  ok "Sign-up step 1: 202 with the on-screen test code"

  status="$(api_post /v1/auth/register/verify "$(printf '{"registrationId":"%s","code":"%s","password":"ci-signup-pass-1"}' "$registration" "$code")")"
  [[ "$status" == 201 ]] || die "Sign-up step 2 answered $status: $(head -c 300 "$work/out")"
  token="$(json_field accessToken)"
  [[ -n "$token" ]] || die "Sign-up step 2 gave no access token"
  ok "Sign-up step 2: the code opened the store (201)"

  status="$(curl --noproxy '*' -sS --max-time 20 --cacert "$CA_EXPORT" -o "$work/out" -w '%{http_code}' \
    -H "Authorization: Bearer $token" "$API_BASE/v1/me")"
  if [[ "$status" != 200 ]] || ! grep -q 'متجر فحص التشغيل' "$work/out"; then
    die "/v1/me after sign-up answered $status"
  fi
  ok "The new owner is signed in (/v1/me)"

  # The same number again: a code-shaped answer that verification must refuse
  status="$(api_post /v1/auth/register "$start")"
  registration="$(json_field registrationId)"
  code="$(json_field testCode)"
  [[ "$status" == 202 && "$code" =~ ^[0-9]{6}$ ]] || die "A registered number got $status without a code-shaped answer"
  status="$(api_post /v1/auth/register/verify "$(printf '{"registrationId":"%s","code":"%s","password":"ci-other-pass-1"}' "$registration" "$code")")"
  if [[ "$status" != 400 ]] || ! grep -q '"otp_invalid"' "$work/out"; then
    die "The code shown for a registered number was accepted ($status): $(head -c 300 "$work/out")"
  fi
  ok "A registered number gets a code that verification refuses (no account found out)"
}

# The drill's own files: what the tills keep between steps, and the fingerprints taken on the way
DRILL_DIR="${SERVA_DRILL_DIR:-${RUNNER_TEMP:-/tmp}/serva-drill}"

day() {
  local step="${1:?usage: ci-checks.sh day seed|after-backup|resend}"
  mkdir -p "$DRILL_DIR"
  [[ -s "$CA_EXPORT" ]] || export_ca
  API_BASE="https://localhost:${SERVA_HTTPS_PORT:-443}" NODE_EXTRA_CA_CERTS="$CA_EXPORT" \
    pnpm --silent --filter @serva/api exec tsx test/drill/restore-drill.ts "$step" "$DRILL_DIR/tills.json"
}

books() {
  local name="${1:?usage: ci-checks.sh books <name>}"
  mkdir -p "$DRILL_DIR"
  local status=0
  DATABASE_MIGRATION_URL="postgres://serva_owner:${SERVA_OWNER_PASSWORD}@127.0.0.1:${SERVA_PG_PORT:-5433}/serva" \
    pnpm --silent --filter @serva/api integrity --json > "$DRILL_DIR/$name.json" || status=$?
  if ((status != 0)); then
    cat "$DRILL_DIR/$name.json"
    die "The integrity check of the live books FAILED ($name)"
  fi
  ok "Integrity check passed on every store ($name): $(drill_books "$name")"
}

# drill_books <name>: "ledger <hash> (<n> entries), stock <hash>" of the drill store in <name>.json
drill_books() {
  # shellcheck disable=SC2016 # JavaScript, not shell
  node -e '
    const report = require(process.argv[1]);
    const tills = require(process.argv[2]);
    const store = report.stores.find((s) => s.tenantId === tills.tenantId);
    if (!store) { console.log("no drill store"); process.exit(0); }
    console.log(`ledger ${store.ledger.hash.slice(0, 16)}… (${store.ledger.rows} entries), stock ${store.stock.hash.slice(0, 16)}…`);
  ' "$DRILL_DIR/$1.json" "$DRILL_DIR/tills.json"
}

compare_books() { # compare_books <same|other> <a> <b>
  local want="$1" a="$2" b="$3" result
  result="$(node -e '
    const [a, b, tills] = process.argv.slice(1).map((f) => require(f));
    const pick = (r) => r.stores.find((s) => s.tenantId === tills.tenantId);
    const x = pick(a), y = pick(b);
    if (!x || !y) { console.log("missing"); process.exit(0); }
    console.log(x.ledger.hash === y.ledger.hash && x.stock.hash === y.stock.hash ? "same" : "other");
  ' "$DRILL_DIR/$a.json" "$DRILL_DIR/$b.json" "$DRILL_DIR/tills.json")"
  [[ "$result" == "$want" ]] ||
    die "The drill store's books are '$result' between $a ($(drill_books "$a")) and $b ($(drill_books "$b")); expected '$want'"
  if [[ "$want" == same ]]; then ok "Same books in $a and $b: $(drill_books "$b")"; else
    ok "The books of $a and $b differ, as they must ($(drill_books "$a") / $(drill_books "$b"))"
  fi
}

drill_tenant() { node -e 'console.log(require(process.argv[1]).tenantId)' "$DRILL_DIR/tills.json"; }

numbers() {
  local name="${1:?usage: ci-checks.sh numbers <name>}"
  psql_live -c "select number || ' ' || source_type || ':' || source_id || ':' || kind from journal_entries
                where tenant_id = '$(drill_tenant)' order by number" > "$DRILL_DIR/$name.numbers"
  ok "$(wc -l < "$DRILL_DIR/$name.numbers") entry numbers kept ($name)"
}

no_reused_numbers() {
  local a="${1:?}" b="${2:?}" clashes moved
  # The same number, another document: the number now means something else
  clashes="$(join -j 1 <(LC_ALL=C sort "$DRILL_DIR/$a.numbers") <(LC_ALL=C sort "$DRILL_DIR/$b.numbers") |
    awk '$2 != $3' | head -n 5)"
  [[ -z "$clashes" ]] || die "Entry numbers reused for other documents between $a and $b:
$clashes"
  # Documents whose entry got another number: those the restore lost and the tills brought back
  moved="$(join -1 2 -2 2 <(awk '{print $1, $2}' "$DRILL_DIR/$a.numbers" | LC_ALL=C sort -k2) \
    <(awk '{print $1, $2}' "$DRILL_DIR/$b.numbers" | LC_ALL=C sort -k2) | awk '$2 != $3' | wc -l)"
  ok "No entry number means two documents between $a and $b; $moved re-posted entries took new numbers"
}

offsite_and_key() {
  local offsite="$DRILL_DIR/offsite" copy parts key pair a b
  rm -rf "$offsite"
  SERVA_OFFSITE_DIR="$offsite" bash "$SCRIPT_DIR/backup.sh" --label offsite > "$DRILL_DIR/offsite.log" 2>&1 || {
    cat "$DRILL_DIR/offsite.log"
    die "The backup with an off-site copy failed"
  }
  grep -q 'Off-site copy verified' "$DRILL_DIR/offsite.log" || die "No off-site copy was reported"
  copy="$(find "$offsite" -maxdepth 1 -name 'serva-*-offsite.dump.enc' | head -n 1)"
  [[ -n "$copy" ]] || die "No backup arrived in the off-site folder"
  (cd "$offsite" && sha256sum --status -c "$(basename "$copy").sha256") || die "The off-site copy fails its checksum"
  ok "Off-site copy made and verified: $(basename "$copy")"

  # The off-site folder alone is not enough: the key travels separately, in three parts
  parts="$(node "$SCRIPT_DIR/key-split.mjs" split | tr -d '\n' | grep -oE 'SK1-[0-9a-f]{8}-[1-3]-[0-9a-f ]+-[0-9a-f]{6}' | tr -d ' ')"
  mapfile -t parts <<< "$parts"
  ((${#parts[@]} == 3)) || die "Expected three key parts, got ${#parts[@]}"
  for pair in "0 1" "0 2" "1 2"; do
    read -r a b <<< "$pair"
    key="$(node "$SCRIPT_DIR/key-split.mjs" combine "${parts[$a]}" "${parts[$b]}")"
    SERVA_BACKUP_PASSPHRASE="$key" bash "$SCRIPT_DIR/restore.sh" "$copy" > "$DRILL_DIR/key-$a$b.log" 2>&1 || {
      cat "$DRILL_DIR/key-$a$b.log"
      die "Parts $((a + 1)) and $((b + 1)) did not restore the off-site copy"
    }
    ok "Parts $((a + 1)) and $((b + 1)) restore the off-site copy (drill PASSED)"
  done
  for a in 0 1 2; do
    if node "$SCRIPT_DIR/key-split.mjs" combine "${parts[$a]}" > /dev/null 2>&1; then
      die "Part $((a + 1)) alone gave a key"
    fi
  done
  ok "No single part gives the key"
}

schedule_check() {
  bash "$SCRIPT_DIR/schedule.sh" install
  bash "$SCRIPT_DIR/schedule.sh" install
  [[ "$(crontab -l | grep -c 'serva-daily-backup')" == 1 ]] || die "Installing twice must leave one line"
  [[ "$(crontab -l | grep -c 'serva-daily-cleanup')" == 1 ]] || die "Installing twice must leave one cleanup line"
  crontab -l | grep -q 'scripts/local/cleanup.sh' || die "The cron line does not run the cleanup"
  # Without a webhook there are no watch jobs; with one, they are added once and removed with the rest
  SERVA_ALERT_WEBHOOK_URL=http://127.0.0.1:1/x bash "$SCRIPT_DIR/schedule.sh" install
  SERVA_ALERT_WEBHOOK_URL=http://127.0.0.1:1/x bash "$SCRIPT_DIR/schedule.sh" install
  [[ "$(crontab -l | grep -c 'serva-backup-watch')" == 1 ]] || die "The stale-backup check must be scheduled once"
  [[ "$(crontab -l | grep -c 'serva-health-watch')" == 1 ]] || die "The health check must be scheduled once"
  bash "$SCRIPT_DIR/schedule.sh" install
  crontab -l | grep -q 'scripts/local/backup.sh --label daily' || die "The cron line does not run the backup"
  bash "$SCRIPT_DIR/schedule.sh" status || true
  bash "$SCRIPT_DIR/schedule.sh" remove
  if crontab -l 2> /dev/null | grep -q 'serva-daily-backup\|serva-daily-cleanup\|serva-backup-watch\|serva-health-watch'; then die "remove left a line"; fi
  ok "The daily backup is scheduled once, and removed cleanly"
}

cleanup_check() {
  local live_before gone
  psql_live -c "select count(*) from sessions" > /dev/null
  psql_live -c "insert into sessions (id, tenant_id, user_id, family_id, token_hash, expires_at, absolute_expires_at, revoked_at)
    select gen_random_uuid(), tenant_id, user_id, family_id, 'ci-expired', now() - interval '10 days', now() + interval '30 days', now()
    from sessions limit 1" > /dev/null
  [[ "$(psql_live -c "select count(*) from sessions where token_hash = 'ci-expired'")" == 1 ]] ||
    die "No session to copy: sign up a store first (ci-checks.sh signup)"
  live_before="$(psql_live -c "select count(*) from sessions where token_hash <> 'ci-expired' and least(expires_at, absolute_expires_at) > now()")"
  bash "$SCRIPT_DIR/cleanup.sh" || die "pnpm local:cleanup failed"
  gone="$(psql_live -c "select count(*) from sessions where token_hash = 'ci-expired'")"
  [[ "$gone" == 0 ]] || die "The expired session is still there after the cleanup"
  [[ "$(psql_live -c "select count(*) from sessions where token_hash <> 'ci-expired' and least(expires_at, absolute_expires_at) > now()")" == "$live_before" ]] ||
    die "The cleanup deleted a session that is still valid"
  ok "Cleanup removed the expired session and kept the $live_before valid ones"
}

alerts_check() {
  local dir port=18555 listener rc
  dir="$(mktemp -d)"
  python3 - "$port" "$dir/received.log" << 'PY' &
import sys
from http.server import BaseHTTPRequestHandler, HTTPServer
class H(BaseHTTPRequestHandler):
    def do_POST(self):
        n = int(self.headers.get("content-length") or 0)
        open(sys.argv[2], "a").write(self.rfile.read(n).decode() + "\n")
        self.send_response(200); self.end_headers()
    def log_message(self, *a): pass
HTTPServer(("127.0.0.1", int(sys.argv[1])), H).serve_forever()
PY
  listener=$!
  trap 'kill "$listener" 2> /dev/null || true; rm -rf "$dir"' RETURN
  sleep 1
  export SERVA_ALERT_WEBHOOK_URL="http://127.0.0.1:$port/hook" SERVA_ALERT_NAME=ci
  bash "$SCRIPT_DIR/alert.sh" test || die "pnpm local:alert test failed"
  grep -q 'Test alert' "$dir/received.log" || die "The test alert did not reach the webhook"
  # A backup that cannot start (passphrase too short) must alert
  rc=0
  SERVA_BACKUP_PASSPHRASE=short bash "$SCRIPT_DIR/backup.sh" --label alerttest > /dev/null 2>&1 || rc=$?
  ((rc != 0)) || die "A backup without a proper passphrase succeeded"
  grep -q 'BACKUP ALERT' "$dir/received.log" || die "The failed backup sent no alert"
  # An empty backup folder is stale: the hourly check must alert
  mkdir -p "$dir/empty"
  SERVA_BACKUP_DIR="$dir/empty" bash "$SCRIPT_DIR/schedule.sh" check > /dev/null 2>&1 || true
  grep -q 'BACKUPS NEED ATTENTION' "$dir/received.log" || die "The stale-backup check sent no alert"
  ok "Alerts reach the webhook: test message, failed backup, stale backups"
}

case "${1:-}" in
  cleanup) cleanup_check ;;
  alerts) alerts_check ;;
  hardening) hardening ;;
  seed) seed ;;
  negative) negative "${2:-}" ;;
  fixture-present) fixture_present ;;
  signup) signup ;;
  day) day "${2:-}" ;;
  books) books "${2:-}" ;;
  same-books) compare_books same "${2:?}" "${3:?}" ;;
  other-books) compare_books other "${2:?}" "${3:?}" ;;
  numbers) numbers "${2:-}" ;;
  no-reused-numbers) no_reused_numbers "${2:-}" "${3:-}" ;;
  offsite-and-key) offsite_and_key ;;
  schedule) schedule_check ;;
  *) die "Usage: ci-checks.sh hardening | seed | negative <file> | fixture-present | signup | day <step> | books <name> | same-books <a> <b> | other-books <a> <b>" ;;
esac
