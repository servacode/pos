#!/usr/bin/env bash
# pnpm local:smoke — checks the running local server the way a device sees it, over HTTPS with the
# local CA (no -k): the API health, the web app, its security headers and CSP nonce, the HTTP
# redirect, and (when found) the LAN address. Exits non-zero, loudly, on any failure.
#   SERVA_SMOKE_TIMEOUT  seconds to wait for the first answer (default 90)
#   SERVA_SMOKE_LAN=require  a LAN address failure fails the test (CI); default: warning only
set -euo pipefail
# shellcheck source=scripts/local/lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

preflight
load_env
[[ -n "${SERVA_LAN_IPS+x}" ]] || export_lan_ips

failures=()
pass() { ok "$1"; }
fail() {
  printf '%s\n' "${C_RED}✘${C_RESET} $1" >&2
  failures+=("$1")
}

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
https_base="https://localhost:$SERVA_HTTPS_PORT"
http_base="http://localhost:$SERVA_HTTP_PORT"

# The CA certificate, as a device would download it
if ! curl --noproxy '*' -fsS --max-time 10 -o "$CA_EXPORT.partial" "$http_base/serva-local-ca.crt" 2> "$work/err"; then
  export_ca 2> /dev/null || true
else
  mv "$CA_EXPORT.partial" "$CA_EXPORT"
fi
[[ -s "$CA_EXPORT" ]] || die "SMOKE FAILED: cannot get the local CA certificate from $http_base (is the server up? pnpm local:up)"

get() { # get <url> <name>: body in $work/<name>.body, headers in $work/<name>.headers, prints status
  curl --noproxy '*' -sS --max-time 15 --cacert "$CA_EXPORT" -D "$work/$2.headers" -o "$work/$2.body" -w '%{http_code}' "$1" 2>> "$work/err" || echo 000
}
header() { # header <name> <header>: value of a response header (case-insensitive)
  grep -i "^$2:" "$work/$1.headers" | head -n 1 | cut -d: -f2- | sed 's/^ *//; s/\r$//'
}

# 1. Wait for the API through the proxy
deadline=$((SECONDS + ${SERVA_SMOKE_TIMEOUT:-90}))
status=000
while ((SECONDS < deadline)); do
  status="$(get "$https_base/health" health)"
  [[ "$status" == 200 ]] && break
  sleep 2
done
if [[ "$status" == 200 ]] && grep -q '"ok":true' "$work/health.body"; then
  pass "API health over HTTPS: 200 {\"ok\":true}"
else
  fail "API health over HTTPS: got $status $(head -c 200 "$work/health.body" 2> /dev/null) $(tail -n 2 "$work/err")"
fi
if [[ "$(header health content-security-policy)" == "default-src 'none'"* ]]; then
  pass "/health is answered by the API itself (its JSON-only CSP)"
else
  fail "/health is not answered by the API (CSP: $(header health content-security-policy))"
fi

# Test mode (sign-up codes on screen) is on exactly when deploy/local/.env asks for it
want_test_mode=false
[[ "${SERVA_OTP_DELIVERY:-screen}" == screen ]] && want_test_mode=true
status="$(get "$https_base/v1/meta" meta)"
if [[ "$status" == 200 ]] && grep -q "\"testMode\":$want_test_mode" "$work/meta.body"; then
  pass "Test mode is $want_test_mode, as SERVA_OTP_DELIVERY asks (/v1/meta)"
  if [[ "$want_test_mode" == true ]]; then
    warn "TEST MODE: sign-up codes are shown on screen. Set SERVA_OTP_DELIVERY=none in deploy/local/.env to turn it off."
  fi
else
  fail "/v1/meta: got $status $(head -c 200 "$work/meta.body" 2> /dev/null), expected testMode $want_test_mode"
fi

# 2. The web app
status="$(get "$https_base/" index)"
if [[ "$status" == 200 ]] && grep -q 'id="root"' "$work/index.body"; then
  pass "Web app over HTTPS: 200 with the app shell"
else
  fail "Web app over HTTPS: got $status"
fi
if [[ "$(get "$https_base/sales/today" deep)" == 200 ]] && grep -q 'id="root"' "$work/deep.body"; then
  pass "App routes fall back to index.html"
else
  fail "App route /sales/today does not serve the app"
fi

csp="$(header index content-security-policy)"
nonce="$(sed -n "s/.*'nonce-\([0-9a-f]\{32\}\)'.*/\1/p" <<< "$csp")"
if [[ -n "$nonce" && "$csp" == *"frame-ancestors 'none'"* && "$csp" == *"object-src 'none'"* && "$csp" != *unsafe-inline* && "$csp" != *unsafe-eval* ]]; then
  pass "CSP with a per-request nonce, no unsafe-inline/unsafe-eval, never framed"
else
  fail "CSP missing or weak: $csp"
fi
scripts_total="$(grep -o '<script' "$work/index.body" | wc -l)"
scripts_nonced="$(grep -o "<script nonce=\"$nonce\"" "$work/index.body" | wc -l)"
if [[ -n "$nonce" && "$scripts_total" -gt 0 && "$scripts_total" == "$scripts_nonced" ]]; then
  pass "Every <script> carries this request's nonce ($scripts_nonced)"
else
  fail "Script tags without the nonce: $scripts_nonced of $scripts_total"
fi
get "$https_base/" index2 > /dev/null
nonce2="$(sed -n "s/.*'nonce-\([0-9a-f]\{32\}\)'.*/\1/p" <<< "$(header index2 content-security-policy)")"
if [[ -n "$nonce2" && "$nonce2" != "$nonce" ]]; then
  pass "A new nonce on every request"
else
  fail "The nonce repeats between requests"
fi
for expected in "x-frame-options: DENY" "x-content-type-options: nosniff" "referrer-policy: no-referrer" "cross-origin-opener-policy: same-origin"; do
  name="${expected%%:*}"
  if [[ "$(header index "$name")" == "${expected#*: }" ]]; then pass "Header $expected"; else fail "Header $name is '$(header index "$name")', expected '${expected#*: }'"; fi
done
if [[ "$(header index strict-transport-security)" == max-age=* ]]; then pass "HSTS on HTTPS"; else fail "HSTS missing"; fi
if [[ "$(header index cache-control)" == "no-cache" ]]; then pass "index.html is revalidated (new releases show at once)"; else fail "index.html cache-control: $(header index cache-control)"; fi
if grep -qi '^server: nginx/' "$work/index.headers"; then fail "nginx version is disclosed"; else pass "Server version not disclosed"; fi

# 3. A built asset
asset="$(grep -o '/assets/[^"]*\.js' "$work/index.body" | head -n 1 || true)"
if [[ -n "$asset" && "$(get "$https_base$asset" asset)" == 200 && "$(header asset content-type)" == *javascript* && "$(header asset cache-control)" == *immutable* ]]; then
  pass "Asset $asset: 200, JavaScript, cached immutably"
else
  fail "Asset ${asset:-<none found in index.html>} not served correctly"
fi
if [[ "$(get "$https_base/assets/does-not-exist.js" missing)" == 404 ]]; then
  pass "A missing asset is a 404 (not the app shell)"
else
  fail "A missing asset does not answer 404"
fi

# 4. Plain HTTP redirects to HTTPS
code="$(curl --noproxy '*' -sS --max-time 10 -o /dev/null -w '%{http_code} %{redirect_url}' "$http_base/" 2>> "$work/err" || echo 000)"
if [[ "$code" == "301 https://localhost:$SERVA_HTTPS_PORT/" ]]; then
  pass "HTTP redirects to HTTPS"
else
  fail "HTTP does not redirect to HTTPS (got: $code)"
fi

# 5. The LAN address, as a cashier device reaches it
IFS=, read -r -a ips <<< "${SERVA_LAN_IPS:-}"
if ((${#ips[@]} == 0)); then
  if [[ "${SERVA_SMOKE_LAN:-}" == require ]]; then fail "No LAN address found"; else warn "No LAN address found; skipped the LAN check."; fi
fi
for ip in "${ips[@]}"; do
  status="$(get "https://$ip:$SERVA_HTTPS_PORT/health" "lan-$ip")"
  if [[ "$status" == 200 ]]; then
    pass "Reachable on the LAN with a trusted certificate: https://$ip:$SERVA_HTTPS_PORT"
  elif [[ "${SERVA_SMOKE_LAN:-}" == require ]]; then
    fail "Not reachable on the LAN address $ip (status $status)"
  else
    warn "Not reachable from here on $ip (status $status). On WSL this is normal without mirrored networking; check from a device."
  fi
done

if ((${#failures[@]} > 0)); then
  {
    echo
    dc ps -a || true
    dc logs --tail 40 api web || true
    tail -n 5 "$work/err" 2> /dev/null || true
  } >&2
  banner "$C_RED" "SMOKE TEST FAILED: ${#failures[@]} check(s)" "فشل فحص التشغيل." >&2
  printf '  - %s\n' "${failures[@]}" >&2
  exit 1
fi
banner "$C_GREEN" "SMOKE TEST PASSED" "فحص التشغيل ناجح."
