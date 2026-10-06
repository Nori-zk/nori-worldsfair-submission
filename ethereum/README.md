# NoriSnapshot

The proof queue only proves the caller's own storage. `NoriSnapshot` runs any
view calls (up to 256), commits all results under one Merkle root in its own
storage, and enqueues one proof request for it. It has no owner or admin.

## The proven leaf

| Field            | Value                                                 |
| ---------------- | ----------------------------------------------------- |
| `target`         | `NoriSnapshot` address                                |
| `collectionKeys` | `[snapshot index (from 1), block << 64 \| timestamp]` |
| `value`          | `resultsRoot \| 1 << 255`                             |

Result leaf: `sha256(0x00 ++ queryId ++ result)`, where
`queryId = keccak256(abi.encode(target, data))`. The results come from the
`Snapshot` event, which is enough to rebuild any witness.

## A consumer must

- pin the Nori program, the `NoriSnapshot` address and its query ids;
- reject stale snapshots, and track the newest block per query (old snapshots stay valid);
- avoid views a flash loan can move within one transaction.

`nori-read` does the rest. `snapshotProof.ts` is the TS mirror.

## Commands

```sh
npm test                 # unit tests + vector drift check
npm run test:fork        # real mainnet getters on a fork
npm run vectors          # regenerate test-vectors/nori-snapshot
npm run deploy           # NoriSnapshot (+ a fresh queue unless NORI_ETH_PROOF_QUEUE_ADDRESS)
npm run snapshot -- usds-lockbox aave-ntt-hub
npm run snapshot -- --target 0x... --signature 'balanceOf(address)' --args 0x...
npm run preview-snapshot # read-only check of each query
npm run deploy-demo -- 116723.52     # testnet demo: a lockbox you drain by hand
npm run demo-set -- 223.52 [--paused]
```

Config: copy `.env.example` to `.env`. The deploy task writes `.env.nori-eth-snapshot`.

## Cost (mainnet fork, queue fee 0)

| Snapshot   | Gas     | ~USD (1.08 gwei, ETH $2,707) |
| ---------- | ------- | ---------------------------- |
| 6 tokens   | 264,587 | $0.77                        |
| 10 queries | 317,908 | $0.93                        |
