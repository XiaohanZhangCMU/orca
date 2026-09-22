#!/usr/bin/env bash
set -euo pipefail

if [[ "$(uname -s)" != Linux ]]; then
  printf '%s\n' 'Run this script inside the Linux pod, not on the laptop.' >&2
  exit 1
fi
ORCA_SETUP_NODE="${ORCA_SETUP_NODE:-node}"
if [[ "$("$ORCA_SETUP_NODE" -p 'process.versions.node.split(".")[0]')" != 24 ]]; then
  printf '%s\n' 'Node 24 is required; set ORCA_SETUP_NODE to its absolute binary path.' >&2
  exit 1
fi
ORCA_SETUP_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
"$ORCA_SETUP_NODE" "$ORCA_SETUP_ROOT/extensions/pod-setup/build.mjs"
exec "$ORCA_SETUP_NODE" "$ORCA_SETUP_ROOT/out/pod-setup/pod-setup.cjs" install "$@"
