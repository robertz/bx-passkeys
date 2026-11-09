#!/usr/bin/env bash
# Runs the specs in both test homes setup-tests.bxs makes (plain, and with
# bx-compat-cfml); non-zero on any failure.
set -euo pipefail
cd "$(dirname "$0")/.."
if [[ ! -e .tmp/bxhome-compat/modules/bx-compat-cfml ]]; then
  boxlang setup-tests.bxs
fi
for home in bxhome bxhome-compat; do
  echo "== specs in .tmp/$home"
  boxlang --bx-home ".tmp/$home" run-tests.bxs
done
