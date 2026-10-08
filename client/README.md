# Backstop client

Sample client and keeper CLI, in Node. The browser apps are in [web/](../web/README.md).

- `fetchProvenSnapshot`: snapshot transaction -> the witness for any of its results, once Nori has proven its batch. Reads through the sdk's `createConnections`.
- `verifySnapshotResult`: verifies one result on Solana by simulating `nori-read-example`'s `read_snapshot_result` (no signature, no fee; the fee payer must be an existing funded account). `@nori-zk/backstop-client/read` exports it without the Backstop encoders, for browsers.
- `createGuardInstruction`, `submitReadInstruction`, `checkpointInstruction`, `assertHealthyInstruction`, `decodeGuard`: bytes pinned to the Rust program (`test-vectors/backstop`). `BackstopError`: its error codes.

## Keeper

```sh
npm run keeper -- create-guards        # the keeper key is each guard's admin
npm run keeper -- run                  # or one step: snapshot | checkpoint | submit | status
npm run keeper -- unlatch              # admin: clear a trip, after a read shows the backing restored
npm run keeper -- assert               # each guard's assert_healthy, as a lender calls it: allowed, or blocked: <error> (--send lands it)
```

The default config, `keeper.demo.json`, takes its `${VARS}` from the repo's `.env`
and the deploy outputs (see the root README, "Deploy"); an empty value counts as unset.
`ETH_PRIVATE_KEY` signs the snapshot transactions. Another config: pass its path last.

## Overnight soak (a second, untouched guard)

`scripts/soak.sh [MINUTES=600] [OUT]` runs the keeper on `keeper.soak.json`: the demo guard
plus a shadow guard over a lockbox nobody touches, which should stay HEALTHY. The first
run deploys the shadow lockbox and mint and creates the guards. It logs to
`OUT/keeper.log` and writes `OUT/report.md` at the end (also when stopped early):
snapshots, Ethereum block → reads applied, failures, checkpoint gaps, status changes.

## Wormhole 2022 replay (showcase)

`scripts/replay-wormhole.sh` replays the 2022 forgery on Sepolia + devnet with real proofs, on
its own lockbox, mint and guard (`keeper.wormhole.json`: the demo guard's settings, tolerance 0):
93,769.40 locked and minted → HEALTHY; 26,230.60 forged on Solana → WARN at once, and
`assert_healthy` fails with `SupplyAboveBacking`; a snapshot one window (10 min) later →
TRIPPED once proven, deficit 26,230.60. About 50 min; rerun to continue. It prints each status
with its time; the keeper logs to `replay-wormhole.log`.

## Local dry run (no prover, no testnet)

```sh
scripts/dry-run.sh                     # pauses before each step; --yes runs straight through
scripts/dry-run.sh --eth-rpc <mainnet or sepolia URL> --solana-rpc https://api.devnet.solana.com
```

It runs local chains (a Hardhat fork of `--eth-rpc`, surfpool forking `--solana-rpc`) and the keeper. `fake-prover` stands in for Nori: it writes the proven batch onto surfpool and proves nothing. The script replays the Kelp drain on a demo lockbox: HEALTHY, then TRIPPED, then still TRIPPED after a refill. It exits non-zero if any status is wrong.

`npm test` checks the witness against the Kelp vectors and the encoders against the Rust bytes.
