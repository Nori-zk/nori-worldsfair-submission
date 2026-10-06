# Backstop client

Sample client and keeper CLI. The full client (WSS/rxjs on Nori's infra) comes later.

- `fetchSnapshotRead`: snapshot transaction -> witness, once Nori has proven its batch.
- `createGuardInstruction`, `submitReadInstruction`, `checkpointInstruction`, `decodeGuard`: bytes pinned to the Rust program (`test-vectors/backstop`).

## Keeper

```sh
npm run keeper -- create-guards        # the keeper key is each guard's admin
npm run keeper -- run                  # or one step: snapshot | checkpoint | submit | status
```

The default config, `keeper.demo.json`, takes its `${VARS}` from the repo's `.env`
and the deploy outputs in `ethereum/` (see the root README, "Deploy").
`ETH_PRIVATE_KEY` signs the snapshot transactions. Another config: pass its path last.

## Local dry run (no prover, no testnet)

```sh
scripts/dry-run.sh                     # pauses before each step; --yes runs straight through
scripts/dry-run.sh --eth-rpc <mainnet or sepolia URL> --solana-rpc https://api.devnet.solana.com
```

It runs local chains (a Hardhat fork of `--eth-rpc`, surfpool forking `--solana-rpc`) and the keeper. `fake-prover` stands in for Nori: it writes the proven batch onto surfpool and proves nothing. The script replays the Kelp drain on a demo lockbox: HEALTHY, then TRIPPED, then still TRIPPED after a refill. It exits non-zero if any status is wrong.

`npm test` checks the witness against the Kelp vectors and the encoders against the Rust bytes.
