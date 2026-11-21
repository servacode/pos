#!/usr/bin/env bash
# Alerts for the local server (sourced by backup.sh, schedule.sh, cleanup.sh, health-watch.sh;
# or run: pnpm local:alert test | pnpm local:alert send "text").
#
# One webhook, any provider. Off unless SERVA_ALERT_WEBHOOK_URL is set in deploy/local/.env:
#   SERVA_ALERT_WEBHOOK_URL    where to POST. Examples:
#                                Slack     https://hooks.slack.com/services/…
#                                Discord   https://discord.com/api/webhooks/…
#                                Telegram  https://api.telegram.org/bot<token>/sendMessage?chat_id=<id>
#                                          (with SERVA_ALERT_FORMAT=form)
#                                WhatsApp  the gateway of tools/whatsapp-otp-bot, or any service that takes
#                                          JSON, with SERVA_ALERT_BODY and SERVA_ALERT_AUTH_HEADER
#   SERVA_ALERT_FORMAT         json (default): the body SERVA_ALERT_BODY, with {message} filled in
#                              form: a form field text=<message> (Telegram)
#   SERVA_ALERT_BODY           json template; default {"text":"{message}","content":"{message}"}
#                              (Slack reads text, Discord reads content)
#   SERVA_ALERT_AUTH_HEADER    one header line, e.g. "Authorization: Bearer …" (a secret)
#   SERVA_ALERT_NAME           how this server is called in the text (default: the computer's name)
#   SERVA_ALERT_REPEAT_HOURS   the same standing problem is repeated at most this often (default 12)
#
# The URL and the header are secrets (a Telegram URL holds the bot token): they go to curl through
# its config on stdin, never on the command line, and are never printed. The text of an alert says
# what failed, never a secret. http:// is accepted only for this computer or the shop network.

# shellcheck source=scripts/local/lib.sh
[[ "$(type -t die)" == function ]] || source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

alerts_enabled() { [[ -n "${SERVA_ALERT_WEBHOOK_URL:-}" ]]; }

# JSON string content (without the quotes) of $1
alert_json_escape() {
  local s="$1"
  s="${s//\\/\\\\}"
  s="${s//\"/\\\"}"
  s="${s//$'\n'/\\n}"
  s="${s//$'\r'/}"
  s="${s//$'\t'/ }"
  printf '%s' "$s"
}

# curl config values are double-quoted; backslash and quote must be escaped, newlines refused
alert_curl_quote() {
  local s="$1"
  [[ "$s" != *$'\n'* && "$s" != *$'\r'* ]] || return 1
  s="${s//\\/\\\\}"
  s="${s//\"/\\\"}"
  printf '"%s"' "$s"
}

# Plain http only for places that are not on the internet
transport_ok() {
  local url="$1" host
  [[ "$url" == https://* ]] && return 0
  [[ "$url" == http://* ]] || return 1
  host="${url#http://}"
  host="${host%%[/?#]*}"
  host="${host##*@}"
  host="${host%%:*}"
  [[ "$host" == localhost || "$host" == 127.* || "$host" != *.* || "$host" == *.local || "$host" == *.lan ||
    "$host" == *.internal || "$host" == *.home.arpa ]] && return 0
  is_private_ipv4 "$host"
}

# send_alert <text>: delivers one alert. Does nothing (returns 0) when alerts are off; returns 1,
# with a warning that never shows the URL, when the provider did not accept it.
send_alert() {
  alerts_enabled || return 0
  local url="$SERVA_ALERT_WEBHOOK_URL" name text body_file rc=0 template escaped
  transport_ok "$url" || {
    warn "ALERT NOT SENT: SERVA_ALERT_WEBHOOK_URL must be https:// (http:// only for this computer or the shop network)."
    return 1
  }
  name="${SERVA_ALERT_NAME:-$(hostname 2> /dev/null || echo serva)}"
  text="[Serva $name] $1"
  body_file="$(umask 077 && mktemp)"
  local config
  config="url = $(alert_curl_quote "$url")"$'\n'
  if [[ -n "${SERVA_ALERT_AUTH_HEADER:-}" ]]; then
    config+="header = $(alert_curl_quote "$SERVA_ALERT_AUTH_HEADER")"$'\n'
  fi
  case "${SERVA_ALERT_FORMAT:-json}" in
    form)
      printf '%s' "$text" > "$body_file"
      config+='data-urlencode = "text@'"$body_file"'"'$'\n'
      ;;
    json)
      template="${SERVA_ALERT_BODY:-}"
      [[ -n "$template" ]] || template='{"text":"{message}","content":"{message}"}'
      escaped="$(alert_json_escape "$text")"
      # The replacement is quoted: bash 5.2 would otherwise read an & in it as "the match"
      printf '%s' "${template//'{message}'/"$escaped"}" > "$body_file"
      config+='header = "Content-Type: application/json"'$'\n'
      config+='data-binary = "@'"$body_file"'"'$'\n'
      ;;
    *)
      rm -f "$body_file"
      warn "ALERT NOT SENT: SERVA_ALERT_FORMAT must be json or form."
      return 1
      ;;
  esac
  printf '%s' "$config" | curl --silent --show-error --fail --max-time 15 --retry 2 --retry-delay 2 \
    --output /dev/null --config - 2> /dev/null || rc=$?
  rm -f "$body_file"
  if ((rc != 0)); then
    warn "ALERT NOT SENT: the webhook did not accept it (curl exit $rc). Check SERVA_ALERT_WEBHOOK_URL with: pnpm local:alert test"
    return 1
  fi
  return 0
}

# send_alert_once <key> <text>: like send_alert, but a problem that stays is repeated only every
# SERVA_ALERT_REPEAT_HOURS. clear_alert <key> forgets it, so the next failure alerts at once.
alert_state_file() { printf '%s/alert-state/%s' "$BACKUP_DIR" "$1"; }

send_alert_once() {
  alerts_enabled || return 0
  local key="$1" file hours
  file="$(alert_state_file "$key")"
  hours="${SERVA_ALERT_REPEAT_HOURS:-12}"
  [[ "$hours" =~ ^[0-9]+$ ]] || hours=12
  if [[ -f "$file" ]] && (($(date +%s) - $(stat -c %Y "$file") < hours * 3600)); then return 0; fi
  if send_alert "$2"; then
    mkdir -p "$(dirname "$file")"
    : > "$file"
  else
    return 1
  fi
}

clear_alert() { rm -f "$(alert_state_file "$1")"; }

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  set -euo pipefail
  load_env
  case "${1:-}" in
    test)
      alerts_enabled || die "SERVA_ALERT_WEBHOOK_URL is not set in $ENV_FILE."
      send_alert "Test alert: if you read this, backup and health alerts reach you." || exit 1
      ok "The test alert was accepted by the webhook."
      ;;
    send)
      alerts_enabled || die "SERVA_ALERT_WEBHOOK_URL is not set in $ENV_FILE."
      send_alert "${2:?Usage: pnpm local:alert send \"text\"}" || exit 1
      ok "Sent."
      ;;
    *) die "Usage: pnpm local:alert test | send \"text\"" ;;
  esac
fi
