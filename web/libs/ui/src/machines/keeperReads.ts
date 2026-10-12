import { define, type StateUnion } from '@yaw-rx/ystate';
import { readThroughConnectionsOf } from '@nori-zk/nori-bridge-solana-sdk';
import { type KeeperRead } from '../utils/keeper-reads.js';

/**
 * The keeper's reads of the snapshots shown, on Solana: the successful
 * transactions found on both a guard the guard board holds and a shown
 * snapshot's batch account (`keeperReadsOf`), read through the Solana
 * connection (`readThroughConnectionsOf`). It reads again each time a
 * guard's last backing or pause read moves (`readMachineChanged$`) and each
 * time the batches shown change. `batches` are the batch accounts it read;
 * `reads` are empty until the first read.
 */
export const KeeperReadsGraph = define(
    readThroughConnectionsOf({
        batches: [] as string[],
        reads: [] as KeeperRead[],
    }),
);

/** The keeper reads' state: a node of the graph and its data. */
export type KeeperReadsState = StateUnion<typeof KeeperReadsGraph.nodes>;
