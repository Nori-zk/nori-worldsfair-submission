#!/usr/bin/env bash
# Solana side of the demo: deploys Backstop (or upgrades it, when the build
# differs) and, once, creates a demo mint holding 116,700 tokens (9 decimals).
# Writes the mint to .env.nori-sol-demo, which the keeper reads.
#
# Usage: scripts/deploy-devnet.sh
#        MINT_VAR=BACKSTOP_SHADOW_MINT scripts/deploy-devnet.sh   # a second mint
#        (MINT_VAR names the variable; default BACKSTOP_DEMO_MINT)
# Reads SOLANA_RPC_NETWORK_URL and SOLANA_PAYER_KEYPAIR_PATH from the shell or
# .env. The payer becomes Backstop's upgrade authority and the mint authority.
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
PROGRAM_KEYPAIR=$REPO/programs/backstop/backstop-keypair.json
BACKSTOP=$(solana-keygen pubkey "$PROGRAM_KEYPAIR")

echo "Payer $(solana address -k "$PAYER"), balance $(solana balance -k "$PAYER" -u "$URL")"

echo "Building Backstop"
# A stale submodule makes cargo re-resolve the lock (build-sbf ignores --locked)
# into crates the SBF rustc can't build; catch it here with a clear message
cargo metadata --locked --format-version 1 --manifest-path "$REPO/Cargo.toml" >/dev/null 2>&1 ||
    { echo "Cargo.lock doesn't match the submodules. After a pull: git submodule update --init --recursive"; exit 1; }
if ! BUILD=$(cargo build-sbf --manifest-path "$REPO/programs/backstop/Cargo.toml" 2>&1); then
    echo "$BUILD" | tail -15
    exit 1
fi
echo "$BUILD" | grep -E "Finished" || true

# Skip the upgrade when the deployed program is this build (an upgrade
# briefly locks ~1.8 SOL in a buffer)
SO_LEN=$(wc -c <"$REPO/target/deploy/backstop.so" | tr -d ' ')
DEPLOYED_SO=$(mktemp "${TMPDIR:-/tmp}/backstop-deployed.XXXXXX")
if solana program dump "$BACKSTOP" "$DEPLOYED_SO" -u "$URL" >/dev/null 2>&1 &&
    head -c "$SO_LEN" "$DEPLOYED_SO" | cmp -s - "$REPO/target/deploy/backstop.so"; then
    echo "Backstop $BACKSTOP is up to date"
else
    # An upgrade to a bigger binary must grow the program account first, by at
    # least 10,240 bytes (the loader's minimum; the CLI only asks for the difference)
    DEPLOYED_LEN=$(solana program show "$BACKSTOP" -u "$URL" 2>/dev/null | awk '/Data Length/ {print $3}' || true)
    if [ -n "$DEPLOYED_LEN" ] && [ "$SO_LEN" -gt "$DEPLOYED_LEN" ]; then
        EXTRA=$((SO_LEN - DEPLOYED_LEN))
        [ "$EXTRA" -ge 10240 ] || EXTRA=10240
        echo "Extending Backstop by $EXTRA bytes ($DEPLOYED_LEN -> $SO_LEN needed)"
        solana program extend "$BACKSTOP" "$EXTRA" -k "$PAYER" -u "$URL"
    fi
    echo "Deploying Backstop $BACKSTOP"
    solana program deploy "$REPO/target/deploy/backstop.so" --program-id "$PROGRAM_KEYPAIR" \
        -k "$PAYER" --upgrade-authority "$PAYER" -u "$URL"
fi
rm -f "$DEPLOYED_SO"

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
