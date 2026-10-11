import { define, type StateUnion } from '@yaw-rx/ystate';
import { readThroughConnectionsOf } from '@nori-zk/nori-bridge-solana-sdk';

/** When and in which transaction a proof queue batch landed on Solana. */
export interface BatchLandingRead {
    /** The batch's index. */
    proofQueueBatchIndex: bigint;
    /** The block time of the transaction that created it, unix seconds. */
    atSecs: number;
    /** That transaction's signature, base58. */
    signature: string;
}

/**
 * When each of the proof queue batches the batches machine holds landed on
 * Solana, read through the Solana connection (`readThroughConnectionsOf`):
 * the signatures of each batch account and of the Nori program, matched by
 * `landingOf`. It reads again each time the batches machine's batches
 * change (`readMachineChanged$`). `batchIndices` are the batches it read,
 * newest first; `landings` is in the same order, and a batch whose landing
 * is not found has none. A landing never changes, so one already held is
 * kept and never read again.
 */
export const BatchLandingsGraph = define(
    readThroughConnectionsOf({ batchIndices: [] as bigint[], landings: [] as BatchLandingRead[] }),
);

/** The batch landings' state: a node of the graph and its data. */
export type BatchLandingsState = StateUnion<typeof BatchLandingsGraph.nodes>;
