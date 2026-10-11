import { define, type StateUnion } from '@yaw-rx/ystate';
import { readThroughConnectionsOf } from '@nori-zk/nori-bridge-solana-sdk';

/**
 * What one NoriSnapshot transaction covering the keeper's queries would
 * commit now, read through the Ethereum connection
 * (`readThroughConnectionsOf`) with a `staticCall` from the keeper's
 * address: the snapshot fee, and the results root (it hashes only the query
 * ids and their results). Read at once, then again on each new Ethereum
 * block. `resultsRoot` is `''` until read.
 */
export const SnapshotCallGraph = define(
    readThroughConnectionsOf({ fee: 0n as bigint, resultsRoot: '' })
);

/** The snapshot call's state: a node of the graph and its data. */
export type SnapshotCallState = StateUnion<typeof SnapshotCallGraph.nodes>;
