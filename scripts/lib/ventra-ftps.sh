#!/usr/bin/env bash

set -euo pipefail

VENTRA_LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VENTRA_ROOT_DIR="$(cd "$VENTRA_LIB_DIR/../.." && pwd)"
VENTRA_CONFIG_FILE="$VENTRA_ROOT_DIR/hosting/ventraip.deploy.json"
VENTRA_DEPLOY_ROOT="$VENTRA_ROOT_DIR/.deploy/sorcerystacks"

ventra_config_value() {
  local target="$1"
  local path="$2"

  node - "$VENTRA_CONFIG_FILE" "$target" "$path" <<'NODE'
const fs = require('node:fs');

const [configPath, targetName, path] = process.argv.slice(2);
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
const root = targetName === '-' ? config : config.targets[targetName];

if (!root) {
  console.error(`Unknown deploy target: ${targetName}`);
  process.exit(64);
}

let value = root;
for (const key of path.split('.').filter(Boolean)) {
  value = value?.[key];
}

if (value === undefined || value === null) {
  process.exit(1);
}

if (Array.isArray(value)) {
  for (const item of value) console.log(item);
} else if (typeof value === 'object') {
  console.log(JSON.stringify(value));
} else {
  console.log(String(value));
}
NODE
}

ventra_all_excludes() {
  local target="$1"

  node - "$VENTRA_CONFIG_FILE" "$target" <<'NODE'
const fs = require('node:fs');

const [configPath, targetName] = process.argv.slice(2);
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
const common = config.excludes?.common ?? [];
const target = config.excludes?.[targetName] ?? [];

for (const pattern of [...common, ...target]) {
  console.log(pattern);
}
NODE
}

ventra_require_lftp() {
  if ! command -v lftp >/dev/null 2>&1; then
    cat >&2 <<'EOF'
Missing required deploy tool: lftp

Install it with:
  brew install lftp

The Ventra deploy scripts use lftp for explicit FTP over TLS (FTPS), not plain FTP and not SFTP.
EOF
    exit 127
  fi
}

ventra_keychain_password() {
  local host="$1"
  local username="$2"
  local password

  if ! password="$(/usr/bin/security find-internet-password -s "$host" -a "$username" -w 2>/dev/null)" || [[ -z "$password" ]]; then
    cat >&2 <<EOF
Missing Keychain internet password.

Add an Internet Password item in macOS Keychain Access with:
  Server: $host
  Account: $username
  Protocol: ftp
  Port: 21

Do not store this password in an .env file, shell script, .duck profile, or git.
EOF
    exit 78
  fi

  printf '%s' "$password"
}

ventra_lftp_quote() {
  local value="$1"
  value="${value//\'/\'\\\'\'}"
  printf "'%s'" "$value"
}

ventra_require_artifact() {
  local target="$1"
  local artifact_dir="$VENTRA_DEPLOY_ROOT/$target"

  if [[ ! -d "$artifact_dir" ]]; then
    cat >&2 <<EOF
Missing deploy artifact: $artifact_dir

Create it first with:
  pnpm build:ventraip
EOF
    exit 66
  fi

  printf '%s' "$artifact_dir"
}

ventra_run_lftp_mirror() {
  local target="$1"
  local artifact_dir="$2"

  local host port username remote_dir password url command_file
  host="$(ventra_config_value "$target" "host")"
  port="$(ventra_config_value "$target" "port")"
  username="$(ventra_config_value "$target" "username")"
  remote_dir="$(ventra_config_value "$target" "remoteDir")"

  ventra_require_lftp
  password="$(ventra_keychain_password "$host" "$username")"
  url="ftp://$host:$port"
  command_file="$(mktemp "${TMPDIR:-/tmp}/sorcery-lftp.XXXXXX")"
  chmod 600 "$command_file"

  {
    printf '%s\n' 'set cmd:fail-exit true'
    printf '%s\n' 'set ftp:passive-mode true'
    printf '%s\n' 'set ftp:ssl-auth TLS'
    printf '%s\n' 'set ftp:ssl-force true'
    printf '%s\n' 'set ftp:ssl-protect-data true'
    printf '%s\n' 'set net:max-retries 2'
    printf '%s\n' 'set net:timeout 30'
    printf '%s\n' 'set ssl:verify-certificate true'
    printf 'open -u %s,%s %s\n' \
      "$(ventra_lftp_quote "$username")" \
      "$(ventra_lftp_quote "$password")" \
      "$(ventra_lftp_quote "$url")"
    printf 'mirror --reverse --delete --verbose --parallel=4'
    while IFS= read -r pattern; do
      [[ -z "$pattern" ]] && continue
      printf ' --exclude-glob %s' "$(ventra_lftp_quote "$pattern")"
    done < <(ventra_all_excludes "$target")
    printf ' %s %s\n' "$(ventra_lftp_quote "$artifact_dir")" "$(ventra_lftp_quote "$remote_dir")"
    printf '%s\n' 'bye'
  } > "$command_file"

  local status=0
  lftp -f "$command_file" || status=$?
  rm -f "$command_file"
  return "$status"
}
