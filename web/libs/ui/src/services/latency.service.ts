import { Injectable } from '@yaw-rx/core';
import {
    catchError,
    concat,
    defer,
    map,
    Observable,
    of,
    shareReplay,
    startWith,
    Subject,
    switchMap,
} from 'rxjs';
import { ConnectionsService } from './connections.service.js';
import {
    bothReady$,
    getBridgeState,
    getEnqueuedProofRequests,
    getProofQueueBatchSummaries,
    type EnqueuedProofRequest,
    type ProofQueueBatchSummary,
} from '@nori-zk/nori-bridge-solana-sdk';
import { BatchTimesService, type BatchLanding } from './batch-times.service.js';

/** How many batches the tab reads, newest first. */
const BATCH_COUNT = 30;

/** One read of the tab: the newest batches, their NoriSnapshot requests, and when each batch landed. */
export interface Latency {
    /** The newest batches, newest first. */
    batches: ProofQueueBatchSummary[];
    /** The NoriSnapshot requests over the batches' Ethereum blocks, oldest first. */
    requests: EnqueuedProofRequest[];
    /** Each batch's landing by index; `undefined` while they are read. */
    landings: Map<bigint, BatchLanding> | undefined;
}

/**
 * The newest batch indices, newest first, as `bridge-batches.impl.ts` picks them.
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
 * The latency tab's read: once when the tab opens, as soon as both chains
 * can serve it, and again on each `readAgain()`, with no timer, as a batch
 * lands every 20–35 min. Each read emits `undefined` first, then the batches
 * and their requests, then the same with the landings; or why reading failed.
 */
@Injectable([ConnectionsService, BatchTimesService])
export class LatencyService {
    readonly latency$: Observable<Latency | string | undefined>;
    private readonly refresh = new Subject<void>();

    /**
     * @param connections The connections: batches from Solana, requests from Ethereum.
     * @param batchTimes When each batch landed, kept across reads.
     */
    constructor(connections: ConnectionsService, batchTimes: BatchTimesService) {
        const { ethereum, solana } = connections.connections;
        const programAddress = NORI_WEB_ENV.solana.programAddress;
        const read = async (): Promise<Latency> => {
            const { proofQueueBatchCount } = await getBridgeState(solana, programAddress);
            const batches = await getProofQueueBatchSummaries(
                solana,
                newestIndices(proofQueueBatchCount),
                programAddress,
            );
            const newest = batches[0];
            const oldest = batches[batches.length - 1];
            if (newest === undefined || oldest === undefined) {
                return { batches, requests: [], landings: undefined };
            }
            // One read over every batch's blocks; the sdk splits it at 2,000 blocks.
            const requests = await getEnqueuedProofRequests(
                ethereum,
                NORI_WEB_ENV.ethereum.proofQueueAddress,
                {
                    fromBlock:
                        oldest.previousOutputBlockNumber < 0n
                            ? NORI_WEB_ENV.ethereum.proofQueueDeployBlock
                            : Number(oldest.previousOutputBlockNumber) + 1,
                    toBlock: Number(newest.outputBlockNumber),
                    target: NORI_WEB_ENV.ethereum.snapshotAddress,
                },
            );
            return { batches, requests, landings: undefined };
        };
        // Closing the tab stops the landing reads still to come.
        const landingsOf = (
            batches: ProofQueueBatchSummary[],
        ): Observable<Map<bigint, BatchLanding>> =>
            new Observable((subscriber) => {
                const abort = new AbortController();
                batchTimes.landings(batches, abort.signal).then(
                    (landings) => {
                        subscriber.next(landings);
                        subscriber.complete();
                    },
                    (error: unknown) => {
                        subscriber.error(error);
                    },
                );
                return () => {
                    abort.abort();
                };
            });
        // The rows first, then again once the landings are read.
        const readWithLandings = (): Observable<Latency> =>
            defer(read).pipe(
                switchMap((latency) =>
                    concat(
                        of(latency),
                        landingsOf(latency.batches).pipe(
                            map((landings) => ({ ...latency, landings })),
                        ),
                    ),
                ),
            );
        // The read needs both chains: wait until both can serve it, once.
        this.latency$ = bothReady$(connections.connections).pipe(
            switchMap(() => this.refresh.pipe(startWith(undefined))),
            switchMap(() =>
                readWithLandings().pipe(
                    catchError((error: unknown) =>
                        of(error instanceof Error ? error.message : String(error)),
                    ),
                    startWith(undefined),
                ),
            ),
            startWith(undefined),
            shareReplay({ bufferSize: 1, refCount: true }),
        );
    }

    /** Reads the batches, their requests and landings again. */
    readAgain(): void {
        this.refresh.next();
    }
}
