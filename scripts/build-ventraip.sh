#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
DEPLOY_ROOT="$ROOT_DIR/.deploy/sorcerystacks"
STAGING_DIR="$DEPLOY_ROOT/staging"
PRODUCTION_DIR="$DEPLOY_ROOT/production"
BUILD_TIME="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
BUILD_COMMIT="$(git rev-parse --short HEAD 2>/dev/null || printf 'unknown')"

cd "$ROOT_DIR"

pnpm build

rm -rf "$DEPLOY_ROOT"
mkdir -p "$STAGING_DIR" "$PRODUCTION_DIR"

copy_release() {
  local target_dir="$1"
  local htaccess_template="$2"
  local target="$3"

  cp -R "$ROOT_DIR/dist/." "$target_dir/"
  cp -R "$ROOT_DIR/server/php/api" "$target_dir/api"
  cp "$htaccess_template" "$target_dir/.htaccess"

  [[ -f "$target_dir/index.html" ]] || {
    printf 'Refusing incomplete artifact for %s: missing index.html\n' "$target" >&2
    exit 66
  }
  [[ -f "$target_dir/.htaccess" ]] || {
    printf 'Refusing incomplete artifact for %s: missing .htaccess\n' "$target" >&2
    exit 66
  }
  [[ -f "$target_dir/api/auth.php" ]] || {
    printf 'Refusing incomplete artifact for %s: missing api/auth.php\n' "$target" >&2
    exit 66
  }
  [[ -f "$target_dir/api/shared/json.php" ]] || {
    printf 'Refusing incomplete artifact for %s: missing api/shared/json.php\n' "$target" >&2
    exit 66
  }

  if find "$target_dir" \( -name '.env*' -o -name '*.duck' \) -print -quit | grep -q .; then
    printf 'Refusing artifact for %s: secret-like files were copied into deploy output\n' "$target" >&2
    exit 66
  fi

  cat > "$target_dir/.deploy-ready.json" <<EOF
{
  "target": "$target",
  "builtAt": "$BUILD_TIME",
  "commit": "$BUILD_COMMIT"
}
EOF
}

copy_release "$STAGING_DIR" "$ROOT_DIR/hosting/sorcerystacks.staging.htaccess" "staging"
copy_release "$PRODUCTION_DIR" "$ROOT_DIR/hosting/sorcerystacks.production.htaccess" "production"

find "$DEPLOY_ROOT" -name '.DS_Store' -type f -delete

cat > "$DEPLOY_ROOT/release.json" <<EOF
{
  "builtAt": "$BUILD_TIME",
  "commit": "$BUILD_COMMIT",
  "stagingArtifact": "staging",
  "productionArtifact": "production"
}
EOF

printf 'Ventra artifacts ready:\n'
printf '  %s\n' "$STAGING_DIR"
printf '  %s\n' "$PRODUCTION_DIR"
