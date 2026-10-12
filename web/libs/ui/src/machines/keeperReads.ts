import { define, type StateUnion } from '@yaw-rx/ystate';
import { readThroughConnectionsOf } from '@nori-zk/nori-bridge-solana-sdk';
import { type SnapshotReadTransaction } from '@nori-zk/backstop-keeper/read';

/**
 * The keeper's reads of each snapshot on Solana: the successful transactions
 * on the guards the guard board holds whose memo names a snapshot
 * (`snapshotReadTransactionsOf`), read through the Solana connection
 * (`readThroughConnectionsOf`). It reads again each time a guard's last
 * backing or pause read moves (`readMachineChanged$`). `readBlocks` are the
 * guards it read, each as `<address>:<backing block>:<pause block>`;
 * `transactions` are empty until the first read.
 */
export const KeeperReadsGraph = define(
    readThroughConnectionsOf({
        readBlocks: [] as string[],
        transactions: [] as SnapshotReadTransaction[],
    }),
);

/** The keeper reads' state: a node of the graph and its data. */
export type KeeperReadsState = StateUnion<typeof KeeperReadsGraph.nodes>;
