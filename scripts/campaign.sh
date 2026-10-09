#!/usr/bin/env bash
# Test campaign on Sepolia + devnet: the keeper plus the scenarios in
# client/src/scenarios/ (pause, transfers in flight, burn→unlock, forged mint,
# the Kelp drain, simulated attacks) on two dedicated guards, with the shadow
# guard as the untouched control. One process (one Ethereum nonce).
#
# Usage: scripts/campaign.sh [OUT=campaign-<UTC time>] [--once | --continuous]
#   --once        each scenario once, then a report and exit (default)
#   --continuous  loop the scenarios until stopped (Ctrl-C writes the report)
#
# Once, if missing: deploys the two test lockboxes (Sepolia) and mints
# (devnet) and creates every guard in client/keeper.campaign.json. Writes
# OUT/events.jsonl, OUT/flights.json, OUT/report.md and OUT/dashboard.html
# (the report every ~5 min and at the end). Reads .env and the deploy outputs.

set -euo pipefail

REPO=$(cd "$(dirname "$0")/.." && pwd)
OUT=$REPO/campaign-$(date -u +%Y%m%d-%H%M)
MODE=--once
for arg in "$@"; do
    case "$arg" in
        --once | --continuous) MODE=$arg ;;
        *) OUT=$arg ;;
    esac
done
mkdir -p "$OUT" && OUT=$(cd "$OUT" && pwd)
CONFIG=$REPO/client/keeper.campaign.json
export NODE_NO_WARNINGS=1
cd "$REPO"

for pair in NORI_ETH_TEST_A_LOCKBOX_ADDRESS:BACKSTOP_TEST_A_MINT NORI_ETH_TEST_B_LOCKBOX_ADDRESS:BACKSTOP_TEST_B_MINT; do
    lockbox=${pair%%:*} mint=${pair##*:}
    grep -qs "^$lockbox=" ethereum/.env.nori-eth-demo ||
        npm run -s deploy-demo -w ethereum -- 116723.52 --env-var "$lockbox"
    grep -qs "^$mint=" .env.nori-sol-demo || MINT_VAR=$mint scripts/deploy-devnet.sh
done
(cd client && node --experimental-wasm-modules build/bin/keeper.js create-guards "$CONFIG")

echo "Campaign: $MODE, config $CONFIG, output $OUT"
(cd client && exec node --experimental-wasm-modules build/bin/scenarios.js "$CONFIG" "$OUT" "$MODE") 2>&1 | tee "$OUT/campaign.log" &
RUNNER=$!
trap 'kill "$RUNNER" 2>/dev/null || true' INT TERM
wait "$RUNNER" 2>/dev/null || true
trap - INT TERM

echo "Writing $OUT/report.md"
(cd client && node --experimental-wasm-modules build/bin/campaignReport.js "$CONFIG" "$OUT") || echo "Report failed"
echo "Done: $OUT/report.md, $OUT/dashboard.html"
