import {
    catchError,
    defer,
    distinctUntilChanged,
    filter,
    map,
    merge,
    type Observable,
    of,
    ReplaySubject,
    share,
    Subject,
    switchMap,
    timer,
} from 'rxjs';
import {
    bothReady$,
    ConnectionNotReadyError,
    type ConnectionName,
    type Connections,
    getBridgeState,
    getEnqueuedProofRequests,
    getFinalizedBlockNumber,
    getLatestBlockHeight,
    getNoriBridgeInfraState$,
    getProofQueueBatchesForRequests,
    getProofQueueBatchSummaries,
    getProofRequestsByTarget,
    type ProofRequestHistoryAddresses,
    waitingOnChanged$,
} from '@nori-zk/nori-bridge-solana-sdk';
import { dataOnEntry$, type StartedMachine, stateOf$ } from '@nori-zk/nori-bridge-solana-sdk/utils';
import {
    type BatchesView,
    type ShownBatch,
    BridgeBatchesGraph,
    type BridgeBatchesState,
    EMPTY_VIEW,
} from './bridge-batches.js';

/** How many batches the dashboard shows. */
const BATCH_COUNT = 10;
/** Requests read per page while finding a contract's batches. */
const TARGET_PAGE_SIZE = 100;
/** How often the view is read again while nothing else asks for it. */
const REFRESH_MS = 15_000;
/** The wait before reading again after the first failed read; it doubles with each one after it. */
const RETRY_INITIAL_MS = 1000;
/** The longest wait between reads after failures. */
const RETRY_MAX_MS = 30_000;

/** Where the dashboard reads from: the queue, the program and the queue's deploy block. */
export interface BatchesAddresses extends ProofRequestHistoryAddresses {
    /** The first block to read proof requests from. */
    proofQueueDeployBlock: number;
}

/** How reading the view ended. */
type ReadOutcome =
    | { outcome: 'succeeded'; view: BatchesView }
    | { outcome: 'connectionLost'; waitingOn: ConnectionName[] }
    | { outcome: 'failed'; error: string };

/**
 * The indices of the newest batches, newest first.
 *
 * @param batchCount How many batches the program holds.
 * @returns Up to `BATCH_COUNT` indices.
 */
const newestIndices = (batchCount: bigint): bigint[] =>
    Array.from(
        { length: Number(batchCount < BigInt(BATCH_COUNT) ? batchCount : BigInt(BATCH_COUNT)) },
        (_, i) => batchCount - 1n - BigInt(i),
    );

/**
 * The batches holding a contract's newest proven requests, newest first,
 * each with the contract's request ids in it. Reads the contract's requests
 * from Ethereum newest first, a page at a time, until `BATCH_COUNT` batches
 * are found or none are left.
 *
 * @param connections The Ethereum and Solana chains.
 * @param addresses The queue, program and deploy block.
 * @param target The contract.
 * @param queueCursor The first request id no batch covers yet.
 * @param batchCount How many batches the program holds.
 * @returns Each batch's index and the contract's request ids in it.
 */
async function targetBatches(
    connections: Connections,
    addresses: BatchesAddresses,
    target: string,
    queueCursor: bigint,
    batchCount: bigint,
): Promise<Map<bigint, bigint[]>> {
    const byBatch = new Map<bigint, bigint[]>();
    let after;
    for (;;) {
        const page = await getProofRequestsByTarget(
            connections.ethereum,
            addresses.proofQueueAddress,
            {
                target,
                fromBlock: addresses.proofQueueDeployBlock,
                order: 'desc',
                pageSize: TARGET_PAGE_SIZE,
                after,
            },
        );
        const proven = page.requests
            .map(({ requestId }) => requestId)
            .filter((requestId) => requestId < queueCursor);
        const found = await getProofQueueBatchesForRequests(
            connections.solana,
            proven,
            batchCount,
            addresses.programAddress,
        );
        for (const requestId of proven) {
            const index = found.get(requestId)?.proofQueueBatchIndex;
            if (index === undefined) continue;
            const ids = byBatch.get(index);
            if (ids) ids.push(requestId);
            else if (byBatch.size < BATCH_COUNT) byBatch.set(index, [requestId]);
        }
        if (byBatch.size >= BATCH_COUNT || page.done) return byBatch;
        after = page.cursor;
    }
}

/**
 * Reads the view: the newest batches (all of them, or the contract's), the
 * requests no batch covers yet, and Ethereum's finalized block.
 *
 * @param connections The Ethereum and Solana chains.
 * @param addresses The queue, program and deploy block.
 * @param target The contract to show, or `''` for every contract.
 * @returns The view.
 */
async function readView(
    connections: Connections,
    addresses: BatchesAddresses,
    target: string,
): Promise<BatchesView> {
    const { ethereum, solana } = connections;
    const state = await getBridgeState(solana, addresses.programAddress);
    const { queueCursor, proofQueueBatchCount: batchCount } = state;

    const matching =
        target === ''
            ? undefined
            : await targetBatches(connections, addresses, target, queueCursor, batchCount);
    const indices = matching
        ? [...matching.keys()].sort((a, b) => (a < b ? 1 : -1))
        : newestIndices(batchCount);
    const newest = batchCount > 0n ? [batchCount - 1n] : [];
    const summaries = await getProofQueueBatchSummaries(
        solana,
        [...new Set([...newest, ...indices])],
        addresses.programAddress,
    );
    const byIndex = new Map(summaries.map((summary) => [summary.proofQueueBatchIndex, summary]));
    const batches = indices.flatMap((index): ShownBatch[] => {
        const summary = byIndex.get(index);
        return summary ? [{ ...summary, matching: matching?.get(index) }] : [];
    });

    const latestBlock = await getLatestBlockHeight(ethereum);
    const newestSummary = newest.length > 0 ? byIndex.get(newest[0]) : undefined;
    const waiting = await getEnqueuedProofRequests(ethereum, addresses.proofQueueAddress, {
        fromBlock: newestSummary
            ? Number(newestSummary.outputBlockNumber) + 1
            : addresses.proofQueueDeployBlock,
        toBlock: latestBlock,
        fromRequestId: queueCursor,
        ...(target === '' ? {} : { target }),
    });
    const finalizedBlock = await getFinalizedBlockNumber(ethereum);
    return { batchCount, queueCursor, batches, waiting, finalizedBlock, latestBlock };
}

/**
 * Reads the view once. A connection that is not ready is a lost
 * connection, naming the chains; any other failure is the read's own.
 *
 * @param connections The Ethereum and Solana chains.
 * @param addresses The queue, program and deploy block.
 * @param target The contract to show, or `''` for every contract.
 * @returns How the read ended, once.
 */
function readView$(
    connections: Connections,
    addresses: BatchesAddresses,
    target: string,
): Observable<ReadOutcome> {
    return defer(async () => readView(connections, addresses, target)).pipe(
        map((view): ReadOutcome => ({ outcome: 'succeeded', view })),
        catchError((error: unknown) =>
            of<ReadOutcome>(
                error instanceof ConnectionNotReadyError
                    ? {
                          outcome: 'connectionLost',
                          waitingOn: [
                              ...new Set(
                                  error.notReady.map(
                                      ({ transport }) => transport.split('.')[0] as ConnectionName,
                                  ),
                              ),
                          ],
                      }
                    : {
                          outcome: 'failed',
                          error: error instanceof Error ? error.message : String(error),
                      },
            ),
        ),
    );
}

/**
 * Keeps only the reads with one outcome, narrowed to it.
 *
 * @param read$ Reads.
 * @param outcome The outcome to keep.
 * @returns The reads with that outcome.
 */
function withOutcome<TOutcome extends ReadOutcome['outcome']>(
    read$: Observable<ReadOutcome>,
    outcome: TOutcome,
): Observable<Extract<ReadOutcome, { outcome: TOutcome }>> {
    return read$.pipe(
        filter(
            (read): read is Extract<ReadOutcome, { outcome: TOutcome }> => read.outcome === outcome,
        ),
    );
}

/**
 * Starts the batches machine at `loading` for one contract, or every one.
 *
 * @param connections The Ethereum and Solana chains, and Nori's websocket.
 * @param addresses The queue, program and deploy block.
 * @param target The contract to show, or `''` for every contract.
 * @returns
 *   - `bridgeBatches`: the running machine.
 *   - `retry()`: reads again after a failed read.
 */
export function createBridgeBatchesMachine(
    connections: Connections,
    addresses: BatchesAddresses,
    target: string,
): { bridgeBatches: StartedMachine<BridgeBatchesState> & { stop: () => void }; retry: () => void } {
    const retry$ = new Subject<void>();
    const started$ = new ReplaySubject<StartedMachine<BridgeBatchesState>>(1);
    const state$ = stateOf$(started$);

    // The outcome edges of `loading` and `refreshing` share one read per entry.
    const read$ = state$.pipe(
        filter((state) => state.node === 'loading' || state.node === 'refreshing'),
        switchMap(() => readView$(connections, addresses, target)),
        share(),
    );
    const stageChanged$ = getNoriBridgeInfraState$(connections.nori).pipe(
        map((state) => state.stage_name),
        distinctUntilChanged(),
    );

    const machine = BridgeBatchesGraph.implement({
        viewArrived: {
            $: () => withOutcome(read$, 'succeeded'),
            next: ({ view }) => ({ target, view }),
        },
        connectionLost: {
            $: () => withOutcome(read$, 'connectionLost'),
            next: ({ waitingOn }, _dest, { view, failedReads }) => ({
                target,
                view,
                failedReads,
                waitingOn,
            }),
        },
        readFailed: {
            $: () => withOutcome(read$, 'failed'),
            next: ({ error }, _dest, { view, failedReads }) => ({
                target,
                view,
                error,
                failedReads: failedReads + 1,
            }),
        },
        refreshDue: {
            $: () =>
                dataOnEntry$(state$, 'watching').pipe(
                    switchMap(() => merge(timer(REFRESH_MS), stageChanged$)),
                ),
            next: (_due, _dest, { view }) => ({ target, view, failedReads: 0 }),
        },
        connectionsChanged: {
            $: () => waitingOnChanged$(connections),
            next: (waitingOn, _dest, { view, failedReads }) => ({
                target,
                view,
                failedReads,
                waitingOn,
            }),
        },
        connectionRestored: {
            $: () => bothReady$(connections),
            next: (_restored, _dest, { view, failedReads }) => ({ target, view, failedReads }),
        },
        retryDue: {
            $: () =>
                dataOnEntry$(state$, 'failed').pipe(
                    switchMap(({ failedReads }) =>
                        timer(Math.min(RETRY_INITIAL_MS * 2 ** (failedReads - 1), RETRY_MAX_MS)),
                    ),
                ),
            next: (_due, _dest, { view, failedReads }) => ({ target, view, failedReads }),
        },
        retry: {
            $: () => retry$,
            next: (_retry, _dest, { view, failedReads }) => ({ target, view, failedReads }),
        },
    });

    const bridgeBatches = machine.close().start('loading', undefined, {
        loading: { target, view: EMPTY_VIEW, failedReads: 0 },
    });
    started$.next(bridgeBatches);

    return { bridgeBatches, retry: () => retry$.next() };
}
