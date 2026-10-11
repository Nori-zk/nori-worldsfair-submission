import { define, type StateUnion } from '@yaw-rx/ystate';
import { type RequestWitness } from '@nori-zk/nori-bridge-solana-sdk';
import { type AsNodeData } from '@nori-zk/nori-bridge-solana-sdk/utils';
import { type SnapshotEvent } from '../snapshotWitness.js';

/** How one guard read ended. */
export type SubmittedReadOutcome = {
    /** `<guard name> backing` or `<guard name> pause`. */
    read: string;
    /** `confirmed`, `reverted`, or the Backstop error that refused it (e.g. `ReadNotNewer`). */
    outcome: string;
};

/** The snapshot transaction it follows. */
const made = {
    /** The transaction that called `NoriSnapshot.snapshot`. */
    snapshotTxHash: '',
};

/** The batch on Solana that covers the snapshot's proof request, and the request's witness in it. */
const provenIn = {
    ...made,
    /** The batch account, base58. */
    proofQueueBatchAddress: '',
    witness: {} as AsNodeData<RequestWitness>,
};

/**
 * One snapshot transaction the keeper sent, until every guard's reads of it
 * are submitted to the Backstop. `snapshotTxHash` is its starting data. It
 * gates on the proven request machine (`createProvenRequestMachine`) and
 * the snapshot event machine (`createSnapshotEventMachine`), which it makes
 * from the snapshot transaction, and on one Solana signer transaction
 * machine per read (`createSolanaSignerTransactionMachine`), made on entry
 * into `submitting`.
 *
 * - `findingRequest`: the snapshot's proof request is being looked up.
 * - `waitingForProof`: it is looked up and no committed batch covers it yet.
 * - Once proven (`proven`, from either), `readingEvent` holds the batch and
 *   the witness while the snapshot's `Snapshot` event is read.
 * - `submitting` holds the event too while each guard's backing and pause
 *   reads are sent with the keeper's signer. A read that failed to send or
 *   expired is sent again by the keeper.
 * - `submitted` holds how each read ended, once each is confirmed,
 *   reverted or refused by the Backstop. It is terminal: the snapshot is no
 *   longer pending.
 * - The snapshot transaction can end without enqueuing its proof request:
 *   `transactionReplaced` or `transactionDropped`, both terminal.
 * - `closed` is terminal.
 */
export const SnapshotSubmissionGraph = define({
    nodes: {
        findingRequest: { ...made },
        waitingForProof: { ...made },
        transactionReplaced: { ...made },
        transactionDropped: { ...made },
        readingEvent: { ...provenIn },
        submitting: { ...provenIn, event: {} as AsNodeData<SnapshotEvent> },
        submitted: {
            ...made,
            proofQueueBatchAddress: '',
            outcomes: [] as SubmittedReadOutcome[],
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
            to: 'readingEvent',
            on: 'proven.next',
        },
        proven: {
            from: 'waitingForProof',
            to: 'readingEvent',
            on: 'proven.next',
        },
        eventRead: {
            from: 'readingEvent',
            to: 'submitting',
            on: 'eventRead.next',
        },
        readsSubmitted: {
            from: 'submitting',
            to: 'submitted',
            on: 'readsSubmitted.next',
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
        closedWhileReadingEvent: {
            from: 'readingEvent',
            to: 'closed',
            on: 'close.next',
        },
        closedWhileSubmitting: {
            from: 'submitting',
            to: 'closed',
            on: 'close.next',
        },
    },
});

/** The snapshot submission's state: a node of the graph and its data. */
export type SnapshotSubmissionState = StateUnion<
    typeof SnapshotSubmissionGraph.nodes
>;
