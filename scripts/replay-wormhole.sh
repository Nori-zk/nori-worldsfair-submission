#!/usr/bin/env bash
# Wormhole 2022, replayed on Sepolia + devnet with real Nori proofs: 93,769.40
# locked on Ethereum and minted on Solana (HEALTHY), then 26,230.60 forged on
# Solana (WARN at once; assert_healthy fails), then TRIPPED once a snapshot
# taken a full window after the forgery is proven. About 50 min.
#
# Usage: scripts/replay-wormhole.sh
# Its own lockbox, mint and guard (keeper/keeper.wormhole.json), added to the
# deploy outputs once, like the soak's shadow guard. Reads .env like the keeper.
# Rerun to continue: the setup and the forgery happen once.

set -euo pipefail

REPO=$(cd "$(dirname "$0")/.." && pwd)
cd "$REPO"
export NODE_NO_WARNINGS=1
LOG=$REPO/replay-wormhole.log

# The shell wins; otherwise the last line in .env or the Solana deploy output that sets it
env_of() { [ -n "${!1:-}" ] && echo "${!1}" || { grep -hE "^$1=" .env .env.nori-sol-demo 2>/dev/null || true; } | tail -1 | cut -d= -f2- | tr -d "\"'"; }
keeper() { (cd keeper && node --experimental-wasm-modules build/bin/keeper.js "$@" keeper.wormhole.json); }
status() { keeper status | grep -o 'wormhole: [A-Z_]*' | cut -d' ' -f2; }
# Waits up to an hour (a proof takes ~18 min) for one of the statuses: the
# one expected next, or a later one when a rerun is past it
wait_for() {
    local now
    for _ in $(seq 120); do
        now=$(status)
        if [[ " $* " == *" $now "* ]]; then echo "$(date -u +%H:%M:%S) UTC: $now"; return; fi
        sleep 30
    done
    echo "No $1 after 60 min; see $LOG"
    exit 1
}

grep -qs '^NORI_ETH_WORMHOLE_LOCKBOX_ADDRESS=' ethereum/.env.nori-eth-demo ||
    npm run -s deploy-demo -w ethereum -- 93769.40 --env-var NORI_ETH_WORMHOLE_LOCKBOX_ADDRESS
grep -qs '^BACKSTOP_WORMHOLE_MINT=' .env.nori-sol-demo ||
    SUPPLY=93769.40 MINT_VAR=BACKSTOP_WORMHOLE_MINT SKIP_PROGRAMS=1 scripts/deploy-devnet.sh
keeper create-guards

# The keeper checkpoints, snapshots and submits for the whole replay
(cd keeper && exec node --experimental-wasm-modules build/bin/keeper.js run keeper.wormhole.json) >>"$LOG" 2>&1 &
KEEPER=$!
trap 'kill "$KEEPER" 2>/dev/null || true' EXIT

echo "Waiting for the first proven read (~20 min); keeper log: $LOG"
wait_for HEALTHY WARN TRIPPED
keeper assert

URL=$(env_of SOLANA_RPC_NETWORK_URL)
PAYER=$(env_of SOLANA_PAYER_KEYPAIR_PATH)
PAYER=${PAYER/#\~/$HOME}
MINT=$(env_of BACKSTOP_WORMHOLE_MINT)
if [ "$(spl-token supply "$MINT" -u "$URL")" = 93769.4 ]; then
    echo "$(date -u +%H:%M:%S) UTC: forging 26,230.60 on Solana"
    spl-token mint "$MINT" 26230.60 --recipient-owner "$(solana address -k "$PAYER")" \
        --mint-authority "$PAYER" --fee-payer "$PAYER" -u "$URL" >/dev/null
fi
wait_for WARN TRIPPED
keeper assert

# The trip takes the lowest supply in the read's window, so snapshot once a
# whole window holds only the forged supply
WINDOW=$(node -p 'require("./keeper/keeper.wormhole.json").guards[0].windowSecs')
if [ "$(status)" != TRIPPED ]; then
    echo "Snapshot in $((WINDOW / 60 + 1)) min, then its proof (~20 min)"
    sleep $((WINDOW + 60))
    keeper snapshot
fi
wait_for TRIPPED
keeper assert
grep -E 'wormhole: [A-Z_]+ \|' "$LOG"
