import {
    catchError,
    concat,
    concatMap,
    from,
    map,
    type Observable,
    of,
    reduce,
    switchMap,
} from 'rxjs';
import { address, type Address } from '@solana/kit';
import {
    type createProofQueueBatchesMachine,
    type ProofQueueBatchSummary,
    type ProofRequestConnections,
    readMachineChanged$,
    readMachineValue$,
    type ReadRetryBackoff,
    type SolanaRpc,
    solanaRpcRead$,
    startReadThroughConnectionsMachine,
} from '@nori-zk/nori-bridge-solana-sdk';
import { landingOf } from '../utils/batch-landing.js';
import { type BatchLandingRead, BatchLandingsGraph } from './batchLandings.js';

/** How many Nori program signatures one read covers: about 4 days of updates. */
const NORI_SIGNATURES = 1000;

/** How long one signature read may take: the cluster's requests have no timeout of their own. */
const READ_TIMEOUT_MS = 20_000;

/**
 * An abort signal for one signature read: the read's own, or the timeout.
 *
 * @param abortSignal The read's signal.
 * @returns The signal that aborts the request.
 */
const withTimeout = (abortSignal: AbortSignal): AbortSignal =>
    AbortSignal.any([abortSignal, AbortSignal.timeout(READ_TIMEOUT_MS)]);

/**
 * The landings of some batches: one read of the Nori program's signatures,
 * then one per batch, one at a time (public devnet allows about 40 per 10 s
 * per method).
 *
 * shortcut: a Nori `mint` naming batch N would also match; there are none on
 * this deployment.
 *
 * @param rpc The Solana RPC.
 * @param programAddress The Nori Solana bridge program address.
 * @param batches The batches.
 * @returns The landings found, in the batches' order, once.
 */
const landings$ = (
    rpc: SolanaRpc,
    programAddress: Address,
    batches: ProofQueueBatchSummary[],
): Observable<BatchLandingRead[]> =>
    solanaRpcRead$(
        async (abortSignal) =>
            rpc
                .getSignaturesForAddress(programAddress, { limit: NORI_SIGNATURES })
                .send({ abortSignal: withTimeout(abortSignal) }),
        "Failed to read the Nori program's signatures.",
    ).pipe(
        map(
            (program) =>
                new Set(
                    program.filter(({ err }) => err === null).map(({ signature }) => signature),
                ),
        ),
        switchMap((nori) =>
            from(batches).pipe(
                concatMap(({ proofQueueBatchIndex, proofQueueBatchAddress }) =>
                    solanaRpcRead$(
                        async (abortSignal) =>
                            rpc
                                .getSignaturesForAddress(address(proofQueueBatchAddress))
                                .send({ abortSignal: withTimeout(abortSignal) }),
                        `Failed to read batch ${proofQueueBatchIndex}'s signatures.`,
                    ).pipe(
                        map((signatures): BatchLandingRead[] => {
                            const landing = landingOf(signatures, nori);
                            return landing ? [{ proofQueueBatchIndex, ...landing }] : [];
                        }),
                    ),
                ),
                reduce((found: BatchLandingRead[], landing) => [...found, ...landing], []),
            ),
        ),
    );

/**
 * Whether two runs of batch indices are the same, in the same order.
 *
 * @param batches The batches the batches machine holds.
 * @param batchIndices The batch indices read.
 * @returns Whether they match.
 */
const sameBatches = (batches: ProofQueueBatchSummary[], batchIndices: bigint[]): boolean =>
    batches.length === batchIndices.length &&
    batches.every(({ proofQueueBatchIndex }, i) => proofQueueBatchIndex === batchIndices[i]);

/** The running batch landings machine, with its controls. */
export type BatchLandingsMachine = ReturnType<
    typeof startReadThroughConnectionsMachine<
        typeof BatchLandingsGraph.nodes,
        typeof BatchLandingsGraph.edges
    >
>;

/**
 * Starts reading when each of the batches the batches machine holds landed
 * on Solana, through the Solana connection, and reading again each time its
 * batches change. A batch account holds no time, so its landing is the
 * transaction that created it (`landingOf`), read from the batch PDA's
 * signatures and checked against the Nori program's. A landing already held
 * is kept.
 *
 * @param connections The Ethereum and Solana chains, with their running connectivity machines.
 * @param programAddress The Nori Solana bridge program address.
 * @param batches The running batches machine, from `createProofQueueBatchesMachine`, which its creator owns.
 * @param backoff How long a failed read waits before reading again.
 * @returns The running machine; `current` carries the landings. Its controls:
 *   - `retry()`: reads again now, without waiting, while failed.
 *   - `close()`: moves the machine to `closed`.
 */
export const createBatchLandingsMachine = (
    connections: ProofRequestConnections,
    programAddress: Address,
    batches: ReturnType<typeof createProofQueueBatchesMachine>,
    backoff: ReadRetryBackoff = {},
): BatchLandingsMachine =>
    startReadThroughConnectionsMachine(BatchLandingsGraph, {
        connections,
        read: (clients, previous) =>
            readMachineValue$(batches).pipe(
                switchMap(({ view }) => {
                    const held = new Map(
                        previous.landings.map((landing) => [landing.proofQueueBatchIndex, landing]),
                    );
                    const batchIndices = view.batches.map(
                        ({ proofQueueBatchIndex }) => proofQueueBatchIndex,
                    );
                    const unread = view.batches.filter(
                        ({ proofQueueBatchIndex }) => !held.has(proofQueueBatchIndex),
                    );
                    return (
                        unread.length === 0
                            ? of([])
                            : clients.solana((rpc) => landings$(rpc, programAddress, unread))
                    ).pipe(
                        map((found) => {
                            for (const landing of found)
                                held.set(landing.proofQueueBatchIndex, landing);
                            return {
                                batchIndices,
                                landings: batchIndices.flatMap((index) => held.get(index) ?? []),
                            };
                        }),
                    );
                }),
            ),
        // Following once the batches machine holds its batches (or failed, which fails the read):
        // the landings wait in `loading` until then. A refresh is due when its batches move on.
        refreshOn: ({ batchIndices }) =>
            concat(
                readMachineValue$(batches).pipe(
                    map((): void => undefined),
                    catchError(() => of(undefined)),
                ),
                readMachineChanged$(
                    batches,
                    ({ view }) => !sameBatches(view.batches, batchIndices),
                ),
            ),
        needs: ['solana'],
        backoff,
    });
