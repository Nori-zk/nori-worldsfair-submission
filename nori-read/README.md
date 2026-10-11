# nori-read

Rust crate: verify one `NoriSnapshot` result inside a Solana program, against a
proof queue batch the Nori light client proved. About 3,400 CU.

```rust
use nori_read::{load_proof_queue_batch, verify_snapshot_result, NORI_PROGRAM_ID};

let batch = load_proof_queue_batch(&ctx.accounts.proof_queue_batch, &NORI_PROGRAM_ID)
    .map_err(|_| error!(MyError::UntrustedBatch))?;
let proven = verify_snapshot_result(&batch, &NORI_SNAPSHOT, &QUERY_ID, &witness)
    .map_err(|_| error!(MyError::InvalidRead))?;
// proven.result, proven.eth_block_number, proven.eth_timestamp
```

The witness is built off-chain from the `Snapshot` event and the queue
(`createSnapshotEventMachine`, `createProvenRequestMachine` and `snapshotResultWitness` in
[`client/`](../client)).

Your program must:

- pin the Nori program, the `NoriSnapshot` address and the query ids it acts on (never take them from the caller);
- reject stale results, and keep the newest `eth_block_number` per query: old snapshots stay valid;
- query only contracts whose views it trusts: a result is proven to be what the contract returned, not that it is true. A precompile or an upgradeable contract returns whatever its code or admin decides.

`verify_snapshot_result` checks the batch account's owner, the leaf against the
batch root (target, keys, top-bit sentinel, nonzero index and time), then the
result against the results root. The data format is in
[`NoriSnapshot.sol`](../ethereum/contracts/NoriSnapshot.sol).

Consumers: [`nori-read-example`](../programs/nori-read-example/src/lib.rs) (smallest),
[`backstop`](../programs/backstop). Tests: `cargo test -p nori-read`, against
[`test-vectors/nori-snapshot`](../test-vectors/nori-snapshot).
