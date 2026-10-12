import { Injectable } from '@yaw-rx/core';
import {
    combineLatest,
    distinctUntilChanged,
    filter,
    map,
    Observable,
    of,
    shareReplay,
    startWith,
    switchMap,
    take,
} from 'rxjs';
import {
    createProofRequestBlockTimeMachine,
    createProofRequestStateMachine,
    createUnprocessedProofRequestStateMachine,
    ProofRequestState,
    type ProofRequestStateNodeUnion,
    type UnprocessedProofRequestStateNodeUnion,
} from '@nori-zk/nori-bridge-solana-sdk';
import { followedStates$ } from '@nori-zk/backstop-keeper/read';
import { ConnectionsService } from './connections.service.js';
import { NoriBridgeInfraService } from './nori-bridge-infra.service.js';
import {
    anchoredTotal,
    followAgainOnReplaced,
    storedTotal,
    waitedSec,
} from '../utils/proof-progress.js';

/**
 * The block an unprocessed request was enqueued in: while the proof request
 * machine holds it as `unprocessed`, read or being read again.
 *
 * @param request The proof request machine's state.
 * @returns The block, or `undefined` while the request is not known to be unprocessed.
 */
const unprocessedBlockOf = (request: ProofRequestStateNodeUnion): bigint | undefined => {
    if (!('snapshot' in request.data)) return undefined;
    const { snapshot } = request.data;
    return snapshot.state === ProofRequestState.Unprocessed && 'requestBlockNumber' in snapshot
        ? snapshot.requestBlockNumber
        : undefined;
};

/**
 * The `sessionStorage` key of a request's bar total: the total is kept for
 * the tab, so a reload fills the bar against the same total.
 *
 * @param txHash The transaction that enqueued the proof request.
 * @returns The key.
 */
const totalKey = (txHash: string): string => `nori-proof-progress-total:${txHash}`;

/**
 * Reads a request's bar total from `sessionStorage`.
 *
 * @param txHash The transaction that enqueued the proof request.
 * @returns The total in seconds, or `undefined` when none is kept or storage is unavailable.
 */
const readTotal = (txHash: string): number | undefined => {
    try {
        return storedTotal(sessionStorage.getItem(totalKey(txHash)));
    } catch {
        return undefined;
    }
};

/**
 * Keeps a request's bar total in `sessionStorage`, when storage is available.
 *
 * @param txHash The transaction that enqueued the proof request.
 * @param totalSec The total in seconds.
 */
const writeTotal = (txHash: string, totalSec: number): void => {
    try {
        sessionStorage.setItem(totalKey(txHash), totalSec.toString());
    } catch {
        // Without storage, a reload takes a new total.
    }
};

/** One followed proof request: its state, its bridge progress while unprocessed, and its controls. */
export interface FollowedProof {
    /** The proof request machine's states. */
    request$: Observable<ProofRequestStateNodeUnion>;
    /** The unprocessed machine's states while the request is `unprocessed`, else `undefined`. */
    progress$: Observable<UnprocessedProofRequestStateNodeUnion | undefined>;
    /**
     * When the request was enqueued: its block's time, unix milliseconds,
     * read once the request is first `unprocessed`. `undefined` until then,
     * while it is read, and for good when the read fails.
     */
    enqueuedAtMs$: Observable<number | undefined>;
    /**
     * The progress bar's total, in seconds: the time waited plus the time
     * left at the first estimate, extended only when an estimate runs past
     * it (`anchoredTotal`). Kept with the request and in `sessionStorage`,
     * so a view set up again or a reload keeps it. `undefined` until the
     * first estimate.
     */
    totalSec$: Observable<number | undefined>;
    /** Reads again now, while a read has failed. */
    retry: () => void;
}

/**
 * Follows proof requests for the app's lifetime, one proof request machine
 * per transaction hash, so a view that is set up again finds its request
 * where it left it. While a request is `unprocessed`, the unprocessed
 * machine follows the bridge's progress on it from the websocket.
 */
@Injectable([ConnectionsService, NoriBridgeInfraService])
export class ProofProgressService {
    private readonly followed = new Map<string, FollowedProof & { close: () => void }>();

    /**
     * @param connections The connections, Nori's websocket among them, and the queue and program addresses.
     * @param noriBridgeInfra Nori's bridge state.
     */
    constructor(
        private readonly connections: ConnectionsService,
        private readonly noriBridgeInfra: NoriBridgeInfraService,
    ) {}

    /**
     * The proof request enqueued by `txHash`, followed from the first call on.
     *
     * @param txHash The transaction that enqueued the proof request.
     * @returns Its state, its bridge progress and `retry()`.
     */
    follow(txHash: string): FollowedProof {
        const existing = this.followed.get(txHash);
        if (existing) return existing;

        const { connections, options } = this.connections;
        const proofRequest = followAgainOnReplaced(() =>
            createProofRequestStateMachine(
                connections,
                { ...options.proofRequests, proofRequestTxHash: txHash },
                undefined,
                15_000,
                this.noriBridgeInfra.state$,
            ),
        );
        const request$ = proofRequest.state$.pipe(shareReplay({ bufferSize: 1, refCount: false }));
        const progress$ = request$.pipe(
            map(unprocessedBlockOf),
            distinctUntilChanged(),
            switchMap((requestBlockNumber) =>
                requestBlockNumber !== undefined
                    ? new Observable<UnprocessedProofRequestStateNodeUnion>((subscriber) => {
                          const unprocessed = createUnprocessedProofRequestStateMachine(
                              Number(requestBlockNumber),
                              connections.nori,
                          )
                              .close()
                              .start('WaitingForEthFinality');
                          const subscription = unprocessed.state$.subscribe(subscriber);
                          return () => {
                              subscription.unsubscribe();
                              unprocessed.stop();
                          };
                      })
                    : of(undefined),
            ),
            shareReplay({ bufferSize: 1, refCount: true }),
        );
        // One block time machine per request, made from its enqueue block and closed with the stream.
        const enqueuedAtMs$ = request$.pipe(
            map(unprocessedBlockOf),
            filter(
                (requestBlockNumber): requestBlockNumber is bigint =>
                    requestBlockNumber !== undefined,
            ),
            take(1),
            switchMap((requestBlockNumber) =>
                followedStates$(() =>
                    createProofRequestBlockTimeMachine(connections, Number(requestBlockNumber)),
                ),
            ),
            map((state) => (state.node === 'current' ? state.data.timestampMs : undefined)),
            startWith(undefined),
            distinctUntilChanged(),
            shareReplay({ bufferSize: 1, refCount: true }),
        );
        let totalSec = readTotal(txHash);
        const totalSec$ = combineLatest([progress$, enqueuedAtMs$]).pipe(
            map(([progress, enqueuedAtMs]) => {
                if (progress === undefined || progress.node === 'FinishedWaiting') return totalSec;
                const { waiting_elapsed_sec, commit_time_remaining_sec } = progress.data;
                const next = anchoredTotal(
                    totalSec,
                    waitedSec(Date.now(), enqueuedAtMs, waiting_elapsed_sec),
                    commit_time_remaining_sec,
                );
                if (next !== undefined && next !== totalSec) writeTotal(txHash, next);
                totalSec = next;
                return totalSec;
            }),
            distinctUntilChanged(),
            shareReplay({ bufferSize: 1, refCount: true }),
        );
        const proof = {
            request$,
            progress$,
            enqueuedAtMs$,
            totalSec$,
            retry: () => proofRequest.retry(),
            close: () => proofRequest.close(),
        };
        this.followed.set(txHash, proof);
        return proof;
    }

    /**
     * Closes every followed proof request with the app.
     * @returns {void}
     */
    onDestroy(): void {
        for (const { close } of this.followed.values()) close();
        this.followed.clear();
    }
}
