#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/lib/ventra-ftps.sh
source "$SCRIPT_DIR/lib/ventra-ftps.sh"

target="${1:-}"
if [[ "$target" != "staging" && "$target" != "production" ]]; then
  cat >&2 <<'EOF'
Usage:
  bash scripts/add-ftps-keychain-password.sh staging
  bash scripts/add-ftps-keychain-password.sh production

This stores an Internet Password item in macOS Keychain without putting the
password in shell history.
EOF
  exit 64
fi

host="$(ventra_config_value "$target" host)"
port="$(ventra_config_value "$target" port)"
username="$(ventra_config_value "$target" username)"
keychain_protocol_code="ftp "

printf 'Adding Keychain Internet Password for %s deploy:\n' "$target"
printf '  Server: %s\n' "$host"
printf '  Account: %s\n' "$username"
printf '  Transport: explicit FTPS / FTP over TLS\n'
printf '  Keychain protocol code: ftp with trailing space\n'
printf '  Port: %s\n' "$port"
printf '\n'
printf 'macOS security will prompt for the password next.\n'

/usr/bin/security add-internet-password \
  -s "$host" \
  -a "$username" \
  -r "$keychain_protocol_code" \
  -P "$port" \
  -U \
  -w >/dev/null

if /usr/bin/security find-internet-password -s "$host" -a "$username" >/dev/null 2>&1; then
  printf 'Keychain item saved for %s.\n' "$username"
else
  printf 'Keychain item could not be verified.\n' >&2
  exit 78
fi
