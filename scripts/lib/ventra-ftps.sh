#!/usr/bin/env bash

set -euo pipefail

VENTRA_LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VENTRA_ROOT_DIR="$(cd "$VENTRA_LIB_DIR/../.." && pwd)"
if [[ -z "${VENTRA_CONFIG_FILE:-}" ]]; then
  if [[ -f "$VENTRA_ROOT_DIR/hosting/ventraip.deploy.local.json" ]]; then
    VENTRA_CONFIG_FILE="$VENTRA_ROOT_DIR/hosting/ventraip.deploy.local.json"
  else
    VENTRA_CONFIG_FILE="$VENTRA_ROOT_DIR/hosting/ventraip.deploy.json"
  fi
fi
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

ventra_validate_target() {
  local target="$1"
  local host="$2"
  local port="$3"
  local username="$4"
  local remote_dir="$5"
  local domain="$6"
  local protocol

  protocol="$(ventra_config_value "-" "protocol")"

  case "$target" in
    staging|production) ;;
    *)
      printf 'Invalid deploy target: %s\n' "$target" >&2
      exit 64
      ;;
  esac

  if [[ "$protocol" != "explicit-ftps" ]]; then
    printf 'Refusing deploy: protocol must be explicit-ftps, got %s\n' "$protocol" >&2
    exit 65
  fi

  if [[ "$host" != "s04dd.syd6.hostingplatform.net.au" || "$port" != "21" ]]; then
    printf 'Refusing deploy to unexpected host/port: %s:%s\n' "$host" "$port" >&2
    exit 65
  fi

  if [[ "$remote_dir" != "/" ]]; then
    printf 'Refusing deploy to unexpected remoteDir: %s\n' "$remote_dir" >&2
    printf 'This script expects cPanel FTPS accounts rooted to their target document roots.\n' >&2
    exit 65
  fi

  case "$target" in
    staging)
      [[ "$username" == "sorcerydeploy@sorcerystacks.com" ]] || {
        printf 'Refusing staging deploy with unexpected account: %s\n' "$username" >&2
        exit 65
      }
      [[ "$domain" == "https://staging.sorcerystacks.com" ]] || {
        printf 'Refusing staging deploy with unexpected domain: %s\n' "$domain" >&2
        exit 65
      }
      ;;
    production)
      [[ "$username" == "Manager@sorcerystacks.com" ]] || {
        printf 'Refusing production deploy with unexpected account: %s\n' "$username" >&2
        exit 65
      }
      [[ "$domain" == "https://sorcerystacks.com" ]] || {
        printf 'Refusing production deploy with unexpected domain: %s\n' "$domain" >&2
        exit 65
      }
      [[ "${VENTRA_PRODUCTION_CONFIRMED:-}" == "1" ]] || {
        printf 'Refusing production deploy without VENTRA_PRODUCTION_CONFIRMED=1.\n' >&2
        exit 64
      }
      ;;
  esac
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
  Transport: explicit FTPS / FTP over TLS
  Keychain protocol code: ftp with trailing space
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

  if [[ ! -f "$artifact_dir/.deploy-ready.json" ]]; then
    cat >&2 <<EOF
Artifact is not marked deploy-ready: $artifact_dir

Create a fresh artifact with:
  pnpm build:ventraip
EOF
    exit 66
  fi

  [[ -f "$artifact_dir/index.html" ]] || {
    printf 'Artifact looks incomplete: missing index.html in %s\n' "$artifact_dir" >&2
    exit 66
  }
  [[ -f "$artifact_dir/.htaccess" ]] || {
    printf 'Artifact looks incomplete: missing .htaccess in %s\n' "$artifact_dir" >&2
    exit 66
  }
  [[ -f "$artifact_dir/api/auth.php" ]] || {
    printf 'Artifact looks incomplete: missing api/auth.php in %s\n' "$artifact_dir" >&2
    exit 66
  }
  [[ -f "$artifact_dir/api/shared/json.php" ]] || {
    printf 'Artifact looks incomplete: missing api/shared/json.php in %s\n' "$artifact_dir" >&2
    exit 66
  }

  node - "$artifact_dir/.deploy-ready.json" "$target" <<'NODE'
const fs = require('node:fs');

const [markerPath, expectedTarget] = process.argv.slice(2);
const marker = JSON.parse(fs.readFileSync(markerPath, 'utf8'));
if (marker.target !== expectedTarget || !marker.builtAt || !marker.commit) {
  console.error(`Deploy marker is invalid for ${expectedTarget}: ${markerPath}`);
  process.exit(66);
}
NODE

  if find "$artifact_dir" \( -name '.env*' -o -name '*.duck' -o -name '.DS_Store' \) -print -quit | grep -q .; then
    printf 'Artifact contains ignored or secret-like files: %s\n' "$artifact_dir" >&2
    exit 66
  fi

  printf '%s' "$artifact_dir"
}

ventra_run_lftp_mirror() {
  local target="$1"
  local artifact_dir="$2"

  local host port username remote_dir domain password url
  host="$(ventra_config_value "$target" "host")"
  port="$(ventra_config_value "$target" "port")"
  username="$(ventra_config_value "$target" "username")"
  remote_dir="$(ventra_config_value "$target" "remoteDir")"
  domain="$(ventra_config_value "$target" "domain")"

  ventra_validate_target "$target" "$host" "$port" "$username" "$remote_dir" "$domain"

  ventra_require_lftp
  password="$(ventra_keychain_password "$host" "$username")"
  url="ftp://$host:$port"

  local status=0
  ventra_lftp_commands() {
    printf '%s\n' 'set cmd:fail-exit true'
    printf '%s\n' 'set cmd:trace false'
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
  }

  ventra_lftp_commands | lftp || status=$?
  return "$status"
}
