import { define, type StateUnion } from '@yaw-rx/ystate';
import { readThroughConnectionsOf } from '@nori-zk/nori-bridge-solana-sdk';
import { type AsNodeData } from '@nori-zk/nori-bridge-solana-sdk/utils';
import { type SnapshotEvent } from './snapshotWitness.js';

/**
 * A snapshot transaction's `Snapshot` event, read from its receipt through
 * the Ethereum connection (`readThroughConnectionsOf`). A mined receipt
 * never changes, so it is never read again. `snapshotTxHash` is its starting
 * data; `event` is `undefined` until read.
 */
export const SnapshotEventGraph = define(
    readThroughConnectionsOf({
        snapshotTxHash: '',
        event: undefined as AsNodeData<SnapshotEvent> | undefined,
    })
);

/** The snapshot event's state: a node of the graph and its data. */
export type SnapshotEventState = StateUnion<typeof SnapshotEventGraph.nodes>;
