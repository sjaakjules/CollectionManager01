#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/lib/ventra-ftps.sh
source "$SCRIPT_DIR/lib/ventra-ftps.sh"

artifact_dir="$(ventra_require_artifact staging)"
node "$SCRIPT_DIR/lib/staging-source.mjs" verify "$VENTRA_ROOT_DIR" "$artifact_dir"
domain="$(ventra_config_value staging domain)"

printf 'Deploying staging artifact to %s\n' "$domain"
ventra_run_lftp_mirror staging "$artifact_dir"
printf 'Staging deploy complete: %s\n' "$domain"
