#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
DEPLOY_ROOT="$ROOT_DIR/.deploy/sorcerystacks"
STAGING_DIR="$DEPLOY_ROOT/staging"
PRODUCTION_DIR="$DEPLOY_ROOT/production"

cd "$ROOT_DIR"

pnpm build

rm -rf "$DEPLOY_ROOT"
mkdir -p "$STAGING_DIR" "$PRODUCTION_DIR"

copy_release() {
  local target_dir="$1"
  local htaccess_template="$2"

  cp -R "$ROOT_DIR/dist/." "$target_dir/"
  cp -R "$ROOT_DIR/server/php/api" "$target_dir/api"
  cp "$htaccess_template" "$target_dir/.htaccess"
}

copy_release "$STAGING_DIR" "$ROOT_DIR/hosting/sorcerystacks.staging.htaccess"
copy_release "$PRODUCTION_DIR" "$ROOT_DIR/hosting/sorcerystacks.production.htaccess"

find "$DEPLOY_ROOT" -name '.DS_Store' -type f -delete

cat > "$DEPLOY_ROOT/release.json" <<EOF
{
  "builtAt": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")",
  "commit": "$(git rev-parse --short HEAD 2>/dev/null || printf 'unknown')",
  "stagingArtifact": "staging",
  "productionArtifact": "production"
}
EOF

printf 'Ventra artifacts ready:\n'
printf '  %s\n' "$STAGING_DIR"
printf '  %s\n' "$PRODUCTION_DIR"
