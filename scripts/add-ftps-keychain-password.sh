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

printf 'Adding Keychain Internet Password for %s deploy:\n' "$target"
printf '  Server: %s\n' "$host"
printf '  Account: %s\n' "$username"
printf '  Protocol: ftp\n'
printf '  Port: %s\n' "$port"
printf '\n'

printf 'Password: '
IFS= read -r -s password
printf '\nConfirm password: '
IFS= read -r -s password_confirm
printf '\n'

if [[ -z "$password" ]]; then
  printf 'Password cannot be empty.\n' >&2
  exit 65
fi

if [[ "$password" != "$password_confirm" ]]; then
  printf 'Passwords did not match; nothing was saved.\n' >&2
  exit 65
fi

/usr/bin/security add-internet-password \
  -s "$host" \
  -a "$username" \
  -r ftp \
  -P "$port" \
  -w "$password" \
  -U >/dev/null

if /usr/bin/security find-internet-password -s "$host" -a "$username" -w >/dev/null 2>&1; then
  printf 'Keychain item saved for %s.\n' "$username"
else
  printf 'Keychain item could not be verified.\n' >&2
  exit 78
fi
