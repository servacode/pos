#!/usr/bin/env bash
# Shared helpers for the local server scripts (sourced, not run). Linux, or Windows through WSL 2.
# Needs: bash, Docker with Compose v2, curl, coreutils (sha256sum, od). No Node.js required.

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
DEPLOY_DIR="$ROOT_DIR/deploy/local"
COMPOSE_FILE_PATH="$DEPLOY_DIR/compose.yml"
ENV_FILE="${SERVA_ENV_FILE:-$DEPLOY_DIR/.env}"
CA_EXPORT="$DEPLOY_DIR/serva-local-ca.crt"

if [[ -t 1 ]]; then
  C_RED=$'\e[31m' C_GREEN=$'\e[32m' C_YELLOW=$'\e[33m' C_BOLD=$'\e[1m' C_RESET=$'\e[0m'
else
  C_RED='' C_GREEN='' C_YELLOW='' C_BOLD='' C_RESET=''
fi

info() { printf '%s\n' "› $*"; }
ok() { printf '%s\n' "${C_GREEN}✔${C_RESET} $*"; }
warn() { printf '%s\n' "${C_YELLOW}!${C_RESET} $*" >&2; }
die() {
  printf '%s\n' "${C_RED}✘ $*${C_RESET}" >&2
  exit 1
}

banner() {
  local colour="$1"
  shift
  printf '\n%s\n' "${colour}${C_BOLD}════════════════════════════════════════════════════════════${C_RESET}"
  for line in "$@"; do printf '%s\n' "${colour}${C_BOLD}  $line${C_RESET}"; done
  printf '%s\n\n' "${colour}${C_BOLD}════════════════════════════════════════════════════════════${C_RESET}"
}

# docker compose for this stack; SERVA_COMPOSE_OVERRIDE adds a file of your own (e.g. other ports)
dc() {
  # Every compose call must see the LAN addresses: when "certs" re-runs (any "up"), it reissues the
  # server certificate for exactly these addresses, and a call without them drops the LAN address.
  [[ -n "${SERVA_LAN_IPS+set}" ]] || export_lan_ips
  local files=(-f "$COMPOSE_FILE_PATH")
  if [[ -n "${SERVA_COMPOSE_OVERRIDE:-}" ]]; then files+=(-f "$SERVA_COMPOSE_OVERRIDE"); fi
  docker compose --project-directory "$DEPLOY_DIR" "${files[@]}" --env-file "$ENV_FILE" "$@"
}

is_wsl() { grep -qi microsoft /proc/version 2> /dev/null; }

preflight() {
  command -v docker > /dev/null || die "Docker is not installed. See docs/local-server.md (تثبيت Docker)."
  docker info > /dev/null 2>&1 || die "Docker is installed but not running. Start Docker Desktop (Windows) or 'sudo systemctl start docker' (Linux), then try again."
  docker compose version > /dev/null 2>&1 || die "Docker Compose v2 is missing ('docker compose'). Update Docker."
  local need
  for need in curl sha256sum od; do
    command -v "$need" > /dev/null || die "'$need' is missing. On Ubuntu/WSL: sudo apt-get install -y curl coreutils"
  done
  if is_wsl && [[ "$ROOT_DIR" == /mnt/* ]]; then
    warn "The project is under $ROOT_DIR (a Windows drive). Clone it inside WSL (e.g. ~/serva-pos) for correct file permissions and speed."
  fi
}

random_hex() { od -An -N"$1" -tx1 /dev/urandom | tr -d ' \n'; }

# Creates deploy/local/.env with strong random secrets, once. Never overwrites it: the database
# volume and the backups depend on these values.
ensure_env() {
  if [[ -f "$ENV_FILE" ]]; then return 0; fi
  info "First run: creating $ENV_FILE with new random secrets"
  local admin_password backup_passphrase
  admin_password="$(random_hex 12)"
  backup_passphrase="$(random_hex 32)"
  (
    umask 077
    cat > "$ENV_FILE" << EOF
# Serva local server settings, created by scripts/local on $(date -u +%Y-%m-%dT%H:%M:%SZ).
# SECRET: never commit, send or share this file. It is ignored by git (deploy/local/.gitignore).
# Do not regenerate it once the server has data: the database passwords live inside the volume.

# Database passwords (superuser, migration owner, API runtime role)
POSTGRES_PASSWORD=$(random_hex 24)
SERVA_OWNER_PASSWORD=$(random_hex 24)
SERVA_APP_PASSWORD=$(random_hex 24)

# Signs sign-in tokens
JWT_SECRET=$(random_hex 48)

# Encrypts the backups. KEEP A COPY OUTSIDE THIS COMPUTER (paper or a password manager):
# without it no backup can ever be opened, and a new computer needs it to restore.
SERVA_BACKUP_PASSPHRASE=$backup_passphrase

# First platform admin (created by the migrate service)
PLATFORM_ADMIN_EMAIL=admin@serva.local
PLATFORM_ADMIN_PASSWORD=$admin_password

# Ports on this computer: devices open https://<LAN address> (443) or http:// (80, redirects)
SERVA_HTTP_PORT=80
SERVA_HTTPS_PORT=443
# PostgreSQL for tools on this computer only (bound to 127.0.0.1)
SERVA_PG_PORT=5433

# Internal Docker network; change both together if this range is used on your network
SERVA_SUBNET=172.30.77.0/24
SERVA_PROXY_IP=172.30.77.10

# More names or addresses for the HTTPS certificate, comma-separated
# (private IPv4 addresses, or names ending in .local .lan .home.arpa .internal)
SERVA_EXTRA_HOSTS=

# Test mode: there is no SMS here, so the sign-up code is shown on screen and every page carries
# «نسخة تجربة على الخادم المحلي». Set to none to stop sign-up instead (docs/local-server.md).
SERVA_OTP_DELIVERY=screen

# Backups: folder and how many to keep (oldest are deleted)
SERVA_BACKUP_DIR=
SERVA_BACKUP_KEEP=14
EOF
  )
  ok "Secrets created."
  banner "$C_YELLOW" \
    "Write these down now and keep them OUTSIDE this computer:" \
    "  Backup passphrase:  $backup_passphrase" \
    "  Platform admin:     admin@serva.local / $admin_password" \
    "احفظ كلمة سر النسخ الاحتياطي خارج هذا الكمبيوتر (ورقة أو مدير كلمات سر)."
}

# Loads deploy/local/.env into the environment. Values already set in the environment win, so a
# one-off override works: SERVA_HTTPS_PORT=8443 pnpm local:up
load_env() {
  [[ -f "$ENV_FILE" ]] || die "$ENV_FILE is missing. Run: pnpm local:up"
  local line key value
  while IFS= read -r line || [[ -n "$line" ]]; do
    line="${line%$'\r'}"
    [[ -z "$line" || "$line" == \#* || "$line" != *=* ]] && continue
    key="${line%%=*}"
    value="${line#*=}"
    [[ "$key" =~ ^[A-Z_][A-Z0-9_]*$ ]] || continue
    if [[ -z "${!key+x}" ]]; then export "$key=$value"; fi
  done < "$ENV_FILE"
  SERVA_HTTP_PORT="${SERVA_HTTP_PORT:-80}"
  SERVA_HTTPS_PORT="${SERVA_HTTPS_PORT:-443}"
  BACKUP_DIR="${SERVA_BACKUP_DIR:-$DEPLOY_DIR/backups}"
  [[ "$BACKUP_DIR" == /* ]] || BACKUP_DIR="$ROOT_DIR/$BACKUP_DIR"
  export SERVA_HTTP_PORT SERVA_HTTPS_PORT BACKUP_DIR
}

is_private_ipv4() {
  [[ "$1" =~ ^(10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[01])\.|100\.(6[4-9]|[7-9][0-9]|1[01][0-9]|12[0-7])\.) ]]
}

# This computer's addresses on the shop network (IPv4). Docker's own bridges are left out.
# On WSL 2 the Windows addresses are asked from Windows, because devices connect to those.
lan_ips() {
  local found=() ip
  if command -v ip > /dev/null; then
    while read -r _ ifname _ cidr _; do
      case "$ifname" in docker* | br-* | veth* | virbr* | cni* | flannel* | lo) continue ;; esac
      found+=("${cidr%/*}")
    done < <(ip -4 -o addr show scope global 2> /dev/null)
  elif command -v hostname > /dev/null; then
    read -r -a found <<< "$(hostname -I 2> /dev/null || true)"
  fi
  if is_wsl && command -v powershell.exe > /dev/null; then
    while read -r ip; do
      ip="${ip%$'\r'}"
      [[ -n "$ip" ]] && found+=("$ip")
    done < <(powershell.exe -NoProfile -NonInteractive -Command \
      "Get-NetIPAddress -AddressFamily IPv4 | Where-Object { \$_.InterfaceAlias -notmatch 'Loopback|vEthernet|WSL' -and \$_.IPAddress -notlike '169.254.*' } | ForEach-Object { \$_.IPAddress }" 2> /dev/null || true)
  fi
  # Docker's own gateways are never a LAN address (`hostname -I` lists them too)
  local seen=" " net
  while read -r net; do
    for ip in $net; do seen+="$ip "; done
  done < <(docker network ls -q 2> /dev/null | xargs -r docker network inspect \
    --format '{{range .IPAM.Config}}{{.Gateway}} {{end}}' 2> /dev/null || true)
  for ip in "${found[@]}"; do
    if is_private_ipv4 "$ip" && [[ "$seen" != *" $ip "* ]]; then
      seen+="$ip "
      printf '%s\n' "$ip"
    fi
  done
}

export_lan_ips() {
  SERVA_LAN_IPS="$(lan_ips | paste -sd, -)"
  export SERVA_LAN_IPS
}

https_url() {
  local host="$1"
  if [[ "$SERVA_HTTPS_PORT" == "443" ]]; then echo "https://$host"; else echo "https://$host:$SERVA_HTTPS_PORT"; fi
}

# Copies the CA's public certificate out of the stack, for devices and for the smoke test
export_ca() {
  dc exec -T web cat /etc/nginx/certs/ca.crt > "$CA_EXPORT.partial" && mv "$CA_EXPORT.partial" "$CA_EXPORT"
}

# After `up`: nginx picks up a certificate the certs service renewed (new LAN address), and the CA
# is exported
after_up() {
  dc exec -T web nginx -s reload > /dev/null 2>&1 || warn "Could not reload the web server's certificate."
  export_ca
}

print_addresses() {
  local ip
  printf '\n%s\n' "${C_BOLD}Open Serva on this computer:${C_RESET}   $(https_url localhost)"
  if [[ -n "${SERVA_LAN_IPS:-}" ]]; then
    printf '%s\n' "${C_BOLD}On devices on the same Wi-Fi:${C_RESET}"
    IFS=, read -r -a ips <<< "$SERVA_LAN_IPS"
    for ip in "${ips[@]}"; do printf '    %s\n' "$(https_url "$ip")"; done
  else
    warn "No LAN address found. Is this computer connected to the shop network?"
  fi
  printf '%s\n' "First time on a device: open http://<address>/serva-local-ca.crt and install it (docs/local-server.md)."
  printf '%s\n\n' "افتح العنوان أعلاه من أي جهاز على نفس شبكة الواي فاي."
}

postgres_running() {
  [[ -n "$(dc ps --status running -q postgres 2> /dev/null)" ]]
}

# The postgres image of the stack (restore drills use the same version)
postgres_image() {
  sed -n 's/^ *image: *\(postgres:[^ ]*\).*/\1/p' "$COMPOSE_FILE_PATH" | head -n 1
}
