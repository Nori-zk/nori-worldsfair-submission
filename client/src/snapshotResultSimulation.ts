import { define, type StateUnion } from '@yaw-rx/ystate';
import { readThroughConnectionsOf } from '@nori-zk/nori-bridge-solana-sdk';
import { type AsNodeData } from '@nori-zk/nori-bridge-solana-sdk/utils';
import { type SnapshotResultRead } from './noriRead.js';
import { type SnapshotResultWitnessArgs } from './snapshotWitness.js';

/**
 * One snapshot result verified on Solana, through the Solana connection
 * (`readThroughConnectionsOf`): a simulation of nori-read-example's
 * `read_snapshot_result` with the result's witness (no signature, no fee).
 * `proofQueueBatchAddress`, `queryId` and `witness`, the batch, the query
 * and the witness it is made for, are its starting data. `read` is what the
 * program verified and `unitsConsumed` what it cost, both `undefined` until
 * read. A simulation of a committed batch never changes, so it is never read
 * again.
 */
export const SnapshotResultSimulationGraph = define(
    readThroughConnectionsOf({
        proofQueueBatchAddress: '',
        queryId: '',
        witness: {} as AsNodeData<SnapshotResultWitnessArgs>,
        read: undefined as AsNodeData<SnapshotResultRead> | undefined,
        unitsConsumed: undefined as bigint | undefined,
    })
);

/** The snapshot result simulation's state: a node of the graph and its data. */
export type SnapshotResultSimulationState = StateUnion<
    typeof SnapshotResultSimulationGraph.nodes
>;
