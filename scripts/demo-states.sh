#!/usr/bin/env bash
# Every steady state on the guard-status page, on purpose (Sepolia + devnet):
# demo-lockbox and shadow-lockbox stay HEALTHY, test-b TRIPPED, test-a PAUSED
# (at source), and a fifth guard STALE. WARN is transient by design and left
# out. The soak keeper on the VM (scripts/soak.sh, SOAK_CONFIG=
# keeper/keeper.soak-all.json) keeps running and does the rest: it snapshots
# a lockbox as soon as it changes and submits the read once Nori proves it.
#
# Usage: scripts/demo-states.sh trip | pause | restore | stale | status [CONFIG...]
#   trip     test-b's lockbox drops to 223.52 (the Kelp drain), below its
#            mint's 116,700 supply: TRIPPED once proven; it stays tripped
#   pause    test-a's lockbox pauses, locked kept at 116,723.52 (above the
#            supply plus the 1-token tolerance, so it can't trip): PAUSED
#            once proven
#   restore  the undo: both lockboxes back to 116,723.52, unpaused. test-a
#            reads HEALTHY once proven; test-b stays TRIPPED until, after
#            that read, `npm run keeper -w keeper -- unlatch <SOAK_CONFIG>`
#            (it clears every tripped guard in that config)
#   stale    a new mint (BACKSTOP_STALE_MINT in .env.nori-sol-demo) and its
#            guard (keeper/keeper.stale.json, over the demo lockbox), which
#            no keeper serves, so nothing is ever proven for it: STALE at
#            once. Safe to rerun. No undo: a guard can't be closed
#   status   `keeper status` on each CONFIG (default: SOAK_CONFIG if it
#            exists, then keeper/keeper.stale.json once the stale mint does)
#
# Runbook (each step ~1 min; the soak keeper keeps running throughout):
#   VM:      scripts/demo-states.sh trip && sleep 90 && scripts/demo-states.sh pause
#   laptop:  scripts/demo-states.sh stale          (needs solana, spl-token)
#   ~18 min later (15-22 in the soak): scripts/demo-states.sh status, on the
#   VM for the four soak guards, on the laptop for the stale one
# trip, pause and restore send with ETH_PRIVATE_KEY: run them on the VM only,
# beside the keeper that sends with it (two machines on one key race the
# nonce), and 90 s apart, so the keeper's snapshot of one change is mined
# before the next set. stale needs only the Solana payer.
#
# Reads .env and the deploy outputs like the keeper (the shell wins). Refuses
# Ethereum mainnet (demoSet) and any Solana cluster but devnet or a local
# validator (deploy-devnet.sh, then the keeper's genesis pin). Prints an
# explorer link for each transaction it sends, never an RPC URL.

set -euo pipefail

REPO=$(cd "$(dirname "$0")/.." && pwd)
FULL=116723.52 # each lockbox's deploy amount: its mint's 116,700 supply + 23.52
DRAIN=223.52   # the Kelp drain
SOAK_CONFIG=${SOAK_CONFIG:-$REPO/keeper/keeper.soak-all.json}
STALE_CONFIG=$REPO/keeper/keeper.stale.json
ETH_ENV=${NORI_ETH_ENV_DIR:-$REPO/ethereum}/.env.nori-eth-demo
SOL_ENV=${NORI_SOL_ENV_DIR:-$REPO}/.env.nori-sol-demo
DEVNET_GENESIS=EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG
export NODE_NO_WARNINGS=1

# file_value FILE NAME: the last value FILE sets for NAME, unquoted
file_value() {
    [ ! -f "$1" ] || sed -n "s/^$2=//p" "$1" | tail -1 | sed -e 's/^["'\'']//' -e 's/["'\'']$//'
}

# Exported so every tool sees the same values, and redact knows the URLs
for name in ETH_RPC_URL ETH_CHAIN_ID SOLANA_RPC_NETWORK_URL SOLANA_GENESIS_HASH; do
    value=${!name:-$(file_value "$REPO/.env" "$name")}
    [ -z "$value" ] || export "$name=$value"
done
BACKSTOP_STALE_MINT=${BACKSTOP_STALE_MINT:-$(file_value "$SOL_ENV" BACKSTOP_STALE_MINT)}
[ -z "$BACKSTOP_STALE_MINT" ] || export BACKSTOP_STALE_MINT

# Hides the RPC URLs, which may carry API keys, in what the tools print
redact() {
    perl -pe 'BEGIN { @urls = grep { length } @ENV{qw(ETH_RPC_URL SOLANA_RPC_NETWORK_URL)} }
        for my $url (@urls) { s/\Q$url\E/<rpc>/g }'
}

eth_link() {
    if [ "${ETH_CHAIN_ID:-}" = 11155111 ]; then echo "https://sepolia.etherscan.io/tx/$1"; else echo "tx $1"; fi
}

# sol_link tx|address ID
sol_link() {
    case "${SOLANA_RPC_NETWORK_URL:-}" in
        http://127.0.0.1:* | http://localhost:*) echo "$1 $2" ;;
        *) echo "https://explorer.solana.com/$1/$2?cluster=devnet" ;;
    esac
}

# The keeper CLI. Without the chain pins in .env: Sepolia and devnet (.env.example)
keeper() {
    [ -d "$REPO/keeper/build" ] || { echo "Run 'npm install && npm run build' first"; exit 1; }
    (cd "$REPO/keeper" && ETH_CHAIN_ID=${ETH_CHAIN_ID:-11155111} \
        SOLANA_GENESIS_HASH=${SOLANA_GENESIS_HASH:-$DEVNET_GENESIS} \
        exec node --experimental-wasm-modules build/bin/keeper.js "$@") 2>&1 | redact
}

# set_lockbox GUARD VAR LOCKED [--paused]: DemoLockbox.set on the lockbox in
# VAR, looked up where the keeper finds it
set_lockbox() {
    local guard=$1 var=$2 locked=$3 lockbox out hash
    shift 3
    lockbox=${!var:-$(file_value "$REPO/.env" "$var")}
    lockbox=${lockbox:-$(file_value "$ETH_ENV" "$var")}
    [ -n "$lockbox" ] || { echo "Set $var ($ETH_ENV): $guard's lockbox"; exit 1; }
    echo "$guard: lockbox $lockbox -> locked $locked${1:+, paused}"
    # demoSet sets the lockbox in NORI_ETH_DEMO_LOCKBOX_ADDRESS
    if ! out=$(cd "$REPO" && NORI_ETH_DEMO_LOCKBOX_ADDRESS=$lockbox \
        npm run -s demo-set -w ethereum -- "$locked" "$@" 2>&1 | redact); then
        echo "$out"
        exit 1
    fi
    hash=$(sed -n 's/.*, tx \(0x[0-9a-fA-F]\{64\}\)).*/\1/p' <<<"$out")
    echo "$guard: $(sed -n 's/.*\(DemoLockbox: .*)\).*/\1/p' <<<"$out")"
    echo "  $(eth_link "$hash")"
}

# status CONFIG...: each config's guards
status() {
    local config
    for config in "$@"; do
        if [ -f "$config" ]; then keeper status "$config"; else echo "No $config"; fi
    done
}

stale() {
    local tool out guard
    for tool in solana spl-token; do
        command -v "$tool" >/dev/null || { echo "Missing: $tool (run stale where the Solana CLI is)"; exit 1; }
    done
    SKIP_PROGRAMS=1 MINT_VAR=BACKSTOP_STALE_MINT "$REPO/scripts/deploy-devnet.sh" 2>&1 | redact
    BACKSTOP_STALE_MINT=$(file_value "$SOL_ENV" BACKSTOP_STALE_MINT)
    [ -n "$BACKSTOP_STALE_MINT" ] || { echo "No BACKSTOP_STALE_MINT in $SOL_ENV"; exit 1; }
    export BACKSTOP_STALE_MINT
    if ! out=$(keeper create-guards "$STALE_CONFIG"); then echo "$out"; exit 1; fi
    echo "$out"
    guard=$(sed -n -E 's/.* stale: (created guard|guard) ([1-9A-HJ-NP-Za-km-z]{32,44}).*/\2/p' <<<"$out")
    [ -n "$guard" ] || exit 1
    echo "Stale mint:  $(sol_link address "$BACKSTOP_STALE_MINT")"
    echo "Stale guard: $(sol_link address "$guard")"
    echo "Its transactions (create_guard, mint, account, create-token; newest first):"
    solana transaction-history "$BACKSTOP_STALE_MINT" -u "$SOLANA_RPC_NETWORK_URL" 2>&1 | redact |
        { grep -E '^[1-9A-HJ-NP-Za-km-z]{64,88}$' || true; } |
        while read -r sig; do echo "  $(sol_link tx "$sig")"; done
    # Reads are finalized: a new guard shows ~15 s after it lands
    for _ in $(seq 1 12); do
        out=$(keeper status "$STALE_CONFIG") || break
        grep -q 'no guard at' <<<"$out" || break
        sleep 5
    done
    echo "$out"
    echo "Name it on the guard-status page: $BACKSTOP_STALE_MINT goes into MINT_NAMES and"
    echo "LOCKBOXES in web/apps/guard-status/src/app-root/utils/guards.ts, then redeploy the page."
}

case "${1:-}" in
    trip) set_lockbox test-b NORI_ETH_TEST_B_LOCKBOX_ADDRESS "$DRAIN" ;;
    pause) set_lockbox test-a NORI_ETH_TEST_A_LOCKBOX_ADDRESS "$FULL" --paused ;;
    restore)
        set_lockbox test-a NORI_ETH_TEST_A_LOCKBOX_ADDRESS "$FULL"
        echo "Waiting 90 s: the keeper snapshots that change with the same key"
        sleep 90
        set_lockbox test-b NORI_ETH_TEST_B_LOCKBOX_ADDRESS "$FULL"
        echo "test-b stays TRIPPED: once its read is in (~18 min), npm run keeper -w keeper -- unlatch $SOAK_CONFIG"
        ;;
    stale) stale ;;
    status)
        shift
        if [ $# -eq 0 ]; then
            if [ -f "$SOAK_CONFIG" ]; then set -- "$SOAK_CONFIG"; fi
            if [ -n "$BACKSTOP_STALE_MINT" ]; then set -- "$@" "$STALE_CONFIG"; fi
            [ $# -gt 0 ] || { echo "No $SOAK_CONFIG and no BACKSTOP_STALE_MINT: pass a config"; exit 1; }
        fi
        status "$@"
        ;;
    *)
        echo "Usage: $0 trip | pause | restore | stale | status [CONFIG...] (see the header)"
        exit 1
        ;;
esac
