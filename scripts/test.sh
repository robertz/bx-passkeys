#!/usr/bin/env bash
# Runs the specs in the test home that setup-tests.bxs makes; non-zero on any failure.
set -euo pipefail
cd "$(dirname "$0")/.."
if [[ ! -e .tmp/bxhome/modules/bx-passkeys ]]; then
  boxlang setup-tests.bxs
fi
exec boxlang --bx-home .tmp/bxhome run-tests.bxs
