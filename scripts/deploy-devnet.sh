#!/usr/bin/env bash
# Solana side of the demo: deploys Backstop (or upgrades it) and, once, creates
# the demo mint holding 116,700 tokens (9 decimals). Writes BACKSTOP_DEMO_MINT
# to .env.nori-sol-demo, which the keeper reads.
#
# Usage: scripts/deploy-devnet.sh
# Reads SOLANA_RPC_NETWORK_URL and SOLANA_PAYER_KEYPAIR_PATH from the shell or
# .env. The payer becomes Backstop's upgrade authority and the mint authority.
# NORI_SOL_ENV_DIR redirects the output file.

set -euo pipefail

REPO=$(cd "$(dirname "$0")/.." && pwd)
SUPPLY=116700
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

OUT=${NORI_SOL_ENV_DIR:-$REPO}/.env.nori-sol-demo
PROGRAM_KEYPAIR=$REPO/programs/backstop/backstop-keypair.json
BACKSTOP=$(solana-keygen pubkey "$PROGRAM_KEYPAIR")

echo "Payer $(solana address -k "$PAYER"), balance $(solana balance -k "$PAYER" -u "$URL")"

echo "Building Backstop"
cargo build-sbf --manifest-path "$REPO/programs/backstop/Cargo.toml" 2>&1 | grep -E "^error|Finished" || true

echo "Deploying Backstop $BACKSTOP"
solana program deploy "$REPO/target/deploy/backstop.so" --program-id "$PROGRAM_KEYPAIR" \
    -k "$PAYER" --upgrade-authority "$PAYER" -u "$URL"

MINT=$( [ -f "$OUT" ] && grep -E "^BACKSTOP_DEMO_MINT=" "$OUT" | cut -d= -f2- || true)
if [ -n "$MINT" ]; then
    echo "Demo mint $MINT exists ($OUT); supply $(spl-token supply "$MINT" -u "$URL")"
    exit 0
fi

echo "Creating the demo mint"
MINT=$(spl-token create-token --decimals 9 --mint-authority "$PAYER" --fee-payer "$PAYER" \
    -u "$URL" --output json | python3 -c 'import json, sys; print(json.load(sys.stdin)["commandOutput"]["address"])')
ACCOUNT=$(spl-token create-account "$MINT" --owner "$PAYER" --fee-payer "$PAYER" -u "$URL" \
    | awk '/Creating account/ {print $3}')
spl-token mint "$MINT" "$SUPPLY" "$ACCOUNT" --mint-authority "$PAYER" --fee-payer "$PAYER" -u "$URL" >/dev/null
printf '# Written by scripts/deploy-devnet.sh\nBACKSTOP_DEMO_MINT=%s\n' "$MINT" >"$OUT"
echo "Demo mint $MINT, supply $(spl-token supply "$MINT" -u "$URL") -> $OUT"
