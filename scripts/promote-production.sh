#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/lib/ventra-ftps.sh
source "$SCRIPT_DIR/lib/ventra-ftps.sh"

artifact_dir="$(ventra_require_artifact production)"
domain="$(ventra_config_value production domain)"
confirmation="$(ventra_config_value production confirmation)"

printf 'Production promotion target: %s\n' "$domain"
printf 'This uploads the existing Ventra production artifact and never rebuilds it.\n'
printf 'Type %s to continue: ' "$confirmation"
IFS= read -r typed

if [[ "$typed" != "$confirmation" ]]; then
  printf 'Production promotion cancelled. Confirmation did not match.\n' >&2
  exit 64
fi

printf 'Promoting production artifact to %s\n' "$domain"
ventra_run_lftp_mirror production "$artifact_dir"
printf 'Production deploy complete: %s\n' "$domain"
