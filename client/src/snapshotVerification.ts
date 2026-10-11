import { define, type StateUnion } from '@yaw-rx/ystate';
import { type AsNodeData } from '@nori-zk/nori-bridge-solana-sdk/utils';
import { type SnapshotResultRead } from './noriRead.js';

/** The result it verifies: the snapshot transaction and the query. */
const made = {
    /** The transaction that called `NoriSnapshot.snapshot`. */
    snapshotTxHash: '',
    /** The query whose result is verified. */
    queryId: '',
};

/** The batch on Solana that covers the snapshot's proof request. */
const provenIn = {
    ...made,
    proofQueueBatchIndex: 0n as bigint,
    /** The batch account, base58. */
    proofQueueBatchAddress: '',
};

/**
 * One snapshot result, from the snapshot transaction until it is verified on
 * Solana. `snapshotTxHash` and `queryId`, the result it verifies, are its
 * starting data. It gates on the proven request machine
 * (`createProvenRequestMachine`), which its creator owns; on entry into
 * `simulating` it makes the snapshot event machine
 * (`createSnapshotEventMachine`) and then the snapshot result simulation
 * machine (`createSnapshotResultSimulationMachine`), both closed when it
 * leaves `simulating`.
 *
 * - `findingRequest`: the snapshot's proof request is being looked up.
 * - `waitingForProof`: it is looked up and no committed batch covers it yet.
 * - Once proven (`proven`, from either), `simulating` holds the batch while
 *   the result's witness is built from the snapshot's event and
 *   `read_snapshot_result` is simulated; the event and simulation machines
 *   wait for their chain and read again by themselves.
 * - `readFailed`: reading the event or simulating failed. It goes back to
 *   `simulating` once the read is running again, by itself after a wait or
 *   at once on `retry()`; the machines it made carry on across both.
 * - `verified` holds the batch and what the program verified (`read`) and
 *   what it cost (`unitsConsumed`). It is terminal: a committed batch never
 *   changes.
 * - The snapshot transaction can end without enqueuing its proof request:
 *   `transactionReplaced` or `transactionDropped`, both terminal.
 * - `closed` is terminal.
 */
export const SnapshotVerificationGraph = define({
    nodes: {
        findingRequest: { ...made },
        waitingForProof: { ...made },
        transactionReplaced: { ...made },
        transactionDropped: { ...made },
        simulating: { ...provenIn },
        readFailed: {
            ...provenIn,
            /** Why reading the event or simulating failed. */
            error: '',
        },
        verified: {
            ...provenIn,
            read: {} as AsNodeData<SnapshotResultRead>,
            unitsConsumed: 0n as bigint,
        },
        closed: {},
    },
    edges: {
        requestFound: {
            from: 'findingRequest',
            to: 'waitingForProof',
            on: 'requestFound.next',
        },
        provenAtLookUp: {
            from: 'findingRequest',
            to: 'simulating',
            on: 'proven.next',
        },
        proven: {
            from: 'waitingForProof',
            to: 'simulating',
            on: 'proven.next',
        },
        simulated: { from: 'simulating', to: 'verified', on: 'simulated.next' },
        readErrored: {
            from: 'simulating',
            to: 'readFailed',
            on: 'readFailed.next',
        },
        readingAgain: {
            from: 'readFailed',
            to: 'simulating',
            on: 'readingAgain.next',
        },
        closedWhileReadFailed: {
            from: 'readFailed',
            to: 'closed',
            on: 'close.next',
        },
        replacedAtLookUp: {
            from: 'findingRequest',
            to: 'transactionReplaced',
            on: 'transactionReplaced.next',
        },
        replaced: {
            from: 'waitingForProof',
            to: 'transactionReplaced',
            on: 'transactionReplaced.next',
        },
        droppedAtLookUp: {
            from: 'findingRequest',
            to: 'transactionDropped',
            on: 'transactionDropped.next',
        },
        dropped: {
            from: 'waitingForProof',
            to: 'transactionDropped',
            on: 'transactionDropped.next',
        },
        closedWhileFindingRequest: {
            from: 'findingRequest',
            to: 'closed',
            on: 'close.next',
        },
        closedWhileWaitingForProof: {
            from: 'waitingForProof',
            to: 'closed',
            on: 'close.next',
        },
        closedWhileSimulating: {
            from: 'simulating',
            to: 'closed',
            on: 'close.next',
        },
    },
});

/** The snapshot verification's state: a node of the graph and its data. */
export type SnapshotVerificationState = StateUnion<
    typeof SnapshotVerificationGraph.nodes
>;
