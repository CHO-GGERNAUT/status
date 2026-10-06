#!/bin/sh
# Sourced by the reporters. No credentials or server response bodies go to logs.
status_fail() {
  printf '%s\n' "$1" >&2
  exit 1
}

status_slug() {
  case "$1" in ''|*[!a-z0-9-]*|-*) return 1 ;; esac
  [ "${#1}" -le 63 ]
}

status_validate() {
  : "${STATUS_REPORTER_URL:?STATUS_REPORTER_URL is required}"
  : "${STATUS_REPORTER_TOKEN:?STATUS_REPORTER_TOKEN is required}"
  case "$STATUS_REPORTER_URL" in
    https://*) ;;
    *) status_fail 'Reporter URL must use HTTPS' ;;
  esac
  # Token format from scripts/create-reporter-token.mjs. Reject header injection.
  reporter_id=${STATUS_REPORTER_TOKEN%%.*}
  reporter_secret=${STATUS_REPORTER_TOKEN#*.}
  status_slug "$reporter_id" || status_fail 'Invalid reporter token format'
  [ "$reporter_secret" != "$STATUS_REPORTER_TOKEN" ] || status_fail 'Invalid reporter token format'
  case "$reporter_secret" in ''|*[!a-zA-Z0-9_-]*) status_fail 'Invalid reporter token format' ;; esac
  [ "${#reporter_secret}" -eq 43 ] || status_fail 'Invalid reporter token length'
}

status_send() {
  # curl >= 7.55.0: read Authorization from stdin, not process arguments.
  # Disable .curlrc, redirects and retries. A lost response may already have
  # committed this sequence; the next timer sends a new heartbeat instead.
  if ! code=$(printf 'Authorization: Bearer %s\n' "$STATUS_REPORTER_TOKEN" |
    curl --disable --silent --show-error --proto '=https' \
      --connect-timeout 5 --max-time 10 \
      --header @- --header 'Content-Type: application/json' \
      --data "$1" --output /dev/null --write-out '%{http_code}' \
      --url "$STATUS_REPORTER_URL" 2>/dev/null); then
    status_fail 'Heartbeat transport failed (DNS, TLS, connection or timeout); next timer will retry'
  fi
  [ "$code" = 202 ] || status_fail "Heartbeat rejected (HTTP $code); check token, component permissions and clock"
  printf '%s\n' 'Heartbeat accepted (HTTP 202)'
}
