#!/usr/bin/env bash
# The whole Nori read loop on local chains, with a fake prover:
#
#   Sepolia fork (Hardhat) -> keeper snapshot -> fake-prover "proves" the batch
#   -> keeper submit_read -> Backstop guard on surfpool
#
# Replays the Kelp drain on a demo lockbox: HEALTHY, then TRIPPED, then still
# TRIPPED after a refill. fake-prover proves nothing; it writes the batch
# accounts the real prover's `update` would.
#
# Usage: scripts/dry-run.sh [--eth-rpc URL] [--solana-rpc URL] [--yes] [--keep]
#   --eth-rpc URL     Ethereum chain the local node forks (default: Sepolia,
#                     publicnode). A mainnet URL forks mainnet instead.
#   --solana-rpc URL  Solana chain surfpool forks accounts from, e.g.
#                     https://api.devnet.solana.com (default: offline).
#                     Solana always runs locally: fake-prover needs surfpool.
#   --yes             run straight through, no pauses (exits non-zero if a
#                     status is wrong)
#   --keep            leave both chains running at the end
#
# ETH_FORK_RPC and SOLANA_FORK_RPC work as defaults for the two URLs.
#
# Needs: npm install && npm run build (once), solana, spl-token, surfpool >= 1.5, cast.
# Uses ports 18545 (Ethereum) and 18899/18900 (Solana), and a temp dir; it
# ignores your .env and does not touch your Solana CLI config or wallet.

set -euo pipefail

YES=0
KEEP=0
ETH_FORK_RPC=${ETH_FORK_RPC:-https://ethereum-sepolia-rpc.publicnode.com}
SOLANA_FORK_RPC=${SOLANA_FORK_RPC:-}
usage() { echo "Usage: $0 [--eth-rpc URL] [--solana-rpc URL] [--yes] [--keep]"; exit 1; }
while [ $# -gt 0 ]; do
    case "$1" in
        --eth-rpc) ETH_FORK_RPC=${2:?--eth-rpc needs a URL}; shift ;;
        --solana-rpc) SOLANA_FORK_RPC=${2:?--solana-rpc needs a URL}; shift ;;
        --yes) YES=1 ;;
        --keep) KEEP=1 ;;
        *) usage ;;
    esac
    shift
done

REPO=$(cd "$(dirname "$0")/.." && pwd)
W=$(mktemp -d "${TMPDIR:-/tmp}/nori-dry-run.XXXXXX")  # GNU and BSD mktemp
ETH_URL=http://127.0.0.1:18545
SOL_URL=http://127.0.0.1:18899
SOL_WS=ws://127.0.0.1:18900
NORI_PROGRAM=EUz5RMQxYkc9zu12wpCDu9syvr4MarghoYb6jHAvdAcg
export CFLAGS=${CFLAGS:-"-isystem $HOME/.cache/solana/v1.54/platform-tools/llvm/sbpf/include"}

# Ethereum tasks: the local fork, Hardhat's public test key 0, outputs in $W
export ETH_NETWORK=localfork ETH_RPC_URL=$ETH_URL NORI_ETH_ENV_DIR=$W
export ETH_PRIVATE_KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
# Set (even empty) wins over .env: the dry run deploys its own queue
export NORI_ETH_PROOF_QUEUE_ADDRESS= NORI_ETH_SNAPSHOT_QUEUE_OPERATOR_ADDRESS= \
    NORI_ETH_SNAPSHOT_QUEUE_FEE_RECIPIENT_ADDRESS= NORI_ETH_SNAPSHOT_PROOF_REQUEST_QUEUE_FEE_WEI=0

bold=$(tput bold 2>/dev/null || true)
reset=$(tput sgr0 2>/dev/null || true)
say() { echo; echo "${bold}== $*${reset}"; }
step() {
    say "$*"
    if [ "$YES" = 0 ]; then read -r -p "   press Enter to run " _; fi
}
quiet() { "$@" 2>&1 | grep -vE "ExperimentalWarning|trace-warnings|^\s*$" || true; }

PIDS=()
cleanup() {
    if [ "$KEEP" = 1 ]; then
        echo; echo "Chains left running (pids ${PIDS[*]:-}); work dir $W"
        return
    fi
    for pid in "${PIDS[@]:-}"; do [ -n "$pid" ] && kill "$pid" 2>/dev/null || true; done
    rm -rf "$W"
}
trap cleanup EXIT

wait_for() {
    local name=$1 check=$2
    for _ in $(seq 1 90); do
        if eval "$check" >/dev/null 2>&1; then return 0; fi
        sleep 1
    done
    echo "$name did not start; logs in $W"; exit 1
}

for tool in solana spl-token surfpool cast npx; do
    command -v "$tool" >/dev/null || { echo "Missing: $tool"; exit 1; }
done
[ -d "$REPO/sdk/ethereum/build" ] || { echo "Run 'npm install && npm run build' first"; exit 1; }
for port in 18545 18899 18900; do
    if lsof -i ":$port" >/dev/null 2>&1; then echo "Port $port is busy"; exit 1; fi
done

# --------------------------------------------------------------------------
say "Starting chains (logs in $W)"
(cd "$REPO/ethereum" && ETH_NETWORK=hardhat exec npx hardhat node --fork "$ETH_FORK_RPC" --port 18545) >"$W/ethereum.log" 2>&1 &
PIDS+=($!)
if [ -n "$SOLANA_FORK_RPC" ]; then SOLANA_SOURCE=(--rpc-url "$SOLANA_FORK_RPC"); else SOLANA_SOURCE=(--offline); fi
(cd "$W" && exec surfpool start "${SOLANA_SOURCE[@]}" --no-deploy --no-tui -p 18899 --ws-port 18900) >"$W/solana.log" 2>&1 &
PIDS+=($!)
wait_for "Ethereum fork" "cast chain-id --rpc-url $ETH_URL"
wait_for "surfpool" "solana cluster-version -u $SOL_URL"
# A fork's clock starts behind real time; the guard compares it with Solana's
cast rpc evm_setNextBlockTimestamp "$(date +%s)" --rpc-url "$ETH_URL" >/dev/null
cast rpc evm_mine --rpc-url "$ETH_URL" >/dev/null
echo "Ethereum: fork of chain $(cast chain-id --rpc-url "$ETH_FORK_RPC") ($ETH_FORK_RPC) on $ETH_URL"
echo "surfpool on $SOL_URL, accounts from ${SOLANA_FORK_RPC:-nowhere (offline)}"

say "Building Backstop and the client"
# A stale submodule makes cargo re-resolve the lock (build-sbf ignores --locked)
# into crates the SBF rustc can't build; catch it here with a clear message
cargo metadata --locked --format-version 1 --manifest-path "$REPO/Cargo.toml" >/dev/null 2>&1 ||
    { echo "Cargo.lock doesn't match the submodules. After a pull: git submodule update --init --recursive"; exit 1; }
if ! BUILD=$(cargo build-sbf --manifest-path "$REPO/programs/backstop/Cargo.toml" 2>&1); then
    echo "$BUILD" | tail -15
    exit 1
fi
echo "$BUILD" | grep -E "Finished" || true
(cd "$REPO" && npm run -s build -w ethereum -w client >/dev/null)

say "Solana: deploying Backstop, minting 116,700 rsETH"
PAYER=$W/payer.json
solana-keygen new --no-bip39-passphrase --silent -o "$PAYER" >/dev/null
solana-keygen new --no-bip39-passphrase --silent -o "$W/mint.json" >/dev/null
MINT=$(solana-keygen pubkey "$W/mint.json")
solana airdrop 100 "$(solana-keygen pubkey "$PAYER")" -u "$SOL_URL" >/dev/null
solana program deploy "$REPO/target/deploy/backstop.so" \
    --program-id "$REPO/programs/backstop/backstop-keypair.json" -k "$PAYER" -u "$SOL_URL" >/dev/null
spl-token create-token "$W/mint.json" --decimals 9 --mint-authority "$PAYER" --fee-payer "$PAYER" -u "$SOL_URL" >/dev/null
ACCOUNT=$(spl-token create-account "$MINT" --owner "$PAYER" --fee-payer "$PAYER" -u "$SOL_URL" | awk '/Creating account/ {print $3}')
spl-token mint "$MINT" 116700 "$ACCOUNT" --mint-authority "$PAYER" --fee-payer "$PAYER" -u "$SOL_URL" >/dev/null
echo "Backstop JAZNGzLyN1TKhjnDDKrSsaQveAhUZUjiG8usM9Du5UD9, mint $MINT (supply 116,700)"

say "Ethereum: deploying the proof queue, NoriSnapshot and a lockbox holding 116,723.52"
(cd "$REPO/ethereum" && quiet npx hardhat --network localfork deploy | grep -oE "(NoriProofRequestQueue|NoriSnapshot) deployed to: 0x[0-9a-fA-F]+")
(cd "$REPO/ethereum" && quiet npx hardhat --network localfork deployDemo 116723.52 | grep -oE "DemoLockbox deployed to 0x[0-9a-fA-F]+")
set -a
. "$W/.env.nori-eth-snapshot"
. "$W/.env.nori-eth-demo"
set +a

cat >"$W/keeper.json" <<EOF
{
  "ethereum": { "rpcUrl": "$ETH_URL", "noriSnapshot": "$NORI_ETH_SNAPSHOT_ADDRESS", "proofQueue": "$NORI_ETH_PROOF_QUEUE_ADDRESS" },
  "solana": { "rpcUrl": "$SOL_URL", "wsUrl": "$SOL_WS", "keypair": "$PAYER", "noriProgram": "$NORI_PROGRAM" },
  "intervals": { "snapshotSecs": 120, "checkpointSecs": 10, "pollSecs": 15 },
  "stateFile": "$W/keeper-state.json",
  "guards": [{
    "name": "demo-lockbox", "mint": "$MINT",
    "backing": { "target": "$NORI_ETH_DEMO_LOCKBOX_ADDRESS", "signature": "locked()", "args": [] },
    "pause": { "target": "$NORI_ETH_DEMO_LOCKBOX_ADDRESS", "signature": "paused()", "args": [] },
    "backingDecimals": 18, "tolerance": "1000000000",
    "windowSecs": 600, "skewSecs": 5, "checkpointIntervalSecs": 5, "maxStalenessSecs": 7200
  }]
}
EOF
echo "Keeper config: $W/keeper.json"

keeper() { (cd "$REPO/client" && quiet npm run -s keeper -- "$1" "$W/keeper.json"); }
prove() { (cd "$REPO/client" && quiet npm run -s fake-prover -- "$W/keeper.json"); }
demo_set() { (cd "$REPO/ethereum" && quiet npx hardhat --network localfork demoSet "$@" | grep -oE "DemoLockbox: .*\)"); }
expect_status() {
    local out
    out=$(keeper status)
    echo "$out"
    if ! grep -q "demo-lockbox: $1 " <<<"$out"; then echo "Expected $1"; exit 1; fi
}

# --------------------------------------------------------------------------
step "1. The Nori program's state (fake-prover), then the guard"
prove
keeper create-guards
sleep 6

step "2. Keeper snapshots the lockbox on Ethereum: locked() and paused() in one transaction"
keeper snapshot
keeper submit

step "3. The batch is proven (fake-prover stands in for bridge-head + update); the keeper submits the reads"
prove
keeper submit
expect_status HEALTHY

step "4. Kelp drain: the lockbox drops to 223.52, then snapshot, prove, submit"
demo_set 223.52
keeper checkpoint
sleep 6
keeper snapshot
prove
keeper submit
expect_status TRIPPED

step "5. The attacker refills to 40,300 and the lockbox pauses: it stays tripped"
demo_set 40300 --paused
sleep 6
keeper snapshot
prove
keeper submit
expect_status TRIPPED

say "Done: HEALTHY -> TRIPPED on the drain -> still TRIPPED after the refill"
