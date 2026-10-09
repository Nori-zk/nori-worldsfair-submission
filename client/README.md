# Backstop client

Sample client and keeper CLI. The full client (WSS/rxjs on Nori's infra) comes later.

- `fetchProvenSnapshot`: snapshot transaction -> the witness for any of its results, once Nori has proven its batch.
- `createGuardInstruction`, `submitReadInstruction`, `checkpointInstruction`, `decodeGuard`: bytes pinned to the Rust program (`test-vectors/backstop`).

## Keeper

```sh
npm run keeper -- create-guards        # the keeper key is each guard's admin
npm run keeper -- run                  # or one step: snapshot | checkpoint | submit | status
npm run keeper -- unlatch              # admin: clear a trip, after a read shows the backing restored
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

## Test campaign (scenarios on real proofs)

`scripts/campaign.sh [OUT] [--once | --continuous]` runs the keeper and the scenarios in
`src/scenarios/` as one process on `keeper.campaign.json`: two dedicated guards (`test-a`,
`test-b`, each with its own lockbox and mint) go through the scenarios while the shadow guard
is the untouched control. The first run deploys the test lockboxes and mints and creates the guards.

| Track  | Scenarios                                                                                                                                                    |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| test-a | S0 baseline · S1 pause/unpause · S2 inbound transfer in flight (lock, then mint) · S4 fast burn→unlock (a70c997) · S6 the Kelp drain with an early `unlatch` |
| test-b | S0 baseline · S3 burn, unlock 5 min later · S5 forged mint of 120,000: WARN, TRIPPED, burn + `unlatch`                                                       |

Each step acts on a chain, waits for the proven read that reflects it (15–22 min), then checks the
guard's status and deficit. After every applied read, simulated attacks run on each guard
(replayed read, tampered result, pause result as backing, foreign batch, non-admin `unlatch`,
`assert_healthy`) and must fail with their specific error; every fourth round the program's
`status` is compared with the TypeScript `guardStatus`. Output in `OUT/`: `events.jsonl` (everything),
`flights.json` (each snapshot's block → finalized → proven → applied times), `report.md` and a
self-contained `dashboard.html`, rewritten every 5 min and at the end
(`node build/bin/campaignReport.js keeper.campaign.json OUT` regenerates them).

## Local dry run (no prover, no testnet)

```sh
scripts/dry-run.sh                     # pauses before each step; --yes runs straight through
scripts/dry-run.sh --eth-rpc <mainnet or sepolia URL> --solana-rpc https://api.devnet.solana.com
```

It runs local chains (a Hardhat fork of `--eth-rpc`, surfpool forking `--solana-rpc`) and the keeper. `fake-prover` stands in for Nori: it writes the proven batch onto surfpool and proves nothing. The script replays the Kelp drain on a demo lockbox: HEALTHY, then TRIPPED, then still TRIPPED after a refill. It exits non-zero if any status is wrong.

`npm test` checks the witness against the Kelp vectors and the encoders against the Rust bytes.
