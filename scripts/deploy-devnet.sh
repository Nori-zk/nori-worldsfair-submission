#!/usr/bin/env bash
# Solana side of the demo: deploys Backstop and nori-read-example (or upgrades
# each, when its build differs) and, once, creates a demo mint holding 116,700
# tokens (9 decimals). Writes the mint to .env.nori-sol-demo, which the keeper
# reads.
#
# Usage: scripts/deploy-devnet.sh
#        MINT_VAR=BACKSTOP_SHADOW_MINT scripts/deploy-devnet.sh   # a second mint
#        (MINT_VAR names the variable; default BACKSTOP_DEMO_MINT)
# Reads SOLANA_RPC_NETWORK_URL and SOLANA_PAYER_KEYPAIR_PATH from the shell or
# .env. The payer becomes the programs' upgrade authority and the mint authority.
# Refuses any cluster but devnet or a local validator. NORI_SOL_ENV_DIR
# redirects the output file.

set -euo pipefail

REPO=$(cd "$(dirname "$0")/.." && pwd)
SUPPLY=116700
MINT_VAR=${MINT_VAR:-BACKSTOP_DEMO_MINT}
[[ "$MINT_VAR" =~ ^[A-Z_][A-Z0-9_]*$ ]] || { echo "Invalid MINT_VAR: $MINT_VAR"; exit 1; }
export CFLAGS=${CFLAGS:-"-isystem $HOME/.cache/solana/v1.54/platform-tools/llvm/sbpf/include"}

# The shell wins; otherwise the last line in .env that sets it
from_env_file() {
    [ -f "$REPO/.env" ] || return 0
    grep -E "^$1=" "$REPO/.env" | tail -1 | cut -d= -f2- | sed -e 's/^["'\'']//' -e 's/["'\'']$//'
}
URL=${SOLANA_RPC_NETWORK_URL:-$(from_env_file SOLANA_RPC_NETWORK_URL)}
PAYER=${SOLANA_PAYER_KEYPAIR_PATH:-$(from_env_file SOLANA_PAYER_KEYPAIR_PATH)}
PAYER=${PAYER/#\~/$HOME}
[ -n "$URL" ] || { echo "Set SOLANA_RPC_NETWORK_URL (.env)"; exit 1; }
[ -f "$PAYER" ] || { echo "Set SOLANA_PAYER_KEYPAIR_PATH (.env) to a keypair file"; exit 1; }

DEVNET_GENESIS=EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG
case "$URL" in
    http://127.0.0.1:* | http://localhost:*) ;;
    *) [ "$(solana genesis-hash -u "$URL")" = "$DEVNET_GENESIS" ] ||
        { echo "SOLANA_RPC_NETWORK_URL is not devnet; refusing"; exit 1; } ;;
esac

OUT=${NORI_SOL_ENV_DIR:-$REPO}/.env.nori-sol-demo

echo "Payer $(solana address -k "$PAYER"), balance $(solana balance -k "$PAYER" -u "$URL")"

# deploy_program NAME DIR LIB: builds programs/DIR and deploys it at its
# committed keypair (programs/DIR/LIB-keypair.json), unless the deployed
# program is this build
deploy_program() {
    local name=$1 dir=$2 lib=$3
    local keypair=$REPO/programs/$dir/$lib-keypair.json so=$REPO/target/deploy/$lib.so
    local program build so_len deployed_so deployed_len extra
    program=$(solana-keygen pubkey "$keypair")

    echo "Building $name"
    if ! build=$(cargo build-sbf --manifest-path "$REPO/programs/$dir/Cargo.toml" 2>&1); then
        echo "$build" | tail -15
        exit 1
    fi
    echo "$build" | grep -E "Finished" || true

    # Skip the upgrade when the deployed program is this build (an upgrade
    # briefly locks ~1.8 SOL in a buffer)
    so_len=$(wc -c <"$so" | tr -d ' ')
    deployed_so=$(mktemp "${TMPDIR:-/tmp}/$lib-deployed.XXXXXX")
    if solana program dump "$program" "$deployed_so" -u "$URL" >/dev/null 2>&1 &&
        head -c "$so_len" "$deployed_so" | cmp -s - "$so"; then
        echo "$name $program is up to date"
    else
        # An upgrade to a bigger binary must grow the program account first, by at
        # least 10,240 bytes (the loader's minimum; the CLI only asks for the difference)
        deployed_len=$(solana program show "$program" -u "$URL" 2>/dev/null | awk '/Data Length/ {print $3}' || true)
        if [ -n "$deployed_len" ] && [ "$so_len" -gt "$deployed_len" ]; then
            extra=$((so_len - deployed_len))
            [ "$extra" -ge 10240 ] || extra=10240
            echo "Extending $name by $extra bytes ($deployed_len -> $so_len needed)"
            solana program extend "$program" "$extra" -k "$PAYER" -u "$URL"
        fi
        echo "Deploying $name $program"
        solana program deploy "$so" --program-id "$keypair" \
            -k "$PAYER" --upgrade-authority "$PAYER" -u "$URL"
    fi
    rm -f "$deployed_so"
}

# build-sbf ignores --locked and would silently re-resolve a stale lock into
# crates the SBF rustc can't build; catch that here with a clear message
cargo metadata --locked --format-version 1 --manifest-path "$REPO/Cargo.toml" >/dev/null 2>&1 ||
    { echo "Cargo.lock is out of date with Cargo.toml (cargo metadata --locked failed)"; exit 1; }

deploy_program Backstop backstop backstop
# The smallest nori-read consumer; Prove balance verifies results with it
deploy_program nori-read-example nori-read-example nori_read_example

MINT=$( [ -f "$OUT" ] && grep -E "^$MINT_VAR=" "$OUT" | cut -d= -f2- || true)
if [ -n "$MINT" ]; then
    echo "$MINT_VAR $MINT exists ($OUT); supply $(spl-token supply "$MINT" -u "$URL")"
    exit 0
fi

echo "Creating a demo mint for $MINT_VAR"
MINT=$(spl-token create-token --decimals 9 --mint-authority "$PAYER" --fee-payer "$PAYER" \
    -u "$URL" --output json | python3 -c 'import json, sys; print(json.load(sys.stdin)["commandOutput"]["address"])')
ACCOUNT=$(spl-token create-account "$MINT" --owner "$PAYER" --fee-payer "$PAYER" -u "$URL" \
    | awk '/Creating account/ {print $3}')
spl-token mint "$MINT" "$SUPPLY" "$ACCOUNT" --mint-authority "$PAYER" --fee-payer "$PAYER" -u "$URL" >/dev/null
# Set MINT_VAR in the output file, keeping its other lines
{ [ -f "$OUT" ] && grep -v "^$MINT_VAR=" "$OUT" || echo "# Written by scripts/deploy-devnet.sh"; } >"$OUT.tmp"
echo "$MINT_VAR=$MINT" >>"$OUT.tmp"
mv "$OUT.tmp" "$OUT"
echo "$MINT_VAR $MINT, supply $(spl-token supply "$MINT" -u "$URL") -> $OUT"
