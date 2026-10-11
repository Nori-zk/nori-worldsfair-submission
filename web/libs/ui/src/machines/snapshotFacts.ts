import { define, type StateUnion } from '@yaw-rx/ystate';
import { readThroughConnectionsOf } from '@nori-zk/nori-bridge-solana-sdk';

/** One NoriSnapshot transaction, from its `Snapshot` event alone. */
export interface SnapshotFact {
    index: bigint;
    requestId: bigint;
    blockNumber: bigint;
    /** The snapshot block's time, unix seconds. */
    timestamp: bigint;
    /** Each query's id and its 32-byte result, 0x-hex, in order. */
    queryIds: string[];
    results: string[];
    /** The snapshot transaction. */
    txHash: string;
}

/**
 * The newest NoriSnapshot snapshots, newest first, read through the Ethereum
 * connection (`readThroughConnectionsOf`) from its `Snapshot` events: read at
 * once, then again on each `Snapshot` event. A read walks back from the
 * latest block, a window of blocks at a time, until it has found the snapshots
 * it shows or reached the queue's deploy block. `snapshots` is empty until
 * the first read.
 */
export const SnapshotFactsGraph = define(
    readThroughConnectionsOf({ snapshots: [] as SnapshotFact[] }),
);

/** The snapshot facts' state: a node of the graph and its data. */
export type SnapshotFactsState = StateUnion<typeof SnapshotFactsGraph.nodes>;
