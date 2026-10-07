#!/usr/bin/env bash
# Overnight soak: runs the keeper on client/keeper.soak.json (the demo guard
# plus a shadow guard over a lockbox nobody touches) for MINUTES, logging to
# OUT/keeper.log, then writes OUT/report.md. Stopping it early (Ctrl-C, kill)
# still writes the report.
#
# Usage: scripts/soak.sh [MINUTES=600] [OUT=soak-<UTC time>]
#   SOAK_CONFIG=path   another keeper config; skips the shadow setup
#
# Once, if missing: deploys the shadow lockbox (Sepolia) and mint (devnet),
# then creates the guards. Reads .env and the deploy outputs like the keeper.

set -euo pipefail

REPO=$(cd "$(dirname "$0")/.." && pwd)
MINUTES=${1:-600}
OUT=${2:-$REPO/soak-$(date -u +%Y%m%d-%H%M)}
mkdir -p "$OUT" && OUT=$(cd "$OUT" && pwd)
CONFIG=${SOAK_CONFIG:-$REPO/client/keeper.soak.json}
export NODE_NO_WARNINGS=1
cd "$REPO"

if [ -z "${SOAK_CONFIG:-}" ]; then
    grep -qs '^NORI_ETH_SHADOW_LOCKBOX_ADDRESS=' ethereum/.env.nori-eth-demo ||
        npm run -s deploy-demo -w ethereum -- 116723.52 --env-var NORI_ETH_SHADOW_LOCKBOX_ADDRESS
    grep -qs '^BACKSTOP_SHADOW_MINT=' .env.nori-sol-demo ||
        MINT_VAR=BACKSTOP_SHADOW_MINT scripts/deploy-devnet.sh
    (cd client && node --experimental-wasm-modules build/bin/keeper.js create-guards "$CONFIG")
fi

echo "Soak: $MINUTES min, config $CONFIG, output $OUT"
# perl's alarm ends the keeper after MINUTES (portable; no coreutils timeout on macOS)
(cd client && exec perl -e 'alarm shift; exec @ARGV' $((MINUTES * 60)) \
    node --experimental-wasm-modules build/bin/keeper.js run "$CONFIG") >"$OUT/keeper.log" 2>&1 &
KEEPER=$!
trap 'kill "$KEEPER" 2>/dev/null || true' INT TERM
wait "$KEEPER" 2>/dev/null || true
wait "$KEEPER" 2>/dev/null || true
trap - INT TERM

echo "Writing $OUT/report.md"
(cd client && node --experimental-wasm-modules build/bin/soakReport.js "$CONFIG" "$OUT/keeper.log") \
    >"$OUT/report.md" 2>"$OUT/report.err" || echo "Report failed: see $OUT/report.err"
echo "Done: $OUT/report.md"
