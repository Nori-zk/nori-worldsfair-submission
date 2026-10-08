import { define, type StateUnion } from '@yaw-rx/ystate';
import type {
    ConnectionName,
    EnqueuedProofRequest,
    ProofQueueBatchSummary,
} from '@nori-zk/nori-bridge-solana-sdk';

/** A committed batch, with the filtered contract's request ids in it when there is a filter. */
export interface ShownBatch extends ProofQueueBatchSummary {
    /** The filtered contract's request ids in this batch; every request when there is no filter. */
    matching: bigint[] | undefined;
}

/** What the dashboard shows: the newest batches and the requests still waiting. */
export interface BatchesView {
    /** How many batches the Nori program holds. */
    batchCount: bigint;
    /** The first request id no batch covers yet. */
    queueCursor: bigint;
    /** The newest batches, newest first; with a filter, only those holding its requests. */
    batches: ShownBatch[];
    /** The requests no batch covers yet, oldest first; with a filter, only its own. */
    waiting: EnqueuedProofRequest[];
    /** Ethereum's finalized block, which a waiting request must be at or below to be proven. */
    finalizedBlock: number;
    /** Ethereum's latest block when the view was read. */
    latestBlock: number;
}

/** The view before the first read. */
export const EMPTY_VIEW: BatchesView = {
    batchCount: 0n,
    queueCursor: 0n,
    batches: [],
    waiting: [],
    finalizedBlock: 0,
    latestBlock: 0,
};

/**
 * The bridge's newest batches and the requests still waiting, for every
 * contract or one (`target`, from `?target=`). No node is a dead end.
 *
 * - `loading` reads the view: the Nori program's state on Solana, then the
 *   newest ten batches (or, with a filter, the contract's requests from
 *   Ethereum newest first, mapped to their batches until ten are found),
 *   the requests no batch covers yet, and Ethereum's finalized block.
 * - `watching` shows the view until a refresh is due: every 15 s, and on
 *   every stage Nori reports over its websocket.
 * - `refreshing` reads the view again and keeps showing the last one.
 * - A connection that is not ready is `waitingForConnection`, naming it in
 *   `waitingOn`, and reads again once both chains are ready.
 * - Any other failure is `failed`, which reads again by itself after a wait
 *   that doubles with each failed read in a row (`failedReads`), or at once
 *   on `retry`.
 */
export const BridgeBatchesGraph = define({
    nodes: {
        loading: { target: '', view: EMPTY_VIEW, failedReads: 0 },
        watching: { target: '', view: EMPTY_VIEW },
        refreshing: { target: '', view: EMPTY_VIEW, failedReads: 0 },
        waitingForConnection: {
            target: '',
            view: EMPTY_VIEW,
            failedReads: 0,
            waitingOn: [] as ConnectionName[],
        },
        failed: { target: '', view: EMPTY_VIEW, failedReads: 0, error: '' },
    },
    edges: {
        loaded: { from: 'loading', to: 'watching', on: 'viewArrived.next' },
        connectionLostWhileLoading: {
            from: 'loading',
            to: 'waitingForConnection',
            on: 'connectionLost.next',
        },
        loadFailed: { from: 'loading', to: 'failed', on: 'readFailed.next' },

        refreshDue: { from: 'watching', to: 'refreshing', on: 'refreshDue.next' },
        refreshed: { from: 'refreshing', to: 'watching', on: 'viewArrived.next' },
        connectionLost: {
            from: 'refreshing',
            to: 'waitingForConnection',
            on: 'connectionLost.next',
        },
        refreshFailed: { from: 'refreshing', to: 'failed', on: 'readFailed.next' },

        connectionsChanged: {
            from: 'waitingForConnection',
            to: 'waitingForConnection',
            on: 'connectionsChanged.next',
        },
        connectionRestored: {
            from: 'waitingForConnection',
            to: 'refreshing',
            on: 'connectionRestored.next',
        },
        retryStarted: { from: 'failed', to: 'refreshing', on: 'retryDue.next' },
        retried: { from: 'failed', to: 'refreshing', on: 'retry.next' },
    },
});

/** The dashboard's batches: a node of the graph and its data. */
export type BridgeBatchesState = StateUnion<typeof BridgeBatchesGraph.nodes>;
