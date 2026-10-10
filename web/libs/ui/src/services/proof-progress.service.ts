import { Injectable } from '@yaw-rx/core';
import {
    catchError,
    defer,
    distinctUntilChanged,
    filter,
    map,
    Observable,
    of,
    retry as retryOnError,
    shareReplay,
    startWith,
    switchMap,
    take,
} from 'rxjs';
import {
    createProofRequestStateMachine,
    createUnprocessedProofRequestStateMachine,
    forCalls,
    type ProofRequestStateNodeUnion,
    type UnprocessedProofRequestStateNodeUnion,
} from '@nori-zk/nori-bridge-solana-sdk';
import { ConnectionsService } from './connections.service.js';
import { NoriBridgeInfraService } from './nori-bridge-infra.service.js';

/** How many times the enqueue block's read is tried again after it fails, and the wait before each. */
const BLOCK_READ_RETRIES = { count: 2, delay: 5_000 };

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
        const { proofRequestState, retry, close } = createProofRequestStateMachine(
            connections,
            { ...options.proofRequests, proofRequestTxHash: txHash },
            undefined,
            15_000,
            this.noriBridgeInfra.state$,
        );
        const request$ = proofRequestState.state$.pipe(
            shareReplay({ bufferSize: 1, refCount: false }),
        );
        const progress$ = request$.pipe(
            distinctUntilChanged((previous, current) => previous.node === current.node),
            switchMap((request) =>
                request.node === 'unprocessed'
                    ? new Observable<UnprocessedProofRequestStateNodeUnion>((subscriber) => {
                          const unprocessed = createUnprocessedProofRequestStateMachine(
                              Number(request.data.requestBlockNumber),
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
        // One block read per request, kept with it: the machines' own counts restart with the page.
        const enqueuedAtMs$ = request$.pipe(
            filter((request) => request.node === 'unprocessed'),
            take(1),
            switchMap((request) =>
                defer(async () =>
                    forCalls(connections.ethereum, async (provider) =>
                        provider.getBlock(request.data.requestBlockNumber),
                    ),
                ).pipe(
                    map((block) => {
                        if (block === null) throw new Error('The enqueue block is not found.');
                        return block.timestamp * 1000;
                    }),
                    retryOnError(BLOCK_READ_RETRIES),
                    catchError(() => of(undefined)),
                ),
            ),
            startWith(undefined),
            shareReplay({ bufferSize: 1, refCount: false }),
        );
        const proof = { request$, progress$, enqueuedAtMs$, retry, close };
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
