#!/usr/bin/env bash
# The page must price exactly the way the quoter does, or the compression it
# shows is a number the vault never posted. Fails if the two drift.
set -e
cd "$(dirname "$0")/.."
if diff <(tail -n +9 web/lib/pricing.ts) bot/src/pricing.ts > /dev/null; then
  echo "pricing mirror ok"
else
  echo "ERROR: web/lib/pricing.ts has drifted from bot/src/pricing.ts" >&2
  diff <(tail -n +9 web/lib/pricing.ts) bot/src/pricing.ts >&2 || true
  exit 1
fi
