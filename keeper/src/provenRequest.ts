import { define, type StateUnion } from '@yaw-rx/ystate';
import {
    type ProofAvailableProofRequestSnapshot,
    type RequestWitness,
    type VerifiedRequestWitness,
} from '@nori-zk/nori-bridge-solana-sdk';

/**
 * One proof request until Nori has proven its batch, with the request's
 * witness in it. It gates on the proof request machine
 * (`createProofRequestStateMachine`), which its creator owns, and on the
 * witness machine (`createProofRequestWitnessMachine`), made from the batch
 * `readingWitness` holds and closed when it leaves `readingWitness`.
 *
 * - `findingRequest`: the proof request is being looked up from the
 *   transaction that enqueued it.
 * - `waitingForProof`: the request is looked up and no committed batch
 *   covers it yet.
 * - Once a committed batch covers it (`proofAvailable`, from either),
 *   `readingWitness` holds that batch while the request's witness in it is
 *   read.
 * - `proven` holds the batch the request is in and its witness, as its leaf,
 *   path and root and in the shape the program takes (`witnessRead`). It is
 *   terminal: batches are append-only.
 * - The transaction that would enqueue it can end without enqueuing it:
 *   `transactionReplaced` (another transaction took its nonce) or
 *   `transactionDropped` (the node lost it). Both are terminal.
 * - `closed` is terminal.
 */
export const ProvenRequestGraph = define({
    nodes: {
        findingRequest: {},
        waitingForProof: {},
        transactionReplaced: {},
        transactionDropped: {},
        readingWitness: {
            proofAvailable: {} as ProofAvailableProofRequestSnapshot,
        },
        proven: {
            proofAvailable: {} as ProofAvailableProofRequestSnapshot,
            witness: {} as RequestWitness,
            verifiedWitness: {} as VerifiedRequestWitness,
        },
        closed: {},
    },
    edges: {
        requestFound: {
            from: 'findingRequest',
            to: 'waitingForProof',
            on: 'requestFound.next',
        },
        proofAvailableAtLookUp: {
            from: 'findingRequest',
            to: 'readingWitness',
            on: 'proofAvailable.next',
        },
        proofAvailable: {
            from: 'waitingForProof',
            to: 'readingWitness',
            on: 'proofAvailable.next',
        },
        witnessRead: {
            from: 'readingWitness',
            to: 'proven',
            on: 'witnessRead.next',
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
        closedWhileReadingWitness: {
            from: 'readingWitness',
            to: 'closed',
            on: 'close.next',
        },
    },
});

/** The proven request's state: a node of the graph and its data. */
export type ProvenRequestState = StateUnion<typeof ProvenRequestGraph.nodes>;
