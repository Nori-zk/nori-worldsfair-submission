# Backstop client

Sample client and keeper CLI. The full client (WSS/rxjs on Nori's infra) comes later.

- `fetchSnapshotRead`: snapshot transaction -> witness, once Nori has proven its batch.
- `createGuardInstruction`, `submitReadInstruction`, `checkpointInstruction`, `decodeGuard`: bytes pinned to the Rust program (`test-vectors/backstop`).

## Keeper

```sh
cp keeper.example.json keeper.json     # fill in the addresses
export ETH_PRIVATE_KEY=...             # signs snapshot transactions
npm run keeper -- create-guards keeper.json
npm run keeper -- run keeper.json      # or one step: snapshot | checkpoint | submit | status
```

## Local dry run (no prover, no testnet)

`fake-prover` stands in for Nori: it writes the proven batch onto surfpool. It proves nothing.

1. `cd ethereum && npx hardhat node --fork https://ethereum-sepolia-rpc.publicnode.com`, then align its clock (the fork lags real time): `cast rpc evm_setNextBlockTimestamp $(date +%s) && cast rpc evm_mine`.
2. `surfpool start`, then `solana program deploy target/deploy/backstop.so --program-id programs/backstop/backstop-keypair.json -u localhost`.
3. Make a mint: `spl-token create-token --decimals 9`, `spl-token create-account <mint>`, `spl-token mint <mint> 116700 <account>`.
4. Deploy on the fork (`ETH_NETWORK=localfork`, `ETH_RPC_URL=http://127.0.0.1:8545`, Hardhat key 0): `npx hardhat --network localfork deploy`, then `deployDemo 116723.52`.
5. Write `keeper.json` for localhost with `skewSecs` and `checkpointIntervalSecs` set to 5.
6. `fake-prover`, `create-guards`, `checkpoint`, `snapshot`, `fake-prover`, `submit`, `status`. The status shows HEALTHY.
7. Drain: `demoSet 223.52`, then `checkpoint`, `snapshot`, `fake-prover`, `submit`, `status`. The status shows TRIPPED, with a deficit of 116,475.48.

Every step was run this way on 6 Oct 2026.

`npm test` checks the witness against the Kelp vectors and the encoders against the Rust bytes.
