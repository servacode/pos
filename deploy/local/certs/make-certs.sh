#!/usr/bin/env bash
# Runs in the one-shot `certs` service (deploy/local/compose.yml).
#
# Browsers allow the offline app (service worker), secure cookies and device APIs only on https://,
# and a shop network has no domain name for a public certificate. So the local server has its own
# small certificate authority (CA):
#   /ca/ca.key      CA private key: only in the `ca` volume, never served, never on the web container
#   /certs/ca.crt   CA public certificate: installed once on each device (docs/local-server.md)
#   /certs/server.* this computer's certificate for its LAN addresses, signed by the CA
#
# The CA may only sign private addresses and local names (name constraints), so even a stolen CA
# key cannot impersonate a real website on a device that trusts it.
# The server certificate is renewed when the addresses change or 30 days before it expires.
set -euo pipefail

CA_DIR=/ca
OUT=/certs
NGINX_UID=101
umask 077

is_private_ipv4() {
  local ip="$1" a b c d
  [[ "$ip" =~ ^([0-9]{1,3})\.([0-9]{1,3})\.([0-9]{1,3})\.([0-9]{1,3})$ ]] || return 1
  a=${BASH_REMATCH[1]} b=${BASH_REMATCH[2]} c=${BASH_REMATCH[3]} d=${BASH_REMATCH[4]}
  ((a <= 255 && b <= 255 && c <= 255 && d <= 255)) || return 1
  ((a == 10 || a == 127)) && return 0
  ((a == 172 && b >= 16 && b <= 31)) && return 0
  ((a == 192 && b == 168)) && return 0
  ((a == 100 && b >= 64 && b <= 127)) && return 0
  return 1
}

is_local_name() {
  local name="${1,,}"
  [[ "$name" =~ ^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$ ]] || return 1
  [[ "$name" == localhost || "$name" == *.local || "$name" == *.lan || "$name" == *.home.arpa || "$name" == *.internal ]]
}

# ─── The CA, created once ───────────────────────────────────────────────────────────────────────
if [[ ! -s "$CA_DIR/ca.key" || ! -s "$CA_DIR/ca.crt" ]]; then
  echo "certs: creating the local certificate authority"
  suffix="$(od -An -N4 -tx1 /dev/urandom | tr -d ' \n')"
  openssl req -x509 -new -nodes -sha256 -days 3650 \
    -newkey ec -pkeyopt ec_paramgen_curve:P-256 \
    -keyout "$CA_DIR/ca.key" -out "$CA_DIR/ca.crt" \
    -subj "/O=Serva POS local server/CN=Serva Local CA $suffix" \
    -addext "basicConstraints=critical,CA:TRUE,pathlen:0" \
    -addext "keyUsage=critical,keyCertSign,cRLSign" \
    -addext "subjectKeyIdentifier=hash" \
    -addext "nameConstraints=critical,permitted;IP:10.0.0.0/255.0.0.0,permitted;IP:172.16.0.0/255.240.0.0,permitted;IP:192.168.0.0/255.255.0.0,permitted;IP:127.0.0.0/255.0.0.0,permitted;IP:100.64.0.0/255.192.0.0,permitted;DNS:localhost,permitted;DNS:.local,permitted;DNS:.lan,permitted;DNS:.home.arpa,permitted;DNS:.internal" \
    2> /dev/null
  rm -f "$OUT/server.crt"
fi
chmod 700 "$CA_DIR"
chmod 600 "$CA_DIR/ca.key"

# ─── Names and addresses this server answers on ─────────────────────────────────────────────────
declare -A seen=()
sans=()
add_san() {
  [[ -n "${seen[$1]:-}" ]] && return 0
  seen[$1]=1
  sans+=("$1")
}
add_san "DNS:localhost"
add_san "DNS:serva.local"
add_san "IP:127.0.0.1"
IFS=', ' read -r -a entries <<< "${SERVA_LAN_IPS:-} ${SERVA_EXTRA_HOSTS:-}"
for entry in "${entries[@]}"; do
  [[ -z "$entry" ]] && continue
  if is_private_ipv4 "$entry"; then
    add_san "IP:$entry"
  elif is_local_name "$entry"; then
    add_san "DNS:${entry,,}"
  else
    echo "certs: skipped '$entry' (only private IPv4 addresses and .local/.lan/.home.arpa/.internal names)" >&2
  fi
done
san_line="$(IFS=,; echo "${sans[*]}")"

# ─── The server certificate, renewed when needed ────────────────────────────────────────────────
renew=""
if [[ ! -s "$OUT/server.crt" || ! -s "$OUT/server.key" ]]; then
  renew="no certificate yet"
elif [[ "$(cat "$OUT/san.txt" 2> /dev/null)" != "$san_line" ]]; then
  renew="the addresses changed"
elif ! openssl x509 -checkend $((30 * 24 * 3600)) -noout -in "$OUT/server.crt" > /dev/null; then
  renew="it expires within 30 days"
elif ! openssl verify -CAfile "$CA_DIR/ca.crt" "$OUT/server.crt" > /dev/null 2>&1; then
  renew="it is not signed by the current CA"
fi

if [[ -n "$renew" ]]; then
  echo "certs: issuing the server certificate ($renew)"
  tmp="$(mktemp -d)"
  openssl req -new -nodes -newkey ec -pkeyopt ec_paramgen_curve:P-256 \
    -keyout "$tmp/server.key" -out "$tmp/server.csr" -subj "/O=Serva POS local server/CN=serva.local" 2> /dev/null
  cat > "$tmp/ext.cnf" << EOF
basicConstraints=critical,CA:FALSE
keyUsage=critical,digitalSignature
extendedKeyUsage=serverAuth
subjectAltName=$san_line
authorityKeyIdentifier=keyid
subjectKeyIdentifier=hash
EOF
  # 397 days: the longest validity Apple and Chrome accept for a server certificate
  openssl x509 -req -sha256 -days 397 -in "$tmp/server.csr" \
    -CA "$CA_DIR/ca.crt" -CAkey "$CA_DIR/ca.key" -CAcreateserial -CAserial "$CA_DIR/ca.srl" \
    -extfile "$tmp/ext.cnf" -out "$tmp/server.crt" 2> /dev/null
  openssl verify -CAfile "$CA_DIR/ca.crt" "$tmp/server.crt" > /dev/null
  install -m 600 -o "$NGINX_UID" -g "$NGINX_UID" "$tmp/server.key" "$OUT/server.key"
  install -m 644 "$tmp/server.crt" "$OUT/server.crt"
  echo "$san_line" > "$OUT/san.txt"
  rm -rf "$tmp"
fi
install -m 644 "$CA_DIR/ca.crt" "$OUT/ca.crt"
chmod 755 "$OUT"
chmod 644 "$OUT/san.txt"
echo "certs: ready for $san_line"
