import { Injectable } from '@yaw-rx/core';
import { distinctUntilChanged, Observable, of, shareReplay, switchMap } from 'rxjs';
import {
    createProofRequestStateMachine,
    createUnprocessedProofRequestStateMachine,
    type ProofRequestStateNodeUnion,
    type UnprocessedProofRequestStateNodeUnion,
} from '@nori-zk/nori-bridge-solana-sdk';
import { ConnectionsService } from './connections.service.js';

/** One followed proof request: its state, its bridge progress while unprocessed, and its controls. */
export interface FollowedProof {
    /** The proof request machine's states. */
    request$: Observable<ProofRequestStateNodeUnion>;
    /** The unprocessed machine's states while the request is `unprocessed`, else `undefined`. */
    progress$: Observable<UnprocessedProofRequestStateNodeUnion | undefined>;
    /** Reads again now, while a read has failed. */
    retry: () => void;
}

/**
 * Follows proof requests for the app's lifetime, one proof request machine
 * per transaction hash, so a view that is set up again finds its request
 * where it left it. While a request is `unprocessed`, the unprocessed
 * machine follows the bridge's progress on it from the websocket.
 */
@Injectable([ConnectionsService])
export class ProofProgressService {
    private readonly followed = new Map<
        string,
        FollowedProof & { close: () => void }
    >();

    /**
     * @param connections The connections, the bridge websocket and the queue and program addresses.
     */
    constructor(private readonly connections: ConnectionsService) {}

    /**
     * The proof request enqueued by `txHash`, followed from the first call on.
     *
     * @param txHash The transaction that enqueued the proof request.
     * @returns Its state, its bridge progress and `retry()`.
     */
    follow(txHash: string): FollowedProof {
        const existing = this.followed.get(txHash);
        if (existing) return existing;

        const { connections, bridge, options } = this.connections;
        const { proofRequestState, retry, close } = createProofRequestStateMachine(
            connections,
            { ...options.proofRequests, proofRequestTxHash: txHash },
            undefined,
            15_000,
            bridge.topics.bridgeStateTopic$,
        );
        const request$ = proofRequestState.state$.pipe(shareReplay({ bufferSize: 1, refCount: false }));
        const progress$ = request$.pipe(
            distinctUntilChanged((previous, current) => previous.node === current.node),
            switchMap((request) =>
                request.node === 'unprocessed'
                    ? new Observable<UnprocessedProofRequestStateNodeUnion>((subscriber) => {
                          const unprocessed = createUnprocessedProofRequestStateMachine(
                              Number(request.data.requestBlockNumber),
                              bridge.topics,
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
        const proof = { request$, progress$, retry, close };
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
