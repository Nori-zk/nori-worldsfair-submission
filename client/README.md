# Backstop sample client

A minimal client: from a `NoriSnapshot` transaction to a Backstop `submit_read`. The full client (WSS/rxjs, connected to Nori's infra) comes later.

```ts
import {
    fetchSnapshotRead,
    submitReadInstruction,
    ReadKind,
} from '@nori-zk/backstop-client';

const read = await fetchSnapshotRead({
    rpc,
    provider,
    noriSnapshot,
    proofQueue,
    snapshotTxHash,
    queryId,
});
if (read.proven) {
    const ix = submitReadInstruction({
        guard,
        mint,
        proofQueueBatch: read.proofQueueBatch,
        kind: ReadKind.Backing,
        witness: read.witness,
    });
    // sign and send with @solana/kit
}
```

`npm test` checks the witness against the Kelp vectors, and the instruction bytes against the Rust program's (`test-vectors/backstop`).
